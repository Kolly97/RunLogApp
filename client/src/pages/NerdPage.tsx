// v2.8.0 (Item 4) — versteckte „Nerd-Seite": zeigt die internen Rohdaten-Diagramme und die Methodik/Mathematik
// der ML-Engines, die sonst nirgends in der App sichtbar sind — nicht nur die abstrakten Kennzahlen, sondern die
// Daten, aus denen sie entstehen. Read-only, keine Recompute-Buttons (Trigger bleiben an ihren normalen Stellen).
// Zugriff NUR über die versteckte Tastenkombi (NerdKeybind.tsx), bewusst nicht in der Navigation gelistet.
import { useEffect, useState } from "react";
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from "recharts";
import { TOOLTIP_STYLE } from "../lib/chartTheme.ts";
import { fmtDate } from "../lib/util.ts";
import {
  api, type MlLatentPoint, type MlIndicator, type MlEffects, type RegimeLatentResult, type CycleEvidence,
  type MlProspectiveState, type MlProspectiveBlock, type MlWhatIfPoint,
} from "../lib/api.ts";
import ForestPlot from "../charts/ForestPlot.tsx";
import TrainingVerdictCard from "../components/TrainingVerdictCard.tsx";

const fmt = (v: number | null | undefined, d = 2): string => (v == null || Number.isNaN(v) ? "—" : v.toFixed(d));

/** Kleinste-Quadrate-Steigung (Einheiten/Woche) — rein zur Anzeige, keine neue Engine. */
function linearSlopePerWeek(points: MlLatentPoint[]): number | null {
  if (points.length < 3) return null;
  const t0 = Date.parse(points[0].date + "T00:00:00Z");
  const xs = points.map((p) => (Date.parse(p.date + "T00:00:00Z") - t0) / (7 * 86400000));
  const ys = points.map((p) => p.value);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) * (xs[i] - mx); }
  return den > 0 ? num / den : null;
}

function Panel({ n, title, subtitle, children }: { n: number; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="tiny muted" style={{ fontWeight: 700 }}>Panel {n}</div>
      <h2 style={{ margin: "2px 0 2px" }}>{title}</h2>
      <p className="tiny muted" style={{ marginTop: 0, marginBottom: 10 }}>{subtitle}</p>
      {children}
    </div>
  );
}

/** Klarer abgesetzter Methodik/Mathematik-Block — die Formel/das Verfahren hinter dem Panel, nicht nur das Ergebnis. */
function Methodik({ children }: { children: React.ReactNode }) {
  return (
    <div className="tiny" style={{ marginTop: 10, padding: "8px 10px", background: "var(--surface2)", borderRadius: 8, lineHeight: 1.5 }}>
      <strong>Methodik: </strong>{children}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { lab_vo2max: "Labor-VO2max", race_vdot: "Race-VDOT", eff_vo2max: "eff. VO2max" };
const KIND_COLOR: Record<string, string> = { lab_vo2max: "#22c55e", race_vdot: "#f59e0b", eff_vo2max: "#94a3b8" };

/** L2: geglättete Kurve + Band + rohe Quellpunkte (vor der Kalman-Fusion) überlagert, farbig je Quelle. */
function L2SourcesChart({ points, sources }: { points: MlLatentPoint[]; sources: MlIndicator[] }) {
  if (points.length < 2) return <p className="tiny muted">Noch zu wenig Daten.</p>;
  const curve = points.map((p) => ({ t: Date.parse(p.date), value: p.value, band: [p.value - p.sd, p.value + p.sd] as [number, number] }));
  const allVals = [...points.flatMap((p) => [p.value - p.sd, p.value + p.sd]), ...sources.map((s) => s.value)];
  const yLo = Math.floor(Math.min(...allVals) - 1), yHi = Math.ceil(Math.max(...allVals) + 1);
  const tMin = Math.min(...curve.map((c) => c.t), ...sources.map((s) => Date.parse(s.date)));
  const tMax = Math.max(...curve.map((c) => c.t), ...sources.map((s) => Date.parse(s.date)));
  const kinds = [...new Set(sources.map((s) => s.kind))];
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={curve} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <defs>
          <linearGradient id="l2Fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.16} /><stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="t" type="number" domain={[tMin, tMax]} tickFormatter={(t) => fmtDate(new Date(t).toISOString().slice(0, 10))} tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
        <YAxis domain={[yLo, yHi]} width={34} tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
        <Tooltip labelFormatter={(t) => fmtDate(new Date(t as number).toISOString().slice(0, 10))} formatter={(v: number, n: string) => [typeof v === "number" ? v.toFixed(1) : v, n]} contentStyle={TOOLTIP_STYLE} />
        <Area type="monotone" dataKey="band" stroke="none" fill="url(#l2Fill)" connectNulls activeDot={false} tooltipType="none" legendType="none" />
        <Line type="monotone" dataKey="value" name="Latente Fitness (geglättet)" stroke="#0ea5e9" strokeWidth={2} dot={false} connectNulls />
        {kinds.map((k) => (
          <Scatter key={k} name={KIND_LABEL[k] ?? k} data={sources.filter((s) => s.kind === k).map((s) => ({ t: Date.parse(s.date), value: s.value }))} fill={KIND_COLOR[k] ?? "#888"} shape="circle" />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Generische Band-Trajektorie (Was-wäre-wenn / Dosis-Wirkungs-Projektion) — Mittelwert + Unsicherheitsband über Wochen. */
function TrajectoryChart({ trajectory, color = "#8b5cf6" }: { trajectory: MlWhatIfPoint[]; color?: string }) {
  if (!trajectory.length) return null;
  const data = trajectory.map((p) => ({ w: p.w, mean: p.mean, band: [p.lo, p.hi] as [number, number] }));
  const ys = trajectory.flatMap((p) => [p.lo, p.hi]);
  const yLo = Math.floor(Math.min(0, ...ys) * 10) / 10, yHi = Math.ceil(Math.max(...ys) * 10) / 10;
  return (
    <ResponsiveContainer width="100%" height={110}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="w" tick={{ fontSize: 10, fill: "var(--chart-tick)" }} label={{ value: "Wochen", position: "insideBottom", fontSize: 10, fill: "var(--chart-tick)", dy: 8 }} />
        <YAxis domain={[yLo, yHi]} width={30} tick={{ fontSize: 10, fill: "var(--chart-tick)" }} />
        <Tooltip formatter={(v: number, n: string) => [typeof v === "number" ? v.toFixed(2) : v, n]} contentStyle={TOOLTIP_STYLE} />
        <Area type="monotone" dataKey="band" stroke="none" fill={color} fillOpacity={0.15} tooltipType="none" legendType="none" />
        <Line type="monotone" dataKey="mean" stroke={color} strokeWidth={2} dot={false} name="erwarteter Effekt" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Exponentieller Zerfallskern je Kanal: normierte Wirkung exp(−t/τ) über die Wochen seit dem Trainingsreiz. */
function KernelChart({ channels }: { channels: { channel: string; tau: number }[] }) {
  const valid = channels.filter((c) => c.tau > 0);
  if (!valid.length) return <p className="tiny muted">Kein τ (Zerfallszeit) verfügbar.</p>;
  const horizon = Math.min(30, Math.ceil(Math.max(...valid.map((c) => c.tau)) * 3));
  const data = Array.from({ length: horizon + 1 }, (_, w) => {
    const row: Record<string, number> = { w };
    for (const c of valid) row[c.channel] = Math.exp(-w / c.tau);
    return row;
  });
  const colors = ["#0ea5e9", "#f59e0b", "#22c55e", "#ef4444", "#8b5cf6"];
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="w" tick={{ fontSize: 10, fill: "var(--chart-tick)" }} label={{ value: "Wochen seit dem Reiz", position: "insideBottom", fontSize: 10, fill: "var(--chart-tick)", dy: 8 }} />
        <YAxis domain={[0, 1]} width={28} tick={{ fontSize: 10, fill: "var(--chart-tick)" }} />
        <Tooltip formatter={(v: number) => (typeof v === "number" ? v.toFixed(2) : v)} contentStyle={TOOLTIP_STYLE} />
        {valid.map((c, i) => <Line key={c.channel} type="monotone" dataKey={c.channel} stroke={colors[i % colors.length]} strokeWidth={2} dot={false} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Rohe wöchentliche Exposure je Regime (EWMA-Anteil) + Outcome (latente Fitness) auf zweiter Achse. */
function ExposureChart({ labels, X, y, dates }: { labels: string[]; X: number[][]; y: number[]; dates: string[] }) {
  const colors = ["#0ea5e9", "#f59e0b", "#22c55e", "#ef4444", "#8b5cf6"];
  const data = X.map((row, i) => {
    const r: Record<string, number | string> = { date: dates[i] ?? i, y: y[i] };
    labels.forEach((l, j) => { r[l] = row[j]; });
    return r;
  });
  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} margin={{ top: 8, right: 30, left: 4, bottom: 4 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={(d) => (typeof d === "string" && d.includes("-") ? fmtDate(d) : String(d))} minTickGap={28} tick={{ fontSize: 10, fill: "var(--chart-tick)" }} />
        <YAxis yAxisId="exp" width={34} tick={{ fontSize: 10, fill: "var(--chart-tick)" }} label={{ value: "Exposure-Anteil", angle: -90, position: "insideLeft", fontSize: 10, fill: "var(--chart-tick)" }} />
        <YAxis yAxisId="fit" orientation="right" width={34} tick={{ fontSize: 10, fill: "var(--chart-tick)" }} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, n: string) => [typeof v === "number" ? v.toFixed(2) : v, n]} />
        {labels.map((l, i) => <Line key={l} yAxisId="exp" type="monotone" dataKey={l} stroke={colors[i % colors.length]} strokeWidth={1.5} dot={false} />)}
        <Line yAxisId="fit" type="monotone" dataKey="y" stroke="var(--ink)" strokeWidth={2} strokeDasharray="4 3" dot={false} name="latente Fitness" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Schlichter Forest-Plot für Regime-Zellen (β + 95%-CI) — eigene, kleinere Variante ohne MCID-Band/FDR-Badge. */
function MiniForest({ rows }: { rows: { label: string; value: number; lo: number; hi: number }[] }) {
  if (!rows.length) return null;
  const lo = Math.min(0, ...rows.map((r) => r.lo)), hi = Math.max(0, ...rows.map((r) => r.hi));
  const pad = (hi - lo) * 0.1 || 0.1;
  const xMin = lo - pad, xMax = hi + pad;
  const pos = (v: number) => ((v - xMin) / (xMax - xMin)) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r) => {
        const c = r.lo > 0 ? "var(--ok)" : r.hi < 0 ? "var(--danger)" : "var(--muted)";
        return (
          <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 100, fontSize: 12, textAlign: "right" }}>{r.label}</div>
            <div style={{ position: "relative", flex: 1, height: 18 }}>
              <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pos(0)}%`, width: 1, background: "var(--border)" }} />
              <div style={{ position: "absolute", top: "50%", left: `${pos(r.lo)}%`, width: `${pos(r.hi) - pos(r.lo)}%`, height: 2, background: c, transform: "translateY(-50%)" }} />
              <div style={{ position: "absolute", top: "50%", left: `${pos(r.value)}%`, width: 8, height: 8, borderRadius: 999, background: c, transform: "translate(-50%,-50%)" }} />
            </div>
            <div style={{ width: 60, fontSize: 11, textAlign: "right", fontWeight: 700, color: c }}>{r.value >= 0 ? "+" : ""}{r.value.toFixed(2)}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Phase×Reiz-Heatmap: Zellfarbe = roher Effekt (grün/rot), Deckkraft = Posterior-Gewicht (mehr eigene Daten = deckender). */
function PhaseStimulusHeatmap({ rows }: { rows: CycleEvidence[] }) {
  const phases = [...new Set(rows.map((r) => r.phase))];
  const stimuli = [...new Set(rows.map((r) => r.stimulus))];
  const cell = (phase: string, stim: string) => rows.find((r) => r.phase === phase && r.stimulus === stim);
  const maxAbs = Math.max(0.5, ...rows.map((r) => Math.abs(r.effect_size ?? 0)));
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="tiny" style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr><th></th>{stimuli.map((s) => <th key={s} style={{ padding: 4 }}>{s}</th>)}</tr></thead>
        <tbody>
          {phases.map((ph) => (
            <tr key={ph}>
              <td style={{ fontWeight: 700, padding: 4, whiteSpace: "nowrap" }}>{ph}</td>
              {stimuli.map((s) => {
                const c = cell(ph, s);
                const eff = c?.effect_size ?? 0;
                const alpha = c ? 0.15 + 0.65 * Math.min(1, c.posterior_weight) : 0;
                const bg = c ? (eff >= 0 ? `rgba(34,197,94,${alpha})` : `rgba(239,68,68,${alpha})`) : "transparent";
                return (
                  <td key={s} title={c ? `${ph}×${s}: Effekt ${fmt(c.effect_size)} [${fmt(c.ci_low)}, ${fmt(c.ci_high)}] · Posterior-Gewicht ${fmt(c.posterior_weight, 2)} · n=${c.n_sessions} · ${c.confidence}` : "keine Daten"}
                    style={{ padding: 6, textAlign: "center", background: bg, minWidth: 64 }}>
                    {c ? fmt(c.effect_size) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tiny muted" style={{ marginTop: 4 }}>Grün = positiver Effekt, Rot = negativer · Deckkraft = Posterior-Gewicht (blass = überwiegend Prior, kräftig = überwiegend eigene Daten) · max |Effekt| in dieser Ansicht: {fmt(maxAbs, 2)}</div>
    </div>
  );
}

/** Paar-Plot der prospektiven Blöcke: je Paar Arm-A- vs. Arm-B-Outcome, verbunden — die Rohdaten hinter θ. */
function ProspectivePairChart({ blocks }: { blocks: MlProspectiveBlock[] }) {
  const byPair = new Map<number, { a?: number; b?: number }>();
  for (const b of blocks) {
    if (b.excluded || b.outcome == null) continue;
    const e = byPair.get(b.pair) ?? {};
    if (b.arm === "A") e.a = b.outcome; else e.b = b.outcome;
    byPair.set(b.pair, e);
  }
  const pairs = [...byPair.entries()].filter(([, v]) => v.a != null && v.b != null).sort((x, y) => x[0] - y[0]);
  if (!pairs.length) return <p className="tiny muted">Noch keine vollständigen Paare.</p>;
  const data = pairs.map(([pair, v]) => ({ pair, a: v.a!, b: v.b!, diff: v.b! - v.a! }));
  return (
    <ResponsiveContainer width="100%" height={140}>
      <ComposedChart data={data} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="pair" tick={{ fontSize: 10, fill: "var(--chart-tick)" }} label={{ value: "Paar #", position: "insideBottom", fontSize: 10, fill: "var(--chart-tick)", dy: 8 }} />
        <YAxis width={34} tick={{ fontSize: 10, fill: "var(--chart-tick)" }} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, n: string) => [typeof v === "number" ? v.toFixed(2) : v, n === "a" ? "Arm A" : n === "b" ? "Arm B" : n]} />
        <Bar dataKey="a" name="Arm A" fill="#0ea5e9" barSize={10} />
        <Bar dataKey="b" name="Arm B" fill="#f59e0b" barSize={10} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export default function NerdPage() {
  const [latent, setLatent] = useState<MlLatentPoint[] | null>(null);
  const [sources, setSources] = useState<MlIndicator[] | null>(null);
  const [effects, setEffects] = useState<MlEffects | null>(null);
  const [regime, setRegime] = useState<RegimeLatentResult | null>(null);
  const [cycleEv, setCycleEv] = useState<CycleEvidence[] | "no-consent" | null>(null);
  const [prospective, setProspective] = useState<MlProspectiveState | null>(null);

  useEffect(() => {
    api.mlLatentFitness().then(setLatent).catch(() => setLatent([]));
    api.mlLatentFitnessSources().then(setSources).catch(() => setSources([]));
    api.mlEffects().then(setEffects).catch(() => setEffects(null));
    api.mlRegimeLatent("regime").then(setRegime).catch(() => setRegime(null));
    api.cycleEvidence().then(setCycleEv).catch(() => setCycleEv("no-consent"));
    api.mlProspective().then(setProspective).catch(() => setProspective(null));
  }, []);

  const slope = latent ? linearSlopePerWeek(latent) : null;
  const mediator = effects?.mediator ?? [];
  const composition = effects?.composition ?? [];
  const ladder = effects?.meta?.ladder ?? [];
  const diag = effects?.meta?.diagnostics;
  const bayesChannels = effects?.meta?.bayes?.channels ?? [];
  const regimeCells = regime?.models?.mediator ?? [];

  return (
    <div>
      <h1>🤓 Nerd-Seite</h1>
      <p className="tiny muted" style={{ marginBottom: 14 }}>
        Rohdaten-Diagramme + Methodik hinter den ML-Engines — nicht nur die Kennzahlen, sondern was zu ihnen führt.
        Rein informativ (read-only), löst keine Neuberechnung aus. Prognose ≠ Messwert, Korrelation ≠ Kausalität.
      </p>

      <Panel n={1} title="L2 — Latente Fitness" subtitle="Geglättete Fitness-Trajektorie + die rohen Quellpunkte, aus denen sie entsteht.">
        {latent == null || sources == null ? <p className="tiny muted">Lädt…</p> : (
          <>
            <L2SourcesChart points={latent} sources={sources} />
            <div className="tiny muted" style={{ marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
              {Object.entries(KIND_LABEL).map(([k, l]) => (
                <span key={k}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: KIND_COLOR[k], marginRight: 4 }} />{l}</span>
              ))}
              <span>· {latent.length} geglättete Punkte · {sources.length} Rohpunkte · Trend: {slope != null ? `${slope >= 0 ? "+" : ""}${fmt(slope, 3)}/Woche` : "zu wenig Daten"}</span>
            </div>
            <Methodik>
              Lokaler-linearer-Trend-Kalman-Filter (Zustand = [Level, Steigung]) + RTS-Smoother (rückwärts geglättet).
              Jede Quelle wird zuerst z-standardisiert (eigener Mittelwert/SD je Quelle), dann mit einer FESTEN
              Beobachtungsvarianz R gewichtet: Labor-VO2max R=0.05 (am vertrauenswürdigsten, engster Fit), Race-VDOT
              R=0.3, eff. VO2max (aus Aktivitäts-Pace/HF) R=0.8 (am unsichersten). Kleineres R = die Kalman-Verstärkung
              zieht die Kurve stärker zu diesem Punkt. Prozessrauschen σ_level=0.08, σ_slope=0.012 je Wochenschritt.
              Die Steigung oben ist eine EIGENE Kleinste-Quadrate-Schätzung über die geglättete Kurve — nicht der
              interne Kalman-Slope-Zustand (der wird intern verwendet, aber nicht persistiert).
            </Methodik>
          </>
        )}
      </Panel>

      <Panel n={2} title="L3 — Dosis-Wirkung: Forest-Plot, VIF-Leiter, E-Value" subtitle="Kanal-Effekte auf die latente Fitness (Mediator + Volumen-bereinigt) als Forest-Plot, Kollinearitäts-Ladder und Fit-Diagnostik.">
        {!effects?.meta ? <p className="tiny muted">Kein Dosis-Wirkungs-Lauf vorhanden.</p> : (
          <>
            <div className="tiny muted" style={{ fontWeight: 700, marginBottom: 4 }}>Mediator-Effekte</div>
            <ForestPlot effects={mediator} />
            {composition.length > 0 && (
              <>
                <div className="tiny muted" style={{ fontWeight: 700, margin: "12px 0 4px" }}>Volumen-bereinigte Effekte (Σ=0)</div>
                <ForestPlot effects={composition} />
              </>
            )}
            <div className="tiny muted" style={{ marginTop: 10, fontWeight: 700 }}>Kollinearitäts-Ladder</div>
            <table className="tiny" style={{ width: "100%" }}>
              <thead><tr><th style={{ textAlign: "left" }}>Kanäle</th><th>identifizierbar</th><th>max VIF</th><th style={{ textAlign: "left" }}>Grund</th></tr></thead>
              <tbody>{ladder.map((l, i) => (
                <tr key={i}><td>{l.count} ({l.channels.join(", ")})</td><td style={{ textAlign: "center" }}>{l.identifiable ? "✓" : "✗"}</td><td style={{ textAlign: "center" }}>{fmt(l.maxVif, 1)}</td><td>{l.reason}</td></tr>
              ))}</tbody>
            </table>
            {diag && (
              <div className="tiny muted" style={{ marginTop: 6 }}>
                Mediator: VIF {fmt(diag.mediator.maxVif, 1)} · λ {fmt(diag.mediator.lambda, 3)} · {diag.mediator.nWeeks} Wochen · {diag.mediator.bootReps} Bootstrap-Reps
                {" · "}Volumen-bereinigt: VIF {fmt(diag.composition.maxVif, 1)} · λ {fmt(diag.composition.lambda, 3)}
              </div>
            )}
            <Methodik>
              Gewichtete Ridge-Regression (latente Fitness ~ Kanal-Exposures), Regularisierung λ per Cross-Validation
              gewählt. 95%-CIs aus block-weisem Bootstrap (autokorrelations-robust, respektiert die Wochen-Struktur).
              VIF (Varianzinflationsfaktor) misst Kollinearität zwischen Kanälen — steigt er zu hoch, fällt die
              Ladder automatisch von 5→4→3 Kanälen (weniger, dafür robuster identifizierbare Kanäle). E-Value =
              wie stark ein unbeobachteter Störfaktor sein müsste, um den beobachteten Effekt allein zu erklären
              (höher = robuster gegen Confounding). FDR-Korrektur (✓) schützt vor Mehrfachvergleichs-Fehlalarmen.
            </Methodik>
          </>
        )}
      </Panel>

      <Panel n={3} title="Dosis-Wirkungs-Kernel — Bayes-Zerfall + Was-wäre-wenn" subtitle="Wie schnell der Effekt eines Kanals abklingt (Zerfallskern) und die projizierte Wirkung bei fortgesetzter Dosis (Was-wäre-wenn).">
        {bayesChannels.length === 0 ? <p className="tiny muted">Kein Bayes-Lauf vorhanden.</p> : (
          <>
            <div className="tiny muted" style={{ fontWeight: 700, marginBottom: 4 }}>Zerfallskern je Kanal (normiert auf 1 am Reiztag)</div>
            <KernelChart channels={bayesChannels.map((c) => ({ channel: c.channel, tau: c.tau_weeks ?? 0 }))} />
            <div className="tiny muted" style={{ fontWeight: 700, margin: "12px 0 4px" }}>Was-wäre-wenn-Projektion je Kanal</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {bayesChannels.filter((c) => c.whatif?.trajectory?.length).map((c) => (
                <div key={c.channel}>
                  <div className="tiny" style={{ fontWeight: 600 }}>{c.channel} — Peak Woche {c.whatif!.peak_week}: {c.whatif!.peak_delta >= 0 ? "+" : ""}{fmt(c.whatif!.peak_delta)} [{fmt(c.whatif!.peak_low)}, {fmt(c.whatif!.peak_high)}]</div>
                  <TrajectoryChart trajectory={c.whatif!.trajectory} />
                </div>
              ))}
            </div>
            <table className="tiny" style={{ width: "100%", marginTop: 10 }}>
              <thead><tr><th style={{ textAlign: "left" }}>Kanal</th><th>Posterior-Mittel</th><th>94%-HDI</th><th>τ (Wochen)</th><th>Halbwertszeit</th></tr></thead>
              <tbody>{bayesChannels.map((c, i) => (
                <tr key={i}><td>{c.channel}</td><td style={{ textAlign: "center" }}>{fmt(c.mean)}</td><td style={{ textAlign: "center" }}>[{fmt(c.hdi_low)}, {fmt(c.hdi_high)}]</td><td style={{ textAlign: "center" }}>{fmt(c.tau_weeks, 1)}</td><td style={{ textAlign: "center" }}>{fmt(c.half_life_weeks, 1)}</td></tr>
              ))}</tbody>
            </table>
            <Methodik>
              Bayesianisches Modell (PyMC, Fallback: TS-Conjugate) mit exponentiellem Zerfallskern je Kanal:
              Wirkung(t) = β · exp(−t/τ), τ = Retentionszeit (Wochen), Halbwertszeit = τ·ln(2). Was-wäre-wenn
              simuliert eine fortgesetzte Dosis dieses Kanals über den Horizont und faltet sie mit dem Kernel —
              der „Peak" ist die Woche mit dem größten projizierten Effekt-Zuwachs, mit 94%-HDI (Credible Interval,
              kein klassisches Konfidenzintervall). Posterior-Mittel = β aus der MCMC-Stichprobe (oder Conjugate-
              Fallback ohne C-Compiler).
            </Methodik>
          </>
        )}
      </Panel>

      <Panel n={4} title="F3 — Exposure-EWMA (Regime/Schwerpunkt-Dosis)" subtitle="β je Regime auf die latente Fitness, plus die rohe wöchentliche Exposure-Serie, die reingeht (sonst nur intern, wird verworfen).">
        {!regime?.models ? (
          // v3.1.0: Die Nerd-Seite rechnet grundsätzlich nichts (read-only) — sie zeigt das GESPEICHERTE Ergebnis.
          // Vorher stieß allein das Öffnen dieser Seite einen bis zu 120 s langen Sidecar-Lauf an.
          <p className="tiny muted">Kein gespeicherter Regime-Latent-Lauf — auf der Methodik-Seite („Passive Inferenz" → neu berechnen) einmal rechnen lassen.</p>
        ) : (
          <>
            <MiniForest rows={regimeCells.map((c) => ({ label: c.label, value: c.beta, lo: c.ci_low ?? c.beta, hi: c.ci_high ?? c.beta }))} />
            {regime.labels && regime.X && regime.y && regime.dates && (
              <>
                <div className="tiny muted" style={{ margin: "12px 0 4px", fontWeight: 700 }}>Rohe Exposure-Zeitreihe ({regime.nWeeks ?? regime.X.length} Wochen)</div>
                <ExposureChart labels={regime.labels} X={regime.X} y={regime.y} dates={regime.dates} />
              </>
            )}
            <Methodik>
              Jede Woche wird als exponentiell gewichteter gleitender Anteil (EWMA) je Regime klassifiziert (z. B.
              „polarisiert"/„pyramidal"/„gemischt" — wie viel der Wochenlast auf welches Muster entfällt, mit
              Gedächtnis über mehrere Wochen statt nur der aktuellen). Die gepunktete Linie ist die latente Fitness
              (rechte Achse) — visuell prüfbar, ob ein Regime-Anteil mit einem Fitness-Anstieg zusammenfällt. β aus
              Ridge-Regression Exposure→latente Fitness, P(β&gt;0) aus demselben Bootstrap/Bayes-Verfahren wie L3.
            </Methodik>
          </>
        )}
      </Panel>

      <Panel n={5} title="Phase×Reiz — roh vs. geschrumpft" subtitle="Je Zyklusphase×Trainingsreiz: gemessener Effekt (Zellfarbe) und wie stark er auf eigenen Daten statt dem schwachen Prior beruht (Deckkraft).">
        {cycleEv === "no-consent" ? <p className="tiny muted">Zyklus-Steuerung nicht aktiviert (kein Consent) — kein Phase×Reiz-Datensatz.</p>
          : !cycleEv || cycleEv.length === 0 ? <p className="tiny muted">Noch keine Phase×Reiz-Evidenz erfasst.</p> : (
          <>
            <PhaseStimulusHeatmap rows={cycleEv} />
            <Methodik>
              Shrinkage-Schätzer: tendency = (1−w)·prior + w·effect, mit Posterior-Gewicht
              w = min(1, n_sessions/N_FULL) · min(1, n_cycles/2) — wächst mit der Zahl erfasster Einheiten UND mit
              Replikation über mindestens 2 Zyklen (ein einzelner Zyklus bekommt nie volles Gewicht). Der schwache
              mechanistische Prior kommt aus der Trainingslehre (nicht aus deinen Daten) und dominiert, solange wenig
              erfasst ist — die Zelle wird erst „aktivierbar", wenn Konfidenz ≥ mittel, 95%-CI schließt 0 aus,
              |Effekt| ≥ 0.2 UND ≥ 2 Zyklen Replikation vorliegen (konjunktiv, gegen Mehrfachvergleichs-Fehlalarme).
            </Methodik>
          </>
        )}
      </Panel>

      <Panel n={6} title="Prospektiv — randomisierte N-of-1-Blöcke (θ + exakter p-Wert)" subtitle="Der einzige kausale Pfad in RunLog: randomisierte Paar-Blöcke (Arm A vs. B), ausgewertet über einen exakten Vorzeichen-Permutationstest.">
        {!prospective?.trials?.length ? <p className="tiny muted">Keine prospektiven Trials angelegt.</p> : (
          <>
            {prospective.trials.map((t) => {
              let blocks: MlProspectiveBlock[] = [];
              try { blocks = t.blocks_json ? JSON.parse(t.blocks_json) : []; } catch { blocks = []; }
              return (
                <div key={t.id} style={{ marginBottom: 14 }}>
                  <div className="tiny" style={{ fontWeight: 600 }}>
                    {t.arm_a_label ?? t.arm_a} vs. {t.arm_b_label ?? t.arm_b} — {t.state} · {t.n_pairs_done ?? 0}/{t.n_pairs_planned ?? "—"} Paare · θ={fmt(t.theta)} · exakter p={fmt(t.p_exact, 3)} · {t.verdict ?? "—"}
                  </div>
                  {blocks.length > 0 && <ProspectivePairChart blocks={blocks} />}
                </div>
              );
            })}
            <Methodik>
              Jedes Paar durchläuft Arm A und Arm B (randomisierte Reihenfolge). θ = mittlere paarweise Differenz
              (Arm B − Arm A) über alle abgeschlossenen Paare. Der EXAKTE p-Wert kommt aus einem Vorzeichen-
              Permutationstest: alle 2^P möglichen Vorzeichen-Umkehrungen der P Paar-Differenzen werden durchprobiert,
              p = Anteil der Permutationen mit |Mittelwert| ≥ |θ| — kein asymptotischer Näherungstest, exakt auch bei
              kleinem P. Die volle Null-Verteilung (alle 2^P Werte) wird nicht persistiert, nur der resultierende
              exakte p-Wert.
            </Methodik>
          </>
        )}
      </Panel>

      <Panel n={7} title="Verdikt — alle drei Achsen auf einer Skala" subtitle="Die Synthese aus allen Panels oben: Dosis (L3) + Regime + Schwerpunkt + geprüfte prospektive Trials, gecacht per Fingerprint.">
        <TrainingVerdictCard />
        <Methodik>
          Bündelt die Dosis-Wirkungs-Achse (L3), die Regime-Achse und die Schwerpunkt-Achse (beide F3) sowie
          ausgewertete prospektive Trials zu EINER rangierten Aussage je Achse, geschichtet nach „beobachtet"
          (Korrelation) vs. „kausal geprüft" (aus einem prospektiven Trial). Ergebnis wird per Fingerprint gecacht
          (letzte Run-IDs + Trial-Verdikte + verankerte MCID) — ändert sich keiner davon, kein neuer Rechenlauf.
        </Methodik>
      </Panel>
    </div>
  );
}
