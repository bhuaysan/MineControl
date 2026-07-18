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
