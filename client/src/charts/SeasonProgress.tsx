import { useState } from "react";
import {
  Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea, Customized,
} from "recharts";
import type { Activity, PlannedSession, SeasonWeek } from "../lib/api.ts";
import { weekLabel } from "../lib/util.ts";
import ChartDecor, { vRefLabel } from "./ChartDecor.tsx";
import { phaseRunsByWeek, yearMarksByWeek } from "../lib/markers.ts";

function short(s: string, n = 14): string { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

export interface SeasonRow {
  label: string; phase: string; target: number | null; planned: number; actual: number;
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
  return season.map((w) => ({
    label: weekLabel(w),
    phase: w.phase,
    target: w.target_km,
    planned: Math.round((plannedByWeek.get(w.week_no) || 0) * 10) / 10,
    actual: Math.round((actualByWeek.get(w.week_no) || 0) * 10) / 10,
    start: w.start_date,
    end: w.end_date,
  }));
}

export default function SeasonProgress({
  rows, height = 280, highlightLabel, races = [], sickLabels = [], showYears = true,
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
  if (!rows.length) return <div className="empty">Noch kein Saisonplan. Lege Wochen unter „Saisonplan" an oder importiere den bestehenden Plan.</div>;
  const phaseRuns = phaseRunsByWeek(rows);
  const yearMarks = showYears ? yearMarksByWeek(rows) : [];
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 14, right: 12, left: -8, bottom: 42 }}>
          <CartesianGrid stroke="#eef1f5" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8a96a6" }} angle={0} minTickGap={0} textAnchor="middle" height={30} />
          <YAxis tick={{ fontSize: 11, fill: "#8a96a6" }} width={36} unit="" />
          <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {/* Krank-Wochen rot hinterlegt */}
          {sickLabels.map((l) => (
            <ReferenceArea key={`sick-${l}`} x1={l} x2={l} fill="#ef4444" fillOpacity={0.08} ifOverflow="hidden" />
          ))}
          {highlightLabel && rows.some((r) => r.label === highlightLabel) && (
            <ReferenceLine x={highlightLabel} stroke="var(--accent)" strokeDasharray="3 4"
              label={{ value: "diese Woche", fontSize: 10, fill: "var(--accent)", position: "top" }} />
          )}
          {/* Races als goldener Strich + vertikales Label (an/aus) */}
          {showRaces && races.map((r) => (
            <ReferenceLine key={`race-${r.label}`} x={r.label} stroke="#d4af37" strokeWidth={1.6}
              label={vRefLabel(short(r.text))} />
          ))}
          <Bar dataKey="planned" name="Geplant (km)" fill="#9ec3ea" barSize={16} radius={[3, 3, 0, 0]} />
          <Bar dataKey="actual" name="Real (km)" fill="var(--fitness)" barSize={16} radius={[3, 3, 0, 0]} />
          <Line dataKey="target" name="Phasenziel" stroke="var(--form)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} />
          {/* Phasenband + Jahresmarke zuletzt → liegen über den Balken (ToDo Z.39/Z.46). */}
          <Customized component={(p: any) => <ChartDecor {...p} runs={phaseRuns} years={yearMarks} />} />
        </ComposedChart>
      </ResponsiveContainer>
      {races.length > 0 && (
        <div className="pmc-legend" style={{ marginTop: 0 }}>
          <button type="button" onClick={() => setShowRaces((v) => !v)} style={{ opacity: showRaces ? 1 : 0.4 }}>
            <span className="dot" style={{ background: "#d4af37" }} /> Races
          </button>
        </div>
      )}
    </div>
  );
}
