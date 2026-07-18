import type { Server } from "@prisma/client";
import type { ServerEdition } from "@minecontrol/shared";
import { decryptSecret } from "../crypto.js";
import { DockerAdapter } from "./docker.js";
import { ExternalAdapter } from "./external.js";
import type { ServerAdapter } from "./types.js";

/** Erzeugt den passenden Adapter für einen DB-Server-Datensatz. */
export function createAdapter(server: Server): ServerAdapter {
  switch (server.type) {
    case "EXTERNAL":
      return new ExternalAdapter({
        host: server.host,
        port: server.port,
        edition: server.edition as ServerEdition,
        rcon:
          server.rconPort && server.rconPasswordEnc
            ? {
                port: server.rconPort,
                password: decryptSecret(server.rconPasswordEnc),
              }
            : undefined,
      });
    case "DOCKER":
      return new DockerAdapter(server.id, {
        port: server.port,
        edition: server.edition as ServerEdition,
        rcon:
          server.rconPort && server.rconPasswordEnc
            ? {
                port: server.rconPort,
                password: decryptSecret(server.rconPasswordEnc),
              }
            : undefined,
      });
    default:
      throw new Error(`Unbekannter Servertyp: ${server.type}`);
  }
}

/** Wie `createAdapter`, aber typisiert auf den DockerAdapter. */
export function createDockerAdapter(server: Server): DockerAdapter {
  const adapter = createAdapter(server);
  if (!(adapter instanceof DockerAdapter)) {
    throw new Error("Server ist kein Docker-Server");
  }
  return adapter;
}
