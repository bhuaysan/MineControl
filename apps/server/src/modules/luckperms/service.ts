import { gunzipSync } from "node:zlib";
import type { Server } from "@prisma/client";
import * as tar from "tar-stream";
import type {
  LpGroupDetailDto,
  LpGroupSummaryDto,
  LpNodeDto,
  LpUserDto,
  LuckPermsStatusDto,
} from "@minecontrol/shared";
import { containerName, docker } from "../../adapters/dockerClient.js";
import { logger } from "../../logger.js";
import { createAdapter, createDockerAdapter } from "../../adapters/registry.js";
import { suppressDownAlert } from "../metrics/service.js";
import { installMod, listInstalledMods } from "../mods/service.js";
import { broadcastServerStatus, reattachServerStreams } from "../../ws/index.js";

/** Editionen, für die LuckPerms via /data/plugins bzw. /data/mods läuft. */
const SUPPORTED = ["PAPER", "SPIGOT", "FABRIC", "FORGE", "NEOFORGE"];
/** Verzeichnis von LuckPerms im Container. */
const LP_DIR = "/data/plugins/LuckPerms";
/** Feste Priorität, unter der die App Prefix/Suffix verwaltet. */
const META_PRIORITY = 100;

/** Fehler mit HTTP-Status für die Route-Schicht. */
export class LuckPermsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LuckPermsError";
  }
}

function ensureSupported(server: Server): void {
  if (server.type !== "DOCKER") {
    throw new LuckPermsError(422, "unsupported", "Nur für Docker-Server");
  }
  if (!SUPPORTED.includes(server.edition)) {
    throw new LuckPermsError(
      422,
      "unsupported_edition",
      "LuckPerms benötigt Paper/Spigot/Fabric/Forge/NeoForge",
    );
  }
}

// ── Validierung ────────────────────────────────────────────────────────────────

function assertGroup(name: string): void {
  if (!/^[a-z0-9_-]{1,36}$/.test(name)) {
    throw new LuckPermsError(400, "bad_name", "Ungültiger Gruppenname");
  }
}

function assertNode(node: string): void {
  if (!/^[A-Za-z0-9_.*:\-/#]{1,128}$/.test(node)) {
    throw new LuckPermsError(400, "bad_node", "Ungültiger Berechtigungs-Node");
  }
}

/** Spielername (max. 16 Zeichen) oder UUID. */
function assertUser(name: string): void {
  const isName = /^[A-Za-z0-9_]{1,16}$/.test(name);
  const isUuid = /^[0-9a-fA-F-]{32,36}$/.test(name);
  if (!isName && !isUuid) {
    throw new LuckPermsError(400, "bad_user", "Ungültiger Spielername");
  }
}

/** Text ohne Steuer-/Anführungszeichen (für Prefix/Suffix). */
function assertMetaValue(value: string): void {
  if (value.length > 64 || /["\r\n]/.test(value)) {
    throw new LuckPermsError(400, "bad_meta", 'Ungültiger Wert (max. 64, kein ")');
  }
}

// ── RCON (nur Mutationen — LuckPerms antwortet asynchron, RCON liefert nichts) ──

/**
 * Führt einen `lp`-Befehl über RCON aus. LuckPerms verarbeitet Befehle
 * asynchron und schickt die Antwort verzögert an den Sender zurück; über RCON
 * kommt daher **keine** Ausgabe an. Diese Funktion ist deshalb nur für
 * Mutationen gedacht — Lesevorgänge laufen über {@link readExport}.
 */
async function lp(server: Server, args: string): Promise<void> {
  if (/[\r\n]/.test(args)) {
    throw new LuckPermsError(400, "bad_input", "Ungültige Eingabe");
  }
  try {
    await createAdapter(server).sendCommand(`lp ${args}`);
  } catch (err) {
    const msg = (err as Error).message;
    if (/not running|is not running|ECONNREFUSED|timeout/i.test(msg)) {
      throw new LuckPermsError(409, "not_available", "Server muss laufen");
    }
    throw new LuckPermsError(502, "rcon_failed", msg);
  }
}

// ── Export-basiertes Lesen ──────────────────────────────────────────────────────

interface LpRawNode {
  type: string;
  key: string;
  value: boolean;
  context?: Record<string, string | string[]>;
  expiry?: number;
}
interface LpRawEntity {
  nodes?: LpRawNode[];
  username?: string;
  primaryGroup?: string;
}
interface LpExport {
  groups: Record<string, LpRawEntity>;
  users: Record<string, LpRawEntity>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Liest eine Datei aus dem Container-Volume binärsicher (getArchive → tar). */
function readContainerFile(serverId: string, path: string): Promise<Buffer | null> {
  const container = docker.getContainer(containerName(serverId));
  return new Promise((resolve) => {
    container
      .getArchive({ path })
      .then((archive) => {
        const extract = tar.extract();
        const chunks: Buffer[] = [];
        extract.on("entry", (_header, stream, next) => {
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", next);
          stream.resume();
        });
        extract.on("finish", () =>
          resolve(chunks.length > 0 ? Buffer.concat(chunks) : null),
        );
        extract.on("error", () => resolve(null));
        (archive as unknown as NodeJS.ReadableStream).pipe(extract);
      })
      .catch(() => resolve(null));
  });
}

/**
 * Löst einen vollständigen LuckPerms-Export aus und parst das Ergebnis.
 * `lp export <name>` schreibt `<name>.json.gz` ins LuckPerms-Verzeichnis; wir
 * pollen die Datei, entpacken sie und räumen sie danach wieder weg.
 */
async function readExport(server: Server): Promise<LpExport> {
  ensureSupported(server);
  const name = `mc-export-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const path = `${LP_DIR}/${name}.json.gz`;
  await lp(server, `export ${name}`);

  let data: LpExport | null = null;
  for (let i = 0; i < 40; i++) {
    const buf = await readContainerFile(server.id, path);
    if (buf) {
      try {
        data = JSON.parse(gunzipSync(buf).toString("utf8")) as LpExport;
        break;
      } catch {
        /* Datei wird noch geschrieben — erneut versuchen */
      }
    }
    await sleep(250);
  }
  // Aufräumen — abgewartet statt fire-and-forget, Fehler geloggt statt
  // verschluckt: sonst bleiben Exportdateien bei jedem Fehlschlag (Container
  // nicht erreichbar, Berechtigung, …) dauerhaft im LuckPerms-Verzeichnis liegen.
  try {
    await createDockerAdapter(server).exec(["rm", "-f", path]);
  } catch (err) {
    logger.error({ err, serverId: server.id, path }, "LuckPerms-Exportdatei konnte nicht entfernt werden");
  }

  if (!data) {
    throw new LuckPermsError(
      409,
      "not_available",
      "LuckPerms-Export nicht erhalten — Server muss laufen und LuckPerms geladen sein",
    );
  }
  data.groups ??= {};
  data.users ??= {};
  return data;
}

// ── Parser (Export-Nodes → DTOs) ───────────────────────────────────────────────

function formatContext(ctx?: Record<string, string | string[]>): string | undefined {
  if (!ctx) return undefined;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(ctx)) {
    if (Array.isArray(v)) for (const x of v) parts.push(`${k}=${x}`);
    else parts.push(`${k}=${v}`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/** Filtert die reinen Berechtigungs-Nodes einer Entität. */
function permissionNodes(entity: LpRawEntity): LpNodeDto[] {
  return (entity.nodes ?? [])
    .filter((n) => n.type === "permission")
    .map((n) => ({
      key: n.key,
      value: n.value,
      context: formatContext(n.context),
      expiry: n.expiry ? new Date(n.expiry * 1000).toISOString() : undefined,
    }));
}

/** Übergeordnete Gruppen (inheritance-Nodes: key = `group.<name>`). */
function parentGroups(entity: LpRawEntity): string[] {
  return (entity.nodes ?? [])
    .filter((n) => n.type === "inheritance" && n.key.startsWith("group."))
    .map((n) => n.key.slice("group.".length));
}

/** Höchstpriorisierten Prefix/Suffix-Wert extrahieren. */
function metaValue(entity: LpRawEntity, type: "prefix" | "suffix"): string | undefined {
  let best: { priority: number; value: string } | undefined;
  for (const n of entity.nodes ?? []) {
    if (n.type !== type) continue;
    const m = n.key.match(new RegExp(`^${type}\\.(-?\\d+)\\.(.*)$`, "s"));
    if (!m) continue;
    const priority = Number(m[1]);
    if (!best || priority > best.priority) best = { priority, value: m[2]! };
  }
  return best?.value;
}

function weightValue(entity: LpRawEntity): number | undefined {
  for (const n of entity.nodes ?? []) {
    if (n.type === "weight") {
      const m = n.key.match(/^weight\.(-?\d+)$/);
      if (m) return Number(m[1]);
    }
  }
  return undefined;
}

// ── Status / Installation ────────────────────────────────────────────────────

export async function getStatus(server: Server): Promise<LuckPermsStatusDto> {
  if (server.type !== "DOCKER" || !SUPPORTED.includes(server.edition)) {
    return { supported: false, installed: false, available: false };
  }
  let installed = false;
  try {
    const mods = await listInstalledMods(server);
    installed = mods.some((m) => /luckperms/i.test(m.filename));
  } catch {
    installed = false;
  }

  // Verfügbar = Server online UND LuckPerms hat sein Verzeichnis angelegt
  // (RCON liefert für `lp`-Befehle keine Ausgabe, daher kein Befehls-Ping).
  let available = false;
  try {
    const online = (await createAdapter(server).getStatus()).online;
    if (online) {
      const cfg = await readContainerFile(server.id, `${LP_DIR}/config.yml`);
      available = cfg !== null;
      if (available) installed = true;
    }
  } catch {
    available = false;
  }

  return { supported: true, installed, available };
}

export async function install(
  server: Server,
): Promise<{ installed: boolean; message: string }> {
  ensureSupported(server);
  const mods = await listInstalledMods(server).catch(() => []);
  if (mods.some((m) => /luckperms/i.test(m.filename))) {
    return { installed: false, message: "LuckPerms ist bereits installiert." };
  }
  await installMod(server, "luckperms", undefined);
  suppressDownAlert(server.id);
  await createDockerAdapter(server).restart();
  reattachServerStreams(server.id);
  void broadcastServerStatus(server.id);
  return {
    installed: true,
    message:
      "LuckPerms wurde installiert — der Server startet neu. In ~1 Minute erneut öffnen.",
  };
}

// ── Gruppen ──────────────────────────────────────────────────────────────────

export async function listGroups(server: Server): Promise<LpGroupSummaryDto[]> {
  const data = await readExport(server);
  return Object.entries(data.groups)
    .map(([name, entity]) => ({ name, weight: weightValue(entity) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createGroup(server: Server, name: string): Promise<void> {
  ensureSupported(server);
  assertGroup(name);
  const data = await readExport(server);
  if (data.groups[name]) {
    throw new LuckPermsError(409, "exists", "Gruppe existiert bereits");
  }
  await lp(server, `creategroup ${name}`);
}

export async function deleteGroup(server: Server, name: string): Promise<void> {
  ensureSupported(server);
  assertGroup(name);
  if (name === "default") {
    throw new LuckPermsError(422, "protected", "Die Gruppe „default“ ist geschützt");
  }
  const data = await readExport(server);
  if (!data.groups[name]) {
    throw new LuckPermsError(404, "not_found", "Gruppe nicht gefunden");
  }
  await lp(server, `deletegroup ${name}`);
}

export async function getGroup(
  server: Server,
  name: string,
): Promise<LpGroupDetailDto> {
  ensureSupported(server);
  assertGroup(name);
  const data = await readExport(server);
  const entity = data.groups[name];
  if (!entity) {
    throw new LuckPermsError(404, "not_found", "Gruppe nicht gefunden");
  }
  return {
    name,
    weight: weightValue(entity),
    prefix: metaValue(entity, "prefix"),
    suffix: metaValue(entity, "suffix"),
    permissions: permissionNodes(entity),
  };
}

export async function setGroupPermission(
  server: Server,
  name: string,
  node: string,
  value: boolean,
): Promise<void> {
  ensureSupported(server);
  assertGroup(name);
  assertNode(node);
  await lp(server, `group ${name} permission set ${node} ${value}`);
}

export async function unsetGroupPermission(
  server: Server,
  name: string,
  node: string,
): Promise<void> {
  ensureSupported(server);
  assertGroup(name);
  assertNode(node);
  await lp(server, `group ${name} permission unset ${node}`);
}

export async function setGroupMeta(
  server: Server,
  name: string,
  meta: { prefix?: string; suffix?: string; weight?: number },
): Promise<void> {
  ensureSupported(server);
  assertGroup(name);
  if (meta.weight !== undefined) {
    if (!Number.isInteger(meta.weight) || meta.weight < 0 || meta.weight > 10000) {
      throw new LuckPermsError(400, "bad_weight", "Weight 0–10000");
    }
    await lp(server, `group ${name} setweight ${meta.weight}`);
  }
  if (meta.prefix !== undefined) {
    assertMetaValue(meta.prefix);
    await lp(
      server,
      meta.prefix === ""
        ? `group ${name} meta removeprefix ${META_PRIORITY}`
        : `group ${name} meta setprefix ${META_PRIORITY} "${meta.prefix}"`,
    );
  }
  if (meta.suffix !== undefined) {
    assertMetaValue(meta.suffix);
    await lp(
      server,
      meta.suffix === ""
        ? `group ${name} meta removesuffix ${META_PRIORITY}`
        : `group ${name} meta setsuffix ${META_PRIORITY} "${meta.suffix}"`,
    );
  }
}

// ── Spieler ──────────────────────────────────────────────────────────────────

export async function getUser(server: Server, name: string): Promise<LpUserDto> {
  ensureSupported(server);
  assertUser(name);
  const data = await readExport(server);

  const lower = name.toLowerCase();
  let uuid: string | undefined;
  let entity: LpRawEntity | undefined;
  for (const [key, ent] of Object.entries(data.users)) {
    if (ent.username?.toLowerCase() === lower || key.toLowerCase() === lower) {
      uuid = key;
      entity = ent;
      break;
    }
  }
  if (!entity) {
    throw new LuckPermsError(
      404,
      "not_found",
      "Spieler in LuckPerms unbekannt (muss dem Server bereits bekannt sein)",
    );
  }

  return {
    name: entity.username ?? name,
    uuid,
    primaryGroup: entity.primaryGroup,
    groups: parentGroups(entity),
    permissions: permissionNodes(entity),
  };
}

export async function addUserGroup(
  server: Server,
  name: string,
  group: string,
): Promise<void> {
  ensureSupported(server);
  assertUser(name);
  assertGroup(group);
  await lp(server, `user ${name} parent add ${group}`);
}

export async function removeUserGroup(
  server: Server,
  name: string,
  group: string,
): Promise<void> {
  ensureSupported(server);
  assertUser(name);
  assertGroup(group);
  await lp(server, `user ${name} parent remove ${group}`);
}

export async function setUserPermission(
  server: Server,
  name: string,
  node: string,
  value: boolean,
): Promise<void> {
  ensureSupported(server);
  assertUser(name);
  assertNode(node);
  await lp(server, `user ${name} permission set ${node} ${value}`);
}

export async function unsetUserPermission(
  server: Server,
  name: string,
  node: string,
): Promise<void> {
  ensureSupported(server);
  assertUser(name);
  assertNode(node);
  await lp(server, `user ${name} permission unset ${node}`);
}
