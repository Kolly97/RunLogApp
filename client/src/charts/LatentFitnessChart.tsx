// Latente Fitness (L2): geglättete Trajektorie des Komposit-Faktors (CS/VDOT/VO2max) mit ±1-SD-Unsicherheits-
// band. Quelle: /api/ml/latent-fitness. Grammatik wie die übrigen Trend-Charts (TOOLTIP_STYLE, drawOn).
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TOOLTIP_STYLE } from "../lib/chartTheme.ts";
import { fmtDate, fmtDateY } from "../lib/util.ts";
import { useMotion, drawOn } from "../lib/motion.ts";
import type { MlLatentPoint } from "../lib/api.ts";

export default function LatentFitnessChart({ points, height }: { points: MlLatentPoint[]; height?: number }) {
  const anim = drawOn(useMotion());
  const data = points.map((p) => ({ date: p.date, value: p.value, band: [p.value - p.sd, p.value + p.sd] as [number, number] }));
  if (data.length < 2) return <p className="tiny muted">Noch zu wenig Daten für die latente Fitness-Trajektorie.</p>;
  // Expliziter Y-Domain aus Wert±SD — Recharts' Auto-Domain verschluckt sich am Band-Array (sonst kaputte Ticks).
  const ys = points.flatMap((p) => [p.value - p.sd, p.value + p.sd]);
  const yLo = Math.floor(Math.min(...ys) - 1);
  const yHi = Math.ceil(Math.max(...ys) + 1);
  return (
    <ResponsiveContainer width="100%" height={height ?? 240}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <defs>
          <linearGradient id="latFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.16} />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={(d) => fmtDate(String(d))} minTickGap={28} tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
        <YAxis domain={[yLo, yHi]} width={34} allowDecimals={false} tickFormatter={(v: number) => `${Math.round(v)}`} tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
        <Tooltip
          labelFormatter={(d) => fmtDateY(String(d))}
          formatter={(v: number, n: string) => [typeof v === "number" ? v.toFixed(1) : v, n]}
          contentStyle={TOOLTIP_STYLE}
        />
        {/* ±1-SD-Band (kein eigener Tooltip-Eintrag, hält den Hover schlicht) */}
        <Area type="monotone" dataKey="band" stroke="none" fill="url(#latFill)" connectNulls activeDot={false} tooltipType="none" legendType="none" {...anim} />
        <Line type="monotone" dataKey="value" name="Latente Fitness" stroke="#0ea5e9" strokeWidth={2} dot={false} connectNulls {...anim} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
