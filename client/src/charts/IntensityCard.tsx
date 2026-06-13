// Intensitäts-Karte (ToDo Z.41): nur noch der TSS-Donut (Anteile easy/moderat/hart, eigene Legende).
// Der %-km-Balken je Zone steht daneben als ZoneDistribution; die Bewertungen (Wochen-TSS-Last &
// km-Polarisierung) liegen jetzt im Wochen-Check (server-Flags) statt hier.
import IntensityDonut from "./IntensityDonut.tsx";
import type { IntensityShare } from "../lib/api.ts";

export default function IntensityCard({
  tss, height = 130,
}: {
  tss: IntensityShare;
  height?: number;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div style={{ width: height + 30 }}>
        <div className="tiny muted center" style={{ marginBottom: 2 }}>TSS-Anteil je Intensität</div>
        <IntensityDonut intensity={tss} height={height} centerText="TSS" showLegend />
      </div>
    </div>
  );
}
