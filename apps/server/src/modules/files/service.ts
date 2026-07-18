import { posix } from "node:path";
import type { Server } from "@prisma/client";
import * as tar from "tar-stream";
import type { FileEntryDto, FileEntryType } from "@minecontrol/shared";
import { containerName, docker } from "../../adapters/dockerClient.js";
import { createDockerAdapter } from "../../adapters/registry.js";

/** Basisverzeichnis im Container, unter dem alle Dateioperationen laufen. */
const ROOT = "/data";

/** Signalisiert, dass eine Operation einen laufenden Container erfordert. */
export class ContainerNotRunningError extends Error {
  constructor() {
    super("Server muss laufen, um Dateien zu durchsuchen");
    this.name = "ContainerNotRunningError";
  }
}

/**
 * Wandelt einen relativen Pfad in einen absoluten unter `/data` um und
 * verhindert Ausbrüche (`..`). Wirft bei ungültigem Pfad.
 */
export function resolveDataPath(rel: string): string {
  let clean = posix.normalize(posix.join(ROOT, rel || "/"));
  // Trailing-Slash entfernen — sonst umgeht z. B. „/" (→ „/data/") den
  // ROOT-Vergleich in delete/mkdir (Datenverlust-Gefahr).
  if (clean.length > 1 && clean.endsWith("/")) clean = clean.slice(0, -1);
  if (clean !== ROOT && !clean.startsWith(`${ROOT}/`)) {
    throw new Error("Ungültiger Pfad");
  }
  return clean;
}

/** Relativer Pfad (führender „/") für die Anzeige im Frontend. */
function toRelative(abs: string): string {
  const rel = abs.slice(ROOT.length);
  return rel === "" ? "/" : rel;
}

function ensureDocker(server: Server): void {
  if (server.type !== "DOCKER") throw new Error("Nur für Docker-Server verfügbar");
}

/** Liest eine einzelne Datei aus einem getArchive-Tar-Stream als Buffer. */
function extractSingleFileBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    const chunks: Buffer[] = [];
    extract.on("entry", (_header, entryStream, next) => {
      entryStream.on("data", (c: Buffer) => chunks.push(c));
      entryStream.on("end", next);
      entryStream.resume();
    });
    extract.on("finish", () => resolve(Buffer.concat(chunks)));
    extract.on("error", reject);
    stream.pipe(extract);
  });
}

/** Listet den Inhalt eines Verzeichnisses (eine Ebene). Erfordert laufenden Container. */
export async function listDirectory(
  server: Server,
  rel: string,
): Promise<{ path: string; entries: FileEntryDto[] }> {
  ensureDocker(server);
  const dir = resolveDataPath(rel);
  const adapter = createDockerAdapter(server);

  let raw: string;
  try {
    // %y=Typ (f/d/l), %s=Größe, %T@=mtime(Epoch), %f=Name
    raw = await adapter.exec([
      "find",
      dir,
      "-maxdepth",
      "1",
      "-mindepth",
      "1",
      "-printf",
      "%y\\t%s\\t%T@\\t%f\\n",
    ]);
  } catch (err) {
    if (/not running|is not running/i.test((err as Error).message)) {
      throw new ContainerNotRunningError();
    }
    throw err;
  }

  const entries: FileEntryDto[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [typeChar, sizeStr, mtimeStr, ...nameParts] = line.split("\t");
    const name = nameParts.join("\t");
    if (!name) continue;
    const type: FileEntryType =
      typeChar === "d" ? "dir" : typeChar === "f" ? "file" : "other";
    entries.push({
      name,
      type,
      size: Number(sizeStr) || 0,
      mtime: new Date(Number(mtimeStr) * 1000).toISOString(),
    });
  }

  // Ordner zuerst, dann alphabetisch.
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { path: toRelative(dir), entries };
}

/** Liest den Rohinhalt einer Datei als Buffer (funktioniert auch bei Stopp). */
export async function readFile(server: Server, rel: string): Promise<Buffer> {
  ensureDocker(server);
  const file = resolveDataPath(rel);
  if (file === ROOT) throw new Error("Kein Dateipfad");
  const container = docker.getContainer(containerName(server.id));
  const archive = (await container.getArchive({
    path: file,
  })) as unknown as NodeJS.ReadableStream;
  return extractSingleFileBuffer(archive);
}

/** Schreibt eine Datei (überschreibt). Binärsicher via putArchive. */
export async function writeFile(
  server: Server,
  rel: string,
  data: Buffer,
): Promise<void> {
  ensureDocker(server);
  const file = resolveDataPath(rel);
  if (file === ROOT) throw new Error("Kein Dateipfad");
  const container = docker.getContainer(containerName(server.id));
  const pack = tar.pack();
  pack.entry({ name: posix.basename(file) }, data);
  pack.finalize();
  await container.putArchive(pack, { path: posix.dirname(file) });
}

/** Legt ein (leeres) Verzeichnis an. */
export async function makeDirectory(server: Server, rel: string): Promise<void> {
  ensureDocker(server);
  const dir = resolveDataPath(rel);
  if (dir === ROOT) throw new Error("Ungültiger Pfad");
  const container = docker.getContainer(containerName(server.id));
  const pack = tar.pack();
  pack.entry({ name: posix.basename(dir), type: "directory" }, "");
  pack.finalize();
  await container.putArchive(pack, { path: posix.dirname(dir) });
}

/** Löscht eine Datei oder ein Verzeichnis (rekursiv). Erfordert laufenden Container. */
export async function deletePath(server: Server, rel: string): Promise<void> {
  ensureDocker(server);
  const target = resolveDataPath(rel);
  if (target === ROOT) throw new Error("Datenverzeichnis kann nicht gelöscht werden");
  try {
    await createDockerAdapter(server).exec(["rm", "-rf", target]);
  } catch (err) {
    if (/not running|is not running/i.test((err as Error).message)) {
      throw new ContainerNotRunningError();
    }
    throw err;
  }
}
