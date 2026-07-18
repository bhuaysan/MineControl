import type { Server } from "@prisma/client";
import * as tar from "tar-stream";
import { markProvisioning } from "../../adapters/docker.js";
import {
  CONTAINER_MC_PORT,
  CONTAINER_RCON_PORT,
  MC_IMAGE,
  containerName,
  dataVolumeName,
  docker,
} from "../../adapters/dockerClient.js";
import { createDockerAdapter } from "../../adapters/registry.js";
import {
  broadcastServerStatus,
  pushConsoleLine,
  reattachServerStreams,
} from "../../ws/index.js";

/** Parameter zum Erstellen eines Docker-Servers (RCON-Passwort im Klartext). */
export interface ProvisionParams {
  edition: string;
  version: string;
  memoryMb: number;
  mcPort: number;
  rconHostPort: number;
  rconPassword: string;
  seed?: string;
  difficulty?: string;
  gamemode?: string;
  motd?: string;
  onlineMode: boolean;
}

/** MB → itzg-Speicherangabe („2G" bzw. „1536M"). */
function memoryArg(mb: number): string {
  return mb % 1024 === 0 ? `${mb / 1024}G` : `${mb}M`;
}

/** Lädt das MC-Image, falls noch nicht vorhanden, mit Fortschritt in die Konsole. */
async function ensureImage(serverId: string): Promise<void> {
  const present = await docker.listImages({
    filters: { reference: [MC_IMAGE] },
  });
  if (present.length > 0) {
    pushConsoleLine(serverId, "» Image bereits vorhanden.");
    return;
  }
  pushConsoleLine(serverId, `» Lade Image ${MC_IMAGE} …`);
  await new Promise<void>((resolve, reject) => {
    docker.pull(MC_IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err || !stream) return reject(err ?? new Error("Kein Pull-Stream"));
      let last = "";
      docker.modem.followProgress(
        stream,
        (doneErr: Error | null) => (doneErr ? reject(doneErr) : resolve()),
        (evt: { status?: string }) => {
          if (evt.status && evt.status !== last) {
            last = evt.status;
            pushConsoleLine(serverId, `» ${evt.status}`);
          }
        },
      );
    });
  });
}

/** Erstellt den Container aus dem itzg-Image mit den Wizard-Parametern. */
async function createContainer(server: Server, p: ProvisionParams): Promise<void> {
  const env = [
    "EULA=TRUE",
    `TYPE=${p.edition}`,
    `VERSION=${p.version}`,
    `MEMORY=${memoryArg(p.memoryMb)}`,
    "ENABLE_RCON=true",
    `RCON_PORT=${CONTAINER_RCON_PORT}`,
    `RCON_PASSWORD=${p.rconPassword}`,
    `MOTD=${p.motd ?? server.name}`,
    `ONLINE_MODE=${p.onlineMode ? "TRUE" : "FALSE"}`,
  ];
  if (p.seed) env.push(`SEED=${p.seed}`);
  if (p.difficulty) env.push(`DIFFICULTY=${p.difficulty}`);
  if (p.gamemode) env.push(`MODE=${p.gamemode}`);

  const mc = `${CONTAINER_MC_PORT}/tcp`;
  const rcon = `${CONTAINER_RCON_PORT}/tcp`;
  await docker.createContainer({
    name: containerName(server.id),
    Image: MC_IMAGE,
    Env: env,
    Labels: { "com.minecontrol.serverId": server.id },
    ExposedPorts: { [mc]: {}, [rcon]: {} },
    HostConfig: {
      // Nur an localhost binden — der Zugriff läuft über MineControl.
      PortBindings: {
        [mc]: [{ HostIp: "127.0.0.1", HostPort: String(p.mcPort) }],
        [rcon]: [{ HostIp: "127.0.0.1", HostPort: String(p.rconHostPort) }],
      },
      Binds: [`${dataVolumeName(server.id)}:/data`],
      // Container-Limit = JVM-Heap + Puffer für Metaspace/Threads/Off-Heap,
      // damit die RAM-Metrik aussagekräftig ist, ohne OOM-Kills zu riskieren.
      Memory: (p.memoryMb + 1024) * 1_048_576,
      RestartPolicy: { Name: "unless-stopped" },
    },
  });
}

/**
 * Legt einen Docker-Server an: Image ziehen → Container erstellen → starten.
 * Läuft asynchron; Fortschritt geht als Konsolen-Zeilen an Abonnenten.
 */
export async function provisionDockerServer(
  server: Server,
  params: ProvisionParams,
): Promise<void> {
  markProvisioning(server.id, true);
  await broadcastServerStatus(server.id);
  try {
    pushConsoleLine(server.id, `» Richte Server „${server.name}" ein …`);
    await ensureImage(server.id);
    pushConsoleLine(server.id, "» Erstelle Container …");
    await createContainer(server, params);
    pushConsoleLine(server.id, "» Starte Container …");
    await createDockerAdapter(server).start();
    pushConsoleLine(server.id, "» Container gestartet — Minecraft bootet …");
  } catch (err) {
    pushConsoleLine(server.id, `Fehler beim Einrichten: ${(err as Error).message}`);
    throw err;
  } finally {
    markProvisioning(server.id, false);
    reattachServerStreams(server.id);
    await broadcastServerStatus(server.id);
  }
}

/** Stoppt (falls nötig) und entfernt Container + optional das Weltdaten-Volume. */
export async function destroyDockerServer(
  server: Server,
  keepWorld: boolean,
): Promise<void> {
  const container = docker.getContainer(containerName(server.id));
  try {
    await container.remove({ force: true, v: false });
  } catch {
    /* Container existiert nicht mehr — ok. */
  }
  if (!keepWorld) {
    try {
      await docker.getVolume(dataVolumeName(server.id)).remove();
    } catch {
      /* Volume existiert nicht — ok. */
    }
  }
}

// ── server.properties (nur Docker) ───────────────────────────────────────────

/** Liest eine einzelne Datei aus einem getArchive-Tar-Stream als Text. */
function extractSingleFile(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    let content = "";
    extract.on("entry", (_header, entryStream, next) => {
      entryStream.on("data", (c: Buffer) => (content += c.toString("utf8")));
      entryStream.on("end", next);
      entryStream.resume();
    });
    extract.on("finish", () => resolve(content));
    extract.on("error", reject);
    stream.pipe(extract);
  });
}

/** Parst `key=value`-Zeilen (Kommentare/Leerzeilen ignoriert). */
function parseProperties(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

/** Aktualisiert Werte im Rohtext, erhält Reihenfolge/Kommentare, hängt Neues an. */
function mergeProperties(raw: string, changes: Record<string, string>): string {
  const remaining = new Map(Object.entries(changes));
  const lines = raw.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq);
    if (remaining.has(key)) {
      const value = remaining.get(key)!;
      remaining.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });
  for (const [key, value] of remaining) lines.push(`${key}=${value}`);
  return lines.join("\n");
}

/** Liest server.properties aus dem Container-Volume. `{}` falls noch nicht da. */
export async function readServerProperties(
  server: Server,
): Promise<Record<string, string>> {
  const container = docker.getContainer(containerName(server.id));
  try {
    const archive = await container.getArchive({ path: "/data/server.properties" });
    return parseProperties(await extractSingleFile(archive));
  } catch {
    return {};
  }
}

/** Schreibt geänderte server.properties zurück ins Container-Volume. */
export async function writeServerProperties(
  server: Server,
  changes: Record<string, string>,
): Promise<void> {
  const container = docker.getContainer(containerName(server.id));
  let raw = "";
  try {
    const archive = await container.getArchive({ path: "/data/server.properties" });
    raw = await extractSingleFile(archive);
  } catch {
    /* Datei noch nicht vorhanden → neu anlegen. */
  }
  const merged = mergeProperties(raw, changes);
  const pack = tar.pack();
  pack.entry({ name: "server.properties" }, merged);
  pack.finalize();
  await container.putArchive(pack, { path: "/data" });
}
