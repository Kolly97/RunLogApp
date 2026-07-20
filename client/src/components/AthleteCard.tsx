// Athletendaten (v0.15.0): Geburtsjahr/Geschlecht/Gewicht/Max-HF im `athlete`-Setting.
// Geburtsjahr + Geschlecht sind Grundlage für die alters-/geschlechtsgradierte VO2max-Einordnung.
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import T from "./T.tsx";
import { useT } from "../lib/i18n.tsx";

interface InjuryHistory { bone?: boolean; tendon?: boolean; muscle?: boolean }
interface Athlete {
  name?: string; weight?: number | null; height?: number | null; max_hr?: number | null; hr_rest?: number | null; birth_year?: number | null; sex?: "m" | "f";
  // v3.3.0 (Coach v4): Trainingsprofil — Typ = Struktur (Q-Anzahl), Trainingsalter/Verletzung = bounded Sicherheits-Modulatoren.
  athlete_type?: "hobby" | "ambitious" | "semipro"; training_years?: number | null; injury_history?: InjuryHistory;
}

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
  const injury = a.injury_history ?? {};
  const saveInjury = (k: keyof InjuryHistory, v: boolean) => save({ injury_history: { ...injury, [k]: v } });
  // Globale Regel `input {width:100%}` streckt sonst auch Checkboxen über den Text — Reset wie in CycleScaffoldCard.
  const cbStyle = { width: "auto", flex: "0 0 auto", appearance: "auto", padding: 0, margin: 0, border: "none", background: "transparent", borderRadius: 0, accentColor: "var(--accent)" } as const;
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

      {/* v3.3.0 (Coach v4): Trainingsprofil — steuert die STRUKTUR des Coach-Plans; die Dosis bleibt datenbasiert. */}
      <h3 style={{ marginTop: 18, marginBottom: 2 }}><T k="athlete.profile.title">Trainingsprofil</T></h3>
      <p className="tiny muted" style={{ marginTop: 0, marginBottom: 8 }}><T k="athlete.profile.hint">Diese Angaben bestimmen die STRUKTUR deiner Coach-Wochen (wie viele harte Einheiten, wie behutsam der Aufbau). Das Tempo und die Umfänge (die Dosis) bleiben immer datenbasiert.</T></p>
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        <label className="field" style={{ margin: 0, width: 170 }}>
          <span><T k="athlete.field.type">Athleten-Typ</T></span>
          <select value={a.athlete_type ?? ""} onChange={(e) => save({ athlete_type: (e.target.value || undefined) as Athlete["athlete_type"] })}>
            <option value="">{t("athlete.type.auto", "automatisch (aus Historie)")}</option>
            <option value="hobby">{t("athlete.type.hobby", "Hobby — 1 harte Einheit")}</option>
            <option value="ambitious">{t("athlete.type.ambitious", "Ambitioniert — 2 harte Einheiten")}</option>
            <option value="semipro">{t("athlete.type.semipro", "Semi-Pro — 2–3 (mit Doppeln)")}</option>
          </select>
        </label>
        <label className="field" style={{ margin: 0, width: 150 }}>
          <span><T k="athlete.field.trainingYears">Trainingsalter (Jahre)</T></span>
          <input type="number" min="0" step="1" placeholder="z. B. 4" key={`ty-${a.training_years ?? ""}`} defaultValue={a.training_years ?? ""}
            onBlur={(e) => save({ training_years: numOrNull(e.target.value) })} />
        </label>
        <div className="field" style={{ margin: 0 }}>
          <span><T k="athlete.field.injury">Verletzung (letzte 24 Monate)</T></span>
          <div style={{ display: "flex", gap: 16, marginTop: 6, flexWrap: "wrap" }}>
            {([["bone", t("athlete.injury.bone", "Knochen")], ["tendon", t("athlete.injury.tendon", "Sehne")], ["muscle", t("athlete.injury.muscle", "Muskel")]] as [keyof InjuryHistory, string][]).map(([k, label]) => (
              <label key={k} style={{ display: "inline-flex", gap: 6, alignItems: "center", margin: 0, cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={!!injury[k]} onChange={(e) => saveInjury(k, e.target.checked)} style={cbStyle} /> {label}
              </label>
            ))}
          </div>
        </div>
      </div>
      <ul className="tiny muted" style={{ marginTop: 8, paddingLeft: 16, lineHeight: 1.5 }}>
        <li><T k="athlete.profile.why.type">Typ = deine Lebensentscheidung (Zeit, Ambition), nicht deine Form. Trägt deine aktuelle Basis die Wahl noch nicht, startet der Plan mit weniger harten Einheiten und wächst hinein — die Sicherungen (Form-Boden, sichere Rampe) bleiben immer aktiv.</T></li>
        <li><T k="athlete.profile.why.trainingYears">Trainingsalter unter 2 Jahren → die Intensität bleibt sparsamer (eine harte Einheit weniger): Sehnen und Knochen brauchen länger als Herz und Lunge.</T></li>
        <li><T k="athlete.profile.why.injury">Verletzung in den letzten 24 Monaten → der Umfang steigt behutsamer (≈5 statt 7 %/Woche). Eine frühere Verletzung ist der stärkste bekannte Risikofaktor — das ist Vorsicht, keine Garantie.</T></li>
        <li><T k="athlete.profile.why.masters">Ab 45 Jahren (aus deinem Geburtsjahr) planen wir automatisch mehr Abstand zwischen harten Tagen und einen etwas längeren Taper. Alles überschreibbar.</T></li>
      </ul>
    </div>
  );
}
