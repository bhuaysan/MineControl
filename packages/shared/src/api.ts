import type { Role } from "./roles.js";
import type {
  Capability,
  ServerEdition,
  ServerStatus,
  ServerType,
} from "./server.js";

/** Aktuell eingeloggter Benutzer (Antwort von GET /api/me). */
export interface MeResponse {
  id: string;
  username: string;
  role: Role;
}

export interface LoginRequest {
  username: string;
  password: string;
}

/** Benutzer in der Verwaltungsansicht (ohne Passwort-Hash). */
export interface UserDto {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  role: Role;
}

/** Rolle und/oder Passwort ändern (beides optional). */
export interface UpdateUserRequest {
  role?: Role;
  password?: string;
}

/** Server in Listen-/Detailansicht (ohne Secrets wie RCON-Passwort). */
export interface ServerDto {
  id: string;
  name: string;
  type: ServerType;
  edition: ServerEdition;
  host: string;
  port: number;
  hasRcon: boolean;
  capabilities: Capability[];
  status: ServerStatus;
}

/** Anlage eines externen Servers (Phase 1). */
export interface CreateExternalServerRequest {
  name: string;
  host: string;
  port: number;
  edition?: ServerEdition;
  rconPort?: number;
  rconPassword?: string;
}

/** Editionen, die im Docker-Wizard erstellt werden können (via itzg-Image). */
export const DOCKER_EDITIONS = [
  "VANILLA",
  "PAPER",
  "SPIGOT",
  "FORGE",
  "FABRIC",
  "NEOFORGE",
] as const;
export type DockerEdition = (typeof DOCKER_EDITIONS)[number];

/** Spielmodi (server.properties `gamemode`). */
export const GAMEMODES = ["survival", "creative", "adventure", "spectator"] as const;
export type Gamemode = (typeof GAMEMODES)[number];

/** Schwierigkeitsgrade (server.properties `difficulty`). */
export const DIFFICULTIES = ["peaceful", "easy", "normal", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * Anlage eines Docker-Servers (Phase 2). Erzeugt einen `itzg/minecraft-server`-
 * Container. `version` ist eine MC-Version wie „1.21.1" oder „LATEST".
 */
export interface CreateDockerServerRequest {
  name: string;
  edition: DockerEdition;
  version: string;
  memoryMb: number;
  port: number;
  seed?: string;
  difficulty?: Difficulty;
  gamemode?: Gamemode;
  motd?: string;
  onlineMode?: boolean;
  eula: true;
}

/** Lifecycle-Aktion auf einem Server (nur Docker kann alle). */
export const LIFECYCLE_ACTIONS = ["start", "stop", "restart", "kill"] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

/** server.properties als Schlüssel/Wert-Paare (nur Docker). */
export type ServerPropertiesDto = Record<string, string>;

/** Teilmenge der zu speichernden server.properties-Schlüssel. */
export interface UpdateServerPropertiesRequest {
  properties: Record<string, string>;
}

/** Fürs Formular kuratierte, editierbare server.properties-Schlüssel. */
export const EDITABLE_PROPERTIES = [
  "motd",
  "difficulty",
  "gamemode",
  "max-players",
  "pvp",
  "online-mode",
  "view-distance",
  "simulation-distance",
  "spawn-protection",
  "allow-nether",
  "allow-flight",
  "white-list",
  "enforce-whitelist",
  "hardcore",
] as const;

/** Ergebnis eines Verbindungstests im Wizard. */
export interface ConnectionTestResult {
  ping: { ok: boolean; latencyMs?: number; error?: string };
  rcon?: { ok: boolean; error?: string };
}

export interface SendCommandRequest {
  command: string;
}

export interface SendCommandResponse {
  response: string;
}

/** Aktionen, die per Klick auf einen Spieler ausgeführt werden können. */
export const PLAYER_ACTIONS = [
  "kick",
  "ban",
  "unban",
  "whitelist_add",
  "whitelist_remove",
  "op",
  "deop",
] as const;
export type PlayerAction = (typeof PLAYER_ACTIONS)[number];

export interface PlayerActionRequest {
  name: string;
  action: PlayerAction;
  /** Pflicht bei „ban", optional bei „kick". */
  reason?: string;
}

export interface PlayerActionResponse {
  response: string;
}

/** Ein Eintrag im Audit-Log. */
export interface AuditEntryDto {
  id: string;
  username: string;
  serverName?: string;
  action: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

/** Generische Fehlerantwort der API. */
export interface ApiError {
  error: string;
  message: string;
}
