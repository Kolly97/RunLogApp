// Coachmark-Tour (v1.9.0): seitenübergreifende geführte Tour, die echte Marker der App hervorhebt (Spotlight per
// data-tour-Selector) und ihre Bedeutung + Richtwerte erklärt. Robust: fehlt ein Element, wird der Schritt zentriert
// gezeigt (kein Absturz). Start über startTour() (Lernen-Seite) oder automatisch beim ersten Tutorial-Besuch.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.ts";

export function startTour() { window.dispatchEvent(new CustomEvent("runlog-tour")); }

type Step = { route: string; selector?: string; title: string; body: string };
const STEPS: Step[] = [
  { route: "/", selector: "[data-tour='pmc']", title: "Form-Management (PMC)", body: "CTL = Fitness (42-Tage-Last) · ATL = Ermüdung (7 Tage) · TSB = Form (CTL−ATL). Richtwerte: TSB über +5 frisch, −10 bis −25 produktiv müde, unter −25 Risiko." },
  { route: "/", selector: "[data-tour='optimal-zones']", title: "Optimale Zonen", body: "Pace/HF/Watt-Zonen aus VDOT/CS, LTHR/Laktat und Critical Power berechnet. „Übernehmen“ legt sie als aktives Zonen-Set an — deine manuellen Zonen bleiben erhalten." },
  { route: "/plan", selector: "[data-tour='week-pmc']", title: "Wochen-Form & Ramp", body: "Fitness, Ermüdung und Form der Woche plus CTL-Ramp. Ein Aufbau von +3 bis +6/Woche ist nachhaltig — über +8 wird es zu steil (Verletzungsrisiko)." },
  { route: "/plan", selector: "[data-tour='readiness']", title: "Readiness-Vorschlag", body: "Bei schwachen HRV-/Schlaf-Werten schlägt RunLog vor, die nächste harte Einheit zu entschärfen oder Recovery zu wählen — beratend, nie automatisch." },
  { route: "/bests", selector: "[data-tour='power']", title: "Leistungsmarker", body: "Aus deinen Bestzeiten: VDOT/VO₂max + Renn-Prognose. Aus den Lauf-Watt: Critical Power und W′ (anaerobe Reserve oberhalb CP)." },
  { route: "/longterm", selector: "[data-tour='threshold-trend']", title: "Wirkt das Training?", body: "Schwellen-Pace (schneller = oben) und Critical Power über die Zeit. Steigende Schwelle = die Fitness wächst." },
  { route: "/methodik", title: "Was wirkt bei DIR? (N-of-1)", body: "Geführte Vorher/Nachher-Experimente + Korrelationen aus deinen eigenen Daten. Wichtig: Korrelation ≠ Kausalität — kleine Stichproben sind als explorativ markiert." },
];

export default function Coachmark() {
  const nav = useNavigate();
  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const raf = useRef(0);
  const step = STEPS[idx];

  useEffect(() => {
    const onStart = () => { setIdx(0); setActive(true); };
    window.addEventListener("runlog-tour", onStart);
    return () => window.removeEventListener("runlog-tour", onStart);
  }, []);

  // Beim ersten Öffnen des Tutorial-Profils die Tour automatisch starten (einmalig, danach nur per Knopf).
  useEffect(() => {
    api.profiles().then((r) => {
      const act = r.profiles.find((p) => p.id === r.active);
      if (act?.name === "Tutorial" && !localStorage.getItem("runlog-tour-tutorial")) {
        try { localStorage.setItem("runlog-tour-tutorial", "1"); } catch { /* ignore */ }
        window.setTimeout(() => { setIdx(0); setActive(true); }, 900);
      }
    }).catch(() => { /* ignore */ });
  }, []);

  // Pro Schritt: zur Seite navigieren, dann das Element suchen (bis ~1,5 s) und einscrollen.
  useEffect(() => {
    if (!active) return;
    setRect(null);
    nav(step.route);
    if (!step.selector) return;
    let tries = 0;
    const tick = () => {
      const el = document.querySelector(step.selector!);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setRect(el.getBoundingClientRect());
      } else if (tries++ < 90) {
        raf.current = requestAnimationFrame(tick);
      }
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, idx]);

  // Spotlight beim Scrollen/Resizen nachführen.
  useEffect(() => {
    if (!active || !step.selector) return;
    const update = () => { const el = document.querySelector(step.selector!); if (el) setRect(el.getBoundingClientRect()); };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, idx]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setActive(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  if (!active) return null;
  const close = () => setActive(false);
  const next = () => (idx < STEPS.length - 1 ? setIdx(idx + 1) : close());
  const prev = () => idx > 0 && setIdx(idx - 1);

  const pad = 6;
  const vw = window.innerWidth, vh = window.innerHeight;
  const TW = 340, TH = 168;
  let tipTop: number, tipLeft: number;
  if (rect) {
    const below = rect.bottom + 14 + TH < vh;
    tipTop = below ? rect.bottom + 14 : Math.max(12, rect.top - TH - 14);
    tipLeft = Math.min(Math.max(12, rect.left), vw - TW - 12);
  } else {
    tipTop = vh / 2 - TH / 2; tipLeft = vw / 2 - TW / 2;
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000 }}>
      {/* Backdrop / Spotlight: bei gefundenem Element Cutout per großem Box-Shadow, sonst flächiges Dimmen. */}
      {rect ? (
        <div onClick={close} style={{ position: "fixed", top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
          borderRadius: 12, boxShadow: "0 0 0 9999px rgba(15,23,42,0.55)", border: "2px solid #fff", pointerEvents: "auto", transition: "all .2s ease" }} />
      ) : (
        <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)" }} />
      )}

      <div style={{ position: "fixed", top: tipTop, left: tipLeft, width: TW, background: "#fff", borderRadius: 12,
        boxShadow: "0 10px 30px rgba(15,23,42,0.25)", padding: 14, zIndex: 1001 }}>
        <div className="spread" style={{ marginBottom: 4 }}>
          <strong style={{ fontSize: 14 }}>{step.title}</strong>
          <span className="tiny muted">{idx + 1}/{STEPS.length}</span>
        </div>
        <p className="tiny" style={{ margin: "0 0 12px", lineHeight: 1.5 }}>{step.body}</p>
        <div className="spread">
          <button className="sm ghost" onClick={close}>Beenden</button>
          <span className="row" style={{ gap: 6 }}>
            {idx > 0 && <button className="sm ghost" onClick={prev}>Zurück</button>}
            <button className="sm primary" onClick={next}>{idx < STEPS.length - 1 ? "Weiter" : "Fertig"}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
