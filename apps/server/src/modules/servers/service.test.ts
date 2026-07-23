import assert from "node:assert/strict";
import test from "node:test";
import type { Server } from "@prisma/client";
import type { Capability, OnlinePlayer, ServerStatus } from "@minecontrol/shared";
import type { ServerAdapter } from "../../adapters/types.js";
import { getStatusSafe } from "./service.js";

/**
 * Regressionstests für den Status-Cache in getStatusSafe. Kernbug (behoben):
 * eine getStatus()-Promise, die nie auflöst (z. B. hängendes dockerode
 * `inspect()`), wurde dauerhaft im inFlightStatus-Cache gehalten und vergiftete
 * jeden Folge-Poll → der Server blieb bis zum Backend-Neustart auf UNKNOWN.
 */

/** Minimaler Adapter mit steuerbarem getStatus(); Rest wird hier nicht gebraucht. */
class FakeAdapter implements ServerAdapter {
  constructor(private readonly impl: () => Promise<ServerStatus>) {}
  getStatus(): Promise<ServerStatus> {
    return this.impl();
  }
  start(): Promise<void> {
    return Promise.resolve();
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
  restart(): Promise<void> {
    return Promise.resolve();
  }
  sendCommand(): Promise<string> {
    return Promise.resolve("");
  }
  getPlayers(): Promise<OnlinePlayer[]> {
    return Promise.resolve([]);
  }
  capabilities(): Capability[] {
    return ["STATUS"];
  }
}

const server = { id: "srv-test", edition: "PAPER" } as unknown as Server;

const online: ServerStatus = {
  state: "ONLINE",
  online: true,
  edition: "PAPER",
  players: { online: 0, max: 20, sample: [] },
};

test("getStatusSafe: Timeout liefert UNKNOWN statt zu hängen", async () => {
  // getStatus löst nie auf → muss über das (Test-)Oberlimit als UNKNOWN kommen.
  const adapter = new FakeAdapter(() => new Promise<ServerStatus>(() => {}));
  const status = await getStatusSafe(adapter, server, 20);
  assert.equal(status.state, "UNKNOWN");
});

test("getStatusSafe: ein hängender Aufruf vergiftet den Cache NICHT (Selbstheilung)", async () => {
  // 1. Aufruf hängt → UNKNOWN, Cache-Eintrag muss danach verworfen sein.
  const hanging = new FakeAdapter(() => new Promise<ServerStatus>(() => {}));
  const first = await getStatusSafe(hanging, server, 20);
  assert.equal(first.state, "UNKNOWN");

  // 2. Aufruf mit gesundem Adapter muss eine FRISCHE Abfrage starten und ONLINE
  // liefern — vor dem Fix hätte er dieselbe tote Promise erneut abgewartet.
  const healthy = new FakeAdapter(() => Promise.resolve(online));
  const second = await getStatusSafe(healthy, server, 50);
  assert.equal(second.state, "ONLINE");
});

test("getStatusSafe: gleichzeitige Aufrufe teilen sich eine Abfrage (Dedupe)", async () => {
  let calls = 0;
  const adapter = new FakeAdapter(() => {
    calls += 1;
    return new Promise<ServerStatus>((resolve) => setTimeout(() => resolve(online), 5));
  });
  const [a, b] = await Promise.all([
    getStatusSafe(adapter, server, 1000),
    getStatusSafe(adapter, server, 1000),
  ]);
  assert.equal(a.state, "ONLINE");
  assert.equal(b.state, "ONLINE");
  assert.equal(calls, 1, "beide Aufrufer docken an dieselbe laufende Abfrage an");
});
