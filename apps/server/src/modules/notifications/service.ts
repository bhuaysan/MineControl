import type { NotificationSettingsDto } from "@minecontrol/shared";
import { decryptSecret, encryptSecret } from "../../crypto.js";
import { prisma } from "../../db.js";

/** Setting-Schlüssel für die Benachrichtigungs-Konfiguration. */
const KEYS = {
  webhookEnc: "discord.webhookUrlEnc",
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

async function readBool(key: string, fallback: boolean): Promise<boolean> {
  const value = await readSetting(key);
  return value === null ? fallback : value === "true";
}

/** Aktuelle Benachrichtigungs-Einstellungen (ohne die Webhook-URL selbst). */
export async function getNotificationSettings(): Promise<NotificationSettingsDto> {
  return {
    discordConfigured: (await readSetting(KEYS.webhookEnc)) !== null,
    notifyServerDown: await readBool(KEYS.serverDown, true),
    notifyBackupFailed: await readBool(KEYS.backupFailed, true),
    notifyTaskFailed: await readBool(KEYS.taskFailed, true),
  };
}

/** Aktualisiert Einstellungen. `discordWebhookUrl===""` löscht die Webhook-URL. */
export async function updateNotificationSettings(input: {
  discordWebhookUrl?: string;
  notifyServerDown?: boolean;
  notifyBackupFailed?: boolean;
  notifyTaskFailed?: boolean;
}): Promise<NotificationSettingsDto> {
  if (input.discordWebhookUrl !== undefined) {
    if (input.discordWebhookUrl === "") {
      await prisma.setting.deleteMany({ where: { key: KEYS.webhookEnc } });
    } else {
      await writeSetting(KEYS.webhookEnc, encryptSecret(input.discordWebhookUrl));
    }
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

/** Sendet eine Testnachricht (unabhängig von den notify-Schaltern). */
export async function sendTestNotification(): Promise<boolean> {
  if ((await readSetting(KEYS.webhookEnc)) === null) return false;
  await postToDiscord("✅ MineControl: Test-Benachrichtigung — der Webhook funktioniert.");
  return true;
}

export async function notifyServerDown(serverName: string): Promise<void> {
  if (!(await readBool(KEYS.serverDown, true))) return;
  await postToDiscord(`🔴 **${serverName}** ist offline gegangen.`);
}

export async function notifyBackupFailed(
  serverName: string,
  error: string,
): Promise<void> {
  if (!(await readBool(KEYS.backupFailed, true))) return;
  await postToDiscord(`⚠️ Backup für **${serverName}** fehlgeschlagen: ${error}`);
}

export async function notifyTaskFailed(
  taskName: string,
  serverName: string,
  error: string,
): Promise<void> {
  if (!(await readBool(KEYS.taskFailed, true))) return;
  await postToDiscord(
    `⚠️ Geplante Aufgabe **${taskName}** (${serverName}) fehlgeschlagen: ${error}`,
  );
}
