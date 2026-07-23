import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type {
  ConnectionTestResult,
  ImportSourceDto,
  OnlinePlayer,
  PlayerAction,
  PlayerActionResponse,
  SendCommandResponse,
  StageUploadResponse,
} from "@minecontrol/shared";
import {
  DIFFICULTIES,
  DOCKER_EDITIONS,
  GAMEMODES,
  LIFECYCLE_ACTIONS,
  PLAYER_ACTIONS,
  SERVER_EDITIONS,
} from "@minecontrol/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DockerAdapter } from "../../adapters/docker.js";
import { ExternalAdapter } from "../../adapters/external.js";
import { createAdapter } from "../../adapters/registry.js";
import { UnsupportedOperationError } from "../../adapters/types.js";
import { authenticate, requireRole } from "../../auth.js";
import { config } from "../../config.js";
import { encryptSecret } from "../../crypto.js";
import { prisma } from "../../db.js";
import {
  broadcastServerStatus,
  detachServerStreams,
  reattachServerStreams,
} from "../../ws/index.js";
import { recordAudit } from "../audit/service.js";
import { deleteAllBackups } from "../backups/service.js";
import { suppressDownAlert } from "../metrics/service.js";
import { unscheduleTask } from "../tasks/service.js";
import {
  destroyDockerServer,
  provisionDockerServer,
  readServerProperties,
  writeServerProperties,
} from "./docker.js";
import { listServerDtos, toServerDto } from "./service.js";

const editionSchema = z.enum(SERVER_EDITIONS);

// Import-Quelle beim Erstellen: entweder ein per Staging hochgeladenes Archiv
// (UUID) oder eine Datei aus dem server-seitigen Import-Verzeichnis (IMPORT_DIR).
const IMPORT_FILENAME_REGEX = /^[A-Za-z0-9._-]+\.(tar\.gz|tgz)$/;
const importSourceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("upload"), stagingId: z.string().uuid() }),
  z.object({
    source: z.literal("path"),
    filename: z.string().max(200).regex(IMPORT_FILENAME_REGEX, "Ungültiger Dateiname"),
  }),
]);
type ImportSourceInput = z.infer<typeof importSourceSchema>;

/** Ob `filename` ein zulässiges Import-Archiv benennt (keine Pfad-Trenner/Traversal). */
function isImportArchive(filename: string): boolean {
  return IMPORT_FILENAME_REGEX.test(filename);
}

/**
 * Löst eine Import-Quelle in einen existierenden Host-Pfad auf. `null`, wenn die
 * Datei fehlt oder (bei „path") aus dem Import-Verzeichnis ausbräche.
 */
async function resolveImportPath(src: ImportSourceInput): Promise<string | null> {
  const target =
    src.source === "upload"
      ? join(config.importStagingDir, `${src.stagingId}.tar.gz`)
      : resolve(config.importDir, src.filename);
  if (src.source === "path") {
    const root = resolve(config.importDir);
    if (target !== root && !target.startsWith(root + sep)) return null;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) return null;
  } catch {
    return null;
  }
  return target;
}

const createExternalSchema = z.object({
  name: z.string().min(1).max(64),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(25565),
  edition: editionSchema.default("UNKNOWN"),
  rconPort: z.number().int().min(1).max(65535).optional(),
  rconPassword: z.string().min(1).optional(),
});

const testSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(25565),
  rconPort: z.number().int().min(1).max(65535).optional(),
  rconPassword: z.string().min(1).optional(),
});

// Docker: RCON-Host-Port wird aus dem MC-Port abgeleitet → Port ≤ 55535.
const createDockerSchema = z.object({
  name: z.string().min(1).max(64),
  edition: z.enum(DOCKER_EDITIONS),
  version: z
    .string()
    .max(20)
    .regex(/^(LATEST|SNAPSHOT|[0-9][0-9a-zA-Z.\-_]*)$/, "Ungültige Version")
    .default("LATEST"),
  memoryMb: z.number().int().min(512).max(32768),
  port: z.number().int().min(1024).max(55535).default(25565),
  seed: z.string().max(64).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  gamemode: z.enum(GAMEMODES).optional(),
  motd: z.string().max(120).optional(),
  onlineMode: z.boolean().default(false),
  eula: z.literal(true),
  modrinthModpack: z.string().max(200).optional(),
  curseforgeModpack: z.string().max(300).optional(),
  import: importSourceSchema.optional(),
})
  .refine((d) => !(d.modrinthModpack && d.curseforgeModpack), {
    message: "Nur ein Modpack (Modrinth ODER CurseForge) angeben",
    path: ["curseforgeModpack"],
  })
  .refine((d) => !(d.import && (d.modrinthModpack || d.curseforgeModpack)), {
    message: "Import und Modpack können nicht kombiniert werden",
    path: ["import"],
  });

const lifecycleSchema = z.object({ action: z.enum(LIFECYCLE_ACTIONS) });

const propertiesSchema = z.object({
  properties: z.record(z.string(), z.string().max(200)),
});

const commandSchema = z.object({ command: z.string().min(1) });

// Minecraft-Namen: 3–16 Zeichen, nur a-z, A-Z, 0-9, _
const playerNameSchema = z.string().regex(/^[A-Za-z0-9_]{3,16}$/);

const playerActionSchema = z.object({
  name: playerNameSchema,
  action: z.enum(PLAYER_ACTIONS),
  reason: z.string().max(200).optional(),
});

/** Übersetzt eine Spieler-Aktion in den passenden Minecraft-Befehl. */
function buildPlayerCommand(
  action: PlayerAction,
  name: string,
  reason?: string,
): string {
  const suffix = reason ? ` ${reason}` : "";
  switch (action) {
    case "kick":
      return `kick ${name}${suffix}`;
    case "ban":
      return `ban ${name}${suffix}`;
    case "unban":
      return `pardon ${name}`;
    case "whitelist_add":
      return `whitelist add ${name}`;
    case "whitelist_remove":
      return `whitelist remove ${name}`;
    case "op":
      return `op ${name}`;
    case "deop":
      return `deop ${name}`;
  }
}

export async function serverRoutes(app: FastifyInstance): Promise<void> {
  // Alle Server-Routen erfordern Anmeldung.
  app.addHook("preHandler", authenticate);

  app.get("/api/servers", async (_request, reply) => {
    return reply.send(await listServerDtos());
  });

  app.get("/api/servers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) {
      return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
    }
    return reply.send(await toServerDto(server));
  });

  // Verbindungstest im Wizard — Moderator+.
  app.post(
    "/api/servers/test",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const parsed = testSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const { host, port, rconPort, rconPassword } = parsed.data;
      const adapter = new ExternalAdapter({
        host,
        port,
        edition: "UNKNOWN",
        rcon:
          rconPort && rconPassword ? { port: rconPort, password: rconPassword } : undefined,
      });
      const result: ConnectionTestResult = await adapter.testConnection();
      return reply.send(result);
    },
  );

  // Externen Server anlegen — nur Admin.
  app.post(
    "/api/servers/external",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const parsed = createExternalSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const data = parsed.data;
      const server = await prisma.server.create({
        data: {
          name: data.name,
          type: "EXTERNAL",
          edition: data.edition,
          host: data.host,
          port: data.port,
          rconPort: data.rconPort ?? null,
          rconPasswordEnc: data.rconPassword ? encryptSecret(data.rconPassword) : null,
        },
      });
      await recordAudit({
        userId: request.user?.id,
        serverId: server.id,
        action: "server.create",
        details: { name: server.name, type: "EXTERNAL", host: server.host },
      });
      return reply.code(201).send(await toServerDto(server));
    },
  );

  // Docker-Server erstellen — nur Admin.
  app.post(
    "/api/servers/docker",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const parsed = createDockerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const data = parsed.data;
      const rconHostPort = data.port + 10000;

      // Import-Quelle (falls angegeben) vor dem Anlegen zu einem Host-Pfad auflösen.
      let importFilePath: string | undefined;
      if (data.import) {
        const resolved = await resolveImportPath(data.import);
        if (!resolved) {
          return reply
            .code(400)
            .send({ error: "import_not_found", message: "Import-Datei nicht gefunden" });
        }
        importFilePath = resolved;
      }

      // Port-Kollisionen mit bestehenden Servern vermeiden.
      const clash = await prisma.server.findFirst({
        where: {
          OR: [
            { port: data.port },
            { port: rconHostPort },
            { rconPort: data.port },
            { rconPort: rconHostPort },
          ],
        },
      });
      if (clash) {
        return reply
          .code(409)
          .send({ error: "port_in_use", message: `Port ${data.port} ist bereits belegt` });
      }

      const rconPassword = randomBytes(16).toString("hex");
      const server = await prisma.server.create({
        data: {
          name: data.name,
          type: "DOCKER",
          edition: data.edition,
          host: "127.0.0.1",
          port: data.port,
          rconPort: rconHostPort,
          rconPasswordEnc: encryptSecret(rconPassword),
          dockerConfig: JSON.stringify({
            edition: data.edition,
            version: data.version,
            memoryMb: data.memoryMb,
            seed: data.seed,
            difficulty: data.difficulty,
            gamemode: data.gamemode,
            motd: data.motd,
            onlineMode: data.onlineMode,
            modrinthModpack: data.modrinthModpack,
            curseforgeModpack: data.curseforgeModpack,
          }),
        },
      });
      await recordAudit({
        userId: request.user?.id,
        serverId: server.id,
        action: "server.create",
        details: {
          name: server.name,
          type: "DOCKER",
          edition: data.edition,
          imported: Boolean(importFilePath),
        },
      });

      // Provisionierung läuft asynchron; Fortschritt via WS-Konsole.
      void provisionDockerServer(server, {
        edition: data.edition,
        version: data.version,
        memoryMb: data.memoryMb,
        mcPort: data.port,
        rconHostPort,
        rconPassword,
        seed: data.seed,
        difficulty: data.difficulty,
        gamemode: data.gamemode,
        motd: data.motd,
        onlineMode: data.onlineMode,
        modrinthModpack: data.modrinthModpack,
        curseforgeModpack: data.curseforgeModpack,
        importFilePath,
      }).catch((err) => {
        request.log.error(err, "Docker-Provisionierung fehlgeschlagen");
      });

      return reply.code(202).send(await toServerDto(server));
    },
  );

  // Server-seitig bereitgestellte Import-Archive auflisten — nur Admin.
  app.get(
    "/api/servers/import/sources",
    { preHandler: requireRole("ADMIN") },
    async (_request, reply) => {
      let entries: string[];
      try {
        entries = await readdir(config.importDir);
      } catch {
        // Verzeichnis existiert (noch) nicht → leere Liste.
        return reply.send([] satisfies ImportSourceDto[]);
      }
      const sources: ImportSourceDto[] = [];
      for (const filename of entries) {
        if (!isImportArchive(filename)) continue;
        try {
          const info = await stat(join(config.importDir, filename));
          if (info.isFile()) sources.push({ filename, sizeBytes: info.size });
        } catch {
          /* Datei verschwand zwischen readdir und stat — überspringen. */
        }
      }
      sources.sort((a, b) => a.filename.localeCompare(b.filename));
      return reply.send(sources);
    },
  );

  // Import-Archiv hochladen (Staging) — nur Admin. Gestreamt auf Platte, damit
  // GB-große Server-Verzeichnisse ohne RAM-Buffer und ohne das globale 50-MB-Limit
  // (per-Request angehoben) verarbeitet werden können.
  app.post(
    "/api/servers/import/stage",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const file = await request.file({ limits: { fileSize: config.importMaxBytes } });
      if (!file) {
        return reply.code(400).send({ error: "bad_request", message: "Keine Datei" });
      }
      await mkdir(config.importStagingDir, { recursive: true });
      const stagingId = randomUUID();
      const target = join(config.importStagingDir, `${stagingId}.tar.gz`);
      try {
        await pipeline(file.file, createWriteStream(target));
      } catch (err) {
        await rm(target, { force: true }).catch(() => {});
        // @fastify/multipart wirft bei Überschreiten des fileSize-Limits (Default
        // throwFileSizeLimit=true) einen FST_REQ_FILE_TOO_LARGE (Status 413).
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 413 || file.file.truncated) {
          return reply.code(413).send({ error: "too_large", message: "Datei zu groß" });
        }
        return reply
          .code(500)
          .send({ error: "stage_failed", message: (err as Error).message });
      }
      const { size } = await stat(target);
      const body: StageUploadResponse = { stagingId, sizeBytes: size };
      return reply.code(201).send(body);
    },
  );

  // Lifecycle (start/stop/restart/kill) — Moderator+.
  app.post(
    "/api/servers/:id/lifecycle",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = lifecycleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Aktion" });
      }
      const server = await prisma.server.findUnique({ where: { id } });
      if (!server) {
        return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
      }
      const adapter = createAdapter(server);
      const { action } = parsed.data;
      // Geplanter Stop/Restart → keine „Server offline"-Meldung auslösen.
      if (action === "stop" || action === "restart") suppressDownAlert(server.id);
      try {
        if (action === "start") await adapter.start();
        else if (action === "stop") await adapter.stop();
        else if (action === "restart") await adapter.restart();
        else if (action === "kill") {
          if (!(adapter instanceof DockerAdapter)) {
            throw new UnsupportedOperationError("Server killen");
          }
          await adapter.kill();
        }
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: `server.${action}`,
        });
        // Bei (Neu-)Start Live-Streams wieder anhängen, dann Status verteilen.
        if (action === "start" || action === "restart") reattachServerStreams(server.id);
        void broadcastServerStatus(server.id);
        return reply.send({ ok: true });
      } catch (err) {
        if (err instanceof UnsupportedOperationError) {
          return reply.code(422).send({ error: "unsupported", message: err.message });
        }
        return reply.code(502).send({ error: "action_failed", message: (err as Error).message });
      }
    },
  );

  // Auto-Restart/Crash-Recovery ein-/ausschalten (nur Docker) — Admin.
  app.patch(
    "/api/servers/:id/auto-restart",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "bad_request", message: "Feld enabled (boolean) erwartet" });
      }
      const server = await prisma.server.findUnique({ where: { id } });
      if (!server) {
        return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
      }
      if (server.type !== "DOCKER") {
        return reply.code(422).send({
          error: "unsupported",
          message: "Auto-Restart ist nur für Docker-Server verfügbar",
        });
      }
      const updated = await prisma.server.update({
        where: { id },
        data: { autoRestart: parsed.data.enabled },
      });
      await recordAudit({
        userId: request.user?.id,
        serverId: id,
        action: "server.autoRestart.config",
        details: { enabled: parsed.data.enabled },
      });
      return reply.send(await toServerDto(updated));
    },
  );

  // server.properties lesen (nur Docker) — Moderator+.
  app.get("/api/servers/:id/properties", async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) {
      return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
    }
    if (server.type !== "DOCKER") {
      return reply.code(422).send({ error: "unsupported", message: "Nur für Docker-Server" });
    }
    return reply.send(await readServerProperties(server));
  });

  // server.properties speichern (nur Docker) — nur Admin.
  app.put(
    "/api/servers/:id/properties",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = propertiesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const server = await prisma.server.findUnique({ where: { id } });
      if (!server) {
        return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
      }
      if (server.type !== "DOCKER") {
        return reply.code(422).send({ error: "unsupported", message: "Nur für Docker-Server" });
      }
      await writeServerProperties(server, parsed.data.properties);
      await recordAudit({
        userId: request.user?.id,
        serverId: server.id,
        action: "server.properties_update",
        details: { keys: Object.keys(parsed.data.properties) },
      });
      return reply.send(await readServerProperties(server));
    },
  );

  // Server löschen — nur Admin. Bei Docker: Container + optional Welt entfernen.
  app.delete(
    "/api/servers/:id",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { keepWorld } = request.query as { keepWorld?: string };
      const server = await prisma.server.findUnique({ where: { id } });
      if (!server) {
        return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
      }
      // Geplante Tasks des Servers aus dem Scheduler nehmen (DB-Cascade räumt Zeilen).
      const tasks = await prisma.scheduledTask.findMany({
        where: { serverId: id },
        select: { id: true },
      });
      for (const task of tasks) unscheduleTask(task.id);
      await deleteAllBackups(id);
      if (server.type === "DOCKER") {
        detachServerStreams(server.id);
        try {
          await destroyDockerServer(server, keepWorld === "true");
        } catch (err) {
          // Teardown fehlgeschlagen → DB-Zeile NICHT löschen, damit kein
          // verwaister Container/Volume ohne Eintrag zurückbleibt und ein
          // erneuter Löschversuch möglich bleibt.
          request.log.error({ err, serverId: id }, "Docker-Teardown fehlgeschlagen");
          return reply.code(502).send({
            error: "docker_teardown_failed",
            message:
              "Container/Volume konnte nicht entfernt werden — Server wurde nicht gelöscht. Bitte erneut versuchen.",
          });
        }
      }
      await prisma.server.delete({ where: { id } });
      await recordAudit({
        userId: request.user?.id,
        action: "server.delete",
        details: { name: server.name, keepWorld: keepWorld === "true" },
      });
      return reply.send({ ok: true });
    },
  );

  // Online-Spieler (via RCON `list`, sonst Ping-Sample) — alle angemeldeten Nutzer.
  app.get("/api/servers/:id/players", async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) {
      return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
    }
    const adapter = createAdapter(server);
    const players: OnlinePlayer[] = await adapter.getPlayers();
    return reply.send(players);
  });

  // Spieler-Aktion (Kick/Ban/Whitelist/OP …) — Moderator+.
  app.post(
    "/api/servers/:id/players/action",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = playerActionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const { name, action, reason } = parsed.data;
      if (action === "ban" && !reason) {
        return reply
          .code(400)
          .send({ error: "bad_request", message: "Für einen Bann ist ein Grund erforderlich" });
      }

      const server = await prisma.server.findUnique({ where: { id } });
      if (!server) {
        return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
      }
      const adapter = createAdapter(server);
      try {
        const response = await adapter.sendCommand(
          buildPlayerCommand(action, name, reason),
        );
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: `player.${action}`,
          details: { player: name, reason },
        });
        const body: PlayerActionResponse = { response };
        return reply.send(body);
      } catch (err) {
        if (err instanceof UnsupportedOperationError) {
          return reply.code(422).send({ error: "unsupported", message: err.message });
        }
        return reply
          .code(502)
          .send({ error: "rcon_failed", message: (err as Error).message });
      }
    },
  );

  // RCON-Befehl senden — Moderator+.
  app.post(
    "/api/servers/:id/command",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = commandSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Befehl erforderlich" });
      }
      const server = await prisma.server.findUnique({ where: { id } });
      if (!server) {
        return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
      }
      const adapter = createAdapter(server);
      try {
        const response = await adapter.sendCommand(parsed.data.command);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "server.command",
          details: { command: parsed.data.command },
        });
        const body: SendCommandResponse = { response };
        return reply.send(body);
      } catch (err) {
        if (err instanceof UnsupportedOperationError) {
          return reply.code(422).send({ error: "unsupported", message: err.message });
        }
        return reply
          .code(502)
          .send({ error: "rcon_failed", message: (err as Error).message });
      }
    },
  );
}
