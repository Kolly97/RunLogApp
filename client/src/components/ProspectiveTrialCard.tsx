// P5 — Prospektiv randomisierte N-of-1-Blöcke (L5): der EINZIGE „geprüft/verursacht"-Pfad der Engine.
// Counterbalanced AB/BA, load-matched, per-Paar randomisierte Reihenfolge; Outcome = Δ latente Fitness am Lag;
// exakter Within-Pair-Permutationstest. Ehrlich: ein „geprüft"-Verdikt braucht ≥6 saubere Paare (≈1,5–2 Jahre).
import { useEffect, useState } from "react";
import { api, type MlProspectiveState, type MlProspectiveProposal, type MlProspectiveTrial, type MlProspectiveBlock, type MlTrialBlockGen } from "../lib/api.ts";
import { fmtDate } from "../lib/util.ts";
import ExpertDetails from "./ExpertDetails.tsx";

const todayIso = () => new Date().toISOString().slice(0, 10);
const parseBlocks = (t: MlProspectiveTrial): MlProspectiveBlock[] => {
  try { return t.blocks_json ? (JSON.parse(t.blocks_json) as MlProspectiveBlock[]) : []; } catch { return []; }
};
const pairsForSignif = (t: MlProspectiveTrial): number => {
  let alpha = 0.05;
  try { const c = t.config_json ? JSON.parse(t.config_json) : null; if (c?.alpha) alpha = c.alpha; } catch { /* default */ }
  return Math.ceil(Math.log2(2 / alpha));
};
const achievableMinP = (p: number) => (p > 0 ? 2 / Math.pow(2, p) : 1);

// Klartext, warum eine Alternative niedriger rankt: größte Score-Differenz zum Spitzenreiter (rein rechnerisch, kein neues Modell).
const SCORE_DIM_LABEL: Record<keyof MlProspectiveProposal["scores"], string> = {
  data: "Datenlage", benefit: "erwarteter Nutzen", duration: "Dauer bis zum Verdikt", risk: "Risiko", explainability: "Erklärbarkeit",
};
function whyNotReason(top: MlProspectiveProposal, alt: MlProspectiveProposal): string {
  const dims = Object.keys(top.scores) as (keyof MlProspectiveProposal["scores"])[];
  let worst: keyof MlProspectiveProposal["scores"] = dims[0];
  let worstGap = -Infinity;
  for (const d of dims) {
    const gap = top.scores[d] - alt.scores[d];
    if (gap > worstGap) { worstGap = gap; worst = d; }
  }
  return worstGap > 0 ? `niedrigere ${SCORE_DIM_LABEL[worst]} (${alt.scores[worst]} vs. ${top.scores[worst]})` : "insgesamt niedrigerer Gesamt-Score";
}

export default function ProspectiveTrialCard() {
  const [st, setSt] = useState<MlProspectiveState | null>(null);
  const [busy, setBusy] = useState(false);
  const [nPairs, setNPairs] = useState(6);
  const [showInfo, setShowInfo] = useState(false);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  const load = () => api.mlProspective().then((s) => {
    setSt(s);
    const p = s.proposals?.[0] ?? s.proposal;
    if (p) { setNPairs(p.defaults.nPairsPlanned); setSelectedHash(p.proposalHash); }
  }).catch(() => setSt(null));
  useEffect(() => { load(); }, []);

  const active = st?.trials.find((t) => t.state === "active") ?? null;
  const evaluated = st?.trials.find((t) => t.state === "evaluated") ?? null;
  const proposals = !active ? (st?.proposals?.length ? st.proposals : st?.proposal ? [st.proposal] : []) : [];
  const proposal = proposals.find((p) => p.proposalHash === selectedHash) ?? proposals[0] ?? null;
  const selectProposal = (p: MlProspectiveProposal) => {
    setSelectedHash(p.proposalHash);
    setNPairs(p.defaults.nPairsPlanned);
  };

  const accept = async (p: MlProspectiveProposal) => {
    setBusy(true);
    try {
      await api.mlAcceptTrial({
        kind: p.kind, armA: { value: p.armA.value, label: p.armA.label }, armB: { value: p.armB.value, label: p.armB.label },
        nPairsPlanned: nPairs, proposalHash: p.proposalHash, consentedAt: new Date().toISOString(),
        lagWeeks: p.defaults.lagWeeks, blockWeeks: p.defaults.blockWeeks, washoutWeeks: p.defaults.washoutWeeks, mcid: p.defaults.mcid, alpha: p.defaults.alpha,
      });
      await load();
    } finally { setBusy(false); }
  };
  const decline = async () => {
    if (!window.confirm("Diesen Vorschlag ablehnen? Dann kommt für ~4 Wochen kein neuer Vorschlag. (Du kannst ihn danach mit „Vorschläge wieder aktivieren“ zurückholen.)")) return;
    setBusy(true); try { await api.mlDeclineTrial(); await load(); } finally { setBusy(false); }
  };
  const reactivate = async () => { setBusy(true); try { await api.mlReactivateTrial(); await load(); } finally { setBusy(false); } };
  const abort = async (id: number) => { if (!window.confirm("Trial abbrechen? Die bisherigen Blöcke bleiben archiviert.")) return; setBusy(true); try { await api.mlAbortTrial(id); await load(); } finally { setBusy(false); } };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Kausal-Experiment <span className="tiny muted">— randomisierte N-of-1-Blöcke</span></h3>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ok)", border: "1px solid var(--ok)", borderRadius: 999, padding: "0 7px" }}>einziger kausaler Pfad</span>
      </div>
      <p className="tiny muted" style={{ marginTop: 6, maxWidth: 780 }}>
        Beobachtung (oben) zeigt <em>Zusammenhänge</em>. Erst counterbalanced, per Zufall geordnete Trainingsblöcke
        (Arm A ↔ Arm B, gleiches Wochen-TSS, nur der Reiz-Mix wechselt) erlauben ein <strong>kausales</strong> Verdikt —
        über einen exakten Vorzeichen-Permutationstest auf die Δ latente Fitness.
      </p>

      {!st ? <p className="muted">Lädt…</p> : (
        <>
          {active && <ActiveView t={active} onAbort={() => abort(active.id)} busy={busy} />}
          {evaluated && !active && <ResultView t={evaluated} />}
          {proposal && (
            <ProposalView
              p={proposal} proposals={proposals} onSelectProposal={selectProposal}
              nPairs={nPairs} setNPairs={setNPairs} showInfo={showInfo} setShowInfo={setShowInfo}
              onAccept={() => accept(proposal)} onDecline={decline} busy={busy}
              secondary={!!evaluated}
            />
          )}
          {evaluated && proposal && <div style={{ marginTop: 14 }}><div className="tiny muted" style={{ fontWeight: 600, marginBottom: 6 }}>Letztes Ergebnis</div><ResultView t={evaluated} compact /></div>}
          {!active && !proposal && !evaluated && (
            <div style={{ marginTop: 10 }}>
              <p className="muted" style={{ margin: 0 }}>Kein aktives Experiment. Ein neuer Vorschlag erscheint nach dem Cooldown oder sobald genug Dosis-Wirkungs-Daten vorliegen.</p>
              <button className="btn btn-ghost tiny" style={{ marginTop: 6 }} disabled={busy} onClick={reactivate}>Vorschläge wieder aktivieren</button>
              <span className="tiny muted" style={{ marginLeft: 8 }}>(hebt einen versehentlichen „Ablehnen“-Cooldown auf)</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- Zustand 1: Vorschlag + zweistufiger Consent ----------------------------
function ProposalView({ p, proposals, onSelectProposal, nPairs, setNPairs, showInfo, setShowInfo, onAccept, onDecline, busy, secondary }: {
  p: MlProspectiveProposal; proposals: MlProspectiveProposal[]; onSelectProposal: (p: MlProspectiveProposal) => void;
  nPairs: number; setNPairs: (n: number) => void; showInfo: boolean; setShowInfo: (b: boolean) => void;
  onAccept: () => void; onDecline: () => void; busy: boolean; secondary: boolean;
}) {
  const blocks = nPairs * 2;
  const weeksTotal = blocks * (p.defaults.blockWeeks + p.defaults.washoutWeeks);
  return (
    <div style={{ marginTop: secondary ? 6 : 12, border: "1px solid var(--border-faint)", borderRadius: 10, padding: 14 }}>
      {proposals.length > 1 && (
        <div style={{ marginBottom: 12 }}>
          <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 5 }}>Trial-Ranking</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 8 }}>
            {proposals.map((q, i) => (
              <button key={q.proposalHash} type="button" className="btn btn-ghost" onClick={() => onSelectProposal(q)}
                style={{ display: "flex", alignItems: "center", gap: 6, textAlign: "left", justifyContent: "flex-start", borderColor: q.proposalHash === p.proposalHash ? "var(--accent)" : "var(--border-faint)", background: q.proposalHash === p.proposalHash ? "var(--surface2)" : undefined }}>
                <span style={{ fontWeight: 700 }}>#{i + 1}</span>
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{q.armA.label} vs {q.armB.label}</span>
                <span className="tiny muted" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>{q.score}/100</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ fontSize: 15, fontWeight: 700 }}>Vorschlag: <span style={{ color: "var(--accent, #0ea5e9)" }}>{p.armA.label}</span> vs <span style={{ color: "var(--accent, #0ea5e9)" }}>{p.armB.label}</span></div>
      <div className="tiny muted" style={{ marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, color: "var(--accent)" }}>Score {p.score}/100</span>
        <span>{p.rankLabel}</span>
        <span>Risiko {p.risk}</span>
        <span>ca. {p.durationWeeks} Wochen bis zum geprüften Verdikt</span>
      </div>
      <p className="tiny muted" style={{ marginTop: 4 }}><strong>Warum dieser Vorschlag:</strong> {p.rationale}</p>
      <div className="tiny muted" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <span>Daten {p.scores.data}</span><span>Nutzen {p.scores.benefit}</span><span>Dauer {p.scores.duration}</span><span>Risiko {p.scores.risk}</span><span>Erklärbarkeit {p.scores.explainability}</span>
      </div>
      {proposals.length > 1 && p.proposalHash === proposals[0]?.proposalHash && (
        <div className="tiny muted" style={{ marginTop: 6 }}>
          <strong>Warum nicht die anderen:</strong>
          <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
            {proposals.slice(1).map((alt) => (
              <li key={alt.proposalHash}>{alt.armA.label} vs {alt.armB.label} — {whyNotReason(p, alt)}</li>
            ))}
          </ul>
        </div>
      )}

      <button className="btn btn-ghost tiny" style={{ marginTop: 2 }} onClick={() => setShowInfo(!showInfo)}>{showInfo ? "▾ Aufklärung ausblenden" : "▸ Was heißt das? (bitte vor dem Annehmen lesen)"}</button>
      {showInfo && (
        <div className="tiny" style={{ marginTop: 8, padding: "10px 12px", background: "var(--bg-soft, rgba(127,127,127,0.06))", borderRadius: 8, lineHeight: 1.55 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>Wie:</strong> {nPairs} Paare à 2 Blöcke ({p.defaults.blockWeeks} Wo Training + {p.defaults.washoutWeeks} Wo Washout). Je Paar wird die Reihenfolge (A→B oder B→A) per festem Seed <em>ausgewürfelt</em> — das neutralisiert Saison-Trend und Nachwirkungen.</li>
            <li><strong>Load-matched:</strong> beide Arme haben dasselbe Wochen-TSS. Nur der Reiz-Mix unterscheidet sich — das ist der ganze Kontrast.</li>
            <li><strong>Erfolgsschwelle:</strong> als bedeutsam zählt ein Vorsprung von <strong>Δ ≥ {p.defaults.mcid}</strong> latenten Fitness-Punkten — an deine Messgenauigkeit angepasst (nie unter dem physiologischen Minimum). So wird Messrauschen nicht als Effekt verkauft.</li>
            <li><strong>Ehrlichkeit:</strong> Ein „geprüft"-Verdikt ist frühestens ab <strong>{p.defaults.pairsForSignif} sauberen Paaren</strong> möglich (bestes erreichbares zweiseitiges p = 2/2^P). {nPairs} Paare ≈ {weeksTotal} Wochen. Vorher: „Hypothese" oder „nicht trennbar" — beides gültige Ergebnisse.</li>
            <li><strong>Sicherheit geht vor:</strong> Periodisierung, rote Readiness und Gesundheits-Flags übersteuern den Block <em>immer</em> (pausieren · easy substituieren · verlängern). Korrumpierte Fenster werden aus dem Kontrast ausgeschlossen.</li>
          </ul>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        <label className="tiny muted">Geplante Paare:
          <select value={nPairs} onChange={(e) => setNPairs(Number(e.target.value))} style={{ marginLeft: 6 }} disabled={busy}>
            {[4, 6, 8, 10].map((n) => <option key={n} value={n}>{n} Paare ({n * 2} Blöcke, ≈{n * 2 * (p.defaults.blockWeeks + p.defaults.washoutWeeks)} Wo)</option>)}
          </select>
        </label>
        <div style={{ flex: 1 }} />
        <button className="btn" disabled={busy} onClick={onAccept}>Annehmen & starten</button>
        <button className="btn btn-ghost" disabled={busy} onClick={onDecline}>Ablehnen (4 Wo)</button>
      </div>
      {nPairs < p.defaults.pairsForSignif && <p className="tiny muted" style={{ marginTop: 8, marginBottom: 0, color: "var(--warn)" }}>Hinweis: Mit &lt; {p.defaults.pairsForSignif} Paaren ist ein „geprüft"-Verdikt rechnerisch nicht erreichbar — das Experiment bleibt dann bei „Hypothese".</p>}
    </div>
  );
}

// ---- Zustand 2: aktiver Trial (Fortschritt + Schedule) ----------------------
function ActiveView({ t, onAbort, busy }: { t: MlProspectiveTrial; onAbort: () => void; busy: boolean }) {
  const blocks = parseBlocks(t);
  const today = todayIso();
  const total = blocks.length;
  const armLabel = (v: string) => (v === t.arm_a ? t.arm_a_label ?? v : v === t.arm_b ? t.arm_b_label ?? v : v);
  const curIdx = blocks.findIndex((b) => b.startDate <= today && today <= b.endDate);
  const nextUpcoming = blocks.find((b) => b.startDate > today) ?? null;
  const current = curIdx >= 0 ? blocks[curIdx] : nextUpcoming;
  const doneBlocks = blocks.filter((b) => b.endDate < today).length;
  const P = t.n_pairs_done ?? 0;

  const [preview, setPreview] = useState<MlTrialBlockGen | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planResult, setPlanResult] = useState<{ written: number; skipped: number } | null>(null);
  const loadPreview = async () => { setPlanBusy(true); try { setPreview(await api.mlTrialPlanPreview(t.id)); setPlanResult(null); } catch { setPreview(null); } finally { setPlanBusy(false); } };
  const applyPlan = async () => { setPlanBusy(true); try { const r = await api.mlTrialPlanBlock(t.id); setPlanResult({ written: r.written, skipped: r.skipped }); setPreview(null); } finally { setPlanBusy(false); } };

  return (
    <div style={{ marginTop: 12, border: "1px solid var(--border-faint)", borderRadius: 10, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Läuft: {t.label}</div>
        <span className="tiny muted">Block {Math.min((curIdx >= 0 ? curIdx : doneBlocks) + 1, total)}/{total}</span>
      </div>
      {current && (
        <p className="tiny" style={{ marginTop: 6 }}>
          {curIdx >= 0 ? <>Aktueller Schwerpunkt: <strong style={{ color: "var(--accent, #0ea5e9)" }}>{armLabel(current.arm)}</strong> </> : <>Nächster Block: <strong>{armLabel(current.arm)}</strong> </>}
          <span className="muted">({fmtDate(current.startDate)} – {fmtDate(current.endDate)})</span>
        </p>
      )}
      <p className="tiny muted" style={{ marginTop: 2 }}>Folge dem gezeigten Schwerpunkt (gleiches Wochen-TSS). Auswertung {P}/{pairsForSignif(t)} Paare · bestes erreichbares p bei {P} Paaren = {achievableMinP(P).toFixed(3)}.</p>

      <ExpertDetails summary={`Schedule (${total} Blöcke)`}>
        <table className="table" style={{ width: "100%" }}>
          <thead><tr><th>Paar</th><th>Block</th><th>Schwerpunkt</th><th>Fenster</th><th>Δ Fitness</th></tr></thead>
          <tbody>
            {blocks.map((b, i) => (
              <tr key={i} style={{ opacity: b.excluded ? 0.5 : 1 }}>
                <td>{b.pair + 1}</td>
                <td>{i % 2 === 0 ? "A" : "B"}</td>
                <td>{armLabel(b.arm)}{b.excluded && <span className="tiny" style={{ color: "var(--warn)", marginLeft: 4 }}>(ausgeschlossen)</span>}</td>
                <td className="tiny muted">{fmtDate(b.startDate)}–{fmtDate(b.endDate)}</td>
                <td>{b.outcome != null ? b.outcome.toFixed(2) : b.startDate > today ? "–" : "läuft"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ExpertDetails>

      {/* Auto-Plan: aktuellen Block in die Wochenplanung (explizit, mit Vorschau) */}
      <div style={{ marginTop: 12, borderTop: "1px solid var(--border-faint)", paddingTop: 10 }}>
        {!preview && !planResult && (
          <button className="btn btn-ghost tiny" disabled={busy || planBusy} onClick={loadPreview}>
            {planBusy ? "erzeuge Vorschau…" : "▸ Aktuellen Block in die Wochenplanung"}
          </button>
        )}
        {planResult && (
          <p className="tiny" style={{ margin: 0 }}>
            <strong style={{ color: "var(--ok)" }}>{planResult.written} Einheiten</strong> getaggt in die Wochenplanung geschrieben{planResult.skipped > 0 ? `, ${planResult.skipped} manuelle Tage übersprungen` : ""}. <button className="btn btn-ghost tiny" onClick={loadPreview} disabled={planBusy}>erneut</button>
          </p>
        )}
        {preview && (
          <div>
            <div className="tiny" style={{ fontWeight: 600 }}>Vorschau: Block „{preview.armLabel}" ({fmtDate(preview.block.startDate)} – {fmtDate(preview.block.endDate)})</div>
            <p className="tiny muted" style={{ marginTop: 2 }}>{preview.note}</p>
            <table className="table" style={{ width: "100%", marginTop: 4 }}>
              <thead><tr><th>Datum</th><th>Typ</th><th>min</th><th>TSS</th></tr></thead>
              <tbody>
                {preview.days.map((d, i) => (
                  <tr key={i}><td className="tiny">{fmtDate(d.date)}</td><td>{d.type}</td><td className="tiny muted">{d.planned_min ? Math.round(d.planned_min) : "–"}</td><td>{d.planned_tss ? Math.round(d.planned_tss) : "–"}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="tiny muted" style={{ marginTop: 4 }}>Manuelle Einheiten am selben Tag bleiben unberührt (werden übersprungen). Abbrechen des Trials löscht nur diese getaggten Einheiten.</p>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button className="btn" disabled={planBusy} onClick={applyPlan}>{planBusy ? "schreibe…" : "Übernehmen"}</button>
              <button className="btn btn-ghost" disabled={planBusy} onClick={() => setPreview(null)}>Verwerfen</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button className="btn btn-ghost tiny" disabled={busy} onClick={onAbort}>Abbrechen</button>
      </div>
    </div>
  );
}

// ---- Zustand 3/4: Ergebnis (Verdikt-Chip, θ̂, p) ----------------------------
const VERDICT_CHIP: Record<string, { label: string; color: string; solid?: boolean }> = {
  geprueft: { label: "geprüft (randomisiert)", color: "var(--ok)", solid: true },
  hypothese: { label: "Hypothese", color: "var(--muted)" },
  inconclusive: { label: "bei dir gleichwertig", color: "#0ea5e9" },
  insufficient: { label: "sammelt noch Paare", color: "var(--muted)" },
};
function ResultView({ t, compact }: { t: MlProspectiveTrial; compact?: boolean }) {
  const P = t.n_pairs_done ?? 0;
  const need = pairsForSignif(t);
  const chip = VERDICT_CHIP[t.verdict ?? "insufficient"] ?? VERDICT_CHIP.insufficient;
  const label = t.verdict === "geprueft" ? `geprüft (randomisiert, n=${P})` : chip.label;
  const armLabel = (v: string | null) => (v === t.arm_a ? t.arm_a_label ?? v : v === t.arm_b ? t.arm_b_label ?? v : v);
  const dir = t.theta != null ? (t.theta > 0 ? armLabel(t.arm_a) : armLabel(t.arm_b)) : null;

  return (
    <div style={{ marginTop: compact ? 6 : 12, border: `1px solid ${t.verdict === "geprueft" ? "var(--ok)" : "var(--border-faint)"}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: chip.solid ? "#fff" : chip.color, background: chip.solid ? chip.color : "transparent", border: `1px solid ${chip.color}`, borderRadius: 999, padding: "1px 10px", whiteSpace: "nowrap" }}>● {label}</span>
        {!compact && <span style={{ fontSize: 14, fontWeight: 600 }}>{t.label}</span>}
      </div>

      {t.verdict === "geprueft" && dir && (
        <p className="tiny" style={{ marginTop: 8 }}><strong style={{ color: "var(--ok)" }}>{dir}</strong> wirkt bei dir messbar stärker. Δ {t.theta!.toFixed(2)} latente-Fitness-Einheiten (Arm A − B), p = {t.p_exact?.toFixed(3)}, {P} saubere Paare.</p>
      )}
      {t.verdict === "hypothese" && (
        <p className="tiny" style={{ marginTop: 8 }}>Richtung sichtbar{dir ? <> (zugunsten <strong>{dir}</strong>)</> : ""}: Δ {t.theta?.toFixed(2)}, aber p = {t.p_exact?.toFixed(3)} noch nicht signifikant. <span className="muted">{P}/{need} Paare · bestes erreichbares p bei {P} Paaren = {achievableMinP(P).toFixed(3)}.</span></p>
      )}
      {t.verdict === "inconclusive" && (
        <p className="tiny" style={{ marginTop: 8 }}>Kein bedeutsamer Unterschied (Δ {t.theta?.toFixed(2)} unter der Relevanzschwelle) — für dich sind die Arme gleichwertig. <strong>Trainiere ausgewogen.</strong> <span className="muted">Ein valides Ergebnis, kein Fehlschlag.</span></p>
      )}
      {t.verdict === "insufficient" && (
        <p className="tiny muted" style={{ marginTop: 8 }}>Erst {P}/{need} saubere Paare — ein Verdikt ist ab {need} Paaren möglich.</p>
      )}
    </div>
  );
}
