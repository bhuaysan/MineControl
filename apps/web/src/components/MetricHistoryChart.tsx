import type { MetricSampleDto } from "@minecontrol/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api.js";

type Range = "1h" | "6h" | "24h" | "7d";
type MetricKey = "players" | "cpu" | "ram" | "tps";

const RANGES: Range[] = ["1h", "6h", "24h", "7d"];

const METRICS: { key: MetricKey; color: string }[] = [
  { key: "players", color: "#4ade80" },
  { key: "cpu", color: "#fbbf24" },
  { key: "ram", color: "#60a5fa" },
  { key: "tps", color: "#f472b6" },
];

interface Point {
  t: number;
  v: number;
}

/** Extrahiert die gewählte Metrik als (Zeit, Wert)-Punkte; ignoriert Lücken. */
function toPoints(samples: MetricSampleDto[], metric: MetricKey): Point[] {
  const points: Point[] = [];
  for (const s of samples) {
    const t = new Date(s.timestamp).getTime();
    let v: number | undefined;
    if (metric === "players") v = s.playersOnline;
    else if (metric === "cpu") v = s.cpuPercent;
    else if (metric === "tps") v = s.tps;
    else v = s.ramUsedMb;
    if (v != null) points.push({ t, v });
  }
  return points;
}

const W = 600;
const H = 180;
const PAD = { top: 12, right: 12, bottom: 22, left: 40 };

export function MetricHistoryChart({ serverId }: { serverId: string }) {
  const { t } = useTranslation("metrics");
  const [range, setRange] = useState<Range>("6h");
  const [metric, setMetric] = useState<MetricKey>("players");

  const { data, isLoading } = useQuery({
    queryKey: ["server", serverId, "metrics", "history", range],
    queryFn: () => api.metricHistory(serverId, range),
    refetchInterval: 30_000,
  });

  const meta = METRICS.find((m) => m.key === metric)!;
  const points = toPoints(data ?? [], metric);

  const unit = metric === "cpu" ? "%" : metric === "ram" ? " MB" : "";
  // TPS hat eine feste Skala (0–20), CPU 0–100; sonst nach Datenmaximum.
  const floor = metric === "cpu" ? 100 : metric === "tps" ? 20 : 1;
  const maxV = metric === "tps" ? 20 : Math.max(floor, ...points.map((p) => p.v));
  const tMin = points.length ? points[0]!.t : 0;
  const tMax = points.length ? points[points.length - 1]!.t : 1;
  const tSpan = Math.max(tMax - tMin, 1);

  const x = (t: number) => PAD.left + ((t - tMin) / tSpan) * (W - PAD.left - PAD.right);
  const y = (v: number) => H - PAD.bottom - (v / maxV) * (H - PAD.top - PAD.bottom);

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(" ");
  const area =
    points.length > 1
      ? `${line} L${x(tMax).toFixed(1)},${(H - PAD.bottom).toFixed(1)} L${x(tMin).toFixed(1)},${(H - PAD.bottom).toFixed(1)} Z`
      : "";

  const timeFmt = (t: number) =>
    new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                metric === m.key
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {t(`metrics.${m.key}`)}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                range === r
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {t(`ranges.${r}`)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-neutral-500">{t("loading")}</p>
      ) : points.length < 2 ? (
        <p className="py-8 text-center text-sm text-neutral-500">{t("notEnoughData")}</p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={t("chartLabel", { metric: t(`metrics.${metric}`) })}
        >
          {/* Y-Gitterlinien + Beschriftung */}
          {[0, 0.5, 1].map((f) => {
            const gy = PAD.top + f * (H - PAD.top - PAD.bottom);
            const val = maxV * (1 - f);
            return (
              <g key={f}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={gy}
                  y2={gy}
                  stroke="currentColor"
                  className="text-neutral-800"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 6}
                  y={gy + 3}
                  textAnchor="end"
                  className="fill-neutral-500 text-[9px]"
                >
                  {metric === "ram" ? Math.round(val) : val.toFixed(metric === "cpu" ? 0 : 0)}
                </text>
              </g>
            );
          })}
          {/* X-Achsen-Zeiten */}
          {[tMin, (tMin + tMax) / 2, tMax].map((t, i) => (
            <text
              key={i}
              x={x(t)}
              y={H - 6}
              textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
              className="fill-neutral-500 text-[9px]"
            >
              {timeFmt(t)}
            </text>
          ))}
          {area && <path d={area} fill={meta.color} opacity={0.12} />}
          <path d={line} fill="none" stroke={meta.color} strokeWidth={1.5} />
        </svg>
      )}
      <p className="mt-1 text-right text-xs text-neutral-500">
        {t("current")}{" "}
        <span className="font-mono text-neutral-300">
          {points.length ? points[points.length - 1]!.v : "–"}
          {unit}
        </span>
      </p>
    </div>
  );
}
