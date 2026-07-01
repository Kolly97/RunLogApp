// Readiness & Gesundheit (P4): geglättete latente Readiness (Kalman) + deterministische Gesundheits-Flags
// (Übertraining/RED-S). Beschreibend, NICHT-diagnostisch (Frage 18/19). Solange zu wenig Wellness-Daten da
// sind, ehrlicher „sammelt noch Daten"-Zustand.
import { useEffect, useRef, useState } from "react";
import { api, type MlReadiness } from "../lib/api.ts";
import ReadinessChart from "../charts/ReadinessChart.tsx";

const SEV_COLOR: Record<string, string> = { high: "var(--danger)", warn: "var(--warn)", info: "#0ea5e9" };
const SEV_LABEL: Record<string, string> = { high: "hoch", warn: "Warnung", info: "Info" };
const DISCLAIMER = "Nicht-diagnostisch. Gesundheitssignale, keine Trainingsempfehlung — im Zweifel mit einer Fachperson sprechen.";

export default function ReadinessHealthCard() {
  const [r, setR] = useState<MlReadiness | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = () => api.mlReadiness().then(setR).catch(() => setR(null));
  useEffect(() => {
    load();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []);

  const recompute = async () => {
    setBusy(true);
    try {
      const { runId } = await api.mlRecompute("readiness");
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

  const insufficient = !r || r.meta?.insufficient || r.points.length < 2;
  const last = r && r.points.length ? r.points[r.points.length - 1] : null;
  const flags = r?.flags ?? [];

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Readiness & Gesundheit <span className="tiny muted">— geglättet aus HRV · RHR · Schlaf</span></h3>
        <button className="btn btn-ghost" disabled={busy} onClick={recompute}>{busy ? "rechnet…" : "neu berechnen"}</button>
      </div>
      <p className="tiny muted" style={{ marginTop: 6, maxWidth: 760 }}>
        Geglättete latente Readiness (Kalman/RTS) statt Tagesrauschen, plus deterministische Gesundheits-Signale
        (Übertraining/RED-S). <strong>Beschreibend, nicht-diagnostisch</strong> — außerhalb der Trainings-Steuerung.
      </p>

      {insufficient ? (
        <p className="muted">
          Sammelt noch Daten{r?.meta?.nDays != null ? ` (${r.meta.nDays} verwertbare Tage)` : ""} — die Readiness-Kurve
          erscheint, sobald genug HRV/RHR/Schlaf vorliegen (rollende Baseline). Trag deine Wellness-Werte nach, dann leuchtet sie auf.
        </p>
      ) : (
        <>
          <ReadinessChart points={r!.points} />
          <div className="tiny muted" style={{ marginTop: 4 }}>
            Aktuell: <strong>{last ? Math.round(last.value) : "—"}</strong> / 100 (±{last ? Math.round(last.sd) : "—"}) · 50 = deine Baseline
          </div>
        </>
      )}

      {r?.meta?.bmi != null && (
        <p className="tiny muted" style={{ marginTop: 8, marginBottom: 0 }}>BMI: <strong>{r.meta.bmi.toFixed(1)}</strong> <span>(aus Größe × aktuellem Gewicht)</span></p>
      )}
      <div style={{ marginTop: 12 }}>
        <div className="tiny" style={{ fontWeight: 600, marginBottom: 4 }}>Gesundheits-Signale</div>
        {flags.length === 0 ? (
          <p className="tiny muted" style={{ margin: 0 }}>Keine Warnsignale aktiv.</p>
        ) : (
          flags.map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: SEV_COLOR[f.severity] ?? "var(--muted)", border: `1px solid ${SEV_COLOR[f.severity] ?? "var(--muted)"}`, borderRadius: 999, padding: "0 7px", whiteSpace: "nowrap" }}>{SEV_LABEL[f.severity] ?? f.severity}</span>
              <span className="tiny">{f.message}</span>
            </div>
          ))
        )}
      </div>
      <p className="tiny muted" style={{ marginTop: 8, fontStyle: "italic" }}>{DISCLAIMER}</p>
    </div>
  );
}
