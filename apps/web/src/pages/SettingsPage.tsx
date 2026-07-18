import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../lib/api.js";

export function SettingsPage() {
  const { can } = useAuth();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold">Einstellungen</h1>
      {can("ADMIN") ? (
        <NotificationSettings />
      ) : (
        <p className="text-sm text-neutral-500">
          Einstellungen können nur von Administratoren geändert werden.
        </p>
      )}
    </div>
  );
}

function NotificationSettings() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings", "notifications"],
    queryFn: api.getNotificationSettings,
  });

  const [webhookUrl, setWebhookUrl] = useState("");
  const [clearWebhook, setClearWebhook] = useState(false);
  const [serverDown, setServerDown] = useState(true);
  const [backupFailed, setBackupFailed] = useState(true);
  const [taskFailed, setTaskFailed] = useState(true);

  useEffect(() => {
    if (data) {
      setServerDown(data.notifyServerDown);
      setBackupFailed(data.notifyBackupFailed);
      setTaskFailed(data.notifyTaskFailed);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateNotificationSettings({
        discordWebhookUrl: clearWebhook ? "" : webhookUrl.trim() || undefined,
        notifyServerDown: serverDown,
        notifyBackupFailed: backupFailed,
        notifyTaskFailed: taskFailed,
      }),
    onSuccess: () => {
      setWebhookUrl("");
      setClearWebhook(false);
      void queryClient.invalidateQueries({ queryKey: ["settings", "notifications"] });
    },
  });

  const testMutation = useMutation({ mutationFn: api.testNotification });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    saveMutation.mutate();
  };

  const configured = data?.discordConfigured ?? false;
  const inputClass =
    "w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-status-online";

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-1 font-semibold">Discord-Benachrichtigungen</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Sendet Meldungen an einen Discord-Webhook, z. B. wenn ein Server offline geht
        oder ein Backup fehlschlägt.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-neutral-400">
            Webhook-URL{" "}
            {configured && !clearWebhook && (
              <span className="text-xs text-status-online">(konfiguriert)</span>
            )}
          </label>
          <input
            type="password"
            value={webhookUrl}
            disabled={clearWebhook}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder={configured ? "•••••••• (unverändert lassen)" : "https://discord.com/api/webhooks/…"}
            className={`${inputClass} ${clearWebhook ? "opacity-50" : ""}`}
          />
          {configured && (
            <label className="mt-1.5 flex items-center gap-2 text-xs text-neutral-400">
              <input
                type="checkbox"
                checked={clearWebhook}
                onChange={(e) => setClearWebhook(e.target.checked)}
                className="size-3.5 accent-status-error"
              />
              Webhook entfernen
            </label>
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm text-neutral-400">Bei welchen Ereignissen?</legend>
          <Toggle label="Server geht offline" checked={serverDown} onChange={setServerDown} />
          <Toggle label="Backup fehlgeschlagen" checked={backupFailed} onChange={setBackupFailed} />
          <Toggle label="Geplante Aufgabe fehlgeschlagen" checked={taskFailed} onChange={setTaskFailed} />
        </fieldset>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="rounded-md bg-status-online px-4 py-2 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
          >
            {saveMutation.isPending ? "Speichern…" : "Speichern"}
          </button>
          <button
            type="button"
            onClick={() => testMutation.mutate()}
            disabled={!configured || testMutation.isPending}
            className="rounded-md border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50"
          >
            Testnachricht senden
          </button>
          {saveMutation.isSuccess && (
            <span className="text-sm text-status-online">Gespeichert.</span>
          )}
          {testMutation.isSuccess && (
            <span className="text-sm text-status-online">Gesendet – prüfe Discord.</span>
          )}
          {testMutation.isError && (
            <span className="text-sm text-status-error">
              {(testMutation.error as Error).message}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-status-online"
      />
      {label}
    </label>
  );
}
