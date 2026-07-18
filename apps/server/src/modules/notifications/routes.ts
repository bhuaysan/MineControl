import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../auth.js";
import { recordAudit } from "../audit/service.js";
import {
  getNotificationSettings,
  sendTestNotification,
  updateNotificationSettings,
} from "./service.js";

const updateSchema = z.object({
  discordWebhookUrl: z
    .string()
    .url()
    .startsWith("https://", "Nur HTTPS-Webhooks erlaubt")
    .or(z.literal(""))
    .optional(),
  notifyServerDown: z.boolean().optional(),
  notifyBackupFailed: z.boolean().optional(),
  notifyTaskFailed: z.boolean().optional(),
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
    async (_request, reply) => {
      const sent = await sendTestNotification();
      if (!sent) {
        return reply
          .code(422)
          .send({ error: "not_configured", message: "Kein Discord-Webhook konfiguriert" });
      }
      return reply.send({ ok: true });
    },
  );
}
