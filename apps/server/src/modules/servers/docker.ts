import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Server } from "@prisma/client";
import * as tar from "tar-stream";
import { config } from "../../config.js";
import { markProvisioning } from "../../adapters/docker.js";
import { logger } from "../../logger.js";
import { prisma } from "../../db.js";
import { importArchiveIntoVolume } from "./import.js";
import {
  CONTAINER_MC_PORT,
  CONTAINER_RCON_PORT,
  CONTAINER_UID,
  MC_IMAGE,
  PROXY_DATA_DIR,
  PROXY_IMAGE,
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
  modrinthModpack?: string;
  curseforgeModpack?: string;
  /** Optional: user-defined Docker-Netzwerk, dem der Container beitritt (Velocity). */
  networkName?: string;
  /** Optional: zusätzlicher DNS-Alias im Netzwerk (z. B. „lobby"). */
  networkAlias?: string;
  /**
   * Optional: Pfad zu einem .tar.gz auf dem Host, das vor dem ersten Start ins
   * /data-Volume importiert wird (Migration eines bestehenden Server-Verzeichnisses).
   */
  importFilePath?: string;
}

/** MB → itzg-Speicherangabe („2G" bzw. „1536M"). */
function memoryArg(mb: number): string {
  return mb % 1024 === 0 ? `${mb / 1024}G` : `${mb}M`;
}

/** Lädt ein Image, falls noch nicht vorhanden, mit Fortschritt in die Konsole. */
async function ensureImage(serverId: string, image = MC_IMAGE): Promise<void> {
  const present = await docker.listImages({
    filters: { reference: [image] },
  });
  if (present.length > 0) {
    pushConsoleLine(serverId, "» Image bereits vorhanden.");
    return;
  }
  pushConsoleLine(serverId, `» Lade Image ${image} …`);
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
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
    `MEMORY=${memoryArg(p.memoryMb)}`,
    "ENABLE_RCON=true",
    `RCON_PORT=${CONTAINER_RCON_PORT}`,
    `RCON_PASSWORD=${p.rconPassword}`,
    `MOTD=${p.motd ?? server.name}`,
    `ONLINE_MODE=${p.onlineMode ? "TRUE" : "FALSE"}`,
  ];
  // Modpack: TYPE=MODRINTH bzw. TYPE=AUTO_CURSEFORGE aktiviert den jeweiligen
  // Pack-Pfad (Pack bestimmt Loader/Version). Sonst TYPE/VERSION aus dem Wizard.
  if (p.modrinthModpack) {
    env.push("TYPE=MODRINTH", `MODRINTH_MODPACK=${p.modrinthModpack}`);
  } else if (p.curseforgeModpack) {
    // Eine URL (http…) → CF_PAGE_URL, sonst Slug → CF_SLUG. Ohne eigenen Key
    // nutzt das itzg-Image seinen eingebauten Key (CF_API_KEY dann weglassen).
    const ref = /^https?:\/\//i.test(p.curseforgeModpack)
      ? `CF_PAGE_URL=${p.curseforgeModpack}`
      : `CF_SLUG=${p.curseforgeModpack}`;
    env.push("TYPE=AUTO_CURSEFORGE", ref);
    if (config.curseforgeApiKey) env.push(`CF_API_KEY=${config.curseforgeApiKey}`);
  } else {
    env.push(`TYPE=${p.edition}`, `VERSION=${p.version}`);
  }
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
    // Netzwerk-Subserver treten dem user-defined Bridge bei → der Proxy erreicht
    // sie per Container-Namen. Host-Ports bleiben (Status-Ping/RCON via 127.0.0.1).
    ...networkingConfig(p),
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
      ...(p.networkName ? { NetworkMode: p.networkName } : {}),
    },
  });
}

/** Baut die NetworkingConfig für den Netzwerkbeitritt (leer, wenn kein Netz). */
function networkingConfig(p: { networkName?: string; networkAlias?: string }): {
  NetworkingConfig?: { EndpointsConfig: Record<string, { Aliases?: string[] }> };
} {
  if (!p.networkName) return {};
  return {
    NetworkingConfig: {
      EndpointsConfig: {
        [p.networkName]: p.networkAlias ? { Aliases: [p.networkAlias] } : {},
      },
    },
  };
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
  // Neuer Versuch → alten Fehler löschen, sonst bliebe er nach einem
  // erfolgreichen Retry stehen.
  await prisma.server
    .update({ where: { id: server.id }, data: { lastProvisionError: null } })
    .catch(() => {});
  await broadcastServerStatus(server.id);
  try {
    pushConsoleLine(server.id, `» Richte Server „${server.name}" ein …`);
    await ensureImage(server.id);
    pushConsoleLine(server.id, "» Erstelle Container …");
    await createContainer(server, params);
    if (params.importFilePath) {
      await importExistingServer(server, params.importFilePath);
    }
    pushConsoleLine(server.id, "» Starte Container …");
    await createDockerAdapter(server).start();
    pushConsoleLine(server.id, "» Container gestartet — Minecraft bootet …");
  } catch (err) {
    const message = (err as Error).message;
    pushConsoleLine(server.id, `Fehler beim Einrichten: ${message}`);
    // Persistiert — sonst sieht man nach einem Prozess-Neustart nur noch ein
    // unauffälliges „offline", ohne dass der eigentliche Fehler sichtbar ist.
    await prisma.server
      .update({ where: { id: server.id }, data: { lastProvisionError: message } })
      .catch(() => {});
    throw err;
  } finally {
    // Staging-Upload nach dem Import wieder entfernen (best effort).
    if (params.importFilePath) await cleanupStagedImport(params.importFilePath);
    markProvisioning(server.id, false);
    reattachServerStreams(server.id);
    await broadcastServerStatus(server.id);
  }
}

/**
 * Importiert ein bestehendes Server-Verzeichnis (.tar.gz) ins frische Volume und
 * stellt sicher, dass die enthaltene Welt aktiv ist: Bringt das Fremd-Archiv keine
 * server.properties mit (oder zeigt `level-name` auf einen fehlenden Ordner), wird
 * `level-name` auf die erkannte Welt gesetzt. MineControls RCON/Port-Env überschreibt
 * itzg beim Boot ohnehin — der Import lässt RCON also unangetastet.
 */
async function importExistingServer(server: Server, filePath: string): Promise<void> {
  pushConsoleLine(server.id, "» Importiere bestehendes Server-Verzeichnis …");
  const { worldFolder } = await importArchiveIntoVolume(server.id, filePath);
  if (worldFolder) {
    const props = await readServerProperties(server);
    const level = props["level-name"];
    if (!level || level !== worldFolder) {
      await writeServerProperties(server, { "level-name": worldFolder });
      pushConsoleLine(server.id, `» Aktive Welt: „${worldFolder}".`);
    }
  }
  pushConsoleLine(server.id, "» Import abgeschlossen.");
}

/** Löscht eine importierte Datei, sofern sie im Staging-Verzeichnis liegt. */
async function cleanupStagedImport(filePath: string): Promise<void> {
  const stagingRoot = resolve(config.importStagingDir);
  const resolved = resolve(filePath);
  if (resolved === stagingRoot || resolved.startsWith(stagingRoot + sep)) {
    await rm(resolved, { force: true }).catch(() => {});
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
  } catch (err) {
    // 404 = existiert nicht mehr → ok. Jeden anderen Fehler (Daemon-Störung
    // etc.) durchreichen, damit der Aufrufer die DB-Zeile NICHT löscht und kein
    // verwaister Container ohne DB-Eintrag zurückbleibt (Port-Konflikt-Gefahr).
    if ((err as { statusCode?: number }).statusCode !== 404) throw err;
  }
  if (!keepWorld) {
    try {
      await docker.getVolume(dataVolumeName(server.id)).remove();
    } catch (err) {
      // 404 = Volume existiert nicht → ok. Anderes (z. B. 409 „volume in use")
      // durchreichen statt schlucken.
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
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

/** Liest server.properties aus dem Container-Volume. `{}` falls noch nicht da —
 * ein anderer Fehler (Docker-/Tar-Störung) wird NICHT damit gleichgesetzt und
 * wirft weiter, sonst hielten Aufrufer eine transiente Störung fälschlich für
 * „Datei existiert nicht". */
export async function readServerProperties(
  server: Server,
): Promise<Record<string, string>> {
  const container = docker.getContainer(containerName(server.id));
  try {
    const archive = await container.getArchive({ path: "/data/server.properties" });
    return parseProperties(await extractSingleFile(archive));
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 404) return {};
    throw err;
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
  } catch (err) {
    // Nur ein echtes 404 (Datei existiert noch nicht) neu anlegen lassen —
    // jeder andere Fehler bricht ab, statt mit raw="" weiterzumachen: sonst
    // würde der folgende Write die bestehende Datei durch eine minimale neue
    // (nur mit `changes`) ersetzen, sobald das Lesen nur transient scheiterte.
    if ((err as { statusCode?: number }).statusCode !== 404) throw err;
  }
  const merged = mergeProperties(raw, changes);
  const pack = tar.pack();
  // uid/gid = 1000: der itzg-Container läuft als 1000 und muss die Datei beim
  // (Neu-)Start selbst überschreiben können — root-owned führt zu AccessDenied.
  pack.entry({ name: "server.properties", uid: CONTAINER_UID, gid: CONTAINER_UID }, merged);
  pack.finalize();
  await container.putArchive(pack, { path: "/data" });
}

// ── Generische Datei-Helfer (für Velocity-/Paper-Konfiguration) ───────────────

/** Liest eine Textdatei aus dem Container-Volume; `null`, falls nicht vorhanden.
 * Nur ein echtes 404 (Datei/Container fehlt) ergibt `null` — jede andere Störung
 * (Docker-/Tar-Fehler) wird geloggt und `null` zurückgegeben, statt sie stumm mit
 * „Datei fehlt" gleichzusetzen (wie {@link readServerProperties} 404 sauber trennt). */
export async function readDataTextFile(
  serverId: string,
  path: string,
): Promise<string | null> {
  const container = docker.getContainer(containerName(serverId));
  try {
    const archive = await container.getArchive({ path });
    return await extractSingleFile(archive);
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode !== 404) {
      logger.warn({ err, serverId, path }, "Datei aus Container-Volume konnte nicht gelesen werden");
    }
    return null;
  }
}

/** Schreibt eine oder mehrere Dateien in ein Verzeichnis des Container-Volumes. */
export async function putDataFiles(
  serverId: string,
  dir: string,
  files: { name: string; content: string }[],
): Promise<void> {
  const container = docker.getContainer(containerName(serverId));
  const pack = tar.pack();
  for (const f of files) {
    await new Promise<void>((resolve, reject) => {
      // uid/gid = 1000: Dateien müssen dem Container-User gehören (siehe
      // writeServerProperties), sonst kann der Server sie nicht überschreiben.
      pack.entry(
        { name: f.name, uid: CONTAINER_UID, gid: CONTAINER_UID },
        f.content,
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }
  pack.finalize();
  await container.putArchive(pack, { path: dir });
}

// ── Proxy-Provisionierung (Velocity/BungeeCord) ───────────────────────────────

/** Parameter zum Provisionieren eines Proxy-Containers (Velocity oder BungeeCord). */
export interface ProxyProvisionParams {
  proxyEdition: "VELOCITY" | "BUNGEECORD";
  /** Nur für Velocity ausgewertet — BungeeCord nutzt immer den neuesten stabilen Build. */
  version: string;
  memoryMb: number;
  mcPort: number;
  networkName: string;
  /** Vollständiger Inhalt der Proxy-Konfiguration (velocity.toml bzw. config.yml). */
  configContent: string;
  /** Dateiname der Proxy-Konfiguration im Datenverzeichnis. */
  configFilename: string;
  /** Modern-Forwarding-Secret (Klartext) — nur für Velocity, BungeeCord braucht keines. */
  forwardingSecret?: string;
}

/** Erstellt (ohne Start) den Proxy-Container aus dem mc-proxy-Image. */
async function createProxyContainer(
  server: Server,
  p: ProxyProvisionParams,
): Promise<void> {
  // mc-proxy: kein EULA/RCON; beide Proxy-Typen binden hier auf CONTAINER_MC_PORT.
  const env = [`TYPE=${p.proxyEdition}`, `MEMORY=${memoryArg(p.memoryMb)}`];
  if (p.proxyEdition === "VELOCITY") env.push(`VELOCITY_VERSION=${p.version}`);
  const mc = `${CONTAINER_MC_PORT}/tcp`;
  await docker.createContainer({
    name: containerName(server.id),
    Image: PROXY_IMAGE,
    Env: env,
    Labels: { "com.minecontrol.serverId": server.id },
    ExposedPorts: { [mc]: {} },
    NetworkingConfig: { EndpointsConfig: { [p.networkName]: {} } },
    HostConfig: {
      PortBindings: {
        [mc]: [{ HostIp: "127.0.0.1", HostPort: String(p.mcPort) }],
      },
      Binds: [`${dataVolumeName(server.id)}:${PROXY_DATA_DIR}`],
      Memory: (p.memoryMb + 1024) * 1_048_576,
      RestartPolicy: { Name: "unless-stopped" },
      NetworkMode: p.networkName,
    },
  });
}

/**
 * Legt einen Proxy an: Image ziehen → Container erstellen → Proxy-Konfiguration
 * (+ bei Velocity das forwarding.secret) ins (noch leere) Volume schreiben →
 * starten. Die Config wird vor dem ersten Start platziert, damit der Proxy sie
 * direkt beim Boot einliest (BungeeCord braucht kein Secret — es nutzt
 * einfaches IP-Forwarding statt Velocitys Modern Forwarding).
 */
export async function provisionProxyServer(
  server: Server,
  params: ProxyProvisionParams,
): Promise<void> {
  markProvisioning(server.id, true);
  await broadcastServerStatus(server.id);
  try {
    const label = params.proxyEdition === "VELOCITY" ? "Velocity" : "BungeeCord";
    pushConsoleLine(server.id, `» Richte ${label}-Proxy „${server.name}" ein …`);
    await ensureImage(server.id, PROXY_IMAGE);
    pushConsoleLine(server.id, "» Erstelle Proxy-Container …");
    await createProxyContainer(server, params);
    pushConsoleLine(server.id, `» Schreibe ${params.configFilename} …`);
    const files = [{ name: params.configFilename, content: params.configContent }];
    if (params.forwardingSecret) {
      files.push({ name: "forwarding.secret", content: params.forwardingSecret });
    }
    await putDataFiles(server.id, PROXY_DATA_DIR, files);
    pushConsoleLine(server.id, "» Starte Proxy …");
    await createDockerAdapter(server).start();
    pushConsoleLine(server.id, "» Proxy gestartet.");
  } catch (err) {
    pushConsoleLine(server.id, `Fehler beim Einrichten: ${(err as Error).message}`);
    throw err;
  } finally {
    markProvisioning(server.id, false);
    reattachServerStreams(server.id);
    await broadcastServerStatus(server.id);
  }
}
