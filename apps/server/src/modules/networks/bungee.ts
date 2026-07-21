import { randomUUID } from "node:crypto";
import { CONTAINER_MC_PORT } from "../../adapters/dockerClient.js";

/** Ein Backend-Eintrag im BungeeCord-`servers`-Block. */
export interface BungeeBackend {
  /** Alias (Schlüssel und zugleich DNS-Name des Subservers im Docker-Netzwerk). */
  alias: string;
}

/** YAML-String maskieren (nur `'` ist hier relevant — Werte sind einfach gequotet). */
function yamlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Rendert eine vollständige BungeeCord `config.yml`. Der Proxy bindet auf den
 * container-internen MC-Port (25565, statt BungeeCords Default 25577, damit er
 * zum bestehenden Host-Port-Mapping passt). `ip_forward: true` aktiviert das
 * einfache IP-Forwarding — BungeeCord kennt kein Secret-basiertes Modern
 * Forwarding wie Velocity; die Gegenseite ist `settings.bungeecord: true` in
 * spigot.yml auf jedem Paper/Spigot-Subserver (siehe patchSpigotBungee).
 */
export function renderBungeeConfig(opts: {
  motd: string;
  backends: BungeeBackend[];
}): string {
  // BungeeCord bricht beim Boot mit "No servers defined" ab, wenn `servers`
  // leer ist (anders als Velocity) — daher ein harmloser Platzhalter, solange
  // kein echter Subserver angehängt ist (empirisch gegen echtes BungeeCord
  // verifiziert; verweist ins Leere, wird nie von einem Spieler erreicht).
  const backends: BungeeBackend[] =
    opts.backends.length > 0 ? opts.backends : [{ alias: "mc-placeholder" }];
  const placeholderAddress = "127.0.0.1:1";

  // Leere Flow-Collections müssen inline mit dem Schlüssel stehen
  // (`key: []`/`key: {}`) — auf einer eigenen eingerückten Zeile scheitert
  // SnakeYAMLs Scanner daran mit „while scanning a simple key" (empirisch
  // gegen echtes BungeeCord verifiziert).
  const serverEntries = `servers:\n${backends
    .map(
      (b) =>
        `  ${b.alias}:\n` +
        `    motd: '${yamlString(opts.motd)}'\n` +
        `    address: ${
          opts.backends.length > 0 ? `${b.alias}:${CONTAINER_MC_PORT}` : placeholderAddress
        }\n` +
        `    restricted: false`,
    )
    .join("\n")}`;
  // BungeeCord behandelt eine leere `priorities`-Liste offenbar als „nicht
  // gesetzt" und ersetzt sie beim Laden intern durch seinen Default
  // (`[lobby]`) — der dann auf einen nicht existierenden Server verweist und
  // beim nächsten Neustart mit „Server lobby is not defined" abstürzt
  // (empirisch verifiziert). Deshalb IMMER denselben Platzhalter wie in
  // `servers` referenzieren, nie eine leere Liste.
  const priorities = `  priorities:\n${backends.map((b) => `  - ${b.alias}`).join("\n")}`;

  return `# Von MineControl verwaltet — Änderungen werden bei Netzwerk-Updates überschrieben.
network_compression_threshold: 256
remote_ping_timeout: 5000
online_mode: true
remote_ping_cache: -1
forge_support: false
max_packets_per_second: 4096
max_packets_data_per_second: 33554432
disabled_commands:
- disabledcommandhere
log_pings: true
reject_transfers: false
player_limit: -1
connection_throttle_limit: 3
connection_throttle: 4000
prevent_proxy_connections: false
log_commands: false
stats: ${randomUUID()}
groups:
  md_5:
  - admin
ip_forward: true
${serverEntries}
permissions:
  default:
  - bungeecord.command.server
  - bungeecord.command.list
  admin:
  - bungeecord.command.alert
  - bungeecord.command.end
  - bungeecord.command.ip
  - bungeecord.command.reload
  - bungeecord.command.kick
  - bungeecord.command.send
  - bungeecord.command.find
listeners:
- query_port: ${CONTAINER_MC_PORT}
  motd: '${yamlString(opts.motd)}'
  tab_list: GLOBAL_PING
  query_enabled: false
  proxy_protocol: false
  forced_hosts: {}
  ping_passthrough: false
${priorities}
  bind_local_address: true
  host: 0.0.0.0:${CONTAINER_MC_PORT}
  max_players: 100
  tab_size: 60
  force_default_server: false
enforce_secure_profile: false
server_connect_timeout: 5000
timeout: 30000
`;
}

/**
 * Patcht `settings.bungeecord` in Spigot's `spigot.yml` (top-level `settings:`-
 * Block, Einrückung 2). Erhält alle übrigen Zeilen unverändert.
 */
export function patchSpigotBungee(
  raw: string,
  enabled: boolean,
): { content: string; patched: boolean } {
  const lines = raw.split("\n");
  let inSettings = false;
  let touched = false;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    if (indent === 0 && trimmed.endsWith(":")) {
      inSettings = trimmed === "settings:";
    }
    if (inSettings && indent === 2 && trimmed.startsWith("bungeecord:")) {
      touched = true;
      return `  bungeecord: ${enabled}`;
    }
    return line;
  });
  return { content: out.join("\n"), patched: touched };
}
