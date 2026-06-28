// T15 (WP-E): minimalistische Marker-Sparkline (reine SVG-Polyline, keine Achsen).
// Standard: Färbt sich nach Trend-Richtung (Verbesserung grün, Verschlechterung rot, ~flach grau).
// `improveDir` legt fest, welche Richtung „besser" ist (z. B. Pace/Entkopplung = "down").
// `color` überschreibt die Trend-Färbung mit einer festen Farbe (für Serien ohne gut/schlecht-Richtung wie CTL/ATL/TSB).
export default function Sparkline({ data, improveDir = "up", color, width = 92, height = 22 }: {
  data: (number | null | undefined)[];
  improveDir?: "up" | "down";
  color?: string;
  width?: number;
  height?: number;
}) {
  const pts = data.filter((v): v is number => v != null && isFinite(v));
  if (pts.length < 2) return null;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const n = pts.length;
  const xOf = (i: number) => (i / (n - 1)) * (width - 2) + 1;
  const yOf = (v: number) => height - 1 - ((v - min) / span) * (height - 2);
  const d = pts.map((v, i) => `${i ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
  const delta = pts[n - 1] - pts[0];
  const flat = Math.abs(delta) < span * 0.04;
  const improving = improveDir === "up" ? delta > 0 : delta < 0;
  const trendColor = flat ? "var(--muted)" : improving ? "var(--ok)" : "var(--danger)";
  const color2 = color ?? trendColor;
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }} aria-hidden="true">
      <path d={d} fill="none" stroke={color2} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xOf(n - 1)} cy={yOf(pts[n - 1])} r={1.8} fill={color2} />
    </svg>
  );
}
