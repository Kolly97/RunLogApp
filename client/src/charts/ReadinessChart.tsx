// Readiness (P4): geglättete latente Readiness (0–100) mit ±1-SD-Band, 50 = Baseline-Linie.
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TOOLTIP_STYLE } from "../lib/chartTheme.ts";
import { fmtDate, fmtDateY } from "../lib/util.ts";
import type { MlReadinessPoint } from "../lib/api.ts";

export default function ReadinessChart({ points, height }: { points: MlReadinessPoint[]; height?: number }) {
  const data = points.map((p) => ({ date: p.date, value: p.value, band: [Math.max(0, p.value - p.sd), Math.min(100, p.value + p.sd)] as [number, number] }));
  if (data.length < 2) return <p className="tiny muted">Noch zu wenig Daten für eine Readiness-Kurve.</p>;
  return (
    <ResponsiveContainer width="100%" height={height ?? 200}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <defs>
          <linearGradient id="readyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.16} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={(d) => fmtDate(String(d))} minTickGap={28} tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
        <YAxis domain={[0, 100]} width={28} tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
        <ReferenceLine y={50} stroke="var(--border)" strokeDasharray="3 3" />
        <Tooltip labelFormatter={(d) => fmtDateY(String(d))} formatter={(v: number, n: string) => [typeof v === "number" ? v.toFixed(0) : v, n]} contentStyle={TOOLTIP_STYLE} />
        <Area type="monotone" dataKey="band" stroke="none" fill="url(#readyFill)" connectNulls activeDot={false} tooltipType="none" legendType="none" />
        <Line type="monotone" dataKey="value" name="Readiness" stroke="#22c55e" strokeWidth={2} dot={false} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
