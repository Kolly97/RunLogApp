import { useState } from "react";
import {
  Area, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Bar, Customized,
} from "recharts";
import type { PmcPoint } from "../lib/api.ts";
import { todayIso, fmtDate, fmtDateY } from "../lib/util.ts";
import { phaseColor, phaseLabel } from "../lib/options.ts";
import ChartDecor, { vRefLabel, type PhaseRun, type YearMark } from "./ChartDecor.tsx";
import SeasonalDecor from "./SeasonalDecor.tsx";

export interface RaceMarker { date: string; label: string; }
export interface PbMarker { date: string; label: string; }
export interface DateRange2 { from: string; to: string; }

const SERIES = [
  { key: "fitness", name: "Fitness (CTL)", color: "var(--fitness)" },
  { key: "fatigue", name: "Fatigue (ATL)", color: "var(--fatigue)" },
  { key: "form", name: "Form (TSB)", color: "var(--form)" },
  { key: "week", name: "TSS/Woche", color: "#7c9cbf" },
  { key: "tss", name: "TSS/Tag", color: "#c3ccd6" },
  { key: "races", name: "Races · PBs ▲", color: "#d4af37" },
] as const;
type SeriesKey = (typeof SERIES)[number]["key"];

function mondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function short(s: string, n = 16): string { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// TrainingPeaks-Farbsemantik: CTL blau, ATL rosa, TSB gelb. Prognose (rechts von heute) gestrichelt.
// TSS-Tagesbalken + Wochen-TSS auf eigenen, versteckten Achsen → Fitness nutzt die linke Achse voll.
export default function Pmc({
  data, height = 360, highlight, races = [], pbs = [], sickRanges = [],
  phaseRuns = [], cycleRuns = [], yearMarks = [], namesByDate, onPick, seasonal = false,
}: {
  data: PmcPoint[]; height?: number;
  highlight?: { from: string; to: string };
  races?: RaceMarker[];
  /** Bestleistungen-Marker (M5): dezente Wimpel am oberen Rand bei PB-Daten. */
  pbs?: PbMarker[];
  /** Jahreszeiten-Deko (M7 Easter Egg) — nur Dashboard/Langzeit, nicht im Druck-Bericht. */
  seasonal?: boolean;
  sickRanges?: DateRange2[];
  phaseRuns?: PhaseRun[];
  /** P6: Zyklus-Phasen-Band über dem Trainingsphasen-Band (leer ohne Consent). */
  cycleRuns?: PhaseRun[];
  yearMarks?: YearMark[];
  /** Aktivitätsname(n) je Datum (Hover-Overlay). */
  namesByDate?: Record<string, string>;
  /** Klick auf einen Tag → z.B. Sprung ins Tracking. */
  onPick?: (date: string) => void;
}) {
  const [hidden, setHidden] = useState<Record<SeriesKey, boolean>>({
    fitness: false, fatigue: false, form: false, week: false, tss: false, races: false,
  });
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  if (!data.length) return <div className="empty">Noch keine Trainingsdaten — plane eine Woche oder synchronisiere Strava.</div>;
  const today = todayIso();

  // Wochen-Summe (TSS je ISO-Woche) — konstant über die Woche (Stufenlinie).
  const weekTotal = new Map<string, number>();
  for (const p of data) weekTotal.set(mondayOf(p.date), (weekTotal.get(mondayOf(p.date)) || 0) + (p.tss || 0));

  const rows = data.map((p) => {
    const past = p.date <= today, future = p.date >= today;
    return {
      ...p, weekSum: Math.round(weekTotal.get(mondayOf(p.date)) || 0),
      ctl_p: past ? p.ctl : null, atl_p: past ? p.atl : null, tsb_p: past ? p.tsb : null,
      ctl_f: future ? p.ctl : null, atl_f: future ? p.atl : null, tsb_f: future ? p.tsb : null,
    };
  });

  const maxLoad = Math.max(1, ...data.map((p) => Math.max(p.ctl || 0, p.atl || 0)));
  const loadMax = Math.ceil((maxLoad * 1.15) / 10) * 10; // Fitness füllt >80 % der Höhe
  const maxDaily = Math.max(1, ...data.map((p) => p.tss || 0));
  const maxWeek = Math.max(1, ...rows.map((r) => r.weekSum));

  const hl = highlight && data.some((p) => p.date >= highlight.from && p.date <= highlight.to) ? highlight : null;
  const toggle = (k: SeriesKey) => setHidden((h) => ({ ...h, [k]: !h[k] }));
  const hoverName = hoverDate ? namesByDate?.[hoverDate] : undefined;
  const phaseAt = (d: string | null): string =>
    d ? phaseRuns.find((r) => r.fromKey <= d && d <= r.toKey)?.phase || "" : "";
  const curPhase = phaseAt(hoverDate) || phaseAt(today);

  return (
    <div className="pmc-wrap" style={{ position: "relative" }}>
      {hoverName && (
        <div className="pmc-hover">
          <b>{fmtDateY(hoverDate!)}</b> · {hoverName}{onPick ? <span className="muted"> · klicken → Tracking</span> : null}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 20, right: 12, left: -6, bottom: 30 }}
          onMouseMove={(s: any) => setHoverDate(s?.activeLabel ? String(s.activeLabel) : null)}
          onMouseLeave={() => setHoverDate(null)}
          onClick={(s: any) => s?.activeLabel && onPick?.(String(s.activeLabel))}
          style={onPick ? { cursor: "pointer" } : undefined}>
          <defs>
            <linearGradient id="ctlFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--fitness)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--fitness)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          {seasonal && <Customized component={(p: any) => <SeasonalDecor {...p} />} />}
          {sickRanges.map((s, i) => (
            <ReferenceArea key={`sick${i}`} yAxisId="load" x1={s.from} x2={s.to} fill="#ef4444" fillOpacity={0.06} ifOverflow="hidden" />
          ))}
          {hl && (
            <ReferenceArea yAxisId="load" x1={hl.from} x2={hl.to} fill="var(--accent)" fillOpacity={0.07}
              stroke="#bcd4f0" strokeOpacity={0.8} ifOverflow="hidden" />
          )}
          <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={36} tickMargin={6} tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
          <YAxis yAxisId="load" domain={[0, loadMax]} tick={{ fontSize: 11, fill: "var(--chart-tick)" }} width={38} />
          <YAxis yAxisId="form" orientation="right" tick={{ fontSize: 11, fill: "var(--chart-tick)" }} width={34} />
          <YAxis yAxisId="bars" hide domain={[0, Math.ceil(maxDaily * 1.02)]} />
          <YAxis yAxisId="week" hide domain={[0, Math.ceil(maxWeek * 1.08)]} />
          <Tooltip content={<PmcTooltip />} />

          <Bar yAxisId="bars" dataKey="tss" fill="#c3ccd6" barSize={5} hide={hidden.tss} isAnimationActive={false} />
          <Line yAxisId="week" type="stepAfter" dataKey="weekSum" stroke="#7c9cbf" strokeWidth={1.4} dot={false} hide={hidden.week} isAnimationActive={false} />
          <Area yAxisId="load" type="monotone" dataKey="ctl_p" stroke="var(--fitness)" strokeWidth={2.2} fill="url(#ctlFill)" dot={false} hide={hidden.fitness} isAnimationActive={false} />
          <Line yAxisId="load" type="monotone" dataKey="ctl_f" stroke="var(--fitness)" strokeWidth={2.2} strokeDasharray="5 4" dot={false} hide={hidden.fitness} isAnimationActive={false} />
          <Line yAxisId="load" type="monotone" dataKey="atl_p" stroke="var(--fatigue)" strokeWidth={1.8} dot={false} hide={hidden.fatigue} isAnimationActive={false} />
          <Line yAxisId="load" type="monotone" dataKey="atl_f" stroke="var(--fatigue)" strokeWidth={1.8} strokeDasharray="5 4" dot={false} hide={hidden.fatigue} isAnimationActive={false} />
          <Line yAxisId="form" type="monotone" dataKey="tsb_p" stroke="var(--form)" strokeWidth={1.8} dot={false} hide={hidden.form} isAnimationActive={false} />
          <Line yAxisId="form" type="monotone" dataKey="tsb_f" stroke="var(--form)" strokeWidth={1.8} strokeDasharray="5 4" dot={false} hide={hidden.form} isAnimationActive={false} />

          <ReferenceLine yAxisId="form" y={0} stroke="var(--chart-tick)" strokeDasharray="2 4" />
          <ReferenceLine yAxisId="load" x={today} stroke="var(--chart-tick)" strokeDasharray="4 4"
            label={{ value: "heute", fontSize: 10, fill: "var(--chart-tick)", position: "top" }} />
          {/* Phasenband + Jahresmarke + Phasenname über den TSS-Balken (ToDo Z.39). */}
          <Customized component={(p: any) => <ChartDecor {...p} runs={phaseRuns} cycleRuns={cycleRuns} years={yearMarks} pbs={hidden.races ? [] : pbs}
            phaseText={curPhase ? phaseLabel(curPhase) : ""} phaseFill={curPhase ? phaseColor(curPhase) : ""} />} />
          {/* Races zuletzt → Label im Vordergrund, von nichts überlappt (ToDo Z.27) */}
          {!hidden.races && races.map((r, i) => (
            <ReferenceLine key={`race${i}`} yAxisId="load" x={r.date} stroke="#d4af37" strokeWidth={1.4}
              label={vRefLabel(short(r.label))} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="pmc-legend">
        {SERIES.map((s) => (
          <button key={s.key} type="button" onClick={() => toggle(s.key)} style={{ opacity: hidden[s.key] ? 0.4 : 1 }}>
            <span className="dot" style={{ background: s.color }} /> {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function PmcTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as { date: string; ctl: number; atl: number; tsb: number; tss: number; weekSum: number };
  const row = (label: string, v: number, color: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color }}>{label}</span><b>{Math.round(v * 10) / 10}</b>
    </div>
  );
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 10px", fontSize: 12 }}>
      <div style={{ fontWeight: 100, marginBottom: 4 }}>{fmtDateY(p.date)}</div>
      {row("Fitness", p.ctl, "var(--fitness)")}
      {row("Fatigue", p.atl, "var(--fatigue)")}
      {row("Form", p.tsb, "var(--form)")}
      {row("TSS/Tag", p.tss, "var(--chart-tick)")}
      {row("TSS/Woche", p.weekSum, "#7c9cbf")}
    </div>
  );
}
