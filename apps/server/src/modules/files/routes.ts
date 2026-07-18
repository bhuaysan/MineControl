import { posix } from "node:path";
import { MAX_EDITABLE_FILE_BYTES } from "@minecontrol/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../auth.js";
import type { Server } from "@prisma/client";
import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";
import {
  ContainerNotRunningError,
  deletePath,
  listDirectory,
  makeDirectory,
  readFile,
  resolveDataPath,
  writeFile,
} from "./service.js";

const writeSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});
const mkdirSchema = z.object({ path: z.string().min(1) });

/** Lädt einen Docker-Server oder beantwortet direkt mit einem Fehler. */
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

/** Übersetzt Service-Fehler in HTTP-Antworten. */
function fail(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ContainerNotRunningError) {
    return reply.code(409).send({ error: "not_running", message: err.message });
  }
  return reply.code(400).send({ error: "file_error", message: (err as Error).message });
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  // Verzeichnis auflisten — Moderator+.
  app.get(
    "/api/servers/:id/files",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { path = "/" } = request.query as { path?: string };
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        return reply.send(await listDirectory(server, path));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Textinhalt lesen — Moderator+.
  app.get(
    "/api/servers/:id/files/content",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { path } = request.query as { path?: string };
      if (!path) return reply.code(400).send({ error: "bad_request", message: "Pfad fehlt" });
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        const buf = await readFile(server, path);
        if (buf.length > MAX_EDITABLE_FILE_BYTES) {
          return reply.code(413).send({ error: "too_large", message: "Datei zu groß zum Bearbeiten" });
        }
        if (buf.subarray(0, 8000).includes(0)) {
          return reply.code(415).send({ error: "binary", message: "Binärdatei – nicht editierbar" });
        }
        return reply.send({ path, content: buf.toString("utf8"), size: buf.length });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Datei herunterladen — Moderator+.
  app.get(
    "/api/servers/:id/files/download",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { path } = request.query as { path?: string };
      if (!path) return reply.code(400).send({ error: "bad_request", message: "Pfad fehlt" });
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        const buf = await readFile(server, path);
        const name = posix.basename(resolveDataPath(path));
        return reply
          .header("Content-Disposition", `attachment; filename="${name}"`)
          .type("application/octet-stream")
          .send(buf);
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Textinhalt speichern — nur Admin.
  app.put(
    "/api/servers/:id/files/content",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = writeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        await writeFile(server, parsed.data.path, Buffer.from(parsed.data.content, "utf8"));
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "file.write",
          details: { path: parsed.data.path },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Datei hochladen (multipart) — nur Admin. Zielverzeichnis via ?path=.
  app.post(
    "/api/servers/:id/files/upload",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { path = "/" } = request.query as { path?: string };
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "bad_request", message: "Keine Datei" });
      try {
        const buf = await file.toBuffer();
        const target = posix.join(path, file.filename);
        await writeFile(server, target, buf);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "file.upload",
          details: { path: target, size: buf.length },
        });
        return reply.code(201).send({ ok: true, path: target });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Ordner anlegen — nur Admin.
  app.post(
    "/api/servers/:id/files/mkdir",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = mkdirSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        await makeDirectory(server, parsed.data.path);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "file.mkdir",
          details: { path: parsed.data.path },
        });
        return reply.code(201).send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Datei/Ordner löschen — nur Admin.
  app.delete(
    "/api/servers/:id/files",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { path } = request.query as { path?: string };
      if (!path) return reply.code(400).send({ error: "bad_request", message: "Pfad fehlt" });
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        await deletePath(server, path);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "file.delete",
          details: { path },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );
}
