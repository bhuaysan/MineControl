import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import cron from "node-cron";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { logger } from "../../logger.js";
import { notifyBackupFailed } from "../notifications/service.js";

/** Label, unter dem Fehler dieses System-Backups in Benachrichtigungen erscheinen. */
const SYSTEM_LABEL = "MineControl (Datenbank)";

function dbBackupPath(createdAt: Date): string {
  const stamp = createdAt.toISOString().replace(/[:.]/g, "-");
  return join(config.dbBackupDir, `minecontrol-${stamp}.db`);
}

/**
 * Erstellt einen konsistenten Snapshot der Control-Plane-DB (Benutzer,
 * Secrets, Servertopologie — nicht die Weltdaten, die laufen über
 * `modules/backups/service.ts`). `VACUUM INTO` liefert eine transaktional
 * konsistente Kopie auch bei gleichzeitigen Schreibzugriffen — anders als
 * eine rohe Dateikopie, die mitten in einem Write ein korruptes Abbild
 * treffen könnte.
 */
export async function createDbBackup(): Promise<string> {
  await mkdir(config.dbBackupDir, { recursive: true });
  const target = dbBackupPath(new Date());
  await prisma.$executeRaw`VACUUM INTO ${target}`;
  await applyDbBackupRetention();
  return target;
}

/** Löscht die ältesten Snapshots, sodass nur `dbBackupRetention` übrig bleiben. */
async function applyDbBackupRetention(): Promise<void> {
  const entries = await readdir(config.dbBackupDir).catch(() => []);
  // ISO-Zeitstempel im Dateinamen → lexikographische Sortierung = chronologisch.
  const files = entries.filter((f) => f.endsWith(".db")).sort();
  const stale = files.slice(0, Math.max(0, files.length - config.dbBackupRetention));
  for (const file of stale) {
    await rm(join(config.dbBackupDir, file), { force: true }).catch(() => {});
  }
}

let handle: ReturnType<typeof cron.schedule> | undefined;

/** Registriert den täglichen DB-Snapshot (Default 03:00, `DB_BACKUP_CRON`). */
export function startDbBackupScheduler(): void {
  if (!cron.validate(config.dbBackupCron)) {
    logger.error(
      { cron: config.dbBackupCron },
      "DB_BACKUP_CRON ungültig — automatischer DB-Snapshot deaktiviert",
    );
    return;
  }
  handle = cron.schedule(config.dbBackupCron, () => void runScheduledDbBackup());
}

export function stopDbBackupScheduler(): void {
  handle?.stop();
  handle = undefined;
}

async function runScheduledDbBackup(): Promise<void> {
  try {
    const path = await createDbBackup();
    logger.info({ path }, "Control-Plane-DB-Snapshot erstellt");
  } catch (err) {
    const message = (err as Error).message;
    logger.error({ err }, "Control-Plane-DB-Snapshot fehlgeschlagen");
    await notifyBackupFailed(SYSTEM_LABEL, message);
  }
}
