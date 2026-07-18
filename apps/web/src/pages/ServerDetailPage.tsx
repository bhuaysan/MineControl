import type { ServerDto } from "@minecontrol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { BackupsPanel } from "../components/BackupsPanel.js";
import { ConsoleView } from "../components/ConsoleView.js";
import { FilesPanel } from "../components/FilesPanel.js";
import { MetricHistoryChart } from "../components/MetricHistoryChart.js";
import { PlayerActionMenu } from "../components/PlayerActions.js";
import { PlayerAvatar } from "../components/PlayerAvatar.js";
import { ServerActions } from "../components/ServerActions.js";
import { ServerPropertiesForm } from "../components/ServerPropertiesForm.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { TasksPanel } from "../components/TasksPanel.js";
import { useServerMetrics } from "../hooks/useServerMetrics.js";
import { serversQueryKey } from "../hooks/useServers.js";
import { api } from "../lib/api.js";
import { formatDuration } from "../lib/format.js";

type Tab =
  | "overview"
  | "console"
  | "players"
  | "files"
  | "backups"
  | "tasks"
  | "settings";

export function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const { data: server, isLoading } = useQuery<ServerDto>({
    queryKey: ["server", id],
    queryFn: () => api.getServer(id!),
    enabled: Boolean(id),
    refetchInterval: 10_000,
  });

  const canRcon = server?.capabilities.includes("RCON") ?? false;
  const hasConsole =
    (server?.capabilities.includes("CONSOLE") ?? false) && can("MODERATOR");
  const hasMetrics = server?.capabilities.includes("METRICS") ?? false;
  const hasLifecycle =
    (server?.capabilities.includes("LIFECYCLE_START") ?? false) ||
    (server?.capabilities.includes("LIFECYCLE_STOP") ?? false);
  const hasSettings = server?.type === "DOCKER" && can("MODERATOR");
  const isDocker = server?.type === "DOCKER";
  const showTasks = isDocker || canRcon;

  const playersQuery = useQuery({
    queryKey: ["server", id, "players"],
    queryFn: () => api.getPlayers(id!),
    enabled: Boolean(id),
    refetchInterval: 10_000,
  });

  const [tab, setTab] = useState<Tab>("overview");
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<string[]>([]);

  const running =
    server?.status.state === "ONLINE" || server?.status.state === "STARTING";
  const metrics = useServerMetrics(id ?? "", Boolean(id) && hasMetrics && tab === "overview" && running);

  const commandMutation = useMutation({
    mutationFn: (cmd: string) => api.sendCommand(id!, cmd),
    onSuccess: (res, cmd) => {
      setOutput((prev) => [...prev, `> ${cmd}`, res.response || "(keine Antwort)"]);
      setCommand("");
    },
    onError: (err, cmd) => {
      setOutput((prev) => [...prev, `> ${cmd}`, `Fehler: ${(err as Error).message}`]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (keepWorld: boolean) => api.deleteServer(id!, keepWorld),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: serversQueryKey });
      navigate("/");
    },
  });

  const onSendCommand = (e: FormEvent) => {
    e.preventDefault();
    if (command.trim()) commandMutation.mutate(command.trim());
  };

  const onDelete = () => {
    if (!confirm(`Server „${server?.name}" wirklich entfernen?`)) return;
    let keepWorld = false;
    if (server?.type === "DOCKER") {
      keepWorld = confirm(
        "Weltdaten behalten?\n\nOK = Volume behalten · Abbrechen = endgültig löschen",
      );
    }
    deleteMutation.mutate(keepWorld);
  };

  if (isLoading) return <p className="text-neutral-500">Lade Server…</p>;
  if (!server) return <p className="text-status-error">Server nicht gefunden.</p>;

  const players = playersQuery.data ?? [];

  const tabs: [Tab, string][] = [["overview", "Übersicht"]];
  if (hasConsole) tabs.push(["console", "Konsole"]);
  tabs.push(["players", `Spieler (${server.status.players.online})`]);
  if (isDocker && can("MODERATOR")) tabs.push(["files", "Dateien"]);
  if (isDocker) tabs.push(["backups", "Backups"]);
  if (showTasks) tabs.push(["tasks", "Zeitpläne"]);
  if (hasSettings) tabs.push(["settings", "Einstellungen"]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{server.name}</h1>
            <StatusBadge state={server.status.state} />
          </div>
          <p className="text-sm text-neutral-500">
            {server.status.version ?? server.edition} ·{" "}
            {server.type === "DOCKER" ? "Docker" : "Extern"} · {server.host}:{server.port}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasLifecycle && can("MODERATOR") && <ServerActions server={server} />}
          {can("ADMIN") && (
            <button
              onClick={onDelete}
              className="rounded-md border border-status-error/40 px-3 py-1.5 text-sm text-status-error hover:bg-status-error/10"
            >
              Entfernen
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 flex gap-1 border-b border-neutral-800">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              tab === key
                ? "border-status-online text-neutral-100"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="mb-3 font-semibold">Details</h2>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-neutral-500">MOTD</dt>
                <dd className="max-w-[60%] truncate">{server.status.motd || "–"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Version</dt>
                <dd>{server.status.version ?? server.edition}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Spieler</dt>
                <dd>
                  {server.status.players.online}
                  {server.status.players.max ? ` / ${server.status.players.max}` : ""}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Latenz</dt>
                <dd>
                  {server.status.latencyMs != null ? `${server.status.latencyMs} ms` : "–"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">RCON</dt>
                <dd>{canRcon ? "verbunden" : "nicht konfiguriert"}</dd>
              </div>
            </dl>
          </section>

          {hasMetrics && (
            <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <h2 className="mb-3 font-semibold">Metriken</h2>
              {!running ? (
                <p className="text-sm text-neutral-500">Server offline – keine Metriken.</p>
              ) : !metrics ? (
                <p className="text-sm text-neutral-500">Warte auf Daten…</p>
              ) : (
                <div className="space-y-3">
                  <Metric
                    label="CPU"
                    value={`${metrics.cpuPercent?.toFixed(1) ?? "–"} %`}
                    percent={Math.min(metrics.cpuPercent ?? 0, 100)}
                  />
                  <Metric
                    label="RAM"
                    value={`${metrics.ramUsedMb ?? "–"} / ${metrics.ramMaxMb ?? "–"} MB`}
                    percent={
                      metrics.ramMaxMb
                        ? Math.min(((metrics.ramUsedMb ?? 0) / metrics.ramMaxMb) * 100, 100)
                        : 0
                    }
                  />
                </div>
              )}
            </section>
          )}

          <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 md:col-span-2">
            <h2 className="mb-3 font-semibold">Verlauf</h2>
            <MetricHistoryChart serverId={server.id} />
          </section>

          {can("MODERATOR") && canRcon && !hasConsole && (
            <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <h2 className="mb-3 font-semibold">Befehl senden (RCON)</h2>
              {output.length > 0 && (
                <pre className="mb-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-neutral-950 p-3 font-mono text-xs text-neutral-300">
                  {output.join("\n")}
                </pre>
              )}
              <form onSubmit={onSendCommand} className="flex gap-2">
                <span className="self-center text-neutral-600">/</span>
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="list"
                  className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono outline-none focus:border-status-online"
                />
                <button
                  type="submit"
                  disabled={commandMutation.isPending}
                  className="rounded-md bg-status-online px-4 font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
                >
                  Senden
                </button>
              </form>
            </section>
          )}
        </div>
      )}

      {tab === "console" && hasConsole && (
        <ConsoleView serverId={server.id} canInput={can("MODERATOR") && canRcon} />
      )}

      {tab === "files" && isDocker && can("MODERATOR") && (
        <FilesPanel serverId={server.id} />
      )}

      {tab === "backups" && isDocker && <BackupsPanel serverId={server.id} />}

      {tab === "tasks" && showTasks && <TasksPanel serverId={server.id} />}

      {tab === "settings" && hasSettings && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 font-semibold">server.properties</h2>
          <ServerPropertiesForm serverId={server.id} canEdit={can("ADMIN")} />
        </section>
      )}

      {tab === "players" && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 font-semibold">
            Online ({server.status.players.online}
            {server.status.players.max ? `/${server.status.players.max}` : ""})
          </h2>
          {players.length === 0 ? (
            <p className="text-sm text-neutral-500">Niemand online.</p>
          ) : (
            <ul className="divide-y divide-neutral-800">
              {players.map((p) => (
                <li
                  key={p.uuid ?? p.name}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <PlayerAvatar name={p.name} uuid={p.uuid} size={24} />
                    {p.name}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-neutral-500">
                      {formatDuration(p.sessionSeconds)}
                    </span>
                    {can("MODERATOR") && canRcon && (
                      <PlayerActionMenu
                        serverId={server.id}
                        playerName={p.name}
                        onDone={() => void playersQuery.refetch()}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** Beschriftete Fortschrittsleiste für eine Metrik. */
function Metric({
  label,
  value,
  percent,
}: {
  label: string;
  value: string;
  percent: number;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-neutral-400">{label}</span>
        <span className="font-mono text-neutral-200">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full rounded-full bg-status-online transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
