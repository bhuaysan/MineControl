import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { PlayerAvatar } from "../components/PlayerAvatar.js";
import { api } from "../lib/api.js";
import { formatDateTime, formatPlaytime, formatRelative } from "../lib/format.js";

const ACTION_LABELS: Record<string, string> = {
  "player.ban": "Gebannt",
  "player.unban": "Entbannt",
  "player.kick": "Gekickt",
  "player.op": "OP erteilt",
  "player.deop": "OP entzogen",
  "player.whitelist_add": "Whitelist +",
  "player.whitelist_remove": "Whitelist −",
};

export function PlayerProfilePage() {
  const { key } = useParams<{ key: string }>();
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const { data: player, isLoading } = useQuery({
    queryKey: ["player", key],
    queryFn: () => api.getPlayer(key!),
    enabled: Boolean(key),
    refetchInterval: 30_000,
  });

  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (player) setNotes(player.notes ?? "");
  }, [player]);

  const notesMutation = useMutation({
    mutationFn: () => api.updatePlayerNotes(key!, notes),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["player", key] }),
  });

  if (isLoading) return <p className="text-neutral-500">Lade Profil…</p>;
  if (!player) return <p className="text-status-error">Spieler nicht gefunden.</p>;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Kopf */}
      <div className="mb-6 flex items-center gap-4">
        <PlayerAvatar name={player.name} size={56} />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{player.name}</h1>
            {player.online && (
              <span className="inline-flex items-center gap-1.5 text-sm text-status-online">
                <span className="inline-block size-2 rounded-full bg-status-online" /> online
              </span>
            )}
          </div>
          <p className="text-sm text-neutral-500">
            Zuletzt gesehen {formatRelative(player.lastSeen)} · dabei seit{" "}
            {formatDateTime(player.firstSeen)}
          </p>
        </div>
      </div>

      {/* Kennzahlen */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Gesamt-Spielzeit" value={formatPlaytime(player.totalPlaytimeSeconds)} />
        <Stat label="Sessions" value={String(player.sessionCount)} />
        <Stat
          label="Status"
          value={player.online ? "online" : "offline"}
          accent={player.online}
        />
      </div>

      {/* Notizen */}
      <section className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="mb-2 font-semibold">Notizen</h2>
        {can("MODERATOR") ? (
          <>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Interne Notiz zu diesem Spieler…"
              className="w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 p-2 text-sm outline-none focus:border-status-online"
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => notesMutation.mutate()}
                disabled={notesMutation.isPending || notes === (player.notes ?? "")}
                className="rounded-md bg-status-online px-3 py-1.5 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
              >
                {notesMutation.isPending ? "Speichern…" : "Speichern"}
              </button>
              {notesMutation.isSuccess && (
                <span className="text-xs text-status-online">Gespeichert.</span>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-neutral-400">{player.notes || "Keine Notizen."}</p>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Sessions */}
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 font-semibold">Letzte Sessions</h2>
          {player.recentSessions.length === 0 ? (
            <p className="text-sm text-neutral-500">Noch keine Sessions erfasst.</p>
          ) : (
            <ul className="divide-y divide-neutral-800 text-sm">
              {player.recentSessions.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-neutral-200">
                      {s.serverName ?? s.serverId}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {formatDateTime(s.joinedAt)}
                      {!s.leftAt && (
                        <span className="text-status-online"> · läuft</span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-neutral-300">
                    {formatPlaytime(s.seconds)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Verlauf */}
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 font-semibold">Moderations-Verlauf</h2>
          {player.history.length === 0 ? (
            <p className="text-sm text-neutral-500">Keine Einträge.</p>
          ) : (
            <ul className="divide-y divide-neutral-800 text-sm">
              {player.history.map((h, i) => (
                <li key={i} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-neutral-200">
                      {ACTION_LABELS[h.action] ?? h.action}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {formatRelative(h.timestamp)}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-500">
                    {h.serverName}
                    {h.reason ? ` · „${h.reason}"` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className={`text-xl font-bold ${accent ? "text-status-online" : "text-neutral-100"}`}>
        {value}
      </div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}
