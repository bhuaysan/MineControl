import type { UserDto } from "@minecontrol/shared";
import { ROLES } from "@minecontrol/shared";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../auth.js";
import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";

const usernameSchema = z.string().regex(/^[A-Za-z0-9_.-]{3,32}$/);
const passwordSchema = z.string().min(8).max(200);

const createUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(ROLES),
});

const updateUserSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    password: passwordSchema.optional(),
  })
  .refine((v) => v.role !== undefined || v.password !== undefined, {
    message: "Nichts zu ändern",
  });

function toDto(user: {
  id: string;
  username: string;
  role: UserDto["role"];
  createdAt: Date;
}): UserDto {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Anzahl der Admins — für die „letzter Admin"-Schutzregeln. */
function countAdmins(): Promise<number> {
  return prisma.user.count({ where: { role: "ADMIN" } });
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // Gesamte Benutzerverwaltung nur für Admins.
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/api/users", async (_request, reply) => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
    return reply.send(users.map(toDto));
  });

  app.post("/api/users", async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "Ungültige Eingabe (Name ≥3, Passwort ≥8)" });
    }
    const { username, password, role } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return reply
        .code(409)
        .send({ error: "conflict", message: "Benutzername ist bereits vergeben" });
    }

    const user = await prisma.user.create({
      data: { username, role, passwordHash: await argon2.hash(password) },
    });
    await recordAudit({
      userId: request.user?.id,
      action: "user.create",
      details: { username, role },
    });
    return reply.code(201).send(toDto(user));
  });

  app.patch("/api/users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
    }
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      return reply.code(404).send({ error: "not_found", message: "Benutzer nicht gefunden" });
    }

    // Den letzten Admin nicht degradieren.
    if (
      parsed.data.role &&
      parsed.data.role !== "ADMIN" &&
      target.role === "ADMIN" &&
      (await countAdmins()) <= 1
    ) {
      return reply
        .code(409)
        .send({ error: "conflict", message: "Der letzte Admin kann nicht degradiert werden" });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(parsed.data.role ? { role: parsed.data.role } : {}),
        ...(parsed.data.password
          ? { passwordHash: await argon2.hash(parsed.data.password) }
          : {}),
      },
    });
    await recordAudit({
      userId: request.user?.id,
      action: "user.update",
      details: {
        username: target.username,
        roleChanged: parsed.data.role ?? null,
        passwordReset: Boolean(parsed.data.password),
      },
    });
    return reply.send(toDto(updated));
  });

  app.delete("/api/users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.user?.id) {
      return reply
        .code(409)
        .send({ error: "conflict", message: "Man kann sich nicht selbst löschen" });
    }
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      return reply.code(404).send({ error: "not_found", message: "Benutzer nicht gefunden" });
    }
    if (target.role === "ADMIN" && (await countAdmins()) <= 1) {
      return reply
        .code(409)
        .send({ error: "conflict", message: "Der letzte Admin kann nicht gelöscht werden" });
    }

    await prisma.user.delete({ where: { id } });
    await recordAudit({
      userId: request.user?.id,
      action: "user.delete",
      details: { username: target.username },
    });
    return reply.send({ ok: true });
  });
}
