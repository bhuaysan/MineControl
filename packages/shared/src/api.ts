import type { Role } from "./roles.js";
import type { Capability, ServerEdition, ServerState, ServerStatus, ServerType } from "./server.js";

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
  /** Auto-Restart/Crash-Recovery aktiv (nur für Docker-Server sinnvoll). */
  autoRestart: boolean;
  /** Fehlertext des letzten fehlgeschlagenen Provisionierungsversuchs, falls vorhanden. */
  provisionError?: string;
}

/** Auto-Restart für einen Server ein-/ausschalten. */
export interface SetAutoRestartRequest {
  enabled: boolean;
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
  /**
   * Optional: CurseForge-Modpack (Slug oder Projekt-/Datei-URL). Wenn gesetzt,
   * läuft der Container mit TYPE=AUTO_CURSEFORGE; der Pack bestimmt Loader &
   * Version. Nicht zusammen mit `modrinthModpack` nutzbar.
   */
  curseforgeModpack?: string;
  /**
   * Optional: bestehendes Server-Verzeichnis (.tar.gz) beim Erstellen importieren
   * — für Migration von außerhalb MineControl. Das Archiv wird vor dem ersten
   * Start ins /data-Volume entpackt und die enthaltene Welt aktiviert.
   *  - `upload`: zuvor via POST /api/servers/import/stage hochgeladenes Archiv.
   *  - `path`:   Datei aus dem server-seitigen Import-Verzeichnis (IMPORT_DIR).
   */
  import?: ImportSource;
}

/** Quelle für einen Server-/Welt-Import beim Erstellen (siehe CreateDockerServerRequest). */
export type ImportSource =
  { source: "upload"; stagingId: string } | { source: "path"; filename: string };

/** Eine server-seitig verfügbare Import-Datei (aus IMPORT_DIR). */
export interface ImportSourceDto {
  filename: string;
  sizeBytes: number;
}

/** Antwort von POST /api/servers/import/stage (Datei auf dem Host zwischengespeichert). */
export interface StageUploadResponse {
  stagingId: string;
  sizeBytes: number;
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
  /** Server-Ticks pro Sekunde (nur Paper/Spigot), 0–20. */
  tps?: number;
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

/** Sprache, in der E-Mail-/Discord-Benachrichtigungen versendet werden. */
export type NotificationLocale = "de" | "en";

export interface NotificationSettingsDto {
  /** Webhook-URL wird nie zurückgegeben — nur, ob eine gesetzt ist. */
  discordConfigured: boolean;
  /** SMTP-Passwort wird nie zurückgegeben — nur, ob eine vollständige Konfiguration gesetzt ist. */
  emailConfigured: boolean;
  emailSmtpHost: string;
  emailSmtpPort: number;
  emailSmtpSecure: boolean;
  emailSmtpUser: string;
  emailFrom: string;
  emailTo: string;
  notifyServerDown: boolean;
  notifyBackupFailed: boolean;
  notifyTaskFailed: boolean;
  /** Sprache der versendeten Benachrichtigungen (E-Mail & Discord). */
  notifyLocale: NotificationLocale;
}

export interface UpdateNotificationSettingsRequest {
  /** Leerer String löscht die Webhook-URL. `undefined` lässt sie unverändert. */
  discordWebhookUrl?: string;
  emailSmtpHost?: string;
  emailSmtpPort?: number;
  emailSmtpSecure?: boolean;
  emailSmtpUser?: string;
  /** `undefined` lässt ein vorhandenes Passwort unverändert. */
  emailSmtpPassword?: string;
  emailFrom?: string;
  /** Leerer String löscht die gesamte E-Mail-Konfiguration. `undefined` lässt sie unverändert. */
  emailTo?: string;
  notifyServerDown?: boolean;
  notifyBackupFailed?: boolean;
  notifyTaskFailed?: boolean;
  /** Sprache der versendeten Benachrichtigungen (E-Mail & Discord). */
  notifyLocale?: NotificationLocale;
}

export type NotificationChannel = "discord" | "email";

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
  /** false, wenn die Datei als `.jar.disabled` deaktiviert ist. */
  enabled: boolean;
  /** Herkunft, falls bekannt: "modrinth" | "upload" | "url". */
  source?: string;
}

export interface InstallModRequest {
  projectId: string;
  /** Optional feste Version; sonst wird die neueste kompatible gewählt. */
  versionId?: string;
}

export interface InstallModResponse {
  filename: string;
}

/** Installation einer eigenen Plugin-/Mod-Jar von einer URL. */
export interface InstallFromUrlRequest {
  url: string;
}

/** Plugin/Mod (de)aktivieren (Umbenennen .jar ↔ .jar.disabled). */
export interface ToggleModRequest {
  file: string;
  enabled: boolean;
}

/** Update-Status eines Modrinth-installierten Plugins. */
export interface PluginUpdateDto {
  fileName: string;
  currentVersion?: string;
  latestVersion?: string;
  updateAvailable: boolean;
}

/** Config-Ordner eines Plugins + enthaltene Dateien. */
export interface PluginConfigListDto {
  /** Ordner unter /data (z. B. "/plugins/EssentialsX"); null, wenn nicht ermittelbar. */
  configDir: string | null;
  pluginName?: string;
  entries: FileEntryDto[];
}

/** Inhalt einer Plugin-Config-Datei. */
export interface PluginConfigFileDto {
  path: string;
  content: string;
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

// ── Phase 4: Netzwerk (Velocity/BungeeCord-Proxy) ─────────────────────────────

/** Proxy-Software für ein Netzwerk. */
export const NETWORK_PROXY_EDITIONS = ["VELOCITY", "BUNGEECORD"] as const;
export type NetworkProxyEdition = (typeof NETWORK_PROXY_EDITIONS)[number];

/**
 * Editionen, die als Subserver hinter einem Proxy laufen können. Modded
 * Editionen (FABRIC/FORGE/NEOFORGE) benötigen einen Velocity-Proxy — sie
 * brauchen einen Forwarding-Kompatibilitäts-Mod, den es nur für Velocitys
 * Modern Forwarding gibt (nicht für BungeeCords einfaches IP-Forwarding).
 */
export const NETWORK_SUBSERVER_EDITIONS = [
  "PAPER",
  "SPIGOT",
  "FABRIC",
  "FORGE",
  "NEOFORGE",
] as const;
export type NetworkSubserverEdition = (typeof NETWORK_SUBSERVER_EDITIONS)[number];

/** Editionen, die hinter einem BungeeCord-Proxy laufen können (kein Modern Forwarding). */
export const BUNGEECORD_SUBSERVER_EDITIONS = ["PAPER", "SPIGOT"] as const;

/**
 * Alias-Regeln für Subserver: Velocity-[servers]-Schlüssel und zugleich DNS-Name
 * im Docker-Netzwerk. Muss ein gültiger Hostname sein → keine Unterstriche
 * (Velocity 4 lehnt sie ab), nur Kleinbuchstaben/Ziffern/Bindestrich.
 */
export const NETWORK_ALIAS_REGEX = /^[a-z][a-z0-9-]{0,31}$/;

/** Ein Subserver eines Netzwerks (verweist auf einen vollständigen Server). */
export interface NetworkMemberDto {
  serverId: string;
  alias: string;
  name: string;
  edition: ServerEdition;
  state: ServerState;
}

/** Ein Netzwerk: Proxy (Velocity oder BungeeCord) + zugeordnete Subserver. */
export interface NetworkDto {
  id: string;
  name: string;
  proxy: {
    serverId: string;
    name: string;
    edition: ServerEdition;
    host: string;
    port: number;
    state: ServerState;
  };
  members: NetworkMemberDto[];
  createdAt: string;
}

/** Netzwerk anlegen — provisioniert einen Velocity- oder BungeeCord-Proxy. */
export interface CreateNetworkRequest {
  name: string;
  /** Anzeigename des Proxy-Servers. */
  proxyName: string;
  /** Proxy-Software; Standard Velocity (unterstützt auch modded Subserver). */
  proxyEdition?: NetworkProxyEdition;
  /** Versions-String; wird nur für Velocity ausgewertet (BungeeCord: immer neueste). */
  version?: string;
  memoryMb: number;
  /** Host-Port, unter dem das Netzwerk (der Proxy) erreichbar ist. */
  port: number;
}

/** Bestehenden Docker-Server als Subserver an ein Netzwerk anhängen. */
export interface AttachSubserverRequest {
  mode: "attach";
  serverId: string;
  alias: string;
}

/** Neuen Subserver direkt ins Netzwerk provisionieren. */
export interface CreateSubserverRequest {
  mode: "create";
  alias: string;
  name: string;
  edition: NetworkSubserverEdition;
  version?: string;
  memoryMb: number;
  port: number;
  motd?: string;
}

export type AddSubserverRequest = AttachSubserverRequest | CreateSubserverRequest;

// ── Phase 4: Welt-Verwaltung (nur Docker) ─────────────────────────────────────

/** Eine Welt im /data-Volume (Ordner mit level.dat, ohne Nether/End-Companions). */
export interface WorldDto {
  name: string;
  active: boolean;
  sizeBytes: number;
}

/** Antwort von GET /api/servers/:id/worlds. */
export interface WorldListResponse {
  /** Aktuell aktive Welt (server.properties `level-name`). */
  active: string;
  worlds: WorldDto[];
}

/** Regeln für Weltnamen (ein Pfadsegment, keine Sonderzeichen). */
export const WORLD_NAME_REGEX = /^[A-Za-z0-9_.-]{1,48}$/;

export interface SwitchWorldRequest {
  name: string;
}

export interface CreateWorldRequest {
  name: string;
  /** Optionaler Seed; leer = zufällig. */
  seed?: string;
}

/** Pregeneration via Chunky. */
export interface PregenRequest {
  /** Radius in Blöcken um den Welt-Spawn (0,0). */
  radius: number;
  /** Zu pregenerierende Welt; Standard = aktive Welt. */
  world?: string;
}

export interface PregenResponse {
  /** Chunky war nicht installiert und wurde installiert (Server startet neu). */
  installed: boolean;
  /** Pregen wurde gestartet. */
  started: boolean;
  message: string;
  /** RCON-Ausgabe von Chunky, falls gestartet. */
  output?: string;
}

// ── Phase 4: LuckPerms (Berechtigungen, nur Docker) ───────────────────────────

/** Regeln für LuckPerms-Gruppennamen (LuckPerms führt sie klein). */
export const LP_GROUP_NAME_REGEX = /^[a-z0-9_-]{1,36}$/;
/** Erlaubte Zeichen für einen Berechtigungs-Node (keine Leer-/Steuerzeichen). */
export const LP_NODE_REGEX = /^[A-Za-z0-9_.*:\-/#]{1,128}$/;

/** Status der LuckPerms-Integration für einen Server. */
export interface LuckPermsStatusDto {
  /** Edition unterstützt LuckPerms (Paper/Spigot/Fabric/Forge/NeoForge). */
  supported: boolean;
  /** LuckPerms-JAR liegt im plugins-/mods-Ordner. */
  installed: boolean;
  /** `lp`-Befehle antworten (Server läuft + Plugin geladen). */
  available: boolean;
}

export interface LuckPermsInstallResponse {
  installed: boolean;
  message: string;
}

/** Ein Berechtigungs-Node (für Gruppe oder Spieler). */
export interface LpNodeDto {
  key: string;
  value: boolean;
  /** Kontext-Zusammenfassung, falls nicht global (z. B. „server=survival"). */
  context?: string;
  /** Ablauf, falls temporär. */
  expiry?: string;
}

/** Kurzform einer Gruppe in der Übersicht. */
export interface LpGroupSummaryDto {
  name: string;
  weight?: number;
}

/** Detailansicht einer Gruppe. */
export interface LpGroupDetailDto {
  name: string;
  weight?: number;
  prefix?: string;
  suffix?: string;
  permissions: LpNodeDto[];
}

/** Detailansicht eines Spielers in LuckPerms. */
export interface LpUserDto {
  name: string;
  uuid?: string;
  primaryGroup?: string;
  /** Übergeordnete Gruppen (parents). */
  groups: string[];
  permissions: LpNodeDto[];
}

export interface LpCreateGroupRequest {
  name: string;
}

/** Setzt einen Node (value) — Weglassen von value + DELETE entfernt ihn. */
export interface LpSetPermissionRequest {
  node: string;
  value: boolean;
}

/** Setzt Meta-Werte einer Gruppe (nur gesetzte Felder werden angewandt). */
export interface LpSetMetaRequest {
  prefix?: string;
  suffix?: string;
  weight?: number;
}

export interface LpUserGroupRequest {
  group: string;
}

/** Generische Fehlerantwort der API. */
export interface ApiError {
  error: string;
  message: string;
}
