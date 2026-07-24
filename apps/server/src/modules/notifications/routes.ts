import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../auth.js";
import { recordAudit } from "../audit/service.js";
import {
  getNotificationSettings,
  sendTestNotification,
  updateNotificationSettings,
} from "./service.js";

/**
 * Prüft eine einzelne E-Mail-Angabe, die auch die Anzeigenamen-Form
 * `Name <addr@host>` haben darf (von SMTP-Servern/Nodemailer akzeptiert).
 * Der reine Adressteil in spitzen Klammern wird gegen `z.string().email()`
 * geprüft; ohne Klammern der gesamte String.
 */
function isValidMailbox(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const angle = trimmed.match(/<([^>]+)>\s*$/);
  const address = angle ? angle[1]!.trim() : trimmed;
  return z.string().email().safeParse(address).success;
}

const updateSchema = z.object({
  discordWebhookUrl: z
    .string()
    .url()
    .startsWith("https://", "Nur HTTPS-Webhooks erlaubt")
    .or(z.literal(""))
    .optional(),
  emailSmtpHost: z.string().min(1).optional(),
  emailSmtpPort: z.number().int().min(1).max(65535).optional(),
  emailSmtpSecure: z.boolean().optional(),
  emailSmtpUser: z.string().optional(),
  emailSmtpPassword: z.string().min(1).optional(),
  emailFrom: z.string().refine(isValidMailbox, "Ungültige Absenderadresse").optional(),
  emailTo: z
    .string()
    .refine(
      (v) => v === "" || v.split(",").every((addr) => isValidMailbox(addr)),
      "Ungültige E-Mail-Adresse(n)",
    )
    .optional(),
  notifyServerDown: z.boolean().optional(),
  notifyBackupFailed: z.boolean().optional(),
  notifyTaskFailed: z.boolean().optional(),
  notifyLocale: z.enum(["de", "en"]).optional(),
});

const testSchema = z.object({
  channel: z.enum(["discord", "email"]).default("discord"),
});

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  // Einstellungen lesen — nur Admin.
  app.get(
    "/api/settings/notifications",
    { preHandler: requireRole("ADMIN") },
    async (_request, reply) => reply.send(await getNotificationSettings()),
  );

  // Einstellungen speichern — nur Admin.
  app.put(
    "/api/settings/notifications",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "bad_request", message: parsed.error.issues[0]?.message ?? "Ungültig" });
      }
      const result = await updateNotificationSettings(parsed.data);
      await recordAudit({
        userId: request.user?.id,
        action: "settings.notifications_update",
      });
      return reply.send(result);
    },
  );

  // Testnachricht senden — nur Admin.
  app.post(
    "/api/settings/notifications/test",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const parsed = testSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "bad_request", message: parsed.error.issues[0]?.message ?? "Ungültig" });
      }
      const sent = await sendTestNotification(parsed.data.channel);
      if (!sent) {
        return reply.code(422).send({
          error: "not_configured",
          message:
            parsed.data.channel === "discord"
              ? "Kein Discord-Webhook konfiguriert"
              : "Kein SMTP-Server konfiguriert",
        });
      }
      return reply.send({ ok: true });
    },
  );
}
