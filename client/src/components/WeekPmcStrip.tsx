// Wochen-Header-PMC (v1.9.0, geteilt seit v1.10.0): Fitness (CTL) · Fatigue (ATL) · Form (TSB) + CTL-Ramp/Woche
// + Mini-CTL-Sparkline. Genutzt in Wochenplanung UND Wochenbericht. Quelle: analyze-week `pmc`.
import type { AnalyzeResult } from "../lib/api.ts";

export default function WeekPmcStrip({ pmc, tourAnchor }: { pmc: NonNullable<AnalyzeResult["pmc"]>; tourAnchor?: boolean }) {
  const tsbCol = pmc.tsb > 5 ? "var(--ok)" : pmc.tsb < -25 ? "var(--danger)" : pmc.tsb < -10 ? "var(--warn)" : "var(--form, #2563eb)";
  const rampCol = pmc.ramp == null ? "var(--muted)" : pmc.ramp > 8 ? "var(--warn)" : pmc.ramp < -3 ? "var(--info, #0891b2)" : "var(--ok)";
  const sp = pmc.spark ?? [];
  const W = 132, H = 30, P = 3;
  const ctls = sp.map((s) => s.ctl);
  const min = Math.min(...ctls), max = Math.max(...ctls), span = Math.max(1, max - min);
  const pts = sp.map((s, i) => `${(P + (i / Math.max(1, sp.length - 1)) * (W - 2 * P)).toFixed(1)},${(H - P - ((s.ctl - min) / span) * (H - 2 * P)).toFixed(1)}`).join(" ");
  const Stat = ({ label, val, col, title }: { label: string; val: string | number; col?: string; title?: string }) => (
    <div title={title} style={{ lineHeight: 1.1 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: col, fontVariantNumeric: "tabular-nums" }}>{val}</div>
      <div className="tiny muted">{label}</div>
    </div>
  );
  return (
    <div className="row" {...(tourAnchor ? { "data-tour": "week-pmc" } : {})} style={{ gap: 20, alignItems: "center", marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border-faint)", flexWrap: "wrap" }}>
      <Stat label="Fitness CTL" val={pmc.ctl} title="CTL — chronische Last (42-Tage-EWMA): deine Fitness/Belastbarkeit." />
      <Stat label="Fatigue ATL" val={pmc.atl} title="ATL — akute Last (7-Tage-EWMA): aktuelle Ermüdung." />
      <Stat label="Form TSB" val={`${pmc.tsb > 0 ? "+" : ""}${pmc.tsb}`} col={tsbCol} title="TSB = CTL − ATL: > +5 frisch · −10 bis −25 produktiv müde · < −25 Risiko." />
      <Stat label="CTL-Ramp/Wo" val={pmc.ramp != null ? `${pmc.ramp > 0 ? "+" : ""}${pmc.ramp}` : "—"} col={rampCol} title="Wöchentlicher CTL-Aufbau — > +8 zu steil (Verletzungsrisiko), 3–6 nachhaltig." />
      {sp.length > 1 && (
        <div style={{ marginLeft: "auto" }} title="CTL-Verlauf der letzten ~6 Wochen">
          <svg width={W} height={H} style={{ display: "block" }}>
            <polyline points={pts} fill="none" stroke="var(--primary, #2563eb)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
}
