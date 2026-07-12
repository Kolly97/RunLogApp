// „Was hilft dir?" — Synthese-Verdikt (Zeile 39, Deliverable A). Gesamturteil oben + drei einzeln aufklappbare
// Achsen-Deep-Dives (Dosis-Kanäle / Intensitäts-Verteilung / Qualitäts-Schwerpunkt), geschichtet nach
// beobachtet/korrelativ vs. kausal geprüft, mit Trial-Vorschlägen. Ehrlich: Korrelation ≠ Kausalität.
import { useEffect, useRef, useState } from "react";
import { api, type TrainingVerdict, type VerdictAxis, type VerdictFinding, type AnchoredMcid, type CyclePlanningSummary, type MlResearchShap, type MlSettings } from "../lib/api.ts";
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

/** Eigener Erklär-Block: „So ist deine Praxisschwelle (MCID) kalibriert." — macht die Verankerung an die eigene
 *  Messgenauigkeit transparent (was MCID ist, woran sie hängt, aktuelle Werte, Quelle). Einfache Sprache. */
function McidExplainer({ mcid }: { mcid: AnchoredMcid }) {
  const anchored = mcid.source === "anchored";
  return (
    <div style={{ marginTop: 10, padding: "8px 10px", border: "1px solid var(--border-faint)", borderRadius: 8 }}>
      <div className="tiny" style={{ fontWeight: 700 }}>
        Deine Praxisschwelle (MCID) <span className="muted" style={{ fontWeight: 500 }}>— {anchored ? "an deine Messgenauigkeit angepasst" : "Standard, bis genug Tests vorliegen"}</span>
      </div>
      <div className="tiny" style={{ marginTop: 3 }}>
        Echter Fortschritt zählt ab <strong>Δ {mcid.latent}</strong> (Fitness-Punkte, VO2-äquiv.) bzw. <strong>{mcid.cs} s/km</strong> Critical Speed.
      </div>
      <ExpertDetails summary="Mehr dazu — wie diese Schwelle entsteht">
        <p className="tiny" style={{ margin: "2px 0 6px" }}>
          Die MCID ist die kleinste Verbesserung, die als <em>echt</em> zählt — und nicht bloß Messrauschen ist. Sie
          ist an dein <strong>eigenes Messrauschen</strong> gekoppelt und nach unten am physiologischen Minimum
          (Test-Retest) begrenzt: ein Effekt gilt erst dann als „hilft", wenn er sicher über deiner Messstreuung liegt.
          Verrauschte oder dünne Daten heben die Schwelle, präzise Daten senken sie bis zum Minimum — nie darunter.
        </p>
        <p className="tiny muted" style={{ margin: 0 }}>
          {anchored && mcid.basisSd != null
            ? `Dein latentes Messrauschen liegt aktuell bei ~${mcid.basisSd} → Schwelle Δ ${mcid.latent}.`
            : "Noch zu wenige Tests für eine eigene Anpassung — es gilt das physiologische Minimum (Test-Retest)."}
          {` Kanal-/Verteilungs-Reize brauchen zusätzlich ≥ ${mcid.dosePerSd} Fitness je +1 SD Last, um als steuerungsrelevant zu gelten.`}
        </p>
      </ExpertDetails>
    </div>
  );
}

/** 4. Panel: der Zyklus als zusammengefasste Antwort — aktuelle Phase, was er je Phase favorisiert (gemessen/
 *  Hypothese) und ob er den Plan steuert. Nur bei Consent. Ehrlich gelabelt (individuell/beobachtet). */
const CYCLE_EMPH_LABEL: Record<string, string> = { vo2: "VO2max", schwelle: "Schwelle", berg: "Berg", norwegian: "Norwegian", fartlek: "Fartlek" };
function CyclePanel({ refreshKey }: { refreshKey?: number }) {
  const [s, setS] = useState<CyclePlanningSummary | null>(null);
  useEffect(() => { api.cycleStatus().then((r) => setS(r.needsConsent ? null : (r.planningSummary ?? null))).catch(() => setS(null)); }, [refreshKey]);
  if (!s) return null;
  const favored = s.perPhase.filter((p) => p.emphasis || p.soften);
  const status = s.steering ? "steuert den Plan" : s.adaptiveEnabled ? "sammelt noch Daten" : "Anzeige (Steuerung aus)";
  return (
    <div style={{ marginTop: 10, padding: "8px 10px", border: "1px solid var(--border-faint)", borderRadius: 8 }}>
      <div className="tiny" style={{ fontWeight: 700 }}>
        Zyklus-Phase <span className="muted" style={{ fontWeight: 500 }}>— {s.currentLabel ?? "keine natürliche Phase"} · {status}</span>
      </div>
      {favored.length ? (
        <div className="tiny" style={{ marginTop: 3, display: "flex", flexDirection: "column", gap: 2 }}>
          {favored.map((p) => (
            <div key={p.phase} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{p.label}</span>
              <span style={{ color: p.tier === "measured" ? "var(--ok)" : "var(--muted)" }}>
                {p.emphasis ? `→ ${CYCLE_EMPH_LABEL[p.emphasis] ?? p.emphasis}` : "→ locker/aerob"}{p.tier === "measured" ? " (gemessen)" : " (Hypothese)"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="tiny muted" style={{ margin: "3px 0 0" }}>Noch kein belastbarer Phasen-Effekt — der Plan bleibt phasen-neutral (ehrliches Ergebnis, deckt sich mit der Gruppen-Evidenz).</p>
      )}
      <p className="tiny muted" style={{ margin: "5px 0 0", fontStyle: "italic" }}>
        Individuell/beobachtet · gemessen schlägt Hypothese · Periodisierung, Erholung &amp; Gesundheit übersteuern immer.
      </p>
    </div>
  );
}

// v2.8.0 (Item 3): Research-Mode (LightGBM+SHAP) — nichtlineare Elaboration auf denselben Wochen-Daten PLUS
// Session-Feedback (RPE/gefühlt-vs-erwartet/Readiness). REIN explorativ, NIE Verdikt (wie exploratory.ts) — zeigt
// global (großes Bild) UND lokal (warum diese Woche) aus demselben Modell-Lauf. Gated hinter research_mode_enabled,
// darum unsichtbar für Standard-Nutzer. Läuft ggf. Stunden im Hintergrund (kein Checkpoint) — Polling gibt daher
// nie auf, solange der Lauf noch "running" meldet.
const RESEARCH_FEATURE_LABEL: Record<string, string> = {
  aerob: "Aerobe CTL", threshold: "Schwellen-CTL", vo2: "VO2max-CTL", total: "Gesamt-CTL",
  rpe_mean: "Ø RPE (Woche)", felt_mean: "Ø gefühlt vs. erwartet", readiness_mean: "Ø Readiness",
  vo2_x_readiness: "VO2-Last × Readiness (Interaktion)",
};
const RESEARCH_POLL_MS = 8000;
function ResearchShapPanel() {
  const [rs, setRs] = useState<MlResearchShap | null>(null);
  const [settings, setSettings] = useState<MlSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [selDate, setSelDate] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const load = () => {
    api.mlResearchShap().then(setRs).catch(() => setRs(null));
    api.mlSettings().then(setSettings).catch(() => {});
  };
  useEffect(() => {
    load();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []);

  // Einzige Stelle, an der man Research-Mode überhaupt einschalten kann (kein separater Settings-Zugang) —
  // die Sektion muss sich also selbst freischalten können, statt bei "aus" komplett zu verschwinden.
  const enableResearchMode = async () => {
    if (!settings) return;
    setEnabling(true);
    try {
      const updated = { ...settings, research_mode_enabled: 1 };
      await api.mlSaveSettings(updated);
      setSettings(updated);
      load();
    } finally {
      setEnabling(false);
    }
  };

  const startPoll = () => {
    if (pollRef.current) return;
    pollRef.current = window.setInterval(async () => {
      const r = await api.mlResearchShap().catch(() => null);
      if (r) setRs(r);
      if (!r || r.run?.status !== "running") {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setBusy(false);
      }
    }, RESEARCH_POLL_MS);
  };
  const recompute = async () => {
    setBusy(true);
    try { await api.mlRecompute("research_shap"); startPoll(); } catch { setBusy(false); }
  };

  if (!rs) return null; // lädt noch
  if (!rs.enabled) {
    return (
      <div style={{ marginTop: 10, padding: "8px 10px", border: "1px solid var(--border-faint)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span className="tiny muted">Research-Mode (SHAP) — zusätzliche, experimentelle Analyse-Ebene (nichtlineares Modell + deine Rückmeldungen). Standardmäßig aus, reine Elaboration, kein Verdikt.</span>
        <button className="btn btn-ghost tiny" onClick={enableResearchMode} disabled={enabling || !settings}>
          {enabling ? "…" : "aktivieren"}
        </button>
      </div>
    );
  }
  const running = busy || rs.run?.status === "running";
  const suff = rs.sufficiency;
  const local = selDate ? rs.local?.find((l) => l.date === selDate) ?? null : (rs.local?.length ? rs.local[rs.local.length - 1] : null);
  const localSorted = local ? Object.entries(local.shap).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])) : [];
  const maxGlobal = Math.max(1e-9, ...(rs.globalImportance ?? []).map((g) => g.importance));

  return (
    <ExpertDetails summary={`Research-Mode (SHAP) — ${rs.engineUnavailable ? "Engine/Sidecar nicht verfügbar" : !rs.available ? (suff && !suff.ok ? "noch zu wenig Daten" : "noch nicht berechnet") : rs.plausible ? "Modell passt" : "schwacher Fit"}`}>
      <p className="tiny muted" style={{ marginTop: 0 }}>
        Nichtlineares Baum-Modell (LightGBM) auf denselben Wochen-Daten <strong>plus</strong> Session-Feedback (RPE,
        gefühlt-vs-erwartet, Readiness) — findet auch Zusammenhänge, die das lineare Dosis-Modell oben nicht sieht.
        <strong> Reine Hypothesen, kein Verdikt</strong> — nichts hier fließt in die Trainingssteuerung ein.
      </p>
      {suff && !suff.ok ? (
        <p className="tiny muted" style={{ margin: "4px 0" }}>
          Noch zu wenig Daten für eine verlässliche Analyse: {suff.weeks}/{suff.minWeeks} Wochen, {suff.feedbackCount}/{suff.minFeedback} Feedback-Einträge.
        </p>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
          <button className="btn btn-ghost tiny" onClick={recompute} disabled={running}>
            {running ? "rechnet… (kann Stunden dauern)" : rs.available ? "neu berechnen" : "berechnen"}
          </button>
          {rs.available && <span className="tiny muted">Engine: {rs.engine ?? "?"} · {rs.nWeeks} Wochen{rs.cvR2 != null ? ` · Cross-Val-R² ${rs.cvR2.toFixed(2)}` : ""}</span>}
        </div>
      )}
      {rs.engineUnavailable && (
        <p className="tiny" style={{ margin: "0 0 6px", color: "var(--warn)" }}>
          ⚠ Genug Daten vorhanden, aber die Rechen-Engine (Python-Sidecar mit LightGBM/SHAP) ist auf diesem System nicht
          verfügbar — im gepackten App-Build ist sie enthalten; in einer frischen Entwickler-Umgebung ggf. neu installieren.
          Solange wird nichts berechnet.
        </p>
      )}
      {rs.available && !rs.plausible && (
        <p className="tiny" style={{ margin: "0 0 6px", color: "var(--warn)" }}>
          ⚠ Modell passt schlecht auf deine Daten (Cross-Val-R² {rs.cvR2 != null ? rs.cvR2.toFixed(2) : "?"}) — Vorsicht bei der Interpretation, eher als grobe Richtung lesen.
        </p>
      )}
      {rs.available && (rs.globalImportance?.length ?? 0) > 0 && (
        <>
          <div className="tiny" style={{ fontWeight: 700, marginTop: 6 }}>Global — was erklärt die Woche-zu-Woche-Schwankung am meisten?</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 3 }}>
            {rs.globalImportance!.map((g) => (
              <div key={g.feature} className="tiny" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ flex: "0 0 150px" }}>{RESEARCH_FEATURE_LABEL[g.feature] ?? g.feature}</span>
                <span style={{ flex: 1, height: 6, background: "var(--border-faint)", borderRadius: 3, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${Math.max(2, (g.importance / maxGlobal) * 100)}%`, background: "var(--accent, #0ea5e9)" }} />
                </span>
                <span className="tiny muted" style={{ flex: "0 0 46px", textAlign: "right" }}>{g.importance.toFixed(2)}</span>
              </div>
            ))}
          </div>

          <div className="tiny" style={{ fontWeight: 700, marginTop: 10 }}>Lokal — warum war diese Woche gut/schlecht?</div>
          {rs.local && rs.local.length > 0 && (
            <select className="tiny" value={local?.date ?? ""} onChange={(e) => setSelDate(e.target.value)} style={{ margin: "3px 0" }}>
              {rs.local.map((l) => <option key={l.date ?? ""} value={l.date ?? ""}>{l.date ?? "?"}</option>)}
            </select>
          )}
          {local && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 3 }}>
              <div className="tiny muted">Modell-Vorhersage: {local.prediction.toFixed(2)} · Basiswert {rs.baseValue != null ? rs.baseValue.toFixed(2) : "?"}</div>
              {localSorted.map(([f, val]) => (
                <div key={f} className="tiny" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>{RESEARCH_FEATURE_LABEL[f] ?? f}</span>
                  <span style={{ color: val >= 0 ? "var(--ok)" : "var(--danger)" }}>{val >= 0 ? "+" : ""}{val.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
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
    <div className="card" data-tour="verdict" style={{ marginTop: 12 }}>
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

          {/* 4. Antwort: Zyklus-Phase (nur bei Consent) — was er favorisiert + ob er steuert */}
          <CyclePanel refreshKey={refreshKey} />

          {/* Eigener Erklär-Block: Praxisschwelle (MCID) an die eigene Messgenauigkeit verankert */}
          {v.mcid && <McidExplainer mcid={v.mcid} />}

          {/* Research-Mode (Item 3): gated hinter research_mode_enabled, rendert sich bei "aus" selbst weg */}
          <ResearchShapPanel />
        </>
      )}
    </div>
  );
}
