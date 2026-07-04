// Komponente B (BUILDPLAN §1/§6.3): Methoden-Schwerpunkt auswertbar machen. Zyklus-UNABHÄNGIG (für alle Profile).
// Einheitliches Vokabular = Block-Präferenz (availability.emphasis). Rein beratend, Korrelation nicht Kausalität.
// `embedded` = als Sub-Panel im Zyklus-Tab; sonst als eigene Karte im „Was wirkt?"-Tab (neben der Regime-Inferenz).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type EmphasisEvaluation, type Availability } from "../lib/api.ts";
import ConfidenceBadge from "./ConfidenceBadge.tsx";
import ExpertDetails from "./ExpertDetails.tsx";
import { useRegimeLatent, RegimeLatentButton, RegimeLatentResults } from "./RegimeLatentPanel.tsx";

const EMPHASIS_OPTS: { v: string; l: string }[] = [
  { v: "ausgewogen", l: "Ausgewogen" }, { v: "lt1", l: "LT1 (aerobe Schwelle)" }, { v: "schwelle", l: "Schwelle (LT2)" }, { v: "vo2", l: "VO2max" },
  { v: "berg", l: "Berg" }, { v: "norwegian", l: "Norwegian (sub-T)" }, { v: "fartlek", l: "Fartlek" },
];
const emphLabel = (k: string) => EMPHASIS_OPTS.find((o) => o.v === k)?.l ?? k;
const EMPH_LABELS: Record<string, string> = Object.fromEntries(EMPHASIS_OPTS.map((o) => [o.v, o.l]));
const csTxt = (v: number | null) => (v == null ? "—" : `${v <= 0 ? "" : "+"}${v} s/km CS`);

export default function MethodEmphasisCard({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const [av, setAv] = useState<Availability | null>(null);
  const [ev, setEv] = useState<EmphasisEvaluation | null>(null);
  const load = async () => {
    const [a, e] = await Promise.all([api.availability().catch(() => null), api.cycleEmphasisEvaluation().catch(() => null)]);
    setAv(a); setEv(e);
  };
  useEffect(() => { load(); }, []);
  const chosen = av?.emphasis ?? "ausgewogen";
  const ranking = ev?.observed.filter((g) => g.csChange != null) ?? [];
  const declared = ev?.declared?.filter((g) => g.csChange != null) ?? [];
  const latent = useRegimeLatent("emphasis");

  const body = (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {embedded
          ? <div className="tiny" style={{ fontWeight: 700 }}>Methoden-Schwerpunkt <span className="muted" style={{ fontWeight: 500 }}>— Komponente B · funktioniert für alle</span></div>
          : <h3 style={{ margin: 0 }}>Methoden-Schwerpunkt <span className="tiny muted">— welcher Qualitäts-Fokus wirkt bei dir?</span></h3>}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {ev && <ConfidenceBadge level={ev.confidence} />}
          <RegimeLatentButton busy={latent.busy} onClick={latent.run} data={latent.data} stamp={latent.stamp} />
        </div>
      </div>
      {/* Abgrenzung zur Regime-Inferenz — sonst verwechselbar. */}
      <p className="tiny muted" style={{ marginTop: embedded ? 4 : 6, marginBottom: 0, lineHeight: 1.5 }}>
        Ergänzt die <strong>Passive Inferenz (Regime)</strong>: Regime rankt deine gesamte <em>Intensitäts-Verteilung</em> (polarisiert/pyramidal/threshold …) — der robustere Messwert.
        Hier geht es um deinen <em>Qualitäts-Schwerpunkt</em> (welche harte Familie dominiert) — gröber, aber direkt handlungsrelevant (= dein Block-Knopf).
      </p>
      <div className="tiny muted" style={{ fontWeight: 600, marginTop: 8, marginBottom: 2 }}>Dein Block-Schwerpunkt <span style={{ fontWeight: 400 }}>(Analyse — eingestellt wird er im Coach):</span></div>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ border: "1px solid var(--border-faint)", borderRadius: 999, padding: "2px 10px", fontWeight: 700 }}>{emphLabel(chosen)}</span>
        {ev?.observedBest && ev.observedBest !== chosen && (
          <span className="tiny muted">Evidenz-Bester: <strong>{emphLabel(ev.observedBest)}</strong> ★</span>
        )}
        <button className="btn btn-ghost sm" style={{ marginLeft: "auto" }} onClick={() => navigate("/coach")} title="Der Schwerpunkt wird im Coach (Cockpit) eingestellt — hier ist nur die Analyse dazu.">→ im Coach einstellen</button>
      </div>
      {latent.data?.models && <RegimeLatentResults data={latent.data} labelMap={EMPH_LABELS} />}
      {ev && (
        <ExpertDetails summary={latent.data?.models ? "Sekundär: CS/VDOT-Auswertung (andere Metrik)" : "CS/VDOT-Auswertung (Schwerpunkt)"} defaultOpen={!latent.data?.models}>
        <div style={{ marginTop: 8 }}>
          <p className="tiny" style={{ margin: "0 0 4px" }}>{ev.verdict}</p>
          {ev.chosenStanding ? (
            <p className="tiny muted" style={{ margin: "0 0 6px" }}>Gewählt <strong>{emphLabel(ev.chosen)}</strong>: Rang {ev.chosenStanding.rank}/{ev.chosenStanding.of} · {csTxt(ev.chosenStanding.stat.csChange)} ({ev.chosenStanding.stat.nWeeks} Wochen).</p>
          ) : (
            <p className="tiny muted" style={{ margin: "0 0 6px" }}>Für <strong>{emphLabel(ev.chosen)}</strong> liegen noch keine auswertbaren Blöcke vor.</p>
          )}
          {ranking.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {ranking.map((g) => (
                <div key={g.group} className="tiny" style={{ display: "flex", justifyContent: "space-between", gap: 8, opacity: g.group === ev.chosen ? 1 : 0.8 }}>
                  <span style={{ fontWeight: g.group === ev.chosen ? 700 : 500 }}>{emphLabel(g.group)}{g.group === ev.observedBest ? " ★" : ""}</span>
                  <span className="muted">{csTxt(g.csChange)}{g.vdotChange != null ? ` · ${g.vdotChange > 0 ? "+" : ""}${g.vdotChange} VDOT` : ""} · n={g.nWeeks}{g.nBlocks > 1 ? `/${g.nBlocks} Bl.` : ""}</span>
                </div>
              ))}
            </div>
          )}
          {declared.length > 0 && (
            <p className="tiny muted" style={{ marginTop: 6 }}>Nach gewähltem Schwerpunkt (deklariert): {declared.map((g) => `${emphLabel(g.group)} ${csTxt(g.csChange)}`).join(" · ")}.</p>
          )}
          <p className="tiny muted" style={{ marginTop: 6, fontStyle: "italic" }}>Korrelation, nicht Kausalität · negativ = schneller. Primär oben: latente Fitness (höher = besser). „neu berechnen" (oben rechts) rechnet die Latenz-Auswertung.</p>
        </div>
        </ExpertDetails>
      )}
    </>
  );

  return embedded
    ? <div style={{ marginTop: 10, padding: "10px 12px", border: "1px solid var(--border-faint)", borderRadius: 8 }}>{body}</div>
    : <div className="card" style={{ marginTop: 12 }}>{body}</div>;
}
