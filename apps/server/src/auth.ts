import type { Role } from "@minecontrol/shared";
import { hasRole } from "@minecontrol/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SESSION_COOKIE, config } from "./config.js";
import { prisma } from "./db.js";
import { verifyToken } from "./modules/tokens/service.js";

/**
 * Kodiert die Session-Cookie-Nutzlast als `userId:sessionVersion`. Die Version
 * verankert das Cookie an den Stand zum Ausstellungszeitpunkt — wird sie
 * später erhöht (Passwortänderung, 2FA an/aus), werden alle zu diesem
 * Zeitpunkt ausgestellten Cookies beim nächsten `authenticate()` ungültig.
 */
function encodeSessionValue(userId: string, sessionVersion: number): string {
  return `${userId}:${sessionVersion}`;
}

function decodeSessionValue(raw: string): { userId: string; sessionVersion: number } | null {
  const idx = raw.lastIndexOf(":");
  if (idx === -1) return null;
  const userId = raw.slice(0, idx);
  const sessionVersion = Number(raw.slice(idx + 1));
  if (!userId || !Number.isInteger(sessionVersion)) return null;
  return { userId, sessionVersion };
}

/**
 * Löst den authentifizierten Benutzer aus dem signierten Session-Cookie eines
 * Requests auf — oder `null`, wenn kein/kein gültiges Cookie vorliegt oder die
 * `sessionVersion` nicht mehr passt (widerrufene Sitzung). Gemeinsame Basis für
 * `authenticate` (HTTP) und den WebSocket-Handshake, damit beide dieselbe
 * Cookie-Kodierung (`userId:sessionVersion`) verstehen.
 */
export async function resolveSessionUser(
  request: FastifyRequest,
): Promise<{ id: string; username: string; role: Role; sessionVersion: number } | null> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const decoded = decodeSessionValue(unsigned.value);
  if (!decoded) return null;
  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
  if (!user || user.sessionVersion !== decoded.sessionVersion) return null;
  return user;
}

/** Setzt das signierte Session-Cookie für `user` (Login, oder Neuausstellung
 * nach einer Aktion, die `sessionVersion` erhöht — sonst würde sie die
 * gerade handelnde Sitzung selbst aussperren). */
export function setSessionCookie(
  reply: FastifyReply,
  user: { id: string; sessionVersion: number },
): void {
  reply.setCookie(SESSION_COOKIE, encodeSessionValue(user.id, user.sessionVersion), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    signed: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 Tage
  });
}

/** Im Request abgelegter, authentifizierter Benutzer. */
export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  /** Wie diese Anfrage authentifiziert wurde — steuert z. B. `requireSession`. */
  authMethod: "session" | "token";
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
  // 1) Bearer-Token (Automatisierung) hat Vorrang, falls vorhanden.
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const identity = await verifyToken(authHeader.slice("Bearer ".length).trim());
    if (!identity) {
      return reply.code(401).send({ error: "unauthorized", message: "Token ungültig" });
    }
    // Token handelt im Namen seines Besitzers (für Audit-Zuordnung).
    request.user = {
      id: identity.userId,
      username: identity.username,
      role: identity.role,
      authMethod: "token",
    };
    return;
  }

  // 2) Session-Cookie.
  if (!request.cookies[SESSION_COOKIE]) {
    return reply.code(401).send({ error: "unauthorized", message: "Nicht angemeldet" });
  }
  const user = await resolveSessionUser(request);
  if (!user) {
    return reply
      .code(401)
      .send({ error: "unauthorized", message: "Sitzung ungültig oder widerrufen" });
  }
  request.user = { id: user.id, username: user.username, role: user.role, authMethod: "session" };
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

/**
 * preHandler: sperrt Bearer-Token aus. Für Aktionen, die einen echten,
 * per Passwort/2FA angemeldeten Nutzer voraussetzen (z. B. eigene 2FA-
 * Einstellungen) — ein gestohlenes Automatisierungs-Token darf sie nicht
 * ausführen und so den eigentlichen Besitzer aussperren können.
 * Muss nach `authenticate` laufen.
 */
export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user) {
    return reply.code(401).send({ error: "unauthorized", message: "Nicht angemeldet" });
  }
  if (request.user.authMethod !== "session") {
    return reply.code(403).send({
      error: "forbidden",
      message: "Diese Aktion erfordert eine Anmeldung per Sitzung, kein API-Token",
    });
  }
}
