import { useEffect, useState } from "react";
import { api, type PlannedSession, type AnalyzeResult } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import {
  DAY_NAMES, daysOfWeek, fmtDate, todayIso, typeColor, typeLabel, sportLabel,
} from "../lib/util.ts";
import ZoneDistribution from "../charts/ZoneDistribution.tsx";
import IntensityCard from "../charts/IntensityCard.tsx";
import WeekSelector from "../components/WeekSelector.tsx";
import SessionModal from "../components/SessionModal.tsx";

export default function WeekPlan() {
  const { season, week, weekNo, setWeekNo, loading } = useSeason();
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [analyze, setAnalyze] = useState<AnalyzeResult | null>(null);
  const [editing, setEditing] = useState<PlannedSession | null>(null);

  async function reload() {
    if (weekNo == null) return;
    const s = await api.sessions({ week: weekNo });
    setSessions(s);
    setAnalyze(await api.analyzeWeek(weekNo));
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [weekNo]);

  if (loading) return <p className="muted">Lädt…</p>;
  if (!season.length)
    return <div className="empty">Noch kein Saisonplan. Lege unter <a href="/settings">Einstellungen</a> einen an oder importiere den bestehenden Plan.</div>;
  if (!week) return <p className="muted">Keine Woche gewählt.</p>;

  const days = daysOfWeek(week.start_date);
  const byDate = (d: string) => sessions.filter((s) => s.date === d).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const today = todayIso();

  async function save(s: PlannedSession) {
    if (s.id) await api.updateSession(s.id, s);
    else await api.addSession({ ...s, week_no: weekNo });
    setEditing(null);
    reload();
  }
  async function remove(id?: number) {
    if (id) { await api.deleteSession(id); reload(); }
  }

  const t = analyze?.totals;
  const target = week.target_km ?? 0;
  const volPct = target ? Math.round(((t?.km ?? 0) - target) / target * 100) : 0;

  return (
    <div>
      <div className="spread no-print">
        <h1>Wochenplanung</h1>
        <WeekSelector season={season} weekNo={weekNo} setWeekNo={setWeekNo} />
      </div>

      <div className="card tight">
        <div className="spread">
          <div className="row">
            <span className="pill phase">{week.phase || "—"}</span>
            <strong>Woche {week.week_no}</strong>
            <span className="muted">{fmtDate(week.start_date)}–{fmtDate(week.end_date)}</span>
            {week.goal_race && <span className="muted">· Ziel: {week.goal_race}</span>}
          </div>
          <div className="muted tiny">Phasenziel {target || "–"} km</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", alignItems: "start" }}>
        {/* Tage */}
        <div>
          {days.map((d, i) => {
            const list = byDate(d);
            return (
              <div key={d} className={"day" + (d === today ? " today" : "")}>
                <div className="day-head">
                  <span><span className="day-name">{DAY_NAMES[i]}</span> <span className="muted tiny">{fmtDate(d)}</span></span>
                  <button className="sm ghost" onClick={() => setEditing({ date: d, sport: "Run", type: "Easy" })}>+ Einheit</button>
                </div>
                {list.length === 0 && <div className="tiny muted" style={{ padding: "2px 4px" }}>—</div>}
                {list.map((s) => (
                  <div key={s.id} className="sess" onClick={() => setEditing(s)} style={{ cursor: "pointer" }}>
                    <span className="type-pill" style={{ background: typeColor(s.type) }}>{typeLabel(s.type)}</span>
                    <span style={{ flex: 1, minWidth: 120 }}>{s.description || sportLabel(s.sport)}</span>
                    <span className="tiny muted nowrap">
                      {s.sport !== "Run" && sportLabel(s.sport) + " · "}
                      {s.planned_km ? s.planned_km + " km" : s.planned_min ? s.planned_min + " min" : ""}
                      {s.planned_tss ? ` · ${Math.round(s.planned_tss)} TSS` : ""}
                    </span>
                    <button className="sm ghost danger" onClick={(e) => { e.stopPropagation(); remove(s.id); }}>✕</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* Analyse-Panel */}
        <div style={{ position: "sticky", top: 16 }}>
          <div className="card tight">
            <h3>Geplante Woche</h3>
            <div className="grid cols-3" style={{ gap: 8 }}>
              <Stat label="km (Lauf)" value={t ? t.km : 0} sub={target ? `Ziel ${target} · ${volPct > 0 ? "+" : ""}${volPct}%` : ""} color={Math.abs(volPct) > 10 ? "var(--warn)" : "var(--ok)"} />
              <Stat label="TSS" value={t ? Math.round(t.tss) : 0} />
              <Stat label="Einheiten" value={t ? t.sessions : 0} sub={`${t?.hardSessions ?? 0} hart`} />
            </div>
            <div className="row tiny muted" style={{ marginTop: 6 }}>
              <span>Rad {t?.bike_km ?? 0} km</span>·<span>längster Lauf {t?.longestKm ?? 0} km</span>
              {analyze?.projectedTsb != null && <>·<span>Form Ende: {analyze.projectedTsb}</span></>}
            </div>
          </div>

          {analyze && t && (
            <div className="card tight">
              <h3>Intensität & Zonen (geplant)</h3>
              <IntensityCard tss={analyze.tssIntensity ?? t.intensity} height={120} />
              <div className="tiny muted" style={{ marginTop: 8, marginBottom: 2 }}>km-Anteil je Zone</div>
              <ZoneDistribution zones={analyze.zones} rows={[{ name: "Geplant", values: analyze.plannedZoneKm ?? t.zoneMin }]} />
            </div>
          )}

          <div className="card tight">
            <h3>Check: passt die Woche?</h3>
            {!analyze?.flags.length && <p className="tiny muted">Keine Hinweise.</p>}
            {analyze?.flags.map((f, i) => (
              <div key={i} className={"flag " + f.level}><span className="dot" /><span>{f.message}</span></div>
            ))}
          </div>
        </div>
      </div>

      {editing && (
        <SessionModal session={editing} onClose={() => setEditing(null)} onSave={save} />
      )}
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 22, color }}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
