// Cineastischer Intro (Premium-Politur M6): zeigt bei JEDEM App-Start (Seitenaufruf / Electron-Launch) —
// Brand-Reveal + „Form"-Linie als GSAP-Timeline. Skippbar (Klick/Esc/Button).
// reduced-motion bzw. Animationen-aus → komplett übersprungen. Druckt nicht.
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
    const brand = root.querySelector<HTMLDivElement>(".intro-brand");
    const tag = root.querySelector<HTMLDivElement>(".intro-tag");
    const path = root.querySelector<SVGPathElement>(".intro-line");
    const tl = gsap.timeline();
    tl.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" });
    if (brand) tl.fromTo(brand, { y: 14, opacity: 0, filter: "blur(6px)" }, { y: 0, opacity: 1, filter: "blur(0px)", duration: 0.7, ease: "power2.out" }, 0.15);
    if (path) {
      const len = path.getTotalLength();
      gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
      tl.to(path, { strokeDashoffset: 0, duration: 1.1, ease: "power2.inOut" }, 0.45);
    }
    if (tag) tl.fromTo(tag, { opacity: 0 }, { opacity: 1, duration: 0.5 }, 1.0);
    tl.to({}, { duration: 0.9 }); // kurz halten, dann selbst schließen
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
        <div className="intro-brand">Run<span>Log</span></div>
        <svg className="intro-svg" viewBox="0 0 320 56" preserveAspectRatio="none" aria-hidden="true">
          <path className="intro-line" d="M0,42 C60,42 70,12 120,16 C170,20 180,38 220,31 C262,25 280,9 320,11"
            fill="none" stroke="var(--fitness)" strokeWidth={2.4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="intro-tag tiny muted">Training · Analyse · Form</div>
      </div>
      <button type="button" className="intro-skip tiny" onClick={dismiss}>Überspringen</button>
    </div>
  );
}
