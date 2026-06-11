import { useEffect, useState } from "react";
import { api, type PlannedSession, type Activity, type DailyLog } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import {
  DAY_NAMES, SPORTS, SESSION_TYPES, daysOfWeek, fmtDate, todayIso, typeColor, typeLabel, sportLabel, num,
} from "../lib/util.ts";
import WeekSelector from "../components/WeekSelector.tsx";

export default function WeekTrack() {
  const { season, week, weekNo, setWeekNo, loading } = useSeason();
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [daily, setDaily] = useState<Record<string, DailyLog>>({});
  const [coros, setCoros] = useState(0.6);

  async function reload() {
    if (!week) return;
    const [s, a, d, set] = await Promise.all([
      api.sessions({ week: week.week_no }),
      api.activities({ from: week.start_date, to: week.end_date }),
      api.daily({ from: week.start_date, to: week.end_date }),
      api.settings(),
    ]);
    setSessions(s); setActs(a);
    setDaily(Object.fromEntries(d.map((x) => [x.date, x])));
    setCoros(set.coros_to_tss ?? 0.6);
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [week?.week_no]);

  if (loading) return <p className="muted">Lädt…</p>;
  if (!week) return <div className="empty">Keine Woche — erst Saison anlegen (Einstellungen).</div>;

  const days = daysOfWeek(week.start_date);

  return (
    <div>
      <div className="spread"><h1>Tracking</h1><WeekSelector season={season} weekNo={weekNo} setWeekNo={setWeekNo} /></div>
      <div className="card tight"><div className="row"><span className="pill phase">{week.phase}</span><strong>Woche {week.week_no}</strong><span className="muted tiny">{fmtDate(week.start_date)}–{fmtDate(week.end_date)}</span></div></div>

      {days.map((d, i) => (
        <DayCard key={d} date={d} dayName={DAY_NAMES[i]}
          planned={sessions.filter((s) => s.date === d)}
          acts={acts.filter((a) => a.date === d)}
          daily={daily[d]} coros={coros} onChange={reload} />
      ))}
    </div>
  );
}

function DayCard({ date, dayName, planned, acts, daily, coros, onChange }: {
  date: string; dayName: string; planned: PlannedSession[]; acts: Activity[];
  daily?: DailyLog; coros: number; onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [more, setMore] = useState(false);
  const today = date === todayIso();
  return (
    <div className={"day" + (today ? " today" : "")}>
      <div className="day-head">
        <span><span className="day-name">{dayName}</span> <span className="muted tiny">{fmtDate(date)}</span></span>
        <button className="sm ghost" onClick={() => setAdding(true)}>+ Aktivität</button>
      </div>

      {planned.length > 0 && (
        <div className="tiny muted mb">Geplant: {planned.map((p) => (
          <span key={p.id} style={{ marginRight: 8 }}><span style={{ color: typeColor(p.type), fontWeight: 700 }}>●</span> {p.description || typeLabel(p.type)}</span>
        ))}</div>
      )}

      {acts.map((a) => <ActivityRow key={a.id} a={a} coros={coros} onChange={onChange} />)}
      {adding && <ActivityRow a={{ date, sport: "Run", source: "manual" }} coros={coros} onChange={() => { setAdding(false); onChange(); }} isNew />}

      <DailyForm date={date} daily={daily} more={more} setMore={setMore} />
    </div>
  );
}

// ---- Aktivität (manuell, editierbar) -----------------------------------
function ActivityRow({ a, coros, onChange, isNew }: { a: Activity; coros: number; onChange: () => void; isNew?: boolean }) {
  const [e, setE] = useState<Activity>({ ...a });
  const [open, setOpen] = useState(!!isNew);
  const set = (patch: Partial<Activity>) => setE((p) => ({ ...p, ...patch }));

  async function save() {
    const tss = e.tss ?? (e.training_load != null ? Math.round(e.training_load * coros * 10) / 10 : null);
    const body = { ...e, tss };
    if (e.id) await api.updateActivity(e.id, body); else await api.addActivity(body);
    onChange();
  }

  if (!open) {
    return (
      <div className="sess" onClick={() => setOpen(true)} style={{ cursor: "pointer" }}>
        <span className="type-pill" style={{ background: e.source === "strava" ? "#fc5200" : "#64748b" }}>{e.source === "strava" ? "Strava" : "manuell"}</span>
        <span style={{ flex: 1 }}>{e.name || sportLabel(e.sport)}</span>
        <span className="tiny muted nowrap">{e.distance_m ? (e.distance_m / 1000).toFixed(1) + " km" : ""} {e.avg_hr ? `· ${Math.round(e.avg_hr)} bpm` : ""} {e.tss ? `· ${Math.round(e.tss)} TSS` : ""}</span>
      </div>
    );
  }

  return (
    <div className="card tight" style={{ background: "#fafbfd", marginBottom: 8 }}>
      <div className="grid cols-4" style={{ gap: 8 }}>
        <label className="field" style={{ margin: 0 }}><span>Sport</span><select value={e.sport} onChange={(x) => set({ sport: x.target.value })}>{SPORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        <label className="field" style={{ margin: 0 }}><span>Name</span><input value={e.name ?? ""} onChange={(x) => set({ name: x.target.value })} /></label>
        <label className="field" style={{ margin: 0 }}><span>km</span><input type="number" step="0.1" value={e.distance_m != null ? e.distance_m / 1000 : ""} onChange={(x) => set({ distance_m: num(x.target.value) != null ? Number(x.target.value) * 1000 : null })} /></label>
        <label className="field" style={{ margin: 0 }}><span>Dauer (min)</span><input type="number" value={e.moving_s != null ? Math.round(e.moving_s / 60) : ""} onChange={(x) => set({ moving_s: num(x.target.value) != null ? Number(x.target.value) * 60 : null })} /></label>
        <label className="field" style={{ margin: 0 }}><span>Ø HF</span><input type="number" value={e.avg_hr ?? ""} onChange={(x) => set({ avg_hr: num(x.target.value) })} /></label>
        <label className="field" style={{ margin: 0 }}><span>Ø Power</span><input type="number" value={e.avg_power ?? ""} onChange={(x) => set({ avg_power: num(x.target.value) })} /></label>
        <label className="field" style={{ margin: 0 }}><span>COROS Load</span><input type="number" value={e.training_load ?? ""} onChange={(x) => set({ training_load: num(x.target.value) })} /></label>
        <label className="field" style={{ margin: 0 }}><span>TSS (optional)</span><input type="number" value={e.tss ?? ""} placeholder={e.training_load != null ? `${Math.round(e.training_load * coros)}` : ""} onChange={(x) => set({ tss: num(x.target.value) })} /></label>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
        {e.id && <button className="sm ghost danger" onClick={() => api.deleteActivity(e.id!).then(onChange)}>Löschen</button>}
        <button className="sm primary" onClick={save}>Speichern</button>
      </div>
    </div>
  );
}

// ---- Tägliche Wellness-Werte -------------------------------------------
const CORE: [string, string, string?][] = [
  ["weight", "Gewicht (kg)"], ["resting_hr", "Ruhepuls"], ["hrv", "HRV"], ["recovery", "Recovery %"],
  ["strain", "Strain"], ["sleep_h", "Schlaf (h)"], ["rpe", "RPE"], ["pain", "Schmerz 0-10"],
];
const EXTRA: [string, string][] = [
  ["bedtime", "Bettzeit"], ["wake_time", "Aufwachzeit"], ["sleep_efficiency", "Schlaf-Eff. %"], ["sleep_consistency", "Schlaf-Kons. %"],
  ["rem_h", "REM (h)"], ["deep_h", "Tief (h)"], ["resp_rate", "Atemfreq."], ["spo2", "SpO2 %"],
  ["energy", "Energie 1-10"], ["mood", "Stimmung 1-10"], ["stress", "Stress 1-10"], ["motivation", "Motivation 1-10"],
  ["soreness", "Muskelkater 0-10"], ["pain_location", "Schmerz-Ort"], ["alcohol", "Alkohol"], ["caffeine", "Koffein"],
];

function DailyForm({ date, daily, more, setMore }: { date: string; daily?: DailyLog; more: boolean; setMore: (b: boolean) => void }) {
  const [v, setV] = useState<Record<string, unknown>>(daily || {});
  useEffect(() => setV(daily || {}), [daily]);
  const save = (k: string, val: unknown) => { const next = { ...v, [k]: val }; setV(next); api.saveDaily(date, { [k]: val }); };
  const isTime = (k: string) => k === "bedtime" || k === "wake_time";
  const isText = (k: string) => k === "pain_location";

  return (
    <div style={{ borderTop: "1px dashed var(--line)", paddingTop: 8, marginTop: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {CORE.map(([k, label]) => (
          <MiniField key={k} label={label} value={v[k]} onSave={(val) => save(k, val)} />
        ))}
        <div style={{ minWidth: 90 }}>
          <div className="tiny muted">Beine</div>
          <select value={(v.legs as string) ?? ""} onChange={(e) => save("legs", e.target.value)} style={{ padding: "4px" }}>
            <option value="">–</option><option value="easy">easy</option><option value="ok">ok</option><option value="hard">hard</option>
          </select>
        </div>
        <button className="sm ghost" onClick={() => setMore(!more)}>{more ? "weniger" : "mehr Werte"}</button>
      </div>
      {more && (
        <div className="row mt" style={{ gap: 6, flexWrap: "wrap" }}>
          {EXTRA.map(([k, label]) => (
            isText(k)
              ? <div key={k} style={{ minWidth: 110 }}><div className="tiny muted">{label}</div><input value={(v[k] as string) ?? ""} onBlur={(e) => save(k, e.target.value)} onChange={(e) => setV({ ...v, [k]: e.target.value })} style={{ padding: "4px" }} /></div>
              : <MiniField key={k} label={label} value={v[k]} type={isTime(k) ? "time" : "number"} onSave={(val) => save(k, val)} />
          ))}
          <div style={{ flex: "1 1 100%" }}><div className="tiny muted">Notizen</div><input value={(v.notes as string) ?? ""} onChange={(e) => setV({ ...v, notes: e.target.value })} onBlur={(e) => save("notes", e.target.value)} /></div>
        </div>
      )}
    </div>
  );
}

function MiniField({ label, value, onSave, type = "number" }: { label: string; value: unknown; onSave: (v: unknown) => void; type?: string }) {
  return (
    <div style={{ width: 78 }}>
      <div className="tiny muted nowrap">{label}</div>
      <input type={type} defaultValue={(value as string | number) ?? ""} style={{ padding: "4px", textAlign: "center" }}
        onBlur={(e) => onSave(type === "number" ? num(e.target.value) : e.target.value)} />
    </div>
  );
}
