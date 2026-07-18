import type { ScheduledTaskDto, TaskAction } from "@minecontrol/shared";
import { TASK_ACTIONS } from "@minecontrol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../lib/api.js";
import { formatDateTime } from "../lib/format.js";

const ACTION_LABELS: Record<TaskAction, string> = {
  RESTART: "Neustart",
  COMMAND: "Befehl",
  BACKUP: "Backup",
};

const CRON_PRESETS: [string, string][] = [
  ["0 4 * * *", "täglich 4 Uhr"],
  ["0 */6 * * *", "alle 6 h"],
  ["*/30 * * * *", "alle 30 min"],
];

const inputClass =
  "w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none focus:border-status-online";

export function TasksPanel({ serverId }: { serverId: string }) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const key = ["server", serverId, "tasks"];

  const { data: tasks, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.listTasks(serverId),
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: key });

  const createMutation = useMutation({
    mutationFn: (body: Parameters<typeof api.createTask>[1]) =>
      api.createTask(serverId, body),
    onSuccess: invalidate,
  });
  const toggleMutation = useMutation({
    mutationFn: (t: ScheduledTaskDto) =>
      api.updateTask(serverId, t.id, { enabled: !t.enabled }),
    onSuccess: invalidate,
  });
  const runMutation = useMutation({
    mutationFn: (taskId: string) => api.runTask(serverId, taskId),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => api.deleteTask(serverId, taskId),
    onSuccess: invalidate,
  });

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="mb-3 font-semibold">Zeitpläne</h2>

      {isLoading ? (
        <p className="text-sm text-neutral-500">Lade Zeitpläne…</p>
      ) : !tasks || tasks.length === 0 ? (
        <p className="text-sm text-neutral-500">Noch keine geplanten Aufgaben.</p>
      ) : (
        <ul className="mb-4 divide-y divide-neutral-800">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-neutral-200">{t.name}</span>
                  <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                    {ACTION_LABELS[t.action]}
                  </span>
                  {!t.enabled && <span className="text-xs text-neutral-600">pausiert</span>}
                </div>
                <div className="text-xs text-neutral-500">
                  <code>{t.cron}</code>
                  {t.action === "COMMAND" && t.payload?.command
                    ? ` · /${String(t.payload.command)}`
                    : ""}
                  {t.lastRunAt ? ` · zuletzt ${formatDateTime(t.lastRunAt)}` : ""}
                </div>
                {t.lastError && (
                  <div className="text-xs text-status-error">Fehler: {t.lastError}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {can("MODERATOR") && (
                  <button
                    onClick={() => runMutation.mutate(t.id)}
                    disabled={runMutation.isPending}
                    className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Jetzt
                  </button>
                )}
                {can("ADMIN") && (
                  <>
                    <button
                      onClick={() => toggleMutation.mutate(t)}
                      className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:bg-neutral-800"
                    >
                      {t.enabled ? "Pause" : "Aktiv"}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Zeitplan „${t.name}" löschen?`)) deleteMutation.mutate(t.id);
                      }}
                      className="rounded-md border border-status-error/40 px-2.5 py-1 text-xs text-status-error hover:bg-status-error/10"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {can("ADMIN") && (
        <TaskForm
          pending={createMutation.isPending}
          error={createMutation.isError ? (createMutation.error as Error).message : null}
          onCreate={(body) => createMutation.mutate(body)}
        />
      )}
    </section>
  );
}

function TaskForm({
  onCreate,
  pending,
  error,
}: {
  onCreate: (body: Parameters<typeof api.createTask>[1]) => void;
  pending: boolean;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 4 * * *");
  const [action, setAction] = useState<TaskAction>("RESTART");
  const [command, setCommand] = useState("");
  const [retention, setRetention] = useState(7);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const payload =
      action === "COMMAND"
        ? { command: command.trim() }
        : action === "BACKUP"
          ? { retention }
          : undefined;
    onCreate({ name: name.trim(), cron: cron.trim(), action, payload });
    setName("");
    setCommand("");
  };

  return (
    <form onSubmit={onSubmit} className="border-t border-neutral-800 pt-4">
      <h3 className="mb-2 text-sm font-medium text-neutral-300">Neuer Zeitplan</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Name (z. B. Nächtlicher Restart)"
          className={inputClass}
        />
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as TaskAction)}
          className={inputClass}
        >
          {TASK_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a]}
            </option>
          ))}
        </select>
        <div className="sm:col-span-2">
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            required
            placeholder="Cron (Min Std Tag Monat Wochentag)"
            className={`${inputClass} font-mono`}
          />
          <div className="mt-1 flex flex-wrap gap-1">
            {CRON_PRESETS.map(([expr, label]) => (
              <button
                key={expr}
                type="button"
                onClick={() => setCron(expr)}
                className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400 hover:text-neutral-200"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {action === "COMMAND" && (
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            required
            placeholder="Befehl (z. B. say Neustart in 5 Min)"
            className={`${inputClass} sm:col-span-2 font-mono`}
          />
        )}
        {action === "BACKUP" && (
          <label className="flex items-center gap-2 text-sm text-neutral-400 sm:col-span-2">
            Aufbewahrung:
            <input
              type="number"
              min={1}
              max={100}
              value={retention}
              onChange={(e) => setRetention(Number(e.target.value))}
              className={`${inputClass} w-20`}
            />
            Backups
          </label>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-status-error">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="mt-3 rounded-md bg-status-online px-4 py-1.5 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Erstelle…" : "Zeitplan anlegen"}
      </button>
    </form>
  );
}
