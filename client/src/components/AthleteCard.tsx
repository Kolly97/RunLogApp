// Athletendaten (v0.15.0): Geburtsjahr/Geschlecht/Gewicht/Max-HF im `athlete`-Setting.
// Geburtsjahr + Geschlecht sind Grundlage für die alters-/geschlechtsgradierte VO2max-Einordnung.
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";

interface Athlete { name?: string; weight?: number | null; max_hr?: number | null; birth_year?: number | null; sex?: "m" | "f"; }

export default function AthleteCard() {
  const [a, setA] = useState<Athlete>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.settings().then((s) => setA((s?.athlete as Athlete) || {})).catch(() => {});
  }, []);

  const save = (patch: Partial<Athlete>) => {
    const next = { ...a, ...patch };
    setA(next);
    api.saveSettings({ athlete: next }).then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); }).catch(() => {});
  };
  const numOrNull = (v: string) => { const n = Number(v); return v.trim() && isFinite(n) ? n : null; };

  return (
    <div className="card">
      <div className="spread"><h2>Athletendaten</h2>{saved && <span className="tiny" style={{ color: "var(--ok)" }}>gespeichert ✓</span>}</div>
      <p className="tiny muted">Geburtsjahr und Geschlecht bestimmen die Alters-Norm der VO2max-Einordnung im Dashboard.</p>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <label className="field" style={{ margin: 0, width: 110 }}><span>Geburtsjahr</span>
          <input type="number" placeholder="1990" key={`by-${a.birth_year ?? ""}`} defaultValue={a.birth_year ?? ""}
            onBlur={(e) => save({ birth_year: numOrNull(e.target.value) })} />
        </label>
        <label className="field" style={{ margin: 0, width: 130 }}><span>Geschlecht</span>
          <select value={a.sex ?? "m"} onChange={(e) => save({ sex: e.target.value === "f" ? "f" : "m" })}>
            <option value="m">männlich</option>
            <option value="f">weiblich</option>
          </select>
        </label>
        <label className="field" style={{ margin: 0, width: 110 }}><span>Gewicht (kg)</span>
          <input type="number" step="0.1" key={`w-${a.weight ?? ""}`} defaultValue={a.weight ?? ""}
            onBlur={(e) => save({ weight: numOrNull(e.target.value) })} />
        </label>
        <label className="field" style={{ margin: 0, width: 110 }}><span>Max-HF (bpm)</span>
          <input type="number" key={`mh-${a.max_hr ?? ""}`} defaultValue={a.max_hr ?? ""}
            onBlur={(e) => save({ max_hr: numOrNull(e.target.value) })} />
        </label>
      </div>
    </div>
  );
}
