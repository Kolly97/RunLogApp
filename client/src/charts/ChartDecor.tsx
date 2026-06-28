// Gemeinsame Chart-Dekoration als Recharts-<Customized>-Layer:
//  - Phasen-Farbband am Achsenfuß (Hover = Phasenname), wird NACH den Serien gerendert → liegt vorne
//  - dezente Jahresmarke: kurzer schwarzer Strich + Jahreszahl unter der Achse
// Jahresmarken nutzen wahlweise einen eindeutigen `key` (Datums-Charts) ODER einen Band-`index`
// (Wochen-Charts) — letzteres ist immun gegen doppelte KW-Labels über Saisongrenzen.
// Nutzung: <Customized component={(p) => <ChartDecor {...p} runs={...} years={...} />} />
import { phaseColor, phaseLabel } from "../lib/options.ts";

export interface PhaseRun { fromKey: string; toKey: string; phase: string; }
export interface YearMark { key?: string; index?: number; year: string; }
export interface PbMark { date: string; label: string; }

export default function ChartDecor(props: any) {
  const { xAxisMap, offset, runs = [], years = [], pbs = [], phaseText = "", phaseFill = "#64748b" } = props;
  const axis = xAxisMap && xAxisMap[Object.keys(xAxisMap)[0]];
  if (!axis || !offset) return null;
  const scale = axis.scale;
  const band = typeof scale.bandwidth === "function" ? scale.bandwidth() : 0;
  const plotBottom = offset.top + offset.height;
  const xOf = (key: string): number | null => {
    const x = scale(key);
    return typeof x === "number" && isFinite(x) ? x : null;
  };
  // Band-Geometrie für index-basierte Positionierung (linker Bandrand = x0 + step*index).
  const domain: any[] = typeof scale.domain === "function" ? scale.domain() : [];
  const x0 = domain.length ? xOf(domain[0]) : null;
  const step = domain.length > 1 && x0 != null ? (xOf(domain[1])! - x0) : band;
  const xOfYear = (y: YearMark): number | null =>
    y.index != null && x0 != null ? x0 + step * y.index : y.key != null ? xOf(y.key) : null;

  return (
    <g>
      {(runs as PhaseRun[]).map((r, i) => {
        const a = xOf(r.fromKey), b = xOf(r.toKey);
        if (a == null || b == null) return null;
        const left = Math.min(a, b);
        const width = Math.max(1, Math.abs(b - a) + band);
        return (
          <rect key={`pb${i}`} x={left} y={plotBottom - 6} width={width} height={6} fill={phaseColor(r.phase)} opacity={0.9} rx={1}>
            <title>{phaseLabel(r.phase)}</title>
          </rect>
        );
      })}
      {(years as YearMark[]).map((y, i) => {
        const x = xOfYear(y);
        if (x == null || !isFinite(x)) return null;
        return (
          <g key={`yr${i}`}>
          <polygon
            points={`
              ${x},${plotBottom - 20}
              ${x - 10},${plotBottom}
              ${x + 10},${plotBottom}
            `}
            fill="#0f172a"
            opacity={0.9}
          />

          <text
            x={x}
            y={plotBottom + 34}
            textAnchor="middle"
            fontSize={11}
            fontWeight={700}
            fill="#0f172a"
          >
            {y.year}
          </text>
          </g>
        );
      })}
      {/* M5: PB-Marker — kleine goldene Wimpel am oberen Plot-Rand (dezent, Detail im Hover-Title). */}
      {(pbs as PbMark[]).map((p, i) => {
        const x = xOf(p.date);
        if (x == null || !isFinite(x)) return null;
        return (
          <g key={`pbm${i}`}>
            <title>{p.label}</title>
            <polygon points={`${x - 4},${offset.top} ${x + 4},${offset.top} ${x},${offset.top + 7}`} fill="#d4af37" opacity={0.85} />
          </g>
        );
      })}
      {phaseText && (
        <text x={(offset.left ?? 0) + 2} y={plotBottom + 50} textAnchor="start" fontSize={12} fontWeight={600} fill={phaseFill}>
          {phaseText}
        </text>
      )}
    </g>
  );
}

/** Render-Funktion für ein vertikal an einer ReferenceLine stehendes Label (z.B. Racename). */
export function vRefLabel(text: string, color = "#b8860b") {
  return (props: any) => {
    const vb = props?.viewBox || {};
    const x = (vb.x ?? 0) + 3, y = (vb.y ?? 0) + 5;
    return (
      <text x={x} y={y} fill={color} fontSize={9} textAnchor="start" transform={`rotate(90, ${x}, ${y})`}>{text}</text>
    );
  };
}
