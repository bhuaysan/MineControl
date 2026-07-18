import type { Server } from "@prisma/client";
import type { ServerDto, ServerEdition, ServerType } from "@minecontrol/shared";
import { createAdapter } from "../../adapters/registry.js";
import { prisma } from "../../db.js";

/** Server-Datensatz + frisch abgefragter Live-Status → DTO fürs Frontend. */
export async function toServerDto(server: Server): Promise<ServerDto> {
  const adapter = createAdapter(server);
  const status = await adapter.getStatus();
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
