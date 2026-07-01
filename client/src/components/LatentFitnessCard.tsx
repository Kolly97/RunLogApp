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
