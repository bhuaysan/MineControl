import { WORLD_NAME_REGEX } from "@minecontrol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { ApiRequestError, api } from "../lib/api.js";
import { confirmDialog } from "../lib/confirm.js";
import { formatBytes } from "../lib/format.js";

const inputClass =
  "rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none focus:border-status-online";

function errMessage(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : "Aktion fehlgeschlagen";
}

export function WorldsPanel({ serverId }: { serverId: string }) {
  const { can } = useAuth();
  const isAdmin = can("ADMIN");
  const qc = useQueryClient();
  const key = ["worlds", serverId] as const;
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["servers"] });
    void qc.invalidateQueries({ queryKey: ["server", serverId] });
  };

  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api.listWorlds(serverId),
    refetchInterval: 15_000,
  });

  const switchMut = useMutation({
    mutationFn: (name: string) => api.switchWorld(serverId, name),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({
    mutationFn: (name: string) => api.deleteWorld(serverId, name),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-300">Welten</h3>
        {isLoading && <p className="text-neutral-500">Lade Welten…</p>}
        {error && (
          <p className="text-status-error">
            {errMessage(error)} – der Server muss dafür laufen.
          </p>
        )}
        {data && data.worlds.length > 0 && (
          <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
            {data.worlds.map((w) => (
              <li
                key={w.name}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-neutral-100">{w.name}</span>
                  {w.active && (
                    <span className="rounded bg-status-online/20 px-1.5 py-0.5 text-xs text-status-online">
                      aktiv
                    </span>
                  )}
                  <span className="text-xs text-neutral-500">{formatBytes(w.sizeBytes)}</span>
                </span>
                <span className="flex items-center gap-2">
                  {w.active && (
                    <a
                      href={api.worldDownloadUrl(serverId)}
                      className="rounded-md border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
                    >
                      Download
                    </a>
                  )}
                  {isAdmin && !w.active && (
                    <>
                      <button
                        onClick={() =>
                          void confirmDialog({
                            title: "Welt wechseln",
                            message: `Zur Welt „${w.name}" wechseln? Der Server startet dazu neu.`,
                            confirmLabel: "Wechseln",
                          }).then((ok) => ok && switchMut.mutate(w.name))
                        }
                        disabled={switchMut.isPending}
                        className="rounded-md border border-neutral-700 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                      >
                        Aktivieren
                      </button>
                      <button
                        onClick={() =>
                          void confirmDialog({
                            title: "Welt löschen",
                            message: `Welt „${w.name}" endgültig löschen?`,
                            confirmLabel: "Löschen",
                            danger: true,
                          }).then((ok) => ok && deleteMut.mutate(w.name))
                        }
                        disabled={deleteMut.isPending}
                        className="rounded-md border border-neutral-700 px-2 py-0.5 text-xs text-status-error hover:bg-neutral-800 disabled:opacity-50"
                      >
                        Löschen
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {(switchMut.isError || deleteMut.isError) && (
          <p className="mt-2 text-sm text-status-error">
            {errMessage(switchMut.error ?? deleteMut.error)}
          </p>
        )}
      </section>

      {isAdmin && (
        <>
          <CreateWorldForm serverId={serverId} onDone={invalidate} />
          <UploadWorldForm serverId={serverId} onDone={invalidate} />
        </>
      )}

      {can("MODERATOR") && (
        <PregenPanel serverId={serverId} activeWorld={data?.active} onChange={invalidate} />
      )}
    </div>
  );
}

// ── Neue Welt ─────────────────────────────────────────────────────────────────

function CreateWorldForm({ serverId, onDone }: { serverId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [seed, setSeed] = useState("");
  const mut = useMutation({
    mutationFn: () => api.createWorld(serverId, { name, seed: seed || undefined }),
    onSuccess: () => {
      setName("");
      setSeed("");
      onDone();
    },
  });
  const valid = WORLD_NAME_REGEX.test(name);

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-300">Neue Welt erstellen</h3>
      <p className="mb-3 text-xs text-neutral-500">
        Setzt die aktive Welt neu und startet den Server neu; die Welt wird beim Start generiert.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="world2"
            className={`${inputClass} ${name && !valid ? "border-status-error" : ""}`}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Seed (optional)</span>
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={mut.isPending || !valid}
          className="rounded-md bg-status-online px-3 py-1.5 text-sm font-medium text-neutral-950 hover:brightness-110 disabled:opacity-50"
        >
          {mut.isPending ? "Erstelle…" : "Erstellen & aktivieren"}
        </button>
      </form>
      {mut.isError && <p className="mt-2 text-sm text-status-error">{errMessage(mut.error)}</p>}
    </section>
  );
}

// ── Welt hochladen ─────────────────────────────────────────────────────────────

function UploadWorldForm({ serverId, onDone }: { serverId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const mut = useMutation({
    mutationFn: (file: File) => api.uploadWorld(serverId, name, file),
    onSuccess: () => {
      setName("");
      if (fileRef.current) fileRef.current.value = "";
      onDone();
    },
  });
  const valid = WORLD_NAME_REGEX.test(name);

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-300">Welt hochladen (.tar.gz)</h3>
      <p className="mb-3 text-xs text-neutral-500">
        Ein per „Download" exportiertes Welt-Archiv unter neuem Namen importieren (max. 50 MB).
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const file = fileRef.current?.files?.[0];
          if (file) mut.mutate(file);
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Zielname</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="importierte-welt"
            className={`${inputClass} ${name && !valid ? "border-status-error" : ""}`}
          />
        </label>
        <input
          ref={fileRef}
          type="file"
          required
          accept=".gz,.tgz,application/gzip"
          className="text-sm text-neutral-400 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-neutral-200"
        />
        <button
          type="submit"
          disabled={mut.isPending || !valid}
          className="rounded-md bg-status-online px-3 py-1.5 text-sm font-medium text-neutral-950 hover:brightness-110 disabled:opacity-50"
        >
          {mut.isPending ? "Lade hoch…" : "Hochladen"}
        </button>
      </form>
      {mut.isError && <p className="mt-2 text-sm text-status-error">{errMessage(mut.error)}</p>}
    </section>
  );
}

// ── Pregeneration (Chunky) ──────────────────────────────────────────────────────

function PregenPanel({
  serverId,
  activeWorld,
  onChange,
}: {
  serverId: string;
  activeWorld?: string;
  onChange: () => void;
}) {
  const [radius, setRadius] = useState(1000);
  const start = useMutation({
    mutationFn: () => api.startPregen(serverId, { radius }),
    onSuccess: onChange,
  });
  const cancel = useMutation({ mutationFn: () => api.cancelPregen(serverId) });

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-300">
        Pregeneration (Chunky)
      </h3>
      <p className="mb-3 text-xs text-neutral-500">
        Generiert Chunks im Voraus für die aktive Welt
        {activeWorld ? ` („${activeWorld}")` : ""}. Chunky wird bei Bedarf automatisch
        installiert (dann Server-Neustart). Fortschritt erscheint in der Konsole.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Radius (Blöcke)</span>
          <input
            type="number"
            min={100}
            max={50000}
            step={100}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className={inputClass}
          />
        </label>
        <button
          onClick={() => start.mutate()}
          disabled={start.isPending}
          className="rounded-md bg-status-online px-3 py-1.5 text-sm font-medium text-neutral-950 hover:brightness-110 disabled:opacity-50"
        >
          {start.isPending ? "…" : "Pregen starten"}
        </button>
        <button
          onClick={() => cancel.mutate()}
          disabled={cancel.isPending}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
        >
          Abbrechen
        </button>
      </div>
      {start.data && (
        <p className="mt-2 text-sm text-neutral-400">{start.data.message}</p>
      )}
      {start.isError && (
        <p className="mt-2 text-sm text-status-error">{errMessage(start.error)}</p>
      )}
      {cancel.data && (
        <p className="mt-2 text-sm text-neutral-400">Abgebrochen: {cancel.data.response}</p>
      )}
    </section>
  );
}
