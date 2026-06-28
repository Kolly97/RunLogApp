// Wochenbericht: pro Wochentag (Mo–So) zwei gestapelte Balken —
//  1) km: Lauf-km + äquivalente Rad-km (Rad-km × Faktor),
//  2) TSS: Lauf-rTSS + übrige TSS (Rad/Commute/…).
// Reale Aktivitäten der Berichtswoche; km links, TSS rechts.
// Farb-Semantik (ToDo Z.12 v0.11.0): Distanz in kühlen Tönen (Blau/Türkis),
// Belastung in warmen Tönen (Orange/Bernstein); Legende in zwei beschriftete Gruppen.
import { Bar, ComposedChart, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { TOOLTIP_STYLE } from "../lib/chartTheme.ts";
import type { Activity } from "../lib/api.ts";
import { DAY_NAMES } from "../lib/util.ts";

// Distanz (kühl) vs. Belastung (warm) — klar getrennte Hue-Gruppen.
const C_RUN_KM = "#93c5fd";   // Lauf-km — hell-blau
const C_BIKE_KM = "#2dd4bf";  // Rad-km (äqu.) — türkis
const C_RUN_TSS = "#f97316";  // rTSS (Lauf) — orange
const C_OTHER_TSS = "#fbbf24"; // TSS (Rad/übrige) — bernstein

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
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 14, right: 6, left: -12, bottom: 4 }} barGap={2}>
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
          <YAxis yAxisId="km" tick={{ fontSize: 11, fill: "var(--chart-tick)" }} width={30} />
          <YAxis yAxisId="tss" orientation="right" tick={{ fontSize: 11, fill: "var(--chart-tick)" }} width={30} />
          <Tooltip contentStyle={TOOLTIP_STYLE}
            formatter={(v: number, n: string) => [v, n]} />
          <Bar yAxisId="km" dataKey="runKm" name="Lauf-km" stackId="km" fill={C_RUN_KM} barSize={9} isAnimationActive={false} />
          <Bar yAxisId="km" dataKey="bikeEq" name="Rad-km (äqu.)" stackId="km" fill={C_BIKE_KM} barSize={9} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          <Bar yAxisId="tss" dataKey="runT" name="rTSS (Lauf)" stackId="t" fill={C_RUN_TSS} barSize={9} isAnimationActive={false} />
          <Bar yAxisId="tss" dataKey="otherT" name="TSS (Rad/übrige)" stackId="t" fill={C_OTHER_TSS} barSize={9} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      {/* Gruppierte Legende: Distanz (kühl, linke Achse) vs. Belastung (warm, rechte Achse). */}
      <div className="weekday-legend">
        <div className="grp">
          <span className="grp-head">Distanz (km)</span>
          <span className="lg"><span className="dot" style={{ background: C_RUN_KM }} /> Lauf</span>
          <span className="lg"><span className="dot" style={{ background: C_BIKE_KM }} /> Rad (äqu.)</span>
        </div>
        <div className="grp">
          <span className="grp-head">Belastung (TSS)</span>
          <span className="lg"><span className="dot" style={{ background: C_RUN_TSS }} /> Lauf (rTSS)</span>
          <span className="lg"><span className="dot" style={{ background: C_OTHER_TSS }} /> Rad / übrige</span>
        </div>
      </div>
    </div>
  );
}
