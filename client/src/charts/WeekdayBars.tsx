// Wochenbericht: pro Wochentag (Mo–So) zwei gestapelte Balken —
//  1) km: Lauf-km + äquivalente Rad-km (Rad-km × Faktor),
//  2) TSS: Lauf-rTSS + übrige TSS (Rad/Commute/…).
// Reale Aktivitäten der Berichtswoche; km links, TSS rechts.
import { Bar, ComposedChart, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { Activity } from "../lib/api.ts";
import { DAY_NAMES } from "../lib/util.ts";

export default function WeekdayBars({
  days, acts, bikeFactor = 0.25, height = 210,
}: {
  days: string[]; acts: Activity[]; bikeFactor?: number; height?: number;
}) {
  const rows = days.map((d, i) => {
    let runKm = 0, bikeKm = 0, runT = 0, otherT = 0;
    for (const a of acts) {
      if (a.date !== d) continue;
      const km = (a.distance_m || 0) / 1000;
      if (a.sport === "Run") { runKm += km; runT += a.tss || 0; }
      else { if (a.sport?.startsWith("Bike") || a.sport === "General") bikeKm += km; otherT += a.tss || 0; }
    }
    return {
      label: DAY_NAMES[i] || d.slice(5),
      runKm: Math.round(runKm * 10) / 10,
      bikeEq: Math.round(bikeKm * bikeFactor * 10) / 10,
      runT: Math.round(runT),
      otherT: Math.round(otherT),
    };
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 14, right: 6, left: -12, bottom: 4 }} barGap={2}>
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8a96a6" }} />
        <YAxis yAxisId="km" tick={{ fontSize: 11, fill: "#8a96a6" }} width={30} />
        <YAxis yAxisId="tss" orientation="right" tick={{ fontSize: 11, fill: "#8a96a6" }} width={30} />
        <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }}
          formatter={(v: number, n: string) => [v, n]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar yAxisId="km" dataKey="runKm" name="Lauf-km" stackId="km" fill="#9ec3ea" barSize={9} isAnimationActive={false} />
        <Bar yAxisId="km" dataKey="bikeEq" name="Rad-km (äqu.)" stackId="km" fill="#6366f1" barSize={9} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        <Bar yAxisId="tss" dataKey="runT" name="rTSS (Lauf)" stackId="t" fill="#f97316" barSize={9} isAnimationActive={false} />
        <Bar yAxisId="tss" dataKey="otherT" name="TSS (Rad/übrige)" stackId="t" fill="#0ea5e9" barSize={9} radius={[2, 2, 0, 0]} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
