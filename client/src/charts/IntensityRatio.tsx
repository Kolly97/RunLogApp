// Intensity-Trend (v0.15.0, O3): Load Impact / Base Fitness = ATL/CTL × 100% (Acute:Chronic Workload Ratio).
// Separater Graph (nicht im PMC). Bänder nach COROS-Logik; abgeleitet aus den vorhandenen PMC-Punkten.
import {
  Area, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { TOOLTIP_STYLE } from "../lib/chartTheme.ts";
import type { PmcPoint } from "../lib/api.ts";
import { fmtDate, fmtDateY, todayIso } from "../lib/util.ts";

// Bänder: [Untergrenze, Obergrenze) — Reihenfolge wie im Screenshot.
const BANDS = [
  { lo: 0, hi: 50, color: "#94a3b8", label: "Decreasing", range: "0–49%", desc: "wenig Last, Basis sinkt" },
  { lo: 50, hi: 80, color: "#0ea5e9", label: "Resuming / Performance", range: "50–79%", desc: "Wiedereinstieg / rennbereit" },
  { lo: 80, hi: 100, color: "#22c55e", label: "Maintaining", range: "80–99%", desc: "Basis halten" },
  { lo: 100, hi: 150, color: "#d4af37", label: "Optimized", range: "100–149%", desc: "produktiv, Basis steigt" },
  { lo: 150, hi: 240, color: "#ef4444", label: "Excessive", range: "≥150%", desc: "Überlastungsrisiko" },
] as const;

interface Row { date: string; ratio: number; }

export default function IntensityRatio({ data, height = 240 }: { data: PmcPoint[]; height?: number }) {
  const today = todayIso();
  const rows: Row[] = (data || [])
    .filter((p) => !p.planned && p.date <= today && p.ctl >= 1)
    .map((p) => ({ date: p.date, ratio: Math.round((p.atl / p.ctl) * 100) }));

  if (rows.length < 2) return <p className="muted tiny">Zu wenige Daten für den Intensity-Trend.</p>;

  const bandFor = (v: number) => BANDS.find((b) => v >= b.lo && v < b.hi) ?? BANDS[BANDS.length - 1];
  const maxR = Math.max(160, ...rows.map((r) => r.ratio));
  const cur = rows[rows.length - 1].ratio;
  const curBand = bandFor(cur);

  return (
    <>
      <div className="row" style={{ gap: 8, marginBottom: 6 }}>
        <span className="tiny muted">Aktuell:</span>
        <span style={{ fontWeight: 700, color: curBand.color }}>{cur}% · {curBand.label}</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eef1f5" vertical={false} />
          {BANDS.map((b) => (
            <ReferenceArea key={b.label} y1={b.lo} y2={Math.min(b.hi, maxR)} fill={b.color} fillOpacity={0.18} ifOverflow="hidden" />
          ))}
          {/* Optimal-Korridor 80–149 % (Maintaining + Optimized) */}
          <ReferenceLine y={80} stroke="#16a34a" strokeDasharray="5 4" strokeWidth={1.4}
            label={{ value: "Optimal 80 %", fontSize: 9, fill: "#16a34a", position: "insideBottomLeft" }} />
          <ReferenceLine y={149} stroke="#16a34a" strokeDasharray="5 4" strokeWidth={1.4}
            label={{ value: "149 %", fontSize: 9, fill: "#16a34a", position: "insideTopLeft" }} />
          <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={28} tick={{ fontSize: 11, fill: "#8a96a6" }} />
          <YAxis domain={[0, maxR]} width={40} tick={{ fontSize: 11, fill: "#8a96a6" }} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip
            labelFormatter={(d) => fmtDateY(String(d))}
            formatter={(v: number) => [`${v}% · ${bandFor(v).label}`, "Intensity"]}
            contentStyle={TOOLTIP_STYLE}
          />
          <Area type="monotone" dataKey="ratio" stroke="#334155" strokeWidth={1.8} fill="#334155" fillOpacity={0.06} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="row" style={{ flexWrap: "wrap", gap: "4px 14px", marginTop: 8 }}>
        {BANDS.map((b) => (
          <span key={b.label} className="tiny muted" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: b.color, display: "inline-block" }} />
            <strong style={{ color: "#475569" }}>{b.label}</strong> {b.range}
          </span>
        ))}
      </div>
    </>
  );
}
