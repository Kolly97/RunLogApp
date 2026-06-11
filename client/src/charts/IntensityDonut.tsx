import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const COLORS = { easy: "#3b82f6", mod: "#22c55e", hard: "#f97316" };

export default function IntensityDonut({
  intensity, height = 150, label,
}: {
  intensity: { easy: number; mod: number; hard: number };
  height?: number;
  label?: string;
}) {
  const data = [
    { name: "Easy (Z1-2)", key: "easy", value: intensity.easy },
    { name: "Moderat (Z3)", key: "mod", value: intensity.mod },
    { name: "Hart (Z4-6)", key: "hard", value: intensity.hard },
  ];
  return (
    <div style={{ position: "relative" }}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius="58%" outerRadius="85%" paddingAngle={2} startAngle={90} endAngle={-270}>
            {data.map((d) => <Cell key={d.key} fill={COLORS[d.key as keyof typeof COLORS]} />)}
          </Pie>
          <Tooltip formatter={(v: number, n: string) => [`${Math.round(v)}%`, n]} contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <strong style={{ fontSize: 18 }}>{Math.round(intensity.easy)}%</strong>
        <span className="tiny muted">{label || "easy"}</span>
      </div>
    </div>
  );
}
