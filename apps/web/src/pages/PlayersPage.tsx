import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { PlayerAvatar } from "../components/PlayerAvatar.js";
import { api } from "../lib/api.js";
import { formatPlaytime, formatRelative } from "../lib/format.js";

export function PlayersPage() {
  const [query, setQuery] = useState("");
  const { data: players, isLoading, error } = useQuery({
    queryKey: ["players"],
    queryFn: api.listPlayers,
    refetchInterval: 30_000,
  });

  const filtered = (players ?? []).filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Spieler</h1>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Spieler suchen…"
          className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none focus:border-status-online"
        />
      </div>

      {isLoading && <p className="text-neutral-500">Lade Spieler…</p>}
      {error && <p className="text-status-error">Spieler konnten nicht geladen werden.</p>}

      {players && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-800 p-10 text-center text-neutral-500">
          {players.length === 0
            ? "Noch keine Spieler erfasst – sie erscheinen, sobald jemand einen Server betritt."
            : "Kein Spieler passt zur Suche."}
        </div>
      )}

      {filtered.length > 0 && (
        <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
          {filtered.map((p) => (
            <li key={p.key}>
              <Link
                to={`/players/${encodeURIComponent(p.key)}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-800/50"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <PlayerAvatar name={p.name} size={32} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium text-neutral-100">{p.name}</span>
                      {p.online && (
                        <span className="inline-block size-2 shrink-0 rounded-full bg-status-online" />
                      )}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {p.online ? "online" : `zuletzt ${formatRelative(p.lastSeen)}`}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm">
                  <span className="font-mono text-neutral-200">
                    {formatPlaytime(p.totalPlaytimeSeconds)}
                  </span>
                  <span className="block text-xs text-neutral-500">Spielzeit</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
