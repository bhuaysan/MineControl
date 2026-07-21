import { createReadStream } from "node:fs";
import { posix } from "node:path";
import { createGunzip } from "node:zlib";
import * as tar from "tar-stream";
import { config } from "../../config.js";
import { containerName, docker } from "../../adapters/dockerClient.js";

/** UID/GID der itzg-Container — importierte Dateien müssen dem Container-User gehören. */
const CONTAINER_UID = 1000;

/** Fehler mit HTTP-Status für die Route-/Provisioning-Schicht. */
export class ImportError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Normalisiert einen Tar-Eintragsnamen: führendes „./" weg, keine Slashes am Rand. */
function cleanEntryName(name: string): string {
  return name.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

interface Scan {
  /** Gemeinsames Top-Level-Verzeichnis, falls alle Einträge eines teilen (sonst null). */
  wrapper: string | null;
  /** Verzeichnisnamen (relativ zum entpackten /data), die direkt eine level.dat enthalten. */
  worldFolders: string[];
}

/**
 * Vorlauf über das Archiv: liest nur die Tar-Header (Bodies werden übersprungen),
 * um (a) einen gemeinsamen Wrapper-Ordner zu erkennen und (b) die Welt-Ordner
 * (Verzeichnisse mit level.dat) zu bestimmen. Das Archiv wird dadurch zweimal
 * dekomprimiert — vertretbar für eine seltene Admin-Migration von lokaler Platte.
 */
function scanArchive(hostFilePath: string): Promise<Scan> {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    const topSegments = new Set<string>();
    const levelDatPaths: string[] = [];
    let failed = false;

    const bail = (err: unknown): void => {
      if (failed) return;
      failed = true;
      extract.destroy();
      reject(err);
    };

    extract.on("entry", (header, stream, next) => {
      const name = cleanEntryName(header.name);
      if (name && (header.type === "file" || header.type === "directory")) {
        const top = name.split("/")[0];
        if (top) topSegments.add(top);
        if (name === "level.dat" || name.endsWith("/level.dat")) {
          levelDatPaths.push(name);
        }
      }
      // Body überspringen — nur Header interessieren.
      stream.on("end", next);
      stream.on("error", bail);
      stream.resume();
    });

    extract.on("finish", () => {
      if (failed) return;
      if (levelDatPaths.length === 0) {
        bail(
          new ImportError(
            400,
            "no_level",
            "Archiv enthält keine Welt (keine level.dat gefunden)",
          ),
        );
        return;
      }

      // Wrapper nur, wenn ein einziges Top-Segment existiert UND darin nicht
      // direkt eine level.dat liegt (dann wäre das Top-Segment die Welt selbst).
      let wrapper: string | null = null;
      if (topSegments.size === 1) {
        const top = [...topSegments][0]!;
        const worldIsTop = levelDatPaths.some((p) => p === `${top}/level.dat`);
        if (!worldIsTop) wrapper = top;
      }

      // Welt-Ordner relativ zum entpackten /data bestimmen (nach Wrapper-Strip).
      const worldFolders: string[] = [];
      for (const p of levelDatPaths) {
        const stripped = wrapper ? p.replace(new RegExp(`^${escapeRe(wrapper)}/`), "") : p;
        const dir = posix.dirname(stripped);
        // level.dat direkt unter dem Welt-Ordner → dessen erstes Segment ist der Ordner.
        const folder = dir === "." ? "" : dir.split("/")[0]!;
        if (folder && !worldFolders.includes(folder)) worldFolders.push(folder);
      }

      resolve({ wrapper, worldFolders });
    });

    extract.on("error", () =>
      bail(new ImportError(400, "bad_archive", "Beschädigtes Archiv")),
    );

    const gunzip = createGunzip();
    gunzip.on("error", () =>
      bail(new ImportError(400, "bad_archive", "Kein gültiges .tar.gz-Archiv")),
    );
    createReadStream(hostFilePath)
      .on("error", bail)
      .pipe(gunzip)
      .pipe(extract);
  });
}

/** Escaped einen String für die Verwendung in einem RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wählt aus erkannten Welt-Ordnern die primäre Basiswelt: bevorzugt einen Ordner
 * ohne `_nether`/`_the_end`-Suffix (Paper legt Dimensionen als eigene Ordner mit
 * level.dat an), sonst den kürzesten.
 */
function primaryWorld(worldFolders: string[]): string | undefined {
  if (worldFolders.length === 0) return undefined;
  const base = worldFolders.filter((w) => !/_(nether|the_end)$/.test(w));
  const pool = base.length > 0 ? base : worldFolders;
  return [...pool].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

/**
 * Entpackt ein bestehendes Server-Verzeichnis (.tar.gz) ins /data-Volume des
 * (bereits erstellten, noch nicht gestarteten) Containers.
 *
 * Härtung analog world/service.ts::repackWorld:
 *  - Streaming (gunzip → tar → putArchive), kein GB-Buffer im RAM.
 *  - Nur reguläre Dateien/Verzeichnisse; Symlinks/Hardlinks/Devices verworfen.
 *  - Pfad-Normalisierung + Einschluss in /data (kein Ausbruch via `..`, Tar-Slip).
 *  - uid/gid = 1000, da Fremd-Archive beliebige Owner haben und der itzg-Container
 *    (User 1000) die Dateien sonst nicht schreiben kann → Weltkorruption.
 *  - Obergrenze der entpackten Größe (config.importMaxBytes) gegen Tar-Bomben.
 *
 * Gibt die erkannte primäre Welt zurück (für server.properties `level-name`).
 */
export async function importArchiveIntoVolume(
  serverId: string,
  hostFilePath: string,
): Promise<{ worldFolder?: string }> {
  const scan = await scanArchive(hostFilePath);
  const wrapper = scan.wrapper;

  await new Promise<void>((resolve, reject) => {
    const gunzip = createGunzip();
    const extract = tar.extract();
    const pack = tar.pack();
    let total = 0;
    let failed = false;

    const bail = (err: unknown): void => {
      if (failed) return;
      failed = true;
      gunzip.destroy();
      extract.destroy();
      pack.destroy();
      reject(err);
    };

    gunzip.on("error", () =>
      bail(new ImportError(400, "bad_archive", "Kein gültiges .tar.gz-Archiv")),
    );
    extract.on("error", () =>
      bail(new ImportError(400, "bad_archive", "Beschädigtes Archiv")),
    );
    pack.on("error", bail);

    extract.on("entry", (header, stream, next) => {
      if (failed) {
        stream.resume();
        return;
      }
      // Nur Dateien/Verzeichnisse; Symlinks/Hardlinks/Devices verwerfen.
      if (header.type !== "file" && header.type !== "directory") {
        stream.on("end", next);
        stream.resume();
        return;
      }

      let name = cleanEntryName(header.name);
      // Wrapper-Ordner abschneiden (der Ordner-Eintrag selbst entfällt).
      if (wrapper) {
        if (name === wrapper) {
          stream.on("end", next);
          stream.resume();
          return;
        }
        name = name.replace(new RegExp(`^${escapeRe(wrapper)}/`), "");
      }
      if (!name) {
        stream.on("end", next);
        stream.resume();
        return;
      }

      // Tar-Slip-Schutz: Pfad muss innerhalb von /data bleiben.
      const normalized = posix.normalize(name);
      if (normalized.startsWith("..") || normalized.startsWith("/")) {
        bail(new ImportError(400, "tar_slip", "Ungültiger Pfad im Archiv"));
        stream.resume();
        return;
      }
      const finalName = header.type === "directory" ? `${normalized}/` : normalized;

      const bufs: Buffer[] = [];
      stream.on("data", (c: Buffer) => {
        total += c.length;
        if (total > config.importMaxBytes) {
          bail(new ImportError(413, "too_large", "Entpacktes Archiv zu groß"));
        } else {
          bufs.push(c);
        }
      });
      stream.on("error", bail);
      stream.on("end", () => {
        if (failed) return;
        const content =
          header.type === "directory" ? Buffer.alloc(0) : Buffer.concat(bufs);
        pack.entry(
          {
            name: finalName,
            type: header.type,
            mode: header.mode,
            mtime: header.mtime,
            uid: CONTAINER_UID,
            gid: CONTAINER_UID,
          },
          content,
          (err) => (err ? bail(err) : next()),
        );
      });
    });

    extract.on("finish", () => {
      if (!failed) pack.finalize();
    });

    // Tar-Einträge sind relativ (world/…, plugins/…) → Ziel /data.
    const container = docker.getContainer(containerName(serverId));
    container
      .putArchive(pack as unknown as NodeJS.ReadableStream, { path: "/data" })
      .then(() => {
        if (!failed) resolve();
      })
      .catch(bail);

    createReadStream(hostFilePath)
      .on("error", bail)
      .pipe(gunzip)
      .pipe(extract);
  });

  return { worldFolder: primaryWorld(scan.worldFolders) };
}
