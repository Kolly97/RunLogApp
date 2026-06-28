// Signature-Hero (Premium-Politur M4): die Form-Trajektorie der letzten ~6 Wochen als fließendes Band oben am
// Dashboard. CTL (Fitness) als gefüllte Gradient-Fläche, ATL (Ermüdung) als feine Linie — die Lücke dazwischen IST
// die Form (TSB). „heute"-Marke + große aktuelle Kennzahlen. GSAP-Draw-on beim Laden; reduced-motion → statisch.
import { useEffect, useRef } from "react";
import { useMotion, useCountUp, gsap } from "../lib/motion.ts";
import { currentSeason } from "./SeasonalDecor.tsx";

interface FP { date: string; ctl: number; atl: number; tsb: number }

// Catmull-Rom → glatter SVG-Pfad (premium-weiche Kurve).
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export default function FormRibbon({ points }: { points: FP[] }) {
  const motion = useMotion();
  const ref = useRef<SVGSVGElement>(null);
  const pts = points.slice(-42);
  const cur = pts[pts.length - 1];
  const ctlNow = useCountUp(cur?.ctl ?? 0);
  const tsbNow = useCountUp(cur?.tsb ?? 0);

  const W = 1000, H = 132, padY = 16;
  const vals = pts.flatMap((p) => [p.ctl, p.atl]);
  const lo = Math.min(...vals, 0), hi = Math.max(...vals, 1), span = Math.max(1, hi - lo);
  const x = (i: number) => (pts.length < 2 ? W : (i / (pts.length - 1)) * W);
  const y = (v: number) => H - padY - ((v - lo) / span) * (H - 2 * padY);
  const ctlPts = pts.map((p, i) => [x(i), y(p.ctl)] as [number, number]);
  const atlPts = pts.map((p, i) => [x(i), y(p.atl)] as [number, number]);
  const ctlLine = smooth(ctlPts);
  const ctlArea = pts.length ? `${ctlLine} L${W},${H} L0,${H} Z` : "";
  const winter = currentSeason() === "winter"; // M7: Skifahrer gleitet im Winter die CTL-Kurve hinab
  const atlLine = smooth(atlPts);
  const tsbCol = (cur?.tsb ?? 0) > 5 ? "var(--ok)" : (cur?.tsb ?? 0) < -25 ? "var(--danger)" : (cur?.tsb ?? 0) < -10 ? "var(--warn)" : "var(--fitness)";

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const ctlPath = svg.querySelector<SVGPathElement>(".fr-ctl");
    const atlPath = svg.querySelector<SVGPathElement>(".fr-atl");
    const area = svg.querySelector<SVGPathElement>(".fr-area");
    const marker = svg.querySelector<SVGGElement>(".fr-marker");
    if (!motion) { gsap.set([ctlPath, atlPath, area, marker], { clearProps: "all" }); return; }
    const tl = gsap.timeline();
    for (const path of [ctlPath, atlPath]) {
      if (!path) continue;
      const len = path.getTotalLength();
      gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
      tl.to(path, { strokeDashoffset: 0, duration: 1.1, ease: "power2.out" }, path === atlPath ? 0.15 : 0);
    }
    if (area) tl.fromTo(area, { opacity: 0 }, { opacity: 1, duration: 1.0, ease: "power1.out" }, 0.2);
    if (marker) tl.fromTo(marker, { opacity: 0, scale: 0.7, transformOrigin: "center" }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(2)" }, 0.9);
    // Skifahrer (Winter): gleitet entlang der gesampelten CTL-Punkte hinab, fadet am Ende aus.
    const skier = svg.querySelector<SVGTextElement>(".fr-skier");
    if (skier && winter && ctlPts.length > 1) {
      const proxy = { i: 0 };
      gsap.set(skier, { x: ctlPts[0][0], y: ctlPts[0][1] - 7, opacity: 0 });
      tl.to(skier, { opacity: 1, duration: 0.3 }, 0.4);
      tl.to(proxy, { i: ctlPts.length - 1, duration: 2.6, ease: "power1.inOut", onUpdate: () => {
        const a = Math.floor(proxy.i), b = Math.min(a + 1, ctlPts.length - 1), f = proxy.i - a;
        const x = ctlPts[a][0] + (ctlPts[b][0] - ctlPts[a][0]) * f;
        const y = ctlPts[a][1] + (ctlPts[b][1] - ctlPts[a][1]) * f;
        gsap.set(skier, { x, y: y - 7 });
      } }, 0.4);
      tl.to(skier, { opacity: 0, duration: 0.45 }, 2.9);
    }
    return () => { tl.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion, pts.length, cur?.date]);

  if (pts.length < 2) return null;

  return (
    <div className="form-ribbon">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} style={{ display: "block" }}>
        <defs>
          <linearGradient id="frGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--fitness)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--fitness)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path className="fr-area" d={ctlArea} fill="url(#frGrad)" stroke="none" />
        <path className="fr-atl" d={atlLine} fill="none" stroke="var(--fatigue)" strokeWidth={2} strokeOpacity={0.55} strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
        <path className="fr-ctl" d={ctlLine} fill="none" stroke="var(--fitness)" strokeWidth={2.4} vectorEffect="non-scaling-stroke" />
        <g className="fr-marker">
          <circle cx={x(pts.length - 1)} cy={y(cur.ctl)} r={4.5} fill="var(--fitness)" />
        </g>
        {winter && motion && <text className="fr-skier seasonal-decor" fontSize={11} textAnchor="middle" style={{ opacity: 0 }}>⛷️</text>}
      </svg>
      <div className="form-ribbon-overlay">
        <div><div className="frv" style={{ color: "var(--fitness)" }}>{ctlNow}</div><div className="frl">Fitness (CTL)</div></div>
        <div><div className="frv" style={{ color: tsbCol }}>{tsbNow > 0 ? "+" : ""}{tsbNow}</div><div className="frl">Form (TSB)</div></div>
      </div>
    </div>
  );
}
