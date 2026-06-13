// Wettkämpfe (ToDo #24): Liste + Detail-Erfassung mit manuellen Splits (km/Zeit/Pace/Ø-HF).
// Erscheinen zusätzlich als goldene Marker in PMC/Saison-Progression und einzeln im Wochenbericht.
import { useEffect, useState } from "react";
import { api, type Race, type RaceSplit } from "../lib/api.ts";
import { fmtDateY, paceStr, todayIso, num } from "../lib/util.ts";

// "mm:ss" oder "h:mm:ss" -> Sekunden
function parseTime(t: string): number | null {
  const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return (m[1] ? parseInt(m[1]) * 3600 : 0) + parseInt(m[2]) * 60 + parseInt(m[3]);
}
function fmtTime(s?: number | null): string {
  if (s == null) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h ? `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}` : `${m}:${sec.toString().padStart(2, "0")}`;
}

const EMPTY: Race = { date: todayIso(), name: "", distance_m: null, time_s: null, placement: "", notes: "", splits: [], max_hr: null, elevation_m: null };

export default function Races() {
  const [races, setRaces] = useState<Race[]>([]);
  const [edit, setEdit] = useState<Race | null>(null);

  const reload = () => api.races().then(setRaces).catch(() => setRaces([]));
  // ToDo Z.44: Wettkämpfe aus dem Saisonplan automatisch übernehmen (idempotent), dann Liste laden.
  useEffect(() => { api.importRacesFromSeason().catch(() => {}).finally(reload); }, []);

  return (
    <div>
      <div className="spread">
        <h1>Races</h1>
        <button className="primary" onClick={() => setEdit({ ...EMPTY, date: todayIso(), splits: [] })}>+ Wettkampf</button>
      </div>
      <p className="tiny muted">Wettkämpfe mit Endzeit, Platzierung, Splits und Notizen. Sie erscheinen als goldene Marker in den Verlaufs-Charts und einzeln im Wochenbericht.</p>

      {edit && <RaceForm race={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}

      {!races.length && !edit && <p className="muted">Noch keine Wettkämpfe eingetragen.</p>}
      {races.length > 0 && (
        <table>
          <thead><tr><th>Datum</th><th>Wettkampf</th><th>Distanz</th><th>Zeit</th><th>Pace</th><th>Platz</th><th></th></tr></thead>
          <tbody>
            {races.map((r) => {
              const km = (r.distance_m || 0) / 1000;
              const pace = km > 0 && r.time_s ? r.time_s / km : null;
              return (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDateY(r.date)}</td>
                  <td>{r.name || "—"}</td>
                  <td>{km ? `${km} km` : "—"}</td>
                  <td>{fmtTime(r.time_s) || "—"}</td>
                  <td>{pace ? `${paceStr(pace)}/km` : "—"}</td>
                  <td>{r.placement || "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="sm ghost" onClick={() => setEdit({ ...r, splits: r.splits || [] })}>Bearbeiten</button>
                    <button className="sm ghost danger" onClick={() => api.deleteRace(r.id!).then(reload)}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RaceForm({ race, onClose, onSaved }: { race: Race; onClose: () => void; onSaved: () => void }) {
  const [e, setE] = useState<Race>(race);
  const [kmStr, setKmStr] = useState(race.distance_m ? String(race.distance_m / 1000) : "");
  const [timeStr, setTimeStr] = useState(fmtTime(race.time_s));
  const set = (p: Partial<Race>) => setE((x) => ({ ...x, ...p }));
  const splits = e.splits || [];

  const setSplit = (i: number, p: Partial<RaceSplit>) => {
    const next = splits.map((s, j) => (j === i ? { ...s, ...p } : s));
    set({ splits: recomputePace(next) });
  };
  const addSplit = () => set({ splits: [...splits, { km: 1, time_s: null, avg_hr: null, max_hr: null, elevation_m: null }] });
  const delSplit = (i: number) => set({ splits: splits.filter((_, j) => j !== i) });

  async function save() {
    const body: Race = { ...e, distance_m: kmStr ? Number(kmStr) * 1000 : null, time_s: parseTime(timeStr) };
    if (e.id) await api.updateRace(e.id, body); else await api.addRace(body);
    onSaved();
  }

  return (
    <div className="card" style={{ background: "#fafbfd" }}>
      <div className="spread"><h2>{e.id ? "Wettkampf bearbeiten" : "Neuer Wettkampf"}</h2>
        <button className="sm ghost" onClick={onClose}>Schließen</button>
      </div>
      <div className="grid cols-4">
        <label className="field"><span>Datum</span><input type="date" value={e.date} onChange={(x) => set({ date: x.target.value })} /></label>
        <label className="field"><span>Name</span><input value={e.name ?? ""} onChange={(x) => set({ name: x.target.value })} placeholder="z.B. 10k Suprema Mannheim" /></label>
        <label className="field" style={{ gridColumn: "span 2" }}><span>Distanz (km)</span><input type="number" step="0.1" min="0" value={kmStr} onChange={(x) => setKmStr(x.target.value)} placeholder="z.B. 10 oder 0.5" /></label>
        <label className="field"><span>Endzeit (mm:ss / h:mm:ss)</span><input value={timeStr} onChange={(x) => setTimeStr(x.target.value)} placeholder="38:24" /></label>
        <label className="field"><span>Platzierung</span><input value={e.placement ?? ""} onChange={(x) => set({ placement: x.target.value })} placeholder="z.B. 12. AK / 45. gesamt" /></label>
        <label className="field"><span>Ø-HF (bpm)</span><input type="number" min="0" value={e.avg_hr ?? ""} onChange={(x) => set({ avg_hr: num(x.target.value) })} placeholder="z.B. 172" /></label>
        <label className="field"><span>Max-HF (bpm)</span><input type="number" min="0" value={e.max_hr ?? ""} onChange={(x) => set({ max_hr: num(x.target.value) })} placeholder="z.B. 188" /></label>
        <label className="field"><span>Höhenmeter (m)</span><input type="number" min="0" value={e.elevation_m ?? ""} onChange={(x) => set({ elevation_m: num(x.target.value) })} placeholder="z.B. 120" /></label>
      </div>

      <div className="spread" style={{ marginTop: 8 }}><h3>Splits</h3><button className="sm" onClick={addSplit}>+ Split</button></div>
      {splits.length > 0 && (
        <table>
          <thead><tr><th>km</th><th>Zeit (mm:ss)</th><th>Pace</th><th>Ø-HF</th><th>Max-HF</th><th>Höhenmeter</th><th></th></tr></thead>
          <tbody>
            {splits.map((s, i) => (
              <tr key={i}>
                {/* km + Zeit uncontrolled (key + defaultValue + onBlur) → freies Tippen, Parse erst beim Verlassen */}
                <td style={{ width: 70 }}><input key={`km-${i}-${s.km}`} type="number" step="0.1" min="0" defaultValue={s.km ?? ""} onBlur={(x) => setSplit(i, { km: num(x.target.value) })} /></td>
                <td style={{ width: 110 }}><input key={`t-${i}-${s.time_s}`} defaultValue={s.time_s != null ? fmtTime(s.time_s) : ""} onBlur={(x) => setSplit(i, { time_s: parseTime(x.target.value) })} placeholder="3:48" /></td>
                <td className="muted">{s.pace_s ? `${paceStr(s.pace_s)}/km` : "—"}</td>
                <td style={{ width: 70 }}><input type="number" min="0" value={s.avg_hr ?? ""} onChange={(x) => setSplit(i, { avg_hr: num(x.target.value) })} /></td>
                <td style={{ width: 70 }}><input type="number" min="0" value={s.max_hr ?? ""} onChange={(x) => setSplit(i, { max_hr: num(x.target.value) })} /></td>
                <td style={{ width: 80 }}><input type="number" min="0" value={s.elevation_m ?? ""} onChange={(x) => setSplit(i, { elevation_m: num(x.target.value) })} /></td>
                <td><button className="sm ghost danger" onClick={() => delSplit(i)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <label className="field" style={{ marginTop: 8 }}><span>Notizen</span>
        <textarea value={e.notes ?? ""} rows={2} onChange={(x) => set({ notes: x.target.value })} /></label>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
        <button className="ghost" onClick={onClose}>Abbrechen</button>
        <button className="primary" onClick={save}>Speichern</button>
      </div>
    </div>
  );
}

// Pace je Split aus km + Zeit
function recomputePace(splits: RaceSplit[]): RaceSplit[] {
  return splits.map((s) => ({ ...s, pace_s: s.km && s.time_s ? Math.round(s.time_s / s.km) : null }));
}
