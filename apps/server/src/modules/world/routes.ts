import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type { Server } from "@prisma/client";
import { WORLD_NAME_REGEX } from "@minecontrol/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { containerName, docker } from "../../adapters/dockerClient.js";
import { authenticate, requireRole } from "../../auth.js";
import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";
import {
  WorldError,
  activeLevel,
  cancelPregen,
  createWorld,
  deleteWorld,
  listWorlds,
  startPregen,
  switchWorld,
  uploadWorld,
} from "./service.js";

const nameSchema = z.string().regex(WORLD_NAME_REGEX, "Ungültiger Weltname");
const switchSchema = z.object({ name: nameSchema });
const createSchema = z.object({
  name: nameSchema,
  seed: z.string().max(64).optional(),
});
const pregenSchema = z.object({
  radius: z.number().int().min(100).max(50000),
  world: nameSchema.optional(),
});

async function loadDockerServer(id: string, reply: FastifyReply): Promise<Server | null> {
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
  if (err instanceof WorldError) {
    return reply.code(err.status).send({ error: err.code, message: err.message });
  }
  return reply.code(502).send({ error: "world_failed", message: (err as Error).message });
}

export async function worldRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  // Welten auflisten — Moderator+.
  app.get(
    "/api/servers/:id/worlds",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        return reply.send(await listWorlds(server));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Aktive Welt wechseln (Neustart) — nur Admin.
  app.post(
    "/api/servers/:id/worlds/switch",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = switchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültiger Weltname" });
      }
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        await switchWorld(server, parsed.data.name);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "world.switch",
          details: { name: parsed.data.name },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Neue Welt erstellen + aktivieren (Neustart) — nur Admin.
  app.post(
    "/api/servers/:id/worlds",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        await createWorld(server, parsed.data.name, parsed.data.seed);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "world.create",
          details: { name: parsed.data.name, seed: parsed.data.seed },
        });
        return reply.code(201).send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Welt löschen — nur Admin.
  app.delete(
    "/api/servers/:id/worlds/:name",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id, name } = request.params as { id: string; name: string };
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        await deleteWorld(server, name);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "world.delete",
          details: { name },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Welt hochladen (.tar.gz, multipart) — nur Admin. Zielname via ?name=.
  app.post(
    "/api/servers/:id/worlds/upload",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { name } = request.query as { name?: string };
      if (!name || !WORLD_NAME_REGEX.test(name)) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültiger Weltname" });
      }
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "bad_request", message: "Keine Datei" });
      try {
        const buf = await file.toBuffer();
        await uploadWorld(server, name, buf);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "world.upload",
          details: { name, size: buf.length },
        });
        return reply.code(201).send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Pregeneration via Chunky starten — Moderator+.
  app.post(
    "/api/servers/:id/worlds/pregen",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = pregenSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        const result = await startPregen(server, parsed.data.radius, parsed.data.world);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "world.pregen",
          details: { radius: parsed.data.radius, world: parsed.data.world },
        });
        return reply.send(result);
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Pregeneration abbrechen — Moderator+.
  app.post(
    "/api/servers/:id/worlds/pregen/cancel",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        const response = await cancelPregen(server);
        return reply.send({ response });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

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

      const level = await activeLevel(server);
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

      // getArchive-Tar durch gzip an die Antwort streamen (wie beim Backup).
      // pipeline() statt archive.pipe(gzip): Fastify hängt seinen Fehler-Handler
      // nur an den gesendeten Stream (gzip), nicht an die Docker-Quelle — mit
      // `.pipe()` wäre ein Abbruch der Quelle ein unbehandeltes 'error'-Event und
      // hätte den Prozess beendet (siehe adapters/tarStream.ts). pipeline()
      // zerstört gzip mit demselben Fehler, den Fastify dann sieht.
      const gzip = createGzip();
      void pipeline(archive, gzip).catch((err: unknown) => {
        request.log.error({ err, serverId: server.id }, "Welt-Download abgebrochen");
      });
      return reply
        .header("Content-Disposition", `attachment; filename="${server.name}-${level}.tar.gz"`)
        .type("application/gzip")
        .send(gzip);
    },
  );
}
