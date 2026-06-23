// Langzeit-Übersicht (#79): Entwicklung über Monate statt einer Woche.
// Oben groß PMC + Saison-Progression (geplant vs. gelaufen), beide am Seiten-Zeitraum,
// dann: (a) Wellness-Verläufe als kleine Multiples (HRV, Ruhepuls, Recovery, Strain, Schlaf,
//     Bettzeit als Uhrzeit, Sleep-Performance, Gewicht),
// (b) Zonen-Effizienz: Ø-Pace vs. Ø-HF der Easy-Läufe (Wochenmittel) + Effizienz-Faktor,
// (c) Intervall-Trend nach Kategorie (LT1 / LT2 / VO2) — Chart wiederverwendet.
// Zeitraum über RangeSelector (Default 6 Monate); „Drucken/PDF" druckt den eingestellten Zeitraum.
import { useEffect, useState, Fragment } from "react";
import {
  ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Customized,
} from "recharts";
import { api, type DailyLog, type Activity, type IntervalEffortStat, type PmcPoint, type PlannedSession, type Race, type PlanAdherenceWeek, type DecouplingPoint, type ZoneHistogramData, type FitnessTrend } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import { useOptions, phaseLabel } from "../lib/options.ts";
import { useNavigate } from "react-router-dom";
import { raceMarkersByDate, raceMarkersByWeek, sickRangesByDate, sickWeekLabels, phaseRunsByDate, yearMarksByDate, yearMarksByDateAll } from "../lib/markers.ts";
import { fmtDate, fmtDateY, paceStr, addDays, todayIso, weekLabel, isoWeek, fmtDur } from "../lib/util.ts";
import RangeSelector, { type DateRange } from "../charts/RangeSelector.tsx";
import ZoneHistogram from "../charts/ZoneHistogram.tsx";
import IntervalTrend, { hasRunTrend } from "../charts/IntervalTrend.tsx";
import { bedDeviation, devToClock } from "../charts/WellnessTrends.tsx";
import Pmc from "../charts/Pmc.tsx";
import IntensityRatio from "../charts/IntensityRatio.tsx";
import SleepWindow from "../charts/SleepWindow.tsx";
import ChartDecor from "../charts/ChartDecor.tsx";
import SeasonProgress, { buildSeasonRows, type SeasonRow } from "../charts/SeasonProgress.tsx";
import EditableGrid, { EgItem } from "../components/EditableGrid.tsx";
import T from "../components/T.tsx";
import { useT } from "../lib/i18n.tsx";

// ---- Wellness-Metriken (kleine Multiples) ----
type Fmt = (v: number) => string;
const METRICS: { key: string; title: string; color: string; fmt?: Fmt; refY?: number; refLabel?: string; reversed?: boolean }[] = [
  { key: "hrv", title: "HRV (ms)", color: "#2b6cb0" },
  { key: "resting_hr", title: "Ruhepuls (bpm)", color: "#d53f8c" },
  { key: "recovery", title: "Recovery (%)", color: "#16a34a" },
  { key: "strain", title: "Strain", color: "#f97316" },
  { key: "sleep_h", title: "Schlaf (h)", color: "#6366f1", fmt: (v) => v.toFixed(1) },
  { key: "bed_dev", title: "Schlaffenster (Bett → Auf)", color: "#0891b2", fmt: devToClock, refY: 0, refLabel: "23:30", reversed: true },
  { key: "sleep_performance", title: "Sleep-Performance (%)", color: "#8b5cf6" },
  { key: "weight", title: "Gewicht (kg)", color: "#64748b", fmt: (v) => v.toFixed(1) },
];

interface WPoint { date: string; [k: string]: number | string | null; }

function wellnessPoints(daily: DailyLog[]): WPoint[] {
  return [...daily]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((dl) => {
      const p: WPoint = { date: dl.date };
      for (const m of METRICS) {
        if (m.key === "bed_dev") { p.bed_dev = bedDeviation(dl.bedtime); continue; }
        const v = dl[m.key];
        p[m.key] = typeof v === "number" && isFinite(v) ? v : null;
      }
      return p;
    });
}

// ---- Zonen-Effizienz: Easy-Läufe (ohne strukturierte Belastungen) wochenweise mitteln ----
function mondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

interface EffRow { date: string; pace: number | null; hr: number | null; ef: number | null; }

function easyRunWeeks(acts: Activity[]): EffRow[] {
  const wk = new Map<string, { km: number; sec: number; hrSec: number; hrWeight: number }>();
  for (const a of acts) {
    if (a.sport !== "Run" || !a.distance_m || !a.moving_s) continue;
    if (a.efforts && a.efforts.length) continue; // Intervall-/Schwellen-Einheiten raus → Easy-Proxy
    const key = mondayOf(a.date);
    const e = wk.get(key) || { km: 0, sec: 0, hrSec: 0, hrWeight: 0 };
    e.km += a.distance_m / 1000;
    e.sec += a.moving_s;
    if (a.avg_hr) { e.hrSec += a.avg_hr * a.moving_s; e.hrWeight += a.moving_s; }
    wk.set(key, e);
  }
  return [...wk.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, e]) => {
      const pace = e.km > 0 ? e.sec / e.km : null; // s/km, km-gewichtet
      const hr = e.hrWeight > 0 ? e.hrSec / e.hrWeight : null; // zeitgewichtet
      // Effizienz-Faktor: Meter pro Minute je Herzschlag — höher = ökonomischer.
      const ef = pace && hr ? (1000 / (pace / 60)) / hr : null;
      return { date, pace, hr, ef: ef ? Math.round(ef * 100) / 100 : null };
    });
}

export default function LongTerm() {
  const { season, week } = useSeason();
  const { checks } = useOptions(); // Wochen-Check-Definitionen (ToDo 7, v0.11.0)
  const t = useT();
  const [weeklogs, setWeeklogs] = useState<{ week_no: number; checks: Record<string, boolean> }[]>([]);
  const [range, setRange] = useState<DateRange | null>(null);
  const [daily, setDaily] = useState<DailyLog[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [trend, setTrend] = useState<IntervalEffortStat[] | null>(null);
  const [pmc, setPmc] = useState<PmcPoint[]>([]);
  const [rows, setRows] = useState<SeasonRow[]>([]);
  const [allSessions, setAllSessions] = useState<PlannedSession[]>([]);
  const [allRaces, setAllRaces] = useState<Race[]>([]);
  const [adherence, setAdherence] = useState<PlanAdherenceWeek[]>([]); // Plan-Erfüllung je Woche (v0.14.0)
  const [decoupling, setDecoupling] = useState<DecouplingPoint[]>([]); // C1 v1.4.0
  const [zoneHist, setZoneHist] = useState<ZoneHistogramData | null>(null); // C3 v1.4.0
  const [fitnessTrend, setFitnessTrend] = useState<FitnessTrend | null>(null); // C4 v1.4.0
  // Effizienz-Legende: Ø-Pace / Ø-HF einzeln ein-/ausblenden (wie PMC, ToDo v0.11.0).
  const [effHidden, setEffHidden] = useState<{ pace: boolean; hr: boolean }>({ pace: false, hr: false });

  const seasonRange: DateRange | null = season.length
    ? { from: season[0].start_date, to: maxDate(season[season.length - 1].end_date, todayIso()) }
    : null;

  useEffect(() => {
    if (!range) return;
    api.daily({ from: range.from, to: range.to }).then(setDaily).catch(() => setDaily([]));
    api.activities({ from: range.from, to: range.to }).then(setActs).catch(() => setActs([]));
    api.intervalsTrend({ from: range.from, to: range.to }).then(setTrend).catch(() => setTrend(null));
    api.pmc(range.from, range.to).then((r) => setPmc(r.pmc)).catch(() => setPmc([]));
    api.decouplingTrend({ from: range.from, to: range.to }).then(setDecoupling).catch(() => setDecoupling([]));
    api.zoneHistogram({ from: range.from, to: range.to }).then(setZoneHist).catch(() => setZoneHist(null));
    api.fitnessTrend(range.from, range.to).then(setFitnessTrend).catch(() => setFitnessTrend(null));
  }, [range?.from, range?.to]);

  // Saison-Zeilen einmal über die ganze Saison bauen (wie Dashboard); Anzeige per Zeitraum gefiltert.
  useEffect(() => {
    if (!season.length) return;
    const from = season[0].start_date;
    const to = season[season.length - 1].end_date;
    Promise.all([api.sessions({}), api.activities({ from, to }), api.races()])
      .then(([sessions, all, rc]) => { setRows(buildSeasonRows(season, sessions, all)); setAllSessions(sessions); setAllRaces(rc); })
      .catch(() => setRows([]));
  }, [season]);

  // Wochen-Checks (manuell abgehakt) für die Heatmap (ToDo 7) — unabhängig vom Zeitraum, einmal laden.
  useEffect(() => { api.weeklogs().then(setWeeklogs).catch(() => setWeeklogs([])); }, []);
  // Plan-Erfüllung je Woche — einmal laden, Anzeige per Zeitraum gefiltert (v0.14.0, ToDo 12).
  useEffect(() => { api.planAdherence().then(setAdherence).catch(() => setAdherence([])); }, []);

  const navigate = useNavigate();
  const racesByDate = raceMarkersByDate(allSessions, allRaces);
  const sickByDate = sickRangesByDate(season);
  const racesByWeek = raceMarkersByWeek(season, allSessions, allRaces);
  const sickLabels = sickWeekLabels(season);
  const pmcDates = pmc.map((p) => p.date);
  const phaseRuns = phaseRunsByDate(pmcDates, season);
  const yearMarks = yearMarksByDate(pmcDates);
  const namesByDate: Record<string, string> = {};
  for (const a of acts) namesByDate[a.date] = namesByDate[a.date] ? `${namesByDate[a.date]}, ${a.name || a.sport}` : (a.name || a.sport);

  // Kacheln: Summen je Kategorie im gewählten Zeitraum (#17)
  const cat = { run: { km: 0, s: 0 }, bike: { km: 0, s: 0 }, str: { s: 0 } };
  for (const a of acts) {
    const km = (a.distance_m || 0) / 1000, s = a.moving_s || 0;
    if (a.sport === "Run") { cat.run.km += km; cat.run.s += s; }
    else if (a.sport?.startsWith("Bike") || a.sport === "General") { cat.bike.km += km; cat.bike.s += s; }
    else if (a.sport === "Strength" || a.sport === "Physio") { cat.str.s += s; }
  }

  const visibleRows = range
    ? rows.filter((r) => (!r.end || r.end >= range.from) && (!r.start || r.start <= range.to))
    : rows;
  const points = wellnessPoints(daily);
  // Schlaffenster-Daten (Bettzeit→Aufwachzeit je Tag) für den Whoop-Stil-Balken (v0.15.5).
  const sleepRows = [...daily].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ x: d.date, bedtime: d.bedtime, wake_time: d.wake_time }));
  const visibleMetrics = METRICS.filter((m) => points.some((p) => p[m.key] != null));
  // Krank-Wochen rot hinterlegen (ToDo Z.21): je Range auf die VORHANDENEN Punkt-Tage mappen
  // (die Wellness-X-Achse enthält nur Tage mit Daten → exakte Range-Grenzen existieren evtl. nicht).
  const pointDates = points.map((p) => p.date);
  const sickSegments = sickByDate
    .map((s) => {
      const inRange = pointDates.filter((d) => d >= s.from && d <= s.to);
      return inRange.length ? { x1: inRange[0], x2: inRange[inRange.length - 1] } : null;
    })
    .filter((x): x is { x1: string; x2: string } => x != null);
  // 8-Wochen-Referenz: Mittelwert + ±1σ aus den letzten 56 Tagen je Wellness-Metrik.
  const refCutoff = addDays(todayIso(), -56);
  const wellnessRef = new Map<string, { mean: number; lo: number; hi: number }>();
  for (const m of METRICS) {
    const vals = points
      .filter((p) => p.date >= refCutoff && p[m.key] != null)
      .map((p) => p[m.key] as number);
    if (vals.length >= 4) {
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
      wellnessRef.set(m.key, { mean, lo: mean - std, hi: mean + std });
    }
  }

  const eff = easyRunWeeks(acts);
  // Krank-Wochen ohne Easy-Lauf haben keinen Punkt → die Wochen-Montage als leere Punkte ergänzen, damit die
  // Krank-Schraffur überhaupt eine X-Kategorie zum Ankern hat (Bugfix Z.7).
  const effDateSet = new Set(eff.map((e) => e.date));
  for (const s of sickByDate) {
    for (let d = mondayOf(s.from); d <= s.to; d = addDays(d, 7)) {
      const inView = !range || (d >= mondayOf(range.from) && d <= range.to);
      if (inView && !effDateSet.has(d)) { effDateSet.add(d); eff.push({ date: d, pace: null, hr: null, ef: null }); }
    }
  }
  eff.sort((a, b) => a.date.localeCompare(b.date));
  // Krank-Hinterlegung für die Zonen-Effizienz-Charts: Range auf die (nun vollständigen) Wochen-Punkte mappen.
  const effDates = eff.map((e) => e.date);
  const effSickSegments = sickByDate
    .map((s) => {
      const inRange = effDates.filter((d) => d >= s.from && d <= s.to);
      return inRange.length ? { x1: inRange[0], x2: inRange[inRange.length - 1] } : null;
    })
    .filter((x): x is { x1: string; x2: string } => x != null);
  const effPaces = eff.map((e) => e.pace).filter((x): x is number => x != null);
  const paceDomain: [number, number] = effPaces.length
    ? [Math.floor((Math.min(...effPaces) - 15) / 15) * 15, Math.ceil((Math.max(...effPaces) + 15) / 15) * 15]
    : [240, 480];

  // Chart-Dekoration (Phasenband + Jahres-Dreieck) für Wellness- (Tages-) und Effizienz- (Wochen-) Charts.
  // Eigene Marken je Datensatz, da die X-Achsen unterschiedliche Datums-Mengen haben (ToDo 1, v0.11.0).
  // v0.12.0: `…All` markiert jedes vorhandene Jahr (auch ohne Jahres-Wechsel sichtbar, ToDo 4).
  const wellnessYears = yearMarksByDateAll(pointDates);
  const wellnessPhaseRuns = phaseRunsByDate(pointDates, season);
  const effYears = yearMarksByDateAll(effDates);
  const effPhaseRuns = phaseRunsByDate(effDates, season);
  // Plan-Erfüllung (Wochenmittel) im Zeitraum (v0.14.0, ToDo 12).
  const adhData = adherence
    .filter((w) => !range || (w.end >= range.from && w.start <= range.to))
    .map((w) => ({ date: w.start, pct: w.pct }));
  const hasAdh = adhData.some((d) => d.pct != null);
  const adhDates = adhData.map((d) => d.date);
  const adhPhaseRuns = phaseRunsByDate(adhDates, season);
  const adhYears = yearMarksByDateAll(adhDates);
  // Trainingsphase zu einem Datum (für die Chart-Tooltips, ToDo 4).
  const phaseAtDate = (d: string): string => {
    const w = season.find((x) => x.start_date <= d && d <= x.end_date);
    return w ? phaseLabel(w.phase) : "";
  };

  // Wochen-Check-Heatmap (ToDo 7): Spalten = Wochen im Zeitraum, Zeilen = Checks.
  const checkByWeek = new Map(weeklogs.map((w) => [w.week_no, w.checks || {}]));
  const heatWeeks = [...season]
    .filter((w) => !range || (w.end_date >= range.from && w.start_date <= range.to))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  // Plan-Erfüllung je Woche (TSS-basiert, aus /api/plan-adherence).
  const adhByWeek = new Map(adherence.map((w) => [w.week_no, w.pct]));
  const adhCellColor = (pct: number | null): string | undefined => {
    if (pct == null) return undefined;
    if (pct >= 110) return "#d4af37";
    if (pct >= 90) return "#22c55e";
    if (pct >= 75) return "#eab308";
    if (pct >= 50) return "#f97316";
    return "#ef4444";
  };
  // Wochen-Score (v0.12.0, ToDo 7): % erfüllter Checks → Farbskala gold/grün/gelb/orange/rot.
  const weekScore = (weekNo: number): number | null => {
    if (!checks.length || !checkByWeek.has(weekNo)) return null;
    const wc = checkByWeek.get(weekNo) || {};
    return Math.round((checks.filter((c) => wc[c.value]).length / checks.length) * 100);
  };
  const scoreColor = (p: number): string =>
    p >= 100 ? "#d4af37" : p >= 90 ? "#22c55e" : p >= 75 ? "#eab308" : p >= 50 ? "#f97316" : "#ef4444";

  return (
    <div>
      <div className="spread no-print">
        <div>
          <h1 className="lt-title" style={{ marginBottom: 2 }}><T k="lt.title">Langzeit-Übersicht</T></h1>
          {range && <span className="tiny muted">Zeitraum: {fmtDateY(range.from)} – {fmtDateY(range.to)}</span>}
        </div>
        <div className="row" style={{ width: "auto", gap: 8 }}>
          <RangeSelector seasonRange={seasonRange} onChange={setRange} defaultMode="6m" />
          <button onClick={() => window.print()}><T k="lt.btn.print">🖨 Drucken / PDF</T></button>
        </div>
      </div>

      <EditableGrid page="longterm" paged>
      {/* Summen-Kacheln (#17) — als Tiles auf den Seiten */}
      <EgItem id="sum-run" title={t("lt.tile.run", "Lauf")} defaultSpan={4} defaultHeight={60}>{() => (
        <div className="card stat"><div className="label"><T k="lt.tile.run">Lauf</T></div><div className="value fitness">{Math.round(cat.run.km)} km</div><div className="sub">{fmtDur(cat.run.s)}</div></div>
      )}</EgItem>
      <EgItem id="sum-bike" title={t("lt.tile.bike", "Rad")} defaultSpan={4} defaultHeight={60}>{() => (
        <div className="card stat"><div className="label"><T k="lt.tile.bike">Rad (indoor + outdoor + Commute)</T></div><div className="value">{Math.round(cat.bike.km)} km</div><div className="sub">{fmtDur(cat.bike.s)}</div></div>
      )}</EgItem>
      <EgItem id="sum-str" title={t("lt.tile.strength", "Kraft / Mobility")} defaultSpan={4} defaultHeight={60}>{() => (
        <div className="card stat"><div className="label"><T k="lt.tile.strength">Kraft / Mobility</T></div><div className="value">{fmtDur(cat.str.s)}</div><div className="sub"><T k="lt.tile.strength.sub">nur Zeit</T></div></div>
      )}</EgItem>
      {/* PMC über den gewählten Zeitraum */}
      <EgItem id="pmc" title={t("lt.block.pmc.title", "Performance Management Chart")} defaultSpan={12} defaultHeight={360}>{(h) => (
      <div className="card">
        <div className="spread"><h2><T k="lt.block.pmc.title">Performance Management Chart</T></h2><span className="tiny muted"><T k="lt.block.pmc.sub">Fitness · Fatigue · Form (geplant rechts von „heute")</T></span></div>
        <Pmc data={pmc} races={racesByDate} sickRanges={sickByDate}
          phaseRuns={phaseRuns} yearMarks={yearMarks} namesByDate={namesByDate} onPick={(d) => navigate("/track?date=" + d)} height={h ?? 360} />
      </div>
      )}</EgItem>

      {/* Intensity-Trend (ATL/CTL) — separater Graph, v0.15.0 (O3) */}
      <EgItem id="intensity" title={t("lt.block.intensity.title", "Intensity-Trend")} defaultSpan={12} defaultHeight={240} reserve={150}>{(h) => (
      <div className="card">
        <div className="spread"><h2><T k="lt.block.intensity.title">Intensity-Trend</T></h2><span className="tiny muted"><T k="lt.block.intensity.sub">Load Impact / Base Fitness = ATL/CTL</T></span></div>
        <IntensityRatio data={pmc} height={h ?? 240} />
      </div>
      )}</EgItem>

      {/* Saison-Progression (geplant vs. gelaufen) über den gewählten Zeitraum */}
      <EgItem id="season" title={t("lt.block.season.title", "Saison-Progression")} defaultSpan={12} defaultHeight={336}>{(h) => (
      <div className="card">
        <div className="spread"><h2><T k="lt.block.season.title">Saison-Progression</T></h2><span className="tiny muted"><T k="lt.block.season.sub">Ziel · geplant · gelaufen (km je Woche)</T></span></div>
        <SeasonProgress rows={visibleRows} highlightLabel={week ? weekLabel(week) : undefined} races={racesByWeek} sickLabels={sickLabels} height={h ?? 336} />
      </div>
      )}</EgItem>

      {/* (a) Wellness-Verläufe — jede Kennzahl als eigene, einzeln wählbare/anordenbare Kachel */}
      {visibleMetrics.map((m) => (
        <EgItem key={m.key} id={`wellness-${m.key}`} title={m.title} defaultSpan={4} defaultHeight={150}>{() => (
            <div className="card chart-card tight">
              <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 2 }}>{m.title}</div>
              {m.key === "bed_dev" ? (
                <SleepWindow data={sleepRows} xTickFormatter={fmtDate} height={135} />
              ) : (
              <ResponsiveContainer width="100%" height={135}>
                <LineChart data={points} margin={{ top: 6, right: 8, left: -10, bottom: 24 }}>
                  <CartesianGrid stroke="#eef1f5" vertical={false} />
                  {sickSegments.map((s, i) => (
                    <ReferenceArea key={`sick-${i}`} x1={s.x1} x2={s.x2} fill="#ef4444" fillOpacity={0.08} ifOverflow="hidden" />
                  ))}
                  <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={32} tick={{ fontSize: 10, fill: "#8a96a6" }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#8a96a6" }} width={44} domain={["auto", "auto"]} reversed={m.reversed}
                    tickFormatter={(v: number) => (m.fmt ? m.fmt(v) : String(Math.round(v * 10) / 10))}
                  />
                  <Tooltip
                    labelFormatter={(d) => { const p = phaseAtDate(String(d)); return p ? `${fmtDateY(String(d))} · ${p}` : fmtDateY(String(d)); }}
                    formatter={(v: number) => [m.fmt ? m.fmt(v) : Math.round(v * 10) / 10, m.title]}
                    contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }}
                  />
                  {m.refY != null && (
                    <ReferenceLine y={m.refY} stroke="#cbd5e1" strokeDasharray="3 4"
                      label={{ value: m.refLabel, fontSize: 9, fill: "#94a3b8", position: "right" }} />
                  )}
                  {wellnessRef.has(m.key) && (() => {
                    const r = wellnessRef.get(m.key)!;
                    return (<>
                      <ReferenceArea y1={r.lo} y2={r.hi} fill={m.color} fillOpacity={0.07} ifOverflow="hidden" />
                      <ReferenceLine y={r.mean} stroke={m.color} strokeDasharray="5 3" strokeOpacity={0.45} strokeWidth={1.2} />
                    </>);
                  })()}
                  <Line type="monotone" dataKey={m.key} stroke={m.color} strokeWidth={1.6}
                    dot={{ r: 1.8, fill: m.color, strokeWidth: 0 }} connectNulls />
                  {/* Phasenband + Jahres-Dreieck (ohne Phasenname — bei Sparklines zu unruhig). */}
                  <Customized component={(p: any) => <ChartDecor {...p} runs={wellnessPhaseRuns} years={wellnessYears} />} />
                </LineChart>
              </ResponsiveContainer>
              )}
            </div>
        )}</EgItem>
      ))}

      {/* (b) Zonen-Effizienz — zwei unabhängige Kacheln (Pace/HF und Effizienz-Faktor) */}
      {eff.length > 0 && (
      <EgItem id="eff-pace" title={t("lt.block.eff.title", "Ø-Pace vs. Ø-HF")} defaultSpan={6} defaultHeight={240} reserve={150}>{(h) => (
            <div className="card chart-card">
              <h3><T k="lt.block.eff.title">Ø-Pace vs. Ø-Herzfrequenz</T></h3>
              <ResponsiveContainer width="100%" height={h ?? 240}>
                <ComposedChart data={eff} margin={{ top: 8, right: 4, left: 0, bottom: 26 }}>
                  <CartesianGrid stroke="#eef1f5" vertical={false} />
                  {effSickSegments.map((s, i) => (
                    <ReferenceArea key={`esick-${i}`} yAxisId="pace" x1={s.x1} x2={s.x2} fill="#ef4444" fillOpacity={0.08} ifOverflow="hidden" />
                  ))}
                  <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={28} tick={{ fontSize: 11, fill: "#8a96a6" }} />
                  <YAxis yAxisId="pace" reversed domain={paceDomain} tickFormatter={(v: number) => paceStr(v)}
                    width={44} tick={{ fontSize: 11, fill: "#8a96a6" }} />
                  <YAxis yAxisId="hr" orientation="right" domain={["auto", "auto"]} width={34}
                    tick={{ fontSize: 11, fill: "#d53f8c" }} />
                  <Tooltip
                    labelFormatter={(d) => { const p = phaseAtDate(String(d)); return `Woche ab ${fmtDateY(String(d))}${p ? ` · ${p}` : ""}`; }}
                    formatter={(v: number, n: string) => (n === "Ø-Pace" ? [`${paceStr(v)} /km`, n] : [Math.round(v), n])}
                    contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }}
                  />
                  <Line yAxisId="pace" type="monotone" dataKey="pace" name="Ø-Pace" stroke="#2b6cb0"
                    strokeWidth={1.8} connectNulls dot={{ r: 3, fill: "#2b6cb0", strokeWidth: 0 }} hide={effHidden.pace} />
                  <Line yAxisId="hr" type="monotone" dataKey="hr" name="Ø-HF" stroke="#d53f8c"
                    strokeWidth={1.8} connectNulls dot={{ r: 3, fill: "#d53f8c", strokeWidth: 0 }} hide={effHidden.hr} />
                  <Customized component={(p: any) => <ChartDecor {...p} runs={effPhaseRuns} years={effYears} />} />
                </ComposedChart>
              </ResponsiveContainer>
              {/* Klickbare Legende: Ø-Pace / Ø-HF einzeln ein-/ausblenden (wie PMC, ToDo v0.11.0). */}
              <div className="pmc-legend">
                <button type="button" onClick={() => setEffHidden((h) => ({ ...h, pace: !h.pace }))} style={{ opacity: effHidden.pace ? 0.4 : 1 }}>
                  <span className="dot" style={{ background: "#2b6cb0" }} /> Ø-Pace
                </button>
                <button type="button" onClick={() => setEffHidden((h) => ({ ...h, hr: !h.hr }))} style={{ opacity: effHidden.hr ? 0.4 : 1 }}>
                  <span className="dot" style={{ background: "#d53f8c" }} /> Ø-HF
                </button>
              </div>
              <p className="tiny muted" style={{ margin: "6px 0 0" }}>
                <T k="lt.eff.hint">Wochenmittel aller lockeren Läufe (ohne Intervall-Belastungen) sinkende Pace bei gleichem Puls = bessere Ökonomie</T>
              </p>
            </div>
      )}</EgItem>
      )}
      {eff.length > 0 && (
      <EgItem id="eff-ef" title={t("lt.block.ef.title", "Effizienz-Faktor")} defaultSpan={6} defaultHeight={240} reserve={130}>{(h) => (
            <div className="card chart-card">
              <h3><T k="lt.block.ef.title">Effizienz-Faktor (m/min je Herzschlag)</T></h3>
              <ResponsiveContainer width="100%" height={h ?? 240}>
                <LineChart data={eff} margin={{ top: 8, right: 12, left: -14, bottom: 26 }}>
                  <CartesianGrid stroke="#eef1f5" vertical={false} />
                  {effSickSegments.map((s, i) => (
                    <ReferenceArea key={`esick2-${i}`} x1={s.x1} x2={s.x2} fill="#ef4444" fillOpacity={0.08} ifOverflow="hidden" />
                  ))}
                  <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={28} tick={{ fontSize: 11, fill: "#8a96a6" }} />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11, fill: "#8a96a6" }} width={44} />
                  <Tooltip
                    labelFormatter={(d) => { const p = phaseAtDate(String(d)); return `Woche ab ${fmtDateY(String(d))}${p ? ` · ${p}` : ""}`; }}
                    formatter={(v: number) => [v, "EF"]}
                    contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="ef" name="EF" stroke="#16a34a" strokeWidth={1.8}
                    connectNulls dot={{ r: 3, fill: "#16a34a", strokeWidth: 0 }} />
                  <Customized component={(p: any) => <ChartDecor {...p} runs={effPhaseRuns} years={effYears} />} />
                </LineChart>
              </ResponsiveContainer>
              <p className="tiny muted" style={{ margin: "6px 0 0" }}>
                <T k="lt.block.ef.hint">Steigender EF bei gleicher Belastung = Herz-Kreislauf-System wird ökonomischer.</T>
              </p>
            </div>
      )}</EgItem>
      )}

      {/* (b2b) Aerobe Entkopplung / Durability-Trend (C1, v1.4.0) */}
      {decoupling.length > 0 && (
        <EgItem id="decoupling" title={t("lt.block.decoupling.title", "Aerobe Entkopplung (Durability)")} defaultSpan={6} defaultHeight={240} reserve={130}>{(h) => (
          <div className="card chart-card">
            <h3><T k="lt.block.decoupling.title">Aerobe Entkopplung (Pa:HR-Drift)</T></h3>
            <ResponsiveContainer width="100%" height={h ?? 240}>
              <LineChart data={decoupling} margin={{ top: 8, right: 12, left: -14, bottom: 26 }}>
                <CartesianGrid stroke="#eef1f5" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={28} tick={{ fontSize: 11, fill: "#8a96a6" }} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11, fill: "#8a96a6" }} width={40} unit="%" />
                <Tooltip
                  labelFormatter={(d) => { const p = phaseAtDate(String(d)); return `${fmtDateY(String(d))}${p ? ` · ${p}` : ""}`; }}
                  formatter={(v: number, _n: string, item: any) => {
                    const km = item?.payload?.distance_km;
                    return [`${v} %${km ? ` · ${km} km` : ""}`, "Entkopplung"];
                  }}
                  contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }}
                />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                <ReferenceLine y={5} stroke="#f59e0b" strokeDasharray="4 3"
                  label={{ value: "5% Schwelle", fontSize: 9, fill: "#f59e0b", position: "right" }} />
                <Line type="monotone" dataKey="decoupling" name="Entkopplung" stroke="#8b5cf6" strokeWidth={1.8}
                  connectNulls dot={{ r: 3, fill: "#8b5cf6", strokeWidth: 0 }} />
                <Customized component={(p: any) => <ChartDecor {...p} runs={[]} years={yearMarksByDateAll(decoupling.map((x) => x.date))} />} />
              </LineChart>
            </ResponsiveContainer>
            <p className="tiny muted" style={{ margin: "6px 0 0" }}>
              <T k="lt.block.decoupling.hint">Herzfrequenz-Drift langer Läufe (≥30 min): unter 5% = gute aerobe Ausdauer. Nur Läufe mit Herzfrequenz-Stream.</T>
            </p>
          </div>
        )}</EgItem>
      )}

      {/* (b2c) Zonen-Histogramm: aggregierte Zeit in HF/Pace-Zonen (C3, v1.4.0) */}
      {zoneHist && (zoneHist.hrBands.some((b) => b.min > 0) || zoneHist.paceBands.some((b) => b.min > 0)) && (
        <EgItem id="zone-hist" title={t("lt.block.zhist.title", "Zonen-Histogramm (HF & Pace)")} defaultSpan={12} defaultHeight={200} reserve={130}>{(h) => (
          <div className="card chart-card">
            <h3><T k="lt.block.zhist.title">Zeit in HF- und Pace-Zonen</T></h3>
            <ZoneHistogram data={zoneHist} height={(h ?? 200) - 50} />
            <p className="tiny muted" style={{ margin: "6px 0 0" }}>
              <T k="lt.block.zhist.hint">Aggregierte Trainingszeit je Zone im gewählten Zeitraum. Pace-Zonen nur für Läufe mit Strava-Streams.</T>
            </p>
          </div>
        )}</EgItem>
      )}

      {/* (b2d) Fitness-Signale konsolidiert: CTL + VDOT-Trend (C4, v1.4.0) */}
      {(() => {
        if (!fitnessTrend || !pmc.length) return null;
        const vdotMap = new Map<string, number>();
        for (const p of fitnessTrend.points) if (p.vdot != null) vdotMap.set(p.date, p.vdot);
        const merged = pmc.map((p) => ({ date: p.date, ctl: Math.round(p.ctl), vdot: vdotMap.get(p.date) ?? null }));
        const hasVdot = merged.some((x) => x.vdot != null);
        if (!hasVdot) return null;
        const fitYears = yearMarksByDate(pmc.map((p) => p.date));
        const fitPhaseRuns = phaseRunsByDate(pmc.map((p) => p.date), season);
        return (
          <EgItem id="fitness-signals" title={t("lt.block.fitness.title", "Fitness-Signale (CTL + VDOT)")} defaultSpan={6} defaultHeight={240} reserve={130}>{(h) => (
            <div className="card chart-card">
              <h3><T k="lt.block.fitness.title">Fitness-Signale: CTL & VDOT-Trend</T></h3>
              <ResponsiveContainer width="100%" height={h ?? 240}>
                <ComposedChart data={merged} margin={{ top: 8, right: 40, left: -14, bottom: 26 }}>
                  <CartesianGrid stroke="#eef1f5" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={28} tick={{ fontSize: 11, fill: "#8a96a6" }} />
                  <YAxis yAxisId="ctl" domain={["auto", "auto"]} tick={{ fontSize: 11, fill: "#2b6cb0" }} width={40} />
                  <YAxis yAxisId="vdot" orientation="right" domain={["auto", "auto"]} tick={{ fontSize: 11, fill: "#d97706" }} width={32} />
                  <Tooltip
                    labelFormatter={(d) => { const p = phaseAtDate(String(d)); return `${fmtDateY(String(d))}${p ? ` · ${p}` : ""}`; }}
                    formatter={(v: number, n: string) => [Math.round(v * 10) / 10, n]}
                    contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }}
                  />
                  <Line yAxisId="ctl" type="monotone" dataKey="ctl" name="CTL" stroke="#2b6cb0" strokeWidth={1.6}
                    dot={false} connectNulls />
                  <Line yAxisId="vdot" type="monotone" dataKey="vdot" name="VDOT" stroke="#d97706" strokeWidth={1.8}
                    dot={{ r: 3, fill: "#d97706", strokeWidth: 0 }} connectNulls />
                  <Customized component={(p: any) => <ChartDecor {...p} runs={fitPhaseRuns} years={fitYears} />} />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="tiny muted" style={{ margin: "6px 0 0" }}>
                <T k="lt.block.fitness.hint">CTL (blau, links) zeigt das Trainingsvolumen; VDOT (orange, rechts) die aerobe Kapazität. Beide sollten langfristig steigen.</T>
              </p>
            </div>
          )}</EgItem>
        );
      })()}

      {/* (b3) Plan-Erfüllung (Wochenmittel) — v0.14.0, ToDo 12 */}
      {hasAdh && (
        <EgItem id="planadh" title={t("lt.block.adh.title", "Plan-Erfüllung (Wochenmittel)")} defaultSpan={12} defaultHeight={200} reserve={130}>{(h) => (
        <div className="card">
          <div className="spread">
            <h2><T k="lt.block.adh.title">Plan-Erfüllung (Wochenmittel)</T></h2>
            <span className="tiny muted"><T k="lt.block.adh.sub">TSS-Treffer + Zeit in Ziel-Pace-Zone, je Woche</T></span>
          </div>
          <ResponsiveContainer width="100%" height={h ?? 200}>
            <LineChart data={adhData} margin={{ top: 8, right: 12, left: -14, bottom: 26 }}>
              <CartesianGrid stroke="#eef1f5" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={28} tick={{ fontSize: 11, fill: "#8a96a6" }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#8a96a6" }} width={40} unit="%" />
              <Tooltip
                labelFormatter={(d) => { const p = phaseAtDate(String(d)); return `Woche ab ${fmtDateY(String(d))}${p ? ` · ${p}` : ""}`; }}
                formatter={(v: number) => [`${v} %`, "Plan-Erfüllung"]}
                contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }}
              />
              <Line type="monotone" dataKey="pct" name="Plan-Erfüllung" stroke="#0891b2" strokeWidth={1.8}
                connectNulls dot={{ r: 3, fill: "#0891b2", strokeWidth: 0 }} />
              <Customized component={(p: any) => <ChartDecor {...p} runs={adhPhaseRuns} years={adhYears} />} />
            </LineChart>
          </ResponsiveContainer>
          <p className="tiny muted" style={{ margin: "6px 0 0" }}>
            <T k="lt.block.adh.hint">Wie konsequent die geplanten Einheiten umgesetzt wurden (gematchte Einheiten je Woche).</T>
          </p>
        </div>
        )}</EgItem>
      )}

      {/* (b2) Wochen-Check-Heatmap (ToDo 7) */}
      <EgItem id="heatmap" title={t("lt.block.heatmap.title", "Wochen-Checks")} defaultSpan={12} defaultHeight={300}>{() => (
      <div className="card">
        <div className="spread">
          <h2><T k="lt.block.heatmap.title">Wochen-Checks</T></h2>
          <span className="tiny muted"><T k="lt.block.heatmap.sub">Manuell abgehakt je Woche — erfüllt = farbig, offen = blass</T></span>
        </div>
        {(!checks.length || !heatWeeks.length) ? (
          <p className="muted tiny"><T k="lt.block.heatmap.empty">Keine Checks definiert (in „Auswahllisten" anlegen) oder keine Wochen im Zeitraum.</T></p>
        ) : (
          <div className="check-heatmap-scroll">
            <div className="check-heatmap" style={{ gridTemplateColumns: `150px repeat(${heatWeeks.length}, minmax(13px, 1fr))` }}>
              <div className="ch-corner" />
              {heatWeeks.map((w) => (
                <div key={`hh-${w.week_no}`} className={"ch-col-head" + (w.phase === "Krank" ? " sick" : "")}
                  title={`${weekLabel(w)} · ${fmtDateY(w.start_date)}`}>{isoWeek(w.start_date)}</div>
              ))}
              {checks.map((c) => (
                <Fragment key={c.value}>
                  <div className="ch-row-head" title={c.label}>{c.label}</div>
                  {heatWeeks.map((w) => {
                    const on = !!checkByWeek.get(w.week_no)?.[c.value];
                    return (
                      <div key={`${c.value}-${w.week_no}`} className={"ch-cell" + (on ? " on" : "")}
                        style={on ? { background: c.color || "#3b82f6" } : undefined}
                        title={`${c.label} · ${weekLabel(w)}: ${on ? "erfüllt" : "offen"}`} />
                    );
                  })}
                </Fragment>
              ))}
              {/* Plan-Erfüllung % je Woche (TSS-basiert, automatisch). */}
              <div className="ch-score-head" title={t("lt.heatmap.adh.tooltip", "Plan-Erfüllung % (TSS-basiert)")}><T k="lt.heatmap.adh.label">Plan-Erf. %</T></div>
              {heatWeeks.map((w) => {
                const pct = adhByWeek.get(w.week_no) ?? null;
                const bg = adhCellColor(pct);
                return (
                  <div key={`adh-${w.week_no}`} className="ch-score-cell"
                    style={bg ? { background: bg, color: "#fff" } : undefined}
                    title={pct != null ? `${weekLabel(w)}: ${pct}% Planerfüllung (TSS)` : `${weekLabel(w)}: keine Daten`}>
                    {pct != null ? pct : ""}
                  </div>
                );
              })}
              {/* Score-Zeile: % erfüllter Checks je Woche, eingefärbt (gold/grün/gelb/orange/rot). */}
              <div className="ch-score-head"><T k="lt.heatmap.score.label">Erfüllt %</T></div>
              {heatWeeks.map((w) => {
                const s = weekScore(w.week_no);
                return (
                  <div key={`sc-${w.week_no}`} className="ch-score-cell"
                    style={s != null ? { background: scoreColor(s), color: "#fff" } : undefined}
                    title={s != null ? `${weekLabel(w)}: ${s}% erfüllt` : `${weekLabel(w)}: keine Daten`}>
                    {s != null ? s : ""}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      )}</EgItem>

      {/* (c) Intervall-Trend */}
      {hasRunTrend(trend) && (
        <EgItem id="intervall" title={t("lt.block.intervall.title", "Intervall-Trend nach Kategorie")} defaultSpan={12} defaultHeight={260}>{(h) => (
        <div className="card">
          <div className="spread">
            <h2><T k="lt.block.intervall.title">Intervall-Trend nach Kategorie</T></h2>
            <span className="tiny muted"><T k="lt.block.intervall.sub">Ø-Pace der Belastungen je Einheit — LT1 · LT2 · VO2 kurz · VO2 lang (schneller = oben)</T></span>
          </div>
          <IntervalTrend data={trend ?? []} height={h ?? 260} />
        </div>
        )}</EgItem>
      )}
      </EditableGrid>
    </div>
  );
}

function maxDate(a: string, b: string) { return a > b ? a : b; }
