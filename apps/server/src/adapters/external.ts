import type {
  Capability,
  OnlinePlayer,
  ServerEdition,
  ServerStatus,
} from "@minecontrol/shared";
import { Rcon } from "rcon-client";
import { motdToText } from "./motd.js";
import { pingServer } from "./ping.js";
import { UnsupportedOperationError } from "./types.js";
import type { ServerAdapter } from "./types.js";

/** Entfernt Minecraft-Farbcodes (§x) aus einem String. */
function stripColorCodes(text: string): string {
  return text.replace(/§./g, "");
}

/**
 * Parst die Ausgabe von RCON `list`, z. B.
 * „There are 3 of a max of 20 players online: Steve, Alex, Notch".
 */
export function parseListOutput(text: string): OnlinePlayer[] {
  const clean = stripColorCodes(text);
  const match = clean.match(/online:\s*(.*)$/i);
  if (!match || !match[1]) return [];
  return match[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}

export interface ExternalAdapterConfig {
  host: string;
  port: number;
  edition: ServerEdition;
  rcon?: {
    port: number;
    password: string;
  };
}

/**
 * Adapter für bereits laufende, externe Minecraft-Server.
 * Status/Spielerliste via Server List Ping, Befehle via RCON (falls konfiguriert).
 * Start/Stop ist nicht möglich (Prozess läuft außerhalb unserer Kontrolle).
 */
export class ExternalAdapter implements ServerAdapter {
  constructor(private readonly cfg: ExternalAdapterConfig) {}

  capabilities(): Capability[] {
    const caps: Capability[] = ["STATUS", "PLAYER_LIST"];
    if (this.cfg.rcon) {
      // Stop ist via RCON möglich (/stop), Start dagegen nicht.
      caps.push("RCON", "LIFECYCLE_STOP");
    }
    return caps;
  }

  async getStatus(): Promise<ServerStatus> {
    try {
      const result = await pingServer(this.cfg.host, this.cfg.port);
      return {
        state: "ONLINE",
        online: true,
        version: result.version?.name,
        edition: this.cfg.edition,
        motd: motdToText(result.description),
        players: {
          online: result.players?.online ?? 0,
          max: result.players?.max ?? 0,
          sample: (result.players?.sample ?? []).map((p) => ({
            uuid: p.id,
            name: p.name,
          })),
        },
        latencyMs: result.latencyMs,
        lastSeen: new Date().toISOString(),
      };
    } catch {
      // Ping fehlgeschlagen → Server offline oder nicht erreichbar.
      return {
        state: "OFFLINE",
        online: false,
        edition: this.cfg.edition,
        players: { online: 0, max: 0, sample: [] },
      };
    }
  }

  async getPlayers(): Promise<OnlinePlayer[]> {
    // RCON `list` liefert die zuverlässigste Online-Liste; sonst Ping-Sample.
    if (this.cfg.rcon) {
      try {
        return parseListOutput(await this.sendCommand("list"));
      } catch {
        // RCON gerade nicht erreichbar → Fallback unten.
      }
    }
    const status = await this.getStatus();
    return status.players.sample;
  }

  async sendCommand(cmd: string): Promise<string> {
    if (!this.cfg.rcon) {
      throw new UnsupportedOperationError("Befehl senden (RCON nicht konfiguriert)");
    }
    const rcon = await Rcon.connect({
      host: this.cfg.host,
      port: this.cfg.rcon.port,
      password: this.cfg.rcon.password,
      timeout: 5000,
    });
    try {
      return await rcon.send(cmd);
    } finally {
      await rcon.end().catch(() => {});
    }
  }

  async start(): Promise<void> {
    throw new UnsupportedOperationError("Server starten");
  }

  async stop(): Promise<void> {
    // Sauberer Stop nur via RCON /stop möglich.
    await this.sendCommand("stop");
  }

  async restart(): Promise<void> {
    throw new UnsupportedOperationError("Server neu starten");
  }

  /** Testet Ping und (falls konfiguriert) RCON — für den Verbindungs-Wizard. */
  async testConnection(): Promise<{
    ping: { ok: boolean; latencyMs?: number; error?: string };
    rcon?: { ok: boolean; error?: string };
  }> {
    const out: Awaited<ReturnType<ExternalAdapter["testConnection"]>> = {
      ping: { ok: false },
    };
    try {
      const result = await pingServer(this.cfg.host, this.cfg.port);
      out.ping = { ok: true, latencyMs: result.latencyMs };
    } catch (err) {
      out.ping = { ok: false, error: (err as Error).message };
    }

    if (this.cfg.rcon) {
      try {
        const rcon = await Rcon.connect({
          host: this.cfg.host,
          port: this.cfg.rcon.port,
          password: this.cfg.rcon.password,
          timeout: 5000,
        });
        await rcon.end().catch(() => {});
        out.rcon = { ok: true };
      } catch (err) {
        out.rcon = { ok: false, error: (err as Error).message };
      }
    }
    return out;
  }
}
