import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
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
  const [url, setUrl] = useState("");
  const [configFor, setConfigFor] = useState<string | null>(null);

  const installedKey = ["server", serverId, "mods"];
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: installedKey });
    void queryClient.invalidateQueries({ queryKey: ["server", serverId, "mods", "updates"] });
  };

  const { data: installed } = useQuery({
    queryKey: installedKey,
    queryFn: () => api.listMods(serverId),
  });

  // Update-Check (nur Modrinth-Herkunft) — best effort, Fehler ignorieren.
  const { data: updates } = useQuery({
    queryKey: ["server", serverId, "mods", "updates"],
    queryFn: () => api.modUpdates(serverId),
    retry: false,
  });
  const updatable = new Set(
    (updates ?? []).filter((u) => u.updateAvailable).map((u) => u.fileName),
  );

  const searchQuery = useQuery({
    queryKey: ["server", serverId, "mods", "search", submitted],
    queryFn: () => api.searchMods(serverId, submitted),
    enabled: submitted.length > 0,
  });

  const installMutation = useMutation({
    mutationFn: (projectId: string) => api.installMod(serverId, projectId),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (file: string) => api.deleteMod(serverId, file),
    onSuccess: invalidate,
  });
  const toggleMutation = useMutation({
    mutationFn: (v: { file: string; enabled: boolean }) =>
      api.toggleMod(serverId, v.file, v.enabled),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: (file: string) => api.updateMod(serverId, file),
    onSuccess: invalidate,
  });
  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.uploadMod(serverId, file),
    onSuccess: invalidate,
  });
  const urlMutation = useMutation({
    mutationFn: (u: string) => api.installModFromUrl(serverId, u),
    onSuccess: () => {
      setUrl("");
      invalidate();
    },
  });

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(query.trim());
  };
  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    e.target.value = "";
  };
  const onUrl = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) urlMutation.mutate(url.trim());
  };

  const anyError =
    uploadMutation.error ?? urlMutation.error ?? toggleMutation.error ?? updateMutation.error;

  return (
    <div className="space-y-4">
      {/* Installiert */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="mb-3 font-semibold">Installierte {noun}</h2>
        {anyError && (
          <p className="mb-2 text-sm text-status-error">{(anyError as Error).message}</p>
        )}
        {!installed || installed.length === 0 ? (
          <p className="text-sm text-neutral-500">Noch nichts installiert.</p>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {installed.map((m) => (
              <li key={m.filename} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`min-w-0 truncate font-mono ${m.enabled ? "text-neutral-200" : "text-neutral-500 line-through"}`}
                  >
                    {m.filename}
                  </span>
                  {m.source && (
                    <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                      {m.source}
                    </span>
                  )}
                  {updatable.has(m.filename) && (
                    <span className="shrink-0 rounded bg-status-online/15 px-1.5 py-0.5 text-[10px] text-status-online">
                      Update
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-neutral-500">
                  {formatBytes(m.sizeBytes)}
                  {isPlugin && (
                    <button
                      onClick={() => setConfigFor(m.filename)}
                      className="text-neutral-300 hover:text-neutral-100"
                      title="Konfiguration"
                    >
                      ⚙
                    </button>
                  )}
                  {can("ADMIN") && updatable.has(m.filename) && (
                    <button
                      onClick={() => updateMutation.mutate(m.filename)}
                      disabled={updateMutation.isPending}
                      className="text-status-online hover:opacity-80 disabled:opacity-50"
                      title="Aktualisieren"
                    >
                      ↑
                    </button>
                  )}
                  {can("ADMIN") && (
                    <button
                      onClick={() =>
                        toggleMutation.mutate({ file: m.filename, enabled: !m.enabled })
                      }
                      disabled={toggleMutation.isPending}
                      className="hover:text-neutral-200 disabled:opacity-50"
                      title={m.enabled ? "Deaktivieren" : "Aktivieren"}
                    >
                      {m.enabled ? "⏸" : "▶"}
                    </button>
                  )}
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
          Änderungen (Installieren/Aktivieren/Aktualisieren) wirken nach einem Neustart des Servers.
        </p>
      </section>

      {/* Eigene .jar */}
      {can("ADMIN") && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 font-semibold">Eigene .jar hinzufügen</h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="inline-flex cursor-pointer items-center rounded-md border border-neutral-700 px-3 py-2 text-sm hover:border-status-online">
              {uploadMutation.isPending ? "Lade hoch…" : "Datei wählen (.jar)"}
              <input
                type="file"
                accept=".jar"
                className="hidden"
                onChange={onUpload}
                disabled={uploadMutation.isPending}
              />
            </label>
            <span className="text-xs text-neutral-600">oder</span>
            <form onSubmit={onUrl} className="flex min-w-0 flex-1 gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/plugin.jar"
                className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-status-online"
              />
              <button
                type="submit"
                disabled={urlMutation.isPending || !url.trim()}
                className="shrink-0 rounded-md bg-status-online px-4 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
              >
                {urlMutation.isPending ? "Lade…" : "Von URL"}
              </button>
            </form>
          </div>
          <p className="mt-2 text-xs text-neutral-600">
            Nur .jar-Dateien; URLs müssen öffentlich erreichbar sein (interne/lokale Adressen werden abgelehnt).
          </p>
        </section>
      )}

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

      {configFor && (
        <PluginConfigEditor
          serverId={serverId}
          file={configFor}
          canWrite={can("ADMIN")}
          onClose={() => setConfigFor(null)}
        />
      )}
    </div>
  );
}

/** Overlay: listet die Config-Dateien eines Plugins und editiert sie. */
function PluginConfigEditor({
  serverId,
  file,
  canWrite,
  onClose,
}: {
  serverId: string;
  file: string;
  canWrite: boolean;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const listQuery = useQuery({
    queryKey: ["server", serverId, "mods", "config", file],
    queryFn: () => api.pluginConfig(serverId, file),
    retry: false,
  });

  const fileQuery = useQuery({
    queryKey: ["server", serverId, "mods", "config", file, selected],
    queryFn: () => api.readPluginConfig(serverId, file, selected!),
    enabled: selected != null,
  });

  const saveMutation = useMutation({
    mutationFn: () => api.writePluginConfig(serverId, file, selected!, draft),
  });

  // Entwurf initialisieren, sobald (eine neue) Datei geladen ist.
  const loadedContent = fileQuery.data?.content;
  const loadedPath = fileQuery.data?.path;
  useEffect(() => {
    if (loadedContent != null) setDraft(loadedContent);
  }, [loadedPath, loadedContent]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h3 className="truncate font-semibold">Konfiguration — {file}</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-100">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {listQuery.isLoading && <p className="text-sm text-neutral-500">Lade…</p>}
          {listQuery.isError && (
            <p className="text-sm text-status-error">
              {(listQuery.error as Error).message}
            </p>
          )}
          {listQuery.data && listQuery.data.configDir == null && (
            <p className="text-sm text-neutral-500">
              Kein Config-Ordner gefunden (plugin.yml nicht lesbar oder Plugin noch nie gestartet).
            </p>
          )}
          {listQuery.data && listQuery.data.configDir != null && (
            <>
              <p className="mb-2 text-xs text-neutral-600">
                Ordner: <span className="font-mono">{listQuery.data.configDir}</span>
              </p>
              {listQuery.data.entries.length === 0 ? (
                <p className="text-sm text-neutral-500">Noch keine Config-Dateien.</p>
              ) : (
                <div className="mb-3 flex flex-wrap gap-2">
                  {listQuery.data.entries
                    .filter((e) => e.type === "file")
                    .map((e) => (
                      <button
                        key={e.name}
                        onClick={() => {
                          setSelected(e.name);
                          setDraft("");
                          saveMutation.reset();
                        }}
                        className={`rounded-md border px-2.5 py-1 text-xs ${
                          selected === e.name
                            ? "border-status-online text-status-online"
                            : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
                        }`}
                      >
                        {e.name}
                      </button>
                    ))}
                </div>
              )}

              {selected && fileQuery.isFetching && (
                <p className="text-sm text-neutral-500">Lade {selected}…</p>
              )}
              {selected && fileQuery.data && (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  className="h-64 w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 p-3 font-mono text-xs outline-none focus:border-status-online"
                />
              )}
              {selected && fileQuery.isError && (
                <p className="text-sm text-status-error">
                  {(fileQuery.error as Error).message}
                </p>
              )}
            </>
          )}
        </div>

        {selected && fileQuery.data && (
          <div className="flex items-center justify-end gap-3 border-t border-neutral-800 px-4 py-3">
            {saveMutation.isError && (
              <span className="mr-auto text-sm text-status-error">
                {(saveMutation.error as Error).message}
              </span>
            )}
            {saveMutation.isSuccess && (
              <span className="mr-auto text-sm text-status-online">Gespeichert.</span>
            )}
            <button
              onClick={() => saveMutation.mutate()}
              disabled={!canWrite || saveMutation.isPending}
              className="rounded-md bg-status-online px-4 py-1.5 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
              title={canWrite ? undefined : "Nur Admins dürfen speichern"}
            >
              {saveMutation.isPending ? "Speichere…" : "Speichern"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
