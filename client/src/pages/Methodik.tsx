import { useEffect, useState } from "react";
import { api, type MethodExperiment, type Markers, type MethodEvaluationResult, type MethodInferenceResult, type MarkerDelta as MarkerDeltaT } from "../lib/api.ts";
import { paceStr, fmtDate } from "../lib/util.ts";
import MarkerDeltaChart from "../charts/MarkerDelta.tsx";
import ConfidenceBadge, { type ConfLevel } from "../components/ConfidenceBadge.tsx";
import ExpertDetails from "../components/ExpertDetails.tsx";
import OnboardingTour from "../components/OnboardingTour.tsx";
import Sparkline from "../components/Sparkline.tsx";
import { useSparkPref } from "../lib/sparkPref.ts";

// T15: Marker-Verläufe (Sparklines) aus bestehenden Trend-Endpoints. `dir` = Verbesserungsrichtung.
type SparkSeries = { data: (number | null)[]; dir: "up" | "down" };

const METHODIK_TOUR = [
  { title: "Methodik — was bei DIR wirkt", body: "Trainingslehre ist im Mittel erforscht, aber deine optimale Methode ist individuell. Diese Seite findet mit deinen eigenen Daten heraus, welches Training dir am meisten bringt (N-of-1)." },
  { title: "Die Marker oben", body: "Die Marker-Batterie zeigt deinen aktuellen Fitness-Status. Primär ist die Critical Speed; die übrigen (VDOT, Schwelle, Entkopplung, eff. VO2max, Polarisierungs-Index) stützen oder widersprechen." },
  { title: "Experimente anlegen", body: "Lege einen Methoden-Block an (z.B. 4 Wochen polarisiert). Die Seite vergleicht deine Marker vorher/nachher und gibt ein Verdikt mit Konfidenz." },
  { title: "Passive Inferenz", body: "Ganz automatisch: welches Wochen-Regime korrelierte bei dir mit Fortschritt? Wichtig: Korrelation, nicht Kausalität — kleine Stichproben sind als explorativ markiert." },
];

const METHODS = [
  { v: "polarized", l: "Polarisiert" },
  { v: "pyramidal", l: "Pyramidal" },
  { v: "threshold", l: "Threshold" },
  { v: "norwegian_double_threshold", l: "Norwegian Double-Threshold" },
  { v: "custom", l: "Eigene" },
];
// v1.11.1: Tooltip-Erklärungen je Marker (Hover) — macht klar, was die Zahl misst (Fenster/Einheit/Richtung).
const MARKER_HELP: Record<string, string> = {
  csPace: "Critical Speed — aktueller Schätzwert über das 14-Tage-Fenster, als Pace (s/km, kleiner = schneller). Nicht zu verwechseln mit „Δ CS\" in der Regime-Tabelle (Veränderung je Block).",
  vdot: "VDOT (≈ VO2max) aus deinen Bestzeiten, 14-Tage-Fenster. Höher = besser.",
  thresholdPace: "Schwellen-Pace (LT2) über das 14-Tage-Fenster. Kleiner = schneller.",
  thresholdHr: "Schwellen-Herzfrequenz (LT2) über das 14-Tage-Fenster.",
  decoupling: "Aerobe Entkopplung (Pace:HF-Drift) über das 14-Tage-Fenster. Kleiner = besser.",
  submaxEf: "Submaximaler Efficiency-Faktor (Tempo je Herzschlag), 14-Tage-Fenster. Höher = besser.",
  effVo2max: "Effektives VO2max aus dem Leistungs-/HF-Verhältnis, 14-Tage-Fenster. Höher = besser.",
  lactateAtPace: "Geschätztes Laktat an der Schwellen-Pace, 14-Tage-Fenster. Kleiner = besser.",
  pi: "Polarisierungs-Index der Zeit-in-Zone, 14-Tage-Fenster. ≥ 2,0 = polarisiert.",
};
const REGIME_LABEL: Record<string, string> = {
  polarized: "polarisiert", pyramidal: "pyramidal", threshold: "Threshold", norwegian: "Norwegian Double-Threshold", mixed: "gemischt",
};
const VERDICT_COLOR: Record<string, string> = { besser: "var(--ok)", schlechter: "var(--danger)", flach: "var(--warn)", unklar: "#94a3b8" };
const CONF_LABEL: Record<string, string> = { hoch: "hohe Konfidenz", mittel: "mittlere Konfidenz", niedrig: "niedrige Konfidenz" };

function fmtVal(key: string, v: number | null): string {
  if (v == null) return "—";
  if (key === "csPace" || key === "thresholdPace") return paceStr(v) + "/km";
  if (key === "thresholdHr") return `${Math.round(v)} bpm`;
  if (key === "decoupling") return `${v} %`;
  if (key === "lactateAtPace") return `${v} mmol`;
  return String(v);
}
function fmtDelta(d: MarkerDeltaT): string {
  if (d.delta == null) return "—";
  const sign = d.delta > 0 ? "+" : "";
  return `${sign}${d.delta}${d.unit ? " " + d.unit : ""}`;
}
function dirColor(dir: MarkerDeltaT["direction"]): string {
  return dir === "besser" ? "var(--ok)" : dir === "schlechter" ? "var(--danger)" : dir === "flach" ? "var(--warn)" : "#94a3b8";
}

export default function Methodik() {
  const [markers, setMarkers] = useState<Markers | null>(null);
  const [exps, setExps] = useState<MethodExperiment[]>([]);
  const [inference, setInference] = useState<MethodInferenceResult | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [evalR, setEvalR] = useState<MethodEvaluationResult | null>(null);
  const [form, setForm] = useState({ start_date: "", end_date: "", method: "polarized", label: "", notes: "" });
  const [sparks, setSparks] = useState<Record<string, SparkSeries>>({});
  const showSparks = useSparkPref();

  const reload = () => api.methodExperiments().then(setExps).catch(() => setExps([]));
  useEffect(() => {
    api.markers(undefined, 14).then(setMarkers).catch(() => setMarkers(null));
    api.methodInference().then(setInference).catch(() => setInference(null));
    // T15: Kern-Marker-Verläufe aus bestehenden Trend-Endpoints (kein neuer Endpoint).
    Promise.all([
      api.cpTrend(12).catch(() => null),
      api.fitnessTrend().catch(() => null),
      api.thresholdTrend(12).catch(() => null),
      api.decouplingTrend().catch(() => null),
      api.effVo2maxTrend().catch(() => null),
    ]).then(([cp, fit, thr, dec, ev]) => {
      const s: Record<string, SparkSeries> = {};
      if (cp?.points?.length) s.csPace = { data: cp.points.map((p) => p.cp), dir: "up" };
      if (fit?.points?.length) s.vdot = { data: fit.points.map((p) => p.vdot), dir: "up" };
      if (thr?.points?.length) s.thresholdPace = { data: thr.points.map((p) => p.thrPace), dir: "down" };
      if (dec?.length) s.decoupling = { data: dec.map((p) => p.decoupling), dir: "down" };
      if (ev?.points?.length) s.effVo2max = { data: ev.points.map((p) => p.est), dir: "up" };
      setSparks(s);
    }).catch(() => setSparks({}));
    reload();
  }, []);
  useEffect(() => {
    if (sel == null) { setEvalR(null); return; }
    api.methodEvaluation(sel, 14).then(setEvalR).catch(() => setEvalR(null));
  }, [sel]);

  const add = async () => {
    if (!form.start_date) return;
    await api.addMethodExperiment({ start_date: form.start_date, end_date: form.end_date || null, method: form.method, label: form.label || undefined, notes: form.notes || undefined });
    setForm({ start_date: "", end_date: "", method: "polarized", label: "", notes: "" });
    reload();
  };
  const del = async (id: number) => { await api.deleteMethodExperiment(id); if (sel === id) setSel(null); reload(); };

  const markerRows: { key: keyof Markers; label: string }[] = [
    { key: "csPace", label: "Critical Speed" },
    { key: "vdot", label: "VDOT" },
    { key: "thresholdPace", label: "Threshold-Pace" },
    { key: "thresholdHr", label: "Threshold-HF" },
    { key: "decoupling", label: "Aerobe Entkopplung" },
    { key: "submaxEf", label: "Submax-EF" },
    { key: "effVo2max", label: "Effective VO2max" },
    { key: "lactateAtPace", label: "Laktat @ Schwelle" },
    { key: "pi", label: "Polarisierungs-Index" },
  ];

  return (
    <div>
      <h2>Methodik <span className="tiny muted">— N-of-1 Methoden-Findung</span></h2>
      <p className="tiny muted" style={{ marginTop: -4, maxWidth: 720 }}>
        Findet mit deinen eigenen Daten heraus, welche Trainingsmethode dir den größten Benefit bringt.
        Primär-Marker ist die <strong>Critical Speed</strong>; alle Marker werden gezeigt. Wichtig:
        <strong> Korrelation, nicht Kausalität</strong> — kleine Stichproben sind als 'explorativ' markiert.
      </p>

      <OnboardingTour storageKey="tour-methodik" steps={METHODIK_TOUR} />

      {/* Einführung (ausklappbar, v1.8.0) */}
      <details className="card" open style={{ marginBottom: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>So nutzt du die Methodik-Seite</summary>
        <div style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.55 }}>
          <p style={{ marginTop: 0 }}><strong>Idee:</strong> Trainingslehre ist im Mittel erforscht — aber deine beste Methode ist individuell. Diese Seite vergleicht, wie deine Leistungsmarker auf verschiedene Trainings-Regimes reagieren.</p>
          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
            <li><strong>Marker</strong> (oben): aktueller Status — Critical Speed (primär), VDOT, Schwelle, Entkopplung, Submax-Effizienz, eff. VO2max, Laktat-an-Pace, Polarisierungs-Index.</li>
            <li><strong>Experimente</strong>: lege einen Methoden-Block an (z.B. 4 Wochen polarisiert) — die Seite vergleicht die Marker vorher/nachher und gibt ein Verdikt mit Konfidenz.</li>
            <li><strong>Passive Inferenz</strong>: erkennt automatisch, welches Wochen-Regime bei dir mit Fortschritt korrelierte (mit Confounder-Kontrolle).</li>
          </ul>
          <p style={{ marginBottom: 0 }}><strong>Wichtig:</strong> Es sind Korrelationen, keine Beweise — kleine Stichproben sind als 'explorativ' markiert. Nutze es als Entscheidungshilfe, nicht als Gesetz.</p>
        </div>
      </details>

      {/* Aktuelle Marker */}
      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Aktuelle Marker <span className="tiny muted">(14-Tage-Fenster{markers ? `, n=${markers.n} Läufe` : ""})</span></h3>
        {!markers ? <p className="muted">Lädt…</p> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
            {markerRows.map((m) => (
              <div key={m.key} title={MARKER_HELP[m.key as string]} style={{ border: "1px solid var(--border-faint)", borderRadius: 8, padding: "8px 10px" }}>
                <div className="tiny muted">{m.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtVal(m.key, markers[m.key] as number | null)}</div>
                {m.key === "csPace" && markers.csConfidence && <div className="tiny muted">{CONF_LABEL[markers.csConfidence]}</div>}
                {showSparks && sparks[m.key as string] && (
                  <div style={{ marginTop: 5 }}><Sparkline data={sparks[m.key as string].data} improveDir={sparks[m.key as string].dir} /></div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Passive Inferenz */}
      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Passive Inferenz <span className="tiny muted">— Regime ↔ Marker-Reaktion</span></h3>
        {!inference ? <p className="muted">Lädt…</p> : (
          <>
            <p style={{ marginTop: 0 }}>
              {inference.best
                ? <><strong style={{ color: "var(--ok)" }}>{REGIME_LABEL[inference.best]}</strong> korreliert bei dir am stärksten mit Fortschritt. </>
                : <span className="muted">Noch keine belastbare Methoden-Präferenz. </span>}
              <ConfidenceBadge level={inference.confidence as ConfLevel} title={`${CONF_LABEL[inference.confidence]} · Block-Auswertung (zusammenhängende Regime-Wochen)`} />
            </p>
            <p className="tiny muted" style={{ marginTop: -6 }}>{inference.note}</p>
            {inference.regimes.length > 0 && (
              <ExpertDetails summary={`Regime-Details (${inference.regimes.length}) — Korrelation, nicht Kausalität`}>
              <table className="table" style={{ width: "100%" }}>
                <thead><tr>
                  <th>Regime</th>
                  <th title="Spanne der zusammenhängenden Regime-Blöcke (frühester Block-Start bis spätestes Block-Ende).">Zeitraum</th>
                  <th title="Summe der Wochen in zusammenhängenden Blöcken dieses Regimes · N Bl. = Anzahl unabhängiger Blöcke.">Wochen</th>
                  <th title="Veränderung der Critical Speed vom Block-Start zum Block-Ende (s/km, negativ = schneller = besser). NICHT der CS-Absolutwert oben in den Markern.">Δ CS</th>
                  <th title="Veränderung des VDOT über den Block (positiv = besser).">Δ VDOT</th>
                  <th title="Belastbarkeit: folgt der Anzahl unabhängiger Blöcke, nicht der reinen Wochenzahl.">Konfidenz</th>
                </tr></thead>
                <tbody>
                  {inference.regimes.map((r) => (
                    <tr key={r.regime}>
                      <td><strong>{REGIME_LABEL[r.regime]}</strong></td>
                      <td className="tiny muted nowrap">{r.fromDate && r.toDate ? `${fmtDate(r.fromDate)} – ${fmtDate(r.toDate)}` : "—"}</td>
                      <td className="nowrap">{r.nWeeks}{r.nBlocks && r.nBlocks > 1 ? <span className="tiny muted"> · {r.nBlocks} Bl.</span> : null}</td>
                      <td style={{ color: r.csChange != null && r.csChange < 0 ? "var(--ok)" : r.csChange != null && r.csChange > 0 ? "var(--danger)" : undefined }}>
                        {r.csChange != null ? `${r.csChange > 0 ? "+" : ""}${r.csChange} s/km` : "—"}
                      </td>
                      <td>{r.vdotChange != null ? `${r.vdotChange > 0 ? "+" : ""}${r.vdotChange}` : "—"}</td>
                      <td className="tiny muted">{r.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* v1.11.1: Klartext, warum „CS" an mehreren Stellen verschiedene Zahlen zeigt (image-53). */}
              <details style={{ marginTop: 8, fontSize: 12 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--muted)" }}>Was bedeuten diese Werte?</summary>
                <ul style={{ margin: "6px 0 0 16px", padding: 0, lineHeight: 1.55, color: "var(--muted)" }}>
                  <li><strong>Critical Speed (Marker oben)</strong> — dein aktueller CS-<em>Absolutwert</em> über das 14-Tage-Fenster (Pace, kleiner = schneller).</li>
                  <li><strong>Δ CS (diese Tabelle)</strong> — die <em>Veränderung</em> der CS vom Block-Start zum Block-Ende (s/km, negativ = schneller geworden). Block = zusammenhängende Wochen desselben Regimes.</li>
                  <li><strong>CS vorher → nachher (Abschnitts-Auswertung)</strong> — zwei CS-Snapshots: 14-Tage-Fenster am Anfang vs. am Ende des Regime-Abschnitts.</li>
                  <li><strong>Wochen · N Bl.</strong> — Gesamtwochen des Regimes und Anzahl unabhängiger Blöcke; die Konfidenz folgt den Blöcken.</li>
                </ul>
                <div style={{ marginTop: 4, fontStyle: "italic" }}>Verschiedene Zahlen sind also gewollt: Absolutwert vs. Veränderung vs. Anfang/Ende. Es bleibt Korrelation, nicht Kausalität.</div>
              </details>
              {/* v1.10.0: Vorher→Nachher-Auswertung je erkanntem Regime-Abschnitt (image-20) — lazy beim Aufklappen. */}
              <div style={{ marginTop: 8 }}>
                <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 2 }}>Auswertung je Regime-Abschnitt <span style={{ fontWeight: 400 }}>— CS vorher → nachher · 14-Tage-Fenster</span></div>
                {inference.regimes.filter((r) => r.fromDate && r.toDate).map((r) => (
                  <RegimeEvaluation key={r.regime} label={REGIME_LABEL[r.regime]} from={r.fromDate!} to={r.toDate!} />
                ))}
              </div>
              </ExpertDetails>
            )}
          </>
        )}
      </div>

      {/* Geführte Experimente */}
      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Geführte Experimente</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
          <label className="tiny muted">Start<br /><input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
          <label className="tiny muted">Ende<br /><input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
          <label className="tiny muted">Methode<br />
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </label>
          <label className="tiny muted">Label<br /><input type="text" value={form.label} placeholder="z.B. Aufbau-Block 1" onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
          <button className="btn" onClick={add} disabled={!form.start_date}>+ Anlegen</button>
        </div>

        {exps.length === 0 ? <p className="muted" style={{ marginTop: 10 }}>Noch keine Experimente. Lege einen Methoden-Block an, um Vorher/Nachher zu vergleichen.</p> : (
          <table className="table" style={{ width: "100%", marginTop: 10 }}>
            <thead><tr><th>Zeitraum</th><th>Methode</th><th>Label</th><th></th></tr></thead>
            <tbody>
              {exps.map((e) => (
                <tr key={e.id} style={{ cursor: "pointer", background: sel === e.id ? "var(--surface2)" : undefined }} onClick={() => setSel(sel === e.id ? null : e.id)}>
                  <td>{e.start_date} – {e.end_date || "offen"}</td>
                  <td>{METHODS.find((m) => m.v === e.method)?.l || e.method}</td>
                  <td className="muted">{e.label || "—"}</td>
                  <td><button className="btn btn-ghost" onClick={(ev) => { ev.stopPropagation(); del(e.id); }}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Auswertung des gewählten Experiments */}
      {evalR && <div className="card" style={{ marginTop: 12 }}><EvaluationView ev={evalR} title="Auswertung" /></div>}
    </div>
  );
}

/** Wiederverwendbare Vorher→Nachher-Auswertung (Experiment ODER Regime-Abschnitt, v1.10.0). */
function EvaluationView({ ev, title }: { ev: MethodEvaluationResult; title?: string }) {
  return (
    <>
      {title && <h3 style={{ marginTop: 0 }}>{title} <span className="tiny muted">({ev.window}-Tage-Fenster, Vorher → Nachher)</span></h3>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span className="pill" style={{ background: VERDICT_COLOR[ev.evaluation.verdict], color: "#fff" }}>CS {ev.evaluation.verdict}</span>
        <span className="tiny muted">{CONF_LABEL[ev.evaluation.confidence]}{ev.evaluation.exploratory ? " · explorativ" : ""}</span>
      </div>
      <p className="tiny muted" style={{ marginTop: 0 }}>{ev.evaluation.note}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <table className="table" style={{ width: "100%" }}>
          <thead><tr><th>Marker</th><th>Vorher</th><th>Nachher</th><th>Δ</th><th>Richtung</th></tr></thead>
          <tbody>
            {ev.evaluation.deltas.map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td className="muted">{fmtVal(d.key, d.start)}</td>
                <td>{fmtVal(d.key, d.end)}</td>
                <td>{fmtDelta(d)}</td>
                <td style={{ color: dirColor(d.direction), fontWeight: 600 }}>{d.direction ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          <div className="tiny muted" style={{ marginBottom: 4 }}>Zeit-Verteilung Vorher/Nachher</div>
          <MarkerDeltaChart start={ev.start.dist} end={ev.end.dist} />
        </div>
      </div>
    </>
  );
}

/** Auswertung eines erkannten Regime-Abschnitts — lazy beim Aufklappen geladen (v1.10.0, image-20). */
function RegimeEvaluation({ label, from, to }: { label: string; from: string; to: string }) {
  const [ev, setEv] = useState<MethodEvaluationResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (e.currentTarget.open && !loaded) { setLoaded(true); api.rangeEvaluation(from, to, 14).then(setEv).catch(() => setEv(null)); }
  };
  return (
    <details onToggle={onToggle} style={{ borderLeft: "3px solid var(--border)", paddingLeft: 8, marginTop: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 12 }}><strong>{label}</strong> <span className="muted">{from} – {to}</span></summary>
      <div style={{ marginTop: 6 }}>{ev ? <EvaluationView ev={ev} /> : <span className="tiny muted">{loaded ? "Lädt…" : ""}</span>}</div>
    </details>
  );
}
