import type { NetworkDto, NetworkProxyEdition, ServerDto } from "@minecontrol/shared";
import {
  BUNGEECORD_SUBSERVER_EDITIONS,
  NETWORK_ALIAS_REGEX,
  NETWORK_PROXY_EDITIONS,
  NETWORK_SUBSERVER_EDITIONS,
} from "@minecontrol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { StatusBadge, StatusDot } from "../components/StatusBadge.js";
import { useAuth } from "../auth/AuthContext.js";
import { useServers } from "../hooks/useServers.js";
import { ApiRequestError, api } from "../lib/api.js";

const inputClass =
  "rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none focus:border-status-online";

function errMessage(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : "Aktion fehlgeschlagen";
}

export function NetworksPage() {
  const { can } = useAuth();
  const isAdmin = can("ADMIN");
  const {
    data: networks,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["networks"],
    queryFn: api.listNetworks,
    refetchInterval: 15_000,
  });
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Netzwerke</h1>
          <p className="text-sm text-neutral-500">
            Velocity-Proxy mit Subservern als Gruppe – Spieler verbinden sich über einen Port.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-md bg-status-online px-3 py-1.5 text-sm font-medium text-neutral-950 hover:brightness-110"
          >
            {showCreate ? "Abbrechen" : "+ Netzwerk erstellen"}
          </button>
        )}
      </div>

      {showCreate && isAdmin && <CreateNetworkForm onDone={() => setShowCreate(false)} />}

      {isLoading && <p className="text-neutral-500">Lade Netzwerke…</p>}
      {error && (
        <p className="text-status-error">Netzwerke konnten nicht geladen werden.</p>
      )}

      {networks && networks.length === 0 && !showCreate && (
        <div className="rounded-lg border border-dashed border-neutral-800 p-10 text-center text-neutral-500">
          Noch kein Netzwerk.{" "}
          {isAdmin
            ? "Erstelle einen Velocity-Proxy, um Server zu bündeln."
            : "Ein Admin kann eines anlegen."}
        </div>
      )}

      <div className="space-y-4">
        {networks?.map((net) => (
          <NetworkCard key={net.id} network={net} isAdmin={isAdmin} />
        ))}
      </div>
    </div>
  );
}

// ── Netzwerk erstellen ─────────────────────────────────────────────────────────

function CreateNetworkForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [proxyName, setProxyName] = useState("");
  const [proxyEdition, setProxyEdition] = useState<NetworkProxyEdition>("VELOCITY");
  const [version, setVersion] = useState("LATEST");
  const [memoryMb, setMemoryMb] = useState(1024);
  const [port, setPort] = useState(25565);
  const isBungee = proxyEdition === "BUNGEECORD";

  const mutation = useMutation({
    mutationFn: () =>
      api.createNetwork({
        name,
        proxyName: proxyName || name,
        proxyEdition,
        version,
        memoryMb,
        port,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["networks"] });
      void qc.invalidateQueries({ queryKey: ["servers"] });
      onDone();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="mb-6 space-y-4 rounded-lg border border-neutral-800 bg-neutral-900 p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Netzwerkname</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mein Netzwerk"
            className={`w-full ${inputClass}`}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Proxy-Servername</span>
          <input
            value={proxyName}
            onChange={(e) => setProxyName(e.target.value)}
            placeholder="(wie Netzwerkname)"
            className={`w-full ${inputClass}`}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Proxy-Software</span>
          <select
            value={proxyEdition}
            onChange={(e) => setProxyEdition(e.target.value as NetworkProxyEdition)}
            className={`w-full ${inputClass}`}
          >
            {NETWORK_PROXY_EDITIONS.map((ed) => (
              <option key={ed} value={ed}>
                {ed === "VELOCITY" ? "Velocity (auch modded Subserver)" : "BungeeCord (nur Paper/Spigot)"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">
            Velocity-Version{isBungee ? " (nicht relevant)" : ""}
          </span>
          <input
            value={version}
            disabled={isBungee}
            onChange={(e) => setVersion(e.target.value)}
            className={`w-full ${inputClass} ${isBungee ? "opacity-50" : ""}`}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Port (Netzwerk-Eingang)</span>
          <input
            type="number"
            required
            value={port}
            min={1024}
            max={65535}
            onChange={(e) => setPort(Number(e.target.value))}
            className={`w-full ${inputClass}`}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Proxy-RAM: {memoryMb} MB</span>
          <input
            type="range"
            min={256}
            max={4096}
            step={256}
            value={memoryMb}
            onChange={(e) => setMemoryMb(Number(e.target.value))}
            className="w-full"
          />
        </label>
      </div>
      {mutation.isError && (
        <p className="text-sm text-status-error">{errMessage(mutation.error)}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-status-online px-4 py-1.5 text-sm font-medium text-neutral-950 hover:brightness-110 disabled:opacity-50"
        >
          {mutation.isPending ? "Erstelle…" : "Netzwerk erstellen"}
        </button>
      </div>
    </form>
  );
}

// ── Netzwerk-Karte ───────────────────────────────────────────────────────────

function NetworkCard({ network, isAdmin }: { network: NetworkDto; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["networks"] });
    void qc.invalidateQueries({ queryKey: ["servers"] });
  };

  const detach = useMutation({
    mutationFn: (serverId: string) => api.detachSubserver(network.id, serverId),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteNetwork(network.id),
    onSuccess: invalidate,
  });

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">🕸</span>
            <h2 className="truncate text-lg font-semibold">{network.name}</h2>
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
              {network.proxy.edition === "BUNGEECORD" ? "BungeeCord" : "Velocity"}
            </span>
          </div>
          <Link
            to={`/servers/${network.proxy.serverId}`}
            className="text-sm text-neutral-400 hover:text-neutral-200"
          >
            Proxy: {network.proxy.name} · {network.proxy.host}:{network.proxy.port}
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge state={network.proxy.state} />
          {isAdmin && (
            <button
              onClick={() => {
                if (
                  confirm(
                    `Netzwerk „${network.name}" löschen? Der Proxy wird entfernt, die Subserver bleiben als eigenständige Server erhalten.`,
                  )
                )
                  remove.mutate();
              }}
              disabled={remove.isPending}
              className="rounded-md border border-neutral-700 px-2.5 py-1 text-sm text-status-error hover:bg-neutral-800 disabled:opacity-50"
            >
              Löschen
            </button>
          )}
        </div>
      </div>

      <div className="p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-600">
          Subserver ({network.members.length})
        </p>
        {network.members.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Noch keine Subserver zugeordnet.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-800 rounded-md border border-neutral-800">
            {network.members.map((m) => (
              <li
                key={m.serverId}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <StatusDot state={m.state} />
                  <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-status-online">
                    {m.alias}
                  </code>
                  <Link
                    to={`/servers/${m.serverId}`}
                    className="truncate text-sm hover:text-neutral-200"
                  >
                    {m.name}
                  </Link>
                  <span className="text-xs text-neutral-600">{m.edition}</span>
                </span>
                {isAdmin && (
                  <button
                    onClick={() => {
                      if (confirm(`„${m.name}" aus dem Netzwerk lösen?`))
                        detach.mutate(m.serverId);
                    }}
                    disabled={detach.isPending}
                    className="shrink-0 rounded-md border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Lösen
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {detach.isError && (
          <p className="mt-2 text-sm text-status-error">{errMessage(detach.error)}</p>
        )}
        {remove.isError && (
          <p className="mt-2 text-sm text-status-error">{errMessage(remove.error)}</p>
        )}

        {isAdmin && (
          <div className="mt-3">
            {adding ? (
              <AddSubserverForm
                network={network}
                onDone={() => {
                  setAdding(false);
                  invalidate();
                }}
              />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                + Subserver hinzufügen
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Subserver hinzufügen (anhängen oder neu) ───────────────────────────────────

function AddSubserverForm({
  network,
  onDone,
}: {
  network: NetworkDto;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const { data: servers } = useServers();
  const { data: networks } = useQuery({ queryKey: ["networks"], queryFn: api.listNetworks });
  const [mode, setMode] = useState<"attach" | "create">("attach");
  const [alias, setAlias] = useState("");

  // Editionen, die dieser Proxy überhaupt unterstützt (BungeeCord: kein Modern
  // Forwarding für modded Server, daher nur Paper/Spigot).
  const allowedEditions =
    network.proxy.edition === "BUNGEECORD"
      ? BUNGEECORD_SUBSERVER_EDITIONS
      : NETWORK_SUBSERVER_EDITIONS;

  // Anhängbar: passende Docker-Server, die noch keinem Netzwerk / Proxy angehören.
  const usedIds = useMemo(() => {
    const set = new Set<string>();
    for (const net of networks ?? []) {
      set.add(net.proxy.serverId);
      for (const m of net.members) set.add(m.serverId);
    }
    return set;
  }, [networks]);
  const eligible = (servers ?? []).filter(
    (s: ServerDto) =>
      s.type === "DOCKER" &&
      (allowedEditions as readonly string[]).includes(s.edition) &&
      !usedIds.has(s.id),
  );

  const [serverId, setServerId] = useState("");
  // create-Felder
  const [name, setName] = useState("");
  const [edition, setEdition] = useState<(typeof NETWORK_SUBSERVER_EDITIONS)[number]>(
    allowedEditions[0],
  );
  const [version, setVersion] = useState("LATEST");
  const [memoryMb, setMemoryMb] = useState(2048);
  const [port, setPort] = useState(25566);

  const aliasValid = NETWORK_ALIAS_REGEX.test(alias);

  const mutation = useMutation({
    mutationFn: () =>
      mode === "attach"
        ? api.addSubserver(network.id, { mode: "attach", serverId, alias })
        : api.addSubserver(network.id, {
            mode: "create",
            alias,
            name,
            edition,
            version,
            memoryMb,
            port,
          }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["networks"] });
      onDone();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="space-y-3 rounded-md border border-neutral-800 bg-neutral-950/60 p-3"
    >
      <div className="flex gap-2 text-sm">
        {(["attach", "create"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1 ${
              mode === m
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-400 hover:bg-neutral-800/60"
            }`}
          >
            {m === "attach" ? "Bestehenden anhängen" : "Neu erstellen"}
          </button>
        ))}
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-neutral-400">
          Alias (Proxy-Servername, klein/kurz)
        </span>
        <input
          required
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          placeholder="lobby"
          className={`w-full ${inputClass} ${
            alias && !aliasValid ? "border-status-error" : ""
          }`}
        />
      </label>

      {mode === "attach" ? (
        eligible.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Kein freier passender Docker-Server verfügbar ({allowedEditions.join("/")}).
          </p>
        ) : (
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-400">Server</span>
            <select
              required
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              className={`w-full ${inputClass}`}
            >
              <option value="">– wählen –</option>
              {eligible.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.edition})
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-neutral-600">
              Paper/Spigot-Server müssen einmal gestartet worden sein; modded Server
              werden beim Anhängen automatisch vorbereitet (Forwarding-Mod-Install +
              Neustarts).
            </span>
          </label>
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-neutral-400">Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`w-full ${inputClass}`}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-neutral-400">Edition</span>
            <select
              value={edition}
              onChange={(e) =>
                setEdition(e.target.value as (typeof NETWORK_SUBSERVER_EDITIONS)[number])
              }
              className={`w-full ${inputClass}`}
            >
              {allowedEditions.map((ed) => (
                <option key={ed} value={ed}>
                  {ed}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-neutral-400">Version</span>
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className={`w-full ${inputClass}`}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-neutral-400">Port</span>
            <input
              type="number"
              required
              value={port}
              min={1024}
              max={55535}
              onChange={(e) => setPort(Number(e.target.value))}
              className={`w-full ${inputClass}`}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-neutral-400">RAM: {memoryMb} MB</span>
            <input
              type="range"
              min={512}
              max={8192}
              step={512}
              value={memoryMb}
              onChange={(e) => setMemoryMb(Number(e.target.value))}
              className="w-full"
            />
          </label>
        </div>
      )}

      {mutation.isError && (
        <p className="text-sm text-status-error">{errMessage(mutation.error)}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={mutation.isPending || !aliasValid}
          className="rounded-md bg-status-online px-3 py-1.5 text-sm font-medium text-neutral-950 hover:brightness-110 disabled:opacity-50"
        >
          {mutation.isPending ? "…" : mode === "attach" ? "Anhängen" : "Erstellen"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
        >
          Abbrechen
        </button>
      </div>
    </form>
  );
}
