import type { Server } from "@prisma/client";
import type { ServerEdition } from "@minecontrol/shared";
import { decryptSecret } from "../crypto.js";
import { ExternalAdapter } from "./external.js";
import type { ServerAdapter } from "./types.js";

/**
 * Erzeugt den passenden Adapter für einen DB-Server-Datensatz.
 * Phase 1: nur EXTERNAL. DOCKER folgt in Phase 2.
 */
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
      throw new Error("Docker-Adapter ist noch nicht implementiert (Phase 2)");
    default:
      throw new Error(`Unbekannter Servertyp: ${server.type}`);
  }
}
