import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../lib/api.js";
import { formatBytes } from "../lib/format.js";

/** Kompakte Download-Zahl: 15,0M / 330k / 42. */
function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function ModsPanel({
  serverId,
  edition,
}: {
  serverId: string;
  edition: string;
}) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const isPlugin = ["PAPER", "SPIGOT", "VELOCITY", "BUNGEECORD"].includes(edition);
  const noun = isPlugin ? "Plugins" : "Mods";

  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");

  const installedKey = ["server", serverId, "mods"];
  const { data: installed } = useQuery({
    queryKey: installedKey,
    queryFn: () => api.listMods(serverId),
  });

  const searchQuery = useQuery({
    queryKey: ["server", serverId, "mods", "search", submitted],
    queryFn: () => api.searchMods(serverId, submitted),
    enabled: submitted.length > 0,
  });

  const installMutation = useMutation({
    mutationFn: (projectId: string) => api.installMod(serverId, projectId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: installedKey }),
  });
  const deleteMutation = useMutation({
    mutationFn: (file: string) => api.deleteMod(serverId, file),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: installedKey }),
  });

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(query.trim());
  };

  return (
    <div className="space-y-4">
      {/* Installiert */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="mb-3 font-semibold">Installierte {noun}</h2>
        {!installed || installed.length === 0 ? (
          <p className="text-sm text-neutral-500">Noch nichts installiert.</p>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {installed.map((m) => (
              <li key={m.filename} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate font-mono text-neutral-200">
                  {m.filename}
                </span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-neutral-500">
                  {formatBytes(m.sizeBytes)}
                  {can("ADMIN") && (
                    <button
                      onClick={() => {
                        if (confirm(`„${m.filename}" löschen?`)) deleteMutation.mutate(m.filename);
                      }}
                      className="text-status-error hover:opacity-80"
                      title="Löschen"
                    >
                      ✕
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-neutral-600">
          Änderungen wirken nach einem Neustart des Servers.
        </p>
      </section>

      {/* Suche */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="mb-3 font-semibold">{noun} suchen (Modrinth)</h2>
        <form onSubmit={onSearch} className="mb-3 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`z. B. ${isPlugin ? "EssentialsX, WorldEdit" : "Sodium, Lithium"}`}
            className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-status-online"
          />
          <button
            type="submit"
            className="rounded-md bg-status-online px-4 text-sm font-medium text-neutral-950 hover:opacity-90"
          >
            Suchen
          </button>
        </form>

        {installMutation.isError && (
          <p className="mb-2 text-sm text-status-error">
            Installation fehlgeschlagen: {(installMutation.error as Error).message}
          </p>
        )}

        {searchQuery.isFetching && <p className="text-sm text-neutral-500">Suche…</p>}
        {searchQuery.data && searchQuery.data.length === 0 && (
          <p className="text-sm text-neutral-500">Keine kompatiblen Treffer.</p>
        )}
        {searchQuery.data && searchQuery.data.length > 0 && (
          <ul className="divide-y divide-neutral-800">
            {searchQuery.data.map((hit) => (
              <li key={hit.projectId} className="flex items-center gap-3 py-2.5">
                {hit.iconUrl ? (
                  <img
                    src={hit.iconUrl}
                    alt=""
                    className="size-10 shrink-0 rounded-md bg-neutral-800 object-cover"
                  />
                ) : (
                  <div className="size-10 shrink-0 rounded-md bg-neutral-800" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-neutral-100">{hit.title}</span>
                    <span className="shrink-0 text-xs text-neutral-500">
                      ↓ {formatDownloads(hit.downloads)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-neutral-500">{hit.description}</p>
                </div>
                {can("ADMIN") && (
                  <button
                    onClick={() => installMutation.mutate(hit.projectId)}
                    disabled={
                      installMutation.isPending &&
                      installMutation.variables === hit.projectId
                    }
                    className="shrink-0 rounded-md border border-status-online/40 px-3 py-1.5 text-sm text-status-online hover:bg-status-online/10 disabled:opacity-50"
                  >
                    {installMutation.isPending && installMutation.variables === hit.projectId
                      ? "Installiere…"
                      : "Installieren"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
