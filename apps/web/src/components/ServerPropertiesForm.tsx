import { DIFFICULTIES, GAMEMODES } from "@minecontrol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api.js";

type FieldKind = "text" | "number" | "bool" | "difficulty" | "gamemode";

interface Field {
  key: string;
  label: string;
  kind: FieldKind;
}

/** Kuratierte, editierbare server.properties-Felder mit Eingabetyp. */
const FIELDS: Field[] = [
  { key: "motd", label: "MOTD", kind: "text" },
  { key: "difficulty", label: "Schwierigkeit", kind: "difficulty" },
  { key: "gamemode", label: "Spielmodus", kind: "gamemode" },
  { key: "max-players", label: "Max. Spieler", kind: "number" },
  { key: "view-distance", label: "Sichtweite", kind: "number" },
  { key: "simulation-distance", label: "Simulationsdistanz", kind: "number" },
  { key: "spawn-protection", label: "Spawn-Schutz", kind: "number" },
  { key: "pvp", label: "PvP", kind: "bool" },
  { key: "online-mode", label: "Online-Modus", kind: "bool" },
  { key: "allow-nether", label: "Nether erlauben", kind: "bool" },
  { key: "allow-flight", label: "Fliegen erlauben", kind: "bool" },
  { key: "hardcore", label: "Hardcore", kind: "bool" },
  { key: "white-list", label: "Whitelist aktiv", kind: "bool" },
  { key: "enforce-whitelist", label: "Whitelist erzwingen", kind: "bool" },
];

const inputClass =
  "w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none focus:border-status-online";

/**
 * Formular für server.properties eines Docker-Servers. Lädt die aktuellen
 * Werte, speichert nur geänderte Schlüssel zurück. Änderungen wirken nach
 * dem nächsten (Neu-)Start des Servers.
 */
export function ServerPropertiesForm({
  serverId,
  canEdit,
}: {
  serverId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["server", serverId, "properties"],
    queryFn: () => api.getProperties(serverId),
  });

  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (data) setValues(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: (changed: Record<string, string>) =>
      api.updateProperties(serverId, changed),
    onSuccess: (fresh) => {
      setValues(fresh);
      void queryClient.invalidateQueries({
        queryKey: ["server", serverId, "properties"],
      });
    },
  });

  const set = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Nur tatsächlich geänderte Schlüssel senden.
    const changed: Record<string, string> = {};
    for (const field of FIELDS) {
      const current = values[field.key] ?? "";
      if (data && current !== (data[field.key] ?? "")) changed[field.key] = current;
    }
    if (Object.keys(changed).length > 0) mutation.mutate(changed);
  };

  if (isLoading) return <p className="text-sm text-neutral-500">Lade Einstellungen…</p>;
  if (error) {
    return (
      <p className="text-sm text-status-error">
        server.properties konnte nicht gelesen werden. Der Server muss dafür
        mindestens einmal erstellt worden sein.
      </p>
    );
  }

  const empty = data && Object.keys(data).length === 0;

  return (
    <form onSubmit={onSubmit}>
      {empty && (
        <p className="mb-3 text-sm text-neutral-500">
          Noch keine server.properties vorhanden – der Server generiert sie beim
          ersten Start.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => {
          const value = values[field.key] ?? "";
          return (
            <label key={field.key} className="block text-sm">
              <span className="mb-1 block text-neutral-400">{field.label}</span>
              {field.kind === "bool" ? (
                <select
                  value={value || "false"}
                  disabled={!canEdit}
                  onChange={(e) => set(field.key, e.target.value)}
                  className={inputClass}
                >
                  <option value="true">an</option>
                  <option value="false">aus</option>
                </select>
              ) : field.kind === "difficulty" ? (
                <select
                  value={value || "normal"}
                  disabled={!canEdit}
                  onChange={(e) => set(field.key, e.target.value)}
                  className={inputClass}
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              ) : field.kind === "gamemode" ? (
                <select
                  value={value || "survival"}
                  disabled={!canEdit}
                  onChange={(e) => set(field.key, e.target.value)}
                  className={inputClass}
                >
                  {GAMEMODES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.kind === "number" ? "number" : "text"}
                  value={value}
                  disabled={!canEdit}
                  onChange={(e) => set(field.key, e.target.value)}
                  className={inputClass}
                />
              )}
            </label>
          );
        })}
      </div>

      {canEdit && (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-md bg-status-online px-4 py-2 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
          >
            {mutation.isPending ? "Speichern…" : "Speichern"}
          </button>
          <span className="text-xs text-neutral-500">
            Wirkt nach dem nächsten Neustart des Servers.
          </span>
          {mutation.isError && (
            <span className="text-xs text-status-error">Speichern fehlgeschlagen.</span>
          )}
          {mutation.isSuccess && (
            <span className="text-xs text-status-online">Gespeichert.</span>
          )}
        </div>
      )}
    </form>
  );
}
