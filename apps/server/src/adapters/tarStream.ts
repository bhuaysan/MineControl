import { pipeline } from "node:stream/promises";
import * as tar from "tar-stream";

/**
 * Liest den Inhalt eines Tar-Streams (wie ihn `container.getArchive()` liefert)
 * als Buffer zusammen — gedacht für Archive mit genau einer Datei.
 *
 * Bewusst über `stream.pipeline()` statt `source.pipe(extract)`: `.pipe()` leitet
 * einen Fehler der QUELLE nicht an das Ziel weiter, ein `extract.on("error", …)`
 * deckt sie also nicht ab. Ein abgebrochener Docker-Socket (Daemon-Neustart →
 * ECONNRESET) wäre damit ein unbehandeltes `error`-Event — und weil index.ts
 * `uncaughtException` bewusst in einen vollständigen Shutdown übersetzt, hätte das
 * den ganzen Prozess beendet, statt nur diese eine Operation scheitern zu lassen.
 * `pipeline()` propagiert Fehler beider Seiten und räumt beide Streams auf.
 */
export async function readTarSingleFile(source: NodeJS.ReadableStream): Promise<Buffer> {
  const extract = tar.extract();
  const chunks: Buffer[] = [];

  extract.on("entry", (_header, entryStream, next) => {
    entryStream.on("data", (c: Buffer) => chunks.push(c));
    entryStream.on("end", next);
    // Auch der Eintrags-Stream braucht einen Handler: bricht er ab (z. B. weil
    // `extract` wegen eines Quellfehlers zerstört wird), wäre sein `error`-Event
    // sonst ebenfalls unbehandelt. `extract.destroy(err)` lässt `pipeline()` mit
    // genau diesem Fehler ablehnen.
    entryStream.on("error", (err: Error) => extract.destroy(err));
    entryStream.resume();
  });

  await pipeline(source, extract);
  return Buffer.concat(chunks);
}

/**
 * Wie {@link readTarSingleFile}, liefert aber `null` statt zu werfen — für
 * Aufrufer, die „Datei/Container nicht da" und „Störung" bewusst gleich
 * behandeln. `onError` bekommt den Fehler zum Loggen.
 */
export async function readTarSingleFileOrNull(
  source: NodeJS.ReadableStream,
  onError?: (err: unknown) => void,
): Promise<Buffer | null> {
  try {
    const buf = await readTarSingleFile(source);
    return buf.length > 0 ? buf : null;
  } catch (err) {
    onError?.(err);
    return null;
  }
}
