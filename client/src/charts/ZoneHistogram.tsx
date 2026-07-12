// Zonen-Histogramm (v1.4.0, C3): aggregierte Zeit in HF- und Pace-Zonen als horizontale Balkengrafiken.
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TOOLTIP_STYLE, TOOLTIP_ITEM_STYLE } from "../lib/chartTheme.ts";
import type { ZoneHistogramData } from "../lib/api.ts";

function fmtMin(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

interface Props { data: ZoneHistogramData; height?: number; }

export default function ZoneHistogram({ data, height = 160 }: Props) {
  const hrTotal = data.hrBands.reduce((s, b) => s + b.min, 0);
  const paceTotal = data.paceBands.reduce((s, b) => s + b.min, 0);
  const hasHr = hrTotal > 0;
  const hasPace = paceTotal > 0;

  if (!hasHr && !hasPace) return <p className="tiny muted">Keine Zonen-Daten im gewählten Zeitraum.</p>;

  const tip = (label: string) => (v: number) => [`${fmtMin(v)} (${hrTotal || paceTotal > 0 ? Math.round(v / (hrTotal || paceTotal) * 100) : 0}%)`, label];

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {hasHr && (
        <div style={{ flex: 1, minWidth: 180 }}>
          <div className="tiny muted" style={{ marginBottom: 2 }}>HF-Zonen · {fmtMin(hrTotal)}</div>
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data.hrBands} layout="vertical" margin={{ top: 2, right: 4, left: 62, bottom: 2 }}>
              <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={fmtMin} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={62} />
              <Tooltip formatter={(v: number) => [fmtMin(v) + ` (${hrTotal > 0 ? Math.round(v / hrTotal * 100) : 0}%)`, "Zeit"]}
                contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
              <Bar dataKey="min" radius={[0, 3, 3, 0]}>
                {data.hrBands.map((b, i) => <Cell key={i} fill={b.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {hasPace && (
        <div style={{ flex: 1, minWidth: 180 }}>
          <div className="tiny muted" style={{ marginBottom: 2 }}>Pace-Zonen · {fmtMin(paceTotal)}</div>
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data.paceBands} layout="vertical" margin={{ top: 2, right: 4, left: 90, bottom: 2 }}>
              <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={fmtMin} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={90} />
              <Tooltip formatter={tip("Zeit")}
                contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
              <Bar dataKey="min" radius={[0, 3, 3, 0]}>
                {data.paceBands.map((b, i) => <Cell key={i} fill={b.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
