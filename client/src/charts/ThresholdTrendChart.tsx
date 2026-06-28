// Schwellen-Trend (v1.9.0): Schwellen-Pace (aus VDOT/CS, links, invertiert: schneller = oben) + Critical Power
// (rechts) über die Zeit. Quelle: /api/threshold-trend (rollendes 90-Tage-Fenster).
import { useEffect, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TOOLTIP_STYLE } from "../lib/chartTheme.ts";
import { api, type ThresholdTrend } from "../lib/api.ts";
import { fmtDate, fmtDateY, paceStr } from "../lib/util.ts";
import { useMotion, drawOn } from "../lib/motion.ts";

export default function ThresholdTrendChart({ height }: { height?: number }) {
  const [t, setT] = useState<ThresholdTrend | null>(null);
  const anim = drawOn(useMotion()); // M5: gegateter Draw-on
  useEffect(() => { api.thresholdTrend(12).then(setT).catch(() => setT(null)); }, []);
  const data = (t?.points ?? []).filter((p) => p.thrPace != null || p.cp != null);
  if (data.length < 2) return <p className="tiny muted">Noch zu wenig Verlauf für einen Schwellen-Trend (kommt mit mehr Bestzeiten/Watt-Daten).</p>;
  const hasCp = data.some((p) => p.cp != null);
  // M5: Gradient-Fläche unter der Schwellen-Pace. Pace-Achse ist invertiert (schneller = oben) → Basislinie
  // an den langsamsten Wert (unterer Rand), damit die Fläche „unter" der Linie liegt.
  const paces = data.map((p) => p.thrPace).filter((v): v is number => v != null);
  const paceFloor = paces.length ? Math.max(...paces) + 5 : 0;
  return (
    <ResponsiveContainer width="100%" height={height ?? 240}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <defs>
          <linearGradient id="thrFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#eab308" stopOpacity={0.16} />
            <stop offset="100%" stopColor="#eab308" stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={(d) => fmtDate(String(d))} minTickGap={28} tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
        <YAxis yAxisId="pace" reversed domain={["dataMin - 5", "dataMax + 5"]} width={52} tickFormatter={(s: number) => paceStr(s)} tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
        {hasCp && <YAxis yAxisId="cp" orientation="right" domain={["dataMin - 5", "dataMax + 5"]} width={42} unit=" W" tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />}
        <Tooltip labelFormatter={(d) => fmtDateY(String(d))} formatter={(v: number, n: string) => n === "Schwellen-Pace" ? [`${paceStr(v)}/km`, n] : [`${v} W`, n]}
          contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Area yAxisId="pace" type="monotone" dataKey="thrPace" baseValue={paceFloor} stroke="none" fill="url(#thrFill)" connectNulls legendType="none" activeDot={false} tooltipType="none" {...anim} />
        <Line yAxisId="pace" type="monotone" dataKey="thrPace" name="Schwellen-Pace" stroke="#eab308" strokeWidth={1.8} dot={false} connectNulls {...anim} />
        {hasCp && <Line yAxisId="cp" type="monotone" dataKey="cp" name="Critical Power" stroke="#7c3aed" strokeWidth={1.8} dot={false} connectNulls {...anim} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
