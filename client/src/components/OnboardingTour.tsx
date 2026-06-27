// Onboarding-Tour (v1.8.0): zeigt beim ERSTEN Besuch einer Seite eine kurze, geführte Schritt-für-Schritt-
// Erklärung (zentrales Overlay, kein Element-Anchoring → robust). Merkt sich „gesehen" in localStorage.
// Wiederverwendbar via storageKey + steps. Druckt nicht mit.
import { useState } from "react";

export default function OnboardingTour({ storageKey, steps }: { storageKey: string; steps: { title: string; body: string }[] }) {
  const [i, setI] = useState(0);
  const [done, setDone] = useState(() => { try { return localStorage.getItem(storageKey) === "1"; } catch { return true; } });
  if (done || !steps.length) return null;
  const finish = () => { try { localStorage.setItem(storageKey, "1"); } catch { /* ignore */ } setDone(true); };
  const s = steps[i];
  return (
    <div className="no-print" onClick={finish} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 470, width: "90%", boxShadow: "0 14px 44px rgba(0,0,0,0.28)" }}>
        <div className="tiny muted">Tour · {i + 1}/{steps.length}</div>
        <h2 style={{ marginTop: 4 }}>{s.title}</h2>
        <p style={{ fontSize: 14, lineHeight: 1.55 }}>{s.body}</p>
        <div className="spread" style={{ marginTop: 10 }}>
          <button className="sm ghost" onClick={finish}>Überspringen</button>
          <div className="row" style={{ width: "auto", gap: 6 }}>
            {i > 0 && <button className="sm ghost" onClick={() => setI(i - 1)}>Zurück</button>}
            {i < steps.length - 1
              ? <button className="sm" onClick={() => setI(i + 1)}>Weiter</button>
              : <button className="sm" onClick={finish}>Fertig</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
