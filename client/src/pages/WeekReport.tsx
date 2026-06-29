// Wochenbericht — Druck-Layout auf 2 Seiten (ToDo „Auswertung zeigt 2x ziemlich dasselbe"):
// Seite 1: Kopf · Kategorie-Summen · Einheiten geplant/real (mit Aktivitäts-Notizen) ·
//          Kern-Visualisierung (Zonen, Intensität, PMC ±6 Wochen, Saison-Progression) · Wellness-Ø · Wochen-Checks.
// Seite 2: vollständige Tagesfaktoren-Tabelle · Wellness-Verläufe · Reflexion.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  api, type PlannedSession, type Activity, type DailyLog, type AnalyzeResult, type PmcPoint, type Effort, type Race, type BestsResult,
} from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import {
  DAY_NAMES, daysOfWeek, fmtDate, fmtDateY, typeLabel, typeColor, sportLabel, paceStr, paceOrSpeed,
  fmtDur, weekLabel, phaseLabel, addDays, pbMarkers,
} from "../lib/util.ts";
import { raceMarkersByDate, raceMarkersByWeek, sickRangesByDate, sickWeekLabels, phaseRunsByDate } from "../lib/markers.ts";
import { useOptions, typeIntensity } from "../lib/options.ts";
import WeekSelector from "../components/WeekSelector.tsx";
import ZoneDistribution from "../charts/ZoneDistribution.tsx";
import IntensityDonut from "../charts/IntensityDonut.tsx";
import Pmc from "../charts/Pmc.tsx";
import SeasonProgress, { buildSeasonRows, type SeasonRow } from "../charts/SeasonProgress.tsx";
import WeekdayBars from "../charts/WeekdayBars.tsx";
import { wellnessTrendData, WellnessTrendChart } from "../charts/WellnessTrends.tsx";
import WeekPmcStrip from "../components/WeekPmcStrip.tsx";
import EditableGrid, { EgItem } from "../components/EditableGrid.tsx";
import T from "../components/T.tsx";
import { useT, renderFlag } from "../lib/i18n.tsx";

// Tagesfaktoren für Seite 2 — alles, was eingetragen werden kann, ist hier auffindbar.
type MetricDef = { key: string; label: string; text?: boolean };
const DAY_METRICS: MetricDef[] = [
  { key: "hrv", label: "HRV (ms)" },
  { key: "resting_hr", label: "Ruhepuls (bpm)" },
  { key: "recovery", label: "Recovery (%)" },
  { key: "strain", label: "Strain" },
  { key: "sleep_h", label: "Schlaf (h)" },
  { key: "bedtime", label: "Bettzeit", text: true },
  { key: "wake_time", label: "Aufwachzeit", text: true },
  { key: "sleep_performance", label: "Sleep-Performance (%)" },
  { key: "sleep_efficiency", label: "Schlaf-Effizienz (%)" },
  { key: "sleep_consistency", label: "Schlaf-Konsistenz (%)" },
  { key: "rem_h", label: "REM (h)" },
  { key: "deep_h", label: "Tiefschlaf (h)" },
  { key: "resp_rate", label: "Atemfrequenz" },
  { key: "spo2", label: "SpO₂ (%)" },
  { key: "weight", label: "Gewicht (kg)" },
  { key: "rpe", label: "RPE" },
  { key: "legs", label: "Beine", text: true },
  { key: "soreness", label: "Muskelkater" },
  { key: "pain", label: "Schmerz" },
  { key: "pain_location", label: "Schmerz-Ort", text: true },
  { key: "energy", label: "Energie" },
  { key: "mood", label: "Stimmung" },
  { key: "stress", label: "Stress" },
  { key: "motivation", label: "Motivation" },
  { key: "alcohol", label: "Alkohol" },
  { key: "caffeine", label: "Koffein" },
  { key: "hydration", label: "Hydration" },
  { key: "fueling", label: "Fueling" },
  { key: "travel", label: "Reise" },
  { key: "sick", label: "Krank" },
  { key: "notes", label: "Notizen", text: true },
];

const WELLNESS_KEYS: [string, string][] = [
  ["recovery", "Recovery %"], ["strain", "Strain Ø"], ["hrv", "HRV"], ["resting_hr", "Ruhepuls"],
  ["sleep_h", "Schlaf h"], ["sleep_performance", "Sleep-Perf. %"], ["weight", "Gewicht"],
  ["energy", "Energie"], ["stress", "Stress"], ["motivation", "Motivation"],
];

type Cat = { run: { km: number; min: number }; bike: { km: number; min: number }; strength: { min: number } };

export default function WeekReport() {
  const { season, week, weekNo, setWeekNo, loading } = useSeason();
  const { checks } = useOptions(); // konfigurierbare Wochen-Checks (ToDo 7, v0.11.0)
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [daily, setDaily] = useState<DailyLog[]>([]);
  const [bandDaily, setBandDaily] = useState<DailyLog[]>([]); // v1.10.0: 30-Tage-Fenster für den Normalbereich
  const [analyze, setAnalyze] = useState<AnalyzeResult | null>(null);
  const [wlog, setWlog] = useState<any>({});
  const [pmcWin, setPmcWin] = useState<PmcPoint[]>([]);
  const [seasonRows, setSeasonRows] = useState<SeasonRow[]>([]);
  const [allSessions, setAllSessions] = useState<PlannedSession[]>([]);
  const [allRaces, setAllRaces] = useState<Race[]>([]);
  const [bikeFactor, setBikeFactor] = useState(0.25); // Rad-km → Lauf-km (Wochentags-Chart, ToDo Z.9)
  const [bests, setBests] = useState<BestsResult | null>(null); // M5: PB-Marker im PMC
  useEffect(() => { api.bests().then(setBests).catch(() => setBests(null)); }, []);
  const yearStart = `${new Date().getUTCFullYear()}-01-01`; // Bericht-Charts ab 1.1. (ToDo #8)

  async function reload() {
    if (!week) return;
    const [s, a, d, an, w, bd] = await Promise.all([
      api.sessions({ week: week.week_no }),
      api.activities({ from: week.start_date, to: week.end_date }),
      api.daily({ from: week.start_date, to: week.end_date }),
      api.analyzeWeek(week.week_no),
      api.weeklog(week.week_no),
      api.daily({ from: addDays(week.end_date, -29), to: week.end_date }), // 30-Tage-Normalbereich
    ]);
    setSessions(s); setActs(a); setDaily(d); setAnalyze(an); setWlog(w || {}); setBandDaily(bd);
    api.settings().then((cfg) => setBikeFactor(cfg?.run_equiv_bike_factor ?? 0.25)).catch(() => {});
  }
  useEffect(() => {
    reload();
    // PMC baut sich ab 1.1. des aktuellen Jahres auf und endet exakt am Ende der Berichtswoche
    // (v0.14.0): so spiegelt der Bericht rückwirkend genau den Stand „bis zu dieser Woche".
    if (week) {
      api.pmc(yearStart, week.end_date)
        .then((r) => setPmcWin(r.pmc)).catch(() => setPmcWin([]));
    }
    // eslint-disable-next-line
  }, [week?.week_no]);

  // Sprung aus dem Tracking: ?date=YYYY-MM-DD wählt die zugehörige Woche (Gegenstück zu WeekTrack).
  const [params] = useSearchParams();
  useEffect(() => {
    const d = params.get("date");
    if (!d || !season.length) return;
    const w = season.find((x) => x.start_date <= d && d <= x.end_date);
    if (w) setWeekNo(w.week_no);
    // eslint-disable-next-line
  }, [season, params]);

  // Saison-Progression ab 1.1. des aktuellen Jahres (baut sich auf), Berichtswoche hervorgehoben.
  useEffect(() => {
    if (!season.length) return;
    const from = season[0].start_date;
    const to = season[season.length - 1].end_date;
    Promise.all([api.sessions({}), api.activities({ from, to }), api.races()])
      .then(([s, a, rc]) => { setSeasonRows(buildSeasonRows(season, s, a).filter((r) => !r.start || r.start >= yearStart)); setAllSessions(s); setAllRaces(rc); })
      .catch(() => setSeasonRows([]));
  }, [season]);

  const t = useT();
  const REFLECT: [string, string][] = [
    ["adherence", t("report.refl.adherence", "Plan-Treue (% umgesetzt)")],
    ["progress", t("report.refl.progress", "Fortschritt ggü. Vorwoche")],
    ["highlight", t("report.refl.highlight", "Highlight / Win der Woche")],
    ["pain", t("report.refl.pain", "Schmerzen / Niggles / Verletzungsrisiko")],
    ["recovery_strategies", t("report.refl.recoveryStrategies", "Genutzte Recovery-Strategien")],
    ["fueling", t("report.refl.fueling", "Ernährung / Fueling / Gewicht")],
    ["mental", t("report.refl.mental", "Mentale Frische / Stress (Studium/Job)")],
    ["confidence", t("report.refl.confidence", "Confidence Richtung Saisonziel")],
    ["lessons", t("report.refl.lessons", "Lessons → Anpassung Folgewoche")],
  ];
  if (loading) return <p className="muted"><T k="report.loading">Lädt…</T></p>;
  if (!week) return <div className="empty"><T k="report.noWeek">Keine Woche.</T></div>;

  const days = daysOfWeek(week.start_date);
  // Marker (Races gold, Krank rot) für PMC + Saison-Progression
  const racesByDate = raceMarkersByDate(allSessions, allRaces);
  const sickByDate = sickRangesByDate(season);
  const racesByWeek = raceMarkersByWeek(season, allSessions, allRaces);
  const sickLabels = sickWeekLabels(season);
  const pmcPhaseRuns = phaseRunsByDate(pmcWin.map((p) => p.date), season);
  const weekRaces = allRaces.filter((r) => r.date >= week.start_date && r.date <= week.end_date);
  const runActs = acts.filter((a) => a.sport === "Run");
  const actualKm = round1(runActs.reduce((s, a) => s + (a.distance_m || 0) / 1000, 0));
  const actualTss = round1(acts.reduce((s, a) => s + (a.tss || 0), 0));

  // Saison-Progression nur bis einschl. der Berichtswoche (v0.14.0, ToDo 2) — Renderzeit-Filter,
  // damit der Wochenwechsel greift (der seasonRows-Effekt ist auf [season] gekeyt).
  const reportRows = seasonRows.filter((r) => !r.start || r.start <= week.start_date);

  // PMC-Kennzahlen am Wochenende (v0.14.0, ToDo 2): CTL/ATL/TSB am letzten Tag der Woche + CTL-Ramp
  // (Δ CTL ggü. 7 Tage davor). Aus dem (bereits auf die Woche beschnittenen) pmcWin abgeleitet.
  const endPt = [...pmcWin].reverse().find((p) => p.date <= week.end_date) ?? null;
  const prevCtl = endPt ? pmcWin.find((p) => p.date === addDays(endPt.date, -7))?.ctl ?? null : null;
  const endRamp = endPt && prevCtl != null ? round1(endPt.ctl - prevCtl) : null;

  // Efficiency Factor je Wochentag (DL/Longruns) — zeigt Carry-over harter Vortage (v0.14.0, ToDo 11).
  const efByDay = days.map((d, i) => {
    const runs = acts.filter((a) => a.date === d && isEasyRunType(a.type))
      .map((a) => ({ ef: efOf(a), km: (a.distance_m || 0) / 1000 }))
      .filter((x): x is { ef: number; km: number } => x.ef != null);
    let ef: number | null = null;
    if (runs.length) {
      const wsum = runs.reduce((s, r) => s + r.km, 0);
      ef = wsum > 0
        ? Math.round((runs.reduce((s, r) => s + r.ef * r.km, 0) / wsum) * 100) / 100
        : Math.round((runs.reduce((s, r) => s + r.ef, 0) / runs.length) * 100) / 100;
    }
    const prev = addDays(d, -1);
    const hardPrev = acts.some((a) => a.date === prev && (a.type === "Race" || (!!a.type && typeIntensity(a.type) === "hard")));
    return { day: DAY_NAMES[i], date: d, ef, hardPrev };
  });
  const efVals = efByDay.map((x) => x.ef).filter((v): v is number => v != null);
  const efAvg = efVals.length ? Math.round((efVals.reduce((a, b) => a + b, 0) / efVals.length) * 100) / 100 : null;

  // Plan-Erfüllung je Wochentag (v0.14.0, ToDo 12) — Ø der gematchten Einheiten des Tages.
  const adh = (analyze as any)?.adherence as { perSession: { date: string; pct: number }[]; weekPct: number | null } | undefined;
  const adhByDay = days.map((d, i) => {
    const sess = adh?.perSession.filter((p) => p.date === d) ?? [];
    const pct = sess.length ? Math.round(sess.reduce((s, x) => s + x.pct, 0) / sess.length) : null;
    return { day: DAY_NAMES[i], pct };
  });
  const hasAdh = adhByDay.some((x) => x.pct != null);

  // ---- reale Zeit-in-Zone: bevorzugt vom Server (paralleler Agent), sonst clientseitig ----
  const anyAnalyze = analyze as any;
  const serverRealZone: Record<number, number> | undefined =
    anyAnalyze?.totals?.realZoneMin ?? anyAnalyze?.realZoneMin;
  const clientRealZone: Record<number, number> = {};
  (analyze?.zones || []).forEach((z) => (clientRealZone[z.z] = 0));
  for (const a of acts) {
    if (a.zone_min) for (const k of Object.keys(a.zone_min)) clientRealZone[+k] = (clientRealZone[+k] || 0) + (a.zone_min[+k] || 0);
    else if (a.zones) for (const k of Object.keys(a.zones)) clientRealZone[+k] = (clientRealZone[+k] || 0) + (a.zones[+k] || 0) / 60;
  }
  const realZoneMin = serverRealZone && Object.values(serverRealZone).some((x) => (x || 0) > 0) ? serverRealZone : clientRealZone;
  const hasRealZones = Object.values(realZoneMin).some((x) => (x || 0) > 0);

  // ---- Kategorie-Summen (ToDo 21): Server bevorzugt, sonst clientseitig aggregiert ----
  const plannedCat: Cat = analyze?.totals?.byCategory ?? catsFromPlan(sessions);
  const serverRealCat: Cat | undefined = anyAnalyze?.totals?.realByCategory ?? anyAnalyze?.realByCategory;
  const realCat: Cat = serverRealCat ?? catsFromActs(acts);

  // Item 1: Erfüllungs-Prozent (Ist/Plan) für die schlanke Completion-Bar.
  const pct = (real: number, planned: number) => (planned > 0 ? (real / planned) * 100 : null);

  const wellness = avgWellness(daily);
  const wtrend = wellnessTrendData(daily, days);
  // v1.10.0: 30-Tage-Normalbereich (Mittel ± 1σ) je Wellness-Metrik aus dem Fenster bis zum Wochenende.
  const wellnessBands = (() => {
    const m = new Map<string, { lo: number; hi: number; mean: number }>();
    for (const k of ["hrv", "resting_hr", "recovery", "strain", "sleep_h"]) {
      const vals = bandDaily.map((d) => (d as Record<string, unknown>)[k]).filter((v): v is number => typeof v === "number" && isFinite(v));
      if (vals.length >= 4) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
        m.set(k, { lo: mean - std, hi: mean + std, mean });
      }
    }
    return m;
  })();
  const saveW = (patch: Record<string, unknown>) => { const n = { ...wlog, ...patch }; setWlog(n); api.saveWeeklog(week.week_no, n); };
  const saveCheck = (k: string, val: boolean) => saveW({ checks: { ...(wlog.checks || {}), [k]: val } });
  const saveRefl = (k: string, val: string) => saveW({ refl_extra: { ...(wlog.refl_extra || {}), [k]: val } });

  const byDate = new Map(daily.map((d) => [d.date, d]));
  const visibleMetrics = DAY_METRICS.filter((m) => days.some((d) => hasVal(byDate.get(d)?.[m.key])));

  return (
    <div>
      <div className="spread no-print">
        <div>
          <h1><T k="report.title">Wochenbericht</T></h1>
          <span className="tiny muted" style={{ display: "block", marginTop: -2 }}><T k="report.role">Diese Woche im Detail — geplant vs. real, Zonen und Wochen-Checks.</T></span>
        </div>
        <div className="row">
          <WeekSelector season={season} weekNo={weekNo} setWeekNo={setWeekNo}
            jumpTo={{ href: `/track?date=${week.start_date}`, title: t("report.toTracking.title", "Zur gleichen Woche im Tracking"), label: t("report.toTracking.label", "→ Tracking") }} />
          <button className="primary" onClick={() => window.print()}><T k="report.btn.print">🖨 Drucken / PDF</T></button>
        </div>
      </div>

      <EditableGrid page="weekreport" paged>
        {/* Kopf */}
        <EgItem id="head" title={t("report.tile.head", "Kopf")} defaultSpan={12} defaultHeight={132} reserve={100}>{() => (
          <div className="card report-head">
            <div className="spread">
              <div>
                <h2 style={{ margin: 0 }}>{weekLabel(week)} — {phaseLabel(week.phase)}</h2>
                <div className="muted tiny">
                  {fmtDateY(week.start_date)} – {fmtDateY(week.end_date)} · Ziel {week.target_km ?? "–"} km
                  {week.goal_race ? ` · ${week.goal_race}` : ""}{week.notes ? ` · ${week.notes}` : ""}
                </div>
              </div>
              <div className="row" style={{ gap: 18, alignItems: "flex-start" }}>
                {(() => {
                  const v = analyze?.vo2max;
                  const d = v && v.prev != null ? Math.round((v.now - v.prev) * 10) / 10 : null;
                  return (
                    <div style={{ textAlign: "center", paddingRight: 4 }} title="VO₂max (VDOT-basiert, 90-Tage-Fenster) zum Wochenstand — Δ gegenüber der Vorwoche.">
                      <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>{v?.now ?? "–"}</div>
                      <div className="tiny muted">VO₂max</div>
                      {d != null && (
                        <div className="tiny" style={{ fontWeight: 700, color: d > 0 ? "var(--ok)" : d < 0 ? "var(--danger)" : "var(--muted)" }}>
                          {d > 0 ? `↗ +${d}` : d < 0 ? `↘ ${d}` : "→ ±0"}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <Mini label={t("report.head.run", "Lauf")} v={`${actualKm} km`} sub={`${t("report.head.target", "Ziel")} ${week.target_km ?? "–"}`} />
                <Mini label={t("report.head.tss", "TSS")} v={`${Math.round(actualTss)}`} />
              </div>
            </div>
            {analyze?.pmc && <WeekPmcStrip pmc={analyze.pmc} />}
          </div>
        )}</EgItem>

        {/* Kategorie-Summen: Lauf / Rad gesamt / Kraft & Mobility */}
        {/* Kategorie-Summen (#10): 3 schlichte Stat-Kacheln wie Langzeit (Ist groß · geplant · dünne Bar), nicht gestreckt. */}
        <EgItem id="cat-run" title={t("report.tile.cats.run", "Lauf")} defaultSpan={4} defaultHeight={84}>{() => (
          <CatStat label={t("report.cat.run", "Lauf")} value={`${round1(realCat.run.km)} km · ${hours(realCat.run.min)}`}
            planned={`${t("report.cat.planned", "geplant")} ${round1(plannedCat.run.km)} km · ${hours(plannedCat.run.min)}`}
            pct={pct(realCat.run.km, plannedCat.run.km)} />
        )}</EgItem>
        <EgItem id="cat-bike" title={t("report.tile.cats.bike", "Rad gesamt")} defaultSpan={4} defaultHeight={84}>{() => (
          <CatStat label={t("report.cat.bike", "Rad gesamt (indoor + outdoor + Commute)")} value={`${round1(realCat.bike.km)} km · ${hours(realCat.bike.min)}`}
            planned={`${t("report.cat.planned", "geplant")} ${round1(plannedCat.bike.km)} km · ${hours(plannedCat.bike.min)}`}
            pct={pct(realCat.bike.km, plannedCat.bike.km) ?? pct(realCat.bike.min, plannedCat.bike.min)} />
        )}</EgItem>
        <EgItem id="cat-str" title={t("report.tile.cats.str", "Kraft / Mobility")} defaultSpan={4} defaultHeight={84}>{() => (
          <CatStat label={t("report.cat.strength", "Kraft / Mobility")} value={hours(realCat.strength.min)}
            planned={`${t("report.cat.planned", "geplant")} ${hours(plannedCat.strength.min)}`}
            pct={pct(realCat.strength.min, plannedCat.strength.min)} />
        )}</EgItem>

        {/* Einheiten geplant vs. real — Notizen als gedämpfte Zeile unter jeder Einheit */}
        <EgItem id="units" title={t("report.tile.units", "Einheiten")} defaultSpan={12} defaultHeight={420}>{() => (
          <div className="card">
          <div className="spread mt">
            <h3 style={{ margin: 0 }}><T k="report.tile.units">Einheiten</T></h3>
            {hasAdh && adh?.weekPct != null && (
              <span className="tiny muted">Plan-Erfüllung Ø Woche {adh.weekPct}% <span className="muted">(TSS-Treffer + Zeit in Ziel-Pace-Zone)</span></span>
            )}
          </div>
          <div className="table-scroll"><table className="units">
            <thead><tr><th><T k="report.col.day">Tag</T></th><th><T k="report.col.adh">Plan-Erf.</T></th><th><T k="report.col.planned">Geplant</T></th><th><T k="report.col.real">Real</T></th><th><T k="report.col.km">km</T></th><th><T k="report.col.time">Zeit</T></th><th><T k="report.col.tss">TSS</T></th><th><T k="report.col.kcal">kcal</T></th><th><T k="report.col.rpe">RPE/Beine</T></th></tr></thead>
            <tbody>
              {days.map((d, i) => {
                const plan = sessions.filter((s) => s.date === d);
                const real = acts.filter((a) => a.date === d);
                const dl = byDate.get(d);
                const noted = real.filter((a) => (a.notes && a.notes.trim()) || (a.efforts && a.efforts.length));
                // Commutes/Allgemein (sport General) je Tag zu einer Zeile bündeln — spart Druckplatz (v0.14.0, ToDo 9).
                const general = real.filter((a) => a.sport === "General");
                const mainActs = real.filter((a) => a.sport !== "General");
                const genKm = round1(general.reduce((s, a) => s + (a.distance_m || 0) / 1000, 0));
                const genSec = general.reduce((s, a) => s + (a.moving_s || 0), 0);
                return [
                  <tr key={d} className={noted.length ? "has-note" : ""}>
                    <td className="nowrap"><strong>{DAY_NAMES[i]}</strong> <span className="muted tiny">{fmtDate(d)}</span></td>
                    <td style={{ textAlign: "center" }}>
                      {adhByDay[i].pct != null && (
                        <span title="Plan-Erfüllung (TSS-Treffer + Zeit in Ziel-Pace-Zone)"
                          style={{
                            display: "inline-block", minWidth: 34, padding: "2px 6px", borderRadius: 6,
                            fontSize: 11, fontWeight: 700, color: "#fff",
                            background: adhByDay[i].pct! >= 90 ? "var(--ok)" : adhByDay[i].pct! >= 70 ? "var(--warn)" : "var(--danger)",
                          }}>{adhByDay[i].pct}%</span>
                      )}
                    </td>
                    <td>{plan.map((p) => (
                      <div key={p.id}>
                        <span style={{ color: typeColor(p.type) }}>●</span> {p.description || typeLabel(p.type)}
                        <span className="muted tiny">{p.planned_km ? ` · ${p.planned_km} km` : p.planned_min ? ` · ${p.planned_min} min` : ""}</span>
                      </div>
                    ))}</td>
                    <td>{mainActs.map((a) => (
                      <div key={a.id}>
                        {a.name || sportLabel(a.sport)}
                        <span className="muted tiny">
                          {a.distance_m ? ` · ${round1(a.distance_m / 1000)} km` : ""}
                          {a.sport === "Run" && a.ngp ? ` · GAP ${paceStr(a.ngp)}` : ""}
                          {a.distance_m && a.moving_s ? ` · ${paceOrSpeed(a.sport, a.distance_m, a.moving_s)}` : ""}
                          {a.elevation ? ` · ${Math.round(a.elevation)} hm` : ""}
                          {a.avg_hr ? ` · Ø${Math.round(a.avg_hr)}` : ""}
                          {a.sport === "Run" && a.decoupling != null ? ` · Entk. ${a.decoupling > 0 ? "+" : ""}${a.decoupling}%` : ""}
                        </span>
                      </div>
                    ))}
                    {general.length > 0 && (
                      <div>
                        Commute{general.length > 1 ? ` ×${general.length}` : ""}
                        <span className="muted tiny">
                          {genKm ? ` · ${genKm} km` : ""}{genSec ? ` · ${fmtDur(genSec)}` : ""}
                        </span>
                      </div>
                    )}</td>
                    <td>{round1(real.reduce((s, a) => s + (a.distance_m || 0) / 1000, 0)) || ""}</td>
                    <td>{fmtIf(real.reduce((s, a) => s + (a.moving_s || 0), 0))}</td>
                    <td>{round1(real.reduce((s, a) => s + (a.tss || 0), 0)) || ""}</td>
                    <td>{Math.round(real.reduce((s, a) => s + (a.kcal || 0), 0)) || ""}</td>
                    <td className="tiny">{(dl?.rpe as number) ?? ""}{dl?.legs ? ` · ${dl.legs}` : ""}</td>
                  </tr>,
                  ...noted.map((a) => (
                    <tr key={`${a.id}-note`} className="note-row">
                      <td></td>
                      <td colSpan={8}>
                        {/* Einheiten-Name nur nennen, wenn mehrere Einheiten am Tag (sonst redundant) */}
                        {real.length > 1 && <span className="note-name">{a.name || sportLabel(a.sport)}: </span>}
                        {a.notes && a.notes.trim() ? a.notes.trim() : ""}
                        {a.efforts?.length ? <EffortTable efforts={a.efforts} /> : null}
                      </td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table></div>
          </div>
        )}</EgItem>

        {/* Efficiency Factor je Wochentag (DL/Longruns) — v0.14.0, ToDo 11 */}
        {efVals.length > 0 && (
          <EgItem id="ef" title={t("report.tile.ef", "Efficiency Factor")} defaultSpan={12} defaultHeight={150} reserve={100}>{() => (
            <div className="card tight mt">
              <div className="spread">
                <h3 style={{ margin: 0 }}><T k="report.ef.title">Efficiency Factor — DL &amp; Longruns</T> <span className="muted tiny">(<T k="report.ef.sub">NGP-Tempo / Ø-HF</T>)</span></h3>
                {efAvg != null && <span className="tiny muted"><T k="report.ef.avg">Ø Woche</T> {efAvg}</span>}
              </div>
              <div className="ef-strip mt">
                {efByDay.map((x) => (
                  <div key={x.date} className={"ef-cell" + (x.hardPrev ? " hard-prev" : "")}>
                    <div className="ef-day">{x.day}</div>
                    <div className="ef-val">{x.ef != null ? x.ef.toFixed(2) : "–"}</div>
                    {x.hardPrev && <div className="ef-mark" title={t("report.ef.hardPrev.title", "harte Einheit / Wettkampf am Vortag")}><T k="report.ef.hardPrev">⚡ hart davor</T></div>}
                  </div>
                ))}
              </div>
            </div>
          )}</EgItem>
        )}

        {/* Wettkämpfe der Woche (ToDo #24) — einzeln mit Splits */}
        {weekRaces.length > 0 && (
          <EgItem id="races" title={t("report.tile.races", "Wettkämpfe")} defaultSpan={12} defaultHeight={96}>{() => (
            <div className="card mt">
              <h3><T k="report.tile.races">Wettkämpfe</T></h3>
              {weekRaces.map((r) => {
                const km = (r.distance_m || 0) / 1000;
                const pace = km && r.time_s ? r.time_s / km : null;
                return (
                  <div key={r.id} className="race-block">
                    <div className="spread">
                      <strong>{r.name || "Wettkampf"} <span className="muted tiny">· {fmtDate(r.date)}</span></strong>
                      <span className="tiny">
                        {km ? `${km} km · ` : ""}{fmtClock(r.time_s)}{pace ? ` · ${paceStr(pace)}/km` : ""}{r.placement ? ` · Platz ${r.placement}` : ""}{r.avg_hr ? ` · Ø ${Math.round(r.avg_hr)} bpm` : ""}{r.max_hr ? ` · max ${Math.round(r.max_hr)} bpm` : ""}{r.elevation_m ? ` · ${Math.round(r.elevation_m)} hm` : ""}
                      </span>
                    </div>
                    {r.splits && r.splits.length > 0 && (
                      <table className="splits">
                        <thead><tr><th>km</th><th>Zeit</th><th>Pace</th><th>Ø-HF</th><th>Max-HF</th><th>Hm</th></tr></thead>
                        <tbody>{r.splits.map((s, i) => (
                          <tr key={i}><td>{s.km ?? "—"}</td><td>{fmtClock(s.time_s)}</td><td>{s.pace_s ? `${paceStr(s.pace_s)}/km` : "—"}</td><td>{s.avg_hr ?? "—"}</td><td>{s.max_hr ?? "—"}</td><td>{s.elevation_m ?? "—"}</td></tr>
                        ))}</tbody>
                      </table>
                    )}
                    {r.notes && <div className="tiny" style={{ marginTop: 4 }}>{r.notes}</div>}
                  </div>
                );
              })}
            </div>
          )}</EgItem>
        )}

        {/* Kern-Visualisierung — Balken & Donuts je eigene Karte, Schilder breit darunter (ToDo 8, v0.12.0) */}
        <EgItem id="zonedist" title={t("report.tile.zones", "Zonenverteilung")} defaultSpan={6} defaultHeight={220}>{() => (
            <div className="card chart-card">
              <h3 style={{ textAlign: "center" }}>
                <T k="report.zone.title">Zonenverteilung geplant vs. real</T>
              </h3>
              {analyze && <ZoneDistribution zones={analyze.zones} rows={[
                { name: t("report.tss.planned", "Geplant"), values: analyze.plannedZoneKm ?? analyze.totals.zoneMin },
                ...(hasRealZones ? [{ name: t("report.tss.real", "Real"), values: (analyze.realZoneKm && Object.values(analyze.realZoneKm).some((v) => (v || 0) > 0)) ? analyze.realZoneKm : realZoneMin }] : []),
              ]} />}
              {!hasRealZones && <p className="tiny muted"><T k="report.zone.noReal">Reale Zeit-in-Zone erscheint, sobald Aktivitäten mit Zonen-Minuten oder HF-Streams vorliegen.</T></p>}
            </div>
        )}</EgItem>

        {/* Intensität (TSS) geplant vs. real */}
        <EgItem id="tssdist" title={t("report.tile.tss", "Intensität (TSS)")} defaultSpan={6} defaultHeight={220}>{() => (
            <div className="card chart-card">
              <h3 style={{ textAlign: "center" }}>
                <T k="report.tss.title">TSS-Anteil nach Einheitstyp — geplant vs. real</T>
              </h3>
              <div className="tiny muted center" style={{ marginTop: -4, marginBottom: 4 }}>
                <T k="report.tss.sub">ergänzende Sicht; die Leit-Intensität ist die Zeit-in-Zone unten</T>
              </div>
              {analyze && (
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tiny muted center" style={{ marginBottom: 2 }}><T k="report.tss.planned">Geplant</T></div>
                    <IntensityDonut intensity={analyze.tssIntensity ?? analyze.totals.intensity}
                      center={{ value: Math.round(analyze.totals.tss), sub: "TSS" }} height={120} showLegend />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tiny muted center" style={{ marginBottom: 2 }}><T k="report.tss.real">Real</T></div>
                    <IntensityDonut intensity={analyze.realTssIntensity ?? { easy: 0, mod: 0, hard: 0 }}
                      center={{ value: Math.round(analyze.realTotalTss ?? 0), sub: "TSS" }} height={120} showLegend />
                  </div>
                </div>
              )}
            </div>
        )}</EgItem>

        {/* Physiologische Intensitätsverteilung + Polarisierungs-Index (G4, v1.3.0) */}
        {analyze?.physioDist && (
          <EgItem id="physiodist" title={t("report.tile.physio", "Intensitätsverteilung (LT1/LT2)")} defaultSpan={6} defaultHeight={220}>{() => (
            <PhysioDistTile pd={analyze.physioDist!} tgt={analyze.phaseTarget} pi={analyze.polarizationIndex} t={t} phase={analyze.week?.phase ?? null} onChanged={reload} />
          )}</EgItem>
        )}

        {/* Breite Karte: reale Analyse-Schilder (Wochen-Last + km-Polarisierung über die realen Werte) */}
        {analyze && (analyze.realLoadFlag || analyze.realKmFlag || analyze.monotonyFlag || analyze.realPolarizationFlag) && (
          <EgItem id="realflags" title={t("report.tile.realflags", "Bewertung der realen Woche")} defaultSpan={12} defaultHeight={96}>{() => (
            <div className="chart-card mt">
              <h3><T k="report.tile.realflags">Bewertung der realen Woche</T></h3>
              <div className="flag-row">
                {[analyze.realLoadFlag, analyze.realKmFlag, analyze.realPolarizationFlag, analyze.monotonyFlag].filter((f): f is NonNullable<typeof f> => !!f).map((f, i) => (
                  <div key={i} className={"flag " + f.level}><span className="dot" /><span>{renderFlag(f, t)}</span></div>
                ))}
              </div>
            </div>
          )}</EgItem>
        )}

        {/* PMC + Saison-Progression über die ganze Seitenbreite (ToDo Z.13) */}
        <EgItem id="pmc" title={t("report.tile.pmc", "PMC")} defaultSpan={12} defaultHeight={210}>{(h) => (
          <div className="chart-card mt">
            <h3><T k="report.tile.pmc">PMC</T> — {t("report.pmc.until", "bis")} {weekLabel(week)}</h3>
            <div className="pmc-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <Pmc data={pmcWin} height={h ?? 210} highlight={{ from: week.start_date, to: week.end_date }}
                  races={racesByDate} pbs={pbMarkers(bests?.pbs)} sickRanges={sickByDate} phaseRuns={pmcPhaseRuns} />
              </div>
              {/* Last-Kennzahlen am Wochenende (v0.14.0, ToDo 2) */}
              <div className="pmc-values">
                <Mini label={t("report.pmc.ctl", "Fitness (CTL)")} v={endPt ? Math.round(endPt.ctl) : "–"} cls="fitness" />
                <Mini label={t("report.pmc.atl", "Fatigue (ATL)")} v={endPt ? Math.round(endPt.atl) : "–"} cls="fatigue" />
                <Mini label={t("report.pmc.tsb", "Form (TSB)")} v={endPt ? signed(Math.round(endPt.tsb)) : "–"} cls="form" />
                <Mini label={t("report.pmc.ramp", "CTL-Ramp /Wo")} v={endRamp != null ? signed(endRamp) : "–"} />
              </div>
            </div>
          </div>
        )}</EgItem>

        {/* km & rTSS je Wochentag — eigene Kachel */}
        <EgItem id="weekday" title={t("report.tile.weekday", "km & rTSS je Wochentag")} defaultSpan={4} defaultHeight={210} reserve={80}>{(h) => (
            <div className="card chart-card">
              <h3><T k="report.tile.weekday">km &amp; rTSS je Wochentag</T></h3>
              <WeekdayBars days={days} acts={acts} bikeFactor={bikeFactor} height={h ?? 210} />
            </div>
        )}</EgItem>

        {/* Saison-Progression — eigene Kachel */}
        <EgItem id="season" title={t("report.tile.season", "Saison-Progression")} defaultSpan={8} defaultHeight={210} reserve={65}>{(h) => (
            <div className="card chart-card">
              <h3><T k="report.season.title">Saison-Progression (geplant / real km)</T></h3>
              <SeasonProgress rows={reportRows} height={h ?? 210} highlightLabel={weekLabel(week)}
                races={racesByWeek} sickLabels={sickLabels} showYears={false} />
            </div>
        )}</EgItem>

        {/* Whoop / Wellness Summary */}
        <EgItem id="wellness" title={t("report.tile.wellness", "Whoop / Wellness")} defaultSpan={12} defaultHeight={80} reserve={80}>{() => (
          <div className="card">
          <h3 className="mt"><T k="report.wellness.title">Whoop / Wellness (Ø Woche)</T></h3>
          <div className="row tiny" style={{ gap: 16, flexWrap: "wrap" }}>
            {WELLNESS_KEYS.map(([k, label]) => <Mini key={k} label={label} v={wellness[k] ?? ""} />)}
          </div>
          </div>
        )}</EgItem>

        {/* Wochen-Check — konfigurierbar in den Auswahllisten (ToDo 7) */}
        <EgItem id="check" title={t("report.tile.check", "Wochen-Check")} defaultSpan={12} defaultHeight={80} reserve={42}>{() => (
          <div className="card">
          <h3 className="mt"><T k="report.tile.check">Wochen-Check</T></h3>
          <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
            {checks.length === 0 && <span className="tiny muted"><T k="report.check.empty">Keine Checks definiert — in „Auswahllisten" anlegen.</T></span>}
            {checks.map((c) => (
              <label key={c.value} className="row tiny" style={{ gap: 5, width: "auto" }}>
                <input type="checkbox" style={{ width: "auto" }} checked={!!wlog.checks?.[c.value]} onChange={(e) => saveCheck(c.value, e.target.checked)} /> {c.label}
              </label>
            ))}
          </div>
          </div>
        )}</EgItem>

        {/* ============ SEITE 2: Tagesfaktoren ============ */}
        <EgItem id="daily" title={t("report.tile.daily", "Tagesfaktoren")} defaultSpan={12} defaultHeight={360}>{() => (
          <div className="card">
          <div className="report-head">
            <h2 style={{ margin: 0 }}><T k="report.tile.daily">Tagesfaktoren</T> — {weekLabel(week)}</h2>
            <div className="muted tiny">{fmtDateY(week.start_date)} – {fmtDateY(week.end_date)}</div>
          </div>

          <div className="table-scroll"><table className="daily-table mt">
            <thead>
              <tr>
                <th><T k="report.daily.col.factor">Faktor</T></th>
                {days.map((d, i) => <th key={d}>{DAY_NAMES[i]} <span className="muted">{fmtDate(d)}</span></th>)}
                <th>Ø</th>
              </tr>
            </thead>
            <tbody>
              {visibleMetrics.map((m) => {
                const vals = days.map((d) => byDate.get(d)?.[m.key]);
                const nums = vals.filter((v): v is number => typeof v === "number" && isFinite(v));
                return (
                  <tr key={m.key}>
                    <td className="nowrap"><strong>{m.label}</strong></td>
                    {vals.map((v, i) => <td key={days[i]}>{fmtVal(v)}</td>)}
                    <td className="muted">{!m.text && nums.length ? round1(nums.reduce((a, b) => a + b, 0) / nums.length) : ""}</td>
                  </tr>
                );
              })}
              {!visibleMetrics.length && <tr><td colSpan={9} className="muted center"><T k="report.daily.empty">Keine Tagesfaktoren eingetragen.</T></td></tr>}
            </tbody>
          </table></div>
          </div>
        )}</EgItem>

        {/* Wellness-Verläufe — jede Kennzahl als eigene, einzeln wählbare/anordenbare Kachel */}
        {wtrend.visible.map((m) => (
          <EgItem key={m.key} id={`wtrend-${m.key}`} title={m.title} defaultSpan={4} defaultHeight={120} reserve={42}>{(h) => (
            <div className="card chart-card tight">
              <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 2 }}>
                {m.title}
                {wellnessBands.has(m.key) && (() => { const b = wellnessBands.get(m.key)!; const fv = (v: number) => (m.fmt ? m.fmt(v) : String(Math.round(v * 10) / 10)); return <span style={{ fontWeight: 400 }}> · Normal {fv(b.lo)}–{fv(b.hi)}</span>; })()}
              </div>
              <WellnessTrendChart metric={m} points={wtrend.points} sleepRows={wtrend.sleepRows} height={h ?? 110} band={wellnessBands.get(m.key) ?? null} />
            </div>
          )}</EgItem>
        ))}

        {/* Reflexion */}
        <EgItem id="reflexion" title={t("report.tile.refl", "Reflexion")} defaultSpan={12} defaultHeight={170}>{() => (
          <div className="card">
          <h3 className="mt"><T k="report.tile.refl">Reflexion</T></h3>
          <div className="grid cols-2">
            <Refl label={t("report.refl.good", "Was lief gut?")} v={wlog.refl_good} on={(x) => saveW({ refl_good: x })} />
            <Refl label={t("report.refl.hard", "Was war schwierig?")} v={wlog.refl_hard} on={(x) => saveW({ refl_hard: x })} />
            <Refl label={t("report.refl.change", "Was ändere ich nächste Woche?")} v={wlog.refl_change} on={(x) => saveW({ refl_change: x })} />
            {REFLECT.map(([k, label]) => <Refl key={k} label={label} v={wlog.refl_extra?.[k]} on={(x) => saveRefl(k, x)} />)}
          </div>
          </div>
        )}</EgItem>
      </EditableGrid>
    </div>
  );
}

function Mini({ label, v, sub, cls }: { label: string; v: string | number; sub?: string; cls?: string }) {
  return <div className="stat"><div className="label">{label}</div><div className={"value" + (cls ? ` ${cls}` : "")} style={{ fontSize: 18 }}>{v === "" || v == null ? "–" : v}</div>{sub && <div className="sub">{sub}</div>}</div>;
}
// Item 1: schlanke Kategorie-Zeile — Label · Ist · geplant · dünne Erfüllungs-Bar. Kompakt, klinisch, designsicher.
// #10: Kategorie-Summe als kompakte Stat-Kachel (wie Langzeit) — Ist groß · „geplant …" · dünne Completion-Bar.
function CatStat({ label, value, planned, pct }: { label: string; value: string; planned: string; pct: number | null }) {
  const p = pct == null ? null : Math.max(0, Math.round(pct));
  const barCol = p == null ? "var(--muted)" : p >= 98 ? "var(--ok)" : p >= 70 ? "var(--accent)" : "var(--warn)";
  return (
    <div className="card stat cat-stat">
      <div className="label" title={label}>{label}</div>
      <div className="value">{value}</div>
      <div className="sub">{planned}</div>
      {p != null && (
        <div className="cat-bar" title={`${p}% vom Plan`}>
          <span style={{ width: `${Math.min(100, p)}%`, background: barCol }} />
        </div>
      )}
    </div>
  );
}
function Refl({ label, v, on }: { label: string; v?: string; on: (x: string) => void }) {
  return <label className="field"><span>{label}</span><textarea rows={2} defaultValue={v ?? ""} onBlur={(e) => on(e.target.value)} /></label>;
}

// Physiologische Intensitätsverteilung (G4, v1.3.0): Zeit-in-Zone Z1/Z2/Z3 (LT1/LT2-Grenzen) +
// Polarisierungs-Index (Treff et al. 2019) + Phasen-Soll. Self-contained, gestapelte Balken.
const PHYSIO_COL = { z1: "#22c55e", z2: "#f59e0b", z3: "#ef4444" } as const;
function PhysioStack({ vals, height = 24 }: { vals: { z1: number; z2: number; z3: number }; height?: number }) {
  const segs = [
    { k: "z1" as const, pct: vals.z1 }, { k: "z2" as const, pct: vals.z2 }, { k: "z3" as const, pct: vals.z3 },
  ];
  return (
    <div style={{ display: "flex", height, borderRadius: 6, overflow: "hidden", border: "1px solid #e3e8ef", background: "var(--surface2)" }}>
      {segs.map((s) => s.pct > 0 && (
        <div key={s.k} style={{ width: `${s.pct}%`, background: PHYSIO_COL[s.k], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", fontWeight: 600 }}>
          {s.pct >= 9 ? `${Math.round(s.pct)}%` : ""}
        </div>
      ))}
    </div>
  );
}
function PhysioDistTile({ pd, tgt, pi, t, phase, onChanged }: {
  pd: NonNullable<AnalyzeResult["physioDist"]>;
  tgt?: AnalyzeResult["phaseTarget"];
  pi?: number | null;
  t: (k: string, d: string) => string;
  phase?: string | null;       // T14: aktuelle Saison-Phase (für Override-Key)
  onChanged?: () => void;      // T14: Reload nach Override
}) {
  const [busy, setBusy] = useState(false);
  // T14: Verteilungs-Modell für DIESE Phase manuell überschreiben (oder auf Auto zurück). Merge-safe.
  async function setOverride(val: string) {
    if (!phase) return;
    setBusy(true);
    try {
      const cfg = await api.settings().catch(() => ({}));
      const cur: Record<string, string> = { ...(cfg?.phase_dist_overrides ?? {}) };
      const key = phase.toLowerCase();
      if (val === "auto") delete cur[key]; else cur[key] = val;
      await api.saveSettings({ phase_dist_overrides: cur });
      onChanged?.();
    } finally { setBusy(false); }
  }
  const zones = [
    { k: "z1" as const, lab: "Z1", desc: t("report.physio.z1", "< LT1 · aerob"), pct: pd.z1, min: pd.z1Min },
    { k: "z2" as const, lab: "Z2", desc: t("report.physio.z2", "LT1–LT2 · Schwelle"), pct: pd.z2, min: pd.z2Min },
    { k: "z3" as const, lab: "Z3", desc: t("report.physio.z3", "> LT2 · hart"), pct: pd.z3, min: pd.z3Min },
  ];
  const hasData = pd.z1 + pd.z2 + pd.z3 > 0;
  const polarized = pi != null && pi >= 2.0;
  return (
    <div className="card chart-card">
      <h3 style={{ textAlign: "center" }}>{t("report.physio.title", "Intensitätsverteilung (LT1/LT2)")}</h3>
      {!hasData ? (
        <p className="tiny muted">{t("report.physio.noData", "Reale Zeit-in-Zone erscheint, sobald Aktivitäten mit Zonen-Minuten oder HF-Streams vorliegen.")}</p>
      ) : (
        <>
          {/* Polarisierungs-Index */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0 10px" }}>
            <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{pi != null ? pi.toFixed(2) : "—"}</div>
            <div style={{ minWidth: 0 }}>
              <div className="tiny" style={{ fontWeight: 600, color: pi == null ? "#64748b" : polarized ? "#16a34a" : "#b45309" }}>
                {pi == null ? t("report.physio.piNa", "PI n/a") : polarized ? t("report.physio.polarized", "polarisiert") : t("report.physio.notPolarized", "nicht polarisiert")}
              </div>
              <div className="tiny muted">{t("report.physio.piLabel", "Polarisierungs-Index · ≥ 2,0 = polarisiert")}</div>
            </div>
          </div>
          {/* Ist */}
          <div className="tiny muted" style={{ marginBottom: 3 }}>{t("report.physio.real", "Real (Zeit-in-Zone)")}</div>
          <PhysioStack vals={pd} />
          {/* Soll + T14: Klartext-Begründung + Override pro Phase */}
          {tgt && (
            <>
              <div className="tiny muted" style={{ margin: "8px 0 3px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span>{t("report.physio.target", "Phasen-Soll")} · {tgt.label}{tgt.overridden ? " (manuell)" : ""}</span>
                {phase && (
                  <select className="tiny" disabled={busy} value={tgt.overridden ? tgt.model : "auto"}
                    onChange={(e) => setOverride(e.target.value)}
                    title={t("report.physio.overrideHint", "Verteilungs-Modell für diese Phase festlegen (Auto = aus Saison-Phase abgeleitet)")}
                    style={{ width: "auto", padding: "1px 4px", fontSize: 11 }}>
                    <option value="auto">Auto</option>
                    <option value="pyramidal">pyramidal</option>
                    <option value="polarized">polarisiert</option>
                    <option value="regenerativ">regenerativ</option>
                  </select>
                )}
              </div>
              <PhysioStack vals={tgt} height={16} />
              {tgt.rationale && <div className="tiny muted" style={{ marginTop: 4, lineHeight: 1.4 }}>{tgt.rationale}</div>}
            </>
          )}
          {/* Legende mit Minuten */}
          <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
            {zones.map((z) => (
              <span key={z.k} className="tiny" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span className="dot" style={{ background: PHYSIO_COL[z.k] }} />
                <b>{z.lab}</b> {z.desc} · {Math.round(z.pct)}% ({Math.round(z.min)} min)
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---- Helfer ----
function round1(n: number) { return Math.round(n * 10) / 10; }
function signed(n: number): string { return n > 0 ? `+${n}` : `${n}`; }
// Efficiency Factor (v0.14.0, ToDo 11): NGP-Tempo (m/min) / Ø-HF. ngp ist s/km → 60000/ngp = m/min.
function efOf(a: Activity): number | null {
  if (a.sport !== "Run" || !a.ngp || !a.avg_hr) return null;
  return Math.round(((60000 / a.ngp) / a.avg_hr) * 100) / 100;
}
// „normale DL" + Longrun + untypisiert (moderate/harte Typen wie Steady/LT2/VO2 ausgeschlossen).
function isEasyRunType(t?: string | null): boolean {
  return !t || t === "Easy" || t === "Long";
}
function hours(min: number): string { return min > 0 ? fmtDur(min * 60) : "–"; }
function fmtIf(sec: number): string { return sec > 0 ? fmtDur(sec) : ""; }
function hasVal(v: unknown): boolean { return v != null && v !== "" && !(typeof v === "number" && isNaN(v)); }
function fmtVal(v: unknown): string {
  if (!hasVal(v)) return "";
  if (typeof v === "number") return String(round1(v));
  return String(v);
}

function fmtClock(s?: number | null): string {
  if (s == null) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

function isBikeCat(sport?: string | null): boolean {
  return !!sport && (sport.startsWith("Bike") || sport === "General");
}
function catsFromActs(acts: Activity[]): Cat {
  const out: Cat = { run: { km: 0, min: 0 }, bike: { km: 0, min: 0 }, strength: { min: 0 } };
  for (const a of acts) {
    const km = (a.distance_m || 0) / 1000;
    const min = (a.moving_s || a.elapsed_s || 0) / 60;
    if (a.sport === "Run") { out.run.km += km; out.run.min += min; }
    else if (isBikeCat(a.sport)) { out.bike.km += km; out.bike.min += min; }
    else if (a.sport === "Strength" || a.sport === "Physio") out.strength.min += min;
  }
  return out;
}
function catsFromPlan(sessions: PlannedSession[]): Cat {
  const out: Cat = { run: { km: 0, min: 0 }, bike: { km: 0, min: 0 }, strength: { min: 0 } };
  for (const s of sessions) {
    // Item 4: km-Fallback aus zone_alloc.byKm, falls planned_km (z. B. bei Vorschlägen) fehlt.
    const byKm = (s as { zone_alloc?: { byKm?: Record<number, number> } }).zone_alloc?.byKm;
    const km = s.planned_km ?? (byKm ? Object.values(byKm).reduce((a, b) => a + (Number(b) || 0), 0) : 0);
    const min = s.planned_min || 0;
    if (s.sport === "Run") { out.run.km += km; out.run.min += min; }
    else if (isBikeCat(s.sport)) { out.bike.km += km; out.bike.min += min; }
    else if (s.sport === "Strength" || s.sport === "Physio") out.strength.min += min;
  }
  return out;
}

/** Belastungen (Intervalle) zu Tabellen-Zeilen flach machen: Länge · Zeit · Pace · Ø-HF · max-HF.
 *  Gruppen (z. B. 3×(1000m + 200m)) werden rekursiv expandiert, der Gruppen-Faktor als Präfix vererbt. */
interface EffRow { label: string; len: string; time: string; pace: string; avg: string; max: string; }
function effortRows(efforts: Effort[], prefix = ""): EffRow[] {
  const out: EffRow[] = [];
  for (const e of efforts) {
    const reps = e.reps && e.reps > 1 ? `${e.reps}× ` : "";
    if (e.group) { out.push(...effortRows(e.children ?? [], `${prefix}${reps}`)); continue; }
    const label = `${prefix}${reps}${e.label ?? ""}`.trim();
    out.push({
      label,
      len: e.dist_m ? (e.dist_m >= 1000 ? `${round1(e.dist_m / 1000)} km` : `${e.dist_m} m`) : "",
      time: e.sec ? fmtClock(e.sec) : "",
      pace: e.pace_s ? `${paceStr(e.pace_s)}/km` : "",
      avg: e.avg_hr ? `${Math.round(e.avg_hr)}` : "",
      max: e.max_hr ? `${Math.round(e.max_hr)}` : "",
    });
  }
  return out;
}

/** Mini-Tabelle der Intervall-Splits (im Wochenbericht unter der jeweiligen Einheit).
 *  Spalte „#" = fortlaufende Nummer; ab 6 Intervallen zwei Tabellen nebeneinander (Platz sparen). */
function EffortTable({ efforts }: { efforts: Effort[] }) {
  const rows = effortRows(efforts);
  if (!rows.length) return null;
  const split = rows.length >= 4;
  const mid = split ? Math.ceil(rows.length / 2) : rows.length;
  const groups = split ? [rows.slice(0, mid), rows.slice(mid)] : [rows];
  return (
    <div className="effort-wrap">
      {groups.map((g, gi) => (
        <table className="effort-mini" key={gi}>
          <thead><tr><th>#</th><th>Länge</th><th>Zeit</th><th>Pace</th><th>Ø-HF</th><th>max-HF</th></tr></thead>
          <tbody>
            {g.map((r, i) => {
              const n = (gi === 0 ? 0 : mid) + i + 1;
              return (
                <tr key={n}>
                  <td className="lbl">{n}</td><td>{r.len || "–"}</td><td>{r.time || "–"}</td>
                  <td>{r.pace || "–"}</td><td>{r.avg || "–"}</td><td>{r.max || "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
    </div>
  );
}

function avgWellness(daily: DailyLog[]): Record<string, number | ""> {
  const out: Record<string, number | ""> = {};
  for (const [k] of WELLNESS_KEYS) {
    const vals = daily.map((d) => d[k] as number).filter((x) => x != null && typeof x === "number" && !isNaN(x));
    out[k] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : "";
  }
  return out;
}
