// Latente-Fitness-Karte (P1): lädt die geglättete Komposit-Trajektorie + Frische-Status, bietet
// „neu berechnen" (Hintergrund-Batch mit Fortschritts-Poll) und zeigt Modell-Interna hinter ExpertDetails.
// Beschreibend, kein Trainingsbefehl (Frage 5) — Confidence-Badge + ehrlicher Frische-Status (Frage 7).
import { useEffect, useRef, useState } from "react";
import { api, type MlStatus, type MlLatentPoint } from "../lib/api.ts";
import { fmtDateY } from "../lib/util.ts";
import ConfidenceBadge, { type ConfLevel } from "./ConfidenceBadge.tsx";
import ExpertDetails from "./ExpertDetails.tsx";
import LatentFitnessChart from "../charts/LatentFitnessChart.tsx";

const FRESH_LABEL: Record<string, string> = { fresh: "aktuell", stale: "veraltet", none: "noch nicht berechnet", running: "rechnet…" };
const FRESH_COLOR: Record<string, string> = { fresh: "var(--ok)", stale: "var(--warn)", none: "var(--muted)", running: "#0ea5e9" };

// Sportwissenschaftliche Kurz-Interpretation der Trajektorie — beschreibend, beobachtet ≠ kausal, KEIN Trainingsbefehl.
// Bounded (Statistik-Brille): eine Richtung wird nur behauptet, wenn die Veränderung im jüngsten Fenster klar über dem
// Unsicherheitsband (±SD der geglätteten Schätzung) liegt — sonst „stabil". Ursachen werden als typische Zusammenhänge
// genannt, nicht diagnostiziert (Sportwissenschaft-Brille); Framing motivierend statt alarmistisch (Psychologie-Brille).
type LatTone = "up" | "flat" | "down";
function interpretLatent(points: MlLatentPoint[]): { tone: LatTone; headline: string; detail: string } | null {
  const n = points.length;
  if (n < 8) return null;                                   // zu kurz für eine belastbare Trendaussage
  const last = points[n - 1];
  const noise = last.sd || 0.5;
  const w = Math.min(13, Math.max(6, Math.round(n / 4)));   // Fenster: jüngste ~w Wochen (wöchentliches Raster)
  const start = points[n - w];
  const weeks = Math.max(1, Math.round((Date.parse(last.date) - Date.parse(start.date)) / (7 * 86_400_000)));
  const dRecent = last.value - start.value;
  const per4 = (dRecent / weeks) * 4;
  const notable = Math.abs(dRecent) >= 1.5 * noise;         // klar über dem Rauschband?
  const tone: LatTone = !notable ? "flat" : dRecent > 0 ? "up" : "down";

  // Voller Zeitraum: Höchststand vs. aktuell (Kontext „wie weit vom Peak entfernt").
  let peak = points[0], peakI = 0;
  points.forEach((p, i) => { if (p.value > peak.value) { peak = p; peakI = i; } });
  const fromPeak = last.value - peak.value;
  const pctPeak = peak.value > 0 ? (fromPeak / peak.value) * 100 : 0;
  const peakTxt = peakI < n - w && fromPeak < -1.5 * noise
    ? ` Vom Höchststand ${peak.value.toFixed(1)} (${fmtDateY(peak.date)}) bist du aktuell ${fromPeak.toFixed(1)} (${pctPeak.toFixed(0)} %) entfernt.`
    : "";
  const rate = `≈ ${per4 >= 0 ? "+" : ""}${per4.toFixed(1)} Punkte / 4 Wochen (jüngste ${weeks} Wochen).`;

  if (tone === "up") return {
    tone, headline: "Aufwärtstrend — deine aerobe Komposit-Fitness steigt.",
    detail: `${rate} Der aktuelle Trainingsreiz baut messbar Fitness auf (beobachtet, nicht kausal).${peakTxt}`,
  };
  if (tone === "down") return {
    tone, headline: "Abwärtstrend — deine aerobe Komposit-Fitness sinkt.",
    detail: `${rate} Ein anhaltender Rückgang von CS/VDOT/VO2max hängt typischerweise mit zu wenig aerobem Reiz (Umfang/Kontinuität), unvollständiger Erholung oder einer Kranken-/Pausenphase zusammen — beobachtet, nicht diagnostiziert.${peakTxt}`,
  };
  // „Stabil" differenzieren: deutlich unter einem früheren Höchststand = eher „stabilisiert nach Rückgang".
  const belowPeak = peakTxt !== "";
  return belowPeak
    ? {
        tone, headline: "Stabilisiert — der längere Rückgang ist zuletzt zum Stillstand gekommen.",
        detail: `${rate} Kurzfristig gehalten, aber klar unter deinem früheren Höchststand — für einen Wiederaufbau braucht es wieder progressiven aeroben Reiz (Umfang/Kontinuität), sofern Gesundheit und Erholung es zulassen.${peakTxt}`,
      }
    : {
        tone, headline: "Stabil — Fitness gehalten.",
        detail: `${rate} Dein Reiz erhält die Fitness; für weiteren Aufbau braucht es einen neuen oder größeren Reiz (mehr aerobes Volumen oder gezielte Intensität).${peakTxt}`,
      };
}

export default function LatentFitnessCard() {
  const [status, setStatus] = useState<MlStatus | null>(null);
  const [points, setPoints] = useState<MlLatentPoint[]>([]);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = () => {
    api.mlStatus().then(setStatus).catch(() => setStatus(null));
    api.mlLatentFitness().then(setPoints).catch(() => setPoints([]));
  };
  useEffect(() => {
    load();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []);

  const recompute = async () => {
    setBusy(true);
    try {
      const { runId } = await api.mlRecompute();
      pollRef.current = window.setInterval(async () => {
        const pr = await api.mlProgress(runId).catch(() => null);
        if (!pr || ["done", "failed", "cancelled"].includes(pr.status)) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setBusy(false);
          load();
        }
      }, 600);
    } catch {
      setBusy(false);
    }
  };

  const fr = status?.freshness;
  const nObs = points.length;
  const last = points.length ? points[points.length - 1] : null;
  const conf: ConfLevel = nObs < 20 ? "niedrig" : nObs < 80 ? "mittel" : "hoch";
  const running = busy || fr?.state === "running";

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>
          Latente Fitness <span className="tiny muted">— Komposit aus CS · VDOT · VO2max (geglättet)</span>
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {fr && (
            <span title={fr.reason ?? ""} style={{ fontSize: 10.5, fontWeight: 600, color: FRESH_COLOR[fr.state], border: `1px solid ${FRESH_COLOR[fr.state]}`, borderRadius: 999, padding: "0 8px", lineHeight: 1.7, whiteSpace: "nowrap" }}>
              ● {FRESH_LABEL[fr.state]}
            </span>
          )}
          <ConfidenceBadge level={conf} n={nObs} />
          <button className="btn btn-ghost" disabled={running} onClick={recompute}>{running ? "rechnet…" : "neu berechnen"}</button>
        </div>
      </div>
      <p className="tiny muted" style={{ marginTop: 6, maxWidth: 720 }}>
        Deine verrauschten Fitness-Messungen (eff. VO2max je Lauf, Rennen-VDOT, Labor) als <strong>eine</strong> geglättete
        Trajektorie mit Unsicherheitsband (±1&nbsp;SD). State-Space-Schätzung (Kalman/RTS), deterministisch —{" "}
        <strong>beschreibend, kein Trainingsbefehl</strong>.
      </p>
      {points.length < 2 ? (
        <p className="muted">{fr?.state === "none" ? "Noch nicht berechnet — klick „neu berechnen“." : "Noch zu wenig Daten."}</p>
      ) : (
        <>
          <LatentFitnessChart points={points} />
          <div className="tiny muted" style={{ marginTop: 4 }}>
            Aktuell: <strong>{last ? last.value.toFixed(1) : "—"}</strong> (±{last ? last.sd.toFixed(1) : "—"}) · {nObs} Punkte (VO2-äquivalent)
          </div>
          {(() => {
            const it = interpretLatent(points);
            if (!it) return null;
            const c = it.tone === "up" ? "var(--ok)" : it.tone === "down" ? "var(--warn)" : "var(--muted)";
            return (
              <div style={{ marginTop: 8, padding: "8px 10px", borderLeft: `3px solid ${c}`, background: "var(--bg-soft, rgba(127,127,127,0.05))", borderRadius: 6 }}>
                <div className="tiny" style={{ fontWeight: 700 }}>{it.headline}</div>
                <div className="tiny muted" style={{ marginTop: 2, lineHeight: 1.55 }}>{it.detail}</div>
              </div>
            );
          })()}
        </>
      )}
      <ExpertDetails summary="Modell-Interna">
        <div className="tiny muted" style={{ lineHeight: 1.6 }}>
          <div>Modell: lokaler Linear-Trend Kalman-Filter + RTS-Smoother (wöchentliches Raster), deterministisch.</div>
          <div>Zielgröße: Komposit-Faktor — CS/VDOT/VO2max als verrauschte Indikatoren <em>eines</em> latenten Zustands (Frage 3).</div>
          <div>
            Letzter Lauf:{" "}
            {status?.latest
              ? `#${status.latest.id} · ${status.latest.engine ?? "?"} · v${status.latest.model_version ?? "?"} · ${status.latest.finished_at ? fmtDateY(status.latest.finished_at.slice(0, 10)) : "—"} · Hash ${status.latest.input_hash ?? "—"}`
              : "—"}
          </div>
          <div>Unsicherheitsband = ±1&nbsp;SD der geglätteten Schätzung; an datenreichen Stellen eng, an den Rändern breiter.</div>
        </div>
      </ExpertDetails>
    </div>
  );
}
