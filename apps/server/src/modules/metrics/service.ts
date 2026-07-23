import type { Server } from "@prisma/client";
import type { MetricSampleDto, ServerState } from "@minecontrol/shared";
import { DockerAdapter, isProvisioning } from "../../adapters/docker.js";
import { createAdapter } from "../../adapters/registry.js";
import type { ServerAdapter } from "../../adapters/types.js";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";
import {
  notifyAutoRestart,
  notifyAutoRestartGaveUp,
  notifyServerDown,
} from "../notifications/service.js";
import { reconcileSessions } from "../players/service.js";
import { reattachServerStreams } from "../../ws/index.js";
import { TPS_EDITIONS, sampleTps } from "./tps.js";

/** Letzter bekannter Zustand je Server — für Down-Erkennung. */
const prevStates = new Map<string, ServerState>();
/** Server-ID → Ablaufzeitpunkt, bis zu dem ein Down-Übergang erwartet ist. */
const suppressedUntil = new Map<string, number>();

/** Wie lange ein erwarteter Down-Übergang unterdrückt wird (ms). */
const SUPPRESS_WINDOW_MS = 180_000;

/**
 * Unterdrückt eine „Server offline"-Meldung für ein kurzes Zeitfenster (z. B.
 * bei geplantem Stop/Restart/Restore). Zeitbegrenzt, damit ein nie beobachteter
 * Down das Flag nicht dauerhaft „hängen" lässt.
 */
export function suppressDownAlert(serverId: string): void {
  suppressedUntil.set(serverId, Date.now() + SUPPRESS_WINDOW_MS);
}

/** Prüft & verbraucht eine aktive Unterdrückung für einen Server. */
function consumeSuppression(serverId: string): boolean {
  const until = suppressedUntil.get(serverId);
  if (until === undefined) return false;
  suppressedUntil.delete(serverId);
  return until > Date.now();
}

/** Prüft, ob gerade eine Unterdrückung aktiv ist, OHNE sie zu verbrauchen. */
function isSuppressed(serverId: string): boolean {
  const until = suppressedUntil.get(serverId);
  return until !== undefined && until > Date.now();
}

// --- Auto-Restart / Crash-Recovery ----------------------------------------
//
// Ergänzt Dockers `unless-stopped`-Policy (die exited Container neu startet):
// Wir greifen NUR bei einem Container, der LÄUFT/​restartet, aber dessen
// Minecraft-Server über längere Zeit nicht erreichbar ist (Status STARTING) —
// also einem Hänger oder Crashloop, den die exit-basierte Docker-Policy nicht
// löst. Bewusst gestoppte Server (OFFLINE) fassen wir nicht an; die
// unless-stopped-Policy unterscheidet „gestoppt" von „abgestürzt" für uns.

export type AutoRestartAction = "none" | "restart" | "giveup";

export interface AutoRestartTrack {
  /** Zeitpunkt (ms), seit dem der Server ununterbrochen STARTING ist; null = nicht in diesem Zustand. */
  unhealthySince: number | null;
  /** Bereits durchgeführte Auto-Restart-Versuche seit dem letzten ONLINE. */
  attempts: number;
  /** true, sobald nach maxAttempts aufgegeben wurde (bis der Server wieder ONLINE ist). */
  gaveUp: boolean;
}

export function newAutoRestartTrack(): AutoRestartTrack {
  return { unhealthySince: null, attempts: 0, gaveUp: false };
}

/** Zustand je Server für die Auto-Restart-Entscheidung. */
const autoRestartTracks = new Map<string, AutoRestartTrack>();

/**
 * Reine, testbare Entscheidungsfunktion. Aktualisiert den Track und liefert die
 * auszuführende Aktion.
 *
 * - `ONLINE`  → vollständiger Reset (gesund).
 * - `STARTING` & nicht unterdrückt → Uhr läuft; nach `graceMs` ein Neustart,
 *   bis `maxAttempts` erreicht sind, danach `giveup` (bis wieder ONLINE).
 * - Alles andere (OFFLINE/ERROR/UNKNOWN) oder eine aktive Unterdrückung
 *   (geplanter Stop/Restart/Backup/…) → Uhr anhalten, nichts tun.
 */
export function decideAutoRestart(
  state: ServerState,
  track: AutoRestartTrack,
  opts: { now: number; graceMs: number; maxAttempts: number; suppressed: boolean },
): { track: AutoRestartTrack; action: AutoRestartAction } {
  if (state === "ONLINE") {
    return { track: newAutoRestartTrack(), action: "none" };
  }
  if (state !== "STARTING" || opts.suppressed) {
    return { track: { ...track, unhealthySince: null }, action: "none" };
  }
  if (track.gaveUp) return { track, action: "none" };
  if (track.unhealthySince === null) {
    return { track: { ...track, unhealthySince: opts.now }, action: "none" };
  }
  if (opts.now - track.unhealthySince < opts.graceMs) {
    return { track, action: "none" };
  }
  if (track.attempts >= opts.maxAttempts) {
    return { track: { ...track, gaveUp: true }, action: "giveup" };
  }
  return {
    track: { ...track, attempts: track.attempts + 1, unhealthySince: opts.now },
    action: "restart",
  };
}

/** Wendet die Auto-Restart-Entscheidung auf einen Server an (Neustart + Notif + Audit). */
async function maybeAutoRestart(
  server: Server,
  adapter: ServerAdapter,
  state: ServerState,
): Promise<void> {
  if (server.type !== "DOCKER" || !server.autoRestart) {
    autoRestartTracks.delete(server.id);
    return;
  }
  // Erst-Provisionierung (Image-Pull/erster Boot) nicht unterbrechen.
  if (isProvisioning(server.id)) return;

  const track = autoRestartTracks.get(server.id) ?? newAutoRestartTrack();
  const { track: next, action } = decideAutoRestart(state, track, {
    now: Date.now(),
    graceMs: config.autoRestartGraceMs,
    maxAttempts: config.autoRestartMaxAttempts,
    suppressed: isSuppressed(server.id),
  });
  autoRestartTracks.set(server.id, next);
  if (action === "none") return;

  const minutesDown = Math.round(config.autoRestartGraceMs / 60_000);
  if (action === "restart") {
    console.warn(
      `Auto-Restart: ${server.name} hängt seit ~${minutesDown} min — Neustart (Versuch ${next.attempts}/${config.autoRestartMaxAttempts}).`,
    );
    // Den eigenen Neustart nicht als „Server offline" melden.
    suppressDownAlert(server.id);
    try {
      await adapter.restart();
      reattachServerStreams(server.id);
    } catch (err) {
      console.error(`Auto-Restart für ${server.name} fehlgeschlagen:`, err);
    }
    await recordAudit({
      serverId: server.id,
      action: "server.autoRestart",
      details: {
        attempt: next.attempts,
        maxAttempts: config.autoRestartMaxAttempts,
        minutesDown,
      },
    });
    await notifyAutoRestart(
      server.name,
      minutesDown,
      next.attempts,
      config.autoRestartMaxAttempts,
    );
  } else {
    console.error(
      `Auto-Restart: für ${server.name} nach ${config.autoRestartMaxAttempts} Versuchen aufgegeben.`,
    );
    await recordAudit({
      serverId: server.id,
      action: "server.autoRestartGaveUp",
      details: { maxAttempts: config.autoRestartMaxAttempts },
    });
    await notifyAutoRestartGaveUp(server.name, config.autoRestartMaxAttempts);
  }
}

/** Erfasst eine Momentaufnahme aller Server und erkennt Down-Übergänge. */
async function sampleAll(): Promise<void> {
  const servers = await prisma.server.findMany();
  for (const server of servers) {
    try {
      const adapter = createAdapter(server);
      const status = await adapter.getStatus();

      let cpuPercent: number | undefined;
      let ramUsedMb: number | undefined;
      let ramMaxMb: number | undefined;
      if (adapter instanceof DockerAdapter && status.online) {
        const stats = await adapter.sampleStats();
        if (stats) {
          cpuPercent = stats.cpuPercent;
          ramUsedMb = stats.ramUsedMb;
          ramMaxMb = stats.ramMaxMb;
        }
      }

      // TPS nur für Paper/Spigot (via RCON), wenn der Server läuft.
      let tps: number | undefined;
      if (status.online && TPS_EDITIONS.includes(server.edition)) {
        tps = (await sampleTps(adapter)) ?? undefined;
      }

      await prisma.metricSample.create({
        data: {
          serverId: server.id,
          playersOnline: status.players.online,
          cpuPercent,
          ramUsedMb,
          ramMaxMb,
          tps,
        },
      });

      // Spieler-Sessions fortschreiben: online → Namen abgleichen, offline → schließen.
      try {
        const names = status.online
          ? (await adapter.getPlayers()).map((p) => p.name)
          : [];
        await reconcileSessions(server.id, names);
      } catch (err) {
        console.error(`Session-Tracking für ${server.name} fehlgeschlagen:`, err);
      }

      // Down-Erkennung: ONLINE → OFFLINE/ERROR meldet (außer bei manuellem Stop).
      const prev = prevStates.get(server.id);
      const now = status.state;
      if (prev === "ONLINE" && (now === "OFFLINE" || now === "ERROR")) {
        if (!consumeSuppression(server.id)) await notifyServerDown(server.name);
      }
      prevStates.set(server.id, now);

      // Auto-Restart/Crash-Recovery (nur Docker + aktiviert).
      await maybeAutoRestart(server, adapter, now);
    } catch (err) {
      console.error(`Metrik-Sample für ${server.name} fehlgeschlagen:`, err);
    }
  }
}

/** Löscht Samples, die älter als `days` Tage sind. */
async function prune(days: number): Promise<void> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  await prisma.metricSample.deleteMany({ where: { timestamp: { lt: cutoff } } });
}

let sampling = false;

/** Ruft `sampleAll()` auf, überspringt aber, falls ein Durchgang noch läuft —
 * sonst können sich Durchläufe überlappen (doppelte Sessions, konkurrierende
 * Auto-Restarts/Benachrichtigungen), wenn ein Sample-Zyklus länger als
 * `intervalMs` dauert (z. B. hängende Docker-/RCON-Aufrufe). */
async function sampleAllExclusive(): Promise<void> {
  if (sampling) {
    console.warn("Metrik-Sample übersprungen — vorheriger Durchgang läuft noch.");
    return;
  }
  sampling = true;
  try {
    await sampleAll();
  } finally {
    sampling = false;
  }
}

/** Startet den periodischen Sampler (Standard: alle 60 s, Aufbewahrung 7 Tage). */
export function startMetricSampler(intervalMs = 60_000): void {
  // Erste Messung leicht verzögert, damit der Serverstart nicht blockiert wird.
  setTimeout(() => void sampleAllExclusive(), 5_000);
  setInterval(() => void sampleAllExclusive(), intervalMs);
  setInterval(() => void prune(7), 3_600_000);
}

/** Metrik-Historie eines Servers seit `sinceMs` (Millisekunden zurück). */
export async function getMetricHistory(
  serverId: string,
  sinceMs: number,
): Promise<MetricSampleDto[]> {
  const since = new Date(Date.now() - sinceMs);
  const samples = await prisma.metricSample.findMany({
    where: { serverId, timestamp: { gte: since } },
    orderBy: { timestamp: "asc" },
  });
  return samples.map((s) => ({
    timestamp: s.timestamp.toISOString(),
    playersOnline: s.playersOnline,
    cpuPercent: s.cpuPercent ?? undefined,
    ramUsedMb: s.ramUsedMb ?? undefined,
    ramMaxMb: s.ramMaxMb ?? undefined,
    tps: s.tps ?? undefined,
  }));
}
