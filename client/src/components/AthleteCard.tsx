// Athletendaten (v0.15.0): Geburtsjahr/Geschlecht/Gewicht/Max-HF im `athlete`-Setting.
// Geburtsjahr + Geschlecht sind Grundlage für die alters-/geschlechtsgradierte VO2max-Einordnung.
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import T from "./T.tsx";
import { useT } from "../lib/i18n.tsx";

interface Athlete { name?: string; weight?: number | null; height?: number | null; max_hr?: number | null; hr_rest?: number | null; birth_year?: number | null; sex?: "m" | "f"; }

export default function AthleteCard() {
  const [a, setA] = useState<Athlete>({});
  const [saved, setSaved] = useState(false);
  const t = useT();

  useEffect(() => {
    api.settings().then((s) => setA((s?.athlete as Athlete) || {})).catch(() => {});
  }, []);

  const save = (patch: Partial<Athlete>) => {
    const next = { ...a, ...patch };
    setA(next);
    api.saveSettings({ athlete: next }).then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); }).catch(() => {});
  };
  const numOrNull = (v: string) => { const n = Number(v); return v.trim() && isFinite(n) ? n : null; };
  const bmi = a.weight && a.height ? (a.weight as number) / Math.pow((a.height as number) / 100, 2) : null;
  const bmiCat = bmi == null ? "" : bmi < 18.5 ? "Untergewicht" : bmi < 25 ? "Normal" : bmi < 30 ? "Übergewicht" : "Adipositas";

  return (
    <div className="card">
      <div className="spread">
        <h2><T k="athlete.title">Athletendaten</T></h2>
        {saved && <span className="tiny" style={{ color: "var(--ok)" }}><T k="athlete.saved">gespeichert ✓</T></span>}
      </div>
      <p className="tiny muted"><T k="athlete.hint">Geburtsjahr und Geschlecht bestimmen die Alters-Norm der VO2max-Einordnung im Dashboard.</T></p>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <label className="field" style={{ margin: 0, width: 110 }}>
          <span><T k="athlete.field.birthYear">Geburtsjahr</T></span>
          <input type="number" placeholder="1990" key={`by-${a.birth_year ?? ""}`} defaultValue={a.birth_year ?? ""}
            onBlur={(e) => save({ birth_year: numOrNull(e.target.value) })} />
        </label>
        <label className="field" style={{ margin: 0, width: 130 }}>
          <span><T k="athlete.field.sex">Geschlecht</T></span>
          <select value={a.sex ?? "m"} onChange={(e) => save({ sex: e.target.value === "f" ? "f" : "m" })}>
            <option value="m">{t("athlete.sex.male", "männlich")}</option>
            <option value="f">{t("athlete.sex.female", "weiblich")}</option>
          </select>
        </label>
        <label className="field" style={{ margin: 0, width: 110 }}>
          <span><T k="athlete.field.weight">Gewicht (kg)</T></span>
          <input type="number" step="0.1" key={`w-${a.weight ?? ""}`} defaultValue={a.weight ?? ""}
            onBlur={(e) => save({ weight: numOrNull(e.target.value) })} />
        </label>
        <label className="field" style={{ margin: 0, width: 110 }}>
          <span><T k="athlete.field.height">Größe (cm)</T></span>
          <input type="number" placeholder="180" key={`h-${a.height ?? ""}`} defaultValue={a.height ?? ""}
            onBlur={(e) => save({ height: numOrNull(e.target.value) })} />
        </label>
        <label className="field" style={{ margin: 0, width: 110 }}>
          <span><T k="athlete.field.maxHr">Max-HF (bpm)</T></span>
          <input type="number" key={`mh-${a.max_hr ?? ""}`} defaultValue={a.max_hr ?? ""}
            onBlur={(e) => save({ max_hr: numOrNull(e.target.value) })} />
        </label>
        <label className="field" style={{ margin: 0, width: 110 }}>
          <span><T k="athlete.field.hrRest">Ruhe-HF (bpm)</T></span>
          <input type="number" placeholder="48" key={`hr-${a.hr_rest ?? ""}`} defaultValue={a.hr_rest ?? ""}
            onBlur={(e) => save({ hr_rest: numOrNull(e.target.value) })} />
        </label>
      </div>
      {bmi != null && (
        <p className="tiny" style={{ marginTop: 6 }}>
          BMI: <strong>{bmi.toFixed(1)}</strong> <span className="muted">({bmiCat} · bei Sportlern nur grobe Orientierung)</span>
        </p>
      )}
      <p className="tiny muted" style={{ marginTop: 6 }}><T k="athlete.hint.hrRest">Max-/Ruhe-HF speisen die Effective-VO2max-Schätzung (HF-Reserve). Nach Änderung „TSS neu berechnen" drücken, um die Läufe neu zu schätzen.</T></p>
    </div>
  );
}
