import { Bar, BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { TOOLTIP_STYLE, TOOLTIP_ITEM_STYLE } from "../lib/chartTheme.ts";
import type { HrZone } from "../lib/api.ts";

// Erwartet Reihen wie { name: "Geplant", values: {1: km, 2: km, …} } und stellt sie als %-Stapelbalken dar.
// Balken haben feste Dicke → die Höhe ergibt sich aus der Zeilenzahl (füllt die Kachel, ToDo Z.8).
export default function ZoneDistribution({
  zones, rows, height,
}: {
  zones: HrZone[];
  /** Werte je Zone (Lauf: km; Verteilung wird als % dargestellt). */
  rows: { name: string; values: Record<number, number> }[];
  /** Optionale Mindesthöhe des Chart-Bereichs (px). */
  height?: number;
}) {
  const data = rows.map((r) => {
    const total = Object.values(r.values).reduce((a, b) => a + b, 0) || 1;
    const o: Record<string, number | string> = { name: r.name };
    for (const z of zones) o["z" + z.z] = Math.round(((r.values[z.z] || 0) / total) * 1000) / 10;
    return o;
  });
  const barSize = 30;
  const chartH = Math.max(rows.length * (barSize + 16) + 8, height ?? 0);
  return (
    <div>
      <ResponsiveContainer width="100%" height={chartH}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
          <XAxis type="number" domain={[0, 100]} unit="%" ticks={[0, 20, 40, 60, 80, 100]} tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
          <YAxis type="category" dataKey="name" width={58} tick={{ fontSize: 12, fill: "var(--chart-tick)" }} />
          <Tooltip formatter={(v: number, n: string) => [`${v}%`, zoneLabel(zones, n)]} contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
          {zones.map((z) => (
            <Bar key={z.z} dataKey={"z" + z.z} stackId="a" name={"Z" + z.z} barSize={barSize}>
              {data.map((_, i) => <Cell key={i} fill={z.color} />)}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="zone-legend">
        {zones.map((z) => (
          <span key={z.z}><span className="dot" style={{ background: z.color }} /> {z.label}</span>
        ))}
      </div>
    </div>
  );
}

function zoneLabel(zones: HrZone[], key: string): string {
  const z = zones.find((x) => "z" + x.z === key);
  return z ? z.label : key;
}
