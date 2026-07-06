// v2.8.0 (Item 2): retrospektive Fitness-Sprung-Erkennung — wann gab es einen signifikanten Fortschritt ODER
// Rückschritt in der latenten Fitness (L2), und was war im Kontext-Fenster DAVOR los (rein deskriptiv, kein
// Ranking — bei n=1 pro Fenster wäre eine Kausal-Aussage nicht haltbar). Sachlich gerahmt, kein Vorwurf bei
// Rückschritten. Konfundierungs-Hinweis, falls das Fenster mit einer Taper-/Entlastungsphase überlappt.
import { useEffect, useState } from "react";
import { api, type GainWindow } from "../lib/api.ts";
import { fmtDateY } from "../lib/util.ts";
import ExpertDetails from "./ExpertDetails.tsx";

const fmt = (v: number | null, d = 1): string => (v == null ? "—" : v.toFixed(d));

function ContextRow({ w }: { w: GainWindow }) {
  const c = w.context;
  const hasLog = c.nDays > 0;
  return (
    <div className="tiny muted" style={{ lineHeight: 1.6 }}>
      <div>Kontext-Fenster {fmtDateY(w.contextStart)} – {fmtDateY(w.contextEnd)} (die Wochen VOR dem Sprung — Trainingsadaption braucht Zeit) · {w.context.nActivities} Aktivitäten{w.phases.length ? ` · Phase: ${w.phases.join(", ")}` : ""}</div>
      {hasLog ? (
        <div>Schlaf Ø {fmt(c.sleepH)} h · HRV Ø {fmt(c.hrv, 0)} · Stimmung Ø {fmt(c.mood, 1)} · Stress Ø {fmt(c.stress, 1)} · Energie Ø {fmt(c.energy, 1)} ({c.nDays} Tage erfasst)</div>
      ) : (
        <div>Keine Tageswerte (Schlaf/HRV/Stimmung) für dieses Fenster erfasst.</div>
      )}
      {w.zoneMix && (
        <div>Zonen-Mix: Z1 {fmt(w.zoneMix.z1, 0)}% · Z2 {fmt(w.zoneMix.z2, 0)}% · Z3 {fmt(w.zoneMix.z3, 0)}%{w.polarizationIndex != null ? ` · Polarisierungs-Index ${fmt(w.polarizationIndex, 2)}` : ""}</div>
      )}
      {w.healthFlags.length > 0 && (
        <div style={{ color: "var(--warn)" }}>⚠ {w.healthFlags.map((f) => f.message).join(" · ")}</div>
      )}
    </div>
  );
}

export default function FitnessGainWindowsCard() {
  const [windows, setWindows] = useState<GainWindow[] | null>(null);

  useEffect(() => {
    api.mlFitnessGainWindows().then((r) => setWindows(r.windows)).catch(() => setWindows([]));
  }, []);

  return (
    <div className="card">
      <h3 style={{ margin: 0 }}>Fitness-Sprünge <span className="tiny muted">— wann hat sich deine Fitness spürbar verändert?</span></h3>
      <p className="tiny muted" style={{ marginTop: 6, maxWidth: 720 }}>
        Erkennt Zeitpunkte, an denen sich deine latente Fitness signifikant verändert hat — Fortschritt UND
        Rückschritt (sachlich gerahmt, kein Vorwurf). Zeigt den Kontext der Wochen DAVOR (Schlaf/Zonen-Mix/Phase),
        rein deskriptiv — bei einem einzelnen Fenster ist keine Kausal-Aussage statistisch haltbar, die Deutung
        bleibt bei dir.
      </p>
      {windows == null ? (
        <p className="tiny muted">Lädt…</p>
      ) : windows.length === 0 ? (
        <p className="tiny muted">Noch keine signifikanten Sprünge erkannt (braucht eine längere latente-Fitness-Historie).</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          {[...windows].reverse().map((w, i) => {
            const col = w.direction === "gain" ? "var(--ok)" : "var(--danger)";
            return (
              <div key={i} style={{ borderLeft: `3px solid ${col}`, paddingLeft: 10 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ color: col }}>{w.direction === "gain" ? "▲ Fortschritt" : "▼ Rückschritt"}</strong>
                  <span className="tiny muted">{fmtDateY(w.breakDate)} · Δ {w.deltaLatent >= 0 ? "+" : ""}{fmt(w.deltaLatent)} · Effektstärke {fmt(w.effectSize, 2)} ({fmt(w.beforeMean)} → {fmt(w.afterMean)})</span>
                </div>
                {w.confound && <div className="tiny" style={{ color: "var(--warn)", marginTop: 2 }}>⚠ {w.confound}</div>}
                <ExpertDetails summary="Kontext (was war davor los)">
                  <ContextRow w={w} />
                </ExpertDetails>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
