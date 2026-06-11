import {
  Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

export interface SeasonRow { label: string; phase: string; target: number | null; planned: number; actual: number; }

export default function SeasonProgress({ rows, height = 280 }: { rows: SeasonRow[]; height?: number }) {
  if (!rows.length) return <div className="empty">Noch kein Saisonplan. Lege Wochen unter „Einstellungen → Saisonplan" an oder importiere den bestehenden Plan.</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid stroke="#eef1f5" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8a96a6" }} interval={0} angle={-12} textAnchor="end" height={48} />
        <YAxis tick={{ fontSize: 11, fill: "#8a96a6" }} width={36} unit="" />
        <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="planned" name="Geplant (km)" fill="#9ec3ea" barSize={16} radius={[3, 3, 0, 0]} />
        <Bar dataKey="actual" name="Real (km)" fill="var(--fitness)" barSize={16} radius={[3, 3, 0, 0]} />
        <Line dataKey="target" name="Phasenziel" stroke="var(--form)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
