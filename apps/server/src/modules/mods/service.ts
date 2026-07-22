import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { posix } from "node:path";
import type { Server } from "@prisma/client";
import * as tar from "tar-stream";
import type {
  InstalledModDto,
  ModSearchHitDto,
  PluginConfigListDto,
  PluginUpdateDto,
} from "@minecontrol/shared";
import { config } from "../../config.js";
import { CONTAINER_UID, containerName, docker } from "../../adapters/dockerClient.js";
import { createDockerAdapter } from "../../adapters/registry.js";
import { listDirectory, readFile, writeFile } from "../files/service.js";
import { prisma } from "../../db.js";

const MODRINTH = "https://api.modrinth.com/v2";
const USER_AGENT = "MineControl/0.1 (+https://github.com/bhuaysan/MineControl)";

/** Zulässiger Jar-Dateiname (keine Pfad-Trenner, keine Traversal). */
const JAR_NAME_RE = /^[\w.\-+ ]+\.jar$/;

/** Zuordnung Edition → Modrinth-Loader + Zielordner im Container. */
interface LoaderInfo {
  /** Loader-Kategorien für die Modrinth-Suche (ODER-verknüpft). */
  loaders: string[];
  /** Zielordner unter /data. */
  folder: "plugins" | "mods";
}

function loaderInfo(edition: string): LoaderInfo | null {
  switch (edition) {
    case "PAPER":
      return { loaders: ["paper", "spigot", "bukkit"], folder: "plugins" };
    case "SPIGOT":
      return { loaders: ["spigot", "bukkit"], folder: "plugins" };
    case "FABRIC":
      return { loaders: ["fabric"], folder: "mods" };
    case "FORGE":
      return { loaders: ["forge"], folder: "mods" };
    case "NEOFORGE":
      return { loaders: ["neoforge"], folder: "mods" };
    case "VELOCITY":
      return { loaders: ["velocity"], folder: "plugins" };
    case "BUNGEECORD":
      return { loaders: ["bungeecord", "waterfall"], folder: "plugins" };
    default:
      return null; // VANILLA/UNKNOWN: keine Plugin-/Mod-Unterstützung
  }
}

export class UnsupportedEditionError extends Error {
  constructor() {
    super("Diese Server-Edition unterstützt keine Plugins/Mods");
    this.name = "UnsupportedEditionError";
  }
}

/** Ungültige Client-Eingabe (Dateiname, Pfad, URL, Größe …) → HTTP 400. */
export class ModInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModInputError";
  }
}

function requireLoader(server: Server): LoaderInfo {
  const info = loaderInfo(server.edition);
  if (!info) throw new UnsupportedEditionError();
  return info;
}

/** Ermittelt die (möglichst konkrete) Minecraft-Version des Servers. */
async function gameVersion(server: Server): Promise<string | null> {
  try {
    const cfg = server.dockerConfig
      ? (JSON.parse(server.dockerConfig) as { version?: string })
      : {};
    if (cfg.version && /^\d+\.\d+(\.\d+)?$/.test(cfg.version)) return cfg.version;
  } catch {
    /* ignorieren */
  }
  // Fallback: live gepingte Version.
  const status = await createDockerAdapter(server).getStatus();
  return status.version && /^\d+\.\d+/.test(status.version) ? status.version : null;
}

async function modrinth(path: string): Promise<unknown> {
  const res = await fetch(`${MODRINTH}${path}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Modrinth-API antwortete mit ${res.status}`);
  return res.json();
}

interface ModrinthHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  icon_url?: string;
  project_type: string;
}

/** Sucht kompatible Projekte für einen Server (Loader + Version gefiltert). */
export async function searchMods(
  server: Server,
  query: string,
): Promise<ModSearchHitDto[]> {
  const info = requireLoader(server);
  const version = await gameVersion(server);

  const facets: string[][] = [info.loaders.map((l) => `categories:${l}`)];
  if (version) facets.push([`versions:${version}`]);

  const params = new URLSearchParams({
    query,
    limit: "20",
    index: "relevance",
    facets: JSON.stringify(facets),
  });
  const data = (await modrinth(`/search?${params.toString()}`)) as { hits: ModrinthHit[] };
  return data.hits.map((h) => ({
    projectId: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    author: h.author,
    downloads: h.downloads,
    iconUrl: h.icon_url || undefined,
    projectType: h.project_type,
  }));
}

interface ModrinthVersion {
  id: string;
  version_number: string;
  files: { url: string; filename: string; primary: boolean }[];
}

interface ResolvedFile {
  url: string;
  filename: string;
  versionId: string;
  versionNumber: string;
}

/** Wählt die neueste kompatible Version + primäre Datei. */
async function resolveFile(
  server: Server,
  projectId: string,
  versionId: string | undefined,
  info: LoaderInfo,
): Promise<ResolvedFile> {
  const version = await gameVersion(server);
  const loaderParam = encodeURIComponent(JSON.stringify(info.loaders));
  const versionParam = version
    ? `&game_versions=${encodeURIComponent(JSON.stringify([version]))}`
    : "";
  const versions = (await modrinth(
    `/project/${projectId}/version?loaders=${loaderParam}${versionParam}`,
  )) as ModrinthVersion[];

  if (versions.length === 0) {
    throw new Error("Keine kompatible Version für diesen Server gefunden");
  }
  const chosen = versionId
    ? versions.find((v) => v.id === versionId) ?? versions[0]!
    : versions[0]!;
  const file = chosen.files.find((f) => f.primary) ?? chosen.files[0];
  if (!file) throw new Error("Version enthält keine Datei");
  return {
    url: file.url,
    filename: file.filename,
    versionId: chosen.id,
    versionNumber: chosen.version_number,
  };
}

/** Lädt eine (vertrauenswürdige) URL herunter und puffert sie mit Größen-Cap. */
async function downloadCapped(url: string, headers: Record<string, string>): Promise<Buffer> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status})`);
  return readCapped(res.body, config.modsMaxBytes);
}

/** Liest einen Web-ReadableStream bis zum Cap; bricht bei Überschreitung ab. */
async function readCapped(body: ReadableStream<Uint8Array>, cap: number): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      throw new ModInputError("Datei zu groß");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Prüft die ZIP/JAR-Magic-Bytes (PK\x03\x04 bzw. leeres/gespanntes Archiv). */
function looksLikeJar(data: Buffer): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    (data[2] === 0x03 || data[2] === 0x05 || data[2] === 0x07)
  );
}

/** Schreibt eine Jar mit korrektem Owner (uid/gid 1000) ins plugins/mods-Verzeichnis. */
async function putJar(
  serverId: string,
  folder: string,
  filename: string,
  data: Buffer,
): Promise<void> {
  const container = docker.getContainer(containerName(serverId));
  const pack = tar.pack();
  // uid/gid = 1000: der itzg-Container läuft als 1000 und muss die Datei (und
  // darauf aufbauende Config-Dateien) besitzen — root-owned → AccessDenied.
  pack.entry({ name: `${folder}/${filename}`, uid: CONTAINER_UID, gid: CONTAINER_UID }, data);
  pack.finalize();
  await container.putArchive(pack, { path: "/data" });
}

/** Merkt sich die Herkunft einer installierten Datei (für Update-Check). */
async function recordProvenance(
  serverId: string,
  fileName: string,
  source: "modrinth" | "upload" | "url",
  modrinth?: { projectId: string; versionId: string; versionNumber: string },
): Promise<void> {
  await prisma.installedPlugin.upsert({
    where: { serverId_fileName: { serverId, fileName } },
    create: {
      serverId,
      fileName,
      source,
      modrinthProjectId: modrinth?.projectId ?? null,
      modrinthVersionId: modrinth?.versionId ?? null,
      versionNumber: modrinth?.versionNumber ?? null,
    },
    update: {
      source,
      modrinthProjectId: modrinth?.projectId ?? null,
      modrinthVersionId: modrinth?.versionId ?? null,
      versionNumber: modrinth?.versionNumber ?? null,
    },
  });
}

/** Installiert die neueste kompatible Version eines Modrinth-Projekts. */
export async function installMod(
  server: Server,
  projectId: string,
  versionId: string | undefined,
): Promise<string> {
  const info = requireLoader(server);
  const resolved = await resolveFile(server, projectId, versionId, info);
  const data = await downloadCapped(resolved.url, { "User-Agent": USER_AGENT });
  await putJar(server.id, info.folder, resolved.filename, data);
  await recordProvenance(server.id, resolved.filename, "modrinth", {
    projectId,
    versionId: resolved.versionId,
    versionNumber: resolved.versionNumber,
  });
  return resolved.filename;
}

/** Installiert eine hochgeladene Jar (Buffer bereits im Speicher). */
export async function installUploadedJar(
  server: Server,
  filename: string,
  data: Buffer,
): Promise<string> {
  const info = requireLoader(server);
  const clean = posix.basename(filename);
  if (!JAR_NAME_RE.test(clean)) throw new ModInputError("Nur .jar-Dateien erlaubt");
  if (data.length === 0) throw new ModInputError("Leere Datei");
  if (data.length > config.modsMaxBytes) throw new ModInputError("Datei zu groß");
  if (!looksLikeJar(data)) throw new ModInputError("Keine gültige .jar (ZIP-Signatur fehlt)");
  await putJar(server.id, info.folder, clean, data);
  await recordProvenance(server.id, clean, "upload");
  return clean;
}

/** Blockt private/lokale/Metadaten-IP-Bereiche (SSRF-Schutz). */
function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number) as [number, number, number, number];
    if (p[0] === 0 || p[0] === 127 || p[0] === 10) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local + Cloud-Metadaten
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  if (v === 6) {
    const lc = ip.toLowerCase();
    if (lc === "::1" || lc === "::") return true;
    if (lc.startsWith("fe80")) return true; // link-local
    if (lc.startsWith("fc") || lc.startsWith("fd")) return true; // ULA fc00::/7
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lc);
    if (mapped) return isBlockedIp(mapped[1]!);
    return false;
  }
  return true; // kein gültiges IP-Literal → blocken
}

/** Stellt sicher, dass der Host auf eine öffentliche IP zeigt (kein SSRF-Ziel). */
async function assertPublicHost(hostname: string): Promise<void> {
  const addrs = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true }).catch(() => {
        throw new ModInputError("Host nicht auflösbar");
      });
  if (addrs.length === 0) throw new ModInputError("Host nicht auflösbar");
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new ModInputError("Ziel-Host nicht erlaubt (privat/lokal/Metadaten)");
    }
  }
}

/** Installiert eine Jar von einer (öffentlichen) URL, SSRF-gehärtet. */
export async function installJarFromUrl(server: Server, urlStr: string): Promise<string> {
  const info = requireLoader(server);
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new ModInputError("Ungültige URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ModInputError("Nur http/https erlaubt");
  }
  await assertPublicHost(url.hostname);

  // redirect: "error" → kein Redirect-basiertes SSRF-Bypass auf interne Ziele.
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status})`);
  const data = await readCapped(res.body, config.modsMaxBytes);
  if (!looksLikeJar(data)) throw new ModInputError("Antwort ist keine .jar (ZIP-Signatur fehlt)");

  const filename = filenameFromResponse(url, res);
  if (!JAR_NAME_RE.test(filename)) throw new ModInputError("Kein gültiger Jar-Dateiname ableitbar");
  await putJar(server.id, info.folder, filename, data);
  await recordProvenance(server.id, filename, "url");
  return filename;
}

/** Leitet den Dateinamen aus Content-Disposition bzw. dem URL-Pfad ab. */
function filenameFromResponse(url: URL, res: Response): string {
  const cd = res.headers.get("content-disposition");
  const match = cd && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const raw = match ? decodeURIComponent(match[1]!) : posix.basename(url.pathname);
  const base = posix.basename(raw);
  return base.endsWith(".jar") ? base : `${base || "plugin"}.jar`;
}

/** Aktiviert/deaktiviert eine Datei durch Umbenennen (.jar ↔ .jar.disabled). */
export async function setModEnabled(
  server: Server,
  filename: string,
  enabled: boolean,
): Promise<void> {
  const info = requireLoader(server);
  if (!JAR_NAME_RE.test(filename)) throw new ModInputError("Ungültiger Dateiname");
  const dir = `/data/${info.folder}`;
  const from = enabled ? `${dir}/${filename}.disabled` : `${dir}/${filename}`;
  const to = enabled ? `${dir}/${filename}` : `${dir}/${filename}.disabled`;
  // $1/$2 als Positionsargumente — keine Shell-Interpolation.
  await createDockerAdapter(server).exec([
    "sh",
    "-c",
    'mv -- "$1" "$2"',
    "sh",
    from,
    to,
  ]);
}

/** Listet installierte .jar(.disabled)-Dateien inkl. Aktiv-Status und Herkunft. */
export async function listInstalledMods(server: Server): Promise<InstalledModDto[]> {
  const info = requireLoader(server);
  const container = docker.getContainer(containerName(server.id));

  const provenance = new Map<string, string>();
  for (const row of await prisma.installedPlugin.findMany({
    where: { serverId: server.id },
    select: { fileName: true, source: true },
  })) {
    provenance.set(row.fileName, row.source);
  }

  let archive: NodeJS.ReadableStream;
  try {
    archive = (await container.getArchive({
      path: `/data/${info.folder}`,
    })) as unknown as NodeJS.ReadableStream;
  } catch {
    return []; // Ordner existiert noch nicht.
  }

  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    const byName = new Map<string, InstalledModDto>();
    const prefix = `${info.folder}/`;
    extract.on("entry", (header, stream, next) => {
      const rel = header.name.slice(prefix.length);
      const isJar = rel.endsWith(".jar");
      const isDisabled = rel.endsWith(".jar.disabled");
      if (header.type === "file" && !rel.includes("/") && (isJar || isDisabled)) {
        const base = isDisabled ? rel.slice(0, -".disabled".length) : rel;
        const existing = byName.get(base);
        // Aktive Datei hat Vorrang, falls beide Varianten existieren.
        if (!existing || (isJar && !existing.enabled)) {
          byName.set(base, {
            filename: base,
            sizeBytes: header.size ?? 0,
            enabled: isJar,
            source: provenance.get(base),
          });
        }
      }
      stream.on("end", next);
      stream.resume(); // Inhalt überspringen.
    });
    extract.on("finish", () =>
      resolve([...byName.values()].sort((a, b) => a.filename.localeCompare(b.filename))),
    );
    extract.on("error", reject);
    archive.pipe(extract);
  });
}

/** Löscht eine installierte Datei (aktiv oder deaktiviert) + ihre Herkunft. */
export async function deleteMod(server: Server, filename: string): Promise<void> {
  const info = requireLoader(server);
  if (!JAR_NAME_RE.test(filename)) throw new ModInputError("Ungültiger Dateiname");
  const dir = `/data/${info.folder}`;
  await createDockerAdapter(server).exec([
    "rm",
    "-f",
    "--",
    `${dir}/${filename}`,
    `${dir}/${filename}.disabled`,
  ]);
  await prisma.installedPlugin.deleteMany({
    where: { serverId: server.id, fileName: filename },
  });
}

/** Prüft für alle Modrinth-Plugins, ob eine neuere kompatible Version vorliegt. */
export async function checkPluginUpdates(server: Server): Promise<PluginUpdateDto[]> {
  const info = requireLoader(server);
  const rows = await prisma.installedPlugin.findMany({
    where: { serverId: server.id, source: "modrinth" },
  });
  const out: PluginUpdateDto[] = [];
  for (const row of rows) {
    if (!row.modrinthProjectId) continue;
    try {
      const latest = await resolveFile(server, row.modrinthProjectId, undefined, info);
      out.push({
        fileName: row.fileName,
        currentVersion: row.versionNumber ?? undefined,
        latestVersion: latest.versionNumber,
        updateAvailable: latest.versionId !== row.modrinthVersionId,
      });
    } catch {
      /* keine kompatible Version mehr → nicht meldbar */
    }
  }
  return out;
}

/** Aktualisiert ein Modrinth-Plugin auf die neueste kompatible Version. */
export async function updatePlugin(server: Server, filename: string): Promise<string> {
  const info = requireLoader(server);
  if (!JAR_NAME_RE.test(filename)) throw new ModInputError("Ungültiger Dateiname");
  const row = await prisma.installedPlugin.findUnique({
    where: { serverId_fileName: { serverId: server.id, fileName: filename } },
  });
  if (!row || row.source !== "modrinth" || !row.modrinthProjectId) {
    throw new ModInputError("Kein aktualisierbares Plugin (keine Modrinth-Herkunft)");
  }
  const resolved = await resolveFile(server, row.modrinthProjectId, undefined, info);
  const data = await downloadCapped(resolved.url, { "User-Agent": USER_AGENT });
  await putJar(server.id, info.folder, resolved.filename, data);
  if (resolved.filename !== filename) {
    // Alte Datei (aktiv/deaktiviert) entfernen — deleteMod räumt auch die Herkunft.
    await deleteMod(server, filename);
  }
  await recordProvenance(server.id, resolved.filename, "modrinth", {
    projectId: row.modrinthProjectId,
    versionId: resolved.versionId,
    versionNumber: resolved.versionNumber,
  });
  return resolved.filename;
}

// ── Plugin-Konfiguration ──────────────────────────────────────────────────────

/** Liest name:/version: aus der plugin.yml einer Jar (via unzip im Container). */
async function readPluginYml(
  server: Server,
  filename: string,
): Promise<{ name: string; version?: string } | null> {
  try {
    const out = await createDockerAdapter(server).exec([
      "sh",
      "-c",
      'unzip -p -- "$1" plugin.yml 2>/dev/null || true',
      "sh",
      `/data/plugins/${filename}`,
    ]);
    const name = /^name:\s*["']?([^"'\r\n]+)/m.exec(out)?.[1]?.trim();
    const version = /^version:\s*["']?([^"'\r\n]+)/m.exec(out)?.[1]?.trim();
    return name ? { name, version } : null;
  } catch {
    return null;
  }
}

/** Ermittelt den Config-Ordner (/plugins/<Name>) eines Plugins (strikt). */
async function pluginConfigDir(server: Server, filename: string): Promise<string> {
  const info = requireLoader(server);
  if (info.folder !== "plugins") {
    throw new ModInputError("Konfiguration nur für Plugins verfügbar");
  }
  if (!JAR_NAME_RE.test(filename)) throw new ModInputError("Ungültiger Dateiname");
  const meta = await readPluginYml(server, filename);
  if (!meta?.name) throw new ModInputError("plugin.yml nicht lesbar — Config-Ordner unbekannt");
  return `/plugins/${meta.name}`;
}

/** Baut einen Pfad innerhalb des Config-Ordners und verhindert Ausbrüche. */
function joinInside(dir: string, rel: string): string {
  const joined = posix.normalize(posix.join(dir, rel));
  if (joined !== dir && !joined.startsWith(`${dir}/`)) {
    throw new ModInputError("Ungültiger Pfad");
  }
  return joined;
}

/** Config-Ordner eines Plugins + enthaltene Dateien (tolerant). */
export async function getPluginConfig(
  server: Server,
  filename: string,
): Promise<PluginConfigListDto> {
  requireLoader(server);
  if (!JAR_NAME_RE.test(filename)) throw new ModInputError("Ungültiger Dateiname");
  const meta = await readPluginYml(server, filename);
  if (!meta?.name) return { configDir: null, entries: [] };
  const configDir = `/plugins/${meta.name}`;
  try {
    const { entries } = await listDirectory(server, configDir);
    return { configDir, pluginName: meta.name, entries };
  } catch {
    return { configDir, pluginName: meta.name, entries: [] };
  }
}

/** Liest eine Config-Datei eines Plugins als Text. */
export async function readPluginConfigFile(
  server: Server,
  filename: string,
  relPath: string,
): Promise<string> {
  const dir = await pluginConfigDir(server, filename);
  const rel = joinInside(dir, relPath);
  return (await readFile(server, rel)).toString("utf8");
}

/** Schreibt eine Config-Datei eines Plugins (überschreibt). */
export async function writePluginConfigFile(
  server: Server,
  filename: string,
  relPath: string,
  content: string,
): Promise<void> {
  const dir = await pluginConfigDir(server, filename);
  const rel = joinInside(dir, relPath);
  await writeFile(server, rel, Buffer.from(content, "utf8"));
}
