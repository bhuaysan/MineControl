import type {
  ConnectionTestResult,
  OnlinePlayer,
  PlayerAction,
  PlayerActionResponse,
  SendCommandResponse,
} from "@minecontrol/shared";
import { PLAYER_ACTIONS, SERVER_EDITIONS } from "@minecontrol/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ExternalAdapter } from "../../adapters/external.js";
import { createAdapter } from "../../adapters/registry.js";
import { UnsupportedOperationError } from "../../adapters/types.js";
import { authenticate, requireRole } from "../../auth.js";
import { encryptSecret } from "../../crypto.js";
import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";
import { listServerDtos, toServerDto } from "./service.js";

const editionSchema = z.enum(SERVER_EDITIONS);

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

  // Server löschen — nur Admin.
  app.delete(
    "/api/servers/:id",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const server = await prisma.server.findUnique({ where: { id } });
      if (!server) {
        return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
      }
      await prisma.server.delete({ where: { id } });
      await recordAudit({
        userId: request.user?.id,
        action: "server.delete",
        details: { name: server.name },
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
