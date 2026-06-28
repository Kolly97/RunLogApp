// Motion-Fundament (Premium-Politur M1): zentrale, GEGATETE Animations-Helfer auf GSAP-Basis.
// Jede Bewegung läuft nur, wenn useMotion() true ist → respektiert System-`prefers-reduced-motion` UND den
// globalen Aus-Schalter in den Einstellungen. Bei „aus"/reduced wird sofort der Endzustand gesetzt (kein Ruckeln).
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

export type MotionPref = "on" | "off";
const KEY = "runlog-motion";
const EVT = "runlog-motion-change";

export function getMotionPref(): MotionPref {
  try { return localStorage.getItem(KEY) === "off" ? "off" : "on"; } catch { return "on"; }
}
export function setMotionPref(p: MotionPref): void {
  try { localStorage.setItem(KEY, p); window.dispatchEvent(new Event(EVT)); } catch { /* ignore */ }
}
function systemReduced(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}
/** Bewegung erlaubt? = App-Pref „on" UND System nicht auf reduced-motion. */
export function motionEnabled(): boolean { return getMotionPref() === "on" && !systemReduced(); }

/** Reaktiver Motion-Status (App-Pref + System) für Komponenten. */
export function useMotion(): boolean {
  const [on, setOn] = useState(motionEnabled);
  useEffect(() => {
    const upd = () => setOn(motionEnabled());
    window.addEventListener(EVT, upd);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener?.("change", upd);
    return () => { window.removeEventListener(EVT, upd); mq.removeEventListener?.("change", upd); };
  }, []);
  return on;
}

const EASE = "power2.out"; // smooth-premium

/** KPI-Zahl, die beim Wertwechsel sanft hochzählt (sonst sofort). `decimals` automatisch aus dem Wert. */
export function useCountUp(value: number, opts?: { duration?: number; decimals?: number }): number {
  const motion = useMotion();
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    if (!motion || !isFinite(value)) { setDisplay(value); prev.current = value; return; }
    const obj = { v: prev.current };
    const tw = gsap.to(obj, { v: value, duration: opts?.duration ?? 0.7, ease: EASE, onUpdate: () => setDisplay(obj.v) });
    prev.current = value;
    return () => { tw.kill(); prev.current = value; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, motion]);
  const dec = opts?.decimals ?? (Number.isInteger(value) ? 0 : 1);
  const f = 10 ** dec;
  return Math.round(display * f) / f;
}

/** Gestaffelte Einblendung der direkten Kinder des Refs (Karten-Reveal beim Seitenwechsel). */
export function useReveal<T extends HTMLElement = HTMLDivElement>(deps: unknown[] = []): React.RefObject<T> {
  const ref = useRef<T>(null);
  const motion = useMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const kids = el.children;
    if (!motion || !kids.length) { gsap.set(kids, { clearProps: "opacity,transform" }); return; }
    const tw = gsap.fromTo(kids, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: EASE, stagger: 0.06, overwrite: "auto" });
    return () => { tw.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** Recharts-Animation gegatet: liefert isAnimationActive + Dauer passend zur Motion-Einstellung. */
export function drawOn(motion: boolean): { isAnimationActive: boolean; animationDuration: number; animationEasing: "ease-out" } {
  return { isAnimationActive: motion, animationDuration: motion ? 650 : 0, animationEasing: "ease-out" };
}

export { gsap };
