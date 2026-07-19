import { NETWORK_ALIAS_REGEX, NETWORK_SUBSERVER_EDITIONS } from "@minecontrol/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../auth.js";
import { recordAudit } from "../audit/service.js";
import {
  NetworkError,
  attachSubserver,
  createNetwork,
  createSubserver,
  deleteNetwork,
  detachSubserver,
  getNetworkDto,
  listNetworkDtos,
} from "./service.js";

const versionSchema = z
  .string()
  .max(20)
  .regex(/^(LATEST|SNAPSHOT|[0-9][0-9a-zA-Z.\-_]*)$/, "Ungültige Version")
  .default("LATEST");

const aliasSchema = z.string().regex(NETWORK_ALIAS_REGEX, "Ungültiger Alias");

const createNetworkSchema = z.object({
  name: z.string().min(1).max(64),
  proxyName: z.string().min(1).max(64),
  version: versionSchema,
  memoryMb: z.number().int().min(256).max(16384),
  port: z.number().int().min(1024).max(65535),
});

const addSubserverSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("attach"),
    serverId: z.string().min(1),
    alias: aliasSchema,
  }),
  z.object({
    mode: z.literal("create"),
    alias: aliasSchema,
    name: z.string().min(1).max(64),
    edition: z.enum(NETWORK_SUBSERVER_EDITIONS),
    version: versionSchema,
    memoryMb: z.number().int().min(512).max(32768),
    port: z.number().int().min(1024).max(55535),
    motd: z.string().max(120).optional(),
  }),
]);

/** Übersetzt NetworkError in eine HTTP-Antwort. */
function fail(reply: import("fastify").FastifyReply, err: unknown): unknown {
  if (err instanceof NetworkError) {
    return reply.code(err.status).send({ error: err.code, message: err.message });
  }
  throw err;
}

export async function networkRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/api/networks", async (_request, reply) => {
    return reply.send(await listNetworkDtos());
  });

  app.get("/api/networks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const dto = await getNetworkDto(id);
    if (!dto) {
      return reply.code(404).send({ error: "not_found", message: "Netzwerk nicht gefunden" });
    }
    return reply.send(dto);
  });

  // Netzwerk (Velocity-Proxy) anlegen — nur Admin.
  app.post(
    "/api/networks",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const parsed = createNetworkSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      try {
        const { networkId } = await createNetwork(parsed.data);
        await recordAudit({
          userId: request.user?.id,
          action: "network.create",
          details: { name: parsed.data.name, port: parsed.data.port },
        });
        return reply.code(202).send(await getNetworkDto(networkId));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Subserver anhängen (bestehend) oder neu erstellen — nur Admin.
  app.post(
    "/api/networks/:id/subservers",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = addSubserverSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      try {
        if (parsed.data.mode === "attach") {
          await attachSubserver(id, parsed.data.serverId, parsed.data.alias);
          await recordAudit({
            userId: request.user?.id,
            serverId: parsed.data.serverId,
            action: "network.subserver_attach",
            details: { networkId: id, alias: parsed.data.alias },
          });
        } else {
          const { serverId } = await createSubserver(id, parsed.data);
          await recordAudit({
            userId: request.user?.id,
            serverId,
            action: "network.subserver_create",
            details: { networkId: id, alias: parsed.data.alias, name: parsed.data.name },
          });
        }
        return reply.code(202).send(await getNetworkDto(id));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Subserver lösen — nur Admin.
  app.delete(
    "/api/networks/:id/subservers/:serverId",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id, serverId } = request.params as { id: string; serverId: string };
      try {
        await detachSubserver(id, serverId);
        await recordAudit({
          userId: request.user?.id,
          serverId,
          action: "network.subserver_detach",
          details: { networkId: id },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Netzwerk löschen (Proxy entfernen, Subserver freigeben) — nur Admin.
  app.delete(
    "/api/networks/:id",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteNetwork(id);
        await recordAudit({
          userId: request.user?.id,
          action: "network.delete",
          details: { networkId: id },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );
}
