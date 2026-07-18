import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import { z } from "zod";
import { authenticate } from "../../auth.js";
import { decryptSecret, encryptSecret } from "../../crypto.js";
import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";
import { generateSecret, otpauthUri, verifyToken } from "./totp.js";

const codeSchema = z.object({ code: z.string().min(6).max(8) });

export async function twoFactorRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  // Status der eigenen 2FA.
  app.get("/api/2fa/status", async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    return reply.send({ enabled: user?.totpEnabled ?? false });
  });

  // Einrichtung starten: neues Secret + QR-Code. Muss anschließend bestätigt werden.
  app.post("/api/2fa/setup", async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user) return reply.code(404).send({ error: "not_found", message: "Unbekannt" });
    if (user.totpEnabled) {
      return reply
        .code(409)
        .send({ error: "already_enabled", message: "2FA ist bereits aktiv – erst deaktivieren" });
    }
    const secret = generateSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecretEnc: encryptSecret(secret), totpEnabled: false },
    });
    const uri = otpauthUri(secret, user.username);
    const qrDataUrl = await QRCode.toDataURL(uri);
    return reply.send({ secret, otpauthUri: uri, qrDataUrl });
  });

  // Einrichtung bestätigen: Code gegen das ausstehende Secret prüfen → aktivieren.
  app.post("/api/2fa/enable", async (request, reply) => {
    const parsed = codeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Code erforderlich" });
    }
    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user?.totpSecretEnc) {
      return reply.code(400).send({ error: "no_setup", message: "Keine Einrichtung offen" });
    }
    if (user.totpEnabled) {
      return reply.code(409).send({ error: "already_enabled", message: "Bereits aktiv" });
    }
    if (!verifyToken(decryptSecret(user.totpSecretEnc), parsed.data.code)) {
      return reply.code(400).send({ error: "invalid_code", message: "Code ungültig" });
    }
    await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
    await recordAudit({ userId: user.id, action: "2fa.enable" });
    return reply.send({ enabled: true });
  });

  // Deaktivieren: erfordert einen gültigen Code.
  app.post("/api/2fa/disable", async (request, reply) => {
    const parsed = codeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Code erforderlich" });
    }
    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user?.totpEnabled || !user.totpSecretEnc) {
      return reply.code(400).send({ error: "not_enabled", message: "2FA ist nicht aktiv" });
    }
    if (!verifyToken(decryptSecret(user.totpSecretEnc), parsed.data.code)) {
      return reply.code(400).send({ error: "invalid_code", message: "Code ungültig" });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecretEnc: null, totpEnabled: false },
    });
    await recordAudit({ userId: user.id, action: "2fa.disable" });
    return reply.send({ enabled: false });
  });
}
