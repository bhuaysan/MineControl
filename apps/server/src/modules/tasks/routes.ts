import { TASK_ACTIONS } from "@minecontrol/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../auth.js";
import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";
import {
  createTask,
  deleteTask,
  isValidCron,
  listTasks,
  runTask,
  updateTask,
} from "./service.js";

const payloadSchema = z.record(z.string(), z.unknown()).optional();

const createSchema = z.object({
  name: z.string().min(1).max(64),
  cron: z.string().min(1).refine(isValidCron, "Ungültiger Cron-Ausdruck"),
  action: z.enum(TASK_ACTIONS),
  payload: payloadSchema,
  enabled: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  cron: z.string().min(1).refine(isValidCron, "Ungültiger Cron-Ausdruck").optional(),
  payload: payloadSchema,
  enabled: z.boolean().optional(),
});

async function serverExists(id: string): Promise<boolean> {
  return (await prisma.server.count({ where: { id } })) > 0;
}

async function taskBelongsToServer(taskId: string, serverId: string): Promise<boolean> {
  return (await prisma.scheduledTask.count({ where: { id: taskId, serverId } })) > 0;
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  // Tasks auflisten — alle angemeldeten Nutzer.
  app.get("/api/servers/:id/tasks", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await serverExists(id))) {
      return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
    }
    return reply.send(await listTasks(id));
  });

  // Task anlegen — nur Admin.
  app.post(
    "/api/servers/:id/tasks",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!(await serverExists(id))) {
        return reply.code(404).send({ error: "not_found", message: "Server nicht gefunden" });
      }
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "bad_request", message: parsed.error.issues[0]?.message ?? "Ungültig" });
      }
      const task = await createTask(id, parsed.data);
      await recordAudit({
        userId: request.user?.id,
        serverId: id,
        action: "task.create",
        details: { name: task.name, action: task.action, cron: task.cron },
      });
      return reply.code(201).send(task);
    },
  );

  // Task ändern — nur Admin.
  app.patch(
    "/api/servers/:id/tasks/:taskId",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id, taskId } = request.params as { id: string; taskId: string };
      if (!(await taskBelongsToServer(taskId, id))) {
        return reply.code(404).send({ error: "not_found", message: "Task nicht gefunden" });
      }
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "bad_request", message: parsed.error.issues[0]?.message ?? "Ungültig" });
      }
      const task = await updateTask(taskId, parsed.data);
      await recordAudit({
        userId: request.user?.id,
        serverId: id,
        action: "task.update",
        details: { name: task.name },
      });
      return reply.send(task);
    },
  );

  // Task löschen — nur Admin.
  app.delete(
    "/api/servers/:id/tasks/:taskId",
    { preHandler: requireRole("ADMIN") },
    async (request, reply) => {
      const { id, taskId } = request.params as { id: string; taskId: string };
      if (!(await taskBelongsToServer(taskId, id))) {
        return reply.code(404).send({ error: "not_found", message: "Task nicht gefunden" });
      }
      await deleteTask(taskId);
      await recordAudit({ userId: request.user?.id, serverId: id, action: "task.delete" });
      return reply.send({ ok: true });
    },
  );

  // Task sofort ausführen — Moderator+.
  app.post(
    "/api/servers/:id/tasks/:taskId/run",
    { preHandler: requireRole("MODERATOR") },
    async (request, reply) => {
      const { id, taskId } = request.params as { id: string; taskId: string };
      if (!(await taskBelongsToServer(taskId, id))) {
        return reply.code(404).send({ error: "not_found", message: "Task nicht gefunden" });
      }
      await runTask(taskId);
      const task = (await listTasks(id)).find((t) => t.id === taskId);
      return reply.send(task);
    },
  );
}
