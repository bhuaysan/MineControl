import type { Duplex, Readable } from "node:stream";
import { PassThrough } from "node:stream";
import type { Container } from "dockerode";
import type {
  Capability,
  OnlinePlayer,
  ServerEdition,
  ServerStatus,
} from "@minecontrol/shared";
import { ExternalAdapter } from "./external.js";
import {
  containerName,
  docker,
} from "./dockerClient.js";
import type { ServerAdapter } from "./types.js";

/**
 * Server-IDs, deren Container gerade angelegt wird (Image-Pull + erster Start).
 * In-Memory — nach einem Backend-Neustart gilt der reale Container-Zustand.
 */
const provisioning = new Set<string>();

export function markProvisioning(serverId: string, active: boolean): void {
  if (active) provisioning.add(serverId);
  else provisioning.delete(serverId);
}

export function isProvisioning(serverId: string): boolean {
  return provisioning.has(serverId);
}

export interface DockerAdapterConfig {
  /** Veröffentlichter MC-Port auf dem Host (für Ping). */
  port: number;
  edition: ServerEdition;
  rcon?: { port: number; password: string };
}

/**
 * Adapter für selbst verwaltete Docker-Server (`itzg/minecraft-server`).
 * Netzwerk-Teil (Status-Ping, RCON, Spielerliste) delegiert an den
 * ExternalAdapter gegen `127.0.0.1`; Lifecycle & Metriken kommen aus Docker.
 */
export class DockerAdapter implements ServerAdapter {
  private readonly net: ExternalAdapter;

  constructor(
    private readonly serverId: string,
    cfg: DockerAdapterConfig,
  ) {
    this.net = new ExternalAdapter({
      host: "127.0.0.1",
      port: cfg.port,
      edition: cfg.edition,
      rcon: cfg.rcon,
    });
  }

  capabilities(): Capability[] {
    const caps: Capability[] = [
      "STATUS",
      "PLAYER_LIST",
      "LIFECYCLE_START",
      "LIFECYCLE_STOP",
      "CONSOLE",
      "METRICS",
      "FILES",
    ];
    // itzg-Container haben RCON immer aktiviert.
    caps.push("RCON");
    return caps;
  }

  private container(): Container {
    return docker.getContainer(containerName(this.serverId));
  }

  /** Liest den Docker-Container-Zustand; `null`, wenn kein Container existiert. */
  private async inspectState(): Promise<{
    running: boolean;
    restarting: boolean;
  } | null> {
    try {
      const info = await this.container().inspect();
      return {
        running: info.State.Running === true,
        restarting: info.State.Restarting === true,
      };
    } catch {
      return null; // 404 → Container existiert (noch) nicht.
    }
  }

  async getStatus(): Promise<ServerStatus> {
    const state = await this.inspectState();

    // Container wird gerade erstellt oder existiert noch nicht.
    if (!state) {
      return {
        state: isProvisioning(this.serverId) ? "STARTING" : "OFFLINE",
        online: false,
        edition: this.net.editionValue,
        players: { online: 0, max: 0, sample: [] },
      };
    }

    if (state.restarting) {
      return {
        state: "STARTING",
        online: false,
        edition: this.net.editionValue,
        players: { online: 0, max: 0, sample: [] },
      };
    }

    if (!state.running) {
      return {
        state: "OFFLINE",
        online: false,
        edition: this.net.editionValue,
        players: { online: 0, max: 0, sample: [] },
      };
    }

    // Container läuft — per Ping prüfen, ob MC schon Verbindungen annimmt.
    const net = await this.net.getStatus();
    if (net.online) return net;
    return {
      state: "STARTING", // Container hoch, MC bootet noch.
      online: false,
      edition: this.net.editionValue,
      players: { online: 0, max: 0, sample: [] },
    };
  }

  getPlayers(): Promise<OnlinePlayer[]> {
    return this.net.getPlayers();
  }

  sendCommand(cmd: string): Promise<string> {
    return this.net.sendCommand(cmd);
  }

  async start(): Promise<void> {
    await this.container().start();
  }

  async stop(): Promise<void> {
    // itzg fängt SIGTERM ab und stoppt MC sauber; 60 s Kulanz bis SIGKILL.
    await this.container().stop({ t: 60 });
  }

  async restart(): Promise<void> {
    await this.container().restart({ t: 60 });
  }

  async kill(): Promise<void> {
    await this.container().kill();
  }

  /**
   * Folgt dem Container-Log und ruft `onLine` je Zeile auf. Liefert eine
   * Funktion zum Beenden des Streams zurück. `tail` = anfängliche Zeilen.
   */
  async followLogs(
    onLine: (line: string) => void,
    tail = 200,
  ): Promise<() => void> {
    const stream = (await this.container().logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail,
      timestamps: false,
    })) as unknown as Readable;

    // Ohne TTY sind stdout/stderr gemultiplext → demux + zeilenweise splitten.
    const out = new PassThrough();
    const err = new PassThrough();
    docker.modem.demuxStream(stream, out, err);

    const splitLines = (s: PassThrough) => {
      let buf = "";
      s.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        for (const line of parts) onLine(line);
      });
    };
    splitLines(out);
    splitLines(err);

    return () => {
      stream.destroy();
      out.destroy();
      err.destroy();
    };
  }

  /**
   * Streamt Docker-Statistiken und ruft `onSample` mit CPU-%/RAM auf.
   * Liefert eine Funktion zum Beenden zurück.
   */
  async followStats(
    onSample: (s: { cpuPercent: number; ramUsedMb: number; ramMaxMb: number }) => void,
  ): Promise<() => void> {
    const stream = (await this.container().stats({ stream: true })) as unknown as Readable;
    let buf = "";
    stream.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line) continue;
        try {
          const sample = parseStats(JSON.parse(line));
          if (sample) onSample(sample);
        } catch {
          /* unvollständiges JSON ignorieren */
        }
      }
    });
    return () => stream.destroy();
  }

  /** Einzelne Momentaufnahme von CPU-%/RAM; `null`, wenn nicht verfügbar. */
  async sampleStats(): Promise<{
    cpuPercent: number;
    ramUsedMb: number;
    ramMaxMb: number;
  } | null> {
    try {
      const raw = (await this.container().stats({ stream: false })) as unknown;
      return parseStats(raw as DockerStatsJson);
    } catch {
      return null;
    }
  }

  /** Öffnet eine hijack-fähige Exec-Session (für Datei-Lesen/Schreiben). */
  async exec(cmd: string[], stdin?: string): Promise<string> {
    const container = this.container();
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: Boolean(stdin),
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = (await exec.start({ hijack: true, stdin: Boolean(stdin) })) as Duplex;
    const out = new PassThrough();
    const err = new PassThrough();
    docker.modem.demuxStream(stream, out, err);

    const chunks: Buffer[] = [];
    out.on("data", (c: Buffer) => chunks.push(c));

    if (stdin) {
      stream.write(stdin);
      stream.end();
    }
    await new Promise<void>((resolve) => stream.on("end", resolve));
    return Buffer.concat(chunks).toString("utf8");
  }
}

interface DockerStatsJson {
  cpu_stats?: CpuStats;
  precpu_stats?: CpuStats;
  memory_stats?: { usage?: number; limit?: number; stats?: { cache?: number } };
}
interface CpuStats {
  cpu_usage?: { total_usage?: number };
  system_cpu_usage?: number;
  online_cpus?: number;
}

/** Berechnet CPU-% und RAM (MB) aus einem Docker-Stats-Sample. */
function parseStats(
  s: DockerStatsJson,
): { cpuPercent: number; ramUsedMb: number; ramMaxMb: number } | null {
  const cpu = s.cpu_stats;
  const pre = s.precpu_stats;
  const mem = s.memory_stats;
  if (!cpu?.cpu_usage || !pre?.cpu_usage || !mem) return null;

  const cpuDelta = (cpu.cpu_usage.total_usage ?? 0) - (pre.cpu_usage.total_usage ?? 0);
  const sysDelta = (cpu.system_cpu_usage ?? 0) - (pre.system_cpu_usage ?? 0);
  const cpus = cpu.online_cpus ?? 1;
  const cpuPercent =
    sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;

  // „cache" abziehen entspricht dem, was `docker stats` als Nutzung zeigt.
  const cache = mem.stats?.cache ?? 0;
  const usedBytes = Math.max((mem.usage ?? 0) - cache, 0);
  return {
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    ramUsedMb: Math.round(usedBytes / 1_048_576),
    ramMaxMb: Math.round((mem.limit ?? 0) / 1_048_576),
  };
}
