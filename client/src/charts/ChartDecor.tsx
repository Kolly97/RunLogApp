// Gemeinsame Chart-Dekoration als Recharts-<Customized>-Layer:
//  - Phasen-Farbband am Achsenfuß (Hover = Phasenname)
//  - dezente Jahresmarke: halbhoher Strich + Jahreszahl unter der Achse
// Nutzung: <Customized component={(p) => <ChartDecor {...p} runs={...} years={...} />} />
import { phaseColor } from "../lib/options.ts";

export interface PhaseRun { fromKey: string; toKey: string; phase: string; }
export interface YearMark { key: string; year: string; }

export default function ChartDecor(props: any) {
  const { xAxisMap, offset, runs = [], years = [] } = props;
  const axis = xAxisMap && xAxisMap[Object.keys(xAxisMap)[0]];
  if (!axis || !offset) return null;
  const scale = axis.scale;
  const band = typeof scale.bandwidth === "function" ? scale.bandwidth() : 0;
  const plotBottom = offset.top + offset.height;
  const xOf = (key: string): number | null => {
    const x = scale(key);
    return typeof x === "number" && isFinite(x) ? x : null;
  };
  return (
    <g>
      {(runs as PhaseRun[]).map((r, i) => {
        const a = xOf(r.fromKey), b = xOf(r.toKey);
        if (a == null || b == null) return null;
        const left = Math.min(a, b);
        const width = Math.max(1, Math.abs(b - a) + band);
        return (
          <rect key={`pb${i}`} x={left} y={plotBottom - 5} width={width} height={5} fill={phaseColor(r.phase)} opacity={0.85} rx={1}>
            <title>{r.phase}</title>
          </rect>
        );
      })}
      {(years as YearMark[]).map((y, i) => {
        const x = xOf(y.key);
        if (x == null) return null;
        return (
          <g key={`yr${i}`}>
            <line x1={x} x2={x} y1={plotBottom} y2={plotBottom - offset.height * 0.42} stroke="#cbd5e1" strokeWidth={1} />
            <text x={x} y={plotBottom + 25} textAnchor="middle" fontSize={11} fontWeight={700} fill="#64748b">{y.year}</text>
          </g>
        );
      })}
    </g>
  );
}
