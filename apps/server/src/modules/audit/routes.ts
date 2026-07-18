import type { AuditEntryDto } from "@minecontrol/shared";
import type { FastifyInstance } from "fastify";
import { authenticate, requireRole } from "../../auth.js";
import { prisma } from "../../db.js";

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  // Audit-Log ist nur für Admins sichtbar.
  app.get(
    "/api/audit",
    { preHandler: [authenticate, requireRole("ADMIN")] },
    async (_request, reply) => {
      const entries = await prisma.auditLog.findMany({
        orderBy: { timestamp: "desc" },
        take: 200,
        include: { user: true, server: true },
      });
      const body: AuditEntryDto[] = entries.map((e) => ({
        id: e.id,
        username: e.user?.username ?? "System",
        serverName: e.server?.name,
        action: e.action,
        details: e.details ? (JSON.parse(e.details) as Record<string, unknown>) : undefined,
        timestamp: e.timestamp.toISOString(),
      }));
      return reply.send(body);
    },
  );
}
