import type { Server } from "@prisma/client";
import * as tar from "tar-stream";
import type { InstalledModDto, ModSearchHitDto } from "@minecontrol/shared";
import { CONTAINER_UID, containerName, docker } from "../../adapters/dockerClient.js";
import { createDockerAdapter } from "../../adapters/registry.js";

const MODRINTH = "https://api.modrinth.com/v2";
const USER_AGENT = "MineControl/0.1 (+https://github.com/bhuaysan/MineControl)";

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
  files: { url: string; filename: string; primary: boolean }[];
}

/** Wählt die neueste kompatible Version + primäre Datei. */
async function resolveFile(
  server: Server,
  projectId: string,
  versionId: string | undefined,
  info: LoaderInfo,
): Promise<{ url: string; filename: string }> {
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
  return { url: file.url, filename: file.filename };
}

/** Lädt die gewählte Datei herunter und legt sie ins plugins/mods-Verzeichnis. */
export async function installMod(
  server: Server,
  projectId: string,
  versionId: string | undefined,
): Promise<string> {
  const info = requireLoader(server);
  const { url, filename } = await resolveFile(server, projectId, versionId, info);

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
  const data = Buffer.from(await res.arrayBuffer());

  const container = docker.getContainer(containerName(server.id));
  const pack = tar.pack();
  // uid/gid = 1000: konsistent mit allen anderen putArchive-Schreibern, damit
  // der Container die Datei (und darauf aufbauende Konfig-Dateien) besitzt.
  pack.entry(
    { name: `${info.folder}/${filename}`, uid: CONTAINER_UID, gid: CONTAINER_UID },
    data,
  );
  pack.finalize();
  await container.putArchive(pack, { path: "/data" });
  return filename;
}

/** Listet installierte .jar-Dateien im plugins-/mods-Verzeichnis. */
export async function listInstalledMods(server: Server): Promise<InstalledModDto[]> {
  const info = requireLoader(server);
  const container = docker.getContainer(containerName(server.id));

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
    const mods: InstalledModDto[] = [];
    const prefix = `${info.folder}/`;
    extract.on("entry", (header, stream, next) => {
      const rel = header.name.slice(prefix.length);
      // Nur .jar direkt im Ordner (keine Unterordner).
      if (
        header.type === "file" &&
        rel.endsWith(".jar") &&
        !rel.includes("/")
      ) {
        mods.push({ filename: rel, sizeBytes: header.size ?? 0 });
      }
      stream.on("end", next);
      stream.resume(); // Inhalt überspringen.
    });
    extract.on("finish", () =>
      resolve(mods.sort((a, b) => a.filename.localeCompare(b.filename))),
    );
    extract.on("error", reject);
    archive.pipe(extract);
  });
}

/** Löscht eine installierte Plugin-/Mod-Datei (erfordert laufenden Container). */
export async function deleteMod(server: Server, filename: string): Promise<void> {
  const info = requireLoader(server);
  if (!/^[\w.\-+ ]+\.jar$/.test(filename)) {
    throw new Error("Ungültiger Dateiname");
  }
  await createDockerAdapter(server).exec(["rm", "-f", `/data/${info.folder}/${filename}`]);
}
