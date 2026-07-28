import { PassThrough } from "node:stream";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as tar from "tar-stream";
import { readTarSingleFile, readTarSingleFileOrNull } from "./tarStream.js";

/** Baut einen Tar-Stream mit einer Datei (wie `container.getArchive()` ihn liefert). */
function tarWith(name: string, content: string): NodeJS.ReadableStream {
  const pack = tar.pack();
  pack.entry({ name }, content);
  pack.finalize();
  return pack as unknown as NodeJS.ReadableStream;
}

test("readTarSingleFile: liest den Dateiinhalt aus dem Tar-Stream", async () => {
  const buf = await readTarSingleFile(tarWith("server.properties", "motd=Hallo\nmax-players=20"));
  assert.equal(buf.toString("utf8"), "motd=Hallo\nmax-players=20");
});

test("readTarSingleFile: ein Fehler der QUELLE führt zu einer Ablehnung, nicht zu einem Crash", async () => {
  // Genau der Fall, den `.pipe()` nicht abdeckte: der Docker-Socket bricht mitten
  // im Lesen ab (Daemon-Neustart → ECONNRESET). Ohne pipeline() wäre das ein
  // unbehandeltes 'error'-Event → uncaughtException → Prozess-Shutdown (index.ts).
  const source = new PassThrough();
  const promise = readTarSingleFile(source);
  setImmediate(() => source.destroy(new Error("ECONNRESET")));

  await assert.rejects(promise, /ECONNRESET/);
});

test("readTarSingleFile: ein Fehler VOR dem ersten Byte lehnt ebenfalls ab", async () => {
  const source = new PassThrough();
  source.destroy(new Error("socket hang up"));

  await assert.rejects(readTarSingleFile(source), /socket hang up/);
});

test("readTarSingleFileOrNull: liefert null und meldet den Fehler, statt zu werfen", async () => {
  const source = new PassThrough();
  const seen: unknown[] = [];
  const promise = readTarSingleFileOrNull(source, (err) => seen.push(err));
  setImmediate(() => source.destroy(new Error("ECONNRESET")));

  assert.equal(await promise, null);
  assert.equal(seen.length, 1);
  assert.match((seen[0] as Error).message, /ECONNRESET/);
});

test("readTarSingleFileOrNull: leere Datei ergibt null (bestehendes Verhalten)", async () => {
  assert.equal(await readTarSingleFileOrNull(tarWith("leer.txt", "")), null);
});
