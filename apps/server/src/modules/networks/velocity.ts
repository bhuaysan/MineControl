import { CONTAINER_MC_PORT } from "../../adapters/dockerClient.js";

/** Ein Backend-Eintrag im Velocity-`[servers]`-Block. */
export interface VelocityBackend {
  /**
   * Velocity-Alias (Schlüssel und zugleich DNS-Name des Subservers im Docker-
   * Netzwerk). Muss ein gültiger Hostname sein — Velocity lehnt Unterstriche ab,
   * daher wird der Alias als Netzwerk-Alias auf den Container gesetzt.
   */
  alias: string;
}

/** TOML-String maskieren (nur `"` und `\` sind hier relevant). */
function tomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Rendert eine vollständige velocity.toml. Der Proxy bindet auf den container-
 * internen MC-Port (25565), Backends werden per Container-DNS-Namen adressiert.
 * `try` verweist auf den ersten Backend als Standardserver.
 */
export function renderVelocityToml(opts: {
  motd: string;
  backends: VelocityBackend[];
}): string {
  const serverLines = opts.backends
    .map((b) => `${b.alias} = "${b.alias}:${CONTAINER_MC_PORT}"`)
    .join("\n");
  const tryList = opts.backends.map((b) => `"${b.alias}"`).join(", ");
  return `# Von MineControl verwaltet — Änderungen werden bei Netzwerk-Updates überschrieben.
config-version = "2.7"
bind = "0.0.0.0:${CONTAINER_MC_PORT}"
motd = "${tomlString(opts.motd)}"
show-max-players = 100
online-mode = true
force-key-authentication = true
prevent-client-proxy-connections = false
player-info-forwarding-mode = "modern"
forwarding-secret-file = "forwarding.secret"
announce-forge = false
kick-existing-players = false
ping-passthrough = "DISABLED"
enable-player-address-logging = true

[servers]
${serverLines}
try = [${tryList}]

[forced-hosts]

[advanced]
compression-threshold = 256
compression-level = -1
login-ratelimit = 3000
connection-timeout = 5000
read-timeout = 30000
proxy-protocol = false
tcp-fast-open = false
bungee-plugin-message-channel = true
show-ping-requests = false
failover-on-unexpected-server-disconnect = true
announce-proxy-commands = true
log-command-executions = false
log-player-connections = true

[query]
enabled = false
port = ${CONTAINER_MC_PORT}
map = "Velocity"
show-plugins = false
`;
}

/**
 * Patcht den `proxies.velocity`-Block in Paper's config/paper-global.yml:
 * setzt `enabled`, `online-mode: true` und das Modern-Forwarding-`secret`.
 * Erhält alle übrigen Zeilen unverändert. Gibt zusätzlich zurück, ob der Block
 * gefunden wurde (zur Fehlerdiagnose beim Aufrufer).
 */
export function patchPaperVelocity(
  raw: string,
  secret: string,
  enabled: boolean,
): { content: string; patched: boolean } {
  const lines = raw.split("\n");
  let inProxies = false;
  let inVelocity = false;
  let touched = false;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    if (indent === 0 && trimmed.endsWith(":")) {
      inProxies = trimmed === "proxies:";
      inVelocity = false;
    } else if (inProxies && indent === 2 && trimmed.endsWith(":")) {
      inVelocity = trimmed === "velocity:";
    }
    if (inVelocity && indent === 4) {
      if (trimmed.startsWith("enabled:")) {
        touched = true;
        return `    enabled: ${enabled}`;
      }
      if (trimmed.startsWith("online-mode:")) {
        return "    online-mode: true";
      }
      if (trimmed.startsWith("secret:")) {
        return `    secret: '${secret.replace(/'/g, "''")}'`;
      }
    }
    return line;
  });
  return { content: out.join("\n"), patched: touched };
}
