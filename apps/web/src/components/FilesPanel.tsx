import type { FileEntryDto } from "@minecontrol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { ApiRequestError, api } from "../lib/api.js";
import { formatBytes, formatDateTime } from "../lib/format.js";

/** Fügt Segment an einen Pfad an (Basis „/" oder „/unterordner"). */
function joinPath(base: string, name: string): string {
  return base === "/" ? `/${name}` : `${base}/${name}`;
}

/** Elternpfad zu einem Pfad. */
function parentPath(path: string): string {
  if (path === "/") return "/";
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "/" : path.slice(0, idx);
}

export function FilesPanel({ serverId }: { serverId: string }) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [path, setPath] = useState("/");
  const [editing, setEditing] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const listKey = ["server", serverId, "files", path];
  const { data, isLoading, error } = useQuery({
    queryKey: listKey,
    queryFn: () => api.listFiles(serverId, path),
    retry: false,
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["server", serverId, "files"] });

  const deleteMutation = useMutation({
    mutationFn: (p: string) => api.deleteFile(serverId, p),
    onSuccess: invalidate,
  });
  const mkdirMutation = useMutation({
    mutationFn: (p: string) => api.makeDir(serverId, p),
    onSuccess: invalidate,
  });
  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.uploadFile(serverId, path, file),
    onSuccess: invalidate,
  });

  const notRunning = error instanceof ApiRequestError && error.status === 409;

  const onEntryClick = (entry: FileEntryDto) => {
    if (entry.type === "dir") setPath(joinPath(path, entry.name));
    else if (entry.type === "file") setEditing(joinPath(path, entry.name));
  };

  const onNewFolder = () => {
    const name = prompt("Name des neuen Ordners:");
    if (name?.trim()) mkdirMutation.mutate(joinPath(path, name.trim()));
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    e.target.value = "";
  };

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      {/* Breadcrumb + Werkzeuge */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Breadcrumb path={path} onNavigate={setPath} />
        {can("ADMIN") && (
          <div className="flex items-center gap-2">
            <button
              onClick={onNewFolder}
              className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:bg-neutral-800"
            >
              + Ordner
            </button>
            <button
              onClick={() => uploadRef.current?.click()}
              disabled={uploadMutation.isPending}
              className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50"
            >
              {uploadMutation.isPending ? "Lade hoch…" : "↑ Upload"}
            </button>
            <input ref={uploadRef} type="file" onChange={onUpload} className="hidden" />
          </div>
        )}
      </div>

      {uploadMutation.isError && (
        <p className="mb-2 text-sm text-status-error">
          Upload fehlgeschlagen: {(uploadMutation.error as Error).message}
        </p>
      )}

      {notRunning ? (
        <p className="py-6 text-center text-sm text-neutral-500">
          Der Server muss laufen, um Dateien zu durchsuchen.
        </p>
      ) : isLoading ? (
        <p className="text-sm text-neutral-500">Lade…</p>
      ) : error ? (
        <p className="text-sm text-status-error">
          {(error as Error).message || "Verzeichnis konnte nicht geladen werden."}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-800">
          {path !== "/" && (
            <li>
              <button
                onClick={() => setPath(parentPath(path))}
                className="flex w-full items-center gap-2 py-2 text-sm text-neutral-400 hover:text-neutral-200"
              >
                <span className="w-5 text-center">↩</span> ..
              </button>
            </li>
          )}
          {data?.entries.length === 0 && path === "/" && (
            <li className="py-2 text-sm text-neutral-500">Leeres Verzeichnis.</li>
          )}
          {data?.entries.map((entry) => (
            <li key={entry.name} className="flex items-center justify-between gap-3 py-2 text-sm">
              <button
                onClick={() => onEntryClick(entry)}
                disabled={entry.type === "other"}
                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
              >
                <span className="w-5 text-center">
                  {entry.type === "dir" ? "📁" : entry.type === "file" ? "📄" : "•"}
                </span>
                <span
                  className={`truncate ${
                    entry.type === "dir"
                      ? "text-neutral-200 hover:text-status-online"
                      : "text-neutral-300 hover:text-neutral-100"
                  }`}
                >
                  {entry.name}
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-3 text-xs text-neutral-500">
                {entry.type === "file" && <span>{formatBytes(entry.size)}</span>}
                <span className="hidden sm:inline">{formatDateTime(entry.mtime)}</span>
                {entry.type === "file" && (
                  <a
                    href={api.downloadFileUrl(serverId, joinPath(path, entry.name))}
                    className="text-neutral-400 hover:text-neutral-200"
                    title="Herunterladen"
                  >
                    ↓
                  </a>
                )}
                {can("ADMIN") && entry.type !== "other" && (
                  <button
                    onClick={() => {
                      if (confirm(`„${entry.name}" löschen?`))
                        deleteMutation.mutate(joinPath(path, entry.name));
                    }}
                    className="text-status-error hover:opacity-80"
                    title="Löschen"
                  >
                    ✕
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <FileEditor
          serverId={serverId}
          path={editing}
          canEdit={can("ADMIN")}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function Breadcrumb({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (p: string) => void;
}) {
  const segments = path === "/" ? [] : path.slice(1).split("/");
  return (
    <div className="flex flex-wrap items-center gap-1 text-sm">
      <button
        onClick={() => onNavigate("/")}
        className="text-neutral-400 hover:text-neutral-100"
      >
        /data
      </button>
      {segments.map((seg, i) => {
        const target = `/${segments.slice(0, i + 1).join("/")}`;
        return (
          <span key={target} className="flex items-center gap-1">
            <span className="text-neutral-600">/</span>
            <button
              onClick={() => onNavigate(target)}
              className="text-neutral-400 hover:text-neutral-100"
            >
              {seg}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function FileEditor({
  serverId,
  path,
  canEdit,
  onClose,
}: {
  serverId: string;
  path: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState<string | null>(null);

  const { error, isLoading } = useQuery({
    queryKey: ["server", serverId, "file", path],
    queryFn: async () => {
      const res = await api.readFile(serverId, path);
      setContent(res.content);
      return res;
    },
    retry: false,
    gcTime: 0,
  });

  const saveMutation = useMutation({
    mutationFn: () => api.writeFile(serverId, path, content ?? ""),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["server", serverId, "files"] });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
          <span className="truncate font-mono text-sm text-neutral-300">{path}</span>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-100">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {isLoading ? (
            <p className="text-sm text-neutral-500">Lade Datei…</p>
          ) : error ? (
            <p className="text-sm text-status-error">
              {(error as Error).message || "Datei konnte nicht geladen werden."}
            </p>
          ) : (
            <textarea
              value={content ?? ""}
              readOnly={!canEdit}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              className="h-[55vh] w-full resize-none rounded-md border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs text-neutral-200 outline-none focus:border-status-online"
            />
          )}
        </div>

        {canEdit && !error && !isLoading && (
          <div className="flex items-center gap-3 border-t border-neutral-800 px-4 py-2.5">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="rounded-md bg-status-online px-4 py-1.5 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
            >
              {saveMutation.isPending ? "Speichern…" : "Speichern"}
            </button>
            <button
              onClick={onClose}
              className="text-sm text-neutral-400 hover:text-neutral-200"
            >
              Abbrechen
            </button>
            {saveMutation.isError && (
              <span className="text-sm text-status-error">Speichern fehlgeschlagen.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
