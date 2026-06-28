// Lab Mode (Premium-Politur M7 Easter Egg, sehr versteckt 🕵️): die Konami-Sequenz ↑↑↓↓←→←→ öffnet ein cleanes
// Panel mit Lifetime-Kennzahlen + augenzwinkernden Vergleichen (Erdumrundung, Mount Everest, Pizzen). Read-only
// aus /api/overview. Schließbar (Esc/Klick). GSAP-Einblendung gegated; rendert sonst nichts. Druckt nicht.
import { useEffect, useRef, useState } from "react";
import { api, type Overview } from "../lib/api.ts";
import { useMotion, gsap } from "../lib/motion.ts";

const SEQ = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight"];
const EARTH_KM = 40075;   // Äquator-Umfang
const EVEREST_M = 8849;   // Gipfelhöhe
const PIZZA_KCAL = 1200;  // grobe Pizza (Margherita+)

function nf(n: number, frac = 0): string { return n.toLocaleString("de-DE", { minimumFractionDigits: frac, maximumFractionDigits: frac }); }

export default function KonamiLab() {
  const motion = useMotion();
  const [data, setData] = useState<Overview | null>(null);
  const [open, setOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Tastatur-Sequenz global belauschen (Eingaben in Feldern ignorieren).
  useEffect(() => {
    let pos = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      pos = e.key === SEQ[pos] ? pos + 1 : (e.key === SEQ[0] ? 1 : 0);
      if (pos === SEQ.length) {
        pos = 0;
        api.overview().then((d) => { setData(d); setOpen(true); }).catch(() => { /* still ignorieren */ });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    if (card && motion) gsap.fromTo(card, { y: 18, opacity: 0, scale: 0.96 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: "power3.out" });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, motion]);

  if (!open || !data) return null;
  const km = data.dist_m / 1000;
  const days = Math.floor(data.moving_s / 86400);
  const hours = Math.floor((data.moving_s % 86400) / 3600);
  const tiles: { emoji: string; value: string; label: string; sub: string }[] = [
    { emoji: "🌍", value: `${nf(km)} km`, label: "Gesamtdistanz", sub: `${nf((km / EARTH_KM) * 100, 1)} % um die Erde` },
    { emoji: "🏔️", value: `${nf(data.elev_m)} m`, label: "Höhenmeter", sub: `${nf(data.elev_m / EVEREST_M, 1)}× Mount Everest` },
    { emoji: "⏱️", value: days > 0 ? `${days} T ${hours} h` : `${hours} h`, label: "Bewegungszeit", sub: `${nf(data.n)} Einheiten` },
    { emoji: "🔥", value: nf(data.kcal), label: "Kalorien", sub: `≈ ${nf(data.kcal / PIZZA_KCAL)} Pizzen` },
  ];

  return (
    <div className="lab-overlay no-print" onClick={() => setOpen(false)}>
      <div className="lab-card" ref={cardRef} onClick={(e) => e.stopPropagation()}>
        <div className="lab-head">
          <span className="lab-badge">LAB MODE</span>
          <span className="tiny muted">Dein Lauf-Universum in Zahlen</span>
        </div>
        <div className="lab-grid">
          {tiles.map((t) => (
            <div key={t.label} className="lab-tile">
              <div className="lab-emoji">{t.emoji}</div>
              <div className="lab-value">{t.value}</div>
              <div className="lab-label">{t.label}</div>
              <div className="lab-sub tiny muted">{t.sub}</div>
            </div>
          ))}
        </div>
        <button className="sm primary" onClick={() => setOpen(false)} style={{ marginTop: 14 }}>Schließen</button>
      </div>
    </div>
  );
}
