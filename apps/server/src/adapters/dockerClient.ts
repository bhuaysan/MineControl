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

/** Das Docker-Image, aus dem alle Server erzeugt werden. */
export const MC_IMAGE = "itzg/minecraft-server:latest";

/** Container-interne Ports (itzg-Image: MC 25565, RCON 25575). */
export const CONTAINER_MC_PORT = 25565;
export const CONTAINER_RCON_PORT = 25575;
