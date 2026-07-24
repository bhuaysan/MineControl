import type { Prisma } from "@prisma/client";
import type {
  NotificationChannel,
  NotificationLocale,
  NotificationSettingsDto,
} from "@minecontrol/shared";
import nodemailer from "nodemailer";
import { decryptSecret, encryptSecret } from "../../crypto.js";
import { prisma } from "../../db.js";
import { logger } from "../../logger.js";
import { notificationMessages } from "./messages.js";

/** Client oder (innerhalb einer Transaktion) der Transaktions-Client. */
type Db = Prisma.TransactionClient;

/** Setting-Schlüssel für die Benachrichtigungs-Konfiguration. */
const KEYS = {
  webhookEnc: "discord.webhookUrlEnc",
  emailSmtpHost: "email.smtpHost",
  emailSmtpPort: "email.smtpPort",
  emailSmtpSecure: "email.smtpSecure",
  emailSmtpUser: "email.smtpUser",
  emailSmtpPassEnc: "email.smtpPassEnc",
  emailFrom: "email.from",
  emailTo: "email.to",
  serverDown: "notify.serverDown",
  backupFailed: "notify.backupFailed",
  taskFailed: "notify.taskFailed",
  locale: "notify.locale",
} as const;

/** Liest die konfigurierte Benachrichtigungssprache; Standard Deutsch. */
async function readLocale(db: Db = prisma): Promise<NotificationLocale> {
  return (await readSetting(KEYS.locale, db)) === "en" ? "en" : "de";
}

async function readSetting(key: string, db: Db = prisma): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string, db: Db = prisma): Promise<void> {
  await db.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

async function deleteSetting(key: string, db: Db = prisma): Promise<void> {
  await db.setting.deleteMany({ where: { key } });
}

async function readBool(key: string, fallback: boolean, db: Db = prisma): Promise<boolean> {
  const value = await readSetting(key, db);
  return value === null ? fallback : value === "true";
}

/** Aktuelle Benachrichtigungs-Einstellungen (ohne Webhook-URL/SMTP-Passwort selbst). */
export async function getNotificationSettings(): Promise<NotificationSettingsDto> {
  const [smtpHost, smtpPort, from, to] = await Promise.all([
    readSetting(KEYS.emailSmtpHost),
    readSetting(KEYS.emailSmtpPort),
    readSetting(KEYS.emailFrom),
    readSetting(KEYS.emailTo),
  ]);
  return {
    discordConfigured: (await readSetting(KEYS.webhookEnc)) !== null,
    emailConfigured: Boolean(smtpHost && from && to),
    emailSmtpHost: smtpHost ?? "",
    emailSmtpPort: smtpPort ? Number(smtpPort) : 587,
    emailSmtpSecure: await readBool(KEYS.emailSmtpSecure, false),
    emailSmtpUser: (await readSetting(KEYS.emailSmtpUser)) ?? "",
    emailFrom: from ?? "",
    emailTo: to ?? "",
    notifyServerDown: await readBool(KEYS.serverDown, true),
    notifyBackupFailed: await readBool(KEYS.backupFailed, true),
    notifyTaskFailed: await readBool(KEYS.taskFailed, true),
    notifyLocale: await readLocale(),
  };
}

/** Aktualisiert Einstellungen. `discordWebhookUrl===""` löscht die Webhook-URL, `emailTo===""` löscht die gesamte E-Mail-Konfiguration. */
export async function updateNotificationSettings(input: {
  discordWebhookUrl?: string;
  emailSmtpHost?: string;
  emailSmtpPort?: number;
  emailSmtpSecure?: boolean;
  emailSmtpUser?: string;
  emailSmtpPassword?: string;
  emailFrom?: string;
  emailTo?: string;
  notifyServerDown?: boolean;
  notifyBackupFailed?: boolean;
  notifyTaskFailed?: boolean;
  notifyLocale?: NotificationLocale;
}): Promise<NotificationSettingsDto> {
  // Alle Upserts/Deletes in einer Transaktion — sonst könnte ein Fehler oder
  // eine parallele Änderung mittendrin eine teilweise/widersprüchliche
  // Konfiguration hinterlassen (z. B. neuer SMTP-Host, aber altes Passwort).
  await prisma.$transaction(async (tx) => {
    if (input.discordWebhookUrl !== undefined) {
      if (input.discordWebhookUrl === "") {
        await deleteSetting(KEYS.webhookEnc, tx);
      } else {
        await writeSetting(KEYS.webhookEnc, encryptSecret(input.discordWebhookUrl), tx);
      }
    }
    if (input.emailTo === "") {
      await Promise.all([
        deleteSetting(KEYS.emailSmtpHost, tx),
        deleteSetting(KEYS.emailSmtpPort, tx),
        deleteSetting(KEYS.emailSmtpSecure, tx),
        deleteSetting(KEYS.emailSmtpUser, tx),
        deleteSetting(KEYS.emailSmtpPassEnc, tx),
        deleteSetting(KEYS.emailFrom, tx),
        deleteSetting(KEYS.emailTo, tx),
      ]);
    } else {
      if (input.emailSmtpHost !== undefined) {
        await writeSetting(KEYS.emailSmtpHost, input.emailSmtpHost, tx);
      }
      if (input.emailSmtpPort !== undefined) {
        await writeSetting(KEYS.emailSmtpPort, String(input.emailSmtpPort), tx);
      }
      if (input.emailSmtpSecure !== undefined) {
        await writeSetting(KEYS.emailSmtpSecure, String(input.emailSmtpSecure), tx);
      }
      if (input.emailSmtpUser !== undefined) {
        await writeSetting(KEYS.emailSmtpUser, input.emailSmtpUser, tx);
      }
      if (input.emailSmtpPassword !== undefined) {
        await writeSetting(KEYS.emailSmtpPassEnc, encryptSecret(input.emailSmtpPassword), tx);
      }
      if (input.emailFrom !== undefined) await writeSetting(KEYS.emailFrom, input.emailFrom, tx);
      if (input.emailTo !== undefined) await writeSetting(KEYS.emailTo, input.emailTo, tx);
    }
    if (input.notifyServerDown !== undefined) {
      await writeSetting(KEYS.serverDown, String(input.notifyServerDown), tx);
    }
    if (input.notifyBackupFailed !== undefined) {
      await writeSetting(KEYS.backupFailed, String(input.notifyBackupFailed), tx);
    }
    if (input.notifyTaskFailed !== undefined) {
      await writeSetting(KEYS.taskFailed, String(input.notifyTaskFailed), tx);
    }
    if (input.notifyLocale !== undefined) {
      await writeSetting(KEYS.locale, input.notifyLocale, tx);
    }
  });

  const emailTouched =
    input.emailTo !== undefined ||
    input.emailSmtpHost !== undefined ||
    input.emailSmtpPort !== undefined ||
    input.emailSmtpSecure !== undefined ||
    input.emailSmtpUser !== undefined ||
    input.emailSmtpPassword !== undefined ||
    input.emailFrom !== undefined;
  // Erst nach dem erfolgreichen Commit invalidieren — sonst würde eine später
  // in der Transaktion fehlschlagende Änderung den Cache trotzdem verwerfen.
  if (emailTouched) invalidateEmailTransport();

  return getNotificationSettings();
}

/** Sendet eine Nachricht an den Discord-Webhook. `true`, wenn sie ankam —
 * Aufrufer, die nur best effort benachrichtigen wollen (notify*-Funktionen
 * unten), ignorieren den Rückgabewert einfach; `sendTestNotification`
 * braucht ihn, um den Test ehrlich zu melden statt immer „ok" zu sagen. */
async function postToDiscord(content: string): Promise<boolean> {
  const enc = await readSetting(KEYS.webhookEnc);
  if (!enc) return false;
  const url = decryptSecret(enc);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 2000) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.error({ status: res.status }, "Discord-Webhook antwortete mit Fehlerstatus");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, "Discord-Benachrichtigung fehlgeschlagen");
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Zwischengespeicherter SMTP-Transport samt Konfig-Signatur. Der Transport wird
 * mit `pool: true` wiederverwendet, statt bei jeder Benachrichtigung eine neue
 * SMTP-Verbindung auf-/abzubauen. Ändern sich die Einstellungen, invalidiert
 * `invalidateEmailTransport()` den Cache; bei nächstem Bedarf wird neu gebaut.
 */
let cachedTransport: { key: string; transport: import("nodemailer").Transporter } | null = null;

/** Wirft den gecachten SMTP-Transport weg (nach Settings-Änderung aufrufen). */
function invalidateEmailTransport(): void {
  cachedTransport?.transport.close();
  cachedTransport = null;
}

/** Baut einen SMTP-Transport aus den gespeicherten Einstellungen, oder `null` wenn unvollständig konfiguriert. */
async function buildEmailTransport(): Promise<{
  transport: import("nodemailer").Transporter;
  from: string;
  to: string;
} | null> {
  const [host, port, user, passEnc, from, to, secure] = await Promise.all([
    readSetting(KEYS.emailSmtpHost),
    readSetting(KEYS.emailSmtpPort),
    readSetting(KEYS.emailSmtpUser),
    readSetting(KEYS.emailSmtpPassEnc),
    readSetting(KEYS.emailFrom),
    readSetting(KEYS.emailTo),
    readBool(KEYS.emailSmtpSecure, false),
  ]);
  if (!host || !from || !to) return null;
  // Signatur über alle verbindungsrelevanten Werte — bei Änderung neu bauen.
  const key = JSON.stringify([host, port, user, passEnc, secure]);
  if (cachedTransport?.key !== key) {
    cachedTransport?.transport.close();
    cachedTransport = {
      key,
      transport: nodemailer.createTransport({
        host,
        port: port ? Number(port) : 587,
        secure,
        auth: user && passEnc ? { user, pass: decryptSecret(passEnc) } : undefined,
        pool: true,
        // Timeouts, damit ein hängender SMTP-Server den (sequenziellen) 60s-
        // Metrik-Sampler über notifyServerDown nicht blockiert. Nodemailer-
        // Defaults (bis zu Minuten) sind dafür viel zu großzügig.
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
      }),
    };
  }
  return { transport: cachedTransport.transport, from, to };
}

/** Sendet eine E-Mail-Benachrichtigung. `true`, wenn sie angenommen wurde
 * (siehe Kommentar bei `postToDiscord`). */
async function postToEmail(subject: string, text: string): Promise<boolean> {
  const config = await buildEmailTransport();
  if (!config) return false;
  try {
    await config.transport.sendMail({
      from: config.from,
      to: config.to,
      subject,
      text,
    });
    return true;
  } catch (err) {
    logger.error({ err }, "E-Mail-Benachrichtigung fehlgeschlagen");
    return false;
  }
}

/** Sendet eine Testnachricht über den angegebenen Kanal (unabhängig von den
 * notify-Schaltern) und meldet den tatsächlichen Erfolg — nicht nur, dass ein
 * Kanal konfiguriert ist. */
export async function sendTestNotification(channel: NotificationChannel): Promise<boolean> {
  const m = notificationMessages(await readLocale());
  if (channel === "discord") {
    if ((await readSetting(KEYS.webhookEnc)) === null) return false;
    return postToDiscord(m.testDiscord);
  }
  const config = await buildEmailTransport();
  if (!config) return false;
  return postToEmail(m.testEmail.subject, m.testEmail.text);
}

export async function notifyServerDown(serverName: string): Promise<void> {
  if (!(await readBool(KEYS.serverDown, true))) return;
  const msg = notificationMessages(await readLocale()).serverDown(serverName);
  await Promise.all([postToDiscord(msg.discord), postToEmail(msg.subject, msg.text)]);
}

/**
 * Auto-Restart wurde ausgelöst (Server hing/war nicht erreichbar). Nutzt denselben
 * Schalter wie „Server offline", da es dieselbe Verfügbarkeits-Sorge betrifft.
 */
export async function notifyAutoRestart(
  serverName: string,
  minutesDown: number,
  attempt: number,
  maxAttempts: number,
): Promise<void> {
  if (!(await readBool(KEYS.serverDown, true))) return;
  const msg = notificationMessages(await readLocale()).autoRestart(
    serverName,
    minutesDown,
    attempt,
    maxAttempts,
  );
  await Promise.all([postToDiscord(msg.discord), postToEmail(msg.subject, msg.text)]);
}

/** Auto-Restart hat nach der maximalen Anzahl Versuche aufgegeben. */
export async function notifyAutoRestartGaveUp(
  serverName: string,
  maxAttempts: number,
): Promise<void> {
  if (!(await readBool(KEYS.serverDown, true))) return;
  const msg = notificationMessages(await readLocale()).autoRestartGaveUp(serverName, maxAttempts);
  await Promise.all([postToDiscord(msg.discord), postToEmail(msg.subject, msg.text)]);
}

export async function notifyBackupFailed(serverName: string, error: string): Promise<void> {
  if (!(await readBool(KEYS.backupFailed, true))) return;
  const msg = notificationMessages(await readLocale()).backupFailed(serverName, error);
  await Promise.all([postToDiscord(msg.discord), postToEmail(msg.subject, msg.text)]);
}

export async function notifyTaskFailed(
  taskName: string,
  serverName: string,
  error: string,
): Promise<void> {
  if (!(await readBool(KEYS.taskFailed, true))) return;
  const msg = notificationMessages(await readLocale()).taskFailed(taskName, serverName, error);
  await Promise.all([postToDiscord(msg.discord), postToEmail(msg.subject, msg.text)]);
}
