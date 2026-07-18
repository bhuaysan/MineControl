import type { ConnectionTestResult, ServerEdition } from "@minecontrol/shared";
import { SERVER_EDITIONS } from "@minecontrol/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { serversQueryKey } from "../hooks/useServers.js";

export function AddServerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(25565);
  const [edition, setEdition] = useState<ServerEdition>("PAPER");
  const [rconPort, setRconPort] = useState<number | "">("");
  const [rconPassword, setRconPassword] = useState("");
  const [test, setTest] = useState<ConnectionTestResult | null>(null);

  const testMutation = useMutation({
    mutationFn: () =>
      api.testConnection({
        host,
        port,
        rconPort: rconPort === "" ? undefined : rconPort,
        rconPassword: rconPassword || undefined,
      }),
    onSuccess: setTest,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.createExternalServer({
        name,
        host,
        port,
        edition,
        rconPort: rconPort === "" ? undefined : rconPort,
        rconPassword: rconPassword || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: serversQueryKey });
      navigate("/");
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    createMutation.mutate();
  };

  const inputClass =
    "w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-status-online";

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">Externen Server verbinden</h1>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-neutral-400">Anzeigename</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={inputClass}
            placeholder="z. B. SMP"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-sm text-neutral-400">Host</label>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              required
              className={inputClass}
              placeholder="mc.beispiel.de"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-neutral-400">Port</label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm text-neutral-400">Edition</label>
          <select
            value={edition}
            onChange={(e) => setEdition(e.target.value as ServerEdition)}
            className={inputClass}
          >
            {SERVER_EDITIONS.map((ed) => (
              <option key={ed} value={ed}>
                {ed}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="rounded-md border border-neutral-800 p-3">
          <legend className="px-1 text-sm text-neutral-400">
            RCON (optional – für Befehle & Stop)
          </legend>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Port</label>
              <input
                type="number"
                value={rconPort}
                onChange={(e) =>
                  setRconPort(e.target.value === "" ? "" : Number(e.target.value))
                }
                className={inputClass}
                placeholder="25575"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-neutral-500">Passwort</label>
              <input
                type="password"
                value={rconPassword}
                onChange={(e) => setRconPassword(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        </fieldset>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => testMutation.mutate()}
            disabled={!host || testMutation.isPending}
            className="rounded-md border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50"
          >
            {testMutation.isPending ? "Teste…" : "Verbindung testen"}
          </button>

          {test && (
            <span className="text-sm">
              Ping:{" "}
              {test.ping.ok ? (
                <span className="text-status-online">OK ({test.ping.latencyMs} ms)</span>
              ) : (
                <span className="text-status-error">fehlgeschlagen</span>
              )}
              {test.rcon && (
                <>
                  {" · RCON: "}
                  {test.rcon.ok ? (
                    <span className="text-status-online">OK</span>
                  ) : (
                    <span className="text-status-error">fehlgeschlagen</span>
                  )}
                </>
              )}
            </span>
          )}
        </div>

        {createMutation.isError && (
          <p className="text-sm text-status-error">
            Server konnte nicht gespeichert werden.
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-status-online px-4 py-2 font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
          >
            {createMutation.isPending ? "Speichern…" : "Server hinzufügen"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="rounded-md px-4 py-2 text-neutral-400 hover:text-neutral-200"
          >
            Abbrechen
          </button>
        </div>
      </form>
    </div>
  );
}
