import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../auth.js";
import { recordAudit } from "../audit/service.js";
import { getPlayerProfile, listPlayers, updatePlayerNotes } from "./service.js";

const notesSchema = z.object({ notes: z.string().max(2000) });

export async function playerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  // Alle bekannten Spieler — alle angemeldeten Nutzer.
  app.get("/api/players", async (_request, reply) => {
    return reply.send(await listPlayers());
  });

  // Spieler-Profil — alle angemeldeten Nutzer.
  app.get("/api/players/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    const profile = await getPlayerProfile(key);
    if (!profile) {
      return reply.code(404).send({ error: "not_found", message: "Spieler nicht gefunden" });
    }
    return reply.send(profile);
  });

  // Admin-Notiz setzen — Moderator+.
  app.patch(
    "/api/players/:key",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { key } = request.params as { key: string };
      const parsed = notesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
      }
      const ok = await updatePlayerNotes(key, parsed.data.notes);
      if (!ok) {
        return reply.code(404).send({ error: "not_found", message: "Spieler nicht gefunden" });
      }
      await recordAudit({
        userId: request.user?.id,
        action: "player.notes_update",
        details: { player: key },
      });
      return reply.send(await getPlayerProfile(key));
    },
  );
}
