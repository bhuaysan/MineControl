/** Formatiert Sekunden als „2h 14m" bzw. „47m". */
export function formatDuration(seconds?: number): string {
  if (seconds == null) return "–";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
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
