// Dosis-Wirkungs-Karte (L3, P2): „Was wirkt bei DIR?" — Forest-Plot der Reiz-Kanal-Effekte auf die latente
// Fitness, Modell-Umschalter Mediator/Komposition (Sensitivität, Frage 11), Verdikt + ehrliches Framing.
// BEOBACHTEND → as-if causal / Hypothese (das geprüfte Verdikt liefern erst die prospektiven Blöcke, P5).
import { useEffect, useRef, useState } from "react";
import { api, type MlSettings, type MlStatus, type MlEffects, type MlAdversarialAudit, type MlAuditStatus, type MlWhatIfPoint } from "../lib/api.ts";
import { fmtDateY } from "../lib/util.ts";
import ExpertDetails from "./ExpertDetails.tsx";
import ForestPlot from "../charts/ForestPlot.tsx";
import { useComputeStamp, stampLabel } from "../lib/computeStamp.ts";

const FRESH_LABEL: Record<string, string> = { fresh: "aktuell", stale: "veraltet", none: "noch nicht berechnet", running: "rechnet…" };
const FRESH_COLOR: Record<string, string> = { fresh: "var(--ok)", stale: "var(--warn)", none: "var(--muted)", running: "#0ea5e9" };
const AUDIT_LABEL: Record<MlAuditStatus, string> = { pass: "ok", warn: "warnung", fail: "kritisch", info: "info" };
const AUDIT_COLOR: Record<MlAuditStatus, string> = { pass: "var(--ok)", warn: "var(--warn)", fail: "var(--danger)", info: "var(--muted)" };

/** B2b: Mini-Trajektorie (Was-wäre-wenn) — Mittel-Linie + 94%-HDI-Band, Nulllinie gestrichelt. */
function TrajSpark({ points }: { points: MlWhatIfPoint[] }) {
  const W = 120, H = 26;
  const min = Math.min(0, ...points.map((p) => p.lo));
  const max = Math.max(0.01, ...points.map((p) => p.hi));
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / (max - min)) * H;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.mean).toFixed(1)}`).join(" ");
  const band = [...points.map((p, i) => `${x(i).toFixed(1)},${y(p.hi).toFixed(1)}`), ...points.slice().reverse().map((p, i) => `${x(points.length - 1 - i).toFixed(1)},${y(p.lo).toFixed(1)}`)].join(" ");
  return (
    <svg width={W} height={H}>
      <polygon points={band} fill="var(--accent, #0ea5e9)" opacity={0.13} />
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeWidth={0.5} strokeDasharray="2 2" />
      <path d={line} fill="none" stroke="var(--accent, #0ea5e9)" strokeWidth={1.5} />
    </svg>
  );
}

export default function DoseResponseCard({ onRecomputed }: { onRecomputed?: () => void } = {}) {
  const [status, setStatus] = useState<MlStatus | null>(null);
  const [eff, setEff] = useState<MlEffects | null>(null);
  const [settings, setSettings] = useState<MlSettings | null>(null);
  const [audit, setAudit] = useState<MlAdversarialAudit | null>(null);
  const [model, setModel] = useState<"mediator" | "composition">("mediator");
  const [busy, setBusy] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const pollRef = useRef<number | null>(null);
  const runIdRef = useRef<number | null>(null); // aktiver Lauf — für Abbrechen/Reset
  const t0Ref = useRef<number>(0);
  const { stamp: doseStamp, mark: markDose } = useComputeStamp("dose-response");

  const load = () => {
    api.mlStatus("dose_response").then(setStatus).catch(() => setStatus(null));
    api.mlEffects().then(setEff).catch(() => setEff(null));
    api.mlSettings().then(setSettings).catch(() => {});
  };
  useEffect(() => {
    load();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []);

  const startPoll = (runId: number) => {
    pollRef.current = window.setInterval(async () => {
      const pr = await api.mlProgress(runId).catch(() => null);
      // Genauigkeit vor Tempo: solange der Lauf lebt, weiterpollen (der Bayes-Lauf darf lange rechnen).
      // Not-Riegel bei 21 min — knapp über dem Server-Reap (20 min), der tote Läufe ohnehin selbst aufräumt.
      if (t0Ref.current && Date.now() - t0Ref.current > 1_260_000 && (!pr || pr.status === "running")) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null; runIdRef.current = null; setBusy(false); load(); return;
      }
      if (!pr || ["done", "failed", "cancelled"].includes(pr.status)) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        runIdRef.current = null;
        setBusy(false);
        if (pr?.status === "done" && t0Ref.current) markDose(Date.now() - t0Ref.current);
        load();
        onRecomputed?.(); // Gesamtbild-Karte neu laden (nutzt denselben getEffects-Lauf)
      }
    }, 700);
  };

  const recompute = async () => {
    setBusy(true);
    setAudit(null);
    t0Ref.current = Date.now();
    try {
      const { runId } = await api.mlRecompute("dose_response");
      runIdRef.current = runId;
      startPoll(runId);
    } catch {
      setBusy(false);
    }
  };

  // Reset/Abbrechen: hängenden (oder laufenden) Lauf abbrechen, Poll stoppen, zurück in den Ruhezustand.
  const reset = async () => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    const id = runIdRef.current;
    runIdRef.current = null;
    setBusy(false);
    if (id != null) { try { await api.mlCancel(id); } catch { /* egal */ } }
    load();
  };

  const applyCount = async (count: number | "auto") => {
    if (!settings) return;
    setBusy(true);
    try {
      const updated = {
        ...settings,
        channel_count: count === "auto" ? settings.channel_count : count,
        channel_auto: count === "auto" ? 1 : 0,
      };
      await api.mlSaveSettings(updated);
      setSettings(updated);
      setAudit(null);
      const { runId } = await api.mlRecompute("dose_response");
      runIdRef.current = runId;
      startPoll(runId);
    } catch {
      setBusy(false);
    }
  };

  const runAudit = async () => {
    setAuditBusy(true);
    try {
      setAudit(await api.mlAdversarialAudit());
    } finally {
      setAuditBusy(false);
    }
  };

  const fr = status?.freshness;
  const running = busy || fr?.state === "running";
  const rows = eff ? (model === "mediator" ? eff.mediator : eff.composition) : [];
  const verdict = eff?.meta?.verdict?.[model];
  const ladder = eff?.meta?.ladder ?? [];
  const activeCount = eff?.meta?.activeCount;
  const changepoints = eff?.meta?.changepoints ?? [];
  const isAuto = (settings?.channel_auto ?? 1) !== 0;
  const fixedCount = settings?.channel_count ?? 5;

  return (
    <div className="card" data-tour="dose-response" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>
          Was wirkt bei dir? <span className="tiny muted">— Reiz-Kanäle → latente Fitness</span>
        </h3>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {fr && (
              <span title={fr.reason ?? ""} style={{ fontSize: 10.5, fontWeight: 600, color: FRESH_COLOR[fr.state], border: `1px solid ${FRESH_COLOR[fr.state]}`, borderRadius: 999, padding: "0 8px", lineHeight: 1.7, whiteSpace: "nowrap" }}>
                ● {FRESH_LABEL[fr.state]}
              </span>
            )}
            <button className="btn btn-ghost" onClick={running ? reset : recompute} title={running ? "Läuft — klick zum Abbrechen/Zurücksetzen der Engine" : "Neu berechnen"}>{running ? "rechnet… — ✕ abbrechen" : "Neu berechnen"}</button>
          </div>
          {doseStamp && <span className="tiny muted" style={{ whiteSpace: "nowrap" }}>{stampLabel(doseStamp)}</span>}
        </div>
      </div>
      <p className="tiny muted" style={{ marginTop: 6, maxWidth: 760 }}>
        Welcher Trainingsreiz baut <strong>bei dir</strong> die Fitness — VO2max, Schwelle oder aerob (Long/Easy)?
        Regularisierte Regression der latenten Fitness auf die kanal-spezifische Trainingslast, mit ehrlichen
        Block-Bootstrap-CIs. <strong>Beobachtung, kein Beweis</strong> — Korrelation/„as-if causal"; das
        <em> geprüfte</em> Verdikt liefern erst die geplanten randomisierten Blöcke.
      </p>

      {/* Modell-Umschalter (Sensitivität, Frage 11) — data-model/data-active: Anker für die Tutorial-Aufgabe (v3.1.0) */}
      <div style={{ display: "flex", gap: 6, margin: "8px 0 4px" }} data-tour="dose-view-switch">
        {(["mediator", "composition"] as const).map((m) => (
          <button
            key={m}
            className="btn btn-ghost"
            data-model={m}
            data-active={model === m ? "1" : "0"}
            onClick={() => setModel(m)}
            style={{ fontSize: 12, padding: "2px 10px", borderColor: model === m ? "var(--accent, #0ea5e9)" : undefined, color: model === m ? "var(--ink)" : "var(--muted)", fontWeight: model === m ? 700 : 400 }}
          >
            {m === "mediator" ? "Absolut" : "Volumen-bereinigt"}
          </button>
        ))}
        <span className="tiny muted" style={{ alignSelf: "center" }}>
          {model === "mediator" ? "Effekt inkl. Umfang" : "Schwerpunkt bei gleichem Umfang"}
        </span>
      </div>

      {/* B1: Engine-Hinweis — IMMER anzeigen, mit welcher Engine gerechnet wurde. */}
      {rows.length > 0 && (
        rows.some((e) => e.bayes_engine)
          ? <div className="tiny" style={{ marginBottom: 8, color: "var(--ok)" }}>Engine: Bayes ({rows.find((e) => e.bayes_engine)?.bayes_engine}) — Effekt = Posterior-Mittel, Intervall = 94%-HDI.{model === "composition" ? " Volumen-bereinigt: gegen den Gesamt-Umfang residualisiert, Effekte Σ=0 (relativ zum mittleren Mix)." : ""}</div>
          : <div className="tiny muted" style={{ marginBottom: 8 }}>Engine: TS (Ridge + Block-Bootstrap) — für Bayes-Posteriors (HDI/Retention/Was-wäre-wenn) „Neu berechnen" mit aktivem Sidecar.</div>
      )}

      {/* Kanal-Anzahl: Auto oder manuell 3/4/5 */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 8 }}>
        <span className="tiny muted" style={{ marginRight: 2 }}>Kanäle:</span>
        {(["auto", 3, 4, 5] as const).map((v) => {
          const active = v === "auto" ? isAuto : (!isAuto && fixedCount === v);
          const step = typeof v === "number" ? ladder.find((s) => s.count === v) : null;
          const tip = step
            ? (step.identifiable ? `${v} Kanäle — trennbar ✓` : `${v} Kanäle — ${step.reason}`)
            : v === "auto" ? "Automatisch: beste trennbare Stufe" : `${v} Kanäle (manuell)`;
          return (
            <button
              key={String(v)}
              className="btn btn-ghost"
              disabled={running || !settings}
              onClick={() => applyCount(v)}
              title={tip}
              style={{ fontSize: 12, padding: "2px 9px", borderColor: active ? "var(--accent, #0ea5e9)" : undefined, color: active ? "var(--ink)" : "var(--muted)", fontWeight: active ? 700 : 400 }}
            >
              {v === "auto" ? "Auto" : String(v)}
            </button>
          );
        })}
        {!isAuto && (
          <span className="tiny muted" style={{ alignSelf: "center" }}>
            {ladder.find((s) => s.count === fixedCount)?.identifiable
              ? "trennbar ✓"
              : ladder.find((s) => s.count === fixedCount)?.reason ?? ""}
          </span>
        )}
      </div>

      {!rows.length ? (
        <p className="muted">{fr?.state === "none" ? "Noch nicht berechnet — klick „Neu berechnen“." : "Noch zu wenig Daten."}</p>
      ) : (
        <>
          <ForestPlot effects={rows} />
          {rows.some((e) => e.posterior_mean != null) && (
            <ExpertDetails summary="Bayes-Posterior je Kanal (HDI · P>0)">
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {rows.filter((e) => e.posterior_mean != null).map((e) => (
                  <div key={e.channel} className="tiny" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{e.channel}</span>
                    <span className="muted">{e.posterior_mean! > 0 ? "+" : ""}{e.posterior_mean!.toFixed(2)} · HDI [{e.hdi_low?.toFixed(2)}, {e.hdi_high?.toFixed(2)}] · P&gt;0 {(e.p_positive ?? 0).toFixed(2)}{e.half_life_weeks != null ? ` · Retention ~${e.half_life_weeks.toFixed(1)} Wo` : ""}</span>
                  </div>
                ))}
              </div>
              <p className="tiny muted" style={{ marginTop: 4 }}>Δ latente Fitness je +1 SD Kanal-Last. P&gt;0 = Posterior-Wahrscheinlichkeit eines positiven Effekts. Retention = Halbwertszeit des Reizes (τ·ln2, gefittet) — wie lange der Effekt hält. Rein beobachtend, nicht kausal.</p>
            </ExpertDetails>
          )}
          {model === "mediator" && eff?.meta?.bayes?.channels?.some((c) => c.whatif) && (
            <ExpertDetails summary="Was-wäre-wenn: 4-Wochen-Block je Kanal (prognostizierter Fitness-Verlauf)">
              <p className="tiny muted" style={{ marginTop: 0 }}>+1 SD Kanal-Last über 4 Wochen → erwartete Δ latente Fitness über 12 Wochen (Bayes-Prognose aus dem Impulse-Response-Modell, Band = 94%-HDI). Peak-Woche = wann der Reiz „landet", danach Zerfall im gefitteten Tempo. Beobachtend, nicht kausal.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {[...eff.meta.bayes.channels].filter((c) => c.whatif).sort((a, b) => b.whatif!.peak_delta - a.whatif!.peak_delta).map((c) => (
                  <div key={c.channel} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="tiny" style={{ fontWeight: 600, width: 84 }}>{c.channel}</span>
                    <TrajSpark points={c.whatif!.trajectory} />
                    <span className="tiny muted" style={{ whiteSpace: "nowrap" }}>Peak {c.whatif!.peak_delta > 0 ? "+" : ""}{c.whatif!.peak_delta.toFixed(2)} (Wo {c.whatif!.peak_week}){c.half_life_weeks != null ? ` · Ret ~${c.half_life_weeks.toFixed(1)}Wo` : ""}</span>
                  </div>
                ))}
              </div>
            </ExpertDetails>
          )}
          {verdict && (
            <p style={{ marginTop: 10, marginBottom: 0, fontSize: 13.5, color: verdict.kind === "null" ? "var(--warn)" : "var(--ink)" }}>
              <strong>Verdikt:</strong> {verdict.text}
            </p>
          )}
          {ladder.length > 0 && (
            <p className="tiny muted" style={{ marginTop: 6, marginBottom: 0 }}>
              <strong>{activeCount} Kanäle aktiv.</strong> Leiter:{" "}
              {ladder.map((s) => `${s.count}→${s.identifiable ? "trennbar ✓" : s.reason}`).join("  ·  ")}
            </p>
          )}
          {changepoints.length > 0 && (
            <p className="tiny muted" style={{ marginTop: 4, marginBottom: 0 }}>
              Strukturbrüche in deiner Fitness erkannt: {changepoints.length} (zuletzt {fmtDateY(changepoints[changepoints.length - 1])}) — ältere Phasen sind zusätzlich recency-abgewertet.
            </p>
          )}
          <div style={{ marginTop: 10, padding: "8px 11px", border: "1px solid var(--border-faint)", borderRadius: 8 }}>
            <div className="tiny" style={{ fontWeight: 600, marginBottom: 4 }}>ℹ️ So liest du das</div>
            <ul className="tiny muted" style={{ margin: 0, paddingLeft: 16, lineHeight: 1.55 }}>
              <li>Jeder Balken = ein Trainingsreiz. Punkt = geschätzter Effekt, Linie = 95%-Vertrauensband.</li>
              <li><span style={{ color: "var(--ok)" }}>Rechts von 0 (grün)</span> = ging bei dir mit <strong>steigender</strong> Fitness einher; <span style={{ color: "var(--danger)" }}>links (rot)</span> = mit fallender; <span style={{ color: "var(--muted)" }}>grau</span> = Band überlappt 0 → kein klarer Effekt.</li>
              <li>„+0,93 je +1 SD" = eine um 1 Standardabweichung höhere Last in diesem Kanal entsprach +0,93 Punkten latenter Fitness.</li>
              <li><strong>Absolut</strong> = Effekt inkl. Umfang · <strong>Volumen-bereinigt</strong> = Schwerpunkt bei gleichem Gesamtumfang. Graues Band = MCID (kleinster sinnvoller Effekt).</li>
              <li><strong>✓ = FDR-bestätigt</strong> (übersteht die Mehrfachtest-Korrektur). <strong>E-Value</strong> (in den Details) = wie stark ein unbeobachteter Störfaktor sein müsste, um den Effekt zu erklären — größer = robuster.</li>
              <li><strong>Korrelation, kein Beweis:</strong> wer hart trainierte, war oft frisch/in Form — das verzerrt. Das geprüfte Verdikt liefern erst die geplanten randomisierten Blöcke.</li>
            </ul>
          </div>
          <div style={{ marginTop: 10, padding: "8px 11px", border: "1px solid var(--border-faint)", borderRadius: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div className="tiny" style={{ fontWeight: 600 }}>Adversarial Audit vor harten Schlussfolgerungen</div>
              <button className="btn btn-ghost tiny" disabled={auditBusy || running} onClick={runAudit}>{auditBusy ? "prüft…" : "Audit laufen lassen"}</button>
            </div>
            {!audit ? (
              <p className="tiny muted" style={{ margin: "5px 0 0", lineHeight: 1.5 }}>
                Einmaliger Prüf-Workflow für Identifizierbarkeit, CV-Zeitordnung, Shrinkage/FDR, Confounder und Vorzeichen-Stabilität.
              </p>
            ) : (
              <div style={{ marginTop: 7 }}>
                <div className="tiny muted" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ color: AUDIT_COLOR[audit.summary.status], fontWeight: 700 }}>Audit {AUDIT_LABEL[audit.summary.status]}</span>
                  <span>Run #{audit.runId ?? "—"} · {audit.designWeeks} Wochen · {fmtDateY(audit.generatedAt.slice(0, 10))}</span>
                  <span>{audit.summary.pass} ok · {audit.summary.warn} Warnung · {audit.summary.fail} kritisch</span>
                </div>
                <div style={{ display: "grid", gap: 5, marginTop: 7 }}>
                  {audit.checks.map((c) => (
                    <div key={c.key} className="tiny" style={{ display: "grid", gridTemplateColumns: "72px minmax(0,1fr)", gap: 8, alignItems: "baseline" }}>
                      <span style={{ color: AUDIT_COLOR[c.status], fontWeight: 700, textTransform: "uppercase", fontSize: 10 }}>{AUDIT_LABEL[c.status]}</span>
                      <span><strong>{c.label}:</strong> <span className="muted">{c.message}</span>{c.detail ? <span className="muted"> · {c.detail}</span> : null}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <ExpertDetails summary="Modell-Interna">
        <div className="tiny muted" style={{ lineHeight: 1.6 }}>
          <div>Modell: gewichtete Ridge-Regression (τ=42/7 fix), 95%-CI via Moving-Block-Bootstrap; Recency-gewichtet (Forgetting ~15 Mt).</div>
          <div>Zwei Sichten: <em>Absolut</em> (Mediator) vs. <em>Volumen-bereinigt</em> (Komposition, gegen Gesamt-CTL residualisiert) — Sensitivität (Frage 11).</div>
          <div>Aktives Modell: {activeCount ?? "?"} Kanäle ({eff?.meta?.channels?.join(" · ") ?? "—"}) · Modus {eff?.meta?.auto === false ? "feste Stufe" : "Auto-Leiter"}</div>
          <div>Leiter-Trail: {ladder.map((s) => `${s.count}: ${s.reason}`).join("  |  ") || "—"}</div>
          <div>Lauf: {eff?.runId ? `#${eff.runId} · ${eff.finishedAt ? fmtDateY(eff.finishedAt.slice(0, 10)) : "—"}` : "—"}</div>
          <div>Per-Kanal-Konfidenz: {rows.map((r) => `${r.channel}=${r.confidence}`).join(" · ") || "—"}</div>
          <div>E-Value (Robustheit ggü. unbeob. Confounder): {rows.map((r) => `${r.channel}=${r.e_value != null ? r.e_value.toFixed(1) : "—"}${r.fdr_survive ? "✓" : ""}`).join(" · ") || "—"}</div>
          {(eff?.meta?.exploratory?.hypotheses.length ?? 0) > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 600 }}>Explorative Hypothesen <span style={{ fontWeight: 400 }}>(L6 — beobachtet, NICHT kausal getestet)</span></div>
              {eff!.meta!.exploratory!.hypotheses.map((h, i) => <div key={i}>• {h.text}</div>)}
              <div style={{ fontStyle: "italic" }}>{eff!.meta!.exploratory!.note}</div>
            </div>
          )}
        </div>
      </ExpertDetails>
    </div>
  );
}
