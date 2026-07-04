// „Was hilft dir?" — Synthese-Verdikt (Zeile 39, Deliverable A). Gesamturteil oben + drei einzeln aufklappbare
// Achsen-Deep-Dives (Dosis-Kanäle / Intensitäts-Verteilung / Qualitäts-Schwerpunkt), geschichtet nach
// beobachtet/korrelativ vs. kausal geprüft, mit Trial-Vorschlägen. Ehrlich: Korrelation ≠ Kausalität.
import { useEffect, useState } from "react";
import { api, type TrainingVerdict, type VerdictAxis, type VerdictFinding } from "../lib/api.ts";
import ConfidenceBadge, { type ConfLevel } from "./ConfidenceBadge.tsx";
import ExpertDetails from "./ExpertDetails.tsx";

const DIR_COLOR: Record<string, string> = { hilft: "var(--ok)", kostet: "var(--danger)", neutral: "var(--muted)" };
function ConfChip({ conf }: { conf: string }) {
  if (conf === "hoch" || conf === "mittel" || conf === "niedrig") return <ConfidenceBadge level={conf as ConfLevel} />;
  return <span className="tiny muted" style={{ border: "1px solid var(--muted)", borderRadius: 999, padding: "0 7px" }}>unzureichend</span>;
}
const fmtEffect = (f: VerdictFinding) => {
  if (f.effect == null) return "—";
  const s = `${f.effect > 0 ? "+" : ""}${f.effect}`;
  return `${s} ${f.unit}`;
};

const engineLabel = (e?: string | null) => (e === "pymc" ? "Bayes · PyMC" : e === "conjugate" ? "Bayes · Conjugate" : null);
function AxisDeepDive({ a }: { a: VerdictAxis }) {
  const eng = engineLabel(a.engine);
  return (
    <ExpertDetails summary={`${a.title} — ${a.best ? a.best.label : a.ranking.length ? "kein eindeutiges Ergebnis" : "noch offen"}${a.layer === "causal" ? " · kausal geprüft" : ""}${eng ? ` · ${eng}` : ""}`}>
      <p className="tiny muted" style={{ marginTop: 0 }}>{a.question}{eng ? ` · Statistik: ${eng} (Effekt = Posterior-Mittel, CI = 94%-HDI)` : ""}</p>
      <p className="tiny" style={{ margin: "2px 0 8px" }}>{a.insight}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {a.ranking.map((f) => (
          <div key={f.key} className="tiny" style={{ display: "flex", justifyContent: "space-between", gap: 8, opacity: f === a.best ? 1 : 0.85 }}>
            <span style={{ fontWeight: f === a.best ? 700 : 500 }}>
              {f.label}{f.causalProven ? " ✓kausal" : f.practical ? " ★" : ""}
            </span>
            <span style={{ color: DIR_COLOR[f.direction] }}>{fmtEffect(f)}{f.ciLow != null && f.ciHigh != null ? ` [${f.ciLow}, ${f.ciHigh}]` : ""} · {f.confidence}{f.pBetter != null ? ` · P(hilft) ${(f.pBetter * 100).toFixed(0)}%` : ""}{f.nBlocks != null ? ` · ${f.nBlocks} Bl.` : ""}{f.halfLifeWeeks != null ? ` · Ret ~${f.halfLifeWeeks.toFixed(1)}Wo` : ""}</span>
          </div>
        ))}
      </div>
      <p className="tiny muted" style={{ marginTop: 6, fontStyle: "italic" }}>
        ★ = praktisch belastbar · ✓kausal = durch einen N-of-1-Trial belegt · höher = baut mehr Fitness (Δ latente Fitness je +1 SD).
      </p>
    </ExpertDetails>
  );
}

export default function TrainingVerdictCard({ onGotoTrials, refreshKey }: { onGotoTrials?: () => void; refreshKey?: number }) {
  const [v, setV] = useState<TrainingVerdict | null>(null);
  const [loaded, setLoaded] = useState(false);
  // refreshKey bumpt, sobald die Dosis-Karte neu gerechnet hat → Gesamtbild lädt neu (nicht nur beim Mount).
  useEffect(() => { api.mlTrainingVerdict().then(setV).catch(() => setV(null)).finally(() => setLoaded(true)); }, [refreshKey]);
  if (!loaded) return null;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Was hilft dir? <span className="tiny muted">— Gesamtbild aus allen Modellen</span></h3>
        {v && <ConfChip conf={v.overallConfidence} />}
      </div>
      {!v ? <p className="muted tiny">Lädt…</p> : (
        <>
          <p style={{ margin: "8px 0 4px", fontWeight: 600, lineHeight: 1.4 }}>{v.headline}</p>
          <p className="tiny muted" style={{ marginTop: 0 }}>{v.note}</p>

          {/* Kurz-Übersicht der drei Achsen */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {v.axes.map((a) => (
              <div key={a.axis} style={{ flex: "1 1 180px", border: "1px solid var(--border-faint)", borderLeft: `4px solid ${a.best ? DIR_COLOR[a.best.direction] : "var(--muted)"}`, borderRadius: 8, padding: "6px 10px" }}>
                <div className="tiny muted" style={{ fontWeight: 600 }}>{a.title}{a.layer === "causal" ? " · kausal" : ""}{engineLabel(a.engine) ? " · Bayes" : ""}</div>
                <div className="tiny" style={{ fontWeight: 700, marginTop: 2 }}>{a.best ? a.best.label : a.ranking.length ? "kein klarer Reiz" : "noch offen"}</div>
                <div className="tiny muted">{a.best ? `${fmtEffect(a.best)} · ${a.confidence}` : a.ranking.length ? "berechnet · kein eindeutiges Ergebnis" : "sammelt Daten"}</div>
              </div>
            ))}
          </div>

          {/* Einzeln untersuchbare Deep-Dives */}
          <div style={{ marginTop: 10 }}>
            {v.axes.map((a) => <AxisDeepDive key={a.axis} a={a} />)}
          </div>

          {/* Trial-Vorschläge: starkes beobachtetes Signal ohne kausalen Beleg */}
          {v.trialSuggestions.length > 0 && (
            <div style={{ marginTop: 10, padding: "8px 10px", border: "1px solid var(--border-faint)", borderRadius: 8 }}>
              <div className="tiny" style={{ fontWeight: 700 }}>Kausal absichern?</div>
              {v.trialSuggestions.map((s, i) => (
                <p key={i} className="tiny muted" style={{ margin: "3px 0" }}>{s.reason}</p>
              ))}
              {onGotoTrials && <button className="btn btn-ghost tiny" style={{ marginTop: 4 }} onClick={onGotoTrials}>→ Zu den Experimenten</button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
