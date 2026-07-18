import type { ServerDto } from "@minecontrol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { PlayerActionMenu } from "../components/PlayerActions.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { serversQueryKey } from "../hooks/useServers.js";
import { api } from "../lib/api.js";
import { formatDuration } from "../lib/format.js";

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

  const playersQuery = useQuery({
    queryKey: ["server", id, "players"],
    queryFn: () => api.getPlayers(id!),
    enabled: Boolean(id),
    refetchInterval: 10_000,
  });

  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<string[]>([]);

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
    mutationFn: () => api.deleteServer(id!),
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
    if (confirm(`Server „${server?.name}" wirklich entfernen?`)) {
      deleteMutation.mutate();
    }
  };

  if (isLoading) return <p className="text-neutral-500">Lade Server…</p>;
  if (!server) return <p className="text-status-error">Server nicht gefunden.</p>;

  const players = playersQuery.data ?? [];

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
        {can("ADMIN") && (
          <button
            onClick={onDelete}
            className="rounded-md border border-status-error/40 px-3 py-1.5 text-sm text-status-error hover:bg-status-error/10"
          >
            Entfernen
          </button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 font-semibold">
            Spieler online ({server.status.players.online}
            {server.status.players.max ? `/${server.status.players.max}` : ""})
          </h2>
          {players.length === 0 ? (
            <p className="text-sm text-neutral-500">Niemand online.</p>
          ) : (
            <ul className="space-y-1.5">
              {players.map((p) => (
                <li
                  key={p.uuid ?? p.name}
                  className="flex items-center justify-between text-sm"
                >
                  <span>🙂 {p.name}</span>
                  <div className="flex items-center gap-2">
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

        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 font-semibold">Details</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-neutral-500">MOTD</dt>
              <dd className="max-w-[60%] truncate">{server.status.motd || "–"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">Latenz</dt>
              <dd>{server.status.latencyMs != null ? `${server.status.latencyMs} ms` : "–"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">RCON</dt>
              <dd>{canRcon ? "verbunden" : "nicht konfiguriert"}</dd>
            </div>
          </dl>
        </section>
      </div>

      {can("MODERATOR") && canRcon && (
        <section className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 font-semibold">Befehl senden (RCON)</h2>
          {output.length > 0 && (
            <pre className="mb-3 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md bg-neutral-950 p-3 font-mono text-xs text-neutral-300">
              {output.join("\n")}
            </pre>
          )}
          <form onSubmit={onSendCommand} className="flex gap-2">
            <span className="self-center text-neutral-600">/</span>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="list"
              className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono outline-none focus:border-status-online"
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
  );
}
