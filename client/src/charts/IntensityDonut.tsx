import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { TOOLTIP_STYLE } from "../lib/chartTheme.ts";

export const INT_COLORS = { easy: "#3b82f6", mod: "#22c55e", hard: "#f97316" };

export default function IntensityDonut({
  intensity, height = 150, center, centerText, showLegend = false,
}: {
  intensity: { easy: number; mod: number; hard: number };
  height?: number;
  /** Mitteltext mit Zahl (z.B. % hart). */
  center?: { value: number; sub: string };
  /** Neutraler Mitteltext (z.B. „TSS") — keine widersprüchliche Zahl. */
  centerText?: string;
  /** Eigene 3-Farben-Legende unter dem Donut (Easy/Moderat/Hart %). */
  showLegend?: boolean;
}) {
  const data = [
    { name: "Easy", key: "easy", value: intensity.easy },
    { name: "Moderat", key: "mod", value: intensity.mod },
    { name: "Hart", key: "hard", value: intensity.hard },
  ];
  return (
    <div>
      <div style={{ position: "relative", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius="65%" outerRadius="88%" paddingAngle={2
            } startAngle={90} endAngle={-270}>
              {data.map((d) => <Cell key={d.key} fill={INT_COLORS[d.key as keyof typeof INT_COLORS]} />)}
            </Pie>
            <Tooltip formatter={(v: number, n: string) => [`${Math.round(v)}%`, n]} contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          {centerText != null ? (
            <div className="donut-sublabel">{centerText}</div>
          ) : (
            <>
              <div className="donut-value">{Math.round((center ?? { value: intensity.hard }).value)}</div>
              <div className="donut-label">{(center ?? { sub: "hart" }).sub}</div>
            </>
          )}
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
