import type { LifecycleAction, ServerDto } from "@minecontrol/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api.js";
import { useAuth } from "../auth/AuthContext.js";
import { serversQueryKey } from "../hooks/useServers.js";
import { confirmDialog } from "../lib/confirm.js";
import { toast } from "../lib/toast.js";

/**
 * Start/Stop/Restart/Kill-Buttons. Zeigt nur die für den aktuellen Zustand &
 * die Fähigkeiten des Servers sinnvollen Aktionen. Nach der Aktion werden die
 * Server-Queries invalidiert; den echten Zustand liefert das WS-Status-Event.
 */
export function ServerActions({ server }: { server: ServerDto }) {
  const { t } = useTranslation("serverActions");
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
    onSuccess: (_data, action) => toast.success(t(`toast.${action}`)),
    onSettled: invalidate,
  });

  const autoRestartMutation = useMutation({
    mutationFn: (enabled: boolean) => api.setAutoRestart(server.id, enabled),
    onSuccess: (_data, enabled) =>
      toast.success(enabled ? t("toast.autoRestartEnabled") : t("toast.autoRestartDisabled")),
    onSettled: invalidate,
  });

  const run = async (
    action: LifecycleAction,
    confirmOpts?: { message: string; danger?: boolean },
  ) => {
    if (confirmOpts && !(await confirmDialog({ ...confirmOpts, confirmLabel: t("continue") }))) {
      return;
    }
    mutation.mutate(action);
  };

  const canStart = caps.includes("LIFECYCLE_START");
  const canStop = caps.includes("LIFECYCLE_STOP");
  const isDocker = server.type === "DOCKER";
  const running = state === "ONLINE" || state === "STARTING";
  const busy = mutation.isPending || state === "STARTING" || state === "STOPPING";

  const base = "rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canStart && !running && (
        <button
          onClick={() => run("start")}
          disabled={busy}
          className={`${base} border-status-online/40 text-status-online hover:bg-status-online/10`}
        >
          ▶ {t("start")}
        </button>
      )}
      {canStop && running && (
        <button
          onClick={() =>
            void run("stop", {
              message: t("confirmStop", { name: server.name }),
            })
          }
          disabled={busy}
          className={`${base} border-neutral-700 text-neutral-200 hover:bg-neutral-800`}
        >
          ⏻ {t("stop")}
        </button>
      )}
      {isDocker && running && (
        <button
          onClick={() =>
            void run("restart", { message: t("confirmRestart", { name: server.name }) })
          }
          disabled={busy}
          className={`${base} border-neutral-700 text-neutral-200 hover:bg-neutral-800`}
        >
          ⟳ {t("restart")}
        </button>
      )}
      {isDocker && running && (
        <button
          onClick={() =>
            void run("kill", {
              message: t("confirmKill", { name: server.name }),
              danger: true,
            })
          }
          disabled={busy}
          className={`${base} border-status-error/40 text-status-error hover:bg-status-error/10`}
        >
          ✕ {t("kill")}
        </button>
      )}
      {busy && <span className="text-xs text-neutral-500">…</span>}
      {isDocker && can("ADMIN") && (
        <label
          className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-neutral-300"
          title={t("autoRestartTitle")}
        >
          <input
            type="checkbox"
            checked={server.autoRestart}
            disabled={autoRestartMutation.isPending}
            onChange={(e) => autoRestartMutation.mutate(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-600 bg-neutral-800"
          />
          {t("autoRestart")}
        </label>
      )}
    </div>
  );
}
