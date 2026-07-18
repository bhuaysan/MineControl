import type { ClientMessage, ServerMessage, WsTopic } from "@minecontrol/shared";
import type { WebSocket } from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { SESSION_COOKIE } from "../config.js";
import { prisma } from "../db.js";
import { listServerDtos } from "../modules/servers/service.js";

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
function broadcast(topic: WsTopic, message: ServerMessage): void {
  for (const conn of connections) {
    if (conn.topics.has(topic)) send(conn.socket, message);
  }
}

/**
 * Pollt periodisch den Status aller Server und broadcastet ihn an
 * Dashboard-Abonnenten. Läuft nur, wenn mindestens jemand zuhört.
 */
function startStatusPoller(intervalMs = 10_000): void {
  setInterval(async () => {
    const hasDashboardListener = [...connections].some((c) =>
      c.topics.has("dashboard"),
    );
    if (!hasDashboardListener) return;
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
      if (msg.type === "subscribe") conn.topics.add(msg.topic);
      else if (msg.type === "unsubscribe") conn.topics.delete(msg.topic);
    });

    socket.on("close", () => {
      connections.delete(conn);
    });
  });

  startStatusPoller();
}
