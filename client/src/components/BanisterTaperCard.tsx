// Banister-Taper-Karte (L4): athleten-kalibriertes Fitness−Fatigue-Modell → optimales Taper/Peaking.
// „Wie viele Tage lockerer bis zum Form-Peak — und wie viel bringt es?", gerechnet aus DEINEN Leistungsmarkern.
// PROGNOSE/MODELL, kein Messwert — mit Unsicherheitsband; bei dünner Datenlage gilt das Standard-Taper der Phase.
import { useEffect, useRef, useState } from "react";
import { api, type MlStatus, type MlBanister, type MlBanisterTrajPoint } from "../lib/api.ts";

const FRESH_LABEL: Record<string, string> = { fresh: "aktuell", stale: "veraltet", none: "noch nicht berechnet", running: "rechnet…" };
const FRESH_COLOR: Record<string, string> = { fresh: "var(--ok)", stale: "var(--warn)", none: "var(--muted)", running: "#0ea5e9" };

/** Taper-Trajektorie: Mittel-Linie + Band, Nulllinie gestrichelt, Peak-Tag markiert. */
function TaperSpark({ points, peakDay }: { points: MlBanisterTrajPoint[]; peakDay: number }) {
  const W = 220, H = 44;
  const min = Math.min(0, ...points.map((p) => p.lo));
  const max = Math.max(0.01, ...points.map((p) => p.hi));
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / (max - min)) * H;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.mean).toFixed(1)}`).join(" ");
  const band = [...points.map((p, i) => `${x(i).toFixed(1)},${y(p.hi).toFixed(1)}`), ...points.slice().reverse().map((p, i) => `${x(points.length - 1 - i).toFixed(1)},${y(p.lo).toFixed(1)}`)].join(" ");
  const pkX = x(Math.max(0, peakDay - 1));
  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      <polygon points={band} fill="var(--accent, #0ea5e9)" opacity={0.13} />
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeWidth={0.5} strokeDasharray="2 2" />
      <line x1={pkX} x2={pkX} y1={0} y2={H} stroke="var(--ok)" strokeWidth={0.8} strokeDasharray="2 2" />
      <path d={line} fill="none" stroke="var(--accent, #0ea5e9)" strokeWidth={1.5} />
    </svg>
  );
}

export default function BanisterTaperCard() {
  const [status, setStatus] = useState<MlStatus | null>(null);
  const [ban, setBan] = useState<MlBanister | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);
  const runIdRef = useRef<number | null>(null);
  const t0Ref = useRef<number>(0);

  const load = () => {
    api.mlStatus("banister").then(setStatus).catch(() => setStatus(null));
    api.mlBanister().then(setBan).catch(() => setBan(null));
  };
  useEffect(() => {
    load();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []);

  const startPoll = (runId: number) => {
    pollRef.current = window.setInterval(async () => {
      const pr = await api.mlProgress(runId).catch(() => null);
      if (t0Ref.current && Date.now() - t0Ref.current > 1_260_000 && (!pr || pr.status === "running")) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null; runIdRef.current = null; setBusy(false); load(); return;
      }
      if (!pr || ["done", "failed", "cancelled"].includes(pr.status)) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null; runIdRef.current = null; setBusy(false); load();
      }
    }, 700);
  };

  const recompute = async () => {
    setBusy(true);
    t0Ref.current = Date.now();
    try {
      const { runId } = await api.mlRecompute("banister");
      runIdRef.current = runId;
      startPoll(runId);
    } catch { setBusy(false); }
  };
  const reset = async () => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    const id = runIdRef.current;
    runIdRef.current = null;
    setBusy(false);
    if (id != null) { try { await api.mlCancel(id); } catch { /* egal */ } }
    load();
  };

  const fr = status?.freshness;
  const running = busy || fr?.state === "running";
  const r = ban?.result ?? null;
  const insufficient = ban?.insufficient || (ban != null && !r);
  const isPymc = (r?.method ?? "").startsWith("pymc");
  const gainDisp = r ? r.peak_gain_disp : 0;
  const gainLoDisp = r ? r.peak_low * r.scale_perf : 0;
  const gainHiDisp = r ? r.peak_high * r.scale_perf : 0;
  const helps = !!r && r.peak_gain > 0;
  const uncertain = !!r && r.peak_low <= 0; // Band überlappt 0 → keine belastbare Aussage

  return (
    <div className="card" data-tour="banister" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>
          Dein optimales Taper <span className="tiny muted">— wann bist du frisch & spitz?</span>
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {fr && (
            <span title={fr.reason ?? ""} style={{ fontSize: 10.5, fontWeight: 600, color: FRESH_COLOR[fr.state], border: `1px solid ${FRESH_COLOR[fr.state]}`, borderRadius: 999, padding: "0 8px", lineHeight: 1.7, whiteSpace: "nowrap" }}>
              ● {FRESH_LABEL[fr.state]}
            </span>
          )}
          <button className="btn btn-ghost" onClick={running ? reset : recompute} title={running ? "Läuft — klick zum Abbrechen" : "Aus deinen Leistungsmarkern berechnen"}>
            {running ? "rechnet… — ✕ abbrechen" : "Berechnen"}
          </button>
        </div>
      </div>

      <p className="tiny muted" style={{ marginTop: 6, maxWidth: 760 }}>
        Ein an <strong>deine</strong> Leistungsmarker gefittetes Fitness/Fatigue-Modell: Ermüdung klingt schneller ab als
        Fitness, deshalb steigt deine Form ein paar Tage nachdem du die Last zurückfährst. <strong>Prognose, kein
        Messwert</strong> — mit Unsicherheitsband. „🎯 Peak ausrichten" im Wettkampf-Block <strong>nutzt diese Taperzeit</strong>,
        um den Block auf den Renntag auszurichten.
      </p>

      {!r ? (
        <p className="muted" style={{ marginTop: 6 }}>
          {insufficient
            ? "Noch zu wenig Leistungsmarker für ein persönliches Taper — es gilt das Standard-Taper der Phase (siehe „🎯 Peak ausrichten“ im Wettkampf-Block)."
            : fr?.state === "none" ? "Noch nicht berechnet — klick „Berechnen“." : "Noch keine Daten."}
        </p>
      ) : (
        <>
          {/* Engine-Hinweis (wie Dose-Karte): pymc = persönlich gefittet, ts = Standard-Verhältnis */}
          <div className="tiny" style={{ margin: "2px 0 8px", color: isPymc ? "var(--ok)" : "var(--muted)" }}>
            Engine: {isPymc ? `Bayes (${r.method})` : "TS (Standard-Fatigue-Verhältnis)"} · {r.fit_tau ? "τ persönlich gefittet" : "τ Standard (42/11 d)"} · aus {r.n_obs} Wochen-Markern
          </div>

          {helps ? (
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", margin: "4px 0 6px" }}>
              <div>
                <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{r.taper_days} <span style={{ fontSize: 14, fontWeight: 500 }}>{r.taper_days === 1 ? "Tag" : "Tage"}</span></div>
                <div className="tiny muted">reduzierte Last bis zum Form-Peak</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 600, color: uncertain ? "var(--warn)" : "var(--ok)" }}>
                  {gainDisp > 0 ? "+" : ""}{gainDisp.toFixed(1)} <span className="tiny muted" style={{ fontWeight: 400 }}>VO₂-äquiv.</span>
                </div>
                <div className="tiny muted">Prognose · Band [{gainLoDisp.toFixed(1)}, {gainHiDisp.toFixed(1)}]</div>
              </div>
              <TaperSpark points={r.trajectory} peakDay={r.peak_day} />
            </div>
          ) : (
            <p style={{ margin: "4px 0 6px", fontSize: 13.5 }}>
              <strong>Kein klarer Taper-Vorteil modelliert</strong> — dein geschätztes Fitness/Fatigue-Verhältnis ergibt
              aus reduzierter Last keinen nennenswerten Form-Gewinn.
            </p>
          )}

          {uncertain && helps && (
            <p className="tiny" style={{ margin: "0 0 6px", color: "var(--warn)" }}>
              ⚠ Unsicher: Das Band überlappt 0 — dein Datenstand trägt noch keine belastbare Taper-Aussage. Mehr Rennen/
              Labor-Werte schärfen sie.
            </p>
          )}
          {r.reasons?.length > 0 && (
            <p className="tiny muted" style={{ margin: "0 0 6px" }}>{r.reasons.join(" · ")}</p>
          )}

          <details style={{ marginTop: 4 }}>
            <summary className="tiny muted" style={{ cursor: "pointer" }}>Modell-Interna (deine Fitness:Fatigue-Balance)</summary>
            <div className="tiny muted" style={{ lineHeight: 1.6, marginTop: 4 }}>
              <div>Fitness-Gewicht k1 = {r.k1.toFixed(2)} [{r.k1_low.toFixed(2)}, {r.k1_high.toFixed(2)}] · Fatigue-Gewicht k2 = {r.k2.toFixed(2)} [{r.k2_low.toFixed(2)}, {r.k2_high.toFixed(2)}]</div>
              <div>Fatigue:Fitness-Verhältnis ρ = {r.ratio.toFixed(2)} {r.fit_tau ? "(gefittet)" : "(Standard-Prior)"} · Zeitkonstanten τ₁ = {r.tau1.toFixed(0)} d (Fitness) / τ₂ = {r.tau2.toFixed(0)} d (Fatigue)</div>
              <div>Modell: perf = p0 + k1·Fitness − k2·Fatigue (EWMA-Faltung der Tageslast). {r.coverage_ok ? "Datenlage trägt τ-Fitting." : "τ fix — zu wenig belastbare Marker (Rennen/Labor)."}</div>
            </div>
          </details>

          <div style={{ marginTop: 10, padding: "8px 11px", border: "1px solid var(--border-faint)", borderRadius: 8 }}>
            <div className="tiny" style={{ fontWeight: 600, marginBottom: 4 }}>ℹ️ So liest du das</div>
            <ul className="tiny muted" style={{ margin: 0, paddingLeft: 16, lineHeight: 1.55 }}>
              <li><strong>{helps ? `${r.taper_days} ${r.taper_days === 1 ? "Tag" : "Tage"}` : "—"}</strong>: so lange lockerer machen (≈55 % deiner chronischen Last), dann ist laut Modell die Form am höchsten — bei einem Rennen also der Taper-Start ≈ diese Tage vor dem Renntag.</li>
              <li>Die Kurve = prognostizierte Leistungsänderung je Tag; grün gestrichelt = der Peak. Blaues Band = 94 %-Unsicherheit.</li>
              <li><strong>Prognose, kein Beweis:</strong> das Modell lernt aus deinen bisherigen Marker-Verläufen. Mit mehr Rennen/Labor-Werten wird τ persönlich und die Aussage sicherer.</li>
              <li>Die klassische Form-Anzeige (PMC/TSB) bleibt unverändert — das hier ist die <em>kalibrierte</em> Zusatz-Sicht fürs Taper-Timing.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
