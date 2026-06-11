import { useEffect, useState } from "react";
import { api, type PmcPoint, type Activity, type PlannedSession, type SeasonWeek, type AnalyzeResult } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import { addDays, todayIso, fmtDate } from "../lib/util.ts";
import Pmc from "../charts/Pmc.tsx";
import SeasonProgress, { type SeasonRow } from "../charts/SeasonProgress.tsx";

export default function Dashboard() {
  const { season, week } = useSeason();
  const [pmc, setPmc] = useState<{ pmc: PmcPoint[]; ctlRamp7: number; ctlRamp28: number } | null>(null);
  const [rows, setRows] = useState<SeasonRow[]>([]);
  const [analyze, setAnalyze] = useState<AnalyzeResult | null>(null);

  useEffect(() => {
    const from = season.length ? season[0].start_date : addDays(todayIso(), -42);
    const to = season.length ? maxDate(season[season.length - 1].end_date, addDays(todayIso(), 21)) : addDays(todayIso(), 21);
    api.pmc(from, to).then(setPmc);
    Promise.all([api.sessions({}), api.activities({ from, to })]).then(([sessions, acts]) => {
      setRows(buildSeasonRows(season, sessions, acts));
    });
  }, [season]);

  useEffect(() => {
    if (week) api.analyzeWeek(week.week_no).then(setAnalyze);
  }, [week?.week_no]);

  const last = pmc?.pmc.filter((p) => p.date <= todayIso()).at(-1);

  return (
    <div>
      <div className="spread">
        <h1>Dashboard</h1>
        <span className="muted tiny">{fmtDate(todayIso())} · {todayIso().slice(0, 4)}</span>
      </div>

      <div className="grid cols-4">
        <StatCard label="Fitness (CTL)" value={last?.ctl ?? 0} cls="fitness" sub="42-Tage-Last" />
        <StatCard label="Fatigue (ATL)" value={last?.atl ?? 0} cls="fatigue" sub="7-Tage-Last" />
        <StatCard label="Form (TSB)" value={last?.tsb ?? 0} cls="form" sub={formHint(last?.tsb)} />
        <StatCard label="CTL-Ramp" value={pmc?.ctlRamp7 ?? 0} sub="pro Woche (7d)" />
      </div>

      <div className="card">
        <div className="spread"><h2>Performance Management Chart</h2><span className="tiny muted">Fitness · Fatigue · Form (geplant rechts von „heute")</span></div>
        <Pmc data={pmc?.pmc ?? []} />
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <div className="card">
          <h2>Saison-Progression</h2>
          <SeasonProgress rows={rows} />
        </div>
        <div className="card">
          <div className="spread"><h2>Aktuelle Woche</h2>{week && <a className="tiny" href="/plan">bearbeiten →</a>}</div>
          {!week && <p className="muted">Keine aktuelle Woche.</p>}
          {week && analyze && (
            <>
              <div className="row mb">
                <span className="pill phase">{week.phase}</span>
                <span className="muted tiny">Woche {week.week_no} · {analyze.totals.km} / {week.target_km ?? "–"} km · {Math.round(analyze.totals.tss)} TSS</span>
              </div>
              {!analyze.flags.length && <p className="tiny muted">Keine Hinweise.</p>}
              {analyze.flags.slice(0, 6).map((f, i) => (
                <div key={i} className={"flag " + f.level}><span className="dot" /><span>{f.message}</span></div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, cls, sub }: { label: string; value: number; cls?: string; sub?: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={"value " + (cls || "")}>{Math.round(value * 10) / 10}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function formHint(tsb?: number): string {
  if (tsb == null) return "";
  if (tsb > 15) return "sehr frisch / detrainiert?";
  if (tsb > 5) return "frisch";
  if (tsb > -10) return "neutral";
  if (tsb > -25) return "ermüdet (Aufbau)";
  return "stark ermüdet";
}

function maxDate(a: string, b: string) { return a > b ? a : b; }

function weekOf(season: SeasonWeek[], date: string): number | null {
  const w = season.find((x) => x.start_date <= date && date <= x.end_date);
  return w ? w.week_no : null;
}

function buildSeasonRows(season: SeasonWeek[], sessions: PlannedSession[], acts: Activity[]): SeasonRow[] {
  const plannedByWeek = new Map<number, number>();
  for (const s of sessions) {
    if (s.sport !== "Run" || s.week_no == null) continue;
    plannedByWeek.set(s.week_no, (plannedByWeek.get(s.week_no) || 0) + (s.planned_km || 0));
  }
  const actualByWeek = new Map<number, number>();
  for (const a of acts) {
    if (a.sport !== "Run") continue;
    const wk = weekOf(season, a.date);
    if (wk == null) continue;
    actualByWeek.set(wk, (actualByWeek.get(wk) || 0) + (a.distance_m || 0) / 1000);
  }
  return season.map((w) => ({
    label: `W${w.week_no}`,
    phase: w.phase,
    target: w.target_km,
    planned: Math.round((plannedByWeek.get(w.week_no) || 0) * 10) / 10,
    actual: Math.round((actualByWeek.get(w.week_no) || 0) * 10) / 10,
  }));
}
