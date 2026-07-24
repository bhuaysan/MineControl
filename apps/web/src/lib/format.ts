import i18n from "../i18n/index.js";

/** Ordnet der aktuellen UI-Sprache eine BCP-47-Locale für `toLocaleString` zu. */
function currentLocale(): string {
  return i18n.resolvedLanguage === "en" ? "en-GB" : "de-DE";
}

/** Formatiert Sekunden als „2h 14m" bzw. „47m". */
export function formatDuration(seconds?: number): string {
  if (seconds == null) return i18n.t("format:none");
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Formatiert eine Spielzeit als „3d 4h" / „4h 12m" / „12m" / „< 1m". */
export function formatPlaytime(seconds?: number): string {
  if (!seconds || seconds < 60)
    return seconds ? i18n.t("format:lessThanMinute") : i18n.t("format:none");
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Formatiert Bytes als „1.4 GB" / „720 MB" / „512 KB". */
export function formatBytes(bytes?: number): string {
  if (bytes == null) return i18n.t("format:none");
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

/** Datum/Uhrzeit als „18.07.2026, 20:14" (bzw. länderübliches Format). */
export function formatDateTime(iso?: string): string {
  if (!iso) return i18n.t("format:none");
  return new Date(iso).toLocaleString(currentLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Grobe „vor X"-Angabe relativ zu jetzt. */
export function formatRelative(iso?: string): string {
  if (!iso) return i18n.t("format:never");
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return i18n.t("format:justNow");
  if (min < 60) return i18n.t("format:minutesAgo", { count: min });
  const hours = Math.floor(min / 60);
  if (hours < 24) return i18n.t("format:hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return i18n.t("format:daysAgo", { count: days });
}
