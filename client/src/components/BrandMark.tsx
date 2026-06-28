// Brand-Mark (Premium-Politur M6, Easter Eggs — subtil & geschmackvoll, nie albern):
//  (1) Tageszeit-Begrüßung als dezenter Tooltip (title) am Logo.
//  (2) Klick aufs Logo → winziger „Lauf"-Akzent: ein Akzentpunkt sprintet einmal mit Stride-Hüpfern über den
//      Schriftzug. GSAP-gegated → bei reduced-motion/Animationen-aus passiert nichts.
import { useRef } from "react";
import { useMotion, gsap } from "../lib/motion.ts";

function greeting(h: number): string {
  if (h < 5) return "Noch wach? Schlaf ist Teil des Trainings. 🌙";
  if (h < 11) return "Guten Morgen — bereit für die Bahn? ☀️";
  if (h < 14) return "Guten Tag — Zeit für die Mittagsrunde?";
  if (h < 18) return "Guten Nachmittag — Beine locker?";
  if (h < 22) return "Guten Abend — schöner Lauf heute?";
  return "Späte Stunde — gönn dir Erholung. 🌙";
}

export default function BrandMark() {
  const motion = useMotion();
  const ref = useRef<HTMLDivElement>(null);
  const clicks = useRef(0);
  const resetTimer = useRef<number | undefined>(undefined);

  // 1–2× normaler Sprint; ab 3× schneller & größer; ab 5× rennt ein 🏃 quer durch (Eskalation).
  const sprintDot = (n: number) => {
    const dot = ref.current?.querySelector<HTMLElement>(".brand-spark");
    if (!dot) return;
    const dur = n >= 3 ? 0.5 : 0.85;
    const scale = n >= 3 ? 2 : 1;
    gsap.killTweensOf(dot);
    gsap.set(dot, { opacity: 1, left: "4%", top: "52%", scale });
    gsap.timeline()
      .to(dot, { left: "94%", duration: dur, ease: "power2.inOut" }, 0)
      .to(dot, { top: "32%", duration: dur * 0.25, ease: "sine.inOut", yoyo: true, repeat: 3 }, 0) // Stride-Hüpfer
      .to(dot, { opacity: 0, scale: scale * 0.6, duration: 0.25, ease: "power1.out" }, dur * 0.82);
  };

  const runnerSprint = () => {
    const runner = ref.current?.querySelector<HTMLElement>(".brand-runner");
    if (!runner) return;
    gsap.killTweensOf(runner);
    gsap.set(runner, { opacity: 1, left: "-14%", top: "44%" });
    gsap.timeline()
      .to(runner, { left: "104%", duration: 1.0, ease: "power1.in" }, 0)
      .to(runner, { top: "28%", duration: 0.17, ease: "sine.inOut", yoyo: true, repeat: 5 }, 0)
      .to(runner, { opacity: 0, duration: 0.3 }, 0.78);
  };

  const onRun = () => {
    if (!motion) return;
    clicks.current += 1;
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => { clicks.current = 0; }, 700);
    const n = clicks.current;
    if (n >= 5) { runnerSprint(); clicks.current = 0; return; }
    sprintDot(n);
  };

  const hour = new Date().getHours();
  return (
    <div className="brand" ref={ref} title={greeting(hour)} onClick={onRun}>
      Run<span>Log</span>
      <i className="brand-spark" aria-hidden="true" />
      <i className="brand-runner" aria-hidden="true">🏃</i>
    </div>
  );
}
