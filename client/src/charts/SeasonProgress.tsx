import { useState } from "react";
import {
  Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, Customized,
} from "recharts";
import type { Activity, PlannedSession, SeasonWeek } from "../lib/api.ts";
import { weekLabel } from "../lib/util.ts";
import { phaseColor, phaseLabel } from "../lib/options.ts";
import ChartDecor, { vRefLabel } from "./ChartDecor.tsx";
import { phaseRunsByWeek, yearMarksByWeek } from "../lib/markers.ts";

function short(s: string, n = 14): string { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

export interface SeasonRow {
  label: string; phase: string; target: number | null; planned: number; actual: number;
  /** Plan-Erfüllung in % (TSS-basiert, 0–150). */
  adherence?: number | null;
  /** Wochen-Zeitraum (für Zeitraum-Filter im Dashboard). */
  start?: string; end?: string;
}
export interface RaceWeekMarker { label: string; text: string; }

/** Baut die Wochen-Zeilen (geplant/real/ziel km) aus Saisonplan + Sessions + Aktivitäten.
 *  Wird von Dashboard UND Wochenbericht genutzt. Labels = Kalenderwochen („KW9"). */
export function buildSeasonRows(season: SeasonWeek[], sessions: PlannedSession[], acts: Activity[]): SeasonRow[] {
  const plannedByWeek = new Map<number, number>();
  for (const s of sessions) {
    if (s.sport !== "Run" || s.week_no == null) continue;
    plannedByWeek.set(s.week_no, (plannedByWeek.get(s.week_no) || 0) + (s.planned_km || 0));
  }
  const actualByWeek = new Map<number, number>();
  for (const a of acts) {
    if (a.sport !== "Run") continue;
    const w = season.find((x) => x.start_date <= a.date && a.date <= x.end_date);
    if (!w) continue;
    actualByWeek.set(w.week_no, (actualByWeek.get(w.week_no) || 0) + (a.distance_m || 0) / 1000);
  }
  // TSS-basierte Plan-Erfüllung (alle Sportarten)
  const plannedTssByWeek = new Map<number, number>();
  for (const s of sessions) {
    if (s.week_no == null || !s.planned_tss) continue;
    plannedTssByWeek.set(s.week_no, (plannedTssByWeek.get(s.week_no) || 0) + s.planned_tss);
  }
  const actualTssByWeek = new Map<number, number>();
  for (const a of acts) {
    if (!a.tss) continue;
    const w = season.find((x) => x.start_date <= a.date && a.date <= x.end_date);
    if (!w) continue;
    actualTssByWeek.set(w.week_no, (actualTssByWeek.get(w.week_no) || 0) + a.tss);
  }
  return season.map((w) => {
    const ptss = plannedTssByWeek.get(w.week_no) || 0;
    const atss = actualTssByWeek.get(w.week_no) || 0;
    return {
      label: weekLabel(w),
      phase: w.phase,
      target: w.target_km,
      planned: Math.round((plannedByWeek.get(w.week_no) || 0) * 10) / 10,
      actual: Math.round((actualByWeek.get(w.week_no) || 0) * 10) / 10,
      adherence: ptss > 0 ? Math.min(150, Math.round(atss / ptss * 100)) : null,
      start: w.start_date,
      end: w.end_date,
    };
  });
}

export default function SeasonProgress({
  rows, height = 336, highlightLabel, races = [], sickLabels = [], showYears = true,
}: {
  rows: SeasonRow[]; height?: number;
  /** Label der hervorzuhebenden Woche (z.B. aktuelle Berichtswoche). */
  highlightLabel?: string;
  /** Wochen mit Wettkampf (goldener Strich + Beschriftung, ToDo #4). */
  races?: RaceWeekMarker[];
  /** Labels der Wochen mit Phase „Krank" (rote Hinterlegung, ToDo #5). */
  sickLabels?: string[];
  /** Jahresmarke anzeigen — im Wochenbericht aus (beginnt ohnehin am 1.1., ToDo Z.31). */
  showYears?: boolean;
}) {
  const [showRaces, setShowRaces] = useState(true);
  const [hoverPhase, setHoverPhase] = useState<string | null>(null);
  if (!rows.length) return <div className="empty">Noch kein Saisonplan. Lege Wochen unter „Saisonplan" an oder importiere den bestehenden Plan.</div>;
  const phaseRuns = phaseRunsByWeek(rows);
  const yearMarks = showYears ? yearMarksByWeek(rows) : [];
  // Phasenname unten links (ToDo Z.18): folgt dem Hover, sonst Phase der hervorgehobenen Woche.
  const curPhase = hoverPhase || rows.find((r) => r.label === highlightLabel)?.phase || "";
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 14, right: 12, left: -8, bottom: 28 }}
          onMouseMove={(s: any) => setHoverPhase(s?.activePayload?.[0]?.payload?.phase ?? null)}
          onMouseLeave={() => setHoverPhase(null)}>
          <CartesianGrid stroke="#eef1f5" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8a96a6" }} angle={0} minTickGap={0} textAnchor="middle" height={30} />
          <YAxis tick={{ fontSize: 11, fill: "#8a96a6" }} width={36} unit="" />
          <YAxis yAxisId="pct" orientation="right" hide domain={[0, 150]} />
          <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }}
            formatter={(v: number, n: string) => n === "Plan-%" ? [`${v}%`, n] : [v, n]} />
          {/* Krank-Wochen rot hinterlegt (Hintergrund) */}
          {sickLabels.map((l) => (
            <ReferenceArea key={`sick-${l}`} x1={l} x2={l} fill="#ef4444" fillOpacity={0.08} ifOverflow="hidden" />
          ))}
          {/* „diese Woche" als dezente Wochen-Markierung statt gestrichelter Linie (ToDo Z.13) */}
          {highlightLabel && rows.some((r) => r.label === highlightLabel) && (
            <ReferenceArea x1={highlightLabel} x2={highlightLabel} fill="var(--accent)" fillOpacity={0.14} ifOverflow="hidden"
              label={{ value: "diese Woche", fontSize: 10, fill: "var(--accent)", position: "top" }} />
          )}
          <Bar dataKey="planned" name="Geplant (km)" fill="#9ec3ea" barSize={16} radius={[3, 3, 0, 0]} />
          <Bar dataKey="actual" name="Real (km)" fill="var(--fitness)" barSize={16} radius={[3, 3, 0, 0]} />
          <Line dataKey="target" name="Phasenziel" stroke="var(--form)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
          <ReferenceLine yAxisId="pct" y={100} stroke="#a855f7" strokeWidth={1} strokeDasharray="3 4" strokeOpacity={0.5} />
          <Line yAxisId="pct" dataKey="adherence" name="Plan-%" stroke="#a855f7" strokeWidth={1.6} dot={false} connectNulls={false} isAnimationActive={false} />
          {/* Phasenband + Jahresmarke + Phasenname über den Balken (ToDo Z.18/Z.39/Z.46). */}
          <Customized component={(p: any) => <ChartDecor {...p} runs={phaseRuns} years={yearMarks} 
            phaseText={curPhase ? phaseLabel(curPhase) : ""} phaseFill={curPhase ? phaseColor(curPhase) : ""} />} />
          {/* Races zuletzt → Label im Vordergrund, von nichts überlappt (ToDo Z.27) */}
          {showRaces && races.map((r) => (
            <ReferenceLine key={`race-${r.label}`} x={r.label} stroke="#d4af37" strokeWidth={2}
              label={vRefLabel(short(r.text))} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      {/* Vereinheitlichte Legende inkl. Races-Toggle (ToDo Z.28) */}
      <div className="pmc-legend" style={{ marginTop: 4 }}>
        <span className="lg"><span className="dot" style={{ background: "#9ec3ea" }} /> Geplant (km)</span>
        <span className="lg"><span className="dot" style={{ background: "var(--fitness)" }} /> Real (km)</span>
        <span className="lg"><span className="dot" style={{ background: "var(--form)" }} /> Phasenziel</span>
        <span className="lg"><span className="dot" style={{ background: "#a855f7" }} /> Plan-% (TSS)</span>
        {races.length > 0 && (
          <button type="button" onClick={() => setShowRaces((v) => !v)} style={{ opacity: showRaces ? 1 : 0.2 }}>
            <span className="dot" style={{ background: "#d4af37" }} /> Races
          </button>
        )}
      </div>
    </div>
  );
}
