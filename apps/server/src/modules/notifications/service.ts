import type { NotificationChannel, NotificationSettingsDto } from "@minecontrol/shared";
import nodemailer from "nodemailer";
import { decryptSecret, encryptSecret } from "../../crypto.js";
import { prisma } from "../../db.js";

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
} as const;

async function readSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

async function deleteSetting(key: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { key } });
}

async function readBool(key: string, fallback: boolean): Promise<boolean> {
  const value = await readSetting(key);
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
}): Promise<NotificationSettingsDto> {
  if (input.discordWebhookUrl !== undefined) {
    if (input.discordWebhookUrl === "") {
      await deleteSetting(KEYS.webhookEnc);
    } else {
      await writeSetting(KEYS.webhookEnc, encryptSecret(input.discordWebhookUrl));
    }
  }
  if (input.emailTo === "") {
    await Promise.all([
      deleteSetting(KEYS.emailSmtpHost),
      deleteSetting(KEYS.emailSmtpPort),
      deleteSetting(KEYS.emailSmtpSecure),
      deleteSetting(KEYS.emailSmtpUser),
      deleteSetting(KEYS.emailSmtpPassEnc),
      deleteSetting(KEYS.emailFrom),
      deleteSetting(KEYS.emailTo),
    ]);
  } else {
    if (input.emailSmtpHost !== undefined) await writeSetting(KEYS.emailSmtpHost, input.emailSmtpHost);
    if (input.emailSmtpPort !== undefined) await writeSetting(KEYS.emailSmtpPort, String(input.emailSmtpPort));
    if (input.emailSmtpSecure !== undefined) await writeSetting(KEYS.emailSmtpSecure, String(input.emailSmtpSecure));
    if (input.emailSmtpUser !== undefined) await writeSetting(KEYS.emailSmtpUser, input.emailSmtpUser);
    if (input.emailSmtpPassword !== undefined) {
      await writeSetting(KEYS.emailSmtpPassEnc, encryptSecret(input.emailSmtpPassword));
    }
    if (input.emailFrom !== undefined) await writeSetting(KEYS.emailFrom, input.emailFrom);
    if (input.emailTo !== undefined) await writeSetting(KEYS.emailTo, input.emailTo);
  }
  if (input.notifyServerDown !== undefined) {
    await writeSetting(KEYS.serverDown, String(input.notifyServerDown));
  }
  if (input.notifyBackupFailed !== undefined) {
    await writeSetting(KEYS.backupFailed, String(input.notifyBackupFailed));
  }
  if (input.notifyTaskFailed !== undefined) {
    await writeSetting(KEYS.taskFailed, String(input.notifyTaskFailed));
  }
  return getNotificationSettings();
}

/** Sendet eine Nachricht an den Discord-Webhook (best effort). */
async function postToDiscord(content: string): Promise<void> {
  const enc = await readSetting(KEYS.webhookEnc);
  if (!enc) return;
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
      console.error(`Discord-Webhook antwortete mit ${res.status}`);
    }
  } catch (err) {
    console.error("Discord-Benachrichtigung fehlgeschlagen:", err);
  } finally {
    clearTimeout(timer);
  }
}

/** Baut einen SMTP-Transport aus den gespeicherten Einstellungen, oder `null` wenn unvollständig konfiguriert. */
async function buildEmailTransport(): Promise<{
  transport: import("nodemailer").Transporter;
  from: string;
  to: string;
} | null> {
  const [host, port, user, passEnc, from, to] = await Promise.all([
    readSetting(KEYS.emailSmtpHost),
    readSetting(KEYS.emailSmtpPort),
    readSetting(KEYS.emailSmtpUser),
    readSetting(KEYS.emailSmtpPassEnc),
    readSetting(KEYS.emailFrom),
    readSetting(KEYS.emailTo),
  ]);
  if (!host || !from || !to) return null;
  const transport = nodemailer.createTransport({
    host,
    port: port ? Number(port) : 587,
    secure: await readBool(KEYS.emailSmtpSecure, false),
    auth: user && passEnc ? { user, pass: decryptSecret(passEnc) } : undefined,
  });
  return { transport, from, to };
}

/** Sendet eine E-Mail-Benachrichtigung (best effort). */
async function postToEmail(subject: string, text: string): Promise<void> {
  const config = await buildEmailTransport();
  if (!config) return;
  try {
    await config.transport.sendMail({
      from: config.from,
      to: config.to,
      subject,
      text,
    });
  } catch (err) {
    console.error("E-Mail-Benachrichtigung fehlgeschlagen:", err);
  }
}

/** Sendet eine Testnachricht über den angegebenen Kanal (unabhängig von den notify-Schaltern). */
export async function sendTestNotification(channel: NotificationChannel): Promise<boolean> {
  if (channel === "discord") {
    if ((await readSetting(KEYS.webhookEnc)) === null) return false;
    await postToDiscord("✅ MineControl: Test-Benachrichtigung — der Webhook funktioniert.");
    return true;
  }
  const config = await buildEmailTransport();
  if (!config) return false;
  await postToEmail(
    "MineControl: Test-Benachrichtigung",
    "Diese Testnachricht zeigt, dass der SMTP-Versand funktioniert.",
  );
  return true;
}

export async function notifyServerDown(serverName: string): Promise<void> {
  if (!(await readBool(KEYS.serverDown, true))) return;
  await Promise.all([
    postToDiscord(`🔴 **${serverName}** ist offline gegangen.`),
    postToEmail("MineControl: Server offline", `${serverName} ist offline gegangen.`),
  ]);
}

export async function notifyBackupFailed(
  serverName: string,
  error: string,
): Promise<void> {
  if (!(await readBool(KEYS.backupFailed, true))) return;
  await Promise.all([
    postToDiscord(`⚠️ Backup für **${serverName}** fehlgeschlagen: ${error}`),
    postToEmail(
      "MineControl: Backup fehlgeschlagen",
      `Backup für ${serverName} fehlgeschlagen: ${error}`,
    ),
  ]);
}

export async function notifyTaskFailed(
  taskName: string,
  serverName: string,
  error: string,
): Promise<void> {
  if (!(await readBool(KEYS.taskFailed, true))) return;
  await Promise.all([
    postToDiscord(
      `⚠️ Geplante Aufgabe **${taskName}** (${serverName}) fehlgeschlagen: ${error}`,
    ),
    postToEmail(
      "MineControl: Geplante Aufgabe fehlgeschlagen",
      `Geplante Aufgabe ${taskName} (${serverName}) fehlgeschlagen: ${error}`,
    ),
  ]);
}
