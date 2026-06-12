import { useEffect, useState } from "react";
import { api, type PmcPoint, type AnalyzeResult, type IntervalEffortStat } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import { addDays, todayIso, fmtDate, weekLabel } from "../lib/util.ts";
import Pmc from "../charts/Pmc.tsx";
import SeasonProgress, { buildSeasonRows, type SeasonRow } from "../charts/SeasonProgress.tsx";
import RangeSelector, { type DateRange } from "../charts/RangeSelector.tsx";
import IntervalTrend, { hasRunTrend } from "../charts/IntervalTrend.tsx";

export default function Dashboard() {
  const { season, week } = useSeason();
  const [range, setRange] = useState<DateRange | null>(null);
  const [pmc, setPmc] = useState<{ pmc: PmcPoint[]; ctlRamp7: number; ctlRamp28: number } | null>(null);
  const [rows, setRows] = useState<SeasonRow[]>([]);
  const [analyze, setAnalyze] = useState<AnalyzeResult | null>(null);
  const [trend, setTrend] = useState<IntervalEffortStat[] | null>(null);

  const seasonRange: DateRange | null = season.length
    ? { from: season[0].start_date, to: maxDate(season[season.length - 1].end_date, addDays(todayIso(), 21)) }
    : null;

  // PMC + Intervall-Trend folgen dem gewählten Zeitraum.
  useEffect(() => {
    if (!range) return;
    api.pmc(range.from, range.to).then(setPmc).catch(() => setPmc(null));
    // Endpoint entsteht parallel — bei 404/Fehler Chart ausblenden.
    api.intervalsTrend({ from: range.from, to: range.to }).then(setTrend).catch(() => setTrend(null));
  }, [range?.from, range?.to]);

  // Saison-Zeilen einmal über die ganze Saison bauen; Anzeige wird per Zeitraum gefiltert.
  useEffect(() => {
    if (!season.length) return;
    const from = season[0].start_date;
    const to = season[season.length - 1].end_date;
    Promise.all([api.sessions({}), api.activities({ from, to })])
      .then(([sessions, acts]) => setRows(buildSeasonRows(season, sessions, acts)))
      .catch(() => setRows([]));
  }, [season]);

  useEffect(() => {
    if (week) api.analyzeWeek(week.week_no).then(setAnalyze).catch(() => setAnalyze(null));
  }, [week?.week_no]);

  const last = pmc?.pmc.filter((p) => p.date <= todayIso()).at(-1);
  const visibleRows = range
    ? rows.filter((r) => (!r.end || r.end >= range.from) && (!r.start || r.start <= range.to))
    : rows;

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

      {/* Zeitraum gilt für die großen Übersichts-Charts (PMC, Saison-Progression, Intervall-Trend) */}
      <div className="row" style={{ justifyContent: "flex-end", margin: "14px 0 10px" }}>
        <span className="tiny muted">Zeitraum</span>
        <RangeSelector seasonRange={seasonRange} onChange={setRange} defaultMode="3w" />
      </div>

      <div className="card">
        <div className="spread"><h2>Performance Management Chart</h2><span className="tiny muted">Fitness · Fatigue · Form (geplant rechts von „heute")</span></div>
        <Pmc data={pmc?.pmc ?? []} />
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <div className="card">
          <h2>Saison-Progression</h2>
          <SeasonProgress rows={visibleRows} highlightLabel={week ? weekLabel(week) : undefined} />
        </div>
        <div className="card">
          <div className="spread"><h2>Aktuelle Woche</h2>{week && <a className="tiny" href="/plan">bearbeiten →</a>}</div>
          {!week && <p className="muted">Keine aktuelle Woche.</p>}
          {week && analyze && (
            <>
              <div className="row mb">
                <span className="pill phase">{week.phase}</span>
                <span className="muted tiny">{weekLabel(week)} · {analyze.totals.km} / {week.target_km ?? "–"} km · {Math.round(analyze.totals.tss)} TSS</span>
              </div>
              {!analyze.flags.length && <p className="tiny muted">Keine Hinweise.</p>}
              {analyze.flags.slice(0, 6).map((f, i) => (
                <div key={i} className={"flag " + f.level}><span className="dot" /><span>{f.message}</span></div>
              ))}
            </>
          )}
        </div>
      </div>

      {hasRunTrend(trend) && (
        <div className="card">
          <div className="spread">
            <h2>Intervall-Trend</h2>
            <span className="tiny muted">Ø-Pace der Belastungen je Einheit — LT1 · LT2 · VO2 (schneller = oben)</span>
          </div>
          <IntervalTrend data={trend ?? []} />
        </div>
      )}
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
