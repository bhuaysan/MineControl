/** Art der Anbindung eines Servers. */
export const SERVER_TYPES = ["DOCKER", "EXTERNAL"] as const;
export type ServerType = (typeof SERVER_TYPES)[number];

/** Software-Edition des Minecraft-Servers. */
export const SERVER_EDITIONS = [
  "VANILLA",
  "PAPER",
  "SPIGOT",
  "FORGE",
  "FABRIC",
  "NEOFORGE",
  "VELOCITY",
  "BUNGEECORD",
  "UNKNOWN",
] as const;
export type ServerEdition = (typeof SERVER_EDITIONS)[number];

/** Laufzeitzustand eines Servers. Bestimmt Farb-/Statusanzeige im Frontend. */
export const SERVER_STATES = [
  "ONLINE",
  "STARTING",
  "STOPPING",
  "OFFLINE",
  "ERROR",
  "UNKNOWN",
] as const;
export type ServerState = (typeof SERVER_STATES)[number];

/** Fähigkeiten, die ein Adapter je nach Servertyp/Konfiguration bietet. */
export const CAPABILITIES = [
  "STATUS",
  "PLAYER_LIST",
  "RCON",
  "LIFECYCLE_START",
  "LIFECYCLE_STOP",
  "CONSOLE",
  "FILES",
  "METRICS",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Ein online sichtbarer Spieler auf einem Server. */
export interface OnlinePlayer {
  uuid?: string;
  name: string;
  /** Spielzeit der aktuellen Session in Sekunden, falls bekannt. */
  sessionSeconds?: number;
}

/** Live-Status eines Servers, wie ihn ein Adapter liefert. */
export interface ServerStatus {
  state: ServerState;
  online: boolean;
  version?: string;
  edition?: ServerEdition;
  motd?: string;
  players: {
    online: number;
    max: number;
    sample: OnlinePlayer[];
  };
  /** Latenz des Status-Pings in Millisekunden. */
  latencyMs?: number;
  /** Zeitpunkt der letzten erfolgreichen Statusabfrage (ISO-8601). */
  lastSeen?: string;
}
