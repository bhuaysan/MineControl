import { test } from "node:test";
import assert from "node:assert/strict";
import { canSubscribe, parseClientMessage } from "./index.js";

function msg(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj));
}

test("parseClientMessage: gültige subscribe/unsubscribe-Nachrichten", () => {
  assert.deepEqual(parseClientMessage(msg({ type: "subscribe", topic: "dashboard" })), {
    type: "subscribe",
    topic: "dashboard",
  });
  assert.deepEqual(
    parseClientMessage(msg({ type: "subscribe", topic: "console:abc123" })),
    { type: "subscribe", topic: "console:abc123" },
  );
  assert.deepEqual(
    parseClientMessage(msg({ type: "unsubscribe", topic: "metrics:abc123" })),
    { type: "unsubscribe", topic: "metrics:abc123" },
  );
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
