// Intensitäts-Karte (ToDo #7/#13): Donut = TSS-Anteile (Mitte = % hart),
// rechts die km-Anteile je Zonen-Gruppe, darunter die Wochen-Bewertung.
import IntensityDonut, { INT_COLORS } from "./IntensityDonut.tsx";
import type { IntensityShare, WeekRating } from "../lib/api.ts";

const RATING: Record<string, { label: string; color: string }> = {
  easy: { label: "Easy", color: INT_COLORS.easy },
  moderate: { label: "Moderat", color: INT_COLORS.mod },
  hard: { label: "Hart", color: INT_COLORS.hard },
};

export default function IntensityCard({
  tss, zoneKm, rating, height = 130,
}: {
  /** TSS-Anteile je Kategorie (Donut). */
  tss: IntensityShare;
  /** km-Anteile je Zonen-Gruppe (Seitenlegende). */
  zoneKm?: IntensityShare | null;
  /** Wochen-Bewertung (Badge). */
  rating?: WeekRating | null;
  height?: number;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: "0 0 auto", width: height }}>
          <IntensityDonut intensity={tss} height={height} center={{ value: tss.hard, sub: "hart" }} />
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
          Diese Woche: <b>{RATING[rating.level].label}</b>
          <span className="tiny muted" style={{ marginLeft: 6, color: "var(--muted)" }}>
            {Math.round(rating.weekTss)} vs. Ø {Math.round(rating.avg4)} TSS (4 Wo)
          </span>
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
