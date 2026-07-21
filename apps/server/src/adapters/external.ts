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
 * Eine wiederverwendete RCON-Verbindung für wiederholte Befehle (z. B.
 * periodisches TPS-Polling). Baut nur EINMAL eine Verbindung auf statt bei
 * jedem Befehl neu — vermeidet das „RCON Client started/shutting down"-
 * Log-Rauschen in der Server-Konsole. Bei Verbindungsverlust wird beim
 * nächsten `send()` transparent neu verbunden.
 */
export interface PersistentRcon {
  send(cmd: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * Adapter für bereits laufende, externe Minecraft-Server.
 * Status/Spielerliste via Server List Ping, Befehle via RCON (falls konfiguriert).
 * Start/Stop ist nicht möglich (Prozess läuft außerhalb unserer Kontrolle).
 */
export class ExternalAdapter implements ServerAdapter {
  constructor(private readonly cfg: ExternalAdapterConfig) {}

  /** Konfigurierte Edition — für Status-Antworten im Offline-Fall. */
  get editionValue(): ServerEdition {
    return this.cfg.edition;
  }

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

  /**
   * Stellt eine RCON-Verbindung her und hängt VOR dem Connect einen
   * `error`-Listener an. Ohne ihn würde ein asynchrones Socket-`error`-Event
   * (z. B. ECONNRESET, wenn ein bootender Server die Verbindung kappt) als
   * „unhandled error" den gesamten Backend-Prozess abstürzen lassen — der
   * try/catch um `send()` fängt solche Events nicht.
   */
  private async connectRcon(): Promise<Rcon> {
    if (!this.cfg.rcon) {
      throw new UnsupportedOperationError("Befehl senden (RCON nicht konfiguriert)");
    }
    const rcon = new Rcon({
      host: this.cfg.host,
      port: this.cfg.rcon.port,
      password: this.cfg.rcon.password,
      timeout: 5000,
    });
    // Fehler abfangen, damit das Event nie „unhandled" ist; die eigentliche
    // Fehlerweitergabe passiert über die abgelehnten connect()/send()-Promises.
    rcon.on("error", () => {});
    await rcon.connect();
    return rcon;
  }

  async sendCommand(cmd: string): Promise<string> {
    const rcon = await this.connectRcon();
    try {
      return await rcon.send(cmd);
    } finally {
      await rcon.end().catch(() => {});
    }
  }

  /**
   * Öffnet eine RCON-Verbindung, die für mehrere Befehle offen bleibt (siehe
   * {@link PersistentRcon}). Für einmalige Befehle weiterhin `sendCommand`
   * verwenden — dort ist Verbindungsaufbau je Aufruf gewünscht/unkritisch.
   */
  async openPersistentRcon(): Promise<PersistentRcon> {
    let rcon: Rcon | null = await this.connectRcon();
    let closed = false;

    return {
      send: async (cmd: string): Promise<string> => {
        if (closed) throw new Error("RCON-Verbindung bereits geschlossen");
        try {
          rcon ??= await this.connectRcon();
          return await rcon.send(cmd);
        } catch (err) {
          // Verbindung verloren (z. B. Server-Neustart) — beim nächsten
          // send() neu aufbauen, statt dauerhaft zu scheitern.
          rcon = null;
          throw err;
        }
      },
      close: async (): Promise<void> => {
        closed = true;
        const r = rcon;
        rcon = null;
        await r?.end().catch(() => {});
      },
    };
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
        const rcon = await this.connectRcon();
        await rcon.end().catch(() => {});
        out.rcon = { ok: true };
      } catch (err) {
        out.rcon = { ok: false, error: (err as Error).message };
      }
    }
    return out;
  }
}
