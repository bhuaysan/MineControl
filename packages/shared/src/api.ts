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
  twoFactorEnabled: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
  /** TOTP-Code, falls für den Benutzer 2FA aktiv ist. */
  code?: string;
}

/** Antwort auf POST /api/2fa/setup — Secret + QR zur Einrichtung. */
export interface TwoFactorSetupResponse {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
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
  /**
   * Optional: Modrinth-Modpack (Slug, Projekt-ID oder .mrpack-URL). Wenn gesetzt,
   * bestimmt der Pack Loader & Version (TYPE/VERSION werden nicht gesetzt).
   */
  modrinthModpack?: string;
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

// ── Phase 3: Backups ─────────────────────────────────────────────────────────

export const BACKUP_TRIGGERS = ["MANUAL", "SCHEDULED"] as const;
export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];

export interface BackupDto {
  id: string;
  serverId: string;
  sizeBytes: number;
  trigger: BackupTrigger;
  createdAt: string;
}

// ── Phase 3: Geplante Tasks ──────────────────────────────────────────────────

export const TASK_ACTIONS = ["RESTART", "COMMAND", "BACKUP"] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

export interface ScheduledTaskDto {
  id: string;
  serverId: string;
  name: string;
  cron: string;
  action: TaskAction;
  /** Bei COMMAND: `{ command }`, bei BACKUP: `{ retention }`. */
  payload?: Record<string, unknown>;
  enabled: boolean;
  lastRunAt?: string;
  lastError?: string;
  createdAt: string;
}

export interface CreateScheduledTaskRequest {
  name: string;
  cron: string;
  action: TaskAction;
  payload?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateScheduledTaskRequest {
  name?: string;
  cron?: string;
  payload?: Record<string, unknown>;
  enabled?: boolean;
}

// ── Phase 3: Metrik-Historie ─────────────────────────────────────────────────

export interface MetricSampleDto {
  timestamp: string;
  playersOnline: number;
  cpuPercent?: number;
  ramUsedMb?: number;
  ramMaxMb?: number;
}

// ── Phase 3: Datei-Manager (nur Docker) ──────────────────────────────────────

export type FileEntryType = "dir" | "file" | "other";

export interface FileEntryDto {
  name: string;
  type: FileEntryType;
  /** Größe in Bytes (nur bei Dateien aussagekräftig). */
  size: number;
  /** Letzte Änderung (ISO-8601). */
  mtime: string;
}

/** Verzeichnisinhalt relativ zu `/data`. */
export interface FileListResponse {
  /** Aktueller Pfad relativ zu `/data` (führender „/", z. B. „/config"). */
  path: string;
  entries: FileEntryDto[];
}

/** Inhalt einer Textdatei. */
export interface FileContentResponse {
  path: string;
  content: string;
  size: number;
}

/** Maximale Größe editierbarer/lesbarer Textdateien (Bytes). */
export const MAX_EDITABLE_FILE_BYTES = 1_048_576;

// ── Phase 3: Benachrichtigungen (Discord) ────────────────────────────────────

export interface NotificationSettingsDto {
  /** Webhook-URL wird nie zurückgegeben — nur, ob eine gesetzt ist. */
  discordConfigured: boolean;
  notifyServerDown: boolean;
  notifyBackupFailed: boolean;
  notifyTaskFailed: boolean;
}

export interface UpdateNotificationSettingsRequest {
  /** Leerer String löscht die Webhook-URL. `undefined` lässt sie unverändert. */
  discordWebhookUrl?: string;
  notifyServerDown?: boolean;
  notifyBackupFailed?: boolean;
  notifyTaskFailed?: boolean;
}

// ── Phase 4: API-Tokens ──────────────────────────────────────────────────────

export interface ApiTokenDto {
  id: string;
  name: string;
  role: Role;
  /** Ersten Zeichen des Tokens (zur Wiedererkennung). */
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
}

export interface CreateApiTokenRequest {
  name: string;
  role: Role;
  /** Ablauf in Tagen; ohne Angabe unbegrenzt gültig. */
  expiresInDays?: number;
}

/** Antwort beim Anlegen — enthält das Token genau einmal im Klartext. */
export interface CreateApiTokenResponse {
  token: string;
  apiToken: ApiTokenDto;
}

// ── Phase 4: Modrinth (Plugins/Mods) ─────────────────────────────────────────

/** Ein Suchtreffer aus der Modrinth-Suche. */
export interface ModSearchHitDto {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  iconUrl?: string;
  projectType: string;
}

/** Eine installierte Plugin-/Mod-Datei im Container. */
export interface InstalledModDto {
  filename: string;
  sizeBytes: number;
}

export interface InstallModRequest {
  projectId: string;
  /** Optional feste Version; sonst wird die neueste kompatible gewählt. */
  versionId?: string;
}

export interface InstallModResponse {
  filename: string;
}

// ── Phase 3: Spieler-Profile ─────────────────────────────────────────────────

/** Spieler in der Übersichtsliste (/players). */
export interface PlayerListItemDto {
  /** Schlüssel des Spielers (= Name, solange keine UUID bekannt). */
  key: string;
  name: string;
  lastSeen: string;
  totalPlaytimeSeconds: number;
  online: boolean;
}

/** Eine einzelne Spiel-Session. */
export interface PlayerSessionDto {
  serverId: string;
  serverName?: string;
  joinedAt: string;
  leftAt?: string;
  seconds: number;
}

/** Ein moderationsrelevantes Ereignis (aus dem Audit-Log). */
export interface PlayerHistoryEntryDto {
  action: string;
  serverName?: string;
  timestamp: string;
  reason?: string;
}

/** Vollständiges Spieler-Profil (/players/:key). */
export interface PlayerProfileDto {
  key: string;
  name: string;
  firstSeen: string;
  lastSeen: string;
  notes?: string;
  totalPlaytimeSeconds: number;
  sessionCount: number;
  online: boolean;
  currentServerId?: string;
  recentSessions: PlayerSessionDto[];
  history: PlayerHistoryEntryDto[];
}

export interface UpdatePlayerNotesRequest {
  notes: string;
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
