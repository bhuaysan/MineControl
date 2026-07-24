import type { ConnectionTestResult, DockerEdition, ServerEdition } from "@minecontrol/shared";
import { DIFFICULTIES, DOCKER_EDITIONS, GAMEMODES, SERVER_EDITIONS } from "@minecontrol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { serversQueryKey } from "../hooks/useServers.js";
import { api } from "../lib/api.js";
import { formatBytes } from "../lib/format.js";

const inputClass =
  "w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-status-online";

type Mode = "docker" | "external";

export function AddServerPage() {
  const { t } = useTranslation("addServer");
  const [mode, setMode] = useState<Mode>("docker");

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">{t("title")}</h1>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <ModeCard
          active={mode === "docker"}
          onClick={() => setMode("docker")}
          title={t("mode.dockerTitle")}
          subtitle={t("mode.dockerSubtitle")}
          icon="🐳"
        />
        <ModeCard
          active={mode === "external"}
          onClick={() => setMode("external")}
          title={t("mode.externalTitle")}
          subtitle={t("mode.externalSubtitle")}
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
  const { t } = useTranslation("addServer");
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
  const [importEnabled, setImportEnabled] = useState(false);
  const [importMode, setImportMode] = useState<"upload" | "path">("upload");
  const [stagingId, setStagingId] = useState<string | null>(null);
  const [pathFilename, setPathFilename] = useState("");
  const usingModrinth = modpack.trim().length > 0;
  const usingCurseforge = cfModpack.trim().length > 0;
  const usingModpack = usingModrinth || usingCurseforge;

  // Beim Import stammen Welt & Spielparameter aus dem Archiv — deshalb werden
  // seed/difficulty/gamemode nicht mitgeschickt (itzg behält die importierte
  // server.properties). Modpack + Import schließen sich aus.
  // Import und Modpack schließen sich aus (Modpack setzt TYPE/VERSION selbst).
  const importSource =
    usingModpack || !importEnabled
      ? undefined
      : importMode === "upload" && stagingId
        ? ({ source: "upload", stagingId } as const)
        : importMode === "path" && pathFilename
          ? ({ source: "path", filename: pathFilename } as const)
          : undefined;

  const createMutation = useMutation({
    mutationFn: () =>
      api.createDockerServer({
        name,
        edition,
        version: version.trim() || "LATEST",
        memoryMb,
        port,
        difficulty: importSource ? undefined : difficulty,
        gamemode: importSource ? undefined : gamemode,
        seed: importSource ? undefined : seed.trim() || undefined,
        motd: motd.trim() || undefined,
        onlineMode,
        eula: true,
        modrinthModpack: modpack.trim() || undefined,
        curseforgeModpack: cfModpack.trim() || undefined,
        import: importSource,
      }),
    onSuccess: (server) => {
      void queryClient.invalidateQueries({ queryKey: serversQueryKey });
      navigate(`/servers/${server.id}`);
    },
  });

  const importIncomplete = importEnabled && !usingModpack && !importSource;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (eula && !importIncomplete) createMutation.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label={t("displayName")}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={inputClass}
          placeholder={t("docker.namePlaceholder")}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("docker.edition")}>
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
        <Field label={t("docker.mcVersion")}>
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            disabled={usingModpack}
            className={`${inputClass} ${usingModpack ? "opacity-50" : ""}`}
            placeholder={t("docker.mcVersionPlaceholder")}
          />
        </Field>
      </div>

      <Field label={t("docker.modrinth")}>
        <input
          value={modpack}
          onChange={(e) => setModpack(e.target.value)}
          disabled={usingCurseforge}
          className={`${inputClass} ${usingCurseforge ? "opacity-50" : ""}`}
          placeholder={t("docker.modrinthPlaceholder")}
        />
      </Field>

      <Field label={t("docker.curseforge")}>
        <input
          value={cfModpack}
          onChange={(e) => setCfModpack(e.target.value)}
          disabled={usingModrinth}
          className={`${inputClass} ${usingModrinth ? "opacity-50" : ""}`}
          placeholder={t("docker.curseforgePlaceholder")}
        />
        {usingModpack && <p className="mt-1 text-xs text-neutral-500">{t("docker.modpackHint")}</p>}
      </Field>

      <Field label={t("docker.memory", { gb: (memoryMb / 1024).toFixed(1) })}>
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
        <Field label={t("docker.port")}>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label={t("docker.difficulty")}>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as (typeof DIFFICULTIES)[number])}
            disabled={importEnabled}
            className={`${inputClass} ${importEnabled ? "opacity-50" : ""}`}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("docker.gamemode")}>
          <select
            value={gamemode}
            onChange={(e) => setGamemode(e.target.value as (typeof GAMEMODES)[number])}
            disabled={importEnabled}
            className={`${inputClass} ${importEnabled ? "opacity-50" : ""}`}
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
        <Field label={t("docker.seed")}>
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            disabled={importEnabled}
            className={`${inputClass} ${importEnabled ? "opacity-50" : ""}`}
            placeholder={t("docker.seedPlaceholder")}
          />
        </Field>
        <Field label={t("docker.motd")}>
          <input
            value={motd}
            onChange={(e) => setMotd(e.target.value)}
            className={inputClass}
            placeholder={t("docker.motdPlaceholder")}
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
        {t("docker.onlineMode")}
      </label>

      {!usingModpack && (
        <ImportSection
          enabled={importEnabled}
          setEnabled={setImportEnabled}
          mode={importMode}
          setMode={setImportMode}
          stagingId={stagingId}
          setStagingId={setStagingId}
          pathFilename={pathFilename}
          setPathFilename={setPathFilename}
        />
      )}

      <label className="flex items-start gap-2 rounded-md border border-neutral-800 p-3 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={eula}
          onChange={(e) => setEula(e.target.checked)}
          className="mt-0.5 size-4 accent-status-online"
        />
        <span>
          <Trans
            t={t}
            i18nKey="docker.eula"
            components={[
              <a
                key="eula"
                href="https://www.minecraft.net/eula"
                target="_blank"
                rel="noreferrer"
                className="text-status-online hover:underline"
              />,
            ]}
          />
        </span>
      </label>

      {importIncomplete && (
        <p className="text-sm text-status-pending">{t("docker.importIncomplete")}</p>
      )}

      {createMutation.isError && (
        <p className="text-sm text-status-error">
          {(createMutation.error as Error).message || t("docker.createError")}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={!eula || importIncomplete || createMutation.isPending}
          className="rounded-md bg-status-online px-4 py-2 font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
        >
          {createMutation.isPending ? t("docker.creating") : t("docker.submit")}
        </button>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="rounded-md px-4 py-2 text-neutral-400 hover:text-neutral-200"
        >
          {t("common:actions.cancel")}
        </button>
      </div>
    </form>
  );
}

// ── Import bestehender Welt / Server ─────────────────────────────────────────

function ImportSection({
  enabled,
  setEnabled,
  mode,
  setMode,
  stagingId,
  setStagingId,
  pathFilename,
  setPathFilename,
}: {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  mode: "upload" | "path";
  setMode: (v: "upload" | "path") => void;
  stagingId: string | null;
  setStagingId: (v: string | null) => void;
  pathFilename: string;
  setPathFilename: (v: string) => void;
}) {
  const { t } = useTranslation("addServer");
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const sourcesQuery = useQuery({
    queryKey: ["import-sources"],
    queryFn: () => api.listImportSources(),
    enabled: enabled && mode === "path",
  });

  const upload = useMutation({
    mutationFn: (file: File) => api.stageImport(file, setProgress),
    onMutate: () => {
      setProgress(0);
      setStagingId(null);
    },
    onSuccess: (res) => {
      setProgress(null);
      setStagingId(res.stagingId);
    },
    onError: () => setProgress(null),
  });

  return (
    <fieldset className="rounded-md border border-neutral-800 p-3">
      <legend className="px-1">
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-4 accent-status-online"
          />
          {t("import.toggle")}
        </label>
      </legend>

      {enabled && (
        <div className="space-y-3 pt-1">
          <p className="text-xs text-neutral-500">
            <Trans
              t={t}
              i18nKey="import.description"
              components={[
                <code key="0" />,
                <code key="1" />,
                <code key="2" />,
                <code key="3" />,
                <code key="4" />,
                <code key="5" />,
              ]}
            />
          </p>

          <div className="flex gap-4 text-sm text-neutral-300">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="importMode"
                checked={mode === "upload"}
                onChange={() => setMode("upload")}
                className="accent-status-online"
              />
              {t("import.modeUpload")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="importMode"
                checked={mode === "path"}
                onChange={() => setMode("path")}
                className="accent-status-online"
              />
              {t("import.modePath")}
            </label>
          </div>

          {mode === "upload" ? (
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept=".gz,.tgz,application/gzip"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload.mutate(file);
                }}
                className="text-sm text-neutral-400 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-neutral-200"
              />
              {progress !== null && (
                <div className="h-1.5 w-full overflow-hidden rounded bg-neutral-800">
                  <div
                    className="h-full bg-status-online transition-all"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              )}
              {stagingId && progress === null && (
                <p className="text-xs text-status-online">{t("import.uploaded")}</p>
              )}
              {upload.isError && (
                <p className="text-xs text-status-error">
                  {(upload.error as Error).message || t("import.uploadFailed")}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {sourcesQuery.isLoading && (
                <p className="text-xs text-neutral-500">{t("import.loadingFiles")}</p>
              )}
              {sourcesQuery.data && sourcesQuery.data.length === 0 && (
                <p className="text-xs text-neutral-500">{t("import.noArchives")}</p>
              )}
              {sourcesQuery.data && sourcesQuery.data.length > 0 && (
                <select
                  value={pathFilename}
                  onChange={(e) => setPathFilename(e.target.value)}
                  className={inputClass}
                >
                  <option value="">{t("import.chooseFile")}</option>
                  {sourcesQuery.data.map((s) => (
                    <option key={s.filename} value={s.filename}>
                      {s.filename} ({formatBytes(s.sizeBytes)})
                    </option>
                  ))}
                </select>
              )}
              {sourcesQuery.isError && (
                <p className="text-xs text-status-error">{t("import.readError")}</p>
              )}
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}

// ── Extern verbinden (Phase 1) ───────────────────────────────────────────────

function ExternalForm() {
  const { t } = useTranslation("addServer");
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
      <Field label={t("displayName")}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={inputClass}
          placeholder={t("external.namePlaceholder")}
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label={t("external.host")}>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              required
              className={inputClass}
              placeholder={t("external.hostPlaceholder")}
            />
          </Field>
        </div>
        <Field label={t("external.port")}>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label={t("external.edition")}>
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
        <legend className="px-1 text-sm text-neutral-400">{t("external.rconLegend")}</legend>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">{t("external.rconPort")}</label>
            <input
              type="number"
              value={rconPort}
              onChange={(e) => setRconPort(e.target.value === "" ? "" : Number(e.target.value))}
              className={inputClass}
              placeholder={t("external.rconPortPlaceholder")}
            />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-neutral-500">
              {t("external.rconPassword")}
            </label>
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
          {testMutation.isPending ? t("external.testing") : t("external.test")}
        </button>

        {test && (
          <span className="text-sm">
            {t("external.ping")}
            {test.ping.ok ? (
              <span className="text-status-online">
                {t("external.pingOk", { ms: test.ping.latencyMs })}
              </span>
            ) : (
              <span className="text-status-error">{t("external.failed")}</span>
            )}
            {test.rcon && (
              <>
                {t("external.rconLabel")}
                {test.rcon.ok ? (
                  <span className="text-status-online">{t("external.ok")}</span>
                ) : (
                  <span className="text-status-error">{t("external.failed")}</span>
                )}
              </>
            )}
          </span>
        )}
      </div>

      {createMutation.isError && (
        <p className="text-sm text-status-error">{t("external.createError")}</p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded-md bg-status-online px-4 py-2 font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
        >
          {createMutation.isPending ? t("external.saving") : t("external.submit")}
        </button>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="rounded-md px-4 py-2 text-neutral-400 hover:text-neutral-200"
        >
          {t("common:actions.cancel")}
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
