import { ROLES } from "@minecontrol/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../auth.js";
import { recordAudit } from "../audit/service.js";
import { createToken, listTokens, revokeToken } from "./service.js";

const createSchema = z.object({
  name: z.string().min(1).max(64),
  role: z.enum(ROLES),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/api/tokens", async (_request, reply) => {
    return reply.send(await listTokens());
  });

  app.post("/api/tokens", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: "Ungültige Eingabe" });
    }
    const userId = request.user!.id;
    const { token, dto } = await createToken(
      userId,
      parsed.data.name,
      parsed.data.role,
      parsed.data.expiresInDays,
    );
    await recordAudit({
      userId,
      action: "token.create",
      details: { name: dto.name, role: dto.role },
    });
    return reply.code(201).send({ token, apiToken: dto });
  });

  app.delete("/api/tokens/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = await revokeToken(id);
    if (!ok) {
      return reply.code(404).send({ error: "not_found", message: "Token nicht gefunden" });
    }
    await recordAudit({ userId: request.user?.id, action: "token.revoke", details: { id } });
    return reply.send({ ok: true });
  });
}
