import type { LoginRequest, MeResponse } from "@minecontrol/shared";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SESSION_COOKIE } from "../../config.js";
import { decryptSecret } from "../../crypto.js";
import { prisma } from "../../db.js";
import { authenticate, setSessionCookie } from "../../auth.js";
import { recordAudit } from "../audit/service.js";
import { clearAttempts, isRateLimited, registerFailedAttempt } from "../../rateLimit.js";
import { verifyToken } from "../twofa/totp.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  code: z.string().optional(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "Benutzername und Passwort erforderlich" });
    }
    const { username, password, code } = parsed.data satisfies LoginRequest;

    // Gegen Brute-Force auf Passwort/TOTP: pro Username UND pro IP sperren,
    // damit weder ein gezielter Angriff auf ein Konto noch ein verteilter
    // Angriff über viele Konten von derselben Quelle durchgängig weiterraten kann.
    const userKey = `login:user:${username.toLowerCase()}`;
    const ipKey = `login:ip:${request.ip}`;
    if (isRateLimited(userKey) || isRateLimited(ipKey)) {
      return reply.code(429).send({
        error: "too_many_attempts",
        message: "Zu viele Fehlversuche — bitte später erneut versuchen",
      });
    }
    const registerFailure = (): void => {
      registerFailedAttempt(userKey);
      registerFailedAttempt(ipKey);
    };

    const user = await prisma.user.findUnique({ where: { username } });
    // Gegen Timing-Angriffe: bei fehlendem User trotzdem verifizieren.
    const hash =
      user?.passwordHash ??
      "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const ok = await argon2.verify(hash, password).catch(() => false);

    if (!user || !ok) {
      registerFailure();
      return reply
        .code(401)
        .send({ error: "unauthorized", message: "Ungültige Anmeldedaten" });
    }

    // Zweiter Faktor, falls aktiviert.
    if (user.totpEnabled && user.totpSecretEnc) {
      if (!code) {
        return reply
          .code(401)
          .send({ error: "2fa_required", message: "Bestätigungscode erforderlich" });
      }
      const step = verifyToken(decryptSecret(user.totpSecretEnc), code);
      if (step === null) {
        registerFailure();
        return reply.code(401).send({ error: "2fa_invalid", message: "Code ungültig" });
      }
      // Replay-Schutz: ein Code darf nur einmal genutzt werden. Der akzeptierte
      // Zeitschritt muss echt größer als der zuletzt verbrauchte sein; das
      // atomare updateMany (Bedingung im WHERE) verhindert auch parallele
      // Logins mit demselben Code.
      const claimed = await prisma.user.updateMany({
        where: {
          id: user.id,
          OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
        },
        data: { totpLastStep: step },
      });
      if (claimed.count === 0) {
        registerFailure();
        return reply
          .code(401)
          .send({ error: "2fa_invalid", message: "Code bereits verwendet" });
      }
    }

    clearAttempts(userKey);
    clearAttempts(ipKey);

    setSessionCookie(reply, user);

    await recordAudit({ userId: user.id, action: "auth.login" });

    const body: MeResponse = {
      id: user.id,
      username: user.username,
      role: user.role,
      twoFactorEnabled: user.totpEnabled,
    };
    return reply.send(body);
  });

  app.post("/api/logout", { preHandler: authenticate }, async (request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    await recordAudit({ userId: request.user?.id, action: "auth.logout" });
    return reply.send({ ok: true });
  });

  app.get("/api/me", { preHandler: authenticate }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    const body: MeResponse = {
      ...request.user!,
      twoFactorEnabled: user?.totpEnabled ?? false,
    };
    return reply.send(body);
  });
}
