// Konfidenz-Badge (v1.8.0): kennzeichnet dezent, wie belastbar ein Wert ist (robust ↔ explorativ),
// damit unsichere Schätzungen (kleine Stichprobe, schlechter Fit) den Nutzer nicht verunsichern.
// Level direkt ("hoch"/"mittel"/"niedrig") ODER aus Stichprobe n / Bestimmtheitsmaß R² abgeleitet.
export type ConfLevel = "hoch" | "mittel" | "niedrig";

const COL: Record<ConfLevel, string> = { hoch: "var(--ok)", mittel: "var(--warn)", niedrig: "var(--muted)" };
const LABEL: Record<ConfLevel, string> = { hoch: "belastbar", mittel: "mittlere Konfidenz", niedrig: "explorativ" };

/** Belastbarkeit aus Stichprobengröße + Fit-Güte heuristisch ableiten. */
export function levelFromStats(n?: number | null, rSquared?: number | null): ConfLevel {
  const lowN = (n ?? 99) < 3, lowR = rSquared != null && rSquared < 0.75;
  if (lowN || lowR) return "niedrig";
  const okN = (n ?? 0) >= 6, okR = rSquared == null || rSquared >= 0.9;
  return okN && okR ? "hoch" : "mittel";
}

export default function ConfidenceBadge({ level, n, rSquared, title }: { level?: ConfLevel; n?: number | null; rSquared?: number | null; title?: string }) {
  const lv = level ?? levelFromStats(n, rSquared);
  const tip = title ?? ([n != null ? `n=${n}` : "", rSquared != null ? `R²=${rSquared}` : ""].filter(Boolean).join(" · ") || LABEL[lv]);
  return (
    <span title={tip} style={{
      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 600,
      color: COL[lv], border: `1px solid ${COL[lv]}`, borderRadius: 999, padding: "0 7px", lineHeight: 1.7, whiteSpace: "nowrap",
    }}>● {LABEL[lv]}</span>
  );
}
