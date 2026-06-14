// Saisonplan-Editor (v0.12.0, ToDo 1): KW ist die editierbare Größe, das Datum (Mo–So) wird automatisch
// daraus berechnet und read-only angezeigt. Wochen werden serverseitig nach Datum sortiert & ab 0
// durchnummeriert. Beim Laden werden verwaiste geplante Einheiten (ohne zugehörige Woche) bereinigt.
import { useEffect, useState } from "react";
import { api, type SeasonWeek } from "../lib/api.ts";
import { todayIso, num, phaseLabel, groupByYear, isoWeek, mondayOfIsoWeek, fmtDate, addDays } from "../lib/util.ts";
import { useOptions } from "../lib/options.ts";

export default function SeasonPlan() {
  const [season, setSeason] = useState<SeasonWeek[]>([]);
  const [msg, setMsg] = useState("");
  // Jahres-Akkordeon (ToDo 9): aktuelles Jahr offen, übrige eingeklappt.
  const [openYears, setOpenYears] = useState<Set<string>>(() => new Set([todayIso().slice(0, 4)]));
  const toggleYear = (y: string) =>
    setOpenYears((s) => { const n = new Set(s); if (n.has(y)) n.delete(y); else n.add(y); return n; });

  const reload = async () => setSeason(await api.season());
  useEffect(() => {
    // Verwaiste Plan-Einheiten gelöschter Wochen einmalig aufräumen, dann laden (ToDo 1).
    api.cleanupOrphans()
      .then((r) => { if (r.removed > 0) setMsg(`${r.removed} verwaiste geplante Einheit(en) ohne Woche bereinigt.`); })
      .catch(() => {})
      .finally(reload);
  }, []);

  return (
    <div>
      <div className="spread">
        <h1>Saisonplan</h1>
        <div className="row" style={{ width: "auto" }}>
          {season.length > 0 && <button onClick={() => addWeekBefore(season)}>+ Woche davor</button>}
          <button className="primary" onClick={() => addWeek(season)}>+ Woche</button>
        </div>
      </div>
      {msg && <div className="flag ok"><span className="dot" /><span>{msg}</span></div>}
      <p className="tiny muted" style={{ marginTop: 2 }}>
        Eine Woche = Kalenderwoche (Mo–So). Nur die <strong>KW</strong> ist editierbar; das Datum wird
        automatisch berechnet. Wochen werden nach Startdatum sortiert und ab 0 durchnummeriert.
      </p>
      <div className="card">
        {!season.length && <p className="muted">Noch keine Wochen. Lege mit „+ Woche" eine an.</p>}
        {season.length > 0 && (
          <table>
            <thead><tr><th>Phase</th><th>KW</th><th>Jahr</th><th>Datum (Mo–So)</th><th>Ziel km</th><th>Race</th><th></th></tr></thead>
            {groupByYear(season).map(({ year, items }) => {
              const isOpen = openYears.has(year);
              const sumKm = items.reduce((s, w) => s + (w.target_km || 0), 0);
              return (
                <tbody key={year} className="season-year">
                  <tr className="year-head" onClick={() => toggleYear(year)}>
                    <td colSpan={7}>
                      <span className="caret">{isOpen ? "▾" : "▸"}</span>
                      <strong>{year}</strong>
                      <span className="tiny muted"> · {items.length} Wochen{sumKm ? ` · Σ ${Math.round(sumKm)} km Ziel` : ""}</span>
                    </td>
                  </tr>
                  {isOpen && items.map((w) => <WeekRow key={w.week_no} w={w} onChange={reload} />)}
                </tbody>
              );
            })}
          </table>
        )}
      </div>
    </div>
  );
}

function WeekRow({ w, onChange }: { w: SeasonWeek; onChange: () => void }) {
  const [e, setE] = useState(w);
  const { phases } = useOptions();
  useEffect(() => setE(w), [w]);
  const save = (patch: Partial<SeasonWeek>) => { const n = { ...e, ...patch }; setE(n); api.saveWeek(w.week_no, n).then(onChange); };
  const phaseVals = phases.map((p) => p.value);
  const phaseOpts = !e.phase || phaseVals.includes(e.phase) ? phaseVals : [e.phase, ...phaseVals];

  const kw = isoWeek(e.start_date);
  const yr = Number(e.start_date.slice(0, 4));
  // KW/Jahr ändern → Start (Montag der KW) + Ende (+6) automatisch berechnen.
  const applyKwYear = (newKw: number, newYr: number) => {
    const start = mondayOfIsoWeek(newYr, newKw);
    save({ start_date: start, end_date: addDays(start, 6) });
  };

  async function remove() {
    await api.deleteWeek(w.week_no);
    await onChange(); // zuverlässig neu laden (Bugfix ToDo 5: Woche verschwand erst nach manuellem Reload)
  }

  return (
    <tr>
      <td><select value={e.phase} onChange={(x) => save({ phase: x.target.value })} style={{ minWidth: 130 }}>{phaseOpts.map((p) => <option key={p} value={p}>{phaseLabel(p)}</option>)}</select></td>
      <td style={{ width: 70 }}>
        <input key={`kw-${e.start_date}`} type="number" min={1} max={53} defaultValue={kw} style={{ textAlign: "center" }}
          onBlur={(x) => { const k = num(x.target.value); if (k != null && k !== kw) applyKwYear(k, yr); }} />
      </td>
      <td style={{ width: 80 }}>
        <input key={`yr-${e.start_date}`} type="number" defaultValue={yr} style={{ textAlign: "center" }}
          onBlur={(x) => { const y = num(x.target.value); if (y != null && y !== yr) applyKwYear(kw, y); }} />
      </td>
      <td className="tiny muted nowrap">{fmtDate(e.start_date)} – {fmtDate(e.end_date)}</td>
      <td style={{ width: 80 }}><input type="number" value={e.target_km ?? ""} onChange={(x) => save({ target_km: num(x.target.value) })} /></td>
      <td><input value={e.goal_race ?? ""} onChange={(x) => save({ goal_race: x.target.value })} /></td>
      <td><button className="sm ghost danger" onClick={remove}>✕</button></td>
    </tr>
  );
}

const minIso = (dates: string[]) => dates.reduce((a, b) => (b < a ? b : a));
const maxIso = (dates: string[]) => dates.reduce((a, b) => (b > a ? b : a));

async function addWeek(season: SeasonWeek[]) {
  const next = season.length ? Math.max(...season.map((w) => w.week_no)) + 1 : 1;
  // Start = Montag nach der letzten Woche (bzw. Montag der aktuellen Woche).
  const lastEnd = season.length ? maxIso(season.map((w) => w.end_date)) : todayIso();
  const start = season.length ? addDays(lastEnd, 1) : mondayOfIsoWeek(Number(todayIso().slice(0, 4)), isoWeek(todayIso()));
  await api.saveWeek(next, { phase: "Belastung", start_date: start, end_date: addDays(start, 6), target_km: 70, goal_race: "", label: `Woche ${next}` });
  location.reload();
}
async function addWeekBefore(season: SeasonWeek[]) {
  if (!season.length) return;
  const prev = Math.min(...season.map((w) => w.week_no)) - 1;
  const start = addDays(minIso(season.map((w) => w.start_date)), -7);
  await api.saveWeek(prev, { phase: "Base", start_date: start, end_date: addDays(start, 6), target_km: null, goal_race: "", label: `Woche ${prev}` });
  location.reload();
}
