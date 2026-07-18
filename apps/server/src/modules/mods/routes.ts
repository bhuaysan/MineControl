import type { Server } from "@prisma/client";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../auth.js";
import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";
import {
  UnsupportedEditionError,
  deleteMod,
  installMod,
  listInstalledMods,
  searchMods,
} from "./service.js";

const installSchema = z.object({
  projectId: z.string().min(1).max(64),
  versionId: z.string().min(1).max(64).optional(),
});

async function loadDockerServer(
  id: string,
  reply: FastifyReply,
): Promise<Server | null> {
  const server = await prisma.server.findUnique({ where: { id } });
  if (!server) {
    void reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
    return null;
  }
  if (server.type !== "DOCKER") {
    void reply.code(422).send({ error: "unsupported", message: "Nur für Docker-Server" });
    return null;
  }
  return server;
}

function fail(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof UnsupportedEditionError) {
    return reply.code(422).send({ error: "unsupported_edition", message: err.message });
  }
  if (/not running|is not running/i.test((err as Error).message)) {
    return reply.code(409).send({ error: "not_running", message: "Server muss laufen" });
  }
  return reply.code(502).send({ error: "mod_error", message: (err as Error).message });
}

export async function modRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  // Modrinth-Suche (nach Loader/Version des Servers gefiltert) — Moderator+.
  app.get(
    "/api/servers/:id/mods/search",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { q = "" } = request.query as { q?: string };
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        return reply.send(await searchMods(server, q));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Installierte Plugins/Mods — Moderator+.
  app.get(
    "/api/servers/:id/mods",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        return reply.send(await listInstalledMods(server));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Installieren — nur Admin.
  app.post(
    "/api/servers/:id/mods/install",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = installSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        const filename = await installMod(server, parsed.data.projectId, parsed.data.versionId);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "mod.install",
          details: { projectId: parsed.data.projectId, filename },
        });
        return reply.code(201).send({ filename });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Löschen — nur Admin.
  app.delete(
    "/api/servers/:id/mods",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { file } = request.query as { file?: string };
      if (!file) return reply.code(400).send({ error: "bad_request", message: "Datei fehlt" });
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        await deleteMod(server, file);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "mod.delete",
          details: { filename: file },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );
}
