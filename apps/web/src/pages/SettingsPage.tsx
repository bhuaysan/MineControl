import type { Role } from "@minecontrol/shared";
import { ROLES } from "@minecontrol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../lib/api.js";
import { formatDateTime, formatRelative } from "../lib/format.js";

export function SettingsPage() {
  const { can } = useAuth();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Einstellungen</h1>
      <TwoFactorSettings />
      {can("ADMIN") && (
        <>
          <NotificationSettings />
          <ApiTokenSettings />
        </>
      )}
    </div>
  );
}

function TwoFactorSettings() {
  const { refresh } = useAuth();
  const queryClient = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ["2fa", "status"],
    queryFn: api.twoFactorStatus,
  });

  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState("");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["2fa", "status"] });
    void refresh();
  };

  const setupMutation = useMutation({
    mutationFn: api.twoFactorSetup,
    onSuccess: (res) => setSetup({ qrDataUrl: res.qrDataUrl, secret: res.secret }),
  });
  const enableMutation = useMutation({
    mutationFn: () => api.twoFactorEnable(code),
    onSuccess: () => {
      setSetup(null);
      setCode("");
      invalidate();
    },
  });
  const disableMutation = useMutation({
    mutationFn: () => api.twoFactorDisable(code),
    onSuccess: () => {
      setCode("");
      invalidate();
    },
  });

  const codeInput = (
    <input
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
      inputMode="numeric"
      maxLength={6}
      placeholder="000000"
      className="w-32 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-center font-mono tracking-widest outline-none focus:border-status-online"
    />
  );

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="font-semibold">Zwei-Faktor-Authentifizierung</h2>
        {status?.enabled && (
          <span className="rounded bg-status-online/15 px-2 py-0.5 text-xs text-status-online">
            aktiv
          </span>
        )}
      </div>
      <p className="mb-4 text-sm text-neutral-500">
        Schützt dein Konto mit einem zeitbasierten Code (TOTP) aus einer
        Authenticator-App.
      </p>

      {status?.enabled ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-neutral-400">Code zum Deaktivieren</span>
            {codeInput}
          </label>
          <button
            onClick={() => disableMutation.mutate()}
            disabled={code.length < 6 || disableMutation.isPending}
            className="rounded-md border border-status-error/40 px-4 py-2 text-sm text-status-error hover:bg-status-error/10 disabled:opacity-50"
          >
            Deaktivieren
          </button>
          {disableMutation.isError && (
            <span className="text-sm text-status-error">
              {(disableMutation.error as Error).message}
            </span>
          )}
        </div>
      ) : setup ? (
        <div className="space-y-3">
          <p className="text-sm text-neutral-300">
            Scanne den QR-Code in deiner Authenticator-App und gib zur Bestätigung
            den aktuellen Code ein:
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <img
              src={setup.qrDataUrl}
              alt="2FA-QR-Code"
              className="size-40 rounded-md bg-white p-1"
            />
            <div className="text-xs text-neutral-500">
              <p className="mb-1">Manuell:</p>
              <code className="break-all rounded bg-neutral-950 px-2 py-1 text-neutral-300">
                {setup.secret}
              </code>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-neutral-400">Bestätigungscode</span>
              {codeInput}
            </label>
            <button
              onClick={() => enableMutation.mutate()}
              disabled={code.length < 6 || enableMutation.isPending}
              className="rounded-md bg-status-online px-4 py-2 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
            >
              Aktivieren
            </button>
            <button
              onClick={() => {
                setSetup(null);
                setCode("");
              }}
              className="text-sm text-neutral-400 hover:text-neutral-200"
            >
              Abbrechen
            </button>
            {enableMutation.isError && (
              <span className="text-sm text-status-error">
                {(enableMutation.error as Error).message}
              </span>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setupMutation.mutate()}
          disabled={setupMutation.isPending}
          className="rounded-md bg-status-online px-4 py-2 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
        >
          {setupMutation.isPending ? "…" : "2FA einrichten"}
        </button>
      )}
    </section>
  );
}

function ApiTokenSettings() {
  const queryClient = useQueryClient();
  const { data: tokens } = useQuery({ queryKey: ["tokens"], queryFn: api.listTokens });

  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("VIEWER");
  const [expires, setExpires] = useState<number | "">("");
  const [created, setCreated] = useState<string | null>(null);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["tokens"] });

  const createMutation = useMutation({
    mutationFn: () =>
      api.createToken({
        name: name.trim(),
        role,
        expiresInDays: expires === "" ? undefined : expires,
      }),
    onSuccess: (res) => {
      setCreated(res.token);
      setName("");
      invalidate();
    },
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.revokeToken(id),
    onSuccess: invalidate,
  });

  const inputClass =
    "rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-status-online";

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-1 font-semibold">API-Tokens</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Für Automatisierung: als <code>Authorization: Bearer &lt;token&gt;</code>-Header
        verwenden. Das Token handelt mit der gewählten Rolle.
      </p>

      {created && (
        <div className="mb-4 rounded-md border border-status-online/40 bg-status-online/5 p-3">
          <p className="mb-1 text-xs text-neutral-400">
            Neues Token – wird nur jetzt angezeigt, bitte kopieren:
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-neutral-950 px-2 py-1 font-mono text-sm text-status-online">
              {created}
            </code>
            <button
              onClick={() => void navigator.clipboard?.writeText(created)}
              className="shrink-0 rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:bg-neutral-800"
            >
              Kopieren
            </button>
            <button
              onClick={() => setCreated(null)}
              className="shrink-0 text-xs text-neutral-500 hover:text-neutral-300"
            >
              Schließen
            </button>
          </div>
        </div>
      )}

      {tokens && tokens.length > 0 && (
        <ul className="mb-4 divide-y divide-neutral-800">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-neutral-200">{t.name}</span>
                  <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                    {t.role}
                  </span>
                  <code className="text-xs text-neutral-600">{t.prefix}…</code>
                </div>
                <div className="text-xs text-neutral-500">
                  {t.lastUsedAt ? `zuletzt genutzt ${formatRelative(t.lastUsedAt)}` : "nie genutzt"}
                  {t.expiresAt ? ` · läuft ab ${formatDateTime(t.expiresAt)}` : ""}
                </div>
              </div>
              <button
                onClick={() => {
                  if (confirm(`Token „${t.name}" widerrufen?`)) revokeMutation.mutate(t.id);
                }}
                className="shrink-0 rounded-md border border-status-error/40 px-2.5 py-1 text-xs text-status-error hover:bg-status-error/10"
              >
                Widerrufen
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (name.trim()) createMutation.mutate();
        }}
        className="flex flex-wrap items-end gap-2 border-t border-neutral-800 pt-4"
      >
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="z. B. Backup-Skript"
            className={inputClass}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Rolle</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputClass}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Ablauf (Tage)</span>
          <input
            type="number"
            min={1}
            value={expires}
            onChange={(e) => setExpires(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="∞"
            className={`${inputClass} w-24`}
          />
        </label>
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded-md bg-status-online px-4 py-2 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
        >
          {createMutation.isPending ? "Erstelle…" : "Token erstellen"}
        </button>
      </form>
    </section>
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

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [emailFrom, setEmailFrom] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [clearEmail, setClearEmail] = useState(false);

  const [serverDown, setServerDown] = useState(true);
  const [backupFailed, setBackupFailed] = useState(true);
  const [taskFailed, setTaskFailed] = useState(true);

  useEffect(() => {
    if (data) {
      setSmtpHost(data.emailSmtpHost);
      setSmtpPort(data.emailSmtpPort);
      setSmtpSecure(data.emailSmtpSecure);
      setSmtpUser(data.emailSmtpUser);
      setEmailFrom(data.emailFrom);
      setEmailTo(data.emailTo);
      setServerDown(data.notifyServerDown);
      setBackupFailed(data.notifyBackupFailed);
      setTaskFailed(data.notifyTaskFailed);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateNotificationSettings({
        discordWebhookUrl: clearWebhook ? "" : webhookUrl.trim() || undefined,
        ...(clearEmail
          ? { emailTo: "" }
          : {
              emailSmtpHost: smtpHost.trim() || undefined,
              emailSmtpPort: smtpPort,
              emailSmtpSecure: smtpSecure,
              emailSmtpUser: smtpUser.trim(),
              emailSmtpPassword: smtpPassword || undefined,
              emailFrom: emailFrom.trim() || undefined,
              emailTo: emailTo.trim() || undefined,
            }),
        notifyServerDown: serverDown,
        notifyBackupFailed: backupFailed,
        notifyTaskFailed: taskFailed,
      }),
    onSuccess: () => {
      setWebhookUrl("");
      setClearWebhook(false);
      setSmtpPassword("");
      setClearEmail(false);
      void queryClient.invalidateQueries({ queryKey: ["settings", "notifications"] });
    },
  });

  const discordTestMutation = useMutation({ mutationFn: () => api.testNotification("discord") });
  const emailTestMutation = useMutation({ mutationFn: () => api.testNotification("email") });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    saveMutation.mutate();
  };

  const discordConfigured = data?.discordConfigured ?? false;
  const emailConfigured = data?.emailConfigured ?? false;
  const inputClass =
    "w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-status-online";

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-1 font-semibold">Benachrichtigungen</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Sendet Meldungen über Discord und/oder E-Mail, z. B. wenn ein Server offline
        geht oder ein Backup fehlschlägt.
      </p>

      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <h3 className="mb-2 text-sm font-medium text-neutral-300">Discord-Webhook</h3>
          <label className="mb-1 block text-sm text-neutral-400">
            Webhook-URL{" "}
            {discordConfigured && !clearWebhook && (
              <span className="text-xs text-status-online">(konfiguriert)</span>
            )}
          </label>
          <input
            type="password"
            value={webhookUrl}
            disabled={clearWebhook}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder={
              discordConfigured ? "•••••••• (unverändert lassen)" : "https://discord.com/api/webhooks/…"
            }
            className={`${inputClass} ${clearWebhook ? "opacity-50" : ""}`}
          />
          {discordConfigured && (
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

        <div className="border-t border-neutral-800 pt-4">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-medium text-neutral-300">E-Mail (SMTP)</h3>
            {emailConfigured && !clearEmail && (
              <span className="text-xs text-status-online">(konfiguriert)</span>
            )}
          </div>
          <div className={`grid gap-2 sm:grid-cols-2 ${clearEmail ? "opacity-50" : ""}`}>
            <label className="text-sm">
              <span className="mb-1 block text-neutral-400">SMTP-Host</span>
              <input
                value={smtpHost}
                disabled={clearEmail}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.example.com"
                className={inputClass}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-neutral-400">Port</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={smtpPort}
                disabled={clearEmail}
                onChange={(e) => setSmtpPort(Number(e.target.value))}
                className={inputClass}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-neutral-400">Benutzername</span>
              <input
                value={smtpUser}
                disabled={clearEmail}
                onChange={(e) => setSmtpUser(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-neutral-400">Passwort</span>
              <input
                type="password"
                value={smtpPassword}
                disabled={clearEmail}
                onChange={(e) => setSmtpPassword(e.target.value)}
                placeholder={emailConfigured ? "•••••••• (unverändert lassen)" : ""}
                className={inputClass}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-neutral-400">Absender (Von)</span>
              <input
                type="email"
                value={emailFrom}
                disabled={clearEmail}
                onChange={(e) => setEmailFrom(e.target.value)}
                placeholder="minecontrol@example.com"
                className={inputClass}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-neutral-400">Empfänger (An)</span>
              <input
                value={emailTo}
                disabled={clearEmail}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="admin@example.com, weitere@example.com"
                className={inputClass}
              />
            </label>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={smtpSecure}
              disabled={clearEmail}
              onChange={(e) => setSmtpSecure(e.target.checked)}
              className="size-4 accent-status-online"
            />
            TLS direkt verwenden (Port 465)
          </label>
          {emailConfigured && (
            <label className="mt-1.5 flex items-center gap-2 text-xs text-neutral-400">
              <input
                type="checkbox"
                checked={clearEmail}
                onChange={(e) => setClearEmail(e.target.checked)}
                className="size-3.5 accent-status-error"
              />
              E-Mail-Konfiguration entfernen
            </label>
          )}
        </div>

        <fieldset className="space-y-2 border-t border-neutral-800 pt-4">
          <legend className="mb-1 text-sm text-neutral-400">
            Bei welchen Ereignissen? (gilt für Discord und E-Mail)
          </legend>
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
            onClick={() => discordTestMutation.mutate()}
            disabled={!discordConfigured || discordTestMutation.isPending}
            className="rounded-md border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50"
          >
            Discord-Test senden
          </button>
          <button
            type="button"
            onClick={() => emailTestMutation.mutate()}
            disabled={!emailConfigured || emailTestMutation.isPending}
            className="rounded-md border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50"
          >
            E-Mail-Test senden
          </button>
          {saveMutation.isSuccess && (
            <span className="text-sm text-status-online">Gespeichert.</span>
          )}
          {saveMutation.isError && (
            <span className="text-sm text-status-error">
              {(saveMutation.error as Error).message}
            </span>
          )}
          {discordTestMutation.isSuccess && (
            <span className="text-sm text-status-online">Gesendet – prüfe Discord.</span>
          )}
          {discordTestMutation.isError && (
            <span className="text-sm text-status-error">
              {(discordTestMutation.error as Error).message}
            </span>
          )}
          {emailTestMutation.isSuccess && (
            <span className="text-sm text-status-online">Gesendet – prüfe den Posteingang.</span>
          )}
          {emailTestMutation.isError && (
            <span className="text-sm text-status-error">
              {(emailTestMutation.error as Error).message}
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
