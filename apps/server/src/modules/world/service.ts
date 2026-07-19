import { gunzipSync } from "node:zlib";
import type { Server } from "@prisma/client";
import * as tar from "tar-stream";
import type { PregenResponse, WorldDto, WorldListResponse } from "@minecontrol/shared";
import { WORLD_NAME_REGEX } from "@minecontrol/shared";
import { containerName, docker } from "../../adapters/dockerClient.js";
import { createAdapter, createDockerAdapter } from "../../adapters/registry.js";
import { suppressDownAlert } from "../metrics/service.js";
import { installMod, listInstalledMods } from "../mods/service.js";
import { readServerProperties, writeServerProperties } from "../servers/docker.js";
import { broadcastServerStatus, reattachServerStreams } from "../../ws/index.js";

/** UID/GID der itzg-Container (Dateien müssen dem Container-User gehören). */
const CONTAINER_UID = 1000;

/** Editionen, die als Welt-Server mit Plugins/Mods (inkl. Chunky) laufen. */
const MODDABLE = ["PAPER", "SPIGOT", "FABRIC", "FORGE", "NEOFORGE"];

/** Fehler mit HTTP-Status für die Route-Schicht. */
export class WorldError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function ensureDocker(server: Server): void {
  if (server.type !== "DOCKER") {
    throw new WorldError(422, "unsupported", "Nur für Docker-Server");
  }
  if (server.edition === "VELOCITY" || server.edition === "BUNGEECORD") {
    throw new WorldError(422, "unsupported", "Proxy-Server haben keine Welten");
  }
}

/** Wandelt „Container läuft nicht"-Fehler in einen 409 um. */
function mapExecError(err: unknown): WorldError {
  if (/not running|is not running/i.test((err as Error).message)) {
    return new WorldError(409, "not_running", "Server muss laufen");
  }
  return new WorldError(502, "exec_failed", (err as Error).message);
}

/** Validiert einen Weltnamen (ein Segment, keine Traversal). */
function assertName(name: string): void {
  if (!WORLD_NAME_REGEX.test(name) || name === "." || name === "..") {
    throw new WorldError(400, "bad_name", "Ungültiger Weltname");
  }
}

/** Aktive Welt aus server.properties (`level-name`, Standard „world"). */
async function activeLevel(server: Server): Promise<string> {
  try {
    const props = await readServerProperties(server);
    return props["level-name"] || "world";
  } catch {
    return "world";
  }
}

/** Prüft, ob eine Welt existiert (Ordner mit level.dat). Auch bei gestopptem Container. */
async function worldExists(server: Server, name: string): Promise<boolean> {
  const container = docker.getContainer(containerName(server.id));
  try {
    await container.getArchive({ path: `/data/${name}/level.dat` });
    return true;
  } catch {
    return false;
  }
}

/** Startet den Server neu (Docker), ohne einen „offline"-Alarm auszulösen. */
async function restart(server: Server): Promise<void> {
  suppressDownAlert(server.id);
  await createDockerAdapter(server).restart();
  reattachServerStreams(server.id);
  void broadcastServerStatus(server.id);
}

// ── Auflisten ───────────────────────────────────────────────────────────────

export async function listWorlds(server: Server): Promise<WorldListResponse> {
  ensureDocker(server);
  const active = await activeLevel(server);
  const adapter = createDockerAdapter(server);

  let out: string;
  try {
    out = await adapter.exec([
      "sh",
      "-c",
      'for d in /data/*/; do if [ -f "${d}level.dat" ]; then printf "%s\\t%s\\n" "$(du -sb "$d" 2>/dev/null | cut -f1)" "${d%/}"; fi; done',
    ]);
  } catch (err) {
    throw mapExecError(err);
  }

  const companion = /_(nether|the_end)$/;
  const worlds: WorldDto[] = [];
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [size, path] = trimmed.split("\t");
    if (!path) continue;
    const name = path.replace(/^\/data\//, "");
    if (companion.test(name)) continue; // Nether/End gehören zur Basiswelt
    worlds.push({ name, active: name === active, sizeBytes: Number(size) || 0 });
  }
  // Aktive Welt evtl. noch nicht generiert → trotzdem anzeigen.
  if (active && !worlds.some((w) => w.name === active)) {
    worlds.push({ name: active, active: true, sizeBytes: 0 });
  }
  worlds.sort((a, b) => a.name.localeCompare(b.name));
  return { active, worlds };
}

// ── Wechseln / Erstellen / Löschen ─────────────────────────────────────────────

export async function switchWorld(server: Server, name: string): Promise<void> {
  ensureDocker(server);
  assertName(name);
  if (!(await worldExists(server, name))) {
    throw new WorldError(404, "not_found", "Welt nicht gefunden");
  }
  await writeServerProperties(server, { "level-name": name });
  await restart(server);
}

export async function createWorld(
  server: Server,
  name: string,
  seed?: string,
): Promise<void> {
  ensureDocker(server);
  assertName(name);
  if (await worldExists(server, name)) {
    throw new WorldError(409, "exists", "Welt existiert bereits");
  }
  const changes: Record<string, string> = { "level-name": name };
  // Seed setzen (leer = zufällig); wirkt beim Generieren der neuen Welt.
  changes["level-seed"] = seed ?? "";
  await writeServerProperties(server, changes);
  await restart(server);
}

export async function deleteWorld(server: Server, name: string): Promise<void> {
  ensureDocker(server);
  assertName(name);
  const active = await activeLevel(server);
  if (name === active) {
    throw new WorldError(409, "active", "Die aktive Welt kann nicht gelöscht werden");
  }
  const adapter = createDockerAdapter(server);
  // Basiswelt + Nether/End-Companions entfernen (feste Segmente dank assertName).
  for (const w of [name, `${name}_nether`, `${name}_the_end`]) {
    try {
      await adapter.exec(["rm", "-rf", `/data/${w}`]);
    } catch (err) {
      throw mapExecError(err);
    }
  }
}

// ── Upload (.tar.gz) ────────────────────────────────────────────────────────────

/** Entpackt ein tar (Buffer), benennt den obersten Ordner in `name` um, packt neu. */
function renameTarRoot(tarBuf: Buffer, name: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    const pack = tar.pack();
    const chunks: Buffer[] = [];
    let sawLevel = false;

    pack.on("data", (c: Buffer) => chunks.push(c));
    pack.on("end", () => resolve(Buffer.concat(chunks)));
    pack.on("error", reject);

    extract.on("entry", (header, stream, next) => {
      const bufs: Buffer[] = [];
      stream.on("data", (c: Buffer) => bufs.push(c));
      stream.on("end", () => {
        const slash = header.name.indexOf("/");
        const rest = slash === -1 ? "" : header.name.slice(slash);
        const newName = `${name}${rest || (header.type === "directory" ? "/" : "")}`;
        if (/\/level\.dat$/.test(newName)) sawLevel = true;
        const content =
          header.type === "directory" ? Buffer.alloc(0) : Buffer.concat(bufs);
        pack.entry(
          {
            name: newName,
            type: header.type,
            mode: header.mode,
            mtime: header.mtime,
            uid: CONTAINER_UID,
            gid: CONTAINER_UID,
          },
          content,
          (err) => (err ? reject(err) : next()),
        );
      });
      stream.resume();
    });
    extract.on("finish", () => {
      if (!sawLevel) {
        reject(new WorldError(400, "no_level", "Archiv enthält keine level.dat"));
        return;
      }
      pack.finalize();
    });
    extract.on("error", reject);
    extract.end(tarBuf);
  });
}

export async function uploadWorld(
  server: Server,
  name: string,
  gzBuffer: Buffer,
): Promise<void> {
  ensureDocker(server);
  assertName(name);
  if (await worldExists(server, name)) {
    throw new WorldError(409, "exists", "Welt existiert bereits");
  }
  let tarBuf: Buffer;
  try {
    tarBuf = gunzipSync(gzBuffer);
  } catch {
    throw new WorldError(400, "bad_archive", "Kein gültiges .tar.gz-Archiv");
  }
  const repacked = await renameTarRoot(tarBuf, name);
  const container = docker.getContainer(containerName(server.id));
  await container.putArchive(repacked, { path: "/data" });
}

// ── Pregeneration (Chunky) ───────────────────────────────────────────────────

function requireModdable(server: Server): void {
  if (!MODDABLE.includes(server.edition)) {
    throw new WorldError(
      422,
      "unsupported_edition",
      "Pregen benötigt Paper/Spigot/Fabric/Forge",
    );
  }
}

export async function startPregen(
  server: Server,
  radius: number,
  world?: string,
): Promise<PregenResponse> {
  ensureDocker(server);
  requireModdable(server);

  const installed = await listInstalledMods(server);
  const hasChunky = installed.some((m) => /chunky/i.test(m.filename));
  if (!hasChunky) {
    await installMod(server, "chunky", undefined);
    await restart(server);
    return {
      installed: true,
      started: false,
      message:
        "Chunky wurde installiert — der Server startet neu. Pregen in ~1 Minute erneut starten.",
    };
  }

  const level = world ?? (await activeLevel(server));
  const adapter = createAdapter(server);
  const commands = [
    `chunky world ${level}`,
    "chunky center 0 0",
    `chunky radius ${radius}`,
    "chunky start",
  ];
  let output = "";
  for (const cmd of commands) {
    output += `${await adapter.sendCommand(cmd)}\n`;
  }
  return {
    installed: false,
    started: true,
    message: "Pregen gestartet — Fortschritt in der Konsole.",
    output: output.trim(),
  };
}

export async function cancelPregen(server: Server): Promise<string> {
  ensureDocker(server);
  requireModdable(server);
  const adapter = createAdapter(server);
  // Chunky verlangt nach `cancel` eine Bestätigung — beides senden.
  await adapter.sendCommand("chunky cancel");
  return adapter.sendCommand("chunky confirm");
}
