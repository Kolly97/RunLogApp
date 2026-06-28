// Cineastischer Intro (Premium-Politur M6): zeigt bei JEDEM App-Start (Seitenaufruf / Electron-Launch).
// T17 (WP-B): Der Läufer joggt entlang der „Form"-Kurve und endet IM echten App-Icon — das Icon springt
// genau dann mit einem satten Pop ein (als würde der Läufer zum Icon werden). Danach Tagline.
// Skippbar (Klick/Esc/Button). reduced-motion bzw. Animationen-aus → komplett übersprungen. Druckt nicht.
import { useEffect, useRef, useState } from "react";
import { useMotion, gsap } from "../lib/motion.ts";

export default function Intro() {
  const motion = useMotion();
  // Zeigt bei jedem frischen Mount (= App-Start); bei reduced-motion/Animationen-aus sofort weg.
  const [show, setShow] = useState<boolean>(motion);
  const rootRef = useRef<HTMLDivElement>(null);

  function dismiss() { setShow(false); }

  useEffect(() => {
    if (!show) return;
    const root = rootRef.current;
    if (!root) return;
    const icon = root.querySelector<HTMLElement>(".intro-icon");
    const tag = root.querySelector<HTMLElement>(".intro-tag");
    const path = root.querySelector<SVGPathElement>(".intro-line");
    const runner = root.querySelector<HTMLElement>(".intro-runner");
    const svg = root.querySelector<SVGSVGElement>(".intro-svg");
    const stage = root.querySelector<HTMLElement>(".intro-stage");

    const tl = gsap.timeline();
    tl.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" });

    // Icon startet unsichtbar/geschrumpft — es „fängt" den Läufer am Kurvenende auf.
    if (icon) gsap.set(icon, { scale: 0, opacity: 0, transformOrigin: "50% 50%" });

    // Form-Kurve zeichnet sich (Speed-Linien-Motiv aus dem Icon).
    if (path) {
      const len = path.getTotalLength();
      gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
      tl.to(path, { strokeDashoffset: 0, duration: 1.0, ease: "power2.inOut" }, 0.3);
    }

    // T17: Läufer folgt der Form-Kurve. SVG-Koordinaten (viewBox 320×56) → Stage-px via getBoundingClientRect.
    if (runner && path && svg && stage) {
      const len = path.getTotalLength();
      const svgRect = svg.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      // preserveAspectRatio="none" → lineares Mapping: SVG-Punkt → Stage-relative Pixel.
      const svgPt = (t: number): { left: number; top: number } => {
        const pt = path.getPointAtLength(t * len);
        return {
          left: svgRect.left - stageRect.left + (pt.x / 320) * svgRect.width,
          top: svgRect.top - stageRect.top + (pt.y / 56) * svgRect.height,
        };
      };
      const start = svgPt(0);
      // xPercent/yPercent: Emoji-Unterkante mittig auf dem Pfadpunkt. scaleX:-1 spiegelt das 🏃 (schaut sonst
      // nach links, läuft aber nach rechts) → es rennt in Laufrichtung.
      gsap.set(runner, { xPercent: -50, yPercent: -100, left: start.left, top: start.top, opacity: 0, scaleX: -1, scaleY: 1 });
      tl.to(runner, { opacity: 1, duration: 0.18 }, 0.55);
      // Proxy-Tween: kein MotionPath-Plugin nötig — t∈[0,1] interpoliert, onUpdate setzt left/top.
      const proxy = { t: 0 };
      tl.to(proxy, {
        t: 1, duration: 1.1, ease: "power1.inOut",
        onUpdate: () => {
          const pos = svgPt(proxy.t);
          gsap.set(runner, { left: pos.left, top: pos.top });
        },
      }, 0.55);

      // Läufer leapt vom Kurvenende ins Icon-Zentrum und schrumpft hinein.
      const iconRect = icon?.getBoundingClientRect();
      const target = iconRect
        ? { left: iconRect.left - stageRect.left + iconRect.width / 2, top: iconRect.top - stageRect.top + iconRect.height / 2 }
        : svgPt(1);
      tl.to(runner, { left: target.left, top: target.top, scaleX: -0.4, scaleY: 0.4, opacity: 0, duration: 0.34, ease: "power2.in" }, 1.65);
    }

    // Icon springt genau beim „Eintreffen" des Läufers mit satter Feder ein.
    if (icon) tl.to(icon, { scale: 1, opacity: 1, duration: 0.55, ease: "back.out(1.7)" }, 1.78);
    if (tag) tl.fromTo(tag, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, 2.25);

    tl.to({}, { duration: 0.7 }); // kurz halten, dann selbst schließen
    tl.eventCallback("onComplete", dismiss);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => { tl.kill(); window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!show) return null;
  return (
    <div className="intro-overlay no-print" ref={rootRef} onClick={dismiss}>
      <div className="intro-stage" onClick={(e) => e.stopPropagation()}>
        {/* Echtes App-Icon als Ziel/Hero — GSAP poppt es ein, wenn der Läufer eintrifft. */}
        <img className="intro-icon" src="/RunLog_app_icon.png" alt="RunLog" draggable={false} />
        <svg className="intro-svg" viewBox="0 0 320 56" preserveAspectRatio="none" aria-hidden="true">
          <path className="intro-line" d="M0,42 C60,42 70,12 120,16 C170,20 180,38 220,31 C262,25 280,9 320,11"
            fill="none" stroke="var(--fitness)" strokeWidth={2.4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* T17: Läufer-Emoji — GSAP positioniert ihn, startet mit opacity:0 */}
        <span className="intro-runner" aria-hidden="true">🏃</span>
        <div className="intro-tag tiny muted">Training · Analyse · Form</div>
      </div>
      <button type="button" className="intro-skip tiny" onClick={dismiss}>Überspringen</button>
    </div>
  );
}
