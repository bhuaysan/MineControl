import type { FastifyInstance } from "fastify";
import { authenticate } from "../../auth.js";
import { prisma } from "../../db.js";
import { getMetricHistory } from "./service.js";

/** Zeitfenster für die Historie → Millisekunden. */
const RANGES: Record<string, number> = {
  "1h": 3_600_000,
  "6h": 21_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
};

export async function metricRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/api/servers/:id/metrics/history", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { range } = request.query as { range?: string };
    if ((await prisma.server.count({ where: { id } })) === 0) {
      return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
    }
    const sinceMs = RANGES[range ?? "6h"] ?? RANGES["6h"]!;
    return reply.send(await getMetricHistory(id, sinceMs));
  });
}
