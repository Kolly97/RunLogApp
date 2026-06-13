import { useState } from "react";
import {
  Area, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Bar, Customized,
} from "recharts";
import type { PmcPoint } from "../lib/api.ts";
import { todayIso, fmtDate } from "../lib/util.ts";
import { phaseColor, phaseLabel } from "../lib/options.ts";
import ChartDecor, { vRefLabel, type PhaseRun, type YearMark } from "./ChartDecor.tsx";

export interface RaceMarker { date: string; label: string; }
export interface DateRange2 { from: string; to: string; }

const SERIES = [
  { key: "fitness", name: "Fitness (CTL)", color: "#2b6cb0" },
  { key: "fatigue", name: "Fatigue (ATL)", color: "#d53f8c" },
  { key: "form", name: "Form (TSB)", color: "#e0a300" },
  { key: "week", name: "TSS/Woche", color: "#7c9cbf" },
  { key: "tss", name: "TSS/Tag", color: "#c3ccd6" },
  { key: "races", name: "Races", color: "#d4af37" },
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
  data, height = 300, highlight, races = [], sickRanges = [],
  phaseRuns = [], yearMarks = [], namesByDate, onPick,
}: {
  data: PmcPoint[]; height?: number;
  highlight?: { from: string; to: string };
  races?: RaceMarker[];
  sickRanges?: DateRange2[];
  phaseRuns?: PhaseRun[];
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
          <b>{fmtDate(hoverDate!)}</b> · {hoverName}{onPick ? <span className="muted"> · klicken → Tracking</span> : null}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 16, right: 12, left: -6, bottom: 42 }}
          onMouseMove={(s: any) => setHoverDate(s?.activeLabel ? String(s.activeLabel) : null)}
          onMouseLeave={() => setHoverDate(null)}
          onClick={(s: any) => s?.activeLabel && onPick?.(String(s.activeLabel))}
          style={onPick ? { cursor: "pointer" } : undefined}>
          <defs>
            <linearGradient id="ctlFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2b6cb0" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#2b6cb0" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eef1f5" vertical={false} />
          {sickRanges.map((s, i) => (
            <ReferenceArea key={`sick${i}`} yAxisId="load" x1={s.from} x2={s.to} fill="#ef4444" fillOpacity={0.06} ifOverflow="hidden" />
          ))}
          {hl && (
            <ReferenceArea yAxisId="load" x1={hl.from} x2={hl.to} fill="var(--accent)" fillOpacity={0.07}
              stroke="#bcd4f0" strokeOpacity={0.8} ifOverflow="hidden" />
          )}
          <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={36} tickMargin={6} tick={{ fontSize: 11, fill: "#8a96a6" }} />
          <YAxis yAxisId="load" domain={[0, loadMax]} tick={{ fontSize: 11, fill: "#8a96a6" }} width={38} />
          <YAxis yAxisId="form" orientation="right" tick={{ fontSize: 11, fill: "#8a96a6" }} width={34} />
          <YAxis yAxisId="bars" hide domain={[0, Math.ceil(maxDaily * 1.02)]} />
          <YAxis yAxisId="week" hide domain={[0, Math.ceil(maxWeek * 1.08)]} />
          <Tooltip content={<PmcTooltip />} />

          <Bar yAxisId="bars" dataKey="tss" fill="#c3ccd6" barSize={5} hide={hidden.tss} isAnimationActive={false} />
          <Line yAxisId="week" type="stepAfter" dataKey="weekSum" stroke="#7c9cbf" strokeWidth={1.4} dot={false} hide={hidden.week} isAnimationActive={false} />
          <Area yAxisId="load" type="monotone" dataKey="ctl_p" stroke="#2b6cb0" strokeWidth={2.2} fill="url(#ctlFill)" dot={false} hide={hidden.fitness} isAnimationActive={false} />
          <Line yAxisId="load" type="monotone" dataKey="ctl_f" stroke="#2b6cb0" strokeWidth={2.2} strokeDasharray="5 4" dot={false} hide={hidden.fitness} isAnimationActive={false} />
          <Line yAxisId="load" type="monotone" dataKey="atl_p" stroke="#d53f8c" strokeWidth={1.8} dot={false} hide={hidden.fatigue} isAnimationActive={false} />
          <Line yAxisId="load" type="monotone" dataKey="atl_f" stroke="#d53f8c" strokeWidth={1.8} strokeDasharray="5 4" dot={false} hide={hidden.fatigue} isAnimationActive={false} />
          <Line yAxisId="form" type="monotone" dataKey="tsb_p" stroke="#e0a300" strokeWidth={1.8} dot={false} hide={hidden.form} isAnimationActive={false} />
          <Line yAxisId="form" type="monotone" dataKey="tsb_f" stroke="#e0a300" strokeWidth={1.8} strokeDasharray="5 4" dot={false} hide={hidden.form} isAnimationActive={false} />

          <ReferenceLine yAxisId="form" y={0} stroke="#cbd5e1" strokeDasharray="2 4" />
          <ReferenceLine yAxisId="load" x={today} stroke="#94a3b8" strokeDasharray="4 4"
            label={{ value: "heute", fontSize: 10, fill: "#94a3b8", position: "top" }} />
          {!hidden.races && races.map((r, i) => (
            <ReferenceLine key={`race${i}`} yAxisId="load" x={r.date} stroke="#d4af37" strokeWidth={1.4}
              label={vRefLabel(short(r.label))} />
          ))}

          {/* Phasenband + Jahresmarke + Phasenname zuletzt → liegen über den TSS-Balken (ToDo Z.39). */}
          <Customized component={(p: any) => <ChartDecor {...p} runs={phaseRuns} years={yearMarks}
            phaseText={curPhase ? phaseLabel(curPhase) : ""} phaseFill={curPhase ? phaseColor(curPhase) : ""} />} />
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
    <div style={{ background: "#fff", border: "1px solid #e3e8ef", borderRadius: 10, padding: "8px 10px", fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{fmtDate(p.date)}</div>
      {row("Fitness", p.ctl, "#2b6cb0")}
      {row("Fatigue", p.atl, "#d53f8c")}
      {row("Form", p.tsb, "#e0a300")}
      {row("TSS/Tag", p.tss, "#8a96a6")}
      {row("TSS/Woche", p.weekSum, "#7c9cbf")}
    </div>
  );
}
