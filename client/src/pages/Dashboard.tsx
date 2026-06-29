import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type PmcPoint, type AnalyzeResult, type IntervalEffortStat, type PlannedSession, type Activity, type Race, type FitnessTrend, type TodayResult, type BestsResult } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import { addDays, todayIso, fmtDate, weekLabel, pbMarkers } from "../lib/util.ts";
import { typeColor, typeLabel } from "../lib/options.ts";
import { useCountUp, useReveal } from "../lib/motion.ts";
import FormRibbon from "../charts/FormRibbon.tsx";
import { raceMarkersByDate, raceMarkersByWeek, sickRangesByDate, sickWeekLabels, phaseRunsByDate, yearMarksByDate } from "../lib/markers.ts";
import Pmc from "../charts/Pmc.tsx";
import SeasonProgress, { buildSeasonRows, type SeasonRow } from "../charts/SeasonProgress.tsx";
import RangeSelector, { type DateRange } from "../charts/RangeSelector.tsx";
import IntervalTrend, { hasRunTrend } from "../charts/IntervalTrend.tsx";
import Vo2maxCard from "../charts/Vo2maxCard.tsx";
import IntensityRatio from "../charts/IntensityRatio.tsx";
import EditableGrid, { type EgBlock } from "../components/EditableGrid.tsx";
import StreakCard from "../components/StreakCard.tsx";
import Sparkline from "../components/Sparkline.tsx";
import { useSparkPref } from "../lib/sparkPref.ts";
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
  const [today, setToday] = useState<TodayResult | null>(null);
  const [bests, setBests] = useState<BestsResult | null>(null);
  useEffect(() => { api.today().then(setToday).catch(() => setToday(null)); }, []);
  useEffect(() => { api.bests().then(setBests).catch(() => setBests(null)); }, []);
  const formRef = useReveal<HTMLDivElement>(); // M3: Form-Karten gestaffelt einblenden
  const [adjBusy, setAdjBusy] = useState(false);
  const [adjMsg, setAdjMsg] = useState("");
  const applyAdjustment = async () => {
    const adj = today?.adjustment;
    if (!adj?.changed || !adj.adjusted) return;
    setAdjBusy(true);
    try {
      await api.applyAdjustment(adj.originalSessionId, adj.adjusted);
      setAdjMsg(t("dashboard.today.adjApplied", "übernommen ✓"));
      api.today().then(setToday).catch(() => {});
    } catch { setAdjMsg(t("dashboard.today.adjErr", "Fehler")); }
    finally { setAdjBusy(false); }
  };

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

  const pastPmc = (pmc?.pmc ?? []).filter((p) => p.date <= todayIso());
  const last = pastPmc.at(-1);
  const showSparks = useSparkPref(); // globaler Footer-Toggle (T15) steuert auch die Form-Überblick-Sparklines
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
      <p className="muted tiny" style={{ marginTop: -6, marginBottom: 10 }}>
        <T k="dashboard.role">Status heute — aktuelle Form, Readiness und Ziel-Abgleich. Lange Verläufe siehe Langzeit.</T>
      </p>

      {/* M4: Signature-Hero — Form-Trajektorie als fließendes Band. */}
      {(pmc?.pmc?.length ?? 0) > 1 && <FormRibbon points={pmc!.pmc.filter((p) => p.date <= todayIso())} />}

      {/* A3: Leitfrage „Was mache ich heute?" zuerst — fix & prominent. */}
      {todayPanel()}

      <div className="tiny muted" style={{ fontWeight: 600, margin: "2px 0 4px" }}><T k="dashboard.form.title">Form-Überblick</T></div>
      <div className="grid" ref={formRef} style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        <StatCard label={t("dashboard.stat.fitness.label", "Fitness (CTL)")} value={last?.ctl ?? 0} cls="fitness" sub={t("dashboard.stat.fitness.sub", "42-Tage-Last")} spark={showSparks ? pastPmc.map((p) => p.ctl) : undefined} sparkColor="var(--fitness)" />
        <StatCard label={t("dashboard.stat.fatigue.label", "Fatigue (ATL)")} value={last?.atl ?? 0} cls="fatigue" sub={t("dashboard.stat.fatigue.sub", "7-Tage-Last")} spark={showSparks ? pastPmc.map((p) => p.atl) : undefined} sparkColor="var(--fatigue)" />
        <StatCard label={t("dashboard.stat.form.label", "Form (TSB)")} value={last?.tsb ?? 0} cls="form" sub={formHint(last?.tsb, t)} spark={showSparks ? pastPmc.map((p) => p.tsb) : undefined} sparkColor="var(--form)" />
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

  // A3 (UI-Konzept): die heutige Entscheidung ist die Leitfrage des Dashboards → fix & prominent ganz oben
  // (statt als verschiebbare Kachel unter den Form-Stats). Inkl. Renn-Countdown.
  function todayPanel() {
    const nextRace = [...allRaces].filter((r) => r.date >= todayIso()).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    const raceDays = nextRace ? Math.round((Date.parse(nextRace.date + "T00:00:00Z") - Date.parse(todayIso() + "T00:00:00Z")) / 86400000) : null;
    const plannedToday = allSessions.filter((s) => s.date === todayIso() && s.type !== "Rest").sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return (
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="spread">
              <h2><T k="dashboard.block.today.title">Heute — Empfehlung</T></h2>
              <span className="row" style={{ gap: 10, width: "auto" }}>
                {nextRace && raceDays != null && (
                  <span className="pill" title={`${nextRace.name || "Rennen"} · ${nextRace.date}`}
                    style={{ background: nextRace.is_tuneup ? "var(--info)" : "var(--accent)", color: "#fff" }}>
                    🏁 {nextRace.is_tuneup ? "Test" : "Rennen"} {raceDays === 0 ? "heute" : `in ${raceDays} ${raceDays === 1 ? "Tag" : "Tagen"}`}
                  </span>
                )}
                <span className="tiny muted"><T k="dashboard.block.today.sub">regelbasiert · Vorschlag</T></span>
              </span>
            </div>

            {/* Konkret heute geplant (aus der Wochenplanung), nicht nur die Empfehlung. */}
            <div style={{ margin: "2px 0 10px" }}>
              <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 3 }}><T k="dashboard.today.planned">Heute geplant</T></div>
              {plannedToday.length === 0 ? (
                <div className="tiny muted"><T k="dashboard.today.rest">Keine Einheit geplant — Ruhetag/frei.</T></div>
              ) : plannedToday.map((s, i) => (
                <div key={s.id ?? i} className="row" style={{ gap: 8, alignItems: "center", fontSize: 13, marginBottom: 2 }}>
                  <span className="type-pill" style={{ background: typeColor(s.type), fontSize: 10, padding: "1px 7px" }}>{typeLabel(s.type)}</span>
                  <span style={{ flex: 1 }}>{s.description || typeLabel(s.type)}</span>
                  <span className="tiny muted nowrap">{s.planned_min ? `${s.planned_min} min` : ""}{s.planned_tss ? ` · ${Math.round(s.planned_tss)} TSS` : ""}</span>
                </div>
              ))}
            </div>

            {!today && <p className="muted tiny">…</p>}
            {today && (
              <div>
                <div className="row" style={{ gap: 14, alignItems: "center", marginBottom: 4 }}>
                  {today.readiness && (
                    <span className="row" style={{ gap: 6, width: "auto" }}>
                      <span className="dot" style={{ background: readinessColor(today.readiness.level), width: 12, height: 12 }} />
                      <strong><T k="dashboard.today.readiness">Readiness</T> {today.readiness.score}</strong>
                    </span>
                  )}
                  <strong style={{ fontSize: 16 }}>{today.recommendation.headline}</strong>
                </div>
                <div className="tiny muted">
                  {today.recommendation.doseHint}
                  {today.recommendation.confidence ? ` · ${t("dashboard.today.confidence", "Konfidenz")} ${today.recommendation.confidence}` : ""}
                </div>
                <details style={{ marginTop: 6 }}>
                  <summary className="tiny" style={{ cursor: "pointer" }}><T k="dashboard.today.why">Begründung</T></summary>
                  <ul className="tiny muted" style={{ margin: "4px 0 0 18px" }}>
                    {today.readiness?.drivers.map((d, i) => <li key={"r" + i}>{d.text}</li>)}
                    {today.recommendation.reasons.map((r, i) => <li key={"x" + i}>{r.text}</li>)}
                  </ul>
                </details>
                {today.adjustment?.changed && today.adjustment.adjusted && (
                  <div className="card" style={{ marginTop: 10, padding: "8px 10px", background: "var(--surface2)", border: "1px solid var(--line)" }}>
                    <div className="row" style={{ gap: 8, alignItems: "center" }}>
                      <span className="dot" style={{ background: today.adjustment.mode === "gate" ? "#f97316" : "#0ea5e9", width: 10, height: 10 }} />
                      <strong style={{ fontSize: 13 }}>{today.adjustment.headline}</strong>
                    </div>
                    <div className="tiny muted" style={{ marginTop: 3 }}>
                      {today.adjustment.original.type} {today.adjustment.original.planned_tss} TSS → <strong>{today.adjustment.adjusted.type} {today.adjustment.adjusted.planned_tss} TSS</strong>
                      {today.adjustment.adjusted.description ? ` · ${today.adjustment.adjusted.description}` : ""}
                    </div>
                    <details style={{ marginTop: 4 }}>
                      <summary className="tiny" style={{ cursor: "pointer" }}><T k="dashboard.today.adjWhy">Warum</T></summary>
                      <ul className="tiny muted" style={{ margin: "4px 0 0 18px" }}>
                        {today.adjustment.reasons.map((r, i) => <li key={"a" + i}>{r.text}</li>)}
                      </ul>
                    </details>
                    <div className="row" style={{ marginTop: 6, gap: 8, alignItems: "center" }}>
                      <button className="sm primary" disabled={adjBusy} onClick={applyAdjustment}>
                        <T k="dashboard.today.applyAdj">Anpassung übernehmen</T>
                      </button>
                      <span className="tiny muted">{today.adjustment.mode === "gate" ? t("dashboard.today.gate", "Gate aktiv") : t("dashboard.today.advisory", "beratend")}{adjMsg ? ` · ${adjMsg}` : ""}</span>
                    </div>
                  </div>
                )}
                <div className="row" style={{ marginTop: 8 }}>
                  <a className="sm ghost" href="/plan"><T k="dashboard.today.toPlan">In Wochenplanung öffnen →</T></a>
                </div>
              </div>
            )}
          </div>
    );
  }

  function blockCards(): EgBlock[] {
    const list: EgBlock[] = [
      {
        id: "pmc", title: t("dashboard.block.pmc.title", "Performance Management Chart"), defaultSpan: 8, defaultHeight: 360,
        render: (h) => (
          <div className="card" data-tour="pmc">
            <div className="spread">
              <h2><T k="dashboard.block.pmc.title">Performance Management Chart</T></h2>
              <span className="tiny muted"><T k="dashboard.block.pmc.sub">Fitness · Fatigue · Form</T></span>
            </div>
            <Pmc data={pmc?.pmc ?? []} races={racesByDate} pbs={pbMarkers(bests?.pbs)} sickRanges={sickByDate} seasonal
              phaseRuns={phaseRuns} yearMarks={yearMarks} namesByDate={namesByDate} onPick={pickDay} height={h ?? 360} />
          </div>
        ),
      },
      {
        id: "streak", title: t("dashboard.block.streak.title", "Serie"), defaultSpan: 4, defaultHeight: 300,
        render: (h) => <StreakCard acts={acts} sessions={allSessions} height={h} />,
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
        id: "intensity", title: t("dashboard.block.intensity.title", "Last-Trend (ATL/CTL)"), defaultSpan: 6, defaultHeight: 240,
        render: (h) => (
          <div className="card">
            <div className="spread">
              <h2><T k="dashboard.block.intensity.title">Last-Trend (ATL/CTL)</T></h2>
              <span className="tiny muted"><T k="dashboard.block.intensity.sub">akute vs. chronische Last — nicht die Zonen-Intensität</T></span>
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

function StatCard({ label, value, cls, sub, spark, sparkColor }: {
  label: string; value: number; cls?: string; sub?: string;
  spark?: (number | null)[]; sparkColor?: string; // optionaler Mini-Verlauf (CTL/ATL/TSB)
}) {
  const display = useCountUp(value); // M3: sanftes Hochzählen beim Laden/Wertwechsel
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={"value " + (cls || "")}>{display}</div>
      {sub && <div className="sub">{sub}</div>}
      {spark && spark.filter((v) => v != null).length >= 2 && (
        <div style={{ marginTop: 6 }}><Sparkline data={spark} color={sparkColor} width={120} height={32} /></div>
      )}
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

function readinessColor(level: "green" | "yellow" | "red"): string {
  return level === "green" ? "var(--ok)" : level === "yellow" ? "var(--warn)" : "var(--danger)";
}

function maxDate(a: string, b: string) { return a > b ? a : b; }
