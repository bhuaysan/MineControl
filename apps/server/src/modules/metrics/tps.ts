import type { ServerAdapter } from "../../adapters/types.js";

/** Editionen mit `/tps`-Befehl (Paper-basiert). */
export const TPS_EDITIONS = ["PAPER", "SPIGOT"];

/**
 * Parst die Paper/Spigot-`tps`-Ausgabe und liefert die 1-Minuten-TPS.
 * Beispiel: „§6TPS from last 1m, 5m, 15m: §a20.0, 20.0, 20.0" → 20.0.
 * `null`, wenn der Befehl unbekannt ist (z. B. Vanilla) oder nicht parsbar.
 */
export function parseTps(output: string): number | null {
  const clean = output.replace(/§[0-9a-fk-or]/gi, "");
  if (/Unknown( or incomplete)? command/i.test(clean)) return null;
  // Erster Zahlenwert nach dem Doppelpunkt (optional mit „*" für geschätzt).
  const m = clean.match(/:\s*\*?(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  // Paper meldet gelegentlich knapp über 20 (Aufholen) — auf 20 begrenzen.
  return Math.min(Math.round(value * 100) / 100, 20);
}

/** Fragt die aktuelle TPS über RCON ab; `null`, wenn nicht verfügbar. */
export async function sampleTps(adapter: ServerAdapter): Promise<number | null> {
  try {
    return parseTps(await adapter.sendCommand("tps"));
  } catch {
    return null;
  }
}
