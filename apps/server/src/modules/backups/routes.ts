import type { FastifyInstance } from "fastify";
import { authenticate, requireRole } from "../../auth.js";
import { prisma } from "../../db.js";
import { suppressDownAlert } from "../metrics/service.js";
import { notifyBackupFailed } from "../notifications/service.js";
import { recordAudit } from "../audit/service.js";
import {
  createBackup,
  deleteBackup,
  listBackups,
  restoreBackup,
} from "./service.js";

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  // Backups auflisten — alle angemeldeten Nutzer.
  app.get("/api/servers/:id/backups", async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) {
      return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
    }
    return reply.send(await listBackups(id));
  });

  // Backup erstellen — Moderator+.
  app.post(
    "/api/servers/:id/backups",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const server = await prisma.server.findUnique({ where: { id } });
      if (!server) {
        return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
      }
      if (server.type !== "DOCKER") {
        return reply
          .code(422)
          .send({ error: "unsupported", message: "Backups nur für Docker-Server" });
      }
      try {
        const backup = await createBackup(server, "MANUAL");
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "backup.create",
          details: { backupId: backup.id, sizeBytes: backup.sizeBytes },
        });
        return reply.code(201).send(backup);
      } catch (err) {
        const message = (err as Error).message;
        void notifyBackupFailed(server.name, message);
        return reply.code(500).send({ error: "backup_failed", message });
      }
    },
  );

  // Backup zurückspielen — nur Admin (destruktiv).
  app.post(
    "/api/servers/:id/backups/:backupId/restore",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id, backupId } = request.params as { id: string; backupId: string };
      const server = await prisma.server.findUnique({ where: { id } });
      if (!server) {
        return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
      }
      try {
        suppressDownAlert(server.id); // Stop/Start beim Restore ist erwartet.
        await restoreBackup(server, backupId);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "backup.restore",
          details: { backupId },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(500).send({ error: "restore_failed", message: (err as Error).message });
      }
    },
  );

  // Backup löschen — nur Admin.
  app.delete(
    "/api/servers/:id/backups/:backupId",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id, backupId } = request.params as { id: string; backupId: string };
      const server = await prisma.server.findUnique({ where: { id } });
      if (!server) {
        return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
      }
      try {
        await deleteBackup(server, backupId);
        await recordAudit({
          userId: request.user?.id,
          serverId: server.id,
          action: "backup.delete",
          details: { backupId },
        });
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(404).send({ error: "not_found", message: (err as Error).message });
      }
    },
  );
}
