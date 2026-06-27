import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TOOLTIP_STYLE } from "../lib/chartTheme.ts";
import type { PhysioDist } from "../lib/api.ts";

/** Vorher/Nachher-Zeitverteilung (Z1/Z2/Z3 in %) als gruppiertes Balkendiagramm. */
export default function MarkerDelta({ start, end, height = 180 }: { start: PhysioDist | null; end: PhysioDist | null; height?: number }) {
  if (!start && !end) return <div className="muted" style={{ fontSize: 12 }}>Keine Verteilungsdaten im Fenster.</div>;
  const data = [
    { zone: "Z1 <LT1", Vorher: start?.z1 ?? 0, Nachher: end?.z1 ?? 0 },
    { zone: "Z2 LT1–LT2", Vorher: start?.z2 ?? 0, Nachher: end?.z2 ?? 0 },
    { zone: "Z3 >LT2", Vorher: start?.z3 ?? 0, Nachher: end?.z3 ?? 0 },
  ];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
        <XAxis dataKey="zone" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} unit="%" />
        <Tooltip formatter={(v: number) => `${Math.round(v)}%`} contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Vorher" fill="#94a3b8" radius={[3, 3, 0, 0]} />
        <Bar dataKey="Nachher" fill="#3b82f6" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
