// Verfügbarkeits-/Präferenz-Profil (v1.4.0, A1): Wochentag-Budgets, Longrun-Tag, Harttage, Doubles.
// Gespeichert als Setting-JSON `availability_<pid>` — additiv, kein Schema.
import { useEffect, useState } from "react";
import { api, type Availability, type WorkoutInfo } from "../lib/api.ts";
import T from "./T.tsx";
import { useT } from "../lib/i18n.tsx";

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const EMPTY: Availability = { minutesByWeekday: [0, 0, 0, 0, 0, 0, 0], longRunDay: null, hardDays: [], allowDoubles: false, doubleDays: [] };

function toMinutes(v: string): number {
  const n = Number(v);
  return v.trim() && isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

const EMPHASIS = [
  { v: "ausgewogen", l: "Ausgewogen" }, { v: "lt1", l: "LT1 (aerobe Schwelle)" }, { v: "schwelle", l: "Schwelle (LT2)" }, { v: "vo2", l: "VO2max" },
  { v: "berg", l: "Berg" }, { v: "norwegian", l: "Norwegian (sub-T)" }, { v: "fartlek", l: "Fartlek" },
];

export default function AvailabilityCard() {
  const [av, setAv] = useState<Availability>(EMPTY);
  const [saved, setSaved] = useState(false);
  const [workouts, setWorkouts] = useState<WorkoutInfo[]>([]); // v1.8.0: Bibliothek für Lieblings/Vermeiden
  const [famTab, setFamTab] = useState("Alle"); // v1.9.0 Picker: Familie-Filter
  const [q, setQ] = useState(""); // v1.9.0 Picker: Suche
  const t = useT();

  useEffect(() => {
    api.availability().then((r) => { if (r) setAv(r); }).catch(() => {});
    api.workouts().then(setWorkouts).catch(() => {});
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

  const toggleCore = (i: number) => {
    const cur = av.coreDays ?? [];
    const next = cur.includes(i) ? cur.filter((d) => d !== i) : [...cur, i].sort((a, b) => a - b);
    persist({ ...av, coreDays: next });
  };

  // v1.8.0 Block-Präferenzen: Favorit/Vermeiden sind gegenseitig ausschließend.
  const toggleFav = (id: string) => {
    const fav = av.favoriteWorkouts ?? [];
    const next = fav.includes(id) ? fav.filter((x) => x !== id) : [...fav, id];
    persist({ ...av, favoriteWorkouts: next, avoidWorkouts: (av.avoidWorkouts ?? []).filter((x) => x !== id) });
  };
  const toggleAvoid = (id: string) => {
    const avo = av.avoidWorkouts ?? [];
    const next = avo.includes(id) ? avo.filter((x) => x !== id) : [...avo, id];
    persist({ ...av, avoidWorkouts: next, favoriteWorkouts: (av.favoriteWorkouts ?? []).filter((x) => x !== id) });
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

        {/* Berglauf-Tag (v1.7.0) */}
        <label className="field" style={{ margin: 0, width: 160 }}>
          <span><T k="availability.hillDay">Berglauf-Tag</T></span>
          <select
            value={av.hillDay ?? ""}
            onChange={(e) => persist({ ...av, hillDay: e.target.value !== "" ? Number(e.target.value) : null })}
          >
            <option value="">{t("availability.none", "—")}</option>
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </label>

        {/* Stabi/Core pro Woche (v1.7.0) */}
        <label className="field" style={{ margin: 0, width: 160 }}>
          <span><T k="availability.core">Stabi/Core pro Woche</T></span>
          <select
            value={av.corePerWeek ?? 0}
            onChange={(e) => persist({ ...av, corePerWeek: Number(e.target.value) })}
          >
            {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
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

      {/* Block-Schwerpunkt (v1.9.0): prominent als Segmented-Control statt kleinem Dropdown. */}
      <div style={{ marginBottom: 10 }}>
        <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 4 }}><T k="availability.emphasis">Schwerpunkt im Block</T></div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {EMPHASIS.map((o) => (
            <button key={o.v} className={`sm ${(av.emphasis ?? "ausgewogen") === o.v ? "" : "ghost"}`}
              style={{ padding: "6px 13px", fontWeight: 600 }} onClick={() => persist({ ...av, emphasis: o.v })}>{o.l}</button>
          ))}
        </div>
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

      {/* Bevorzugte Core-Tage (v1.7.0, nur wenn Core aktiv) */}
      {(av.corePerWeek ?? 0) > 0 && trainingDays.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="tiny muted" style={{ marginBottom: 4 }}>
            <T k="availability.coreDays">Bevorzugte Stabi/Core-Tage (sonst an Easy-Tage angehängt)</T>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {trainingDays.map(({ i }) => {
              const isCore = (av.coreDays ?? []).includes(i);
              return (
                <button key={i} className={`sm ${isCore ? "" : "ghost"}`} onClick={() => toggleCore(i)} title={DAYS[i]}>
                  {DAYS[i]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Lieblings-/Vermeiden-Einheiten (v1.9.0 Redesign) — Familie-Tabs + Suche, klare ♥/⊘-Toggles, beratend. */}
      {workouts.length > 0 && (() => {
        const favC = av.favoriteWorkouts?.length ?? 0, avoC = av.avoidWorkouts?.length ?? 0;
        const families = Array.from(new Set(workouts.map((w) => w.family)));
        const ql = q.trim().toLowerCase();
        const filtered = workouts.filter((w) => (famTab === "Alle" || w.family === famTab) && (!ql || w.name.toLowerCase().includes(ql) || (w.purpose ?? "").toLowerCase().includes(ql)));
        return (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <T k="availability.fav.title">Lieblings- &amp; Vermeiden-Einheiten</T>
              {(favC + avoC) > 0 && <span className="tiny muted" style={{ fontWeight: 400 }}> · ♥ {favC} · ⊘ {avoC}</span>}
            </summary>
            <div style={{ marginTop: 8 }}>
              <p className="tiny muted" style={{ margin: "0 0 8px" }}>
                <T k="availability.fav.hint">♥ = häufiger, ⊘ = vermeiden. Wirkt beratend auf die Auswahl — Phasen &amp; Erholungsregeln bleiben verbindlich.</T>
              </p>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                {["Alle", ...families].map((fam) => (
                  <button key={fam} className={`sm ${famTab === fam ? "" : "ghost"}`} style={{ padding: "3px 10px" }} onClick={() => setFamTab(fam)}>{fam}</button>
                ))}
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Einheit suchen…"
                  style={{ marginLeft: "auto", width: 150, padding: "5px 9px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 8 }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 6 }}>
                {filtered.map((w) => {
                  const fav = (av.favoriteWorkouts ?? []).includes(w.id);
                  const avo = (av.avoidWorkouts ?? []).includes(w.id);
                  return (
                    <div key={w.id} title={w.purpose} style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${fav ? "var(--ok)" : avo ? "var(--danger)" : "var(--border)"}`, borderRadius: 9, padding: "5px 8px", background: fav ? "rgba(16,185,129,0.08)" : avo ? "rgba(239,68,68,0.06)" : "var(--card)" }}>
                      <span style={{ flex: 1, fontSize: 12, fontWeight: 500, opacity: avo ? 0.7 : 1 }}>{w.name}</span>
                      <button className="sm ghost" onClick={() => toggleFav(w.id)} title="Favorit — häufiger vorschlagen"
                        style={{ padding: "1px 6px", borderRadius: 6, fontWeight: 700, color: fav ? "#fff" : "var(--muted)", background: fav ? "var(--ok)" : "transparent" }}>♥</button>
                      <button className="sm ghost" onClick={() => toggleAvoid(w.id)} title="Vermeiden"
                        style={{ padding: "1px 6px", borderRadius: 6, fontWeight: 700, color: avo ? "#fff" : "var(--muted)", background: avo ? "var(--danger)" : "transparent" }}>⊘</button>
                    </div>
                  );
                })}
                {filtered.length === 0 && <span className="tiny muted">Keine Einheit gefunden.</span>}
              </div>
            </div>
          </details>
        );
      })()}
    </div>
  );
}
