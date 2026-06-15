// Intervall-Trend (ToDo 2/13/20): Entwicklung der Lauf-Pace über die Zeit,
// gruppiert nach Belastungskategorie (LT1, LT2, VO2 kurz, VO2 lang).
// Y-Achse invertiert (schneller = oben), Format mm:ss /km.
// Datenquelle: /api/intervals/trend — Endpoint entsteht parallel; bei Fehler/leer wird nichts gerendert.
import { useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { IntervalEffortStat } from "../lib/api.ts";
import { fmtDate, paceStr } from "../lib/util.ts";

const CATS = [
  { key: "LT1", label: "LT1", color: "#0ea5e9" },
  { key: "LT2", label: "LT2 / Schwelle", color: "#eab308" },
  { key: "VO2short", label: "VO2 kurz", color: "#f97316" },
  { key: "VO2long", label: "VO2 lang", color: "#ef4444" },
] as const;

type CatKey = (typeof CATS)[number]["key"];

function runStats(data: IntervalEffortStat[]): IntervalEffortStat[] {
  return (data || []).filter(
    (d) => d?.avg_pace_s != null && d.avg_pace_s > 0 && CATS.some((c) => c.key === d.category),
  );
}

/** True, wenn es darstellbare Lauf-Pace-Punkte gibt (zum Ausblenden der Karte). */
export function hasRunTrend(data: IntervalEffortStat[] | null | undefined): boolean {
  return !!data && runStats(data).length > 0;
}

export default function IntervalTrend({ data, height = 260 }: { data: IntervalEffortStat[]; height?: number }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggleLine = (key: string) =>
    setHidden((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const runs = runStats(data);
  if (!runs.length) return null;

  // Pro Datum + Kategorie mitteln (mehrere Einheiten am selben Tag).
  const acc = new Map<string, { sum: Partial<Record<CatKey, number>>; n: Partial<Record<CatKey, number>> }>();
  for (const r of runs) {
    const e = acc.get(r.date) || { sum: {}, n: {} };
    const k = r.category as CatKey;
    e.sum[k] = (e.sum[k] || 0) + (r.avg_pace_s as number);
    e.n[k] = (e.n[k] || 0) + 1;
    acc.set(r.date, e);
  }
  const rows = [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, e]) => {
      const row: { date: string } & Partial<Record<CatKey, number>> = { date };
      for (const c of CATS) if (e.n[c.key]) row[c.key] = (e.sum[c.key] as number) / (e.n[c.key] as number);
      return row;
    });

  // Y-Domain mit etwas Luft (Pace in s/km), invertiert.
  const vals = runs.map((r) => r.avg_pace_s as number);
  const min = Math.floor((Math.min(...vals) - 10) / 10) * 10;
  const max = Math.ceil((Math.max(...vals) + 10) / 10) * 10;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#eef1f5" vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={28} tick={{ fontSize: 11, fill: "#8a96a6" }} />
        <YAxis reversed domain={[min, max]} tickFormatter={(v: number) => paceStr(v)} width={44}
          tick={{ fontSize: 11, fill: "#8a96a6" }} />
        <Tooltip
          labelFormatter={(d) => fmtDate(String(d))}
          formatter={(v: number, n: string) => [`${paceStr(v)} /km`, n]}
          contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
          onClick={(e) => { if (e?.dataKey) toggleLine(String(e.dataKey)); }} />
        {CATS.map((c) => (
          <Line key={c.key} type="monotone" dataKey={c.key} name={c.label} stroke={c.color}
            strokeWidth={1.8} connectNulls dot={{ r: 3, fill: c.color, strokeWidth: 0 }}
            hide={hidden.has(c.key)} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
