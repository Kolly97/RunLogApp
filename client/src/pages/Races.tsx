// Wettkämpfe (ToDo #24): Liste + Detail-Erfassung mit manuellen Splits (km/Zeit/Pace/Ø-HF).
// Erscheinen zusätzlich als goldene Marker in PMC/Saison-Progression und einzeln im Wochenbericht.
import { useEffect, useState } from "react";
import { api, type Race, type RaceSplit } from "../lib/api.ts";
import { fmtDateY, paceStr, todayIso, num } from "../lib/util.ts";
import T from "../components/T.tsx";
import { useT } from "../lib/i18n.tsx";

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
  const t = useT();

  const reload = () => api.races().then(setRaces).catch(() => setRaces([]));
  // ToDo Z.44: Wettkämpfe aus dem Saisonplan automatisch übernehmen (idempotent), dann Liste laden.
  useEffect(() => { api.importRacesFromSeason().catch(() => {}).finally(reload); }, []);

  return (
    <div>
      <div className="spread">
        <h1><T k="races.title">Races</T></h1>
        <button className="primary" onClick={() => setEdit({ ...EMPTY, date: todayIso(), splits: [] })}><T k="races.btn.add">+ Wettkampf</T></button>
      </div>
      <p className="tiny muted"><T k="races.hint">Wettkämpfe mit Endzeit, Platzierung, Splits und Notizen. Sie erscheinen als goldene Marker in den Verlaufs-Charts und einzeln im Wochenbericht.</T></p>

      {edit && <RaceForm race={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}

      {!races.length && !edit && <p className="muted"><T k="races.empty">Noch keine Wettkämpfe eingetragen.</T></p>}
      {races.length > 0 && (
        <table>
          <thead><tr><th><T k="races.col.date">Datum</T></th><th><T k="races.col.name">Wettkampf</T></th><th><T k="races.col.dist">Distanz</T></th><th><T k="races.col.time">Zeit</T></th><th><T k="races.col.pace">Pace</T></th><th><T k="races.col.place">Platz</T></th><th></th></tr></thead>
          <tbody>
            {races.map((r) => {
              const km = (r.distance_m || 0) / 1000;
              const pace = km > 0 && r.time_s ? r.time_s / km : null;
              return (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDateY(r.date)}</td>
                  <td>{r.name || "—"}{r.source === "tracking" && <span className="muted tiny"> · {t("races.fromTracking", "aus Tracking")}</span>}</td>
                  <td>{km ? `${km} km` : "—"}</td>
                  <td>{fmtTime(r.time_s) || "—"}</td>
                  <td>{pace ? `${paceStr(pace)}/km` : "—"}</td>
                  <td>{r.placement || "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="sm ghost" onClick={() => setEdit({ ...r, splits: r.splits || [] })}><T k="races.btn.edit">Bearbeiten</T></button>
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
      <div className="spread">
        <h2><T k={e.id ? "races.form.editTitle" : "races.form.newTitle"}>{e.id ? "Wettkampf bearbeiten" : "Neuer Wettkampf"}</T></h2>
        <button className="sm ghost" onClick={onClose}><T k="races.form.close">Schließen</T></button>
      </div>
      <div className="grid cols-4">
        <label className="field"><span><T k="races.form.date">Datum</T></span><input type="date" value={e.date} onChange={(x) => set({ date: x.target.value })} /></label>
        <label className="field"><span><T k="races.form.name">Name</T></span><input value={e.name ?? ""} onChange={(x) => set({ name: x.target.value })} placeholder="z.B. Olympia" /></label>
        <label className="field" style={{ gridColumn: "span 1" }}><span><T k="races.form.dist">Distanz (km)</T></span><input type="number" step="0.1" min="0" value={kmStr} onChange={(x) => setKmStr(x.target.value)} placeholder="z.B. 10" /></label>
        <label className="field"><span><T k="races.form.time">Endzeit (h:mm:ss)</T></span><input value={timeStr} onChange={(x) => setTimeStr(x.target.value)} placeholder="26:20" /></label>
        <label className="field"><span><T k="races.form.place">Platzierung</T></span><input value={e.placement ?? ""} onChange={(x) => set({ placement: x.target.value })} placeholder="z.B. 12. AK / 45. gesamt" /></label>
        <label className="field"><span><T k="races.form.avgHr">Ø-HF (bpm)</T></span><input type="number" min="0" value={e.avg_hr ?? ""} onChange={(x) => set({ avg_hr: num(x.target.value) })} placeholder="z.B. 172" /></label>
        <label className="field"><span><T k="races.form.maxHr">Max-HF (bpm)</T></span><input type="number" min="0" value={e.max_hr ?? ""} onChange={(x) => set({ max_hr: num(x.target.value) })} placeholder="z.B. 188" /></label>
        <label className="field"><span><T k="races.form.elev">Höhenmeter (m)</T></span><input type="number" min="0" value={e.elevation_m ?? ""} onChange={(x) => set({ elevation_m: num(x.target.value) })} placeholder="z.B. 120" /></label>
      </div>

      <div className="spread" style={{ marginTop: 8 }}><h3><T k="races.splits">Splits</T></h3><button className="sm" onClick={addSplit}><T k="races.btn.addSplit">+ Split</T></button></div>
      {splits.length > 0 && (
        <table>
          <thead><tr><th><T k="races.splits.col.km">km</T></th><th><T k="races.splits.col.time">Zeit (mm:ss)</T></th><th><T k="races.splits.col.pace">Pace</T></th><th><T k="races.splits.col.avgHr">Ø-HF</T></th><th><T k="races.splits.col.maxHr">Max-HF</T></th><th><T k="races.splits.col.elev">Höhenmeter</T></th><th></th></tr></thead>
          <tbody>
            {splits.map((s, i) => (
              <tr key={i}>
                {/* km + Zeit uncontrolled (key + defaultValue + onBlur) → freies Tippen, Parse erst beim Verlassen */}
                <td style={{ width: 120 }}><input key={`km-${i}-${s.km}`} type="number" step="0.1" min="0" defaultValue={s.km ?? ""} onBlur={(x) => setSplit(i, { km: num(x.target.value) })} /></td>
                <td style={{ width: 110 }}><input key={`t-${i}-${s.time_s}`} defaultValue={s.time_s != null ? fmtTime(s.time_s) : ""} onBlur={(x) => setSplit(i, { time_s: parseTime(x.target.value) })} placeholder="3:48" /></td>
                <td className="muted">{s.pace_s ? `${paceStr(s.pace_s)}/km` : "—"}</td>
                <td style={{ width: 120 }}><input type="number" min="0" value={s.avg_hr ?? ""} onChange={(x) => setSplit(i, { avg_hr: num(x.target.value) })} /></td>
                <td style={{ width: 120 }}><input type="number" min="0" value={s.max_hr ?? ""} onChange={(x) => setSplit(i, { max_hr: num(x.target.value) })} /></td>
                <td style={{ width: 80 }}><input type="number" min="0" value={s.elevation_m ?? ""} onChange={(x) => setSplit(i, { elevation_m: num(x.target.value) })} /></td>
                <td><button className="sm ghost danger" onClick={() => delSplit(i)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <label className="field" style={{ marginTop: 8 }}><span><T k="races.form.notes">Notizen</T></span>
        <textarea value={e.notes ?? ""} rows={2} onChange={(x) => set({ notes: x.target.value })} /></label>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
        <button className="ghost" onClick={onClose}><T k="races.btn.cancel">Abbrechen</T></button>
        <button className="primary" onClick={save}><T k="races.btn.save">Speichern</T></button>
      </div>
    </div>
  );
}

// Pace je Split aus km + Zeit
function recomputePace(splits: RaceSplit[]): RaceSplit[] {
  return splits.map((s) => ({ ...s, pace_s: s.km && s.time_s ? Math.round(s.time_s / s.km) : null }));
}
