import type { Server } from "@prisma/client";
import { deleteMod, installMod, listInstalledMods } from "../mods/service.js";
import { readDataTextFile, putDataFiles } from "../servers/docker.js";
import { createDockerAdapter } from "../../adapters/registry.js";
import { suppressDownAlert } from "../metrics/service.js";
import { broadcastServerStatus, pushConsoleLine, reattachServerStreams } from "../../ws/index.js";

/**
 * Kompatibilitäts-Mods für Velocity-Modern-Forwarding auf modded Subservern
 * (Paper/Spigot unterstützen es nativ; Vanilla-Fabric/Forge nicht). Empirisch
 * gegen echtes Docker verifiziert (2026-07-21):
 *  - FabricProxy-Lite braucht zwingend `fabric-api` als Abhängigkeit, sonst
 *    Crashloop „HARD_DEP fabric-networking-api-v1/fabric-api fehlt".
 *  - Proxy Compatible Forge (Forge + NeoForge) braucht keine Extra-Mods.
 * Konfigurationsdateien werden erst NACH dem ersten Boot mit dem Mod erzeugt.
 */
interface ForwardingModInfo {
  modId: string;
  /** Zusätzlich zu installierende Abhängigkeit (Modrinth-Slug), falls nötig. */
  dependencyModId?: string;
  configPath: string;
}

function forwardingModInfo(edition: string): ForwardingModInfo | null {
  switch (edition) {
    case "FABRIC":
      return {
        modId: "fabricproxy-lite",
        dependencyModId: "fabric-api",
        configPath: "/data/config/FabricProxy-Lite.toml",
      };
    case "FORGE":
    case "NEOFORGE":
      return {
        modId: "proxy-compatible-forge",
        configPath: "/data/config/proxy-compatible-forge.toml",
      };
    default:
      return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Startet den Server neu, ohne einen Down-Alarm auszulösen; wartet, bis er wieder online ist. */
async function restartAndWait(server: Server, label: string): Promise<void> {
  suppressDownAlert(server.id);
  await createDockerAdapter(server).restart();
  reattachServerStreams(server.id);
  void broadcastServerStatus(server.id);
  pushConsoleLine(server.id, `» ${label} — Server startet neu …`);
}

/** Findet die installierte Datei eines Mods anhand des Modrinth-Slugs (Namens-Heuristik). */
async function findInstalledFile(server: Server, modId: string): Promise<string | null> {
  const installed = await listInstalledMods(server);
  const normalized = modId.replace(/-/g, "").toLowerCase();
  const match = installed.find((m) =>
    m.filename.replace(/[-_.]/g, "").toLowerCase().includes(normalized),
  );
  return match?.filename ?? null;
}

/**
 * Aktiviert/deaktiviert Velocity-Modern-Forwarding auf einem modded Subserver
 * (Fabric/Forge/NeoForge). Aktivieren: Kompatibilitäts-Mod (+ Abhängigkeit)
 * installieren, neu starten, auf die vom Mod erzeugte Config warten, das
 * Forwarding-Secret hineinpatchen, erneut neu starten. Deaktivieren: den
 * Kompatibilitäts-Mod wieder entfernen (kein „enabled"-Schalter in jedem
 * Format vorhanden — Entfernen ist der zuverlässigste gemeinsame Weg zurück
 * zum normalen Vanilla-Login) + neu starten.
 */
export async function configureModdedForwarding(
  server: Server,
  secret: string,
  enabled: boolean,
): Promise<void> {
  const info = forwardingModInfo(server.edition);
  if (!info) {
    pushConsoleLine(server.id, "! Edition unterstützt kein Velocity-Forwarding.");
    return;
  }

  if (!enabled) {
    const filename = await findInstalledFile(server, info.modId);
    if (filename) await deleteMod(server, filename);
    await restartAndWait(server, "Forwarding-Mod entfernt");
    return;
  }

  // Aktivieren: Mod (+ Abhängigkeit) installieren, falls nicht vorhanden.
  const hasMod = (await findInstalledFile(server, info.modId)) !== null;
  const hasDependency =
    !info.dependencyModId || (await findInstalledFile(server, info.dependencyModId)) !== null;

  if (!hasDependency || !hasMod) {
    if (!hasDependency) await installMod(server, info.dependencyModId!, undefined);
    if (!hasMod) await installMod(server, info.modId, undefined);
    await restartAndWait(server, "Forwarding-Mod installiert");
  }

  // Auf die (erst nach dem Boot mit dem Mod erzeugte) Config-Datei warten.
  let raw = await readDataTextFile(server.id, info.configPath);
  for (let i = 0; i < 20 && !raw; i++) {
    await sleep(3000);
    raw = await readDataTextFile(server.id, info.configPath);
  }
  if (!raw) {
    pushConsoleLine(
      server.id,
      `! ${info.configPath} nicht gefunden — Forwarding-Secret nicht gesetzt.`,
    );
    return;
  }

  // Beide unterstützten Formate (FabricProxy-Lite flach, Proxy Compatible Forge
  // unter [forwarding]) haben genau eine `secret = "..."`-Zeile.
  const patched = raw.replace(
    /^(\s*secret\s*=\s*)"[^"]*"/m,
    `$1"${secret.replace(/"/g, '\\"')}"`,
  );
  if (patched === raw && !/secret\s*=/.test(raw)) {
    pushConsoleLine(server.id, `! Kein „secret"-Feld in ${info.configPath} gefunden.`);
    return;
  }

  const slash = info.configPath.lastIndexOf("/");
  await putDataFiles(server.id, info.configPath.slice(0, slash), [
    { name: info.configPath.slice(slash + 1), content: patched },
  ]);
  await restartAndWait(server, "Forwarding-Secret gesetzt");
}
