// Wettkämpfe (ToDo #24): Liste + Detail-Erfassung mit manuellen Splits (km/Zeit/Pace/Ø-HF).
// Erscheinen zusätzlich als goldene Marker in PMC/Saison-Progression und einzeln im Wochenbericht.
import { useEffect, useRef, useState } from "react";
import { api, type Race, type RaceSplit, type PacingResult } from "../lib/api.ts";
import { fmtDateY, paceStr, todayIso, num } from "../lib/util.ts";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
  const [pacingRace, setPacingRace] = useState<Race | null>(null);
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
      {pacingRace && <PacingPanel race={pacingRace} onClose={() => setPacingRace(null)} />}

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
                    {r.distance_m && r.id && (
                      <button className="sm ghost" onClick={() => setPacingRace(r)} title="Pacing-Plan berechnen"><T k="races.btn.pacing">Pacing</T></button>
                    )}
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
  const [goalStr, setGoalStr] = useState(fmtTime(race.goal_time_s)); // v1.7.0 Wunsch-Zielzeit
  const set = (p: Partial<Race>) => setE((x) => ({ ...x, ...p }));
  const splits = e.splits || [];

  const setSplit = (i: number, p: Partial<RaceSplit>) => {
    const next = splits.map((s, j) => (j === i ? { ...s, ...p } : s));
    set({ splits: recomputePace(next) });
  };
  const addSplit = () => set({ splits: [...splits, { km: 1, time_s: null, avg_hr: null, max_hr: null, elevation_m: null }] });
  const delSplit = (i: number) => set({ splits: splits.filter((_, j) => j !== i) });

  async function save() {
    const body: Race = { ...e, distance_m: kmStr ? Number(kmStr) * 1000 : null, time_s: parseTime(timeStr), goal_time_s: parseTime(goalStr) };
    if (e.id) await api.updateRace(e.id, body); else await api.addRace(body);
    onSaved();
  }

  return (
    <div className="card" style={{ background: "var(--surface2)" }}>
      <div className="spread">
        <h2><T k={e.id ? "races.form.editTitle" : "races.form.newTitle"}>{e.id ? "Wettkampf bearbeiten" : "Neuer Wettkampf"}</T></h2>
        <button className="sm ghost" onClick={onClose}><T k="races.form.close">Schließen</T></button>
      </div>
      <div className="grid cols-4">
        <label className="field"><span><T k="races.form.date">Datum</T></span><input type="date" value={e.date} onChange={(x) => set({ date: x.target.value })} /></label>
        <label className="field"><span><T k="races.form.name">Name</T></span><input value={e.name ?? ""} onChange={(x) => set({ name: x.target.value })} placeholder="z.B. Olympia" /></label>
        <label className="field" style={{ gridColumn: "span 1" }}><span><T k="races.form.dist">Distanz (km)</T></span><input type="number" step="0.1" min="0" value={kmStr} onChange={(x) => setKmStr(x.target.value)} placeholder="z.B. 10" /></label>
        <label className="field"><span><T k="races.form.time">Endzeit (h:mm:ss)</T></span><input value={timeStr} onChange={(x) => setTimeStr(x.target.value)} placeholder="26:20" /></label>
        <label className="field"><span><T k="races.form.goalTime">Wunsch-Zielzeit (h:mm:ss)</T></span><input value={goalStr} onChange={(x) => setGoalStr(x.target.value)} placeholder="z.B. 36:00" title="Treibt die Pace-Progression der Trainings-Einheiten + den Soll/Ist-Abgleich" /></label>
        <label className="field"><span><T k="races.form.tuneup">Wettkampf-Art</T></span>
          <select value={e.is_tuneup ? "yes" : "no"} onChange={(x) => set({ is_tuneup: x.target.value === "yes" })} title="Test-/Aufbauwettkampf: der Block plant mit Mini-Taper (kein voller Taper) drumherum und liefert einen Fortschritts-Check.">
            <option value="no">Hauptrennen</option><option value="yes">Test-/Aufbauwettkampf</option>
          </select></label>
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

// ---- Pacing-Panel (v1.4.0, B2) ------------------------------------------

function PacingPanel({ race, onClose }: { race: Race; onClose: () => void }) {
  const [targetStr, setTargetStr] = useState(fmtTime(race.time_s));
  const [neg, setNeg] = useState(false);
  const [result, setResult] = useState<PacingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  function compute() {
    if (!race.id) return;
    const target = parseTime(targetStr);
    if (!target) { setErr("Ungültige Zeit."); return; }
    setErr(""); setBusy(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    api.racePacing(race.id, { target, neg })
      .then(setResult)
      .catch((e) => { if (!ctrl.signal.aborted) setErr(String(e)); })
      .finally(() => setBusy(false));
  }

  const km = (race.distance_m || 0) / 1000;
  const distLabel = km ? `${km} km` : "–";

  return (
    <div className="card" style={{ background: "var(--surface2)", marginBottom: 8 }}>
      <div className="spread">
        <h2 style={{ fontSize: 15 }}>Pacing-Plan — {race.name || distLabel}</h2>
        <button className="sm ghost" onClick={onClose}>Schließen</button>
      </div>
      <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 8 }}>
        <label className="field" style={{ margin: 0, width: 140 }}>
          <span>Zielzeit (h:mm:ss)</span>
          <input value={targetStr} onChange={(e) => setTargetStr(e.target.value)} placeholder="3:30:00"
            onKeyDown={(e) => e.key === "Enter" && compute()} />
        </label>
        <label className="field row" style={{ margin: 0, gap: 6, width: "auto" }}>
          <input type="checkbox" checked={neg} onChange={(e) => setNeg(e.target.checked)} style={{ width: "auto" }} />
          <span>Negativ-Split (+2%)</span>
        </label>
        <button onClick={compute} disabled={busy}>{busy ? "…" : "Berechnen"}</button>
        {err && <span className="tiny" style={{ color: "var(--danger, #ef4444)" }}>{err}</span>}
      </div>

      {result && (
        <>
          <div className="row tiny muted" style={{ gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
            <span>Distanz: <strong>{(result.distance_m / 1000).toFixed(1)} km</strong></span>
            <span>Zielzeit: <strong>{fmtTime(result.target_time_s)}</strong></span>
            <span>Even Pace: <strong>{paceStr(result.even_pace_s)}/km</strong></span>
            {result.hasProfile && <span>GAP-Basis: <strong>{paceStr(result.gap_pace_s)}/km</strong></span>}
            {result.negativeSplit && <span className="muted">(Negativ-Split aktiv)</span>}
            {result.hasProfile && <span className="muted">(Höhenprofil aus Splits)</span>}
          </div>

          {/* Mini-Chart: Pace je km */}
          <ResponsiveContainer width="100%" height={90}>
            <BarChart data={result.splits} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <XAxis dataKey="km" tick={{ fontSize: 9 }} interval={Math.floor(result.splits.length / 8)} />
              <YAxis domain={["dataMin - 10", "dataMax + 10"]} tick={{ fontSize: 9 }} tickFormatter={(v) => paceStr(v)} width={38} />
              <Tooltip formatter={(v: number, name: string) => [paceStr(v) + "/km", name === "pace_s" ? "Soll-Pace" : "GAP"]} labelFormatter={(l) => `km ${l}`} />
              <ReferenceLine y={result.even_pace_s} stroke="var(--muted, #94a3b8)" strokeDasharray="3 3" />
              <Bar dataKey="pace_s" name="pace_s" radius={[1, 1, 0, 0]}>
                {result.splits.map((s, i) => (
                  <Cell key={i} fill={s.pace_s > result.even_pace_s + 10 ? "#f59e0b" : s.pace_s < result.even_pace_s - 10 ? "#22c55e" : "#3b82f6"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Split-Tabelle */}
          <table style={{ marginTop: 6, fontSize: 12 }}>
            <thead>
              <tr>
                <th>km</th>
                {result.hasProfile && <th>Steig.</th>}
                <th>Soll-Pace</th>
                {result.hasProfile && <th>GAP</th>}
                <th>Kumuliert</th>
                {result.hasProfile && <th>Hm</th>}
              </tr>
            </thead>
            <tbody>
              {result.splits.map((s, i) => (
                <tr key={i}>
                  <td className="muted">{s.km}</td>
                  {result.hasProfile && <td className={s.gradient > 0.03 ? "warn" : s.gradient < -0.03 ? "" : "muted"}>{(s.gradient * 100).toFixed(1)}%</td>}
                  <td><strong>{paceStr(s.pace_s)}</strong></td>
                  {result.hasProfile && <td className="muted">{paceStr(s.gap_s)}</td>}
                  <td className="muted">{fmtTime(s.cum_s)}</td>
                  {result.hasProfile && <td className="muted">{s.elev_gain_m != null ? (s.elev_gain_m > 0 ? "+" : "") + s.elev_gain_m : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
