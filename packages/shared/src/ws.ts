import type { OnlinePlayer, ServerStatus } from "./server.js";

/** Nachrichten, die der Client an den Server sendet. */
export type ClientMessage =
  | { type: "subscribe"; topic: WsTopic }
  | { type: "unsubscribe"; topic: WsTopic };

/** Abonnierbare Live-Themen. Serverbezogene enthalten die Server-ID. */
export type WsTopic =
  | "dashboard"
  | `console:${string}`
  | `metrics:${string}`;

/** Nachrichten, die der Server an den Client pusht. */
export type ServerMessage =
  | { type: "server.status_changed"; serverId: string; status: ServerStatus }
  | {
      type: "server.players_changed";
      serverId: string;
      players: OnlinePlayer[];
    }
  | { type: "console.line"; serverId: string; line: string; ts: string }
  | {
      type: "metrics.update";
      serverId: string;
      cpuPercent?: number;
      ramUsedMb?: number;
      ramMaxMb?: number;
      tps?: number;
    }
  | { type: "error"; message: string };
