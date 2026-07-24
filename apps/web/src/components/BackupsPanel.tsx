import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../lib/api.js";
import { confirmDialog } from "../lib/confirm.js";
import { formatBytes, formatDateTime } from "../lib/format.js";

export function BackupsPanel({ serverId }: { serverId: string }) {
  const { t } = useTranslation("backups");
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const key = ["server", serverId, "backups"];

  const { data: backups, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.listBackups(serverId),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: key });

  const createMutation = useMutation({
    mutationFn: () => api.createBackup(serverId),
    onSuccess: invalidate,
  });
  const restoreMutation = useMutation({
    mutationFn: (backupId: string) => api.restoreBackup(serverId, backupId),
  });
  const deleteMutation = useMutation({
    mutationFn: (backupId: string) => api.deleteBackup(serverId, backupId),
    onSuccess: invalidate,
  });

  const onRestore = async (backupId: string) => {
    const ok = await confirmDialog({
      title: t("restoreConfirm.title"),
      message: t("restoreConfirm.message"),
      confirmLabel: t("restoreConfirm.confirmLabel"),
      danger: true,
    });
    if (ok) restoreMutation.mutate(backupId);
  };

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t("title")}</h2>
        {can("MODERATOR") && (
          <div className="flex items-center gap-2">
            <a
              href={api.worldDownloadUrl(serverId)}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
            >
              ↓ {t("downloadWorld")}
            </a>
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="rounded-md bg-status-online px-3 py-1.5 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
            >
              {createMutation.isPending ? t("creating") : t("createNow")}
            </button>
          </div>
        )}
      </div>

      {createMutation.isError && (
        <p className="mb-3 text-sm text-status-error">
          {t("createFailed", { message: (createMutation.error as Error).message })}
        </p>
      )}
      {restoreMutation.isError && (
        <p className="mb-3 text-sm text-status-error">
          {t("restoreFailed", { message: (restoreMutation.error as Error).message })}
        </p>
      )}
      {restoreMutation.isSuccess && (
        <p className="mb-3 text-sm text-status-online">{t("restoreSuccess")}</p>
      )}

      {isLoading ? (
        <p className="text-sm text-neutral-500">{t("loading")}</p>
      ) : !backups || backups.length === 0 ? (
        <p className="text-sm text-neutral-500">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-neutral-800">
          {backups.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate text-neutral-200">{formatDateTime(b.createdAt)}</div>
                <div className="text-xs text-neutral-500">
                  {formatBytes(b.sizeBytes)} ·{" "}
                  {b.trigger === "SCHEDULED" ? t("trigger.scheduled") : t("trigger.manual")}
                </div>
              </div>
              {can("ADMIN") && (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => onRestore(b.id)}
                    disabled={restoreMutation.isPending}
                    className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {t("restore")}
                  </button>
                  <button
                    onClick={() =>
                      void confirmDialog({
                        title: t("deleteConfirm.title"),
                        message: t("deleteConfirm.message"),
                        confirmLabel: t("common:actions.delete"),
                        danger: true,
                      }).then((ok) => ok && deleteMutation.mutate(b.id))
                    }
                    className="rounded-md border border-status-error/40 px-2.5 py-1 text-xs text-status-error hover:bg-status-error/10"
                  >
                    {t("common:actions.delete")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
