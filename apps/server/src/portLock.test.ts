import { createServer } from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import { isHostPortBound, withPortLock } from "./portLock.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("withPortLock: serialisiert nebenläufige Aufrufe (kein Überlappen)", async () => {
  const events: string[] = [];

  const first = withPortLock(async () => {
    events.push("first:start");
    await sleep(30);
    events.push("first:end");
  });
  const second = withPortLock(async () => {
    events.push("second:start");
    await sleep(5);
    events.push("second:end");
  });

  await Promise.all([first, second]);

  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("withPortLock: ein Fehlschlag blockiert die Kette nicht dauerhaft", async () => {
  await assert.rejects(
    withPortLock(async () => {
      throw new Error("simulierter Fehler");
    }),
    /simulierter Fehler/,
  );

  // Nächster Aufruf muss trotzdem laufen, statt für immer auf die
  // fehlgeschlagene vorherige Operation zu warten.
  const result = await withPortLock(async () => "ok");
  assert.equal(result, "ok");
});

test("isHostPortBound: erkennt einen tatsächlich gebundenen Port und dessen Freigabe", async () => {
  const server = createServer();
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as { port: number }).port);
    });
  });

  assert.equal(await isHostPortBound(port), true);

  await new Promise<void>((resolve) => server.close(() => resolve()));
  assert.equal(await isHostPortBound(port), false);
});
