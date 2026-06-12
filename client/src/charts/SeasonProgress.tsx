import {
  Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { Activity, PlannedSession, SeasonWeek } from "../lib/api.ts";
import { weekLabel } from "../lib/util.ts";

export interface SeasonRow {
  label: string; phase: string; target: number | null; planned: number; actual: number;
  /** Wochen-Zeitraum (für Zeitraum-Filter im Dashboard). */
  start?: string; end?: string;
}

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
  rows, height = 280, highlightLabel,
}: {
  rows: SeasonRow[]; height?: number;
  /** Label der hervorzuhebenden Woche (z.B. aktuelle Berichtswoche). */
  highlightLabel?: string;
}) {
  if (!rows.length) return <div className="empty">Noch kein Saisonplan. Lege Wochen unter „Einstellungen → Saisonplan" an oder importiere den bestehenden Plan.</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid stroke="#eef1f5" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8a96a6" }} interval={0} angle={-12} textAnchor="end" height={48} />
        <YAxis tick={{ fontSize: 11, fill: "#8a96a6" }} width={36} unit="" />
        <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {highlightLabel && rows.some((r) => r.label === highlightLabel) && (
          <ReferenceLine x={highlightLabel} stroke="var(--accent)" strokeDasharray="3 4"
            label={{ value: "diese Woche", fontSize: 10, fill: "var(--accent)", position: "top" }} />
        )}
        <Bar dataKey="planned" name="Geplant (km)" fill="#9ec3ea" barSize={16} radius={[3, 3, 0, 0]} />
        <Bar dataKey="actual" name="Real (km)" fill="var(--fitness)" barSize={16} radius={[3, 3, 0, 0]} />
        <Line dataKey="target" name="Phasenziel" stroke="var(--form)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
