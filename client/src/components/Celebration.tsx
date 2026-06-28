// Celebration-System (Premium-Politur M6): edle, kurze Belohnung bei echten Erfolgen (neue Bestzeit, Zielzeit,
// Streak, Block abgeschlossen). celebrate({...}) feuert; die Komponente zeigt eine Karte + GSAP-Konfetti.
// Dezent, schließbar, auto-dismiss, reduced-motion-treu (dann nur die Karte, kein Konfetti). Druckt nicht.
import { useEffect, useRef, useState } from "react";
import { useMotion, gsap } from "../lib/motion.ts";

export interface CelebrateOpts { title: string; subtitle?: string; emoji?: string }
export function celebrate(opts: CelebrateOpts): void {
  window.dispatchEvent(new CustomEvent("runlog-celebrate", { detail: opts }));
}

const COLORS = ["#2b6cb0", "#16a34a", "#eab308", "#f97316", "#d53f8c", "#7c3aed"];

export default function Celebration() {
  // Queue: mehrere Erfolge bei einem App-Start nacheinander zeigen (sonst überschreibt der letzte alle vorigen).
  const [queue, setQueue] = useState<CelebrateOpts[]>([]);
  const opts = queue[0] ?? null;
  const motion = useMotion();
  const burstRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const dismiss = () => setQueue((q) => q.slice(1));

  useEffect(() => {
    const on = (e: Event) => setQueue((q) => [...q, (e as CustomEvent).detail as CelebrateOpts]);
    window.addEventListener("runlog-celebrate", on);
    return () => window.removeEventListener("runlog-celebrate", on);
  }, []);

  useEffect(() => {
    if (!opts) return;
    const card = cardRef.current;
    if (card && motion) gsap.fromTo(card, { y: 16, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.5)" });
    const host = burstRef.current;
    const parts: HTMLDivElement[] = [];
    if (host && motion) {
      for (let i = 0; i < 40; i++) {
        const p = document.createElement("div");
        p.className = "celebrate-piece";
        p.style.background = COLORS[i % COLORS.length];
        host.appendChild(p); parts.push(p);
        const ang = (Math.PI * 2 * i) / 40 + (i % 4) * 0.18;
        const dist = 130 + (i % 6) * 34;
        gsap.fromTo(p, { x: 0, y: 0, opacity: 1, scale: 1, rotation: 0 },
          { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist + 140, rotation: (i % 2 ? 1 : -1) * 380, opacity: 0, scale: 0.55, duration: 1.4 + (i % 4) * 0.2, ease: "power2.out" });
      }
      gsap.delayedCall(2.0, () => parts.forEach((p) => p.remove()));
    }
    const to = window.setTimeout(dismiss, motion ? 4500 : 3200);
    return () => { window.clearTimeout(to); parts.forEach((p) => p.remove()); };
  }, [opts, motion]);

  if (!opts) return null;
  return (
    <div className="celebrate-overlay no-print" onClick={dismiss}>
      <div className="celebrate-burst" ref={burstRef} />
      <div className="celebrate-card" ref={cardRef} onClick={(e) => e.stopPropagation()}>
        <div className="celebrate-emoji">{opts.emoji ?? "🎉"}</div>
        <strong>{opts.title}</strong>
        {opts.subtitle && <div className="tiny muted" style={{ marginTop: 2 }}>{opts.subtitle}</div>}
        <button className="sm primary" onClick={dismiss} style={{ marginTop: 10 }}>Schön! 🎯</button>
      </div>
    </div>
  );
}
