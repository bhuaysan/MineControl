import type {
  ConnectionTestResult,
  DockerEdition,
  ServerEdition,
} from "@minecontrol/shared";
import {
  DIFFICULTIES,
  DOCKER_EDITIONS,
  GAMEMODES,
  SERVER_EDITIONS,
} from "@minecontrol/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { serversQueryKey } from "../hooks/useServers.js";
import { api } from "../lib/api.js";

const inputClass =
  "w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-status-online";

type Mode = "docker" | "external";

export function AddServerPage() {
  const [mode, setMode] = useState<Mode>("docker");

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">Server hinzufügen</h1>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <ModeCard
          active={mode === "docker"}
          onClick={() => setMode("docker")}
          title="Neu erstellen"
          subtitle="Docker-Container (itzg)"
          icon="🐳"
        />
        <ModeCard
          active={mode === "external"}
          onClick={() => setMode("external")}
          title="Extern verbinden"
          subtitle="Bestehender Server (RCON)"
          icon="🔌"
        />
      </div>

      {mode === "docker" ? <DockerForm /> : <ExternalForm />}
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  title,
  subtitle,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  icon: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-4 text-left transition-colors ${
        active
          ? "border-status-online bg-status-online/5"
          : "border-neutral-800 hover:border-neutral-700"
      }`}
    >
      <div className="text-2xl">{icon}</div>
      <div className="mt-2 font-medium text-neutral-100">{title}</div>
      <div className="text-xs text-neutral-500">{subtitle}</div>
    </button>
  );
}

// ── Docker-Wizard ────────────────────────────────────────────────────────────

function DockerForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [edition, setEdition] = useState<DockerEdition>("PAPER");
  const [version, setVersion] = useState("LATEST");
  const [memoryMb, setMemoryMb] = useState(2048);
  const [port, setPort] = useState(25565);
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>("normal");
  const [gamemode, setGamemode] = useState<(typeof GAMEMODES)[number]>("survival");
  const [seed, setSeed] = useState("");
  const [motd, setMotd] = useState("");
  const [onlineMode, setOnlineMode] = useState(false);
  const [modpack, setModpack] = useState("");
  const [cfModpack, setCfModpack] = useState("");
  const [eula, setEula] = useState(false);
  const usingModrinth = modpack.trim().length > 0;
  const usingCurseforge = cfModpack.trim().length > 0;
  const usingModpack = usingModrinth || usingCurseforge;

  const createMutation = useMutation({
    mutationFn: () =>
      api.createDockerServer({
        name,
        edition,
        version: version.trim() || "LATEST",
        memoryMb,
        port,
        difficulty,
        gamemode,
        seed: seed.trim() || undefined,
        motd: motd.trim() || undefined,
        onlineMode,
        eula: true,
        modrinthModpack: modpack.trim() || undefined,
        curseforgeModpack: cfModpack.trim() || undefined,
      }),
    onSuccess: (server) => {
      void queryClient.invalidateQueries({ queryKey: serversQueryKey });
      navigate(`/servers/${server.id}`);
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (eula) createMutation.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Anzeigename">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={inputClass}
          placeholder="z. B. Survival"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Edition">
          <select
            value={edition}
            onChange={(e) => setEdition(e.target.value as DockerEdition)}
            className={inputClass}
          >
            {DOCKER_EDITIONS.map((ed) => (
              <option key={ed} value={ed}>
                {ed}
              </option>
            ))}
          </select>
        </Field>
        <Field label="MC-Version">
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            disabled={usingModpack}
            className={`${inputClass} ${usingModpack ? "opacity-50" : ""}`}
            placeholder="LATEST oder 1.21.1"
          />
        </Field>
      </div>

      <Field label="Modrinth-Modpack (optional)">
        <input
          value={modpack}
          onChange={(e) => setModpack(e.target.value)}
          disabled={usingCurseforge}
          className={`${inputClass} ${usingCurseforge ? "opacity-50" : ""}`}
          placeholder="z. B. cobblemon oder .mrpack-URL"
        />
      </Field>

      <Field label="CurseForge-Modpack (optional)">
        <input
          value={cfModpack}
          onChange={(e) => setCfModpack(e.target.value)}
          disabled={usingModrinth}
          className={`${inputClass} ${usingModrinth ? "opacity-50" : ""}`}
          placeholder="z. B. all-the-mods-9 oder Modpack-URL"
        />
        {usingModpack && (
          <p className="mt-1 text-xs text-neutral-500">
            Der Pack bestimmt Loader &amp; Version. Wähle die Edition passend zum
            Pack-Loader (meist FORGE/FABRIC/NEOFORGE), damit der Plugins/Mods-Tab
            funktioniert. Der erste Start dauert länger (Pack-Download).
          </p>
        )}
      </Field>

      <Field label={`Arbeitsspeicher: ${(memoryMb / 1024).toFixed(1)} GB`}>
        <input
          type="range"
          min={512}
          max={8192}
          step={512}
          value={memoryMb}
          onChange={(e) => setMemoryMb(Number(e.target.value))}
          className="w-full accent-status-online"
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Port">
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Schwierigkeit">
          <select
            value={difficulty}
            onChange={(e) =>
              setDifficulty(e.target.value as (typeof DIFFICULTIES)[number])
            }
            className={inputClass}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Spielmodus">
          <select
            value={gamemode}
            onChange={(e) => setGamemode(e.target.value as (typeof GAMEMODES)[number])}
            className={inputClass}
          >
            {GAMEMODES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Welt-Seed (optional)">
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            className={inputClass}
            placeholder="leer = zufällig"
          />
        </Field>
        <Field label="MOTD (optional)">
          <input
            value={motd}
            onChange={(e) => setMotd(e.target.value)}
            className={inputClass}
            placeholder="Anzeigename verwenden"
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={onlineMode}
          onChange={(e) => setOnlineMode(e.target.checked)}
          className="size-4 accent-status-online"
        />
        Online-Modus (Mojang-Authentifizierung)
      </label>

      <label className="flex items-start gap-2 rounded-md border border-neutral-800 p-3 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={eula}
          onChange={(e) => setEula(e.target.checked)}
          className="mt-0.5 size-4 accent-status-online"
        />
        <span>
          Ich akzeptiere die{" "}
          <a
            href="https://www.minecraft.net/eula"
            target="_blank"
            rel="noreferrer"
            className="text-status-online hover:underline"
          >
            Minecraft-EULA
          </a>
          .
        </span>
      </label>

      {createMutation.isError && (
        <p className="text-sm text-status-error">
          {(createMutation.error as Error).message ||
            "Server konnte nicht erstellt werden."}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={!eula || createMutation.isPending}
          className="rounded-md bg-status-online px-4 py-2 font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
        >
          {createMutation.isPending ? "Erstelle…" : "Server erstellen"}
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
  );
}

// ── Extern verbinden (Phase 1) ───────────────────────────────────────────────

function ExternalForm() {
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

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Anzeigename">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={inputClass}
          placeholder="z. B. SMP"
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="Host">
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              required
              className={inputClass}
              placeholder="mc.beispiel.de"
            />
          </Field>
        </div>
        <Field label="Port">
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Edition">
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
      </Field>

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
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-neutral-400">{label}</span>
      {children}
    </label>
  );
}
