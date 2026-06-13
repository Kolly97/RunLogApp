import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export const INT_COLORS = { easy: "#3b82f6", mod: "#22c55e", hard: "#f97316" };

export default function IntensityDonut({
  intensity, height = 150, center, showLegend = false,
}: {
  intensity: { easy: number; mod: number; hard: number };
  height?: number;
  /** Mitteltext (Default: % hart). */
  center?: { value: number; sub: string };
  /** Kompakte Legende unter dem Donut (selten gebraucht; Karte nutzt Seitenlegende). */
  showLegend?: boolean;
}) {
  const data = [
    { name: "Easy", key: "easy", value: intensity.easy },
    { name: "Moderat", key: "mod", value: intensity.mod },
    { name: "Hart", key: "hard", value: intensity.hard },
  ];
  const c = center ?? { value: intensity.hard, sub: "hart" };
  return (
    <div>
      <div style={{ position: "relative", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius="62%" outerRadius="88%" paddingAngle={2} startAngle={90} endAngle={-270}>
              {data.map((d) => <Cell key={d.key} fill={INT_COLORS[d.key as keyof typeof INT_COLORS]} />)}
            </Pie>
            <Tooltip formatter={(v: number, n: string) => [`${Math.round(v)}%`, n]} contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <div className="donut-value">{Math.round(c.value)}%</div>
          <div className="donut-label">{c.sub}</div>
        </div>
      </div>
      {showLegend && (
        <div className="donut-legend">
          {data.map((d) => (
            <span key={d.key}>
              <span className="dot" style={{ background: INT_COLORS[d.key as keyof typeof INT_COLORS] }} />
              {d.name} {Math.round(d.value)}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
