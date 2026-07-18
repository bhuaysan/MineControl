import type { Server, ScheduledTask } from "@prisma/client";
import type { ScheduledTaskDto, TaskAction } from "@minecontrol/shared";
import cron from "node-cron";
import { createAdapter } from "../../adapters/registry.js";
import { prisma } from "../../db.js";
import {
  broadcastServerStatus,
  reattachServerStreams,
} from "../../ws/index.js";
import { recordAudit } from "../audit/service.js";
import { createBackup } from "../backups/service.js";
import { notifyTaskFailed } from "../notifications/service.js";

type CronHandle = ReturnType<typeof cron.schedule>;

/** Aktive cron-Handles je Task-ID. */
const handles = new Map<string, CronHandle>();

export function isValidCron(expression: string): boolean {
  return cron.validate(expression);
}

function parsePayload(task: ScheduledTask): Record<string, unknown> | undefined {
  if (!task.payload) return undefined;
  try {
    return JSON.parse(task.payload) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function toTaskDto(task: ScheduledTask): ScheduledTaskDto {
  return {
    id: task.id,
    serverId: task.serverId,
    name: task.name,
    cron: task.cron,
    action: task.action as TaskAction,
    payload: parsePayload(task),
    enabled: task.enabled,
    lastRunAt: task.lastRunAt?.toISOString(),
    lastError: task.lastError ?? undefined,
    createdAt: task.createdAt.toISOString(),
  };
}

/** Führt die Aktion eines Tasks aus (aus cron oder manuell „jetzt ausführen"). */
export async function runTask(taskId: string): Promise<void> {
  const task = await prisma.scheduledTask.findUnique({ where: { id: taskId } });
  if (!task) return;
  const server = await prisma.server.findUnique({ where: { id: task.serverId } });
  if (!server) return;

  try {
    await executeAction(task, server);
    await prisma.scheduledTask.update({
      where: { id: task.id },
      data: { lastRunAt: new Date(), lastError: null },
    });
    await recordAudit({
      serverId: server.id,
      action: `task.run.${task.action.toLowerCase()}`,
      details: { task: task.name },
    });
  } catch (err) {
    const message = (err as Error).message;
    await prisma.scheduledTask.update({
      where: { id: task.id },
      data: { lastRunAt: new Date(), lastError: message },
    });
    await notifyTaskFailed(task.name, server.name, message);
    console.error(`Task „${task.name}" fehlgeschlagen:`, err);
  }
}

async function executeAction(task: ScheduledTask, server: Server): Promise<void> {
  const payload = parsePayload(task) ?? {};
  const adapter = createAdapter(server);
  switch (task.action as TaskAction) {
    case "RESTART":
      await adapter.restart();
      reattachServerStreams(server.id);
      void broadcastServerStatus(server.id);
      break;
    case "COMMAND": {
      const command = typeof payload.command === "string" ? payload.command : "";
      if (!command) throw new Error("Kein Befehl konfiguriert");
      await adapter.sendCommand(command);
      break;
    }
    case "BACKUP": {
      const retention =
        typeof payload.retention === "number" ? payload.retention : undefined;
      await createBackup(server, "SCHEDULED", retention);
      break;
    }
  }
}

/** Registriert den cron-Job eines Tasks (ersetzt einen bestehenden). */
export function scheduleTask(task: ScheduledTask): void {
  unscheduleTask(task.id);
  if (!task.enabled || !cron.validate(task.cron)) return;
  const handle = cron.schedule(task.cron, () => void runTask(task.id));
  handles.set(task.id, handle);
}

export function unscheduleTask(taskId: string): void {
  const handle = handles.get(taskId);
  if (handle) {
    handle.stop();
    handles.delete(taskId);
  }
}

/** Lädt beim Start alle aktiven Tasks und registriert ihre cron-Jobs. */
export async function startScheduler(): Promise<void> {
  const tasks = await prisma.scheduledTask.findMany({ where: { enabled: true } });
  for (const task of tasks) scheduleTask(task);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function listTasks(serverId: string): Promise<ScheduledTaskDto[]> {
  const tasks = await prisma.scheduledTask.findMany({
    where: { serverId },
    orderBy: { createdAt: "asc" },
  });
  return tasks.map(toTaskDto);
}

export async function createTask(
  serverId: string,
  input: {
    name: string;
    cron: string;
    action: TaskAction;
    payload?: Record<string, unknown>;
    enabled?: boolean;
  },
): Promise<ScheduledTaskDto> {
  const task = await prisma.scheduledTask.create({
    data: {
      serverId,
      name: input.name,
      cron: input.cron,
      action: input.action,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      enabled: input.enabled ?? true,
    },
  });
  scheduleTask(task);
  return toTaskDto(task);
}

export async function updateTask(
  taskId: string,
  input: {
    name?: string;
    cron?: string;
    payload?: Record<string, unknown>;
    enabled?: boolean;
  },
): Promise<ScheduledTaskDto> {
  const task = await prisma.scheduledTask.update({
    where: { id: taskId },
    data: {
      name: input.name,
      cron: input.cron,
      payload: input.payload ? JSON.stringify(input.payload) : undefined,
      enabled: input.enabled,
    },
  });
  scheduleTask(task); // re-registriert bzw. entfernt (falls disabled) den Job.
  return toTaskDto(task);
}

export async function deleteTask(taskId: string): Promise<void> {
  unscheduleTask(taskId);
  await prisma.scheduledTask.delete({ where: { id: taskId } });
}
