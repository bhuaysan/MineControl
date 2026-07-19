import type { ClientMessage, ServerMessage, WsTopic } from "@minecontrol/shared";
import type { WebSocket } from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { createDockerAdapter } from "../adapters/registry.js";
import { SESSION_COOKIE } from "../config.js";
import { prisma } from "../db.js";
import { TPS_EDITIONS, sampleTps } from "../modules/metrics/tps.js";
import { listServerDtos, toServerDto } from "../modules/servers/service.js";

/** Eine aktive WebSocket-Verbindung mit ihren Abos. */
interface Connection {
  socket: WebSocket;
  topics: Set<WsTopic>;
}

const connections = new Set<Connection>();

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

/** Sendet an alle Verbindungen, die `topic` abonniert haben. */
export function broadcast(topic: WsTopic, message: ServerMessage): void {
  for (const conn of connections) {
    if (conn.topics.has(topic)) send(conn.socket, message);
  }
}

/** Gibt es mindestens einen Abonnenten für dieses Thema? */
function hasSubscriber(topic: WsTopic): boolean {
  for (const conn of connections) if (conn.topics.has(topic)) return true;
  return false;
}

// ── Live-Streams (Konsole & Metriken), pro Server ref-gezählt ────────────────

/**
 * Ein an einen Docker-Container gebundener Live-Stream. Wird beim ersten
 * Abonnenten aufgebaut und beim letzten wieder abgebaut. `attach()` kann
 * fehlschlagen (Container existiert/​läuft noch nicht) und wird dann später
 * per `reattach…` erneut versucht.
 */
class ManagedStream {
  refs = 0;
  private stop: (() => void) | null = null;

  constructor(
    readonly serverId: string,
    private readonly begin: (serverId: string) => Promise<() => void>,
  ) {}

  get attached(): boolean {
    return this.stop !== null;
  }

  async attach(): Promise<void> {
    if (this.stop) return;
    try {
      this.stop = await this.begin(this.serverId);
    } catch {
      this.stop = null; // Container (noch) nicht bereit → später erneut.
    }
  }

  detach(): void {
    this.stop?.();
    this.stop = null;
  }
}

const consoleStreams = new Map<string, ManagedStream>();
const metricsStreams = new Map<string, ManagedStream>();

async function beginConsole(serverId: string): Promise<() => void> {
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server || server.type !== "DOCKER") throw new Error("Kein Docker-Server");
  const adapter = createDockerAdapter(server);
  return adapter.followLogs((line) =>
    broadcast(`console:${serverId}`, {
      type: "console.line",
      serverId,
      line,
      ts: new Date().toISOString(),
    }),
  );
}

async function beginMetrics(serverId: string): Promise<() => void> {
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server || server.type !== "DOCKER") throw new Error("Kein Docker-Server");
  const adapter = createDockerAdapter(server);
  const stopStats = await adapter.followStats((s) =>
    broadcast(`metrics:${serverId}`, {
      type: "metrics.update",
      serverId,
      cpuPercent: s.cpuPercent,
      ramUsedMb: s.ramUsedMb,
      ramMaxMb: s.ramMaxMb,
    }),
  );

  // TPS (Paper/Spigot) wird per RCON gepollt — docker stats liefert das nicht.
  let tpsTimer: ReturnType<typeof setInterval> | undefined;
  if (TPS_EDITIONS.includes(server.edition)) {
    const pollTps = async (): Promise<void> => {
      const tps = await sampleTps(adapter);
      if (tps != null) {
        broadcast(`metrics:${serverId}`, { type: "metrics.update", serverId, tps });
      }
    };
    void pollTps();
    tpsTimer = setInterval(() => void pollTps(), 10_000);
  }

  return () => {
    stopStats();
    if (tpsTimer) clearInterval(tpsTimer);
  };
}

function acquire(
  map: Map<string, ManagedStream>,
  serverId: string,
  begin: (id: string) => Promise<() => void>,
): void {
  let stream = map.get(serverId);
  if (!stream) {
    stream = new ManagedStream(serverId, begin);
    map.set(serverId, stream);
  }
  stream.refs += 1;
  void stream.attach();
}

function releaseStream(map: Map<string, ManagedStream>, serverId: string): void {
  const stream = map.get(serverId);
  if (!stream) return;
  stream.refs -= 1;
  if (stream.refs <= 0) {
    stream.detach();
    map.delete(serverId);
  }
}

/** Reagiert auf ein neues Abo: passenden Live-Stream aufbauen. */
function onSubscribe(topic: WsTopic): void {
  if (topic.startsWith("console:")) {
    acquire(consoleStreams, topic.slice("console:".length), beginConsole);
  } else if (topic.startsWith("metrics:")) {
    acquire(metricsStreams, topic.slice("metrics:".length), beginMetrics);
  }
}

/** Reagiert auf ein aufgelöstes Abo: Ref-Zähler senken, ggf. abbauen. */
function onUnsubscribe(topic: WsTopic): void {
  if (topic.startsWith("console:")) {
    releaseStream(consoleStreams, topic.slice("console:".length));
  } else if (topic.startsWith("metrics:")) {
    releaseStream(metricsStreams, topic.slice("metrics:".length));
  }
}

/**
 * Baut Konsolen-/Metrik-Streams neu auf, sobald ein Container verfügbar wird
 * (nach Provisionierung oder Start/Restart) — aber nur, wenn jemand zuhört.
 */
export function reattachServerStreams(serverId: string): void {
  const consoleStream = consoleStreams.get(serverId);
  if (consoleStream && !consoleStream.attached) void consoleStream.attach();
  const metricsStream = metricsStreams.get(serverId);
  if (metricsStream && !metricsStream.attached) void metricsStream.attach();
}

/** Beendet laufende Streams eines Servers (z. B. vor dem Löschen/Stoppen). */
export function detachServerStreams(serverId: string): void {
  consoleStreams.get(serverId)?.detach();
  metricsStreams.get(serverId)?.detach();
}

// ── Von außen aufrufbare Broadcasts (Provisionierung, Lifecycle) ─────────────

/** Schiebt eine Konsolen-Zeile an alle Konsolen-Abonnenten dieses Servers. */
export function pushConsoleLine(serverId: string, line: string): void {
  if (!hasSubscriber(`console:${serverId}`)) return;
  broadcast(`console:${serverId}`, {
    type: "console.line",
    serverId,
    line,
    ts: new Date().toISOString(),
  });
}

/** Fragt den aktuellen Status ab und broadcastet ihn ans Dashboard. */
export async function broadcastServerStatus(serverId: string): Promise<void> {
  try {
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) return;
    const dto = await toServerDto(server);
    broadcast("dashboard", {
      type: "server.status_changed",
      serverId,
      status: dto.status,
    });
  } catch (err) {
    console.error("Status-Broadcast fehlgeschlagen:", err);
  }
}

/**
 * Pollt periodisch den Status aller Server und broadcastet ihn an
 * Dashboard-Abonnenten. Läuft nur, wenn mindestens jemand zuhört.
 */
function startStatusPoller(intervalMs = 10_000): void {
  setInterval(async () => {
    if (!hasSubscriber("dashboard")) return;
    try {
      const servers = await listServerDtos();
      for (const server of servers) {
        broadcast("dashboard", {
          type: "server.status_changed",
          serverId: server.id,
          status: server.status,
        });
      }
    } catch (err) {
      console.error("Status-Poller fehlgeschlagen:", err);
    }
  }, intervalMs);
}

export async function registerWebsocket(app: FastifyInstance): Promise<void> {
  app.get("/ws", { websocket: true }, async (socket, request) => {
    // Authentifizierung über das signierte Session-Cookie.
    const raw = request.cookies[SESSION_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    const userId = unsigned?.valid ? unsigned.value : null;
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : null;
    if (!user) {
      send(socket, { type: "error", message: "Nicht angemeldet" });
      socket.close();
      return;
    }

    const conn: Connection = { socket, topics: new Set() };
    connections.add(conn);

    socket.on("message", (data: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return;
      }
      if (msg.type === "subscribe") {
        if (conn.topics.has(msg.topic)) return; // Doppel-Abo ignorieren.
        conn.topics.add(msg.topic);
        onSubscribe(msg.topic);
      } else if (msg.type === "unsubscribe") {
        if (!conn.topics.delete(msg.topic)) return;
        onUnsubscribe(msg.topic);
      }
    });

    socket.on("close", () => {
      connections.delete(conn);
      // Alle Abos dieser Verbindung freigeben (Streams ggf. abbauen).
      for (const topic of conn.topics) onUnsubscribe(topic);
    });
  });

  startStatusPoller();
}
