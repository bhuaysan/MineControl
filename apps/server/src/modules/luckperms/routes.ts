import type { Server } from "@prisma/client";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../auth.js";
import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";
import {
  LuckPermsError,
  addUserGroup,
  createGroup,
  deleteGroup,
  getGroup,
  getStatus,
  getUser,
  install,
  listGroups,
  removeUserGroup,
  setGroupMeta,
  setGroupPermission,
  setUserPermission,
  unsetGroupPermission,
  unsetUserPermission,
} from "./service.js";

const groupSchema = z.object({ name: z.string().regex(/^[a-z0-9_-]{1,36}$/) });
const permissionSchema = z.object({
  node: z.string().regex(/^[A-Za-z0-9_.*:\-/#]{1,128}$/),
  value: z.boolean(),
});
const metaSchema = z
  .object({
    prefix: z.string().max(64).optional(),
    suffix: z.string().max(64).optional(),
    weight: z.number().int().min(0).max(10000).optional(),
  })
  .refine((m) => m.prefix !== undefined || m.suffix !== undefined || m.weight !== undefined, {
    message: "Kein Wert angegeben",
  });
const userGroupSchema = z.object({ group: z.string().regex(/^[a-z0-9_-]{1,36}$/) });

async function loadServer(id: string, reply: FastifyReply): Promise<Server | null> {
  const server = await prisma.server.findUnique({ where: { id } });
  if (!server) {
    void reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
    return null;
  }
  return server;
}

function fail(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof LuckPermsError) {
    return reply.code(err.status).send({ error: err.code, message: err.message });
  }
  return reply
    .code(502)
    .send({ error: "luckperms_failed", message: (err as Error).message });
}

export async function luckPermsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  const base = "/api/servers/:id/luckperms";

  // Status — Moderator+.
  app.get(base, { preHandler: requireRole("MODERATOR") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await loadServer(id, reply);
    if (!server) return reply;
    try {
      return reply.send(await getStatus(server));
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Installieren (+ Neustart) — Admin.
  app.post(
    `${base}/install`,
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const server = await loadServer(id, reply);
      if (!server) return reply;
      try {
        const result = await install(server);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "luckperms.install",
        });
        return reply.send(result);
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // ── Gruppen ─────────────────────────────────────────────────────────────────

  app.get(
    `${base}/groups`,
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const server = await loadServer(id, reply);
      if (!server) return reply;
      try {
        return reply.send(await listGroups(server));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.post(
    `${base}/groups`,
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = groupSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültiger Name" });
      }
      const server = await loadServer(id, reply);
      if (!server) return reply;
      try {
        await createGroup(server, parsed.data.name);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "luckperms.group.create",
          details: { name: parsed.data.name },
        });
        return reply.code(201).send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.get(
    `${base}/groups/:name`,
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id, name } = request.params as { id: string; name: string };
      const server = await loadServer(id, reply);
      if (!server) return reply;
      try {
        return reply.send(await getGroup(server, name));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.delete(
    `${base}/groups/:name`,
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id, name } = request.params as { id: string; name: string };
      const server = await loadServer(id, reply);
      if (!server) return reply;
      try {
        await deleteGroup(server, name);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "luckperms.group.delete",
          details: { name },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Gruppen-Berechtigung setzen — Admin.
  app.post(
    `${base}/groups/:name/permission`,
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id, name } = request.params as { id: string; name: string };
      const parsed = permissionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const server = await loadServer(id, reply);
      if (!server) return reply;
      try {
        await setGroupPermission(server, name, parsed.data.node, parsed.data.value);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "luckperms.group.permission.set",
          details: { name, node: parsed.data.node, value: parsed.data.value },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Gruppen-Berechtigung entfernen — Admin.
  app.delete(
    `${base}/groups/:name/permission`,
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id, name } = request.params as { id: string; name: string };
      const { node } = request.query as { node?: string };
      if (!node) return reply.code(400).send({ error: "bad_request", message: "Node fehlt" });
      const server = await loadServer(id, reply);
      if (!server) return reply;
      try {
        await unsetGroupPermission(server, name, node);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "luckperms.group.permission.unset",
          details: { name, node },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Gruppen-Meta (Prefix/Suffix/Weight) — Admin.
  app.post(
    `${base}/groups/:name/meta`,
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id, name } = request.params as { id: string; name: string };
      const parsed = metaSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const server = await loadServer(id, reply);
      if (!server) return reply;
      try {
        await setGroupMeta(server, name, parsed.data);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "luckperms.group.meta",
          details: { name, ...parsed.data },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // ── Spieler ─────────────────────────────────────────────────────────────────

  app.get(
    `${base}/users/:name`,
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id, name } = request.params as { id: string; name: string };
      const server = await loadServer(id, reply);
      if (!server) return reply;
      try {
        return reply.send(await getUser(server, name));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.post(
    `${base}/users/:name/groups`,
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id, name } = request.params as { id: string; name: string };
      const parsed = userGroupSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const server = await loadServer(id, reply);
      if (!server) return reply;
      try {
        await addUserGroup(server, name, parsed.data.group);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "luckperms.user.group.add",
          details: { name, group: parsed.data.group },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.delete(
    `${base}/users/:name/groups/:group`,
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id, name, group } = request.params as {
        id: string;
        name: string;
        group: string;
      };
      const server = await loadServer(id, reply);
      if (!server) return reply;
      try {
        await removeUserGroup(server, name, group);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "luckperms.user.group.remove",
          details: { name, group },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.post(
    `${base}/users/:name/permission`,
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id, name } = request.params as { id: string; name: string };
      const parsed = permissionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const server = await loadServer(id, reply);
      if (!server) return reply;
      try {
        await setUserPermission(server, name, parsed.data.node, parsed.data.value);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "luckperms.user.permission.set",
          details: { name, node: parsed.data.node, value: parsed.data.value },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.delete(
    `${base}/users/:name/permission`,
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id, name } = request.params as { id: string; name: string };
      const { node } = request.query as { node?: string };
      if (!node) return reply.code(400).send({ error: "bad_request", message: "Node fehlt" });
      const server = await loadServer(id, reply);
      if (!server) return reply;
      try {
        await unsetUserPermission(server, name, node);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "luckperms.user.permission.unset",
          details: { name, node },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );
}
