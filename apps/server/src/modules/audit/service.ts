import { prisma } from "../../db.js";

/** Schreibt einen Eintrag ins Audit-Log. Fehler werden geschluckt (best effort). */
export async function recordAudit(params: {
  userId?: string;
  serverId?: string;
  action: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        serverId: params.serverId,
        action: params.action,
        details: params.details ? JSON.stringify(params.details) : null,
      },
    });
  } catch (err) {
    // Audit darf die eigentliche Aktion nie blockieren.
    console.error("Audit-Log konnte nicht geschrieben werden:", err);
  }
}
