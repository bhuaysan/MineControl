import type { Server } from "@prisma/client";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../auth.js";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";
import {
  ModInputError,
  UnsupportedEditionError,
  checkPluginUpdates,
  deleteMod,
  getPluginConfig,
  installJarFromUrl,
  installMod,
  installUploadedJar,
  listInstalledMods,
  readPluginConfigFile,
  searchMods,
  setModEnabled,
  updatePlugin,
  writePluginConfigFile,
} from "./service.js";

const installSchema = z.object({
  projectId: z.string().min(1).max(64),
  versionId: z.string().min(1).max(64).optional(),
});
const urlSchema = z.object({ url: z.string().min(1).max(2048) });
const toggleSchema = z.object({ file: z.string().min(1).max(200), enabled: z.boolean() });
const fileSchema = z.object({ file: z.string().min(1).max(200) });
const configWriteSchema = z.object({ content: z.string().max(1_000_000) });

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
  if (err instanceof ModInputError) {
    return reply.code(400).send({ error: "bad_request", message: err.message });
  }
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

  // Update-Check (nur Modrinth-Herkunft) — Moderator+.
  app.get(
    "/api/servers/:id/mods/updates",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        return reply.send(await checkPluginUpdates(server));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Config-Ordner eines Plugins auflisten — Moderator+.
  app.get(
    "/api/servers/:id/mods/config",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { file } = request.query as { file?: string };
      if (!file) return reply.code(400).send({ error: "bad_request", message: "Datei fehlt" });
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        return reply.send(await getPluginConfig(server, file));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Eine Config-Datei lesen — Moderator+.
  app.get(
    "/api/servers/:id/mods/config/file",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { file, path } = request.query as { file?: string; path?: string };
      if (!file || !path) {
        return reply.code(400).send({ error: "bad_request", message: "Datei/Pfad fehlt" });
      }
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        const content = await readPluginConfigFile(server, file, path);
        return reply.send({ path, content });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Eine Config-Datei schreiben — nur Admin.
  app.put(
    "/api/servers/:id/mods/config/file",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { file, path } = request.query as { file?: string; path?: string };
      if (!file || !path) {
        return reply.code(400).send({ error: "bad_request", message: "Datei/Pfad fehlt" });
      }
      const parsed = configWriteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültiger Inhalt" });
      }
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        await writePluginConfigFile(server, file, path, parsed.data.content);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "mod.config_write",
          details: { file, path },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Modrinth installieren — nur Admin.
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

  // Eigene .jar hochladen — nur Admin.
  app.post(
    "/api/servers/:id/mods/upload",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      const file = await request.file({ limits: { fileSize: config.modsMaxBytes } });
      if (!file) return reply.code(400).send({ error: "bad_request", message: "Keine Datei" });
      let data: Buffer;
      try {
        data = await file.toBuffer();
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 413 || file.file.truncated) {
          return reply.code(413).send({ error: "too_large", message: "Datei zu groß" });
        }
        return reply.code(400).send({ error: "bad_request", message: (err as Error).message });
      }
      try {
        const filename = await installUploadedJar(server, file.filename, data);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "mod.upload",
          details: { filename },
        });
        return reply.code(201).send({ filename });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Eigene .jar von URL installieren — nur Admin.
  app.post(
    "/api/servers/:id/mods/from-url",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = urlSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "URL fehlt" });
      }
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        const filename = await installJarFromUrl(server, parsed.data.url);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "mod.install_url",
          details: { url: parsed.data.url, filename },
        });
        return reply.code(201).send({ filename });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Aktivieren/Deaktivieren — nur Admin.
  app.post(
    "/api/servers/:id/mods/toggle",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = toggleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        await setModEnabled(server, parsed.data.file, parsed.data.enabled);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: parsed.data.enabled ? "mod.enable" : "mod.disable",
          details: { filename: parsed.data.file },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Auf neueste Modrinth-Version aktualisieren — nur Admin.
  app.post(
    "/api/servers/:id/mods/update",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = fileSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const server = await loadDockerServer(id, reply);
      if (!server) return reply;
      try {
        const filename = await updatePlugin(server, parsed.data.file);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "mod.update",
          details: { from: parsed.data.file, to: filename },
        });
        return reply.send({ filename });
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
