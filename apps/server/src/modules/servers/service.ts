import type { Server } from "@prisma/client";
import type { ServerDto, ServerEdition, ServerStatus, ServerType } from "@minecontrol/shared";
import type { ServerAdapter } from "../../adapters/types.js";
import { createAdapter } from "../../adapters/registry.js";
import { prisma } from "../../db.js";

/**
 * Oberlimit für die Live-Status-Abfrage. Bewusst über dem 5s-Ping-Timeout
 * (adapters/ping.ts), damit die normale ONLINE/STARTING/OFFLINE-Erkennung
 * abschließen kann. Der Guard greift nur im pathologischen Fall — etwa wenn
 * `container.inspect()` (dockerode) hängt, weil der Docker-Daemon unter Last
 * nicht antwortet — und verhindert, dass ein einzelner Server die gesamte
 * (parallele) Server-Liste blockiert.
 */
const STATUS_TIMEOUT_MS = 8000;

/** Status-Platzhalter, wenn die Abfrage ins Timeout läuft. */
function unknownStatus(server: Server): ServerStatus {
  return {
    state: "UNKNOWN",
    online: false,
    edition: server.edition as ServerEdition,
    players: { online: 0, max: 0, sample: [] },
  };
}

// Läuft für einen Server bereits eine echte getStatus()-Abfrage? Der Timeout
// oben bricht die zugrunde liegende Operation NICHT ab (Promise.race kann das
// nicht) — ohne diesen Guard würde jeder weitere Poll-Tick eines dauerhaft
// hängenden Servers (z. B. ein blockierendes container.inspect() bei
// überlastetem Docker-Daemon) eine weitere, nie endende Abfrage anhäufen.
// Stattdessen docken alle Aufrufer an dieselbe laufende Abfrage an.
const inFlightStatus = new Map<string, Promise<ServerStatus>>();

/**
 * `adapter.getStatus()` mit hartem Oberlimit; Timeout → UNKNOWN statt Hänger.
 * Der `timeoutMs`-Parameter ist nur für Tests da (schnelles Durchspielen des
 * Timeout-/Selbstheilungspfads) — der Normalbetrieb nutzt {@link STATUS_TIMEOUT_MS}.
 */
export async function getStatusSafe(
  adapter: ServerAdapter,
  server: Server,
  timeoutMs = STATUS_TIMEOUT_MS,
): Promise<ServerStatus> {
  let call = inFlightStatus.get(server.id);
  if (!call) {
    call = adapter.getStatus();
    inFlightStatus.set(server.id, call);
    void call
      .finally(() => {
        if (inFlightStatus.get(server.id) === call) inFlightStatus.delete(server.id);
      })
      .catch(() => {
        // Bereits vom/den eigentlichen Aufrufer(n) über Promise.race behandelt —
        // hier nur verhindern, dass dieser zweite Consumer als unhandled auffällt.
      });
  }
  const active = call;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ServerStatus>((resolve) => {
    timer = setTimeout(() => {
      // Selbstheilung: Läuft die zugrunde liegende Abfrage über das Oberlimit
      // hinaus, den Cache-Eintrag verwerfen. Sonst würde eine ausnahmsweise doch
      // nie auflösende getStatus()-Promise dauerhaft im Cache bleiben und JEDEN
      // Folge-Poll vergiften (Server bliebe bis zum Neustart auf UNKNOWN). Die
      // laufende Promise trägt bereits ein .catch() — ihr späteres Ergebnis wird
      // dank Identitätsprüfung nicht mehr auf einen neuen Eintrag angewandt.
      if (inFlightStatus.get(server.id) === active) inFlightStatus.delete(server.id);
      resolve(unknownStatus(server));
    }, timeoutMs);
  });

  try {
    return await Promise.race([active, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Server-Datensatz + frisch abgefragter Live-Status → DTO fürs Frontend. */
export async function toServerDto(server: Server): Promise<ServerDto> {
  const adapter = createAdapter(server);
  const status = await getStatusSafe(adapter, server);
  return {
    id: server.id,
    name: server.name,
    type: server.type as ServerType,
    edition: server.edition as ServerEdition,
    host: server.host,
    port: server.port,
    hasRcon: Boolean(server.rconPort && server.rconPasswordEnc),
    capabilities: adapter.capabilities(),
    status,
    autoRestart: server.autoRestart,
    provisionError: server.lastProvisionError ?? undefined,
  };
}

/** Alle Server mit Live-Status (parallel abgefragt). */
export async function listServerDtos(): Promise<ServerDto[]> {
  const servers = await prisma.server.findMany({ orderBy: { createdAt: "asc" } });
  return Promise.all(servers.map(toServerDto));
}
