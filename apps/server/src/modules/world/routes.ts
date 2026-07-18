import { createGzip } from "node:zlib";
import type { Server } from "@prisma/client";
import type { FastifyInstance, FastifyReply } from "fastify";
import { containerName, docker } from "../../adapters/dockerClient.js";
import { authenticate, requireRole } from "../../auth.js";
import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";
import { readServerProperties } from "../servers/docker.js";

/** Ermittelt den Weltnamen (server.properties `level-name`, Standard „world"). */
async function levelName(server: Server): Promise<string> {
  try {
    const props = await readServerProperties(server);
    return props["level-name"] || "world";
  } catch {
    return "world";
  }
}

export async function worldRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  // Welt-Ordner als tar.gz herunterladen — Moderator+.
  // Vanilla legt alle Dimensionen unter dem Welt-Ordner ab; bei Paper-artigen
  // Servern liegen Nether/End in eigenen Ordnern — dafür bleibt das Voll-Backup.
  app.get(
    "/api/servers/:id/world/download",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const server = await prisma.server.findUnique({ where: { id } });
      if (!server) {
        return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
      }
      if (server.type !== "DOCKER") {
        return reply.code(422).send({ error: "unsupported", message: "Nur für Docker-Server" });
      }

      const level = await levelName(server);
      const container = docker.getContainer(containerName(server.id));

      let archive: NodeJS.ReadableStream;
      try {
        archive = (await container.getArchive({
          path: `/data/${level}`,
        })) as unknown as NodeJS.ReadableStream;
      } catch {
        return reply.code(404).send({ error: "no_world", message: "Keine Weltdaten gefunden" });
      }

      await recordAudit({
        userId: request.user?.id,
        serverId: server.id,
        action: "world.download",
        details: { level },
      });

      // getArchive-Tar direkt durch gzip an die Antwort streamen (wie beim Backup).
      return reply
        .header("Content-Disposition", `attachment; filename="${server.name}-${level}.tar.gz"`)
        .type("application/gzip")
        .send(archive.pipe(createGzip()));
    },
  );
}
