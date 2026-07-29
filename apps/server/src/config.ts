/** Zentrale, validierte Laufzeit-Konfiguration aus Umgebungsvariablen. */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Umgebungsvariable ${name} fehlt (siehe .env.example)`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/** Wie `optional`, aber als validierte Ganzzahl — NaN/Nicht-Ganzzahlen und
 * Werte außerhalb von `[min, max]` brechen den Start ab, statt erst tief im
 * Betrieb (z. B. als negatives Timeout oder absurdes Upload-Limit) aufzufallen. */
function optionalInt(
  name: string,
  fallback: number,
  { min, max }: { min?: number; max?: number } = {},
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`Umgebungsvariable ${name}="${raw}" ist keine gültige Ganzzahl`);
  }
  if (min !== undefined && value < min) {
    throw new Error(`Umgebungsvariable ${name}=${value} muss mindestens ${min} sein`);
  }
  if (max !== undefined && value > max) {
    throw new Error(`Umgebungsvariable ${name}=${value} darf höchstens ${max} sein`);
  }
  return value;
}

const isProduction = process.env.NODE_ENV === "production";

// Platzhalterwerte aus .env.example — nur zum lokalen Ausprobieren gedacht.
// Wer `.env.example` nur kopiert, ohne die dokumentierten `sed`/`openssl`-
// Befehle auszuführen, würde sonst produktiv mit einem öffentlich bekannten
// Encryption-Key/Session-Secret laufen (README §Deployment beschreibt zwar
// das Setzen, erzwingt es aber nur gegen "leer", nicht gegen "Platzhalter").
const EXAMPLE_ENCRYPTION_KEY = "0".repeat(64);
const EXAMPLE_SESSION_SECRET = "bitte-aendern-min-32-zeichen-langer-zufallswert";

const encryptionKeyHex = required("ENCRYPTION_KEY");
if (!/^[0-9a-fA-F]{64}$/.test(encryptionKeyHex)) {
  throw new Error(
    "ENCRYPTION_KEY muss 64 Hex-Zeichen (32 Byte) sein — erzeugen mit: openssl rand -hex 32",
  );
}
if (isProduction && encryptionKeyHex === EXAMPLE_ENCRYPTION_KEY) {
  throw new Error(
    "ENCRYPTION_KEY ist noch der Platzhalter aus .env.example — erzeugen mit: openssl rand -hex 32",
  );
}

const sessionSecret = required("SESSION_SECRET");
if (sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET muss mindestens 32 Zeichen lang sein");
}
if (isProduction && sessionSecret === EXAMPLE_SESSION_SECRET) {
  throw new Error(
    "SESSION_SECRET ist noch der Platzhalter aus .env.example — echten Zufallswert setzen",
  );
}
if (isProduction && process.env.SEED_ADMIN_PASSWORD === "changeme") {
  throw new Error(
    "SEED_ADMIN_PASSWORD ist noch der Beispielwert 'changeme' — vor dem Produktivstart ändern",
  );
}

export const config = {
  port: optionalInt("PORT", 3000, { min: 1, max: 65535 }),
  // Sicherer Default, falls HOST gar nicht gesetzt ist: nur Loopback statt
  // aller Interfaces (siehe .env.example).
  host: optional("HOST", "127.0.0.1"),
  webOrigin: optional("WEB_ORIGIN", "http://localhost:5173"),
  /** Verzeichnis für Server-Backups (tar.gz je Server). */
  backupDir: optional("BACKUP_DIR", "./backups"),
  /**
   * Verzeichnis für die automatischen Snapshots der Control-Plane-DB
   * (Benutzer, Secrets, Servertopologie). Bewusst NICHT unter `backupDir` —
   * ein Verlust des einen Volumes darf nicht DB und Welt-Backups gleichzeitig
   * mitreißen (siehe docker-compose.yml: eigenes Volume `mc-db-backups`).
   */
  dbBackupDir: optional("DB_BACKUP_DIR", "./backups-db"),
  /** Cron-Ausdruck für den automatischen DB-Snapshot. Default: täglich 03:00. */
  dbBackupCron: optional("DB_BACKUP_CRON", "0 3 * * *"),
  /** Wie viele DB-Snapshots aufgehoben werden, bevor die ältesten gelöscht werden. */
  dbBackupRetention: optionalInt("DB_BACKUP_RETENTION", 14, { min: 1, max: 3650 }),
  /**
   * Verzeichnis mit server-seitig bereitgestellten Import-Archiven (.tar.gz).
   * Admins legen hier Fremd-Server-Verzeichnisse ab, um sie beim Erstellen zu
   * importieren (Migration großer Welten ohne Browser-Upload).
   */
  importDir: optional("IMPORT_DIR", "./imports"),
  /** Ablage für per Browser hochgeladene Import-Archive (Staging). */
  importStagingDir: optional("IMPORT_STAGING_DIR", "./imports/.staging"),
  /**
   * Obergrenze (Bytes) für Import-Uploads und entpackte Archivgröße
   * (Schutz vor Gzip-/Tar-Bomben). Default 10 GiB.
   */
  importMaxBytes: optionalInt("IMPORT_MAX_MB", 10240, { min: 1, max: 1_048_576 }) * 1024 * 1024,
  /** Obergrenze (Bytes) für eigene Plugin-/Mod-Jars (Upload + URL-Download). Default 200 MB. */
  modsMaxBytes: optionalInt("MODS_MAX_MB", 200, { min: 1, max: 10_240 }) * 1024 * 1024,
  /**
   * Auto-Restart/Crash-Recovery: Wie lange ein Docker-Server ununterbrochen
   * „läuft, aber nicht erreichbar" (Status STARTING) sein darf, bevor der
   * Sampler ihn neu startet. Bewusst großzügig (Default 5 min), damit ein
   * normaler Boot nicht fälschlich unterbrochen wird.
   */
  autoRestartGraceMs: optionalInt("AUTO_RESTART_GRACE_MIN", 5, { min: 1, max: 1440 }) * 60_000,
  /** Max. aufeinanderfolgende Auto-Restart-Versuche, bevor aufgegeben wird (bis wieder ONLINE). */
  autoRestartMaxAttempts: optionalInt("AUTO_RESTART_MAX_ATTEMPTS", 3, { min: 1, max: 100 }),
  sessionSecret,
  encryptionKey: Buffer.from(encryptionKeyHex, "hex"),
  /**
   * Optionaler CurseForge-API-Key für Modpack-Downloads (TYPE=AUTO_CURSEFORGE).
   * Leer = das itzg-Image nutzt seinen eingebauten Key. Eigenen Key von
   * console.curseforge.com hier hinterlegen, falls gewünscht.
   */
  curseforgeApiKey: process.env.CF_API_KEY ?? "",
  isProduction,
  seedAdmin: {
    username: optional("SEED_ADMIN_USER", "admin"),
    password: process.env.SEED_ADMIN_PASSWORD ?? "",
  },
} as const;

/** Name des Session-Cookies. */
export const SESSION_COOKIE = "mc_session";
