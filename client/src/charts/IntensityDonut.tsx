import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const COLORS = { easy: "#3b82f6", mod: "#22c55e", hard: "#f97316" };

export default function IntensityDonut({
  intensity, height = 150, label, showLegend = true,
}: {
  intensity: { easy: number; mod: number; hard: number };
  height?: number;
  /** Beschriftung unter der Zahl in der Mitte (Default „easy"). */
  label?: string;
  /** Kompakte Legende unter dem Donut (Easy/Moderat/Hart mit %). */
  showLegend?: boolean;
}) {
  const data = [
    { name: "Easy (Z1-2)", key: "easy", value: intensity.easy },
    { name: "Moderat (Z3)", key: "mod", value: intensity.mod },
    { name: "Hart (Z4-6)", key: "hard", value: intensity.hard },
  ];
  return (
    <div>
      <div style={{ position: "relative", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius="62%" outerRadius="88%" paddingAngle={2} startAngle={90} endAngle={-270}>
              {data.map((d) => <Cell key={d.key} fill={COLORS[d.key as keyof typeof COLORS]} />)}
            </Pie>
            <Tooltip formatter={(v: number, n: string) => [`${Math.round(v)}%`, n]} contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
        {/* Zahl klein & sauber zentriert, Label darunter (Website-Stil) */}
        <div className="donut-center">
          <div className="donut-value">{Math.round(intensity.easy)}%</div>
          <div className="donut-label">{label || "easy"}</div>
        </div>
      </div>
      {showLegend && (
        <div className="donut-legend">
          {data.map((d) => (
            <span key={d.key}>
              <span className="dot" style={{ background: COLORS[d.key as keyof typeof COLORS] }} />
              {d.name.split(" ")[0]} {Math.round(d.value)}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
