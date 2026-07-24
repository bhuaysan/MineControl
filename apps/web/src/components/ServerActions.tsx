import type { LifecycleAction, ServerDto } from "@minecontrol/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useAuth } from "../auth/AuthContext.js";
import { serversQueryKey } from "../hooks/useServers.js";
import { confirmDialog } from "../lib/confirm.js";
import { toast } from "../lib/toast.js";

/** Nutzerlesbare Rückmeldung je Lifecycle-Aktion (Erfolgs-Toast). */
const ACTION_LABEL: Record<LifecycleAction, string> = {
  start: "Server wird gestartet",
  stop: "Server wird gestoppt",
  restart: "Server wird neu gestartet",
  kill: "Server wird hart beendet",
};

/**
 * Start/Stop/Restart/Kill-Buttons. Zeigt nur die für den aktuellen Zustand &
 * die Fähigkeiten des Servers sinnvollen Aktionen. Nach der Aktion werden die
 * Server-Queries invalidiert; den echten Zustand liefert das WS-Status-Event.
 */
export function ServerActions({ server }: { server: ServerDto }) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const caps = server.capabilities;
  const state = server.status.state;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["server", server.id] });
    void queryClient.invalidateQueries({ queryKey: serversQueryKey });
  };

  const mutation = useMutation({
    mutationFn: (action: LifecycleAction) => api.lifecycleAction(server.id, action),
    onSuccess: (_data, action) => toast.success(ACTION_LABEL[action]),
    onSettled: invalidate,
  });

  const autoRestartMutation = useMutation({
    mutationFn: (enabled: boolean) => api.setAutoRestart(server.id, enabled),
    onSuccess: (_data, enabled) =>
      toast.success(enabled ? "Auto-Restart aktiviert" : "Auto-Restart deaktiviert"),
    onSettled: invalidate,
  });

  const run = async (
    action: LifecycleAction,
    confirmOpts?: { message: string; danger?: boolean },
  ) => {
    if (confirmOpts && !(await confirmDialog({ ...confirmOpts, confirmLabel: "Fortfahren" }))) {
      return;
    }
    mutation.mutate(action);
  };

  const canStart = caps.includes("LIFECYCLE_START");
  const canStop = caps.includes("LIFECYCLE_STOP");
  const isDocker = server.type === "DOCKER";
  const running = state === "ONLINE" || state === "STARTING";
  const busy = mutation.isPending || state === "STARTING" || state === "STOPPING";

  const base =
    "rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canStart && !running && (
        <button
          onClick={() => run("start")}
          disabled={busy}
          className={`${base} border-status-online/40 text-status-online hover:bg-status-online/10`}
        >
          ▶ Start
        </button>
      )}
      {canStop && running && (
        <button
          onClick={() =>
            void run("stop", {
              message: `Server „${server.name}" wirklich stoppen? Aktive Spieler werden getrennt.`,
            })
          }
          disabled={busy}
          className={`${base} border-neutral-700 text-neutral-200 hover:bg-neutral-800`}
        >
          ⏻ Stop
        </button>
      )}
      {isDocker && running && (
        <button
          onClick={() =>
            void run("restart", { message: `Server „${server.name}" neu starten?` })
          }
          disabled={busy}
          className={`${base} border-neutral-700 text-neutral-200 hover:bg-neutral-800`}
        >
          ⟳ Neustart
        </button>
      )}
      {isDocker && running && (
        <button
          onClick={() =>
            void run("kill", {
              message: `Server „${server.name}" hart killen? Der Container wird sofort beendet — Datenverlust möglich.`,
              danger: true,
            })
          }
          disabled={busy}
          className={`${base} border-status-error/40 text-status-error hover:bg-status-error/10`}
        >
          ✕ Kill
        </button>
      )}
      {busy && <span className="text-xs text-neutral-500">…</span>}
      {isDocker && can("ADMIN") && (
        <label
          className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-neutral-300"
          title="Startet den Container automatisch neu, wenn Minecraft zu lange nicht erreichbar ist (Hänger/Crashloop)."
        >
          <input
            type="checkbox"
            checked={server.autoRestart}
            disabled={autoRestartMutation.isPending}
            onChange={(e) => autoRestartMutation.mutate(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-600 bg-neutral-800"
          />
          Auto-Restart
        </label>
      )}
    </div>
  );
}
