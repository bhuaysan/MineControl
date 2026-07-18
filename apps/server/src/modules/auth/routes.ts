import type { LoginRequest, MeResponse } from "@minecontrol/shared";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SESSION_COOKIE, config } from "../../config.js";
import { prisma } from "../../db.js";
import { authenticate } from "../../auth.js";
import { recordAudit } from "../audit/service.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "Benutzername und Passwort erforderlich" });
    }
    const { username, password } = parsed.data satisfies LoginRequest;

    const user = await prisma.user.findUnique({ where: { username } });
    // Gegen Timing-Angriffe: bei fehlendem User trotzdem verifizieren.
    const hash =
      user?.passwordHash ??
      "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const ok = await argon2.verify(hash, password).catch(() => false);

    if (!user || !ok) {
      return reply
        .code(401)
        .send({ error: "unauthorized", message: "Ungültige Anmeldedaten" });
    }

    reply.setCookie(SESSION_COOKIE, user.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProduction,
      signed: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 Tage
    });

    await recordAudit({ userId: user.id, action: "auth.login" });

    const body: MeResponse = { id: user.id, username: user.username, role: user.role };
    return reply.send(body);
  });

  app.post("/api/logout", { preHandler: authenticate }, async (request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    await recordAudit({ userId: request.user?.id, action: "auth.logout" });
    return reply.send({ ok: true });
  });

  app.get("/api/me", { preHandler: authenticate }, async (request, reply) => {
    const body: MeResponse = request.user!;
    return reply.send(body);
  });
}
