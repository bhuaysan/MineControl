import type { LifecycleAction, ServerDto } from "@minecontrol/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { serversQueryKey } from "../hooks/useServers.js";

/**
 * Start/Stop/Restart/Kill-Buttons. Zeigt nur die für den aktuellen Zustand &
 * die Fähigkeiten des Servers sinnvollen Aktionen. Nach der Aktion werden die
 * Server-Queries invalidiert; den echten Zustand liefert das WS-Status-Event.
 */
export function ServerActions({ server }: { server: ServerDto }) {
  const queryClient = useQueryClient();
  const caps = server.capabilities;
  const state = server.status.state;

  const mutation = useMutation({
    mutationFn: (action: LifecycleAction) => api.lifecycleAction(server.id, action),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["server", server.id] });
      void queryClient.invalidateQueries({ queryKey: serversQueryKey });
    },
  });

  const run = (action: LifecycleAction, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
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
          onClick={() => run("stop", `Server „${server.name}" stoppen?`)}
          disabled={busy}
          className={`${base} border-neutral-700 text-neutral-200 hover:bg-neutral-800`}
        >
          ⏻ Stop
        </button>
      )}
      {isDocker && running && (
        <button
          onClick={() => run("restart", `Server „${server.name}" neu starten?`)}
          disabled={busy}
          className={`${base} border-neutral-700 text-neutral-200 hover:bg-neutral-800`}
        >
          ⟳ Neustart
        </button>
      )}
      {isDocker && running && (
        <button
          onClick={() =>
            run("kill", `Server „${server.name}" hart killen? (Datenverlust möglich)`)
          }
          disabled={busy}
          className={`${base} border-status-error/40 text-status-error hover:bg-status-error/10`}
        >
          ✕ Kill
        </button>
      )}
      {busy && <span className="text-xs text-neutral-500">…</span>}
    </div>
  );
}
