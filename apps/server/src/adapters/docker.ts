import type { Duplex, Readable } from "node:stream";
import { PassThrough } from "node:stream";
import type { Container } from "dockerode";
import type { Capability, OnlinePlayer, ServerEdition, ServerStatus } from "@minecontrol/shared";
import { logger } from "../logger.js";
import { ExternalAdapter, type PersistentRcon } from "./external.js";
import { containerName, docker } from "./dockerClient.js";
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

/**
 * Kurzes Oberlimit für schnelle Docker-Abfragen (`inspect`). Normalfall wenige
 * Millisekunden; der Guard greift nur, wenn der Docker-Daemon einen Request gar
 * nicht beantwortet.
 */
const INSPECT_TIMEOUT_MS = 6000;

/**
 * Oberlimit für Lifecycle-Operationen. Bewusst über der 60-s-Stop-Kulanz
 * ({@link DockerAdapter.stop}), damit ein sauberes SIGTERM→SIGKILL nicht
 * abgeschnitten wird — fängt also nur einen echten Daemon-Hänger ab.
 */
const LIFECYCLE_TIMEOUT_MS = 75000;

/**
 * Umschließt eine dockerode-Operation mit einem harten Timeout. Dockerode-Aufrufe
 * haben von Haus aus KEIN Zeitlimit: Beantwortet der Docker-Daemon einen
 * Socket-Request nie (Daemon unter Last/gestört), blockiert die Operation
 * unbegrenzt. Bei `getStatus()` vergiftet ein solcher Hänger den Status-Cache
 * (`inFlightStatus` in modules/servers/service.ts) dauerhaft — der Server bleibt
 * dann bis zum Backend-Neustart auf UNKNOWN und Lifecycle-Aktionen scheitern mit
 * 502. Der zugrunde liegende Socket-Request läuft nach dem Timeout ggf. noch aus;
 * das ist akzeptiert, weil der Normalfall in Millisekunden abschließt.
 */
function withTimeout<T>(op: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Docker-Operation "${label}" nach ${ms} ms ohne Antwort abgebrochen`)),
      ms,
    );
    op.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e as Error);
      },
    );
  });
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

  /**
   * Liest den Docker-Container-Zustand. `"not_found"` nur bei einem echten
   * 404 (Container existiert nicht) — jeder andere Fehler (Socket-/
   * Berechtigungs-/Daemon-Störung) wird als `"error"` unterschieden, sonst
   * sähe ein kaputter Docker-Zugriff genauso aus wie ein normal gestoppter
   * Server (OFFLINE), obwohl es sich um ein Infrastrukturproblem handelt.
   */
  private async inspectState(): Promise<
    { running: boolean; restarting: boolean } | "not_found" | "error"
  > {
    try {
      const info = await withTimeout(
        this.container().inspect(),
        INSPECT_TIMEOUT_MS,
        `inspect ${this.serverId}`,
      );
      return {
        running: info.State.Running === true,
        restarting: info.State.Restarting === true,
      };
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return "not_found";
      logger.error({ err, serverId: this.serverId }, "Docker-inspect fehlgeschlagen");
      return "error";
    }
  }

  async getStatus(): Promise<ServerStatus> {
    const state = await this.inspectState();

    if (state === "error") {
      return {
        state: "ERROR",
        online: false,
        edition: this.net.editionValue,
        players: { online: 0, max: 0, sample: [] },
      };
    }

    // Container wird gerade erstellt oder existiert noch nicht.
    if (state === "not_found") {
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

  /** Wiederverwendete RCON-Verbindung für wiederholte Befehle (siehe {@link PersistentRcon}). */
  openPersistentRcon(): Promise<PersistentRcon> {
    return this.net.openPersistentRcon();
  }

  async start(): Promise<void> {
    await withTimeout(this.container().start(), LIFECYCLE_TIMEOUT_MS, "start");
  }

  async stop(): Promise<void> {
    // itzg fängt SIGTERM ab und stoppt MC sauber; 60 s Kulanz bis SIGKILL.
    await withTimeout(this.container().stop({ t: 60 }), LIFECYCLE_TIMEOUT_MS, "stop");
  }

  async restart(): Promise<void> {
    await withTimeout(this.container().restart({ t: 60 }), LIFECYCLE_TIMEOUT_MS, "restart");
  }

  async kill(): Promise<void> {
    await withTimeout(this.container().kill(), LIFECYCLE_TIMEOUT_MS, "kill");
  }

  /**
   * Hängt die PFLICHT-Fehlerbehandlung an einen von dockerode gelieferten
   * Live-Stream (Logs/Stats) und liefert die Abbau-Funktion.
   *
   * `docker-modem` hängt an diese Streams KEINEN `error`-Listener:
   * `Modem.demuxStream` registriert ausschließlich `'data'`, nur
   * `followProgress` behandelt Fehler. Ein Socket-Abbruch — im Alltag vor allem
   * ein Neustart des Docker-Daemons, während irgendwo eine Konsole offen ist —
   * wäre damit ein unbehandeltes `error`-Event. Weil index.ts
   * `uncaughtException` bewusst in einen kontrollierten Shutdown übersetzt,
   * hätte das das GESAMTE Backend beendet, statt nur diesen einen Stream.
   *
   * `onClose` meldet dem Aufrufer, dass der Stream von SELBST endete (Fehler
   * oder regulär, z. B. weil der Container gestoppt wurde) — nur dann darf er
   * ihn später neu anhängen. Wird die zurückgegebene Funktion aufgerufen, war
   * es der Aufrufer selbst und `onClose` bleibt aus.
   */
  private guardLiveStream(
    stream: Readable,
    extras: PassThrough[],
    onClose: ((err?: Error) => void) | undefined,
    label: string,
  ): () => void {
    let closed = false;
    const teardown = (notify: boolean, cause?: Error): void => {
      if (closed) return;
      closed = true;
      stream.destroy();
      // Bei einem REGULÄREN Ende (notify ohne cause, z. B. Container gestoppt) die
      // PassThroughs bewusst NICHT zerstören: demuxStream schreibt synchron hinein,
      // ausgeliefert wird aber asynchron — ein destroy() hier würde die letzten
      // Konsolen-Zeilen verwerfen. Sie enden von selbst, sobald sie leer sind.
      if (cause || !notify) for (const s of extras) s.destroy();
      if (notify) onClose?.(cause);
    };

    stream.on("error", (cause: Error) => {
      logger.warn(
        { err: cause, serverId: this.serverId },
        `${label} abgebrochen — wird bei Bedarf neu angehängt`,
      );
      teardown(true, cause);
    });
    stream.on("end", () => teardown(true));
    stream.on("close", () => teardown(true));
    // Die PassThroughs werden beim Abbau zerstört, während demuxStream ggf. noch
    // schreibt (write-after-destroy → 'error') — auch das darf nicht unbehandelt
    // sein, sonst verlagert sich der Crash nur um eine Ebene.
    for (const s of extras) s.on("error", () => {});

    return () => teardown(false);
  }

  /**
   * Folgt dem Container-Log und ruft `onLine` je Zeile auf. Liefert eine
   * Funktion zum Beenden des Streams zurück. `opts.tail` = anfängliche Zeilen,
   * `opts.onClose` siehe {@link guardLiveStream}.
   */
  async followLogs(
    onLine: (line: string) => void,
    opts: { onClose?: (err?: Error) => void; tail?: number } = {},
  ): Promise<() => void> {
    const stream = (await this.container().logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: opts.tail ?? 200,
      timestamps: false,
    })) as unknown as Readable;

    // Ohne TTY sind stdout/stderr gemultiplext → demux + zeilenweise splitten.
    const out = new PassThrough();
    const err = new PassThrough();
    const stop = this.guardLiveStream(stream, [out, err], opts.onClose, "Log-Stream");
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

    return stop;
  }

  /**
   * Streamt Docker-Statistiken und ruft `onSample` mit CPU-%/RAM auf.
   * Liefert eine Funktion zum Beenden zurück (`opts.onClose` siehe
   * {@link guardLiveStream}).
   */
  async followStats(
    onSample: (s: { cpuPercent: number; ramUsedMb: number; ramMaxMb: number }) => void,
    opts: { onClose?: (err?: Error) => void } = {},
  ): Promise<() => void> {
    const stream = (await this.container().stats({ stream: true })) as unknown as Readable;
    const stop = this.guardLiveStream(stream, [], opts.onClose, "Stats-Stream");
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
    return stop;
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
    } catch (err) {
      // Best effort (Metrik), aber nicht mehr komplett stumm: Bei einer echten
      // Störung (Daemon weg, Rechte) blieben die Metriken sonst spurlos leer.
      // 404 (Container existiert (noch) nicht) ist der erwartete Normalfall —
      // den nur auf debug, damit das Log bei gestoppten Servern nicht spammt.
      const level = (err as { statusCode?: number }).statusCode === 404 ? "debug" : "warn";
      logger[level]({ err, serverId: this.serverId }, "Docker-Stats-Sample fehlgeschlagen");
      return null;
    }
  }

  /**
   * Öffnet eine hijack-fähige Exec-Session (für Datei-Lesen/Schreiben).
   * Wirft, wenn der Befehl mit einem Exit-Code ≠ 0 endet — sonst würden
   * fehlgeschlagene mv/find/rm/Konfigurationsbefehle stillschweigend als
   * Erfolg durchgehen.
   */
  async exec(cmd: string[], stdin?: string): Promise<string> {
    const container = this.container();
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: Boolean(stdin),
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = (await exec.start({ hijack: true, stdin: Boolean(stdin) })) as Duplex;
    // Sofort (vor demuxStream und jedem Schreiben) auf Ende/Fehler horchen. Der
    // 'error'-Listener ist doppelt nötig: dockerode/docker-modem hängt an den
    // gehijackten Stream keinen an (→ ein unbehandeltes Event beendet über
    // index.ts den ganzen Prozess, siehe guardLiveStream), UND ohne ihn würde die
    // Promise bei einem Stream-Fehler NIE erfüllt — der Aufrufer (praktisch jede
    // Dateioperation) hinge dann dauerhaft. Ein zusätzliches Timeout fehlt hier
    // weiterhin bewusst (BUGHUNT.md Punkt 16).
    const finished = new Promise<void>((resolve, reject) => {
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    const out = new PassThrough();
    const err = new PassThrough();
    docker.modem.demuxStream(stream, out, err);

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    out.on("data", (c: Buffer) => outChunks.push(c));
    // stderr muss mitgelesen werden — sonst füllt sich der Stream-Puffer und
    // blockiert den Befehl, sobald er genug auf stderr schreibt.
    err.on("data", (c: Buffer) => errChunks.push(c));

    if (stdin) {
      stream.write(stdin);
      stream.end();
    }
    await finished;

    const { ExitCode } = await exec.inspect();
    if (ExitCode) {
      const stderr = Buffer.concat(errChunks).toString("utf8").trim();
      throw new Error(
        `Befehl "${cmd.join(" ")}" fehlgeschlagen (Exit ${ExitCode})${stderr ? `: ${stderr}` : ""}`,
      );
    }
    return Buffer.concat(outChunks).toString("utf8");
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
  const cpuPercent = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;

  // „cache" abziehen entspricht dem, was `docker stats` als Nutzung zeigt.
  const cache = mem.stats?.cache ?? 0;
  const usedBytes = Math.max((mem.usage ?? 0) - cache, 0);
  return {
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    ramUsedMb: Math.round(usedBytes / 1_048_576),
    ramMaxMb: Math.round((mem.limit ?? 0) / 1_048_576),
  };
}
