// Vier-Jahreszeiten-Deko (Premium-Politur M7 Easter Egg, Herzstück 👁): dezente saisonale Akzente INNERHALB der
// Plotfläche, als Recharts-<Customized>-Layer (wie ChartDecor). Saison aus dem realen Monat; ?season=… überschreibt
// zum Testen. Animation über CSS-Keyframes, gegated via motionEnabled() (App-Schalter + System reduced-motion).
// Positionen DETERMINISTISCH (Customized re-rendert bei Hover → kein Springen). Druckt nicht (.seasonal-decor).
import { motionEnabled } from "../lib/motion.ts";

export type Season = "winter" | "spring" | "summer" | "autumn";

function seasonOverride(): Season | null {
  try {
    const q = new URLSearchParams(window.location.search).get("season")
      || new URLSearchParams(window.location.hash.split("?")[1] || "").get("season");
    return q === "winter" || q === "spring" || q === "summer" || q === "autumn" ? q : null;
  } catch { return null; }
}
export function currentSeason(): Season {
  const o = seasonOverride();
  if (o) return o;
  const m = new Date().getMonth(); // 0–11
  if (m <= 1 || m === 11) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "autumn";
}

// Stabiles Pseudo-Rauschen [0,1) je (Index, Salt) — deterministisch, kein Springen bei Re-Render.
function rnd(i: number, salt: number): number { const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x); }

export default function SeasonalDecor(props: any) {
  const { offset } = props;
  if (!offset || !offset.width || !offset.height) return null;
  const { left, top, width, height } = offset;
  const season = currentSeason();
  const anim = motionEnabled();
  const fall = (i: number, salt: number, drift: number) => ({
    animationDuration: `${6 + rnd(i, salt) * 5}s`,
    animationDelay: `${-rnd(i, salt + 1) * 11}s`,
    ["--fall" as any]: `${height}px`,
    ["--drift" as any]: `${drift}px`,
  });

  let body: any = null;

  if (season === "winter") {
    body = anim
      ? Array.from({ length: 11 }, (_, i) => (
          <circle key={i} className="snow-flake" cx={left + rnd(i, 1) * width} cy={top} r={1.3 + rnd(i, 4) * 1.4}
            fill="#ffffff" style={fall(i, 2, (rnd(i, 5) - 0.5) * 46)} />
        ))
      : Array.from({ length: 6 }, (_, i) => (
          <circle key={i} cx={left + rnd(i, 1) * width} cy={top + rnd(i, 6) * height * 0.6} r={1.6}
            fill="#cbd5e1" opacity={0.7} />
        ));
  } else if (season === "spring") {
    body = (
      <>
        {/* Spross am Achsenfuß (statisch) */}
        <path d={`M${left + 8},${top + height} q 3,-12 0,-22 q 7,4 8,-2 q -2,8 -8,10`} fill="#86c06a" opacity={0.7} />
        {anim && Array.from({ length: 6 }, (_, i) => (
          <ellipse key={i} className="petal" cx={left + rnd(i, 1) * width} cy={top} rx={2.6} ry={1.5}
            fill="#f6b8d0" style={fall(i, 2, (rnd(i, 5) - 0.5) * 70)} />
        ))}
      </>
    );
  } else if (season === "summer") {
    const sx = left + width - 26, sy = top + 24;
    body = (
      <>
        <defs>
          <radialGradient id="sd-sun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fde68a" stopOpacity={0.9} />
            <stop offset="60%" stopColor="#fbbf24" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
          </radialGradient>
        </defs>
        <circle className={anim ? "sun-glow anim" : "sun-glow"} cx={sx} cy={sy} r={20} fill="url(#sd-sun)" />
        {/* feine Wellenlinie am Achsenfuß (statisch) */}
        <path d={wavePath(left, top + height - 3, width)} fill="none" stroke="#38bdf8" strokeOpacity={0.35} strokeWidth={1.4} />
      </>
    );
  } else { // autumn
    body = anim
      ? Array.from({ length: 6 }, (_, i) => (
          <ellipse key={i} className="leaf" cx={left + rnd(i, 1) * width} cy={top} rx={3} ry={1.7}
            fill={["#e07a3c", "#d4a017", "#b45309"][i % 3]} style={fall(i, 2, (rnd(i, 5) - 0.5) * 60)} />
        ))
      : Array.from({ length: 4 }, (_, i) => (
          <ellipse key={i} cx={left + (i + 1) / 5 * width} cy={top + height - 4} rx={3} ry={1.7}
            fill={["#e07a3c", "#d4a017", "#b45309"][i % 3]} opacity={0.6} transform={`rotate(${rnd(i, 7) * 40 - 20} ${left + (i + 1) / 5 * width} ${top + height - 4})`} />
        ));
  }

  return <g className="seasonal-decor">{body}</g>;
}

// Kurze Sinus-Welle als SVG-Pfad über die Plotbreite.
function wavePath(x0: number, y: number, w: number): string {
  const seg = w / 6;
  let d = `M${x0},${y}`;
  for (let i = 0; i < 6; i++) d += ` q ${seg / 2},${i % 2 ? 5 : -5} ${seg},0`;
  return d;
}
