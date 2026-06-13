import { Bar, BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { HrZone } from "../lib/api.ts";

// Erwartet Reihen wie { name: "Geplant", z1: min, z2: min, ... } und vergleicht planned vs real.
export default function ZoneDistribution({
  zones, rows, height = 130,
}: {
  zones: HrZone[];
  /** Werte je Zone (Lauf: km; Verteilung wird als % dargestellt). */
  rows: { name: string; values: Record<number, number> }[];
  height?: number;
}) {
  const data = rows.map((r) => {
    const total = Object.values(r.values).reduce((a, b) => a + b, 0) || 1;
    const o: Record<string, number | string> = { name: r.name };
    for (const z of zones) o["z" + z.z] = Math.round(((r.values[z.z] || 0) / total) * 1000) / 10;
    return o;
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }} barCategoryGap={2}>
        <XAxis type="number" domain={[0, 100]} unit="%" ticks={[0, 20, 40, 60, 80, 100]} tick={{ fontSize: 11, fill: "#8a96a6" }} />
        <YAxis type="category" dataKey="name" width={58} tick={{ fontSize: 12, fill: "#46505f" }} />
        <Tooltip formatter={(v: number, n: string) => [`${v}%`, zoneLabel(zones, n)]} contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }} />
        {zones.map((z) => (
          <Bar key={z.z} dataKey={"z" + z.z} stackId="a" name={"Z" + z.z}>
            {data.map((_, i) => <Cell key={i} fill={z.color} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function zoneLabel(zones: HrZone[], key: string): string {
  const z = zones.find((x) => "z" + x.z === key);
  return z ? z.label : key;
}
