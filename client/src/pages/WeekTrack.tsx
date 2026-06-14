import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type PlannedSession, type Activity, type DailyLog, type ZoneSet } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import {
  DAY_NAMES, daysOfWeek, fmtDate, todayIso, typeColor, typeLabel, sportLabel, num,
  paceOrSpeed, isBikeSport, speedKmh, paceStr,
} from "../lib/util.ts";
import { useOptions, type Option } from "../lib/options.ts";
import WeekSelector from "../components/WeekSelector.tsx";
import EffortBuilder, { ZONE_COLORS, zoneRange } from "../components/EffortBuilder.tsx";
import "./track.css";

export default function WeekTrack() {
  const { season, week, weekNo, setWeekNo, loading } = useSeason();
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [daily, setDaily] = useState<Record<string, DailyLog>>({});
  const [coros, setCoros] = useState(0.6);
  const [zs, setZs] = useState<ZoneSet | null>(null);

  async function reload() {
    if (!week) return;
    const [s, a, d, set, z] = await Promise.all([
      api.sessions({ week: week.week_no }),
      api.activities({ from: week.start_date, to: week.end_date }),
      api.daily({ from: week.start_date, to: week.end_date }),
      api.settings(),
      api.zoneset(week.start_date).catch(() => null),
    ]);
    setSessions(s); setActs(a);
    setDaily(Object.fromEntries(d.map((x) => [x.date, x])));
    setCoros(set.coros_to_tss ?? 0.6);
    setZs(z);
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [week?.week_no]);

  // Sprung aus dem PMC: ?date=YYYY-MM-DD wählt die zugehörige Woche.
  const [params] = useSearchParams();
  useEffect(() => {
    const d = params.get("date");
    if (!d || !season.length) return;
    const w = season.find((x) => x.start_date <= d && d <= x.end_date);
    if (w) setWeekNo(w.week_no);
    // eslint-disable-next-line
  }, [season, params]);

  if (loading) return <p className="muted">Lädt…</p>;
  if (!week) return <div className="empty">Keine Woche — erst Saison anlegen (Einstellungen).</div>;

  const days = daysOfWeek(week.start_date);

  return (
    <div>
      <div className="spread"><h1>Tracking</h1><WeekSelector season={season} weekNo={weekNo} setWeekNo={setWeekNo}
        jumpTo={week ? { href: `/report?date=${week.start_date}`, title: "Zur gleichen Woche im Wochenbericht", label: "→ Bericht" } : undefined} /></div>
      <div className="card tight"><div className="row"><span className="pill phase">{week.phase}</span><strong>Woche {week.week_no}</strong><span className="muted tiny">{fmtDate(week.start_date)}–{fmtDate(week.end_date)}</span></div></div>

      {days.map((d, i) => (
        <DayCard key={d} date={d} dayName={DAY_NAMES[i]}
          planned={sessions.filter((s) => s.date === d)}
          acts={acts.filter((a) => a.date === d)}
          daily={daily[d]} coros={coros} zs={zs} onChange={reload} />
      ))}
    </div>
  );
}

function DayCard({ date, dayName, planned, acts, daily, coros, zs, onChange }: {
  date: string; dayName: string; planned: PlannedSession[]; acts: Activity[];
  daily?: DailyLog; coros: number; zs: ZoneSet | null; onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [quick, setQuick] = useState(false);
  const today = date === todayIso();

  // ToDo: Neue Aktivität mit der (noch nicht abgehakten) geplanten Einheit vorbefüllen.
  const matchedIds = new Set(acts.map((a) => a.matched_session_id).filter((x): x is number => x != null));
  const nextPlanned = planned.find((p) => p.type !== "Rest" && p.id != null && !matchedIds.has(p.id)) ?? null;
  const newAct: Activity = {
    date, source: "manual",
    sport: nextPlanned?.sport ?? "Run",
    type: nextPlanned?.type ?? null,
    name: nextPlanned ? (nextPlanned.description || typeLabel(nextPlanned.type)) : undefined,
    matched_session_id: nextPlanned?.id ?? null,
  };

  return (
    <div className={"day" + (today ? " today" : "")}>
      <div className="day-head">
        <span><span className="day-name">{dayName}</span> <span className="muted tiny">{fmtDate(date)}</span></span>
        <span className="row" style={{ gap: 4 }}>
          <button className="sm ghost" onClick={() => setQuick(!quick)}>+ Commute</button>
          <button className="sm ghost" onClick={() => setAdding(true)}>+ Aktivität</button>
        </span>
      </div>

      {planned.length > 0 && (
        <div className="tiny muted mb">Geplant: {planned.map((p) => (
          <span key={p.id} style={{ marginRight: 8 }}><span style={{ color: typeColor(p.type), fontWeight: 700 }}>●</span> {p.description || typeLabel(p.type)}</span>
        ))}</div>
      )}

      {quick && <QuickCommute date={date} onChange={() => { setQuick(false); onChange(); }} />}

      {acts.map((a) => <ActivityRow key={a.id} a={a} coros={coros} zs={zs} onChange={onChange} />)}
      {adding && <ActivityRow a={newAct} coros={coros} zs={zs} onChange={() => { setAdding(false); onChange(); }} isNew />}

      <DailyForm date={date} daily={daily} />
    </div>
  );
}

// ---- Schnellerfassung Commute / Allgemein (ToDo 19) ----------------------
function QuickCommute({ date, onChange }: { date: string; onChange: () => void }) {
  const [km, setKm] = useState("");
  const [min, setMin] = useState("");
  const d = num(km), m = num(min);

  async function save() {
    if (d == null && m == null) return;
    await api.addActivity({
      date, sport: "General", source: "manual", name: "Commute / Allgemein",
      distance_m: d != null ? d * 1000 : null, moving_s: m != null ? m * 60 : null,
    });
    onChange();
  }

  return (
    <div className="quick-row">
      <span className="tiny muted">Commute/Allgemein:</span>
      <input type="number" step="0.1" placeholder="km" value={km} onChange={(e) => setKm(e.target.value)} />
      <input type="number" placeholder="min" value={min} onChange={(e) => setMin(e.target.value)} />
      {d != null && m != null && <span className="tiny muted nowrap">{speedKmh(d * 1000, m * 60)}</span>}
      <button className="sm primary" onClick={save} disabled={d == null && m == null}>OK</button>
    </div>
  );
}

// ---- Aktivität (manuell, editierbar) -----------------------------------

/** Default-Einheit für die Zonen-Eingabe: vorhandene Werte gewinnen, sonst
 *  km bei Distanz-Sportarten, Minuten bei reinen Zeit-Sportarten (Rad/ohne Distanz). */
function defaultZoneUnit(x: Activity): "km" | "min" {
  if (x.zone_km && Object.keys(x.zone_km).length) return "km";
  if (x.zone_min && Object.keys(x.zone_min).length) return "min"; // Legacy-Werte anzeigen
  return isBikeSport(x.sport) || x.distance_m == null ? "min" : "km";
}

function ActivityRow({ a, coros, zs, onChange, isNew }: {
  a: Activity; coros: number; zs: ZoneSet | null; onChange: () => void; isNew?: boolean;
}) {
  const [e, setE] = useState<Activity>({ ...a });
  const [open, setOpen] = useState(!!isNew);
  const [zoneUnit, setZoneUnit] = useState<"km" | "min">(() => defaultZoneUnit(a));
  const [saving, setSaving] = useState(false);
  const { sports, sessionTypes } = useOptions();
  const set = (patch: Partial<Activity>) => setE((p) => ({ ...p, ...patch }));
  const bike = isBikeSport(e.sport);
  // Commute (ToDo Z.14): Sportart → „Allgemein/Commute" (General), Name „Commute", keine Notizen.
  const commute = e.sport === "General";
  const setCommute = (on: boolean) =>
    on ? set({ sport: "General", name: "Commute", notes: "" })
       : set({ sport: "BikeRoad", name: e.name === "Commute" ? "" : e.name });

  // Bug #76: Formular-State frisch aus den Props initialisieren, sobald man öffnet.
  // Vorher hielt die Zeile eine veraltete Kopie (`e` wurde nie re-synct) und save()
  // setzte den expanded-State nicht in jedem Pfad zurück — dadurch blieb das Formular
  // beim erneuten Bearbeiten nach dem Speichern offen bzw. zeigte verworfene Edits.
  function openForm() {
    setE({ ...a });
    setZoneUnit(defaultZoneUnit(a));
    setOpen(true);
  }

  const zm = e.zone_min || {};
  const zk = e.zone_km || {};
  const setZm = (z: number, v: number | null) => {
    const next = { ...zm } as Record<number, number>;
    if (v == null || v === 0) delete next[z]; else next[z] = v;
    set({ zone_min: Object.keys(next).length ? next : null });
  };
  const setZk = (z: number, v: number | null) => {
    const next = { ...zk } as Record<number, number>;
    if (v == null || v === 0) delete next[z]; else next[z] = v;
    set({ zone_km: Object.keys(next).length ? next : null });
  };
  const zkSum = Object.values(zk).reduce((s, x) => s + (x || 0), 0);

  async function save() {
    if (saving) return; // Doppel-Klick-Schutz
    setSaving(true);
    try {
      const tss = e.tss ?? (e.training_load != null ? Math.round(e.training_load * coros * 10) / 10 : null);
      const body = { ...e, tss };
      if (e.id) await api.updateActivity(e.id, body);
      else await api.addActivity(body);
      setOpen(false); // immer zuverlässig einklappen — auch im Re-Edit-Fall (#76)
      onChange();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    // Zugeklappt direkt aus den Props rendern — zeigt nach reload() immer den Server-Stand.
    const tempo = a.distance_m && a.moving_s ? paceOrSpeed(a.sport, a.distance_m, a.moving_s) : "";
    return (
      <div className="sess" onClick={openForm} style={{ cursor: "pointer" }}>
        <span className="type-pill" style={{ background: a.source === "strava" ? "#fc5200" : "#64748b" }}>{a.source === "strava" ? "Strava" : "manuell"}</span>
        <span style={{ flex: 1 }}>{a.name || sportLabel(a.sport)}</span>
        <span className="tiny muted nowrap">
          {a.distance_m ? (a.distance_m / 1000).toFixed(1) + " km" : ""}
          {a.sport === "Run" && a.ngp ? ` · GAP ${paceStr(a.ngp)}/km` : ""}
          {tempo && ` · ${tempo}`}
          {a.elevation ? ` · ${Math.round(a.elevation)} hm` : ""}
          {a.avg_hr ? ` · ${Math.round(a.avg_hr)} bpm` : ""}
          {a.kcal ? ` · ${Math.round(a.kcal)} kcal` : ""}
          {a.tss ? ` · ${Math.round(a.tss)} TSS` : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="card tight" style={{ background: "#fafbfd", marginBottom: 8 }}>
      {/* Layout in logische Blöcke (ToDo 13, v0.12.0): oben Sport/Typ/Name, dann Leistung, dann Körper/Last. */}
      <div className="grid cols-3" style={{ gap: 8 }}>
        <label className="field" style={{ margin: 0 }}><span>Sport</span><select value={e.sport} onChange={(x) => set({ sport: x.target.value })}>{sports.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        <label className="field" style={{ margin: 0 }}><span>Typ</span>
          <select value={e.type ?? ""} onChange={(x) => set({ type: x.target.value || null })} title="Einheitstyp (z.B. LT2, VO2max kurz) — steuert den Real-Donut & Intervall-Trend">
            <option value="">—</option>
            {sessionTypes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="field" style={{ margin: 0 }}><span>Name</span><input value={e.name ?? ""} onChange={(x) => set({ name: x.target.value })} disabled={commute} /></label>
      </div>
      {(bike || commute) && (
        <label className="row tiny" style={{ gap: 6, width: "auto", margin: "6px 0 0" }}>
          <input type="checkbox" checked={commute} onChange={(x) => setCommute(x.target.checked)} style={{ width: "auto" }}
            title="Kurze Fahrt als Commute markieren (keine Notizen, raus aus dem Wochenbericht)" /> Als Commute markieren
        </label>
      )}

      <div className="tiny muted" style={{ margin: "10px 0 3px", fontWeight: 600 }}>Leistung</div>
      <div className="grid cols-4" style={{ gap: 8 }}>
        <label className="field" style={{ margin: 0 }}><span>km</span><input type="number" step="0.1" value={e.distance_m != null ? e.distance_m / 1000 : ""} onChange={(x) => set({ distance_m: num(x.target.value) != null ? Number(x.target.value) * 1000 : null })} /></label>
        <label className="field" style={{ margin: 0 }}><span>Dauer (min)</span><input type="number" value={e.moving_s != null ? Math.round(e.moving_s / 60) : ""} onChange={(x) => set({ moving_s: num(x.target.value) != null ? Number(x.target.value) * 60 : null })} /></label>
        <label className="field" style={{ margin: 0 }}><span>{bike ? "Ø Geschwindigkeit" : "Ø Pace"}</span>
          <div style={{ padding: "6px 0", fontWeight: 600 }}>
            {paceOrSpeed(e.sport, e.distance_m, e.moving_s)}
            {e.sport === "Run" && e.ngp ? <span className="tiny muted" style={{ fontWeight: 400, marginLeft: 6 }}>· GAP {paceStr(e.ngp)}/km</span> : null}
          </div>
        </label>
        <label className="field" style={{ margin: 0 }}><span>Höhenmeter (hm)</span><input type="number" value={e.elevation ?? ""} onChange={(x) => set({ elevation: num(x.target.value) })} /></label>
      </div>

      <div className="tiny muted" style={{ margin: "10px 0 3px", fontWeight: 600 }}>Körper &amp; Last</div>
      <div className="grid" style={{ gap: 8, gridTemplateColumns: "repeat(5, 1fr)" }}>
        <label className="field" style={{ margin: 0 }}><span>Ø HF</span><input type="number" value={e.avg_hr ?? ""} onChange={(x) => set({ avg_hr: num(x.target.value) })} /></label>
        <label className="field" style={{ margin: 0 }}><span>Ø Power</span><input type="number" value={e.avg_power ?? ""} onChange={(x) => set({ avg_power: num(x.target.value) })} /></label>
        <label className="field" style={{ margin: 0 }}><span>kcal</span><input type="number" value={e.kcal ?? ""} onChange={(x) => set({ kcal: num(x.target.value) })} /></label>
        <label className="field" style={{ margin: 0 }}><span>COROS Load</span><input type="number" value={e.training_load ?? ""} onChange={(x) => set({ training_load: num(x.target.value) })} /></label>
        <label className="field" style={{ margin: 0 }}><span>TSS (optional)</span><input type="number" value={e.tss ?? ""} placeholder={e.training_load != null ? `${Math.round(e.training_load * coros)}` : ""} onChange={(x) => set({ tss: num(x.target.value) })} /></label>
      </div>

      {/* km je Zone (einheitlich mit Planung, #77) — Umschalter auf Minuten für reine Zeit-Sportarten */}
      <div style={{ marginTop: 10 }}>
        <div className="row" style={{ gap: 8, marginBottom: 3, alignItems: "center" }}>
          <div className="tiny muted">
            {zoneUnit === "km"
              ? <>km je Zone <span className="tiny">(wie in der Planung · Summe {Math.round(zkSum * 10) / 10} km)</span></>
              : <>Zeit in Zone (Minuten)</>}
          </div>
          <span className="zone-unit-toggle" title="Eingabe je Zone in km oder Minuten">
            <button type="button" className={zoneUnit === "km" ? "on" : ""} onClick={() => setZoneUnit("km")}>km</button>
            <button type="button" className={zoneUnit === "min" ? "on" : ""} onClick={() => setZoneUnit("min")}>min</button>
          </span>
          {zoneUnit === "km" && Object.keys(zm).length > 0 && (
            <span className="tiny muted">(alte Minuten-Werte unter „min")</span>
          )}
        </div>
        <div className="zone-min-grid">
          {[1, 2, 3, 4, 5, 6].map((z) => {
            const zr = zoneRange(z, zs?.hr_zones, zs?.pace_zones);
            return (
              <div key={z} title={zr.title}>
                <div className="z-label" style={{ color: ZONE_COLORS[z - 1] }}>Z{z}</div>
                {zoneUnit === "km"
                  ? <input type="number" min={0} step="0.1" placeholder="km" value={zk[z] ?? ""} onChange={(x) => setZk(z, num(x.target.value))} />
                  : <input type="number" min={0} placeholder="min" value={zm[z] ?? ""} onChange={(x) => setZm(z, num(x.target.value))} />}
                {zr.hr && <div className="zone-hint">{zr.hr}</div>}
                {zr.pace && <div className="zone-hint">{zr.pace}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Strukturierte Belastungen (Intervalle real) — ToDo 1/20 */}
      <div style={{ marginTop: 10 }}>
        <EffortBuilder value={e.efforts ?? null} onChange={(ef) => set({ efforts: ef })}
          sport={e.sport} zones={zs?.hr_zones} />
      </div>

      {/* Editierbare Einheit-Notiz (ToDo #2): vorbefüllt mit Strava-Beschreibung, frei änderbar */}
      <div style={{ marginTop: 10 }}>
        <label className="field" style={{ margin: 0 }}>
          <span>Notizen zur Einheit (z.B. aus Strava — editierbar)</span>
          <textarea value={commute ? "" : (e.notes ?? "")} rows={2} disabled={commute}
            placeholder={commute ? "Commutes haben keine Notizen" : ""}
            onChange={(x) => set({ notes: x.target.value })} />
        </label>
      </div>

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
        {e.id && <button className="sm ghost danger" onClick={() => api.deleteActivity(e.id!).then(onChange)}>Löschen</button>}
        <button className="sm ghost" onClick={() => (a.id ? setOpen(false) : onChange())}>Abbrechen</button>
        <button className="sm primary" onClick={save} disabled={saving}>{saving ? "Speichert…" : "Speichern"}</button>
      </div>
    </div>
  );
}

// ---- Tägliche Wellness-Werte (konfigurierbar, ToDo 12 v0.12.0) -----------
// Felder kommen aus den Auswahllisten (kind='daily'); Basis-Felder sind fest. Bekannte Spalten landen in
// den daily_log_v2-Spalten, eigene Felder in der custom-JSON-Spalte. `legs` bleibt ein Spezialfeld.
const KNOWN_DAILY_COLS = new Set([
  "weight", "resting_hr", "hrv", "recovery", "strain", "sleep_h", "bedtime", "wake_time",
  "sleep_efficiency", "sleep_consistency", "sleep_performance", "rem_h", "deep_h", "resp_rate", "spo2",
  "energy", "mood", "stress", "motivation", "legs", "soreness", "pain", "pain_location",
  "rpe", "alcohol", "caffeine", "hydration", "fueling", "travel", "sick", "notes",
]);

function parseCustom(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  if (typeof v === "string" && v.trim()) { try { return JSON.parse(v); } catch { return {}; } }
  return {};
}

function DailyForm({ date, daily }: { date: string; daily?: DailyLog }) {
  const { dailyFields, dailyCats } = useOptions();
  const [v, setV] = useState<Record<string, unknown>>(daily || {});
  useEffect(() => setV(daily || {}), [daily]);
  const custom = parseCustom(v.custom);
  const getVal = (f: Option) => (KNOWN_DAILY_COLS.has(f.value) ? v[f.value] : custom[f.value]);
  const save = (f: Option, val: unknown) => {
    if (KNOWN_DAILY_COLS.has(f.value)) { setV((p) => ({ ...p, [f.value]: val })); api.saveDaily(date, { [f.value]: val }); }
    else {
      const nextCustom = { ...custom, [f.value]: val };
      setV((p) => ({ ...p, custom: nextCustom })); api.saveDaily(date, { custom: { [f.value]: val } });
    }
  };
  const saveLegs = (val: string) => { setV((p) => ({ ...p, legs: val })); api.saveDaily(date, { legs: val }); };

  // Felder je Kategorie gruppieren (Feld.color = Kategorie-Wert; ToDo v0.13.0). Unbekannte → „Sonstiges".
  const cats = dailyCats.length ? dailyCats : [{ kind: "dailyCat", value: "", label: "Tagesfaktoren" } as Option];
  const known = new Set(cats.map((c) => c.value));
  const uncategorized = dailyFields.filter((f) => !known.has(f.color || ""));
  const groups: { cat: Option; fields: Option[] }[] = cats.map((c) => ({ cat: c, fields: dailyFields.filter((f) => (f.color || "") === c.value) }));
  if (uncategorized.length) groups.push({ cat: { kind: "dailyCat", value: "__rest__", label: "Sonstiges" }, fields: uncategorized });
  // „Beine"-Spezialfeld in die Subjektiv-Kategorie (sonst erste).
  const legsCat = groups.find((g) => g.cat.value === "subjektiv")?.cat.value ?? groups[0]?.cat.value;

  const [openCats, setOpenCats] = useState<Set<string>>(() => new Set(groups.length ? [groups[0].cat.value] : []));
  const toggle = (val: string) => setOpenCats((s) => { const n = new Set(s); if (n.has(val)) n.delete(val); else n.add(val); return n; });

  return (
    <div className="df">
      {groups.map((g) => {
        if (!g.fields.length && g.cat.value !== legsCat) return null;
        const open = openCats.has(g.cat.value);
        return (
          <div key={g.cat.value} className="df-section">
            <div className="df-title" style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggle(g.cat.value)}>
              <span style={{ fontSize: 10, color: "var(--muted)", marginRight: 6 }}>{open ? "▾" : "▸"}</span>{g.cat.label}
            </div>
            {open && (
              <div className="df-grid">
                {g.fields.map((f) => (
                  <DailyField key={`${f.value}-${String(getVal(f) ?? "")}`} field={f} value={getVal(f)} onSave={(val) => save(f, val)} />
                ))}
                {g.cat.value === legsCat && (
                  <div className="df-field">
                    <div className="df-label">Beine</div>
                    <select value={(v.legs as string) ?? ""} onChange={(e) => saveLegs(e.target.value)}>
                      <option value="">–</option><option value="easy">easy</option><option value="ok">ok</option><option value="hard">hard</option>
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DailyField({ field, value, onSave }: { field: Option; value: unknown; onSave: (v: unknown) => void }) {
  const type = field.intensity || "number";
  if (type === "checkbox") {
    return (
      <label className="df-field check">
        <input type="checkbox" checked={Number(value ?? 0) === 1} onChange={(e) => onSave(e.target.checked ? 1 : 0)} />
        <span className="df-label" style={{ margin: 0 }}>{field.label}</span>
      </label>
    );
  }
  const inputType = type === "time" ? "time" : type === "text" ? "text" : "number";
  return (
    <div className={"df-field" + (type === "text" ? " wide" : "")}>
      <div className="df-label" title={field.label}>{field.label}</div>
      <input type={inputType} defaultValue={(value as string | number) ?? ""}
        onBlur={(e) => onSave(type === "text" || type === "time" ? e.target.value : num(e.target.value))} />
    </div>
  );
}
