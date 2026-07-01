// Dosis-Wirkungs-Karte (L3, P2): „Was wirkt bei DIR?" — Forest-Plot der Reiz-Kanal-Effekte auf die latente
// Fitness, Modell-Umschalter Mediator/Komposition (Sensitivität, Frage 11), Verdikt + ehrliches Framing.
// BEOBACHTEND → as-if causal / Hypothese (das geprüfte Verdikt liefern erst die prospektiven Blöcke, P5).
import { useEffect, useRef, useState } from "react";
import { api, type MlSettings, type MlStatus, type MlEffects } from "../lib/api.ts";
import { fmtDateY } from "../lib/util.ts";
import ExpertDetails from "./ExpertDetails.tsx";
import ForestPlot from "../charts/ForestPlot.tsx";

const FRESH_LABEL: Record<string, string> = { fresh: "aktuell", stale: "veraltet", none: "noch nicht berechnet", running: "rechnet…" };
const FRESH_COLOR: Record<string, string> = { fresh: "var(--ok)", stale: "var(--warn)", none: "var(--muted)", running: "#0ea5e9" };

export default function DoseResponseCard() {
  const [status, setStatus] = useState<MlStatus | null>(null);
  const [eff, setEff] = useState<MlEffects | null>(null);
  const [settings, setSettings] = useState<MlSettings | null>(null);
  const [model, setModel] = useState<"mediator" | "composition">("mediator");
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

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
      if (!pr || ["done", "failed", "cancelled"].includes(pr.status)) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setBusy(false);
        load();
      }
    }, 700);
  };

  const recompute = async () => {
    setBusy(true);
    try {
      const { runId } = await api.mlRecompute("dose_response");
      startPoll(runId);
    } catch {
      setBusy(false);
    }
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
      const { runId } = await api.mlRecompute("dose_response");
      startPoll(runId);
    } catch {
      setBusy(false);
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
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>
          Was wirkt bei dir? <span className="tiny muted">— Reiz-Kanäle → latente Fitness</span>
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {fr && (
            <span title={fr.reason ?? ""} style={{ fontSize: 10.5, fontWeight: 600, color: FRESH_COLOR[fr.state], border: `1px solid ${FRESH_COLOR[fr.state]}`, borderRadius: 999, padding: "0 8px", lineHeight: 1.7, whiteSpace: "nowrap" }}>
              ● {FRESH_LABEL[fr.state]}
            </span>
          )}
          <button className="btn btn-ghost" disabled={running} onClick={recompute}>{running ? "rechnet…" : "neu berechnen"}</button>
        </div>
      </div>
      <p className="tiny muted" style={{ marginTop: 6, maxWidth: 760 }}>
        Welcher Trainingsreiz baut <strong>bei dir</strong> die Fitness — VO2max, Schwelle oder aerob (Long/Easy)?
        Regularisierte Regression der latenten Fitness auf die kanal-spezifische Trainingslast, mit ehrlichen
        Block-Bootstrap-CIs. <strong>Beobachtung, kein Beweis</strong> — Korrelation/„as-if causal"; das
        <em> geprüfte</em> Verdikt liefern erst die geplanten randomisierten Blöcke.
      </p>

      {/* Modell-Umschalter (Sensitivität, Frage 11) */}
      <div style={{ display: "flex", gap: 6, margin: "8px 0 4px" }}>
        {(["mediator", "composition"] as const).map((m) => (
          <button
            key={m}
            className="btn btn-ghost"
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
        <p className="muted">{fr?.state === "none" ? "Noch nicht berechnet — klick „neu berechnen“." : "Noch zu wenig Daten."}</p>
      ) : (
        <>
          <ForestPlot effects={rows} />
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
