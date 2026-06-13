// Saisonplan-Editor als eigene Seite (ausgelagert aus den Einstellungen).
// Wochen werden serverseitig nach Datum sortiert und ab 0 durchnummeriert.
import { useEffect, useState } from "react";
import { api, type SeasonWeek } from "../lib/api.ts";
import { todayIso, num, phaseLabel } from "../lib/util.ts";
import { useOptions } from "../lib/options.ts";

export default function SeasonPlan() {
  const [season, setSeason] = useState<SeasonWeek[]>([]);
  const [msg, setMsg] = useState("");

  const reload = async () => setSeason(await api.season());
  useEffect(() => { reload(); }, []);

  async function seed() {
    const r = await api.seed();
    setMsg(`Importiert: ${r.weeks} Wochen, ${r.sessions} Einheiten.`);
    reload();
  }

  return (
    <div>
      <div className="spread">
        <h1>Saisonplan</h1>
        <div className="row" style={{ width: "auto" }}>
          <button onClick={seed}>Beispiel-Saison importieren (Word-Plan KW9–17)</button>
          {season.length > 0 && <button onClick={() => addWeekBefore(season)}>+ Woche davor</button>}
          <button className="primary" onClick={() => addWeek(season)}>+ Woche</button>
        </div>
      </div>
      {msg && <div className="flag ok"><span className="dot" /><span>{msg}</span></div>}
      <p className="tiny muted" style={{ marginTop: 2 }}>
        Wochen werden automatisch nach Startdatum sortiert und ab 0 durchnummeriert (erste Woche = #0).
        „Beispiel-Saison importieren" lädt den fest eingebauten Seed aus <code>Trainingsplan_KW_10-17.docx</code> — kein allgemeiner Datei-Import.
      </p>
      <div className="card">
        {!season.length && <p className="muted">Noch keine Wochen. Lege mit „+ Woche" eine an oder importiere die Beispiel-Saison.</p>}
        {season.length > 0 && (
          <table>
            <thead><tr><th>#</th><th>Phase</th><th>Start</th><th>Ende</th><th>Ziel km</th><th>Race</th><th></th></tr></thead>
            <tbody>{season.map((w) => <WeekRow key={w.week_no} w={w} onChange={reload} />)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function WeekRow({ w, onChange }: { w: SeasonWeek; onChange: () => void }) {
  const [e, setE] = useState(w);
  const { phases } = useOptions();
  const save = (patch: Partial<SeasonWeek>) => { const n = { ...e, ...patch }; setE(n); api.saveWeek(w.week_no, n).then(onChange); };
  const phaseVals = phases.map((p) => p.value);
  const phaseOpts = !e.phase || phaseVals.includes(e.phase) ? phaseVals : [e.phase, ...phaseVals];
  return (
    <tr>
      <td>{w.week_no}</td>
      <td><select value={e.phase} onChange={(x) => save({ phase: x.target.value })} style={{ minWidth: 130 }}>{phaseOpts.map((p) => <option key={p} value={p}>{phaseLabel(p)}</option>)}</select></td>
      <td><input type="date" value={e.start_date} onChange={(x) => save({ start_date: x.target.value })} /></td>
      <td><input type="date" value={e.end_date} onChange={(x) => save({ end_date: x.target.value })} /></td>
      <td style={{ width: 80 }}><input type="number" value={e.target_km ?? ""} onChange={(x) => save({ target_km: num(x.target.value) })} /></td>
      <td><input value={e.goal_race ?? ""} onChange={(x) => save({ goal_race: x.target.value })} /></td>
      <td><button className="sm ghost danger" onClick={() => api.deleteWeek(w.week_no).then(onChange)}>✕</button></td>
    </tr>
  );
}

const addDaysStr = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const minIso = (dates: string[]) => dates.reduce((a, b) => (b < a ? b : a));
const maxIso = (dates: string[]) => dates.reduce((a, b) => (b > a ? b : a));

async function addWeek(season: SeasonWeek[]) {
  const next = season.length ? Math.max(...season.map((w) => w.week_no)) + 1 : 1;
  const start = season.length ? addDaysStr(maxIso(season.map((w) => w.end_date)), 1) : todayIso();
  await api.saveWeek(next, { phase: "Belastung", start_date: start, end_date: addDaysStr(start, 6), target_km: 70, goal_race: "", label: `Woche ${next}` });
  location.reload();
}
async function addWeekBefore(season: SeasonWeek[]) {
  if (!season.length) return;
  const prev = Math.min(...season.map((w) => w.week_no)) - 1;
  const start = addDaysStr(minIso(season.map((w) => w.start_date)), -7);
  await api.saveWeek(prev, { phase: "Base", start_date: start, end_date: addDaysStr(start, 6), target_km: null, goal_race: "", label: `Woche ${prev}` });
  location.reload();
}
