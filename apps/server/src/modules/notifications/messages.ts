import type { NotificationLocale } from "@minecontrol/shared";

/** Betreff + Text einer E-Mail sowie die (Markdown-)Zeile für Discord. */
export interface NotificationText {
  discord: string;
  subject: string;
  text: string;
}

/**
 * Lokalisierte Vorlagen für alle versendeten Benachrichtigungen. Bewusst als
 * einfache Funktionsvorlagen (keine i18next-Abhängigkeit im Backend) — die
 * Menge an Meldungen ist klein und überschaubar. Die gewünschte Sprache steckt
 * im Setting `notify.locale` (siehe service.ts).
 */
export interface NotificationMessages {
  testDiscord: string;
  testEmail: { subject: string; text: string };
  serverDown: (server: string) => NotificationText;
  autoRestart: (
    server: string,
    minutesDown: number,
    attempt: number,
    maxAttempts: number,
  ) => NotificationText;
  autoRestartGaveUp: (server: string, maxAttempts: number) => NotificationText;
  backupFailed: (server: string, error: string) => NotificationText;
  taskFailed: (task: string, server: string, error: string) => NotificationText;
}

const de: NotificationMessages = {
  testDiscord: "✅ MineControl: Test-Benachrichtigung — der Webhook funktioniert.",
  testEmail: {
    subject: "MineControl: Test-Benachrichtigung",
    text: "Diese Testnachricht zeigt, dass der SMTP-Versand funktioniert.",
  },
  serverDown: (server) => ({
    discord: `🔴 **${server}** ist offline gegangen.`,
    subject: "MineControl: Server offline",
    text: `${server} ist offline gegangen.`,
  }),
  autoRestart: (server, minutesDown, attempt, maxAttempts) => {
    const detail = `nach ${minutesDown} min ohne Antwort (Versuch ${attempt}/${maxAttempts})`;
    return {
      discord: `🔁 **${server}** wird automatisch neu gestartet — ${detail}.`,
      subject: "MineControl: Auto-Restart ausgelöst",
      text: `${server} wird automatisch neu gestartet — ${detail}.`,
    };
  },
  autoRestartGaveUp: (server, maxAttempts) => {
    const detail = `nach ${maxAttempts} erfolglosen Versuchen — manuelles Eingreifen nötig`;
    return {
      discord: `⛔ Auto-Restart für **${server}** aufgegeben ${detail}.`,
      subject: "MineControl: Auto-Restart aufgegeben",
      text: `Auto-Restart für ${server} aufgegeben ${detail}.`,
    };
  },
  backupFailed: (server, error) => ({
    discord: `⚠️ Backup für **${server}** fehlgeschlagen: ${error}`,
    subject: "MineControl: Backup fehlgeschlagen",
    text: `Backup für ${server} fehlgeschlagen: ${error}`,
  }),
  taskFailed: (task, server, error) => ({
    discord: `⚠️ Geplante Aufgabe **${task}** (${server}) fehlgeschlagen: ${error}`,
    subject: "MineControl: Geplante Aufgabe fehlgeschlagen",
    text: `Geplante Aufgabe ${task} (${server}) fehlgeschlagen: ${error}`,
  }),
};

const en: NotificationMessages = {
  testDiscord: "✅ MineControl: Test notification — the webhook works.",
  testEmail: {
    subject: "MineControl: Test notification",
    text: "This test message confirms that SMTP delivery works.",
  },
  serverDown: (server) => ({
    discord: `🔴 **${server}** has gone offline.`,
    subject: "MineControl: Server offline",
    text: `${server} has gone offline.`,
  }),
  autoRestart: (server, minutesDown, attempt, maxAttempts) => {
    const detail = `after ${minutesDown} min without response (attempt ${attempt}/${maxAttempts})`;
    return {
      discord: `🔁 **${server}** is being restarted automatically — ${detail}.`,
      subject: "MineControl: Auto-restart triggered",
      text: `${server} is being restarted automatically — ${detail}.`,
    };
  },
  autoRestartGaveUp: (server, maxAttempts) => {
    const detail = `after ${maxAttempts} failed attempts — manual intervention required`;
    return {
      discord: `⛔ Auto-restart for **${server}** gave up ${detail}.`,
      subject: "MineControl: Auto-restart gave up",
      text: `Auto-restart for ${server} gave up ${detail}.`,
    };
  },
  backupFailed: (server, error) => ({
    discord: `⚠️ Backup for **${server}** failed: ${error}`,
    subject: "MineControl: Backup failed",
    text: `Backup for ${server} failed: ${error}`,
  }),
  taskFailed: (task, server, error) => ({
    discord: `⚠️ Scheduled task **${task}** (${server}) failed: ${error}`,
    subject: "MineControl: Scheduled task failed",
    text: `Scheduled task ${task} (${server}) failed: ${error}`,
  }),
};

const CATALOG: Record<NotificationLocale, NotificationMessages> = { de, en };

/** Vorlagen für die gewünschte Sprache; fällt auf Deutsch zurück. */
export function notificationMessages(locale: NotificationLocale): NotificationMessages {
  return CATALOG[locale] ?? de;
}
