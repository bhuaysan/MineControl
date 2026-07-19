import type { MetricSampleDto, ServerState } from "@minecontrol/shared";
import { DockerAdapter } from "../../adapters/docker.js";
import { createAdapter } from "../../adapters/registry.js";
import { prisma } from "../../db.js";
import { notifyServerDown } from "../notifications/service.js";
import { reconcileSessions } from "../players/service.js";
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

/** Startet den periodischen Sampler (Standard: alle 60 s, Aufbewahrung 7 Tage). */
export function startMetricSampler(intervalMs = 60_000): void {
  // Erste Messung leicht verzögert, damit der Serverstart nicht blockiert wird.
  setTimeout(() => void sampleAll(), 5_000);
  setInterval(() => void sampleAll(), intervalMs);
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
