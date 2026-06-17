import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type PmcPoint, type AnalyzeResult, type IntervalEffortStat, type PlannedSession, type Activity, type Race, type FitnessTrend } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import { addDays, todayIso, fmtDate, weekLabel } from "../lib/util.ts";
import { raceMarkersByDate, raceMarkersByWeek, sickRangesByDate, sickWeekLabels, phaseRunsByDate, yearMarksByDate } from "../lib/markers.ts";
import Pmc from "../charts/Pmc.tsx";
import SeasonProgress, { buildSeasonRows, type SeasonRow } from "../charts/SeasonProgress.tsx";
import RangeSelector, { type DateRange } from "../charts/RangeSelector.tsx";
import IntervalTrend, { hasRunTrend } from "../charts/IntervalTrend.tsx";
import Vo2maxCard from "../charts/Vo2maxCard.tsx";
import IntensityRatio from "../charts/IntensityRatio.tsx";
import EditableGrid, { type EgBlock } from "../components/EditableGrid.tsx";
import T from "../components/T.tsx";
import { useT, renderFlag } from "../lib/i18n.tsx";

export default function Dashboard() {
  const { season, week } = useSeason();
  const navigate = useNavigate();
  const t = useT();
  const [range, setRange] = useState<DateRange | null>(null);
  const [pmc, setPmc] = useState<{ pmc: PmcPoint[]; ctlRamp7: number; ctlRamp28: number } | null>(null);
  const [rows, setRows] = useState<SeasonRow[]>([]);
  const [allSessions, setAllSessions] = useState<PlannedSession[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [allRaces, setAllRaces] = useState<Race[]>([]);
  const [analyze, setAnalyze] = useState<AnalyzeResult | null>(null);
  const [trend, setTrend] = useState<IntervalEffortStat[] | null>(null);
  const [fit, setFit] = useState<FitnessTrend | null>(null);

  const seasonRange: DateRange | null = season.length
    ? { from: season[0].start_date, to: maxDate(season[season.length - 1].end_date, addDays(todayIso(), 21)) }
    : null;

  // PMC + Intervall-Trend folgen dem gewählten Zeitraum.
  useEffect(() => {
    if (!range) return;
    api.pmc(range.from, range.to).then(setPmc).catch(() => setPmc(null));
    // Endpoint entsteht parallel — bei 404/Fehler Chart ausblenden.
    api.intervalsTrend({ from: range.from, to: range.to }).then(setTrend).catch(() => setTrend(null));
    api.fitnessTrend(range.from, range.to).then(setFit).catch(() => setFit(null));
  }, [range?.from, range?.to]);

  // Saison-Zeilen einmal über die ganze Saison bauen; Anzeige wird per Zeitraum gefiltert.
  useEffect(() => {
    if (!season.length) return;
    const from = season[0].start_date;
    const to = season[season.length - 1].end_date;
    Promise.all([api.sessions({}), api.activities({ from, to }), api.races()])
      .then(([sessions, a, rc]) => { setRows(buildSeasonRows(season, sessions, a)); setAllSessions(sessions); setActs(a); setAllRaces(rc); })
      .catch(() => setRows([]));
  }, [season]);

  // Marker für PMC + Saison-Progression (Races gold, Krank rot, Phasenband, Jahresmarke)
  const racesByDate = raceMarkersByDate(allSessions, allRaces);
  const sickByDate = sickRangesByDate(season);
  const racesByWeek = raceMarkersByWeek(season, allSessions, allRaces);
  const sickLabels = sickWeekLabels(season);
  const pmcDates = (pmc?.pmc ?? []).map((p) => p.date);
  const phaseRuns = phaseRunsByDate(pmcDates, season);
  const yearMarks = yearMarksByDate(pmcDates);
  const namesByDate: Record<string, string> = {};
  for (const a of acts) namesByDate[a.date] = namesByDate[a.date] ? `${namesByDate[a.date]}, ${a.name || a.sport}` : (a.name || a.sport);
  const pickDay = (date: string) => navigate("/track?date=" + date);

  useEffect(() => {
    if (week) api.analyzeWeek(week.week_no).then(setAnalyze).catch(() => setAnalyze(null));
  }, [week?.week_no]);

  const last = pmc?.pmc.filter((p) => p.date <= todayIso()).at(-1);
  const visibleRows = range
    ? rows.filter((r) => (!r.end || r.end >= range.from) && (!r.start || r.start <= range.to))
    : rows;
  const dashBlocks = blockCards();

  return (
    <div>
      <div className="spread">
        <h1>Dashboard</h1>
        <span className="muted tiny">{fmtDate(todayIso())} · {todayIso().slice(0, 4)}</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        <StatCard label={t("dashboard.stat.fitness.label", "Fitness (CTL)")} value={last?.ctl ?? 0} cls="fitness" sub={t("dashboard.stat.fitness.sub", "42-Tage-Last")} />
        <StatCard label={t("dashboard.stat.fatigue.label", "Fatigue (ATL)")} value={last?.atl ?? 0} cls="fatigue" sub={t("dashboard.stat.fatigue.sub", "7-Tage-Last")} />
        <StatCard label={t("dashboard.stat.form.label", "Form (TSB)")} value={last?.tsb ?? 0} cls="form" sub={formHint(last?.tsb, t)} />
        <StatCard label={t("dashboard.stat.ctlramp.label", "CTL-Ramp")} value={pmc?.ctlRamp7 ?? 0} sub={t("dashboard.stat.ctlramp.sub", "pro Woche (7d)")} />
        <Vo2maxCard data={fit} />
      </div>

      {/* Zeitraum gilt für die großen Übersichts-Charts (PMC, Saison-Progression, Intervall-Trend) */}
      <div className="row" style={{ justifyContent: "flex-end", margin: "14px 0 10px" }}>
        <span className="tiny muted"><T k="dashboard.range.label">Zeitraum</T></span>
        <RangeSelector seasonRange={seasonRange} onChange={setRange} defaultMode="ytd" />
      </div>

      <EditableGrid page="dashboard" blocks={dashBlocks} />
    </div>
  );

  function blockCards(): EgBlock[] {
    const list: EgBlock[] = [
      {
        id: "pmc", title: t("dashboard.block.pmc.title", "Performance Management Chart"), defaultSpan: 8, defaultHeight: 360,
        render: (h) => (
          <div className="card">
            <div className="spread">
              <h2><T k="dashboard.block.pmc.title">Performance Management Chart</T></h2>
              <span className="tiny muted"><T k="dashboard.block.pmc.sub">Fitness · Fatigue · Form</T></span>
            </div>
            <Pmc data={pmc?.pmc ?? []} races={racesByDate} sickRanges={sickByDate}
              phaseRuns={phaseRuns} yearMarks={yearMarks} namesByDate={namesByDate} onPick={pickDay} height={h ?? 360} />
          </div>
        ),
      },
      {
        id: "week", title: t("dashboard.block.week.title", "Aktuelle Woche"), defaultSpan: 4,
        render: () => (
          <div className="card">
            <div className="spread">
              <h2><T k="dashboard.block.week.title">Aktuelle Woche</T></h2>
              {week && <a className="tiny" href="/plan"><T k="dashboard.week.edit">bearbeiten →</T></a>}
            </div>
            {!week && <p className="muted"><T k="dashboard.week.empty">Keine aktuelle Woche.</T></p>}
            {week && analyze && (
              <>
                <div className="row mb">
                  <span className="pill phase">{week.phase}</span>
                  <span className="muted tiny">{weekLabel(week)} · {analyze.totals.km} / {week.target_km ?? "–"} km · {Math.round(analyze.totals.tss)} TSS</span>
                </div>
                {!analyze.flags.length && <p className="tiny muted"><T k="dashboard.week.noflags">Keine Hinweise.</T></p>}
                {analyze.flags.slice(0, 6).map((f, i) => (
                  <div key={i} className={"flag " + f.level}><span className="dot" /><span>{renderFlag(f, t)}</span></div>
                ))}
              </>
            )}
          </div>
        ),
      },
      {
        id: "season", title: t("dashboard.block.season.title", "Saison-Progression"), defaultSpan: 6, defaultHeight: 336,
        render: (h) => (
          <div className="card">
            <h2><T k="dashboard.block.season.title">Saison-Progression</T></h2>
            <SeasonProgress rows={visibleRows} highlightLabel={week ? weekLabel(week) : undefined} races={racesByWeek} sickLabels={sickLabels} height={h ?? 336} />
          </div>
        ),
      },
      {
        id: "intensity", title: t("dashboard.block.intensity.title", "Intensity-Trend"), defaultSpan: 6, defaultHeight: 240,
        render: (h) => (
          <div className="card">
            <div className="spread">
              <h2><T k="dashboard.block.intensity.title">Intensity-Trend</T></h2>
              <span className="tiny muted"><T k="dashboard.block.intensity.sub">ATL/CTL</T></span>
            </div>
            <IntensityRatio data={pmc?.pmc ?? []} height={h ?? 240} />
          </div>
        ),
      },
    ];
    if (hasRunTrend(trend)) {
      list.push({
        id: "intervall", title: t("dashboard.block.intervall.title", "Intervall-Trend"), defaultSpan: 12, defaultHeight: 260,
        render: (h) => (
          <div className="card">
            <div className="spread">
              <h2><T k="dashboard.block.intervall.title">Intervall-Trend</T></h2>
              <span className="tiny muted"><T k="dashboard.block.intervall.sub">Ø-Pace der Belastungen je Einheit — LT1 · LT2 · VO2 (schneller = oben)</T></span>
            </div>
            <IntervalTrend data={trend ?? []} height={h ?? 260} />
          </div>
        ),
      });
    }
    return list;
  }
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

function formHint(tsb: number | undefined, t: (k: string, fb?: string) => string): string {
  if (tsb == null) return "";
  if (tsb > 15) return t("dashboard.form.very_fresh", "sehr frisch / detrainiert?");
  if (tsb > 5) return t("dashboard.form.fresh", "frisch");
  if (tsb > -10) return t("dashboard.form.neutral", "neutral");
  if (tsb > -25) return t("dashboard.form.tired", "ermüdet (Aufbau)");
  return t("dashboard.form.very_tired", "stark ermüdet");
}

function maxDate(a: string, b: string) { return a > b ? a : b; }
