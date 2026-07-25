import { randomBytes } from "node:crypto";
import type { Network, Server } from "@prisma/client";
import type { NetworkDto, NetworkMemberDto, ServerEdition } from "@minecontrol/shared";
import { createAdapter, createDockerAdapter } from "../../adapters/registry.js";
import {
  PROXY_DATA_DIR,
  ensureDockerNetwork,
  networkName,
  removeDockerNetwork,
} from "../../adapters/dockerClient.js";
import { decryptSecret, encryptSecret } from "../../crypto.js";
import { prisma } from "../../db.js";
import { isHostPortBound, withPortLock } from "../../portLock.js";
import { recordAudit } from "../audit/service.js";
import {
  broadcastServerStatus,
  detachServerStreams,
  pushConsoleLine,
  reattachServerStreams,
} from "../../ws/index.js";
import { suppressDownAlert } from "../metrics/service.js";
import {
  destroyDockerServer,
  provisionDockerServer,
  provisionProxyServer,
  putDataFiles,
  readDataTextFile,
} from "../servers/docker.js";
import { patchSpigotBungee, renderBungeeConfig } from "./bungee.js";
import { configureModdedForwarding } from "./moddedForwarding.js";
import { patchPaperVelocity, renderVelocityToml } from "./velocity.js";

const MODDED_EDITIONS = ["FABRIC", "FORGE", "NEOFORGE"];

/** Erlaubte Subserver-Editionen je Proxy-Typ (modded braucht Velocity-Forwarding-Mods). */
function allowedSubserverEditions(proxyEdition: string): string[] {
  return proxyEdition === "BUNGEECORD"
    ? ["PAPER", "SPIGOT"]
    : ["PAPER", "SPIGOT", ...MODDED_EDITIONS];
}

/** Fehler mit HTTP-Status für die Route-Schicht. */
export class NetworkError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const PAPER_GLOBAL_PATH = "/data/config/paper-global.yml";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Prozessweiter Per-Ressourcen-Mutex ─────────────────────────────────────────
//
// SQLite (und der Single-Process-Server) bieten kein Row-Locking über mehrere
// Statements hinweg. Um zu verhindern, dass zwei Anfragen denselben Container
// gleichzeitig zerstören/neu aufsetzen (destroy/create-Race auf demselben
// `containerName(server.id)`) oder denselben Proxy gleichzeitig neu starten,
// serialisieren wir Operationen anhand einer Ressourcen-ID (Server- bzw.
// Proxy-ID). Verschiedene IDs laufen weiterhin parallel; gleiche IDs reihen
// sich hintereinander ein.
const resourceLocks = new Map<string, Promise<unknown>>();

/** Führt `fn` aus, sobald keine andere Operation mit derselben `id` mehr läuft. */
function withResourceLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = resourceLocks.get(id) ?? Promise.resolve();
  // `prev` ist stets ein bereits gefangenes Promise → läuft `fn` erst nach dem
  // Settlen des Vorgängers, unabhängig von dessen Ausgang.
  const run = prev.then(fn);
  const tail = run.catch(() => {});
  resourceLocks.set(id, tail);
  // Aufräumen, sobald diese Operation das Kettenende ist (verhindert das
  // unbegrenzte Wachsen der Map bei vielen kurzlebigen Servern).
  void tail.then(() => {
    if (resourceLocks.get(id) === tail) resourceLocks.delete(id);
  });
  return run;
}

/** Wirft, falls ein Host-Port bereits von einem Server belegt ist (DB) oder
 * tatsächlich am Host gebunden ist (Fremdprozess/Altlast ohne DB-Zeile). */
async function assertPortFree(...ports: number[]): Promise<void> {
  const clash = await prisma.server.findFirst({
    where: {
      OR: ports.flatMap((p) => [{ port: p }, { rconPort: p }]),
    },
  });
  if (clash || (await Promise.all(ports.map(isHostPortBound))).some(Boolean)) {
    throw new NetworkError(409, "port_in_use", `Port bereits belegt`);
  }
}

// ── DTO-Aufbau ────────────────────────────────────────────────────────────────

async function serverState(server: Server): Promise<string> {
  try {
    return (await createAdapter(server).getStatus()).state;
  } catch {
    return "UNKNOWN";
  }
}

type NetworkWithRelations = Network & {
  proxyServer: Server;
  members: Server[];
};

async function toNetworkDto(network: NetworkWithRelations): Promise<NetworkDto> {
  const members: NetworkMemberDto[] = await Promise.all(
    [...network.members]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(async (m) => ({
        serverId: m.id,
        alias: m.networkAlias ?? m.id,
        name: m.name,
        edition: m.edition as ServerEdition,
        state: (await serverState(m)) as NetworkMemberDto["state"],
      })),
  );
  return {
    id: network.id,
    name: network.name,
    proxy: {
      serverId: network.proxyServer.id,
      name: network.proxyServer.name,
      edition: network.proxyServer.edition as ServerEdition,
      host: network.proxyServer.host,
      port: network.proxyServer.port,
      state: (await serverState(network.proxyServer)) as NetworkDto["proxy"]["state"],
    },
    members,
    createdAt: network.createdAt.toISOString(),
  };
}

function includeRelations() {
  return { proxyServer: true, members: true } as const;
}

export async function listNetworkDtos(): Promise<NetworkDto[]> {
  const networks = await prisma.network.findMany({
    include: includeRelations(),
    orderBy: { createdAt: "asc" },
  });
  return Promise.all(networks.map((n) => toNetworkDto(n)));
}

export async function getNetworkDto(id: string): Promise<NetworkDto | null> {
  const network = await prisma.network.findUnique({
    where: { id },
    include: includeRelations(),
  });
  return network ? toNetworkDto(network) : null;
}

// ── Proxy-Konfiguration schreiben ──────────────────────────────────────────────

/** Erzeugt die Proxy-Konfiguration aus dem aktuellen Mitgliederstand und spielt sie ein.
 * Exportiert, weil auch das direkte Löschen eines Subservers (servers/routes.ts)
 * den Alias aus der Proxy-Config entfernen muss — sonst bleibt dort ein toter
 * Backend-Eintrag stehen. */
export async function rewriteProxyConfig(networkId: string): Promise<void> {
  // Das frische Neuladen des Netzes UND der Config-Write+Restart laufen unter
  // dem Proxy-Lock, damit zwei nebenläufige Netz-Änderungen weder eine veraltete
  // Mitgliederliste schreiben noch den Proxy doppelt/überlappend neu starten.
  const network = await prisma.network.findUnique({
    where: { id: networkId },
    include: includeRelations(),
  });
  if (!network) return;
  await withResourceLock(network.proxyServer.id, async () => {
    // Innerhalb des Locks erneut laden — die Mitgliederliste kann sich seit dem
    // ersten Lesen (vor dem Lock-Erwerb) geändert haben.
    const fresh = await prisma.network.findUnique({
      where: { id: networkId },
      include: includeRelations(),
    });
    if (!fresh) return;
    const backends = [...fresh.members]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .filter((m) => m.networkAlias)
      .map((m) => ({ alias: m.networkAlias as string }));

    const isBungee = fresh.proxyServer.edition === "BUNGEECORD";
    const filename = isBungee ? "config.yml" : "velocity.toml";
    const content = isBungee
      ? renderBungeeConfig({ motd: fresh.proxyServer.name, backends })
      : renderVelocityToml({ motd: fresh.proxyServer.name, backends });
    await putDataFiles(fresh.proxyServer.id, PROXY_DATA_DIR, [{ name: filename, content }]);
    // Weder Velocity noch BungeeCord haben eine zuverlässige Hot-Reload ohne
    // Plugin → Proxy neu starten.
    suppressDownAlert(fresh.proxyServer.id);
    try {
      await createDockerAdapter(fresh.proxyServer).restart();
      reattachServerStreams(fresh.proxyServer.id);
    } catch {
      /* Proxy evtl. noch nicht gestartet — Config wird beim Start gelesen. */
    }
    void broadcastServerStatus(fresh.proxyServer.id);
  });
}

// ── Container mit korrektem online-mode-Env neu aufsetzen ──────────────────────

/**
 * Die beim Anlegen gespeicherten Wizard-Parameter eines Docker-Servers. Muss
 * ALLE Felder abdecken, die `ProvisionParams` (servers/docker.ts) in Container-
 * Env übersetzt — `reprovisionServer` erzeugt den Container daraus neu, und was
 * hier fehlt, ist danach weg: ein fehlendes `modrinthModpack` ließe den Server
 * als nackte Loader-Installation neu starten, ein fehlendes `difficulty`/
 * `gamemode` würde von itzg beim Boot auf dessen Defaults (easy/survival)
 * zurückgeschrieben.
 */
interface DockerCfg {
  edition: string;
  version: string;
  memoryMb: number;
  motd?: string;
  onlineMode: boolean;
  seed?: string;
  difficulty?: string;
  gamemode?: string;
  modrinthModpack?: string;
  curseforgeModpack?: string;
}

/** Liest die im Server hinterlegten Wizard-Parameter (dockerConfig-JSON).
 * Exportiert (nur) für Unit-Tests — siehe networks/service.test.ts. */
export function parseDockerCfg(server: Server): DockerCfg {
  let c: Record<string, unknown> = {};
  try {
    c = server.dockerConfig ? (JSON.parse(server.dockerConfig) as Record<string, unknown>) : {};
  } catch {
    /* ungültiges JSON → Defaults. */
  }
  return {
    edition: (c.edition as string) ?? server.edition,
    version: (c.version as string) ?? "LATEST",
    memoryMb: (c.memoryMb as number) ?? 2048,
    motd: c.motd as string | undefined,
    onlineMode: (c.onlineMode as boolean) ?? true,
    seed: c.seed as string | undefined,
    difficulty: c.difficulty as string | undefined,
    gamemode: c.gamemode as string | undefined,
    modrinthModpack: c.modrinthModpack as string | undefined,
    curseforgeModpack: c.curseforgeModpack as string | undefined,
  };
}

/**
 * Setzt einen Docker-Server neu auf (Container zerstören, Volume behalten) mit
 * gewünschtem online-mode und optionaler Netzwerk-Zugehörigkeit. Nötig, weil
 * itzg online-mode bei jedem Start aus dem Env schreibt — ein reines Ändern von
 * server.properties würde beim nächsten Neustart überschrieben.
 */
async function reprovisionServer(
  server: Server,
  opts: { onlineMode: boolean; networkName?: string; networkAlias?: string },
): Promise<void> {
  const cfg = parseDockerCfg(server);
  const rconPassword = server.rconPasswordEnc
    ? decryptSecret(server.rconPasswordEnc)
    : randomBytes(16).toString("hex");
  const rconHostPort = server.rconPort ?? server.port + 10000;
  detachServerStreams(server.id);
  await destroyDockerServer(server, true); // Welt & Configs im Volume behalten
  await provisionDockerServer(server, {
    edition: cfg.edition,
    version: cfg.version,
    memoryMb: cfg.memoryMb,
    mcPort: server.port,
    rconHostPort,
    rconPassword,
    // Alles außer `onlineMode` (und der Netz-Zugehörigkeit) unverändert aus der
    // ursprünglichen Anlage übernehmen — der Container wird hier nur wegen des
    // online-mode-Env neu erzeugt, nicht umkonfiguriert.
    seed: cfg.seed,
    difficulty: cfg.difficulty,
    gamemode: cfg.gamemode,
    motd: cfg.motd,
    onlineMode: opts.onlineMode,
    modrinthModpack: cfg.modrinthModpack,
    curseforgeModpack: cfg.curseforgeModpack,
    networkName: opts.networkName,
    networkAlias: opts.networkAlias,
  });
}

// ── Paper-Velocity-Forwarding (paper-global.yml) ───────────────────────────────

/**
 * Aktiviert/deaktiviert den Velocity-Block in paper-global.yml und startet neu.
 * `waitForConfig` pollt auf die (erst nach dem ersten Boot erzeugte) Datei.
 * online-mode wird nicht hier, sondern über das Container-Env gesteuert
 * (siehe reprovisionServer).
 */
async function configurePaperVelocity(
  server: Server,
  secret: string,
  enabled: boolean,
  waitForConfig: boolean,
): Promise<void> {
  let raw = await readDataTextFile(server.id, PAPER_GLOBAL_PATH);
  if (!raw && waitForConfig) {
    pushConsoleLine(server.id, "» Warte auf Paper-Konfiguration …");
    for (let i = 0; i < 40 && !raw; i++) {
      await sleep(3000);
      raw = await readDataTextFile(server.id, PAPER_GLOBAL_PATH);
    }
  }
  if (!raw) {
    pushConsoleLine(
      server.id,
      "! paper-global.yml nicht gefunden — Velocity-Forwarding nicht gesetzt.",
    );
    return;
  }
  const { content, patched } = patchPaperVelocity(raw, secret, enabled);
  if (patched) {
    await putDataFiles(server.id, "/data/config", [{ name: "paper-global.yml", content }]);
  } else {
    pushConsoleLine(server.id, "! Velocity-Block in paper-global.yml nicht gefunden.");
  }

  suppressDownAlert(server.id);
  try {
    await createDockerAdapter(server).restart();
    reattachServerStreams(server.id);
    pushConsoleLine(
      server.id,
      enabled
        ? "» Velocity-Forwarding aktiviert, Subserver neu gestartet."
        : "» Velocity-Forwarding deaktiviert, Subserver neu gestartet.",
    );
  } catch {
    /* Best effort. */
  }
  void broadcastServerStatus(server.id);
}

// ── Spigot-BungeeCord-Forwarding (spigot.yml) ─────────────────────────────────

const SPIGOT_YML_PATH = "/data/spigot.yml";

/**
 * Aktiviert/deaktiviert `settings.bungeecord` in spigot.yml und startet neu.
 * BungeeCord braucht kein Secret (einfaches IP-Forwarding statt Velocitys
 * Modern Forwarding) — nur diesen einen Schalter auf der Backend-Seite.
 */
async function configureSpigotBungee(server: Server, enabled: boolean): Promise<void> {
  let raw = await readDataTextFile(server.id, SPIGOT_YML_PATH);
  if (!raw) {
    pushConsoleLine(server.id, "» Warte auf Spigot-Konfiguration …");
    for (let i = 0; i < 40 && !raw; i++) {
      await sleep(3000);
      raw = await readDataTextFile(server.id, SPIGOT_YML_PATH);
    }
  }
  if (!raw) {
    pushConsoleLine(
      server.id,
      "! spigot.yml nicht gefunden — BungeeCord-Forwarding nicht gesetzt.",
    );
    return;
  }
  const { content, patched } = patchSpigotBungee(raw, enabled);
  if (patched) {
    await putDataFiles(server.id, "/data", [{ name: "spigot.yml", content }]);
  } else {
    pushConsoleLine(server.id, "! bungeecord-Feld in spigot.yml nicht gefunden.");
  }

  suppressDownAlert(server.id);
  try {
    await createDockerAdapter(server).restart();
    reattachServerStreams(server.id);
    pushConsoleLine(
      server.id,
      enabled
        ? "» BungeeCord-Forwarding aktiviert, Subserver neu gestartet."
        : "» BungeeCord-Forwarding deaktiviert, Subserver neu gestartet.",
    );
  } catch {
    /* Best effort. */
  }
  void broadcastServerStatus(server.id);
}

// ── Forwarding-Dispatcher (Proxy-Typ × Subserver-Edition) ─────────────────────

/**
 * Konfiguriert das passende Forwarding auf einem Subserver, je nach Proxy-Typ
 * und Server-Edition: Paper/Spigot+Velocity → paper-global.yml,
 * Paper/Spigot+BungeeCord → spigot.yml, modded (Fabric/Forge/NeoForge, nur
 * hinter Velocity möglich) → Kompatibilitäts-Mod + dessen Config.
 */
async function configureBackendForwarding(
  server: Server,
  network: NetworkWithRelations,
  enabled: boolean,
): Promise<void> {
  if (network.proxyServer.edition === "BUNGEECORD") {
    await configureSpigotBungee(server, enabled);
    return;
  }
  const secret = decryptSecret(network.forwardingSecretEnc);
  if (MODDED_EDITIONS.includes(server.edition)) {
    await configureModdedForwarding(server, secret, enabled);
  } else {
    await configurePaperVelocity(server, secret, enabled, true);
  }
}

// ── Netzwerk erstellen ─────────────────────────────────────────────────────────

export interface CreateNetworkInput {
  name: string;
  proxyName: string;
  /** Proxy-Software; Standard Velocity. */
  proxyEdition?: "VELOCITY" | "BUNGEECORD";
  version: string;
  memoryMb: number;
  port: number;
}

export async function createNetwork(
  input: CreateNetworkInput,
): Promise<{ networkId: string; proxyServerId: string }> {
  const proxyEdition = input.proxyEdition ?? "VELOCITY";
  const isBungee = proxyEdition === "BUNGEECORD";
  // BungeeCord braucht kein Forwarding-Secret (IP-Forwarding statt Modern
  // Forwarding) — wird trotzdem erzeugt/gespeichert, um das Datenmodell und
  // den restlichen Code (forwardingSecretEnc ist ein Pflichtfeld) einfach zu
  // halten; bleibt für BungeeCord-Netzwerke schlicht ungenutzt.
  const secret = randomBytes(24).toString("hex");

  // Prüfung + Anlage serialisiert (withPortLock) — sonst könnten zwei
  // nebenläufige Anfragen (auch gegen die Docker-Server-Anlage in
  // servers/routes.ts) denselben Port beide als frei sehen (TOCTOU).
  const proxyServer = await withPortLock(async () => {
    await assertPortFree(input.port);
    // Proxy-Server-Datensatz (kein RCON, Host 127.0.0.1, Port = Netzwerk-Port).
    return prisma.server.create({
      data: {
        name: input.proxyName,
        type: "DOCKER",
        edition: proxyEdition,
        host: "127.0.0.1",
        port: input.port,
        dockerConfig: JSON.stringify({
          edition: proxyEdition,
          version: input.version,
          memoryMb: input.memoryMb,
          isProxy: true,
        }),
      },
    });
  });

  const network = await prisma.network.create({
    data: {
      name: input.name,
      proxyServerId: proxyServer.id,
      forwardingSecretEnc: encryptSecret(secret),
      dockerNetworkName: "", // gleich mit ID befüllt
    },
  });
  const dockerNet = networkName(network.id);
  await prisma.network.update({
    where: { id: network.id },
    data: { dockerNetworkName: dockerNet },
  });

  await ensureDockerNetwork(dockerNet);

  const configFilename = isBungee ? "config.yml" : "velocity.toml";
  const configContent = isBungee
    ? renderBungeeConfig({ motd: input.proxyName, backends: [] })
    : renderVelocityToml({ motd: input.proxyName, backends: [] });
  void provisionProxyServer(proxyServer, {
    proxyEdition,
    version: input.version,
    memoryMb: input.memoryMb,
    mcPort: input.port,
    networkName: dockerNet,
    configFilename,
    configContent,
    forwardingSecret: isBungee ? undefined : secret,
  }).catch((err) => {
    pushConsoleLine(proxyServer.id, `Proxy-Provisionierung fehlgeschlagen: ${err}`);
    // Konsolen-Zeile ist flüchtig (kein Abonnent nötig) — zusätzlich dauerhaft
    // im Audit-Log festhalten, sonst verschwindet der Fehler spurlos.
    void recordAudit({
      serverId: proxyServer.id,
      action: "network.proxy_provision_failed",
      details: { networkId: network.id, error: String(err) },
    });
  });

  return { networkId: network.id, proxyServerId: proxyServer.id };
}

// ── Subserver anhängen (bestehend) ─────────────────────────────────────────────

async function loadNetwork(networkId: string): Promise<NetworkWithRelations> {
  const network = await prisma.network.findUnique({
    where: { id: networkId },
    include: includeRelations(),
  });
  if (!network) {
    throw new NetworkError(404, "not_found", "Netzwerk nicht gefunden");
  }
  return network;
}

function assertAliasFree(network: NetworkWithRelations, alias: string): void {
  if (network.members.some((m) => m.networkAlias === alias)) {
    throw new NetworkError(409, "alias_in_use", `Alias „${alias}" ist belegt`);
  }
}

export async function attachSubserver(
  networkId: string,
  serverId: string,
  alias: string,
): Promise<void> {
  const network = await loadNetwork(networkId);
  assertAliasFree(network, alias);

  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server) throw new NetworkError(404, "not_found", "Server nicht gefunden");
  if (server.type !== "DOCKER") {
    throw new NetworkError(422, "unsupported", "Nur Docker-Server möglich");
  }
  if (server.networkId || server.id === network.proxyServerId) {
    throw new NetworkError(409, "already_member", "Server ist bereits in einem Netzwerk");
  }
  const allowed = allowedSubserverEditions(network.proxyServer.edition);
  if (!allowed.includes(server.edition)) {
    throw new NetworkError(
      422,
      "unsupported",
      `Dieser Proxy unterstützt nur: ${allowed.join("/")}`,
    );
  }

  // Paper/Spigot: paper-global.yml muss existieren (Server muss einmal
  // gestartet worden sein). Modded Editionen haben keine vergleichbare
  // Vorbedingung — der Forwarding-Mod wird beim Anhängen selbst installiert.
  if (["PAPER", "SPIGOT"].includes(server.edition)) {
    const raw = await readDataTextFile(server.id, PAPER_GLOBAL_PATH);
    if (!raw) {
      throw new NetworkError(
        409,
        "not_initialized",
        "Subserver muss einmal gestartet worden sein (paper-global.yml fehlt)",
      );
    }
  }

  // Membership-Entscheidung pro Netz serialisiert: Alias-Prüfung gegen den
  // *frischen* Stand + atomarer Claim schließen das TOCTOU-Fenster zwischen
  // zwei nebenläufigen Attach-Anfragen (der Claim belegt nur, wenn der Server
  // noch in keinem Netz ist).
  await withResourceLock(network.id, async () => {
    const fresh = await loadNetwork(networkId);
    assertAliasFree(fresh, alias);
    const claimed = await prisma.server.updateMany({
      where: { id: server.id, networkId: null },
      data: { networkId: network.id, networkAlias: alias },
    });
    if (claimed.count === 0) {
      throw new NetworkError(409, "already_member", "Server ist bereits in einem Netzwerk");
    }
  });

  // Neu aufsetzen (online-mode aus, im Netzwerk) → Forwarding an → Proxy.
  // Container-Operationen (destroy/create + Forwarding-Patch) laufen unter dem
  // Server-Lock, damit sie sich nicht mit einem parallelen Detach/Reprovision
  // desselben Servers verschränken.
  void withResourceLock(server.id, async () => {
    await reprovisionServer(server, {
      onlineMode: false,
      networkName: network.dockerNetworkName,
      networkAlias: alias,
    });
    await configureBackendForwarding(server, network, true);
  })
    .then(() => rewriteProxyConfig(network.id))
    .catch(async (err) => {
      pushConsoleLine(server.id, `Anhängen fehlgeschlagen: ${err}`);
      await recordAudit({
        serverId: server.id,
        action: "network.attach_failed",
        details: { networkId: network.id, alias, error: String(err) },
      });
      // Mitgliedschaft zurücknehmen — sonst zeigt die DB dauerhaft einen
      // Member, dessen Container nie erfolgreich umgebaut wurde.
      await prisma.server
        .updateMany({
          where: { id: server.id, networkId: network.id },
          data: { networkId: null, networkAlias: null },
        })
        .catch(() => {});
      await rewriteProxyConfig(network.id).catch(() => {});
    });

  // Alias sofort im Proxy registrieren (Backend wird gleich erreichbar).
  await rewriteProxyConfig(network.id);
}

// ── Subserver neu erstellen ────────────────────────────────────────────────────

export interface CreateSubserverInput {
  alias: string;
  name: string;
  edition: string;
  version: string;
  memoryMb: number;
  port: number;
  motd?: string;
}

export async function createSubserver(
  networkId: string,
  input: CreateSubserverInput,
): Promise<{ serverId: string }> {
  const network = await loadNetwork(networkId);
  assertAliasFree(network, input.alias);

  const allowed = allowedSubserverEditions(network.proxyServer.edition);
  if (!allowed.includes(input.edition)) {
    throw new NetworkError(
      422,
      "unsupported",
      `Dieser Proxy unterstützt nur: ${allowed.join("/")}`,
    );
  }

  const rconHostPort = input.port + 10000;
  const rconPassword = randomBytes(16).toString("hex");
  // Port-Prüfung + Alias-Prüfung + Anlage serialisiert: withPortLock schließt
  // die Port-TOCTOU (prozessweit, auch gegen andere Server-Anlagen), die
  // verschachtelte withResourceLock(network.id) zusätzlich die Alias-TOCTOU
  // gegen den frischen Stand.
  const server = await withPortLock(() =>
    withResourceLock(network.id, async () => {
      await assertPortFree(input.port, rconHostPort);
      const fresh = await loadNetwork(networkId);
      assertAliasFree(fresh, input.alias);
      return prisma.server.create({
        data: {
          name: input.name,
          type: "DOCKER",
          edition: input.edition,
          host: "127.0.0.1",
          port: input.port,
          rconPort: rconHostPort,
          rconPasswordEnc: encryptSecret(rconPassword),
          networkId: network.id,
          networkAlias: input.alias,
          dockerConfig: JSON.stringify({
            edition: input.edition,
            version: input.version,
            memoryMb: input.memoryMb,
            motd: input.motd,
            onlineMode: false,
          }),
        },
      });
    }),
  );

  // Provisionieren (im Netzwerk, online-mode aus) → dann Forwarding setzen.
  // Container-Operationen unter dem Server-Lock (destroy/create-Race).
  void withResourceLock(server.id, async () => {
    await provisionDockerServer(server, {
      edition: input.edition,
      version: input.version,
      memoryMb: input.memoryMb,
      mcPort: input.port,
      rconHostPort,
      rconPassword,
      motd: input.motd,
      onlineMode: false,
      networkName: network.dockerNetworkName,
      networkAlias: input.alias,
    });
    await configureBackendForwarding(server, network, true);
  })
    .then(() => rewriteProxyConfig(network.id))
    .catch(async (err) => {
      pushConsoleLine(server.id, `Subserver-Einrichtung fehlgeschlagen: ${err}`);
      await recordAudit({
        serverId: server.id,
        action: "network.subserver_create_failed",
        details: { networkId: network.id, alias: input.alias, error: String(err) },
      });
      // Mitgliedschaft zurücknehmen — der Server bleibt als eigenständiger
      // Docker-Server bestehen, gilt aber nicht mehr als Netz-Mitglied, dessen
      // Container nie erfolgreich provisioniert wurde.
      await prisma.server
        .updateMany({
          where: { id: server.id, networkId: network.id },
          data: { networkId: null, networkAlias: null },
        })
        .catch(() => {});
      await rewriteProxyConfig(network.id).catch(() => {});
    });

  // Proxy-Config sofort aktualisieren, damit der Alias registriert ist.
  await rewriteProxyConfig(network.id);
  return { serverId: server.id };
}

// ── Subserver lösen ─────────────────────────────────────────────────────────────

export async function detachSubserver(networkId: string, serverId: string): Promise<void> {
  const network = await loadNetwork(networkId);
  const server = network.members.find((m) => m.id === serverId);
  if (!server) {
    throw new NetworkError(404, "not_found", "Subserver nicht im Netzwerk");
  }

  // Atomare Freigabe (nur wenn noch in genau diesem Netz) — verhindert, dass
  // zwei parallele Detach-Aufrufe den Server beide „erfolgreich" zurücksetzen
  // und dabei den Container doppelt reprovisionieren.
  const released = await prisma.server.updateMany({
    where: { id: server.id, networkId: network.id },
    data: { networkId: null, networkAlias: null },
  });
  if (released.count === 0) return; // bereits von einem anderen Aufruf gelöst
  await rewriteProxyConfig(network.id);

  // Auf Standalone zurücksetzen: neu aufsetzen ohne Netzwerk, online-mode wie
  // ursprünglich, Forwarding-Konfiguration deaktivieren/entfernen. Container-
  // Operationen unter dem Server-Lock (destroy/create-Race).
  const cfg = parseDockerCfg(server);
  void withResourceLock(server.id, async () => {
    await reprovisionServer(server, { onlineMode: cfg.onlineMode });
    await configureBackendForwarding(server, network, false);
  }).catch(async (err) => {
    pushConsoleLine(server.id, `Zurücksetzen fehlgeschlagen: ${err}`);
    // DB gilt bereits als standalone (s.o.) — der Container-Reset ist Best
    // Effort; Fehler dauerhaft festhalten statt nur flüchtig zu loggen.
    await recordAudit({
      serverId: server.id,
      action: "network.detach_reprovision_failed",
      details: { networkId: network.id, error: String(err) },
    });
  });
}

// ── Netzwerk löschen ────────────────────────────────────────────────────────────

export async function deleteNetwork(networkId: string): Promise<void> {
  const network = await loadNetwork(networkId);
  const members = network.members;
  const dockerNet = network.dockerNetworkName;

  // Proxy sofort entfernen; Cascade über proxyServer löscht die Network-Zeile.
  detachServerStreams(network.proxyServer.id);
  await destroyDockerServer(network.proxyServer, false);
  await prisma.server.delete({ where: { id: network.proxyServer.id } });

  // Subserver im Hintergrund auf Standalone zurücksetzen, dann Docker-Netz entfernen.
  void (async () => {
    for (const member of members) {
      await prisma.server
        .update({
          where: { id: member.id },
          data: { networkId: null, networkAlias: null },
        })
        .catch(() => {});
      const cfg = parseDockerCfg(member);
      // Server-Lock: nicht mit einem parallelen Detach/Reprovision desselben
      // Members verschränken.
      await withResourceLock(member.id, async () => {
        await reprovisionServer(member, { onlineMode: cfg.onlineMode });
        await configureBackendForwarding(member, network, false);
      }).catch(async (err) => {
        // Best effort — aber dauerhaft festhalten, sonst bleibt der Member
        // stillschweigend mit veralteter Netzwerk-Konfiguration zurück.
        await recordAudit({
          serverId: member.id,
          action: "network.delete_member_reset_failed",
          details: { networkId, error: String(err) },
        });
      });
    }
    await removeDockerNetwork(dockerNet).catch(async (err) => {
      await recordAudit({
        action: "network.delete_cleanup_failed",
        details: { networkId, dockerNetworkName: dockerNet, error: String(err) },
      });
    });
  })().catch(() => {});
}
