import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import type { Server } from "@prisma/client";
import type { Backup } from "@prisma/client";
import type { BackupDto, BackupTrigger } from "@minecontrol/shared";
import { containerName, docker } from "../../adapters/dockerClient.js";
import { createDockerAdapter } from "../../adapters/registry.js";
import { config } from "../../config.js";
import { prisma } from "../../db.js";

export function toBackupDto(backup: Backup): BackupDto {
  return {
    id: backup.id,
    serverId: backup.serverId,
    sizeBytes: backup.sizeBytes,
    trigger: backup.trigger as BackupTrigger,
    createdAt: backup.createdAt.toISOString(),
  };
}

function backupPath(serverId: string, createdAt: Date): string {
  const stamp = createdAt.toISOString().replace(/[:.]/g, "-");
  // Zufalls-Suffix statt reinem Zeitstempel — zwei parallele (manuelle +
  // geplante) Backups desselben Servers dürfen niemals dieselbe Datei treffen.
  const suffix = randomBytes(3).toString("hex");
  return join(config.backupDir, serverId, `${stamp}-${suffix}.tar.gz`);
}

function ensureDocker(server: Server): void {
  if (server.type !== "DOCKER") {
    throw new Error("Backups sind nur für Docker-Server verfügbar");
  }
}

/**
 * Erstellt ein Backup des Weltdaten-Volumes (`/data`) als tar.gz auf dem Host.
 * Bei laufendem Server wird die Welt vorher per RCON auf die Platte geschrieben.
 */
export async function createBackup(
  server: Server,
  trigger: BackupTrigger,
  retention?: number,
): Promise<BackupDto> {
  ensureDocker(server);
  const container = docker.getContainer(containerName(server.id));

  // Welt vor dem Archivieren flushen (nur wenn der Server läuft).
  try {
    const info = await container.inspect();
    if (info.State.Running) {
      await createDockerAdapter(server).sendCommand("save-all flush");
    }
  } catch {
    /* Container fehlt/stopped oder RCON nicht bereit — trotzdem sichern. */
  }

  const createdAt = new Date();
  const target = backupPath(server.id, createdAt);
  await mkdir(dirname(target), { recursive: true });

  // getArchive(/data) liefert einen Tar-Stream → gzip → Datei.
  const archive = (await container.getArchive({
    path: "/data",
  })) as unknown as NodeJS.ReadableStream;
  try {
    await pipeline(archive, createGzip(), createWriteStream(target));
  } catch (err) {
    // Teilarchiv nicht liegen lassen — es gibt sowieso keinen DB-Eintrag dafür.
    await rm(target, { force: true }).catch(() => {});
    throw err;
  }

  const { size } = await stat(target);
  const backup = await prisma.backup.create({
    data: { serverId: server.id, path: target, sizeBytes: size, trigger },
  });

  if (retention && retention > 0) await applyRetention(server.id, retention);
  return toBackupDto(backup);
}

/** Löscht die ältesten Backups, sodass nur `keep` neueste übrig bleiben. */
export async function applyRetention(serverId: string, keep: number): Promise<void> {
  const stale = await prisma.backup.findMany({
    where: { serverId },
    orderBy: { createdAt: "desc" },
    skip: keep,
  });
  for (const backup of stale) {
    await rm(backup.path, { force: true }).catch(() => {});
    await prisma.backup.delete({ where: { id: backup.id } });
  }
}

export async function listBackups(serverId: string): Promise<BackupDto[]> {
  const backups = await prisma.backup.findMany({
    where: { serverId },
    orderBy: { createdAt: "desc" },
  });
  return backups.map(toBackupDto);
}

/**
 * Spielt ein Backup zurück: Server stoppen (falls läuft) → Archiv ins Volume
 * entpacken → Server wieder starten, falls er vorher lief. Vorhandene Dateien
 * werden überschrieben (seither hinzugekommene Dateien bleiben bestehen).
 */
export async function restoreBackup(server: Server, backupId: string): Promise<void> {
  ensureDocker(server);
  const backup = await prisma.backup.findFirst({
    where: { id: backupId, serverId: server.id },
  });
  if (!backup) throw new Error("Backup nicht gefunden");

  const container = docker.getContainer(containerName(server.id));
  let wasRunning: boolean;
  try {
    const info = await container.inspect();
    wasRunning = info.State.Running === true;
  } catch {
    throw new Error("Container existiert nicht mehr");
  }

  if (wasRunning) await container.stop({ t: 60 });

  // Der Neustart muss in jedem Fall versucht werden — sonst bleibt ein vorher
  // laufender Server offline, wenn Dekompression/putArchive fehlschlägt.
  //
  // pipeline() statt createReadStream(…).pipe(gunzip): `.pipe()` leitet einen
  // Lesefehler (Backup-Datei gelöscht, Mount weg) NICHT an gunzip weiter — er
  // wäre ein unbehandeltes 'error'-Event und hätte den ganzen Prozess beendet
  // (index.ts → uncaughtException → Shutdown). Über pipeline() bekommt gunzip
  // den Fehler, und docker-modem bricht den putArchive-Request daraufhin ab
  // (es hängt an den Body-Stream einen eigenen error-Handler) → putArchive
  // lehnt ab und der Aufrufer sieht einen normalen 500er.
  const gunzip = createGunzip();
  const decompress = pipeline(createReadStream(backup.path), gunzip).catch(() => {
    /* Wird über die Ablehnung von putArchive gemeldet (s. o.) — hier nur
       abgefangen, damit es keine unhandled Rejection ist. */
  });
  try {
    // gunzip → putArchive nach „/" (Tar-Einträge sind mit `data/` präfixiert).
    await container.putArchive(gunzip, { path: "/" });
    await decompress;
  } finally {
    if (wasRunning) await container.start();
  }
}

export async function deleteBackup(server: Server, backupId: string): Promise<void> {
  const backup = await prisma.backup.findFirst({
    where: { id: backupId, serverId: server.id },
  });
  if (!backup) throw new Error("Backup nicht gefunden");
  await rm(backup.path, { force: true }).catch(() => {});
  await prisma.backup.delete({ where: { id: backup.id } });
}

/** Entfernt alle Backup-Dateien eines Servers (beim Server-Löschen). */
export async function deleteAllBackups(serverId: string): Promise<void> {
  await rm(join(config.backupDir, serverId), { recursive: true, force: true }).catch(
    () => {},
  );
  await prisma.backup.deleteMany({ where: { serverId } });
}
