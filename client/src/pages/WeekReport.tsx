// Wochenbericht — Druck-Layout auf 2 Seiten (ToDo „Auswertung zeigt 2x ziemlich dasselbe"):
// Seite 1: Kopf · Kategorie-Summen · Einheiten geplant/real (mit Aktivitäts-Notizen) ·
//          Kern-Visualisierung (Zonen, Intensität, PMC ±6 Wochen, Saison-Progression) · Wellness-Ø · Wochen-Checks.
// Seite 2: vollständige Tagesfaktoren-Tabelle · Wellness-Verläufe · Reflexion.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  api, type PlannedSession, type Activity, type DailyLog, type AnalyzeResult, type PmcPoint, type Effort, type Race,
} from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import {
  DAY_NAMES, daysOfWeek, fmtDate, fmtDateY, typeLabel, typeColor, sportLabel, paceStr, paceOrSpeed,
  fmtDur, weekLabel, phaseLabel, addDays,
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
import EditableGrid, { EgItem } from "../components/EditableGrid.tsx";

const REFLECT: [string, string][] = [
  ["adherence", "Plan-Treue (% umgesetzt)"], ["progress", "Fortschritt ggü. Vorwoche"],
  ["highlight", "Highlight / Win der Woche"], ["pain", "Schmerzen / Niggles / Verletzungsrisiko"],
  ["recovery_strategies", "Genutzte Recovery-Strategien"], ["fueling", "Ernährung / Fueling / Gewicht"],
  ["mental", "Mentale Frische / Stress (Studium/Job)"], ["confidence", "Confidence Richtung Saisonziel"],
  ["lessons", "Lessons → Anpassung Folgewoche"],
];

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
  const [analyze, setAnalyze] = useState<AnalyzeResult | null>(null);
  const [wlog, setWlog] = useState<any>({});
  const [pmcWin, setPmcWin] = useState<PmcPoint[]>([]);
  const [seasonRows, setSeasonRows] = useState<SeasonRow[]>([]);
  const [allSessions, setAllSessions] = useState<PlannedSession[]>([]);
  const [allRaces, setAllRaces] = useState<Race[]>([]);
  const [bikeFactor, setBikeFactor] = useState(0.25); // Rad-km → Lauf-km (Wochentags-Chart, ToDo Z.9)
  const yearStart = `${new Date().getUTCFullYear()}-01-01`; // Bericht-Charts ab 1.1. (ToDo #8)

  async function reload() {
    if (!week) return;
    const [s, a, d, an, w] = await Promise.all([
      api.sessions({ week: week.week_no }),
      api.activities({ from: week.start_date, to: week.end_date }),
      api.daily({ from: week.start_date, to: week.end_date }),
      api.analyzeWeek(week.week_no),
      api.weeklog(week.week_no),
    ]);
    setSessions(s); setActs(a); setDaily(d); setAnalyze(an); setWlog(w || {});
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

  if (loading) return <p className="muted">Lädt…</p>;
  if (!week) return <div className="empty">Keine Woche.</div>;

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

  const wellness = avgWellness(daily);
  const wtrend = wellnessTrendData(daily, days);
  const saveW = (patch: Record<string, unknown>) => { const n = { ...wlog, ...patch }; setWlog(n); api.saveWeeklog(week.week_no, n); };
  const saveCheck = (k: string, val: boolean) => saveW({ checks: { ...(wlog.checks || {}), [k]: val } });
  const saveRefl = (k: string, val: string) => saveW({ refl_extra: { ...(wlog.refl_extra || {}), [k]: val } });

  const byDate = new Map(daily.map((d) => [d.date, d]));
  const visibleMetrics = DAY_METRICS.filter((m) => days.some((d) => hasVal(byDate.get(d)?.[m.key])));

  return (
    <div>
      <div className="spread no-print">
        <h1>Wochenbericht</h1>
        <div className="row">
          <WeekSelector season={season} weekNo={weekNo} setWeekNo={setWeekNo}
            jumpTo={{ href: `/track?date=${week.start_date}`, title: "Zur gleichen Woche im Tracking", label: "→ Tracking" }} />
          <button className="primary" onClick={() => window.print()}>🖨 Drucken / PDF</button>
        </div>
      </div>

      <EditableGrid page="weekreport" paged>
        {/* Kopf */}
        <EgItem id="head" title="Kopf" defaultSpan={12} defaultHeight={68} reserve={100}>{() => (
          <div className="card spread report-head">
            <div>
              <h2 style={{ margin: 0 }}>{weekLabel(week)} — {phaseLabel(week.phase)}</h2>
              <div className="muted tiny">
                {fmtDateY(week.start_date)} – {fmtDateY(week.end_date)} · Ziel {week.target_km ?? "–"} km
                {week.goal_race ? ` · ${week.goal_race}` : ""}{week.notes ? ` · ${week.notes}` : ""}
              </div>
            </div>
            <div className="row" style={{ gap: 18 }}>
              <Mini label="Lauf" v={`${actualKm} km`} sub={`Ziel ${week.target_km ?? "–"}`} />
              <Mini label="TSS" v={`${Math.round(actualTss)}`} />
              <Mini label="Form (TSB)" v={`${analyze?.projectedTsb ?? "–"}`} />
            </div>
          </div>
        )}</EgItem>

        {/* Kategorie-Summen: Lauf / Rad gesamt / Kraft & Mobility */}
        <EgItem id="cats" title="Kategorie-Summen" defaultSpan={12} defaultHeight={86}>{() => (
          <div className="card cat-row mt">
            <CatBox label="Lauf" main={`${round1(realCat.run.km)} km · ${hours(realCat.run.min)}`}
              sub={`geplant ${round1(plannedCat.run.km)} km · ${hours(plannedCat.run.min)}`} />
            <CatBox label="Rad gesamt (indoor + outdoor + Commute)" main={`${round1(realCat.bike.km)} km · ${hours(realCat.bike.min)}`}
              sub={`geplant ${round1(plannedCat.bike.km)} km · ${hours(plannedCat.bike.min)}`} />
            <CatBox label="Kraft / Mobility" main={hours(realCat.strength.min)}
              sub={`geplant ${hours(plannedCat.strength.min)}`} />
          </div>
        )}</EgItem>

        {/* Einheiten geplant vs. real — Notizen als gedämpfte Zeile unter jeder Einheit */}
        <EgItem id="units" title="Einheiten" defaultSpan={12} defaultHeight={420}>{() => (
          <div className="card">
          <div className="spread mt">
            <h3 style={{ margin: 0 }}>Einheiten</h3>
            {hasAdh && adh?.weekPct != null && (
              <span className="tiny muted">Plan-Erfüllung Ø Woche {adh.weekPct}% <span className="muted">(TSS-Treffer + Zeit in Ziel-Pace-Zone)</span></span>
            )}
          </div>
          <div className="table-scroll"><table className="units">
            <thead><tr><th>Tag</th><th>Plan-Erf.</th><th>Geplant</th><th>Real</th><th>km</th><th>Zeit</th><th>TSS</th><th>kcal</th><th>RPE/Beine</th></tr></thead>
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
                            background: adhByDay[i].pct! >= 90 ? "var(--ok)" : adhByDay[i].pct! >= 70 ? "var(--form)" : "var(--danger)",
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
          <EgItem id="ef" title="Efficiency Factor" defaultSpan={12} defaultHeight={150} reserve={100}>{() => (
            <div className="card tight mt">
              <div className="spread">
                <h3 style={{ margin: 0 }}>Efficiency Factor — DL &amp; Longruns <span className="muted tiny">(NGP-Tempo / Ø-HF)</span></h3>
                {efAvg != null && <span className="tiny muted">Ø Woche {efAvg}</span>}
              </div>
              <div className="ef-strip mt">
                {efByDay.map((x) => (
                  <div key={x.date} className={"ef-cell" + (x.hardPrev ? " hard-prev" : "")}>
                    <div className="ef-day">{x.day}</div>
                    <div className="ef-val">{x.ef != null ? x.ef.toFixed(2) : "–"}</div>
                    {x.hardPrev && <div className="ef-mark" title="harte Einheit / Wettkampf am Vortag">⚡ hart davor</div>}
                  </div>
                ))}
              </div>
            </div>
          )}</EgItem>
        )}

        {/* Wettkämpfe der Woche (ToDo #24) — einzeln mit Splits */}
        {weekRaces.length > 0 && (
          <EgItem id="races" title="Wettkämpfe" defaultSpan={12} defaultHeight={96}>{() => (
            <div className="card mt">
              <h3>Wettkämpfe</h3>
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
        <EgItem id="zonedist" title="Zonenverteilung" defaultSpan={6} defaultHeight={220}>{() => (
            <div className="card chart-card">
              <h3 style={{ textAlign: "center" }}>
                Zonenverteilung geplant vs. real
              </h3>
              {analyze && <ZoneDistribution zones={analyze.zones} rows={[
                { name: "Geplant", values: analyze.plannedZoneKm ?? analyze.totals.zoneMin },
                ...(hasRealZones ? [{ name: "Real", values: (analyze.realZoneKm && Object.values(analyze.realZoneKm).some((v) => (v || 0) > 0)) ? analyze.realZoneKm : realZoneMin }] : []),
              ]} />}
              {!hasRealZones && <p className="tiny muted">Reale Zeit-in-Zone erscheint, sobald Aktivitäten mit Zonen-Minuten oder HF-Streams vorliegen.</p>}
            </div>
        )}</EgItem>

        {/* Intensität (TSS) geplant vs. real */}
        <EgItem id="tssdist" title="Intensität (TSS)" defaultSpan={6} defaultHeight={220}>{() => (
            <div className="card chart-card">
              <h3 style={{ textAlign: "center" }}>
                Intensität (TSS) — geplant vs. real
              </h3>
              {analyze && (
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tiny muted center" style={{ marginBottom: 2 }}>Geplant</div>
                    <IntensityDonut intensity={analyze.tssIntensity ?? analyze.totals.intensity}
                      center={{ value: Math.round(analyze.totals.tss), sub: "TSS" }} height={120} showLegend />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tiny muted center" style={{ marginBottom: 2 }}>Real</div>
                    <IntensityDonut intensity={analyze.realTssIntensity ?? { easy: 0, mod: 0, hard: 0 }}
                      center={{ value: Math.round(analyze.realTotalTss ?? 0), sub: "TSS" }} height={120} showLegend />
                  </div>
                </div>
              )}
            </div>
        )}</EgItem>

        {/* Breite Karte: reale Analyse-Schilder (Wochen-Last + km-Polarisierung über die realen Werte) */}
        {analyze && (analyze.realLoadFlag || analyze.realKmFlag) && (
          <EgItem id="realflags" title="Bewertung der realen Woche" defaultSpan={12} defaultHeight={96}>{() => (
            <div className="chart-card mt">
              <h3>Bewertung der realen Woche</h3>
              <div className="flag-row">
                {[analyze.realLoadFlag, analyze.realKmFlag].filter((f): f is NonNullable<typeof f> => !!f).map((f, i) => (
                  <div key={i} className={"flag " + f.level}><span className="dot" /><span>{f.message}</span></div>
                ))}
              </div>
            </div>
          )}</EgItem>
        )}

        {/* PMC + Saison-Progression über die ganze Seitenbreite (ToDo Z.13) */}
        <EgItem id="pmc" title="PMC" defaultSpan={12} defaultHeight={210}>{(h) => (
          <div className="chart-card mt">
            <h3>PMC — bis {weekLabel(week)}</h3>
            <div className="pmc-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <Pmc data={pmcWin} height={h ?? 210} highlight={{ from: week.start_date, to: week.end_date }}
                  races={racesByDate} sickRanges={sickByDate} phaseRuns={pmcPhaseRuns} />
              </div>
              {/* Last-Kennzahlen am Wochenende (v0.14.0, ToDo 2) */}
              <div className="pmc-values">
                <Mini label="Fitness (CTL)" v={endPt ? Math.round(endPt.ctl) : "–"} cls="fitness" />
                <Mini label="Fatigue (ATL)" v={endPt ? Math.round(endPt.atl) : "–"} cls="fatigue" />
                <Mini label="Form (TSB)" v={endPt ? signed(Math.round(endPt.tsb)) : "–"} cls="form" />
                <Mini label="CTL-Ramp /Wo" v={endRamp != null ? signed(endRamp) : "–"} />
              </div>
            </div>
          </div>
        )}</EgItem>

        {/* km & rTSS je Wochentag — eigene Kachel */}
        <EgItem id="weekday" title="km & rTSS je Wochentag" defaultSpan={4} defaultHeight={210} reserve={80}>{(h) => (
            <div className="card chart-card">
              <h3>km &amp; rTSS je Wochentag</h3>
              <WeekdayBars days={days} acts={acts} bikeFactor={bikeFactor} height={h ?? 210} />
            </div>
        )}</EgItem>

        {/* Saison-Progression — eigene Kachel */}
        <EgItem id="season" title="Saison-Progression" defaultSpan={8} defaultHeight={210} reserve={65}>{(h) => (
            <div className="card chart-card">
              <h3>Saison-Progression (geplant / real km)</h3>
              <SeasonProgress rows={reportRows} height={h ?? 210} highlightLabel={weekLabel(week)}
                races={racesByWeek} sickLabels={sickLabels} showYears={false} />
            </div>
        )}</EgItem>

        {/* Whoop / Wellness Summary */}
        <EgItem id="wellness" title="Whoop / Wellness" defaultSpan={12} defaultHeight={80} reserve={80}>{() => (
          <div className="card">
          <h3 className="mt">Whoop / Wellness (Ø Woche)</h3>
          <div className="row tiny" style={{ gap: 16, flexWrap: "wrap" }}>
            {WELLNESS_KEYS.map(([k, label]) => <Mini key={k} label={label} v={wellness[k] ?? ""} />)}
          </div>
          </div>
        )}</EgItem>

        {/* Wochen-Check — konfigurierbar in den Auswahllisten (ToDo 7) */}
        <EgItem id="check" title="Wochen-Check" defaultSpan={12} defaultHeight={80} reserve={42}>{() => (
          <div className="card">
          <h3 className="mt">Wochen-Check</h3>
          <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
            {checks.length === 0 && <span className="tiny muted">Keine Checks definiert — in „Auswahllisten" anlegen.</span>}
            {checks.map((c) => (
              <label key={c.value} className="row tiny" style={{ gap: 5, width: "auto" }}>
                <input type="checkbox" style={{ width: "auto" }} checked={!!wlog.checks?.[c.value]} onChange={(e) => saveCheck(c.value, e.target.checked)} /> {c.label}
              </label>
            ))}
          </div>
          </div>
        )}</EgItem>

        {/* ============ SEITE 2: Tagesfaktoren ============ */}
        <EgItem id="daily" title="Tagesfaktoren" defaultSpan={12} defaultHeight={360}>{() => (
          <div className="card">
          <div className="report-head">
            <h2 style={{ margin: 0 }}>Tagesfaktoren — {weekLabel(week)}</h2>
            <div className="muted tiny">{fmtDateY(week.start_date)} – {fmtDateY(week.end_date)}</div>
          </div>

          <div className="table-scroll"><table className="daily-table mt">
            <thead>
              <tr>
                <th>Faktor</th>
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
              {!visibleMetrics.length && <tr><td colSpan={9} className="muted center">Keine Tagesfaktoren eingetragen.</td></tr>}
            </tbody>
          </table></div>
          </div>
        )}</EgItem>

        {/* Wellness-Verläufe — jede Kennzahl als eigene, einzeln wählbare/anordenbare Kachel */}
        {wtrend.visible.map((m) => (
          <EgItem key={m.key} id={`wtrend-${m.key}`} title={m.title} defaultSpan={4} defaultHeight={120} reserve={42}>{(h) => (
            <div className="card chart-card tight">
              <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 2 }}>{m.title}</div>
              <WellnessTrendChart metric={m} points={wtrend.points} sleepRows={wtrend.sleepRows} height={h ?? 110} />
            </div>
          )}</EgItem>
        ))}

        {/* Reflexion */}
        <EgItem id="reflexion" title="Reflexion" defaultSpan={12} defaultHeight={170}>{() => (
          <div className="card">
          <h3 className="mt">Reflexion</h3>
          <div className="grid cols-2">
            <Refl label="Was lief gut?" v={wlog.refl_good} on={(x) => saveW({ refl_good: x })} />
            <Refl label="Was war schwierig?" v={wlog.refl_hard} on={(x) => saveW({ refl_hard: x })} />
            <Refl label="Was ändere ich nächste Woche?" v={wlog.refl_change} on={(x) => saveW({ refl_change: x })} />
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
function CatBox({ label, main, sub }: { label: string; main: string; sub?: string }) {
  return (
    <div className="cat-box">
      <div className="label">{label}</div>
      <div className="main">{main}</div>
      {sub && <div className="sub muted tiny">{sub}</div>}
    </div>
  );
}
function Refl({ label, v, on }: { label: string; v?: string; on: (x: string) => void }) {
  return <label className="field"><span>{label}</span><textarea rows={2} defaultValue={v ?? ""} onBlur={(e) => on(e.target.value)} /></label>;
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
    const km = s.planned_km || 0;
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
