import {
  Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from "recharts";
import type { Activity, PlannedSession, SeasonWeek } from "../lib/api.ts";
import { weekLabel } from "../lib/util.ts";

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
  rows, height = 280, highlightLabel, races = [], sickLabels = [],
}: {
  rows: SeasonRow[]; height?: number;
  /** Label der hervorzuhebenden Woche (z.B. aktuelle Berichtswoche). */
  highlightLabel?: string;
  /** Wochen mit Wettkampf (goldener Strich + Beschriftung, ToDo #4). */
  races?: RaceWeekMarker[];
  /** Labels der Wochen mit Phase „Krank" (rote Hinterlegung, ToDo #5). */
  sickLabels?: string[];
}) {
  if (!rows.length) return <div className="empty">Noch kein Saisonplan. Lege Wochen unter „Saisonplan" an oder importiere den bestehenden Plan.</div>;
  // Jahresgrenzen: erste Woche eines neuen Jahres → dicker Strich + Jahreszahl (ToDo #6).
  const yearMarks: { label: string; year: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const y = rows[i].start?.slice(0, 4);
    const prev = rows[i - 1].start?.slice(0, 4);
    if (y && y !== prev) yearMarks.push({ label: rows[i].label, year: y });
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 14, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid stroke="#eef1f5" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8a96a6" }} angle={0} minTickGap={0} textAnchor="middle" height={30} />
        <YAxis tick={{ fontSize: 11, fill: "#8a96a6" }} width={36} unit="" />
        <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {/* Krank-Wochen rot hinterlegt */}
        {sickLabels.map((l) => (
          <ReferenceArea key={`sick-${l}`} x1={l} x2={l} fill="#ef4444" fillOpacity={0.08} ifOverflow="hidden" />
        ))}
        {/* Jahresgrenze dicker + Jahreszahl darunter */}
        {yearMarks.map((y) => (
          <ReferenceLine key={`yr-${y.label}`} x={y.label} stroke="#64748b" strokeWidth={2}
            label={{ value: y.year, fontSize: 11, fontWeight: 700, fill: "#64748b", position: "insideBottom" }} />
        ))}
        {highlightLabel && rows.some((r) => r.label === highlightLabel) && (
          <ReferenceLine x={highlightLabel} stroke="var(--accent)" strokeDasharray="3 4"
            label={{ value: "diese Woche", fontSize: 10, fill: "var(--accent)", position: "top" }} />
        )}
        {/* Races als goldener Strich + Label */}
        {races.map((r) => (
          <ReferenceLine key={`race-${r.label}`} x={r.label} stroke="#d4af37" strokeWidth={1.8}
            label={{ value: r.text, fontSize: 9, fill: "#b8860b", position: "top" }} />
        ))}
        <Bar dataKey="planned" name="Geplant (km)" fill="#9ec3ea" barSize={16} radius={[3, 3, 0, 0]} />
        <Bar dataKey="actual" name="Real (km)" fill="var(--fitness)" barSize={16} radius={[3, 3, 0, 0]} />
        <Line dataKey="target" name="Phasenziel" stroke="var(--form)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
