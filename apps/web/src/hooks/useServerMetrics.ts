import { useEffect, useState } from "react";
import { openTopicSocket } from "../lib/ws.js";

export interface LiveMetrics {
  cpuPercent?: number;
  ramUsedMb?: number;
  ramMaxMb?: number;
  tps?: number;
}

/**
 * Abonniert `metrics:<serverId>` und liefert das jeweils letzte Sample.
 * Nur aktiv, solange `enabled` — passt zum Abo-Modell (Metriken sind teuer).
 */
export function useServerMetrics(serverId: string, enabled: boolean): LiveMetrics | null {
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);

  useEffect(() => {
    if (!enabled) {
      setMetrics(null);
      return;
    }
    const close = openTopicSocket(`metrics:${serverId}`, (msg) => {
      if (msg.type === "metrics.update" && msg.serverId === serverId) {
        // CPU/RAM (docker stats) und TPS (RCON-Poll) kommen in getrennten
        // Nachrichten — daher mergen statt ersetzen.
        setMetrics((prev) => ({
          ...prev,
          ...(msg.cpuPercent !== undefined
            ? { cpuPercent: msg.cpuPercent, ramUsedMb: msg.ramUsedMb, ramMaxMb: msg.ramMaxMb }
            : {}),
          ...(msg.tps !== undefined ? { tps: msg.tps } : {}),
        }));
      }
    });
    return close;
  }, [serverId, enabled]);

  return metrics;
}
