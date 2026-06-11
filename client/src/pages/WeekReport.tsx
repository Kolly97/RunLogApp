import { useEffect, useState } from "react";
import { api, type PlannedSession, type Activity, type DailyLog, type AnalyzeResult } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import { DAY_NAMES, daysOfWeek, fmtDate, typeLabel, typeColor, sportLabel, paceStr } from "../lib/util.ts";
import WeekSelector from "../components/WeekSelector.tsx";
import ZoneDistribution from "../charts/ZoneDistribution.tsx";
import IntensityDonut from "../charts/IntensityDonut.tsx";

const CHECKS: [string, string][] = [
  ["mileage", "Mileage erreicht"], ["threshold2x", "2× Schwelle"], ["longrun", "Longrun"],
  ["plyo", "Plyo/Athletik"], ["physio", "Physio/KG"],
];
const REFLECT: [string, string][] = [
  ["adherence", "Plan-Treue (% umgesetzt)"], ["progress", "Fortschritt ggü. Vorwoche"],
  ["highlight", "Highlight / Win der Woche"], ["pain", "Schmerzen / Niggles / Verletzungsrisiko"],
  ["recovery_strategies", "Genutzte Recovery-Strategien"], ["fueling", "Ernährung / Fueling / Gewicht"],
  ["mental", "Mentale Frische / Stress (Studium/Job)"], ["confidence", "Confidence Richtung Saisonziel"],
  ["lessons", "Lessons → Anpassung Folgewoche"],
];

export default function WeekReport() {
  const { season, week, weekNo, setWeekNo, loading } = useSeason();
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [daily, setDaily] = useState<DailyLog[]>([]);
  const [analyze, setAnalyze] = useState<AnalyzeResult | null>(null);
  const [wlog, setWlog] = useState<any>({});

  async function reload() {
    if (!week) return;
    const [s, a, d, an, w] = await Promise.all([
      api.sessions({ week: week.week_no }),
      api.activities({ from: week.start_date, to: week.end_date }),
      api.daily({ from: week.start_date, to: week.end_date }),
      api.analyzeWeek(week.week_no),
      api.weeklog(week.week_no),
    ]);
    setSessions(s); setActs(a); setDaily(d); setAnalyze(an); setWlog(w || {});
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [week?.week_no]);

  if (loading) return <p className="muted">Lädt…</p>;
  if (!week) return <div className="empty">Keine Woche.</div>;

  const days = daysOfWeek(week.start_date);
  const runActs = acts.filter((a) => a.sport === "Run");
  const actualKm = round1(runActs.reduce((s, a) => s + (a.distance_m || 0) / 1000, 0));
  const actualBikeKm = round1(acts.filter((a) => a.sport.startsWith("Bike")).reduce((s, a) => s + (a.distance_m || 0) / 1000, 0));
  const actualTss = round1(acts.reduce((s, a) => s + (a.tss || 0), 0));

  // reale Zeit-in-Zone (Sekunden) aus Aktivitäten
  const realZoneMin: Record<number, number> = {};
  (analyze?.zones || []).forEach((z) => (realZoneMin[z.z] = 0));
  for (const a of acts) if (a.zones) for (const k of Object.keys(a.zones)) realZoneMin[+k] = (realZoneMin[+k] || 0) + (a.zones[+k] || 0) / 60;
  const hasRealZones = Object.values(realZoneMin).some((x) => x > 0);

  const wellness = avgWellness(daily);
  const saveW = (patch: Record<string, unknown>) => { const n = { ...wlog, ...patch }; setWlog(n); api.saveWeeklog(week.week_no, n); };
  const saveCheck = (k: string, val: boolean) => saveW({ checks: { ...(wlog.checks || {}), [k]: val } });
  const saveRefl = (k: string, val: string) => saveW({ refl_extra: { ...(wlog.refl_extra || {}), [k]: val } });

  return (
    <div>
      <div className="spread no-print">
        <h1>Wochenbericht</h1>
        <div className="row">
          <WeekSelector season={season} weekNo={weekNo} setWeekNo={setWeekNo} />
          <button className="primary" onClick={() => window.print()}>🖨 Drucken / PDF</button>
        </div>
      </div>

      <div className="report card">
        {/* Kopf */}
        <div className="spread report-head">
          <div>
            <h2 style={{ margin: 0 }}>Woche {week.week_no} — {week.phase}</h2>
            <div className="muted tiny">{fmtDate(week.start_date)}–{fmtDate(week.end_date)} · Ziel {week.target_km ?? "–"} km{week.goal_race ? ` · ${week.goal_race}` : ""}</div>
          </div>
          <div className="row" style={{ gap: 18 }}>
            <Mini label="Lauf" v={`${actualKm} km`} sub={`Ziel ${week.target_km ?? "–"}`} />
            <Mini label="Rad" v={`${actualBikeKm} km`} />
            <Mini label="TSS" v={`${Math.round(actualTss)}`} />
            <Mini label="Form (TSB)" v={`${analyze?.projectedTsb ?? "–"}`} />
          </div>
        </div>

        {/* Tagestabelle geplant vs real */}
        <table className="mt">
          <thead><tr><th>Tag</th><th>Geplant</th><th>Real</th><th>km</th><th>Ø HF</th><th>Pace</th><th>TSS</th><th>RPE/Beine</th></tr></thead>
          <tbody>
            {days.map((d, i) => {
              const plan = sessions.filter((s) => s.date === d);
              const real = acts.filter((a) => a.date === d);
              const dl = daily.find((x) => x.date === d);
              return (
                <tr key={d}>
                  <td className="nowrap"><strong>{DAY_NAMES[i]}</strong> <span className="muted tiny">{fmtDate(d)}</span></td>
                  <td>{plan.map((p) => <div key={p.id}><span style={{ color: typeColor(p.type) }}>●</span> {p.description || typeLabel(p.type)}</div>)}</td>
                  <td>{real.map((a) => <div key={a.id}>{a.name || sportLabel(a.sport)}</div>)}</td>
                  <td>{round1(real.reduce((s, a) => s + (a.distance_m || 0) / 1000, 0)) || ""}</td>
                  <td>{avg(real.map((a) => a.avg_hr).filter(Boolean) as number[])}</td>
                  <td>{real[0]?.distance_m && real[0]?.moving_s ? paceStr(real[0].moving_s / (real[0].distance_m / 1000)) : ""}</td>
                  <td>{round1(real.reduce((s, a) => s + (a.tss || 0), 0)) || ""}</td>
                  <td className="tiny">{(dl?.rpe as number) ?? ""}{dl?.legs ? ` · ${dl.legs}` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Visualisierung */}
        <div className="grid cols-2 mt" style={{ alignItems: "start" }}>
          <div>
            <h3>Zonenverteilung geplant vs. real</h3>
            {analyze && <ZoneDistribution zones={analyze.zones} height={110} rows={[
              { name: "Geplant", minutes: analyze.totals.zoneMin },
              ...(hasRealZones ? [{ name: "Real", minutes: realZoneMin }] : []),
            ]} />}
            {!hasRealZones && <p className="tiny muted">Reale Zeit-in-Zone erscheint, sobald Aktivitäten mit HF-Streams (Strava) vorliegen.</p>}
          </div>
          <div>
            <h3>Intensität (geplant)</h3>
            {analyze && <IntensityDonut intensity={analyze.totals.intensity} height={130} />}
          </div>
        </div>

        {/* Whoop / Wellness Summary */}
        <h3 className="mt">Whoop / Wellness (Ø Woche)</h3>
        <div className="row tiny" style={{ gap: 16, flexWrap: "wrap" }}>
          <Mini label="Recovery %" v={wellness.recovery} /><Mini label="Strain Ø" v={wellness.strain} />
          <Mini label="HRV" v={wellness.hrv} /><Mini label="Ruhepuls" v={wellness.resting_hr} />
          <Mini label="Schlaf h" v={wellness.sleep_h} /><Mini label="Gewicht" v={wellness.weight} />
          <Mini label="Energie" v={wellness.energy} /><Mini label="Stress" v={wellness.stress} /><Mini label="Motivation" v={wellness.motivation} />
        </div>

        {/* Wochen-Check */}
        <h3 className="mt">Wochen-Check</h3>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          {CHECKS.map(([k, label]) => (
            <label key={k} className="row tiny" style={{ gap: 5, width: "auto" }}>
              <input type="checkbox" style={{ width: "auto" }} checked={!!wlog.checks?.[k]} onChange={(e) => saveCheck(k, e.target.checked)} /> {label}
            </label>
          ))}
        </div>

        {/* Reflexion */}
        <h3 className="mt">Reflexion</h3>
        <div className="grid cols-2">
          <Refl label="Was lief gut?" v={wlog.refl_good} on={(x) => saveW({ refl_good: x })} />
          <Refl label="Was war schwierig?" v={wlog.refl_hard} on={(x) => saveW({ refl_hard: x })} />
          <Refl label="Was ändere ich nächste Woche?" v={wlog.refl_change} on={(x) => saveW({ refl_change: x })} />
          {REFLECT.map(([k, label]) => <Refl key={k} label={label} v={wlog.refl_extra?.[k]} on={(x) => saveRefl(k, x)} />)}
        </div>
      </div>
    </div>
  );
}

function Mini({ label, v, sub }: { label: string; v: string | number; sub?: string }) {
  return <div className="stat"><div className="label">{label}</div><div className="value" style={{ fontSize: 18 }}>{v === "" || v == null ? "–" : v}</div>{sub && <div className="sub">{sub}</div>}</div>;
}
function Refl({ label, v, on }: { label: string; v?: string; on: (x: string) => void }) {
  return <label className="field"><span>{label}</span><textarea rows={2} defaultValue={v ?? ""} onBlur={(e) => on(e.target.value)} /></label>;
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function avg(arr: number[]): number | "" { return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : ""; }
function avgWellness(daily: DailyLog[]): Record<string, number | ""> {
  const keys = ["recovery", "strain", "hrv", "resting_hr", "sleep_h", "weight", "energy", "stress", "motivation"];
  const out: Record<string, number | ""> = {};
  for (const k of keys) {
    const vals = daily.map((d) => d[k] as number).filter((x) => x != null && !isNaN(x));
    out[k] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : "";
  }
  return out;
}
