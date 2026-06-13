// Langzeit-Übersicht (#79): Entwicklung über Monate statt einer Woche.
// Oben groß PMC + Saison-Progression (geplant vs. gelaufen), beide am Seiten-Zeitraum,
// dann: (a) Wellness-Verläufe als kleine Multiples (HRV, Ruhepuls, Recovery, Strain, Schlaf,
//     Bettzeit als Uhrzeit, Sleep-Performance, Gewicht),
// (b) Zonen-Effizienz: Ø-Pace vs. Ø-HF der Easy-Läufe (Wochenmittel) + Effizienz-Faktor,
// (c) Intervall-Trend nach Kategorie (LT1 / LT2 / VO2) — Chart wiederverwendet.
// Zeitraum über RangeSelector (Default 6 Monate); „Drucken/PDF" druckt den eingestellten Zeitraum.
import { useEffect, useState } from "react";
import {
  ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { api, type DailyLog, type Activity, type IntervalEffortStat, type PmcPoint } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import { fmtDate, fmtDateY, paceStr, addDays, todayIso, weekLabel } from "../lib/util.ts";
import RangeSelector, { type DateRange } from "../charts/RangeSelector.tsx";
import IntervalTrend, { hasRunTrend } from "../charts/IntervalTrend.tsx";
import { bedDeviation, devToClock } from "../charts/WellnessTrends.tsx";
import Pmc from "../charts/Pmc.tsx";
import SeasonProgress, { buildSeasonRows, type SeasonRow } from "../charts/SeasonProgress.tsx";

// ---- Wellness-Metriken (kleine Multiples) ----
type Fmt = (v: number) => string;
const METRICS: { key: string; title: string; color: string; fmt?: Fmt; refY?: number; refLabel?: string }[] = [
  { key: "hrv", title: "HRV (ms)", color: "#2b6cb0" },
  { key: "resting_hr", title: "Ruhepuls (bpm)", color: "#d53f8c" },
  { key: "recovery", title: "Recovery (%)", color: "#16a34a" },
  { key: "strain", title: "Strain", color: "#f97316" },
  { key: "sleep_h", title: "Schlaf (h)", color: "#6366f1", fmt: (v) => v.toFixed(1) },
  { key: "bed_dev", title: "Bettzeit (Uhrzeit)", color: "#0891b2", fmt: devToClock, refY: 0, refLabel: "23:30" },
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
  const [range, setRange] = useState<DateRange | null>(null);
  const [daily, setDaily] = useState<DailyLog[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [trend, setTrend] = useState<IntervalEffortStat[] | null>(null);
  const [pmc, setPmc] = useState<PmcPoint[]>([]);
  const [rows, setRows] = useState<SeasonRow[]>([]);

  const seasonRange: DateRange | null = season.length
    ? { from: season[0].start_date, to: maxDate(season[season.length - 1].end_date, todayIso()) }
    : null;

  useEffect(() => {
    if (!range) return;
    api.daily({ from: range.from, to: range.to }).then(setDaily).catch(() => setDaily([]));
    api.activities({ from: range.from, to: range.to }).then(setActs).catch(() => setActs([]));
    api.intervalsTrend({ from: range.from, to: range.to }).then(setTrend).catch(() => setTrend(null));
    api.pmc(range.from, range.to).then((r) => setPmc(r.pmc)).catch(() => setPmc([]));
  }, [range?.from, range?.to]);

  // Saison-Zeilen einmal über die ganze Saison bauen (wie Dashboard); Anzeige per Zeitraum gefiltert.
  useEffect(() => {
    if (!season.length) return;
    const from = season[0].start_date;
    const to = season[season.length - 1].end_date;
    Promise.all([api.sessions({}), api.activities({ from, to })])
      .then(([sessions, all]) => setRows(buildSeasonRows(season, sessions, all)))
      .catch(() => setRows([]));
  }, [season]);

  const visibleRows = range
    ? rows.filter((r) => (!r.end || r.end >= range.from) && (!r.start || r.start <= range.to))
    : rows;
  const points = wellnessPoints(daily);
  const visibleMetrics = METRICS.filter((m) => points.some((p) => p[m.key] != null));
  const eff = easyRunWeeks(acts);
  const effPaces = eff.map((e) => e.pace).filter((x): x is number => x != null);
  const paceDomain: [number, number] = effPaces.length
    ? [Math.floor((Math.min(...effPaces) - 15) / 15) * 15, Math.ceil((Math.max(...effPaces) + 15) / 15) * 15]
    : [240, 480];

  return (
    <div>
      <div className="spread">
        <div>
          <h1 className="lt-title" style={{ marginBottom: 2 }}>Langzeit-Übersicht</h1>
          {range && <span className="tiny muted">Zeitraum: {fmtDateY(range.from)} – {fmtDateY(range.to)}</span>}
        </div>
        <div className="row no-print" style={{ width: "auto", gap: 8 }}>
          <RangeSelector seasonRange={seasonRange} onChange={setRange} defaultMode="6m" />
          <button onClick={() => window.print()}>🖨 Drucken / PDF</button>
        </div>
      </div>

      {/* PMC über den gewählten Zeitraum */}
      <div className="card">
        <div className="spread"><h2>Performance Management Chart</h2><span className="tiny muted">Fitness · Fatigue · Form (geplant rechts von „heute")</span></div>
        <Pmc data={pmc} />
      </div>

      {/* Saison-Progression (geplant vs. gelaufen) über den gewählten Zeitraum */}
      <div className="card">
        <div className="spread"><h2>Saison-Progression</h2><span className="tiny muted">Ziel · geplant · gelaufen (km je Woche)</span></div>
        <SeasonProgress rows={visibleRows} highlightLabel={week ? weekLabel(week) : undefined} />
      </div>

      {/* (a) Wellness-Verläufe */}
      <div className="card">
        <div className="spread">
          <h2>Wellness-Verläufe</h2>
          <span className="tiny muted">Tageswerte aus dem Tracking — HRV · Ruhepuls · Recovery · Strain · Schlaf · Bettzeit · Sleep-Performance · Gewicht</span>
        </div>
        {!visibleMetrics.length && <p className="muted tiny">Keine Tagesfaktoren im gewählten Zeitraum.</p>}
        <div className="wellness-grid">
          {visibleMetrics.map((m) => (
            <div key={m.key} className="chart-card tight">
              <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 2 }}>{m.title}</div>
              <ResponsiveContainer width="100%" height={110}>
                <LineChart data={points} margin={{ top: 6, right: 8, left: -10, bottom: -4 }}>
                  <CartesianGrid stroke="#eef1f5" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={32} tick={{ fontSize: 10, fill: "#8a96a6" }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#8a96a6" }} width={44} domain={["auto", "auto"]}
                    tickFormatter={(v: number) => (m.fmt ? m.fmt(v) : String(Math.round(v * 10) / 10))}
                  />
                  <Tooltip
                    labelFormatter={(d) => fmtDate(String(d))}
                    formatter={(v: number) => [m.fmt ? m.fmt(v) : Math.round(v * 10) / 10, m.title]}
                    contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }}
                  />
                  {m.refY != null && (
                    <ReferenceLine y={m.refY} stroke="#cbd5e1" strokeDasharray="3 4"
                      label={{ value: m.refLabel, fontSize: 9, fill: "#94a3b8", position: "right" }} />
                  )}
                  <Line type="monotone" dataKey={m.key} stroke={m.color} strokeWidth={1.6}
                    dot={{ r: 1.8, fill: m.color, strokeWidth: 0 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      </div>

      {/* (b) Zonen-Effizienz */}
      <div className="card">
        <div className="spread">
          <h2>Zonen-Effizienz (Easy-Läufe)</h2>
        </div>
        {!eff.length && <p className="muted tiny">Keine Lauf-Aktivitäten im gewählten Zeitraum.</p>}
        {eff.length > 0 && (
          <div className="grid cols-2" style={{ alignItems: "start" }}>
            <div className="chart-card">
              <h3>Ø-Pace vs. Ø-Herzfrequenz</h3>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={eff} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#eef1f5" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={28} tick={{ fontSize: 11, fill: "#8a96a6" }} />
                  <YAxis yAxisId="pace" reversed domain={paceDomain} tickFormatter={(v: number) => paceStr(v)}
                    width={44} tick={{ fontSize: 11, fill: "#8a96a6" }} />
                  <YAxis yAxisId="hr" orientation="right" domain={["auto", "auto"]} width={34}
                    tick={{ fontSize: 11, fill: "#d53f8c" }} />
                  <Tooltip
                    labelFormatter={(d) => `Woche ab ${fmtDate(String(d))}`}
                    formatter={(v: number, n: string) => (n === "Ø-Pace" ? [`${paceStr(v)} /km`, n] : [Math.round(v), n])}
                    contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="pace" type="monotone" dataKey="pace" name="Ø-Pace" stroke="#2b6cb0"
                    strokeWidth={1.8} connectNulls dot={{ r: 3, fill: "#2b6cb0", strokeWidth: 0 }} />
                  <Line yAxisId="hr" type="monotone" dataKey="hr" name="Ø-HF" stroke="#d53f8c"
                    strokeWidth={1.8} connectNulls dot={{ r: 3, fill: "#d53f8c", strokeWidth: 0 }} />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="tiny muted" style={{ margin: "6px 0 0" }}>
                Wochenmittel aller lockeren Läufe (ohne Intervall-Belastungen) sinkende Pace bei gleichem Puls = bessere Ökonomie
              </p>
            </div>
            <div className="chart-card">
              <h3>Effizienz-Faktor (m/min je Herzschlag)</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={eff} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                  <CartesianGrid stroke="#eef1f5" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={28} tick={{ fontSize: 11, fill: "#8a96a6" }} />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11, fill: "#8a96a6" }} width={44} />
                  <Tooltip
                    labelFormatter={(d) => `Woche ab ${fmtDate(String(d))}`}
                    formatter={(v: number) => [v, "EF"]}
                    contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="ef" name="EF" stroke="#16a34a" strokeWidth={1.8}
                    connectNulls dot={{ r: 3, fill: "#16a34a", strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
              <p className="tiny muted" style={{ margin: "6px 0 0" }}>
                Steigender EF bei gleicher Belastung = Herz-Kreislauf-System wird ökonomischer.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* (c) Intervall-Trend */}
      {hasRunTrend(trend) && (
        <div className="card">
          <div className="spread">
            <h2>Intervall-Trend nach Kategorie</h2>
            <span className="tiny muted">Ø-Pace der Belastungen je Einheit — LT1 · LT2 · VO2 kurz · VO2 lang (schneller = oben)</span>
          </div>
          <IntervalTrend data={trend ?? []} />
        </div>
      )}
    </div>
  );
}

function maxDate(a: string, b: string) { return a > b ? a : b; }
