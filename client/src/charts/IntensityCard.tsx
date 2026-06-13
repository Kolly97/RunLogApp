// Intensitäts-Karte (ToDo #7/#13/#20): Donut = TSS-Anteile (eigene Legende, neutrale Mitte),
// rechts km-Anteile je Zone, darunter zwei Bewertungen (TSS-Last & Polarisierung).
import IntensityDonut, { INT_COLORS } from "./IntensityDonut.tsx";
import type { IntensityShare, WeekRating } from "../lib/api.ts";

const RATING: Record<string, { label: string; color: string }> = {
  easy: { label: "Easy", color: INT_COLORS.easy },
  moderate: { label: "Moderat", color: INT_COLORS.mod },
  hard: { label: "Hart", color: INT_COLORS.hard },
};

// Polarisierung aus den km-Anteilen je Zone (80/20-Prinzip).
function polarization(zk?: IntensityShare | null): { label: string; color: string; note: string } | null {
  if (!zk) return null;
  if (zk.mod >= 18) return { label: "Zu viel Grey-Zone", color: "#eab308", note: `${Math.round(zk.mod)}% in Z3` };
  if (zk.hard >= 25) return { label: "Sehr hart", color: "#f97316", note: `${Math.round(zk.hard)}% > Z3` };
  if (zk.easy >= 78 && zk.hard <= 22) return { label: "Polarisiert", color: "#22c55e", note: `${Math.round(zk.easy)}% easy / ${Math.round(zk.hard)}% hart` };
  return { label: "Ausgewogen", color: "#3b82f6", note: `${Math.round(zk.easy)}/${Math.round(zk.mod)}/${Math.round(zk.hard)}%` };
}

export default function IntensityCard({
  tss, zoneKm, rating, height = 130,
}: {
  tss: IntensityShare;
  zoneKm?: IntensityShare | null;
  rating?: WeekRating | null;
  height?: number;
}) {
  const pol = polarization(zoneKm);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{ flex: "0 0 auto", width: height }}>
          <div className="tiny muted center" style={{ marginBottom: 2 }}>TSS-Anteil</div>
          <IntensityDonut intensity={tss} height={height} centerText="TSS" showLegend />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="tiny muted" style={{ marginBottom: 3 }}>km-Anteil je Zone</div>
          <Row color={INT_COLORS.easy} label="Easy (Z1-2)" pct={zoneKm?.easy} />
          <Row color={INT_COLORS.mod} label="Moderat (Z3)" pct={zoneKm?.mod} />
          <Row color={INT_COLORS.hard} label="Hart (>Z3)" pct={zoneKm?.hard} />
        </div>
      </div>
      {rating && RATING[rating.level] && (
        <div className="int-rating" style={{ borderColor: RATING[rating.level].color, color: RATING[rating.level].color }}>
          Last diese Woche: <b>{RATING[rating.level].label}</b>
          <span className="tiny muted" style={{ marginLeft: 6, color: "var(--muted)" }}>
            {Math.round(rating.weekTss)} vs. Ø {Math.round(rating.avg4)} TSS (4 Wo)
          </span>
        </div>
      )}
      {pol && (
        <div className="int-rating" style={{ borderColor: pol.color, color: pol.color }}>
          Polarisierung: <b>{pol.label}</b>
          <span className="tiny muted" style={{ marginLeft: 6, color: "var(--muted)" }}>{pol.note}</span>
        </div>
      )}
    </div>
  );
}

function Row({ color, label, pct }: { color: string; label: string; pct?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, lineHeight: 1.7 }}>
      <span className="dot" style={{ background: color, width: 9, height: 9, borderRadius: "50%", display: "inline-block" }} />
      <span style={{ flex: 1 }}>{label}</span>
      <b>{pct == null ? "–" : `${Math.round(pct)}%`}</b>
    </div>
  );
}
