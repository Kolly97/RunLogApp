import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type PlannedSession, type Activity, type DailyLog, type ZoneSet } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import {
  DAY_NAMES, daysOfWeek, fmtDate, todayIso, typeColor, typeLabel, sportLabel, num,
  paceOrSpeed, isBikeSport, speedKmh, paceStr, clockToSec, secToClock,
} from "../lib/util.ts";
import { useOptions, type Option } from "../lib/options.ts";
import WeekSelector from "../components/WeekSelector.tsx";
import EffortBuilder, { ZONE_COLORS, zoneRange } from "../components/EffortBuilder.tsx";
import T from "../components/T.tsx";
import { useT } from "../lib/i18n.tsx";
import "./track.css";

export default function WeekTrack() {
  const { season, week, weekNo, setWeekNo, loading } = useSeason();
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [daily, setDaily] = useState<Record<string, DailyLog>>({});
  const [zs, setZs] = useState<ZoneSet | null>(null);
  const [extra, setExtra] = useState(false); // „Zusätzliche Einheit" mit freiem Datum (v0.14.0)
  const [adh, setAdh] = useState<Record<number, { pct: number; tssOnly: boolean }>>({}); // Plan-Erfüllung je Einheit (v0.14.0)
  const [view, setView] = useState<"day" | "week">("day"); // Tages-Switcher (Default) vs. ganze Woche (v0.14.0, ToDo 13)
  const [selDate, setSelDate] = useState<string>(""); // gewählter Tag im Tag-Modus

  async function reload() {
    if (!week) return;
    const [s, a, d, z, an] = await Promise.all([
      api.sessions({ week: week.week_no }),
      api.activities({ from: week.start_date, to: week.end_date }),
      api.daily({ from: week.start_date, to: week.end_date }),
      api.zoneset(week.start_date).catch(() => null),
      api.analyzeWeek(week.week_no).catch(() => null),
    ]);
    setSessions(s); setActs(a);
    setDaily(Object.fromEntries(d.map((x) => [x.date, x])));
    setZs(z);
    const map: Record<number, { pct: number; tssOnly: boolean }> = {};
    for (const p of an?.adherence?.perSession ?? []) map[p.session_id] = { pct: p.pct, tssOnly: p.tssOnly };
    setAdh(map);
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [week?.week_no]);

  // Gewählten Tag setzen, wenn die Woche wechselt: heute (falls in der Woche), sonst Wochenstart.
  useEffect(() => {
    if (!week) return;
    const td = todayIso();
    setSelDate(td >= week.start_date && td <= week.end_date ? td : week.start_date);
  }, [week?.week_no]); // eslint-disable-line

  // Sprung aus dem PMC: ?date=YYYY-MM-DD wählt die zugehörige Woche (und den Tag).
  const [params] = useSearchParams();
  useEffect(() => {
    const d = params.get("date");
    if (!d || !season.length) return;
    const w = season.find((x) => x.start_date <= d && d <= x.end_date);
    if (w) { setWeekNo(w.week_no); setSelDate(d); }
    // eslint-disable-next-line
  }, [season, params]);

  const t = useT();
  if (loading) return <p className="muted"><T k="track.loading">Lädt…</T></p>;
  if (!week) return <div className="empty"><T k="track.noWeek">Keine Woche — erst Saison anlegen (Einstellungen).</T></div>;

  const days = daysOfWeek(week.start_date);
  const extraAct: Activity = { date: todayIso(), source: "manual", sport: "Run", type: null };
  // Gewählter Tag robust: gesetzter selDate, sonst heute (falls in Woche), sonst erster Tag.
  const curDay = days.includes(selDate) ? selDate : (days.includes(todayIso()) ? todayIso() : days[0]);

  const dayCard = (d: string) => (
    <DayCard key={d} date={d} dayName={DAY_NAMES[days.indexOf(d)]}
      planned={sessions.filter((s) => s.date === d)}
      acts={acts.filter((a) => a.date === d)}
      daily={daily[d]} zs={zs} adh={adh} onChange={reload} />
  );

  return (
    <div>
      <div className="spread"><h1><T k="track.title">Tracking</T></h1>
        <div className="row" style={{ width: "auto", gap: 8 }}>
          <span className="seg" title={t("track.view.toggle", "Einzelnen Tag oder die ganze Woche zeigen")}>
            <button className={view === "day" ? "active" : ""} onClick={() => setView("day")}><T k="track.view.day">Tag</T></button>
            <button className={view === "week" ? "active" : ""} onClick={() => setView("week")}><T k="track.view.week">Woche</T></button>
          </span>
          <button className="sm" onClick={() => setExtra(true)} title={t("track.btn.extraSession.title", "Eine getrackte Einheit mit frei wählbarem Datum eintragen (auch außerhalb dieser Woche)")}><T k="track.btn.extraSession">+ Zusätzliche Einheit</T></button>
          <WeekSelector season={season} weekNo={weekNo} setWeekNo={setWeekNo}
            jumpTo={week ? { href: `/report?date=${week.start_date}`, title: "Zur gleichen Woche im Wochenbericht", label: "→ Bericht" } : undefined} />
        </div>
      </div>
      <div className="card tight"><div className="row"><span className="pill phase">{week.phase}</span><strong>Woche {week.week_no}</strong><span className="muted tiny">{fmtDate(week.start_date)}–{fmtDate(week.end_date)}</span></div></div>

      {extra && (
        <div className="card tight" style={{ marginBottom: 10 }}>
          <div className="tiny muted mb"><T k="track.extra.hint">Zusätzliche getrackte Einheit (Datum frei wählbar)</T></div>
          <ActivityRow a={extraAct} zs={zs} isNew dateEditable onChange={() => { setExtra(false); reload(); }} />
        </div>
      )}

      {view === "day" ? (
        <>
          <WeekdayTabs days={days} sessions={sessions} acts={acts} adh={adh} selDate={curDay} onSelect={setSelDate} />
          {dayCard(curDay)}
        </>
      ) : (
        days.map((d) => dayCard(d))
      )}
    </div>
  );
}

// Wochentag-Switcher (v0.14.0, ToDo 13): Tabs Mo–So mit Farbpunkten je geplanter Einheit (Typ-Farbe)
// + grünem Punkt, sobald an dem Tag eine Einheit getrackt ist.
// Aerobe Entkopplung (v1.2.0): <5 % solide / 5–10 % mittel / >10 % schwach; negativ = besser.
function decouplingColor(v: number): string { return v <= 5 ? "var(--ok)" : v <= 10 ? "var(--warn)" : "var(--danger)"; }
function decouplingLabel(v: number): string { return `Entk. ${v > 0 ? "+" : ""}${v}%`; }

function dotSize(tss?: number | null): number {
  if (!tss || tss <= 0) return 7;
  return Math.round(Math.max(6, Math.min(14, 6 + Math.sqrt(tss) * 0.75)));
}

function WeekdayTabs({ days, sessions, acts, adh, selDate, onSelect }: {
  days: string[]; sessions: PlannedSession[]; acts: Activity[];
  adh: Record<number, { pct: number; tssOnly: boolean }>; selDate: string; onSelect: (d: string) => void;
}) {
  const today = todayIso();
  return (
    <div className="wd-tabs">
      {days.map((d, i) => {
        const planned = sessions.filter((s) => s.date === d && s.type !== "Rest");
        const dayActs = acts.filter((a) => a.date === d);
        return (
          <button key={d} type="button" onClick={() => onSelect(d)}
            className={"wd-tab" + (d === selDate ? " active" : "") + (d === today ? " today" : "")}>
            <div className="wd-name">{DAY_NAMES[i]}</div>
            <div className="wd-date">{fmtDate(d)}</div>
            <div className="wd-dots">
              {planned.map((p) => {
                const sz = dotSize(p.planned_tss);
                const pa = p.id != null ? adh[p.id] : undefined;
                const title = [typeLabel(p.type), p.planned_tss ? `${Math.round(p.planned_tss)} TSS` : null, pa ? `${pa.pct}% Plan` : null].filter(Boolean).join(" · ");
                return (
                  <span key={p.id} className="dot" title={title}
                    style={{ background: typeColor(p.type), width: sz, height: sz, minWidth: sz }} />
                );
              })}
              {dayActs.map((a, ai) => {
                const sz = dotSize(a.tss);
                const col = typeColor(a.type ?? "");
                return (
                  <span key={`act-${ai}`} className="dot"
                    title={[a.name || sportLabel(a.sport), a.tss ? `${Math.round(a.tss)} TSS (absolviert)` : "absolviert"].filter(Boolean).join(" · ")}
                    style={{ background: col, width: sz, height: sz, minWidth: sz, boxShadow: `0 0 0 2px #fff, 0 0 0 3.5px ${col}` }} />
                );
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DayCard({ date, dayName, planned, acts, daily, zs, adh, onChange }: {
  date: string; dayName: string; planned: PlannedSession[]; acts: Activity[];
  daily?: DailyLog; zs: ZoneSet | null; adh: Record<number, { pct: number; tssOnly: boolean }>; onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [quick, setQuick] = useState(false);
  const t = useT();
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
          <button className="sm ghost" onClick={() => setQuick(!quick)}><T k="track.btn.commute">+ Commute</T></button>
          <button className="sm ghost" onClick={() => setAdding(true)}><T k="track.btn.addActivity">+ Aktivität</T></button>
        </span>
      </div>

      {planned.length > 0 && (
        <div className="tiny muted mb"><T k="track.planned">Geplant:</T> {planned.map((p) => (
          <span key={p.id} style={{ marginRight: 8 }}><span style={{ color: typeColor(p.type), fontWeight: 700 }}>●</span> {p.description || typeLabel(p.type)}</span>
        ))}</div>
      )}

      {quick && <QuickCommute date={date} onChange={() => { setQuick(false); onChange(); }} />}

      {acts.map((a) => <ActivityRow key={a.id} a={a} zs={zs} adh={adh} onChange={onChange} />)}
      {adding && <ActivityRow a={newAct} zs={zs} adh={adh} onChange={() => { setAdding(false); onChange(); }} isNew />}

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

function ActivityRow({ a, zs, adh, onChange, isNew, dateEditable }: {
  a: Activity; zs: ZoneSet | null; adh?: Record<number, { pct: number; tssOnly: boolean }>; onChange: () => void; isNew?: boolean; dateEditable?: boolean;
}) {
  const [e, setE] = useState<Activity>({ ...a });
  const [open, setOpen] = useState(!!isNew);
  const [zoneUnit, setZoneUnit] = useState<"km" | "min">(() => defaultZoneUnit(a));
  const [saving, setSaving] = useState(false);
  const { sports, sessionTypes } = useOptions();
  const tr = useT();
  const set = (patch: Partial<Activity>) => setE((p) => ({ ...p, ...patch }));
  const bike = isBikeSport(e.sport);
  // Commute (ToDo Z.14): Sportart → „Allgemein/Commute" (General), Name „Commute", keine Notizen.
  const commute = e.sport === "General";
  const showTyp = e.sport === "Run" || e.sport === "BikeRoad";
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
      const tss = e.tss ?? null;
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
    const pa = a.matched_session_id != null ? adh?.[a.matched_session_id] : undefined; // Plan-Erfüllung (v0.14.0)
    const paColor = pa ? (pa.pct >= 90 ? "var(--ok)" : pa.pct >= 70 ? "var(--form)" : "var(--danger)") : "";
    return (
      <div className="sess" onClick={openForm} style={{ cursor: "pointer", borderLeft: `4px solid ${typeColor(a.type ?? "")}` }}>
        <span className="type-pill" style={{ background: a.source === "strava" ? "#fc5200" : "#64748b" }}>{a.source === "strava" ? "Strava" : "manuell"}</span>
        <span style={{ flex: 1 }}>{a.name || sportLabel(a.sport)}</span>
        {pa && <span className="type-pill" style={{ background: paColor }} title={pa.tssOnly ? "nur TSS — Pace-Zonen noch nicht verfügbar (Details nachziehen)" : "Plan-Erfüllung: TSS-Treffer + Zeit in Ziel-Pace-Zone"}>{pa.pct}% Plan{pa.tssOnly ? "*" : ""}</span>}
        <span className="tiny muted nowrap">
          {a.distance_m ? (a.distance_m / 1000).toFixed(1) + " km" : ""}
          {a.sport === "Run" && a.ngp ? ` · GAP ${paceStr(a.ngp)}/km` : ""}
          {tempo && ` · ${tempo}`}
          {a.elevation ? ` · ${Math.round(a.elevation)} hm` : ""}
          {a.avg_hr ? ` · ${Math.round(a.avg_hr)} bpm` : ""}
          {a.sport === "Run" && a.decoupling != null ? <span style={{ color: decouplingColor(a.decoupling), fontWeight: 600 }}> · {decouplingLabel(a.decoupling)}</span> : ""}
          {a.kcal ? ` · ${Math.round(a.kcal)} kcal` : ""}
          {a.tss ? ` · ${Math.round(a.tss)} TSS` : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="card tight" style={{ background: "#fafbfd", marginBottom: 8 }}>
      {/* Zusätzliche Einheit mit frei wählbarem Datum (v0.14.0, ToDo 3) */}
      {dateEditable && (
        <label className="field" style={{ margin: "0 0 8px", maxWidth: 200 }}><span><T k="track.field.date">Datum</T></span>
          <input type="date" value={e.date} onChange={(x) => set({ date: x.target.value })} /></label>
      )}
      {/* Layout in logische Blöcke (ToDo 13, v0.12.0): oben Sport/Typ/Name, dann Leistung, dann Körper/Last. */}
      <div className={`grid ${showTyp ? "cols-3" : "cols-2"}`} style={{ gap: 8 }}>
        <label className="field" style={{ margin: 0 }}><span><T k="track.field.sport">Sport</T></span><select value={e.sport} onChange={(x) => set({ sport: x.target.value })}>{sports.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        {showTyp && <label className="field" style={{ margin: 0 }}><span><T k="track.field.type">Typ</T></span>
          <select value={e.type ?? ""} onChange={(x) => set({ type: x.target.value || null })} title="Einheitstyp (z.B. LT2, VO2max kurz) — steuert den Real-Donut & Intervall-Trend">
            <option value="">—</option>
            {sessionTypes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>}
        <label className="field" style={{ margin: 0 }}><span><T k="track.field.name">Name</T></span><input value={e.name ?? ""} onChange={(x) => set({ name: x.target.value })} disabled={commute} /></label>
      </div>
      {(bike || commute) && (
        <label className="row tiny" style={{ gap: 6, width: "auto", margin: "6px 0 0" }}>
          <input type="checkbox" checked={commute} onChange={(x) => setCommute(x.target.checked)} style={{ width: "auto" }}
            title={tr("track.commute.title", "Kurze Fahrt als Commute markieren (keine Notizen, raus aus dem Wochenbericht)")} /> <T k="track.commute.check">Als Commute markieren</T>
        </label>
      )}

      <div className="tiny muted" style={{ margin: "10px 0 3px", fontWeight: 600 }}><T k="track.section.performance">Leistung</T></div>
      <div className="grid cols-4" style={{ gap: 8 }}>
        <label className="field" style={{ margin: 0 }}><span><T k="track.field.km">km</T></span><input type="number" step="0.1" value={e.distance_m != null ? e.distance_m / 1000 : ""} onChange={(x) => set({ distance_m: num(x.target.value) != null ? Number(x.target.value) * 1000 : null })} /></label>
        <label className="field" style={{ margin: 0 }}><span><T k="track.field.duration">Dauer (h:mm:ss)</T></span><input key={`dur-${e.id ?? "new"}-${e.moving_s ?? ""}`} defaultValue={secToClock(e.moving_s)} placeholder="1:23:45" onBlur={(x) => set({ moving_s: clockToSec(x.target.value) })} /></label>
        <label className="field" style={{ margin: 0 }}><span>{bike ? "Ø Geschwindigkeit" : "Ø Pace"}</span>
          <div style={{ padding: "6px 0", fontWeight: 600 }}>
            {paceOrSpeed(e.sport, e.distance_m, e.moving_s)}
            {e.sport === "Run" && e.ngp ? <span className="tiny muted" style={{ fontWeight: 400, marginLeft: 6 }}>· GAP {paceStr(e.ngp)}/km</span> : null}
          </div>
        </label>
        <label className="field" style={{ margin: 0 }}><span><T k="track.field.elevation">Höhenmeter (hm)</T></span><input type="number" value={e.elevation ?? ""} onChange={(x) => set({ elevation: num(x.target.value) })} /></label>
      </div>

      <div className="tiny muted" style={{ margin: "10px 0 3px", fontWeight: 600 }}><T k="track.section.body">Körper &amp; Last</T></div>
      <div className="grid cols-4" style={{ gap: 8 }}>
        <label className="field" style={{ margin: 0 }}><span><T k="track.field.hr">Ø HF</T></span><input type="number" value={e.avg_hr ?? ""} onChange={(x) => set({ avg_hr: num(x.target.value) })} /></label>
        <label className="field" style={{ margin: 0 }}><span><T k="track.field.power">Ø Power</T></span><input type="number" value={e.avg_power ?? ""} onChange={(x) => set({ avg_power: num(x.target.value) })} /></label>
        <label className="field" style={{ margin: 0 }}><span><T k="track.field.kcal">kcal</T></span><input type="number" value={e.kcal ?? ""} onChange={(x) => set({ kcal: num(x.target.value) })} /></label>
        <label className="field" style={{ margin: 0 }}><span><T k="track.field.tss">TSS (optional)</T></span><input type="number" value={e.tss ?? ""} onChange={(x) => set({ tss: num(x.target.value) })} /></label>
      </div>

      {/* km je Zone (einheitlich mit Planung, #77) — Umschalter auf Minuten für reine Zeit-Sportarten */}
      <div style={{ marginTop: 10 }}>
        <div className="row" style={{ gap: 8, marginBottom: 3, alignItems: "center" }}>
          <div className="tiny muted">
            {zoneUnit === "km"
              ? <><T k="track.zone.km">km je Zone</T> <span className="tiny">({tr("track.zone.kmSub", "wie in der Planung · Summe")} {Math.round(zkSum * 10) / 10} km)</span></>
              : <T k="track.zone.min">Zeit in Zone (Minuten)</T>}
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
        <div className="spread" style={{ alignItems: "center", marginBottom: 2 }}>
          <span />
          {a.source === "strava" && a.id && (
            <button className="sm ghost" title="Intervalle aus Strava neu laden (hebt deine manuelle Sperre auf)"
              onClick={async () => {
                if (!window.confirm(tr("track.reloadStrava.confirm", "Intervalle dieser Einheit aus Strava neu laden? Deine manuellen Änderungen werden beim nächsten Sync ersetzt."))) return;
                try {
                  const r = await api.relinkEfforts(a.id!) as { efforts?: number };
                  onChange();
                  if (!r?.efforts) window.alert(tr("track.reloadStrava.none", "Keine Intervalle erkannt (keine Laps oder kein harter Abschnitt in dieser Aktivität)."));
                } catch (err) {
                  window.alert(`${tr("track.reloadStrava.err", "Neu laden fehlgeschlagen")}: ${err}`);
                }
              }}><T k="track.btn.reloadStrava">↻ Aus Strava neu laden</T></button>
          )}
        </div>
        <EffortBuilder value={e.efforts ?? null} onChange={(ef) => set({ efforts: ef })}
          sport={e.sport} zones={zs?.hr_zones} />
      </div>

      {/* Editierbare Einheit-Notiz (ToDo #2): vorbefüllt mit Strava-Beschreibung, frei änderbar */}
      <div style={{ marginTop: 10 }}>
        <label className="field" style={{ margin: 0 }}>
          <span><T k="track.field.notes">Notizen zur Einheit (z.B. aus Strava — editierbar)</T></span>
          <textarea value={commute ? "" : (e.notes ?? "")} rows={2} disabled={commute}
            placeholder={commute ? "Commutes haben keine Notizen" : ""}
            onChange={(x) => set({ notes: x.target.value })} />
        </label>
      </div>

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
        {e.id && <button className="sm ghost danger" onClick={() => api.deleteActivity(e.id!).then(onChange)}><T k="track.btn.delete">Löschen</T></button>}
        <button className="sm ghost" onClick={() => (a.id ? setOpen(false) : onChange())}><T k="track.btn.cancel">Abbrechen</T></button>
        <button className="sm primary" onClick={save} disabled={saving}>{saving ? tr("track.btn.saving", "Speichert…") : tr("track.btn.save", "Speichern")}</button>
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

const DURATION_FIELDS = new Set(["sleep_h", "rem_h", "deep_h"]);

function hhmm(h: number | null | undefined): string {
  if (h == null || !isFinite(h) || h < 0) return "";
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${hh}:${mm.toString().padStart(2, "0")}`;
}
function parseHhmm(t: string): number | null {
  const s = t.trim();
  if (!s) return null;
  if (s.includes(":")) {
    const [hStr, mStr] = s.split(":");
    const h = Number(hStr), m = Number(mStr);
    if (isNaN(h) || isNaN(m)) return null;
    return h + m / 60;
  }
  const n = Number(s.replace(",", "."));
  return isNaN(n) ? null : n;
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
  if (DURATION_FIELDS.has(field.value)) {
    return (
      <div className="df-field">
        <div className="df-label" title={field.label}>{field.label}</div>
        <input type="text" placeholder="h:mm" defaultValue={hhmm(value as number | null)}
          key={String(value ?? "")}
          onBlur={(e) => onSave(parseHhmm(e.target.value))} />
      </div>
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
