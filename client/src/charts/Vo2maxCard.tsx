// VO2max-Kachel (v0.15.0, O1): große VDOT-Zahl (≈ VO2max) + Alters-Niveau + Mini-Sparkline.
// Quelle: /api/fitness-trend (90-Tage-Rolling-Window, Daniels-VDOT aus Bestzeiten).
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FitnessTrend } from "../lib/api.ts";
import { fmtDate } from "../lib/util.ts";

const LEVEL_COLOR: Record<string, string> = {
  "Elite": "#d4af37", "Exzellent": "#22c55e", "Sehr gut": "#0ea5e9",
  "Durchschnitt": "#eab308", "Unter Durchschnitt": "#ef4444",
};

export default function Vo2maxCard({ data }: { data: FitnessTrend | null }) {
  const cur = data?.current?.vdot ?? null;
  const spark = (data?.points ?? []).filter((p) => p.vdot != null).map((p) => ({ date: p.date, vdot: p.vdot as number }));
  // Trendrichtung aus erstem/letztem Sparkline-Punkt.
  const dir = spark.length >= 2 ? (spark[spark.length - 1].vdot - spark[0].vdot) : 0;
  const arrow = dir > 0.4 ? "↗" : dir < -0.4 ? "↘" : "→";
  const levelColor = data?.level ? (LEVEL_COLOR[data.level] ?? "var(--muted)") : "var(--muted)";

  return (
    <div className="card stat">
      <div className="label">VO₂max (geschätzt)</div>
      {cur == null ? (
        <>
          <div className="value">–</div>
          <div className="sub">zu wenige Renndaten</div>
        </>
      ) : (
        <>
          <div className="value fitness">{cur.toFixed(1)} <span className="tiny muted">{arrow}</span></div>
          <div className="sub" style={{ color: levelColor, fontWeight: 600 }}>
            {data?.level ?? "—"}{data?.age ? <span className="muted" style={{ fontWeight: 400 }}> · {data.age} J.</span> : null}
          </div>
          {spark.length >= 2 && (
            <div style={{ marginTop: 6 }}>
              <ResponsiveContainer width="100%" height={40}>
                <LineChart data={spark} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
                  <XAxis dataKey="date" hide />
                  <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
                  <Tooltip
                    labelFormatter={(d) => fmtDate(String(d))}
                    formatter={(v: number) => [`${(v as number).toFixed(1)} VO₂max`, ""]}
                    separator="" contentStyle={{ borderRadius: 8, border: "1px solid #e3e8ef", fontSize: 11, padding: "4px 8px" }}
                  />
                  <Line type="monotone" dataKey="vdot" stroke="var(--fitness, #2b6cb0)" strokeWidth={1.6} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
