// Verfügbarkeits-/Präferenz-Profil (v1.4.0, A1): Wochentag-Budgets, Longrun-Tag, Harttage, Doubles.
// Gespeichert als Setting-JSON `availability_<pid>` — additiv, kein Schema.
import { useEffect, useState } from "react";
import { api, type Availability } from "../lib/api.ts";
import T from "./T.tsx";
import { useT } from "../lib/i18n.tsx";

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const EMPTY: Availability = { minutesByWeekday: [0, 0, 0, 0, 0, 0, 0], longRunDay: null, hardDays: [], allowDoubles: false, doubleDays: [] };

function toMinutes(v: string): number {
  const n = Number(v);
  return v.trim() && isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

export default function AvailabilityCard() {
  const [av, setAv] = useState<Availability>(EMPTY);
  const [saved, setSaved] = useState(false);
  const t = useT();

  useEffect(() => {
    api.availability().then((r) => { if (r) setAv(r); }).catch(() => {});
  }, []);

  const persist = (next: Availability) => {
    setAv(next);
    api.saveAvailability(next)
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); })
      .catch(() => {});
  };

  const setDay = (i: number, val: string) => {
    const mins = [...(av.minutesByWeekday ?? [0, 0, 0, 0, 0, 0, 0])];
    mins[i] = toMinutes(val);
    persist({ ...av, minutesByWeekday: mins });
  };

  const toggleHard = (i: number) => {
    const cur = av.hardDays ?? [];
    const next = cur.includes(i) ? cur.filter((d) => d !== i) : [...cur, i].sort((a, b) => a - b);
    persist({ ...av, hardDays: next });
  };

  const toggleDouble = (i: number) => {
    const cur = av.doubleDays ?? [];
    const next = cur.includes(i) ? cur.filter((d) => d !== i) : [...cur, i].sort((a, b) => a - b);
    persist({ ...av, doubleDays: next });
  };

  const budget = av.minutesByWeekday ?? [0, 0, 0, 0, 0, 0, 0];
  const trainingDays = budget.map((m, i) => ({ i, m })).filter((x) => x.m > 0);

  return (
    <div className="card">
      <div className="spread">
        <h2><T k="availability.title">Trainings-Verfügbarkeit</T></h2>
        {saved && <span className="tiny" style={{ color: "var(--ok)" }}><T k="availability.saved">gespeichert ✓</T></span>}
      </div>
      <p className="tiny muted">
        <T k="availability.hint">Zeitbudget pro Wochentag (Minuten, 0 = Ruhetag), bevorzugter Langrun-Tag und Harttage. Basis für den Trainings-Planer.</T>
      </p>

      {/* Tagesbudgets */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {DAYS.map((label, i) => (
          <label key={i} className="field" style={{ margin: 0, width: 68 }}>
            <span style={{ textAlign: "center", display: "block" }}>{label}</span>
            <input
              type="number" min={0} step={15} placeholder="0"
              key={`min-${i}-${budget[i]}`} defaultValue={budget[i] || ""}
              onBlur={(e) => setDay(i, e.target.value)}
              style={{ textAlign: "center" }}
            />
          </label>
        ))}
      </div>

      {/* Longrun-Tag */}
      <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 8 }}>
        <label className="field" style={{ margin: 0, width: 160 }}>
          <span><T k="availability.longRunDay">Longrun-Tag</T></span>
          <select
            value={av.longRunDay ?? ""}
            onChange={(e) => persist({ ...av, longRunDay: e.target.value !== "" ? Number(e.target.value) : null })}
          >
            <option value="">{t("availability.none", "—")}</option>
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </label>

        {/* Doubles */}
        <label className="field" style={{ margin: 0, minWidth: 160 }}>
          <span><T k="availability.doubles">Doppeleinheiten erlauben</T></span>
          <select
            value={av.allowDoubles ? "yes" : "no"}
            onChange={(e) => persist({ ...av, allowDoubles: e.target.value === "yes" })}
          >
            <option value="no">{t("availability.doubles.no", "Nein")}</option>
            <option value="yes">{t("availability.doubles.yes", "Ja")}</option>
          </select>
        </label>
      </div>

      {/* Harttage */}
      {trainingDays.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div className="tiny muted" style={{ marginBottom: 4 }}>
            <T k="availability.hardDays">Qualitätstage (Schwellen-/VO2-Einheiten)</T>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {trainingDays.map(({ i }) => {
              const isHard = (av.hardDays ?? []).includes(i);
              return (
                <button
                  key={i}
                  className={`sm ${isHard ? "" : "ghost"}`}
                  onClick={() => toggleHard(i)}
                  title={DAYS[i]}
                >
                  {DAYS[i]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Bevorzugte Double-Tage (nur wenn erlaubt) */}
      {av.allowDoubles && trainingDays.length > 0 && (
        <div>
          <div className="tiny muted" style={{ marginBottom: 4 }}>
            <T k="availability.doubleDays">Bevorzugte Tage für 2. lockere Einheit</T>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {trainingDays.map(({ i }) => {
              const isDouble = (av.doubleDays ?? []).includes(i);
              return (
                <button
                  key={i}
                  className={`sm ${isDouble ? "" : "ghost"}`}
                  onClick={() => toggleDouble(i)}
                  title={DAYS[i]}
                >
                  {DAYS[i]}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
