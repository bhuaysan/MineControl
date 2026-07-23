import type { ClientMessage, Role, ServerMessage, WsTopic } from "@minecontrol/shared";
import { hasRole } from "@minecontrol/shared";
import type { WebSocket } from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createDockerAdapter } from "../adapters/registry.js";
import { resolveSessionUser } from "../auth.js";
import { prisma } from "../db.js";
import { TPS_EDITIONS, parseTps } from "../modules/metrics/tps.js";
import { listServerDtos, toServerDto } from "../modules/servers/service.js";

/** Eine aktive WebSocket-Verbindung mit ihren Abos. */
interface Connection {
  socket: WebSocket;
  role: Role;
  topics: Set<WsTopic>;
}

// CUIDs (Server-IDs) sind kurz — großzügige Obergrenze schließt beliebig lange
// Fantasie-IDs aus, mit denen ein Client sonst Speicher/Streams aufblähen könnte.
const TOPIC_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Höchstzahl gleichzeitiger Abos pro Verbindung — begrenzt Speicher-/Stream-Verbrauch. */
const MAX_TOPICS_PER_CONNECTION = 20;

const topicSchema = z
  .string()
  .refine(
    (topic): topic is WsTopic =>
      topic === "dashboard" ||
      (topic.startsWith("console:") && TOPIC_ID_PATTERN.test(topic.slice("console:".length))) ||
      (topic.startsWith("metrics:") && TOPIC_ID_PATTERN.test(topic.slice("metrics:".length))),
  );

const clientMessageSchema = z.union([
  z.object({ type: z.literal("subscribe"), topic: topicSchema }),
  z.object({ type: z.literal("unsubscribe"), topic: topicSchema }),
]);

/** Parst und validiert eine eingehende Client-Nachricht; `null` bei ungültiger Form.
 * Exportiert (nur) für Unit-Tests der Validierung — siehe ws/index.test.ts. */
export function parseClientMessage(data: Buffer): ClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(data.toString());
  } catch {
    return null;
  }
  const parsed = clientMessageSchema.safeParse(json);
  return parsed.success ? (parsed.data as ClientMessage) : null;
}

/** Mindestrolle je Topic-Präfix — muss zur UI-Sichtbarkeit passen (Konsole ist Moderator+).
 * Exportiert (nur) für Unit-Tests — siehe ws/index.test.ts. */
export function canSubscribe(role: Role, topic: WsTopic): boolean {
  if (topic.startsWith("console:")) return hasRole(role, "MODERATOR");
  return true;
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
  private attaching = false;
  private detachRequested = false;

  constructor(
    readonly serverId: string,
    private readonly begin: (serverId: string) => Promise<() => void>,
  ) {}

  get attached(): boolean {
    // Ein laufender Aufbau zählt als „attached", damit reattach() nicht parallel
    // einen zweiten begin() startet (der dann leaken würde).
    return this.stop !== null || this.attaching;
  }

  async attach(): Promise<void> {
    if (this.stop || this.attaching) return;
    this.attaching = true;
    this.detachRequested = false;
    try {
      const stop = await this.begin(this.serverId);
      // Während des (asynchronen) Aufbaus abgemeldet? Dann die eben erzeugte
      // Ressource (RCON-Verbindung, Timer, Log-Stream) sofort wieder freigeben —
      // sonst bleibt sie nach einem schnellen Subscribe→Disconnect für immer offen.
      if (this.detachRequested) {
        stop();
        this.stop = null;
      } else {
        this.stop = stop;
      }
    } catch {
      this.stop = null; // Container (noch) nicht bereit → später erneut.
    } finally {
      this.attaching = false;
    }
  }

  detach(): void {
    this.detachRequested = true;
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
  // Eine EINZELNE RCON-Verbindung bleibt für die Dauer des Streams offen
  // (statt je Poll neu zu verbinden) — sonst spammt jeder 10s-Tick die
  // Server-Konsole mit „RCON Client started/shutting down".
  let tpsTimer: ReturnType<typeof setInterval> | undefined;
  let persistentRcon: Awaited<ReturnType<typeof adapter.openPersistentRcon>> | undefined;
  if (TPS_EDITIONS.includes(server.edition)) {
    persistentRcon = await adapter.openPersistentRcon().catch(() => undefined);
    if (persistentRcon) {
      const rcon = persistentRcon;
      const pollTps = async (): Promise<void> => {
        try {
          const tps = parseTps(await rcon.send("tps"));
          if (tps != null) {
            broadcast(`metrics:${serverId}`, { type: "metrics.update", serverId, tps });
          }
        } catch {
          /* Verbindung kurzzeitig weg (z. B. Neustart) — nächster Tick versucht erneut. */
        }
      };
      void pollTps();
      tpsTimer = setInterval(() => void pollTps(), 10_000);
    }
  }

  return () => {
    stopStats();
    if (tpsTimer) clearInterval(tpsTimer);
    void persistentRcon?.close();
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
    // Authentifizierung über das signierte Session-Cookie — dieselbe Auflösung
    // wie die HTTP-Routen (dekodiert `userId:sessionVersion` und prüft die
    // sessionVersion), damit widerrufene Sitzungen auch hier abgewiesen werden.
    const user = await resolveSessionUser(request);
    if (!user) {
      send(socket, { type: "error", message: "Nicht angemeldet" });
      socket.close();
      return;
    }

    const conn: Connection = { socket, role: user.role, topics: new Set() };
    connections.add(conn);

    socket.on("message", (data: Buffer) => {
      const msg = parseClientMessage(data);
      if (!msg) return; // Unbekannte/ungültige Nachricht — ignorieren statt crashen.
      if (msg.type === "subscribe") {
        if (conn.topics.has(msg.topic)) return; // Doppel-Abo ignorieren.
        if (!canSubscribe(conn.role, msg.topic)) {
          send(socket, { type: "error", message: "Keine Berechtigung für dieses Thema" });
          return;
        }
        if (conn.topics.size >= MAX_TOPICS_PER_CONNECTION) {
          send(socket, { type: "error", message: "Zu viele gleichzeitige Abos" });
          return;
        }
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
