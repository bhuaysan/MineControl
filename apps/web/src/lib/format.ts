/** Formatiert Sekunden als „2h 14m" bzw. „47m". */
export function formatDuration(seconds?: number): string {
  if (seconds == null) return "–";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Formatiert Bytes als „1,4 GB" / „720 MB" / „512 KB". */
export function formatBytes(bytes?: number): string {
  if (bytes == null) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

/** Datum/Uhrzeit als „18.07.2026, 20:14". */
export function formatDateTime(iso?: string): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Grobe „vor X"-Angabe relativ zu jetzt. */
export function formatRelative(iso?: string): string {
  if (!iso) return "nie";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `vor ${hours} h`;
  const days = Math.floor(hours / 24);
  return `vor ${days} d`;
}
