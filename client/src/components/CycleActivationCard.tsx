// Profil-Einstieg für die optionale Zyklus-Trainingssteuerung (Q14, v2.3.0).
// Aktiviert/deaktiviert dieselbe Consent-Einstellung wie CycleScaffoldCard (Methodik → Zyklus);
// steuert dort die Tab-Sichtbarkeit und in WeekTrack das Symptom-Mini-Modul.
import { useEffect, useState } from "react";
import { api, type CycleStatus, type CycleMethod } from "../lib/api.ts";
import { METHOD_LABEL } from "./CycleScaffoldCard.tsx";

export default function CycleActivationCard() {
  const [st, setSt] = useState<CycleStatus | null>(null);
  const [method, setMethod] = useState<CycleMethod>("none");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const s = await api.cycleStatus();
      setSt(s);
      if (s.contraception?.method) setMethod(s.contraception.method);
    } catch { setSt(null); }
  };
  useEffect(() => { load(); }, []);

  const enable = async () => { setBusy(true); try { await api.cycleConsent(true, { method }); await load(); } finally { setBusy(false); } };
  const disable = async () => { setBusy(true); try { await api.cycleConsent(false); await load(); } finally { setBusy(false); } };

  const enabled = st?.needsConsent === false;

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Zyklus-Trainingssteuerung</h2>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)", border: "1px solid var(--muted)", borderRadius: 999, padding: "0 7px" }}>
          {!st ? "…" : enabled ? "aktiviert" : "aus"}
        </span>
      </div>
      <p className="tiny muted" style={{ marginTop: 6, maxWidth: 640 }}>
        Optionale, zyklusadaptive Trainings-Beobachtung (N-of-1, Beobachtungsmodus). Standardmäßig aus. Erst nach
        Aktivierung hier erscheint der Zyklus-Tab in der Methodik-Seite und das Symptom-Tagesmodul im Tracking.
        Daten bleiben lokal auf diesem Gerät.
      </p>
      {!enabled ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <label className="tiny muted">Verhütung/Status:
            <select value={method} onChange={(e) => setMethod(e.target.value as CycleMethod)} style={{ marginLeft: 6 }} disabled={busy}>
              {(Object.keys(METHOD_LABEL) as CycleMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
            </select>
          </label>
          <div style={{ flex: 1 }} />
          <button className="btn" disabled={busy || !st} onClick={enable}>Aktivieren</button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <span className="tiny muted">Details, Perioden-Log und Symptome findest du in Methodik → Zyklus.</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost tiny" disabled={busy} onClick={disable}>Deaktivieren</button>
        </div>
      )}
    </div>
  );
}
