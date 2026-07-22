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

/** `adapter.getStatus()` mit hartem Oberlimit; Timeout → UNKNOWN statt Hänger. */
async function getStatusSafe(adapter: ServerAdapter, server: Server): Promise<ServerStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ServerStatus>((resolve) => {
    timer = setTimeout(() => resolve(unknownStatus(server)), STATUS_TIMEOUT_MS);
  });
  try {
    return await Promise.race([adapter.getStatus(), timeout]);
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
  };
}

/** Alle Server mit Live-Status (parallel abgefragt). */
export async function listServerDtos(): Promise<ServerDto[]> {
  const servers = await prisma.server.findMany({ orderBy: { createdAt: "asc" } });
  return Promise.all(servers.map(toServerDto));
}
