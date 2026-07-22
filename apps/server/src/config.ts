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

const encryptionKeyHex = required("ENCRYPTION_KEY");
if (!/^[0-9a-fA-F]{64}$/.test(encryptionKeyHex)) {
  throw new Error(
    "ENCRYPTION_KEY muss 64 Hex-Zeichen (32 Byte) sein — erzeugen mit: openssl rand -hex 32",
  );
}

const sessionSecret = required("SESSION_SECRET");
if (sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET muss mindestens 32 Zeichen lang sein");
}

export const config = {
  port: Number(optional("PORT", "3000")),
  host: optional("HOST", "0.0.0.0"),
  webOrigin: optional("WEB_ORIGIN", "http://localhost:5173"),
  /** Verzeichnis für Server-Backups (tar.gz je Server). */
  backupDir: optional("BACKUP_DIR", "./backups"),
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
  importMaxBytes: Number(optional("IMPORT_MAX_MB", "10240")) * 1024 * 1024,
  /** Obergrenze (Bytes) für eigene Plugin-/Mod-Jars (Upload + URL-Download). Default 200 MB. */
  modsMaxBytes: Number(optional("MODS_MAX_MB", "200")) * 1024 * 1024,
  sessionSecret,
  encryptionKey: Buffer.from(encryptionKeyHex, "hex"),
  /**
   * Optionaler CurseForge-API-Key für Modpack-Downloads (TYPE=AUTO_CURSEFORGE).
   * Leer = das itzg-Image nutzt seinen eingebauten Key. Eigenen Key von
   * console.curseforge.com hier hinterlegen, falls gewünscht.
   */
  curseforgeApiKey: process.env.CF_API_KEY ?? "",
  isProduction: process.env.NODE_ENV === "production",
  seedAdmin: {
    username: optional("SEED_ADMIN_USER", "admin"),
    password: process.env.SEED_ADMIN_PASSWORD ?? "",
  },
} as const;

/** Name des Session-Cookies. */
export const SESSION_COOKIE = "mc_session";
