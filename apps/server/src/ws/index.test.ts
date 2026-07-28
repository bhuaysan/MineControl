import { test } from "node:test";
import assert from "node:assert/strict";
import { ManagedStream, canSubscribe, parseClientMessage } from "./index.js";

function msg(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj));
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("parseClientMessage: gültige subscribe/unsubscribe-Nachrichten", () => {
  assert.deepEqual(parseClientMessage(msg({ type: "subscribe", topic: "dashboard" })), {
    type: "subscribe",
    topic: "dashboard",
  });
  assert.deepEqual(parseClientMessage(msg({ type: "subscribe", topic: "console:abc123" })), {
    type: "subscribe",
    topic: "console:abc123",
  });
  assert.deepEqual(parseClientMessage(msg({ type: "unsubscribe", topic: "metrics:abc123" })), {
    type: "unsubscribe",
    topic: "metrics:abc123",
  });
});

test("parseClientMessage: kein Crash bei kaputtem JSON", () => {
  assert.equal(parseClientMessage(Buffer.from("{not json")), null);
  assert.equal(parseClientMessage(Buffer.from("")), null);
});

test("parseClientMessage: lehnt topic: null statt zu werfen ab", () => {
  assert.equal(parseClientMessage(msg({ type: "subscribe", topic: null })), null);
});

test("parseClientMessage: lehnt unbekannten message-type ab", () => {
  assert.equal(parseClientMessage(msg({ type: "eval", topic: "dashboard" })), null);
});

test("parseClientMessage: lehnt beliebige/zu lange Fantasie-Topics ab", () => {
  assert.equal(parseClientMessage(msg({ type: "subscribe", topic: "console:" })), null);
  assert.equal(
    parseClientMessage(msg({ type: "subscribe", topic: `console:${"a".repeat(100)}` })),
    null,
  );
  assert.equal(parseClientMessage(msg({ type: "subscribe", topic: "not-a-real-topic" })), null);
});

test("canSubscribe: Konsole erfordert Moderator+, Metriken/Dashboard nicht", () => {
  assert.equal(canSubscribe("VIEWER", "console:srv1"), false);
  assert.equal(canSubscribe("MODERATOR", "console:srv1"), true);
  assert.equal(canSubscribe("ADMIN", "console:srv1"), true);
  assert.equal(canSubscribe("VIEWER", "metrics:srv1"), true);
  assert.equal(canSubscribe("VIEWER", "dashboard"), true);
});

// ── ManagedStream: Verhalten, wenn ein Live-Stream von selbst wegfällt ───────
//
// Hintergrund: Docker-Log-/Stats-Streams enden, sobald der Container stoppt, und
// brechen bei einer Daemon-Störung ab. Vorher galt ein solcher Stream dauerhaft
// als „angehängt" — reattachServerStreams() (Start/Restart) baute ihn nie neu
// auf, die Konsole blieb bis zum Abmelden aller Abonnenten stumm.

test("ManagedStream: ein von selbst weggefallener Stream gilt als nicht angehängt und wird neu aufgebaut", async () => {
  let starts = 0;
  let lastOnClose: (() => void) | undefined;
  const stream = new ManagedStream("srv1", async (_id, onClose) => {
    starts += 1;
    lastOnClose = onClose;
    return () => {};
  });

  await stream.attach();
  assert.equal(starts, 1);
  assert.equal(stream.attached, true);

  // Container gestoppt / Socket abgebrochen → der Stream meldet sich ab.
  lastOnClose!();
  assert.equal(stream.attached, false);

  // Genau das macht reattachServerStreams(): erneut anhängen, wenn nicht attached.
  await stream.attach();
  assert.equal(starts, 2);
  assert.equal(stream.attached, true);
});

test("ManagedStream: fällt der Stream WÄHREND des Aufbaus weg, wird er freigegeben statt als aktiv registriert", async () => {
  // beginMetrics wartet nach followStats noch auf die RCON-Verbindung — in dieser
  // Lücke kann der stats-Stream schon sterben.
  let stopped = 0;
  const stream = new ManagedStream("srv1", async (_id, onClose) => {
    onClose(); // stirbt vor dem Auflösen von begin()
    await tick();
    return () => {
      stopped += 1;
    };
  });

  await stream.attach();

  assert.equal(stopped, 1, "die schon erzeugten Ressourcen müssen freigegeben werden");
  assert.equal(stream.attached, false, "ein toter Stream darf nicht als aktiv gelten");
});

test("ManagedStream: onClose eines ALTEN Streams räumt einen inzwischen neuen nicht ab", async () => {
  const closers: (() => void)[] = [];
  const stream = new ManagedStream("srv1", async (_id, onClose) => {
    closers.push(onClose);
    return () => {};
  });

  await stream.attach();
  const firstOnClose = closers[0]!;
  firstOnClose(); // erster Stream stirbt
  await stream.attach(); // zweiter wird aufgebaut
  assert.equal(stream.attached, true);

  // Verspätete Rückmeldung des ERSTEN Streams darf den zweiten nicht abmelden.
  firstOnClose();
  assert.equal(stream.attached, true);
});

test("ManagedStream: detach() während des Aufbaus gibt die Ressource frei (bestehendes Verhalten)", async () => {
  let stopped = 0;
  const stream = new ManagedStream("srv1", async () => {
    await tick();
    return () => {
      stopped += 1;
    };
  });

  const attaching = stream.attach();
  stream.detach();
  await attaching;

  assert.equal(stopped, 1);
  assert.equal(stream.attached, false);
});
