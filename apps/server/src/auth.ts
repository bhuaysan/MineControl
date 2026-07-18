import type { Role } from "@minecontrol/shared";
import { hasRole } from "@minecontrol/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SESSION_COOKIE } from "./config.js";
import { prisma } from "./db.js";

/** Im Request abgelegter, authentifizierter Benutzer. */
export interface AuthUser {
  id: string;
  username: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/**
 * preHandler: lädt den User aus dem signierten Session-Cookie.
 * Antwortet mit 401, wenn kein gültiger Login vorliegt.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) {
    return reply.code(401).send({ error: "unauthorized", message: "Nicht angemeldet" });
  }
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) {
    return reply.code(401).send({ error: "unauthorized", message: "Sitzung ungültig" });
  }
  const user = await prisma.user.findUnique({ where: { id: unsigned.value } });
  if (!user) {
    return reply.code(401).send({ error: "unauthorized", message: "Sitzung ungültig" });
  }
  request.user = { id: user.id, username: user.username, role: user.role };
}

/**
 * Erzeugt einen preHandler, der zusätzlich eine Mindestrolle verlangt.
 * Muss nach `authenticate` laufen.
 */
export function requireRole(required: Role) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      return reply.code(401).send({ error: "unauthorized", message: "Nicht angemeldet" });
    }
    if (!hasRole(request.user.role, required)) {
      return reply
        .code(403)
        .send({ error: "forbidden", message: "Keine Berechtigung für diese Aktion" });
    }
  };
}
