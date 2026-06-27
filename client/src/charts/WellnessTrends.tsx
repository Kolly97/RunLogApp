// Wellness-Verläufe der Woche (Wochenbericht Seite 2):
// HRV, Ruhepuls, Recovery, Strain, Schlaf (h), Bettzeit — als kleine Einzel-Charts (Mo–So).
// Bettzeit wird als Abweichung von 23:30 geplottet, Achse/Tooltip zeigen die Uhrzeit.
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from "recharts";
import type { DailyLog } from "../lib/api.ts";
import { DAY_NAMES } from "../lib/util.ts";
import SleepWindow from "./SleepWindow.tsx";

const BED_REF = 23 * 60 + 30; // Referenz-Bettzeit 23:30

/** "HH:MM" → Abweichung von 23:30 in Minuten (nach Mitternacht = +). */
export function bedDeviation(t: unknown): number | null {
  if (typeof t !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return null;
  let mins = Number(m[1]) * 60 + Number(m[2]);
  if (mins < 12 * 60) mins += 24 * 60; // 00:15 etc. zählt als nach Mitternacht
  return mins - BED_REF;
}

/** Abweichung (min) → Uhrzeit-String. */
export function devToClock(dev: number): string {
  const mins = ((BED_REF + Math.round(dev)) % (24 * 60) + 24 * 60) % (24 * 60);
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
}

export interface Point { label: string; [k: string]: number | string | null; }

export interface MetricDef {
  key: string;
  title: string;
  color: string;
  fmt?: (v: number) => string;
  refY?: number;       // gestrichelte Referenzlinie (z.B. 23:30 bei Bettzeit)
  refLabel?: string;
  reversed?: boolean;  // Y-Achse umdrehen (Bettzeit: spät = unten)
}

interface SleepRow { x: string; bedtime?: unknown; wake_time?: unknown; }

/** Datengrundlage der Wochen-Wellness-Verläufe — für Einzel-Charts wiederverwendbar (EditableGrid). */
export function wellnessTrendData(daily: DailyLog[], days: string[]): { points: Point[]; visible: MetricDef[]; sleepRows: SleepRow[] } {
  const points: Point[] = days.map((d, i) => {
    const dl = daily.find((x) => x.date === d);
    const p: Point = { label: DAY_NAMES[i] || d };
    for (const m of METRICS) {
      if (m.key === "bed_dev") { p.bed_dev = dl ? bedDeviation(dl.bedtime) : null; continue; }
      const v = dl?.[m.key];
      p[m.key] = typeof v === "number" && isFinite(v) ? v : null;
    }
    return p;
  });
  const visible = METRICS.filter((m) => points.some((p) => p[m.key] != null));
  const sleepRows: SleepRow[] = days.map((d, i) => {
    const dl = daily.find((x) => x.date === d);
    return { x: DAY_NAMES[i] || d, bedtime: dl?.bedtime, wake_time: dl?.wake_time };
  });
  return { points, visible, sleepRows };
}

/** Ein einzelner Wellness-Verlaufs-Chart (eine Kennzahl). `band` = 30-Tage-Normalbereich (v1.10.0). */
export function WellnessTrendChart({ metric: m, points, sleepRows, height = 100, band }: {
  metric: MetricDef; points: Point[]; sleepRows: SleepRow[]; height?: number; band?: { lo: number; hi: number; mean: number } | null;
}) {
  if (m.key === "bed_dev") return <SleepWindow data={sleepRows} height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points} margin={{ top: 6, right: 8, left: -14, bottom: -4 }}>
        <CartesianGrid stroke="#eef1f5" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#8a96a6" }} interval={0} />
        <YAxis
          tick={{ fontSize: 10, fill: "#8a96a6" }}
          width={46}
          domain={["auto", "auto"]}
          reversed={m.reversed}
          tickFormatter={(v: number) => (m.fmt ? m.fmt(v) : String(Math.round(v * 10) / 10))}
        />
        <Tooltip
          formatter={(v: number) => [m.fmt ? m.fmt(v) : Math.round(v * 10) / 10, m.title]}
          contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }}
        />
        {m.refY != null && (
          <ReferenceLine y={m.refY} stroke="#cbd5e1" strokeDasharray="3 4"
            label={{ value: m.refLabel, fontSize: 9, fill: "#94a3b8", position: "right" }} />
        )}
        {band && (<>
          <ReferenceArea y1={band.lo} y2={band.hi} fill={m.color} fillOpacity={0.08} ifOverflow="hidden" />
          <ReferenceLine y={band.mean} stroke={m.color} strokeDasharray="5 3" strokeOpacity={0.4} strokeWidth={1.1} />
        </>)}
        <Line type="monotone" dataKey={m.key} stroke={m.color} strokeWidth={1.8}
          dot={{ r: 2.5, fill: m.color, strokeWidth: 0 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

const METRICS: MetricDef[] = [
  { key: "hrv", title: "HRV (ms)", color: "#2b6cb0" },
  { key: "resting_hr", title: "Ruhepuls (bpm)", color: "#d53f8c" },
  { key: "recovery", title: "Recovery (%)", color: "#16a34a" },
  { key: "strain", title: "Strain", color: "#f97316" },
  { key: "sleep_h", title: "Schlaf (h)", color: "#6366f1", fmt: (v) => v.toFixed(1) },
  { key: "bed_dev", title: "Schlaffenster", color: "#0891b2", fmt: devToClock, refY: 0, refLabel: "23:30", reversed: true },
];

export default function WellnessTrends({ daily, days, height = 100 }: {
  daily: DailyLog[]; days: string[]; height?: number;
}) {
  const { points, visible, sleepRows } = wellnessTrendData(daily, days);
  if (!visible.length) return <p className="tiny muted">Keine Tagesfaktoren für diese Woche eingetragen.</p>;
  return (
    <div className="wellness-grid">
      {visible.map((m) => (
        <div key={m.key} className="chart-card tight">
          <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 2 }}>{m.title}</div>
          <WellnessTrendChart metric={m} points={points} sleepRows={sleepRows} height={height} />
        </div>
      ))}
    </div>
  );
}
