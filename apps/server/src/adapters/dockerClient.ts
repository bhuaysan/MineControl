import Docker from "dockerode";

/**
 * Gemeinsame Dockerode-Instanz. Spricht standardmäßig den lokalen Socket
 * `/var/run/docker.sock` an (Root-Äquivalent — siehe PLANNING.md §7).
 */
export const docker = new Docker();

/** Deterministischer Container-Name für einen verwalteten Server. */
export function containerName(serverId: string): string {
  return `minecontrol_${serverId}`;
}

/** Named Volume für die Weltdaten (`/data`) eines Servers. */
export function dataVolumeName(serverId: string): string {
  return `minecontrol_${serverId}_data`;
}

/** Das Docker-Image, aus dem alle (Spiel-)Server erzeugt werden. */
export const MC_IMAGE = "itzg/minecraft-server:latest";

/**
 * Image für Proxy-Server (Velocity/BungeeCord). Eigenes Image mit `/server` als
 * Datenverzeichnis; das minecraft-server-Image kennt TYPE=VELOCITY nicht.
 */
export const PROXY_IMAGE = "itzg/mc-proxy:latest";

/** Datenverzeichnis im Proxy-Container (mc-proxy nutzt /server statt /data). */
export const PROXY_DATA_DIR = "/server";

/** Container-interne Ports (itzg-Image: MC 25565, RCON 25575). */
export const CONTAINER_MC_PORT = 25565;
export const CONTAINER_RCON_PORT = 25575;

/**
 * Standard-UID/GID der itzg-Images (minecraft-server & mc-proxy laufen als 1000).
 * Per putArchive geschriebene Dateien müssen diesem User gehören — sonst kann der
 * Container sie beim (Neu-)Start nicht überschreiben (AccessDenied-Crashloop).
 */
export const CONTAINER_UID = 1000;

/** Name des user-defined Bridge-Netzwerks einer Velocity-Netzwerk-Gruppe. */
export function networkName(networkId: string): string {
  return `minecontrol_net_${networkId}`;
}

/** Legt das Docker-Bridge-Netzwerk an, falls es noch nicht existiert. */
export async function ensureDockerNetwork(name: string): Promise<void> {
  const existing = await docker.listNetworks({ filters: { name: [name] } });
  // listNetworks filtert per Teilstring → auf exakten Namen prüfen.
  if (existing.some((n) => n.Name === name)) return;
  await docker.createNetwork({
    Name: name,
    Driver: "bridge",
    Labels: { "com.minecontrol.managed": "true" },
  });
}

/** Verbindet einen Container (per Name) mit dem Netzwerk; optional mit Alias. */
export async function connectToNetwork(
  name: string,
  container: string,
  alias?: string,
): Promise<void> {
  try {
    await docker.getNetwork(name).connect({
      Container: container,
      EndpointConfig: alias ? { Aliases: [alias] } : {},
    });
  } catch (err) {
    // Bereits verbunden → ok.
    if (!/already |endpoint with name/i.test((err as Error).message)) throw err;
  }
}

/** Trennt einen Container vom Netzwerk (Force, falls verbunden). */
export async function disconnectFromNetwork(
  name: string,
  container: string,
): Promise<void> {
  try {
    await docker.getNetwork(name).disconnect({ Container: container, Force: true });
  } catch {
    /* Nicht verbunden / Netzwerk weg — ok. */
  }
}

/** Entfernt das Docker-Netzwerk (ignoriert „existiert nicht"). */
export async function removeDockerNetwork(name: string): Promise<void> {
  try {
    await docker.getNetwork(name).remove();
  } catch {
    /* Existiert nicht mehr — ok. */
  }
}
