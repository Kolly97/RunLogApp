import {
  Area, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Bar,
} from "recharts";
import type { PmcPoint } from "../lib/api.ts";
import { todayIso, fmtDate } from "../lib/util.ts";

// TrainingPeaks-Farbsemantik: CTL = blaue Fläche/Linie (--fitness), ATL = rosa (--fatigue), TSB = gelb (--form).
export default function Pmc({
  data, height = 300, highlight,
}: {
  data: PmcPoint[]; height?: number;
  /** Optional hervorgehobener Zeitraum (z.B. die Berichtswoche). */
  highlight?: { from: string; to: string };
}) {
  if (!data.length) return <div className="empty">Noch keine Trainingsdaten — plane eine Woche oder synchronisiere Strava.</div>;
  const today = todayIso();
  const hl = highlight && data.some((p) => p.date >= highlight.from && p.date <= highlight.to) ? highlight : null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 14, right: 12, left: -6, bottom: 0 }}>
        <defs>
          <linearGradient id="ctlFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--fitness)" stopOpacity={0.6} />
            <stop offset="100%" stopColor="var(--fitness)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#eef1f5" vertical={false} />
        {hl && (
          <ReferenceArea yAxisId="load" x1={hl.from} x2={hl.to} fill="var(--accent)" fillOpacity={0.07}
            stroke="#bcd4f0" strokeOpacity={0.8} ifOverflow="hidden" />
        )}
        <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={36} tick={{ fontSize: 11, fill: "#8a96a6" }} />
        <YAxis yAxisId="load" tick={{ fontSize: 11, fill: "#8a96a6" }} width={38} />
        <YAxis yAxisId="form" orientation="right" tick={{ fontSize: 11, fill: "#8a96a6" }} width={34} />
        <Tooltip
          labelFormatter={(d) => fmtDate(String(d))}
          formatter={(v: number, n: string) => [Math.round(v * 10) / 10, n]}
          contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="load" dataKey="tss" name="TSS/Tag" fill="#dfe6ee" barSize={3} />
        <Area yAxisId="load" type="monotone" dataKey="ctl" name="Fitness (CTL)" stroke="var(--fitness)" strokeWidth={2.2} fill="url(#ctlFill)" dot={false} />
        <Line yAxisId="load" type="monotone" dataKey="atl" name="Fatigue (ATL)" stroke="var(--fatigue)" strokeWidth={1.8} dot={false} />
        <Line yAxisId="form" type="monotone" dataKey="tsb" name="Form (TSB)" stroke="var(--form)" strokeWidth={1.8} dot={false} />
        <ReferenceLine yAxisId="form" y={0} stroke="#cbd5e1" strokeDasharray="2 4" />
        <ReferenceLine yAxisId="load" x={today} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "heute", fontSize: 10, fill: "#94a3b8", position: "top" }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
