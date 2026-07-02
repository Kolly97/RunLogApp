// Coachmark-Tour (v1.10.0): zwei seitenübergreifende geführte Touren, die echte Marker der App hervorheben
// (Spotlight per data-tour-Selector). Robust: Element wird erst nach Einscrollen verifiziert + nachgemessen
// (kein falsches Highlight); fehlt es ganz, wird der Schritt zentriert gezeigt. Start über startTour(tour?) —
// ohne Argument erscheint die Auswahl. Auto-Start beim ersten Tutorial-Besuch.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.ts";

type TourKey = "whatis" | "profit";
export function startTour(tour?: TourKey) { window.dispatchEvent(new CustomEvent("runlog-tour", { detail: tour ?? null })); }

type Step = { route: string; selector?: string; title: string; body: string };

// Tour 1 — „Was ist was": jede wichtige Kennzahl/Grafik einmal erklärt.
const TOUR_WHATIS: Step[] = [
  { route: "/", selector: "[data-tour='pmc']", title: "Form-Management (PMC)", body: "CTL = Fitness (42-Tage-Last) · ATL = Ermüdung (7 Tage) · TSB = Form (CTL−ATL). Richtwerte: TSB über +5 frisch, −10 bis −25 produktiv müde, unter −25 Risiko." },
  { route: "/", title: "Dashboard — heute", body: "Oben siehst du Readiness, die heutige Empfehlung und — falls ein Ziel-Rennen mit Wunschzeit gesetzt ist — den Soll/Ist-Abgleich." },
  { route: "/plan", selector: "[data-tour='week-pmc']", title: "Wochen-Form & Ramp", body: "Fitness, Ermüdung und Form der Woche plus CTL-Ramp. Aufbau +3 bis +6/Woche ist nachhaltig — über +8 zu steil (Verletzungsrisiko)." },
  { route: "/plan", selector: "[data-tour='readiness']", title: "Readiness-Vorschlag", body: "Bei schwachen HRV-/Schlaf-Werten schlägt RunLog vor, die nächste harte Einheit zu entschärfen oder Recovery zu wählen — beratend, nie automatisch." },
  { route: "/plan", title: "Wochen-Vorschlag", body: "Der Wochen-Vorschlag baut konkrete Einheiten (Tag · Dauer · Pace · Zonen). Die Phase-Pille ist klickbar; die Paces wachsen Richtung Wunsch-Zielzeit." },
  { route: "/coach", selector: "[data-tour='optimal-zones']", title: "Optimale Zonen", body: "Pace/HF/Watt-Zonen aus VDOT/CS, LTHR/Laktat und Critical Power. Mit Übernehmen werden sie dein aktives Zonen-Set — deine manuellen Zonen bleiben erhalten." },
  { route: "/coach", title: "Wettkampf-Block & eigene Einheiten", body: "Im Coach planst du den kompletten Block bis zum Renntag (inkl. Taper + Erholung), legst Vorlieben fest und baust eigene Einheiten." },
  { route: "/track", title: "Tracking & Plan-Erfüllung", body: "Strava-Importe + manuelle Einträge. Jede Aktivität wird automatisch der passenden geplanten Einheit zugeordnet (manuell überschreibbar) → Plan-%." },
  { route: "/report", title: "Wochenbericht", body: "Diese Woche im Detail: Zonen-Verteilung (Zeit-in-Zone), TSS nach Typ und die Wochen-Checks als Ampel. Oben VO₂max + der PMC-Streifen." },
  { route: "/bests", selector: "[data-tour='power']", title: "Leistungsmarker", body: "Aus Bestzeiten: VDOT/VO₂max + Renn-Prognose. Aus den Lauf-Watt: Critical Power und W′ (anaerobe Reserve oberhalb CP)." },
  { route: "/longterm", selector: "[data-tour='threshold-trend']", title: "Schwellen-Trend", body: "Schwellen-Pace (schneller = oben) und Critical Power über die Zeit. Steigende Schwelle = die Fitness wächst." },
  { route: "/longterm", title: "Wellness mit Normalbereich", body: "HRV, Ruhepuls, Recovery, Strain, Schlaf — mit 30-Tage-Normalbereich (Band). Lange Zeiträume werden auf 7-Tage-Mittel geglättet." },
  { route: "/methodik", title: "Research-Lab", body: "Vier Tabs trennen Status, Beobachtungs-ML, randomisierte Experimente und Zyklus. Korrelationen bleiben Hypothesen; nur prospektiv randomisierte Trials können später als geprüft gelten." },
];

// Tour 2 — „Wie profitiere ich": erzählerisch anhand der Tutorial-Person (Mara Demo), wie man die Daten nutzt.
const TOUR_PROFIT: Step[] = [
  { route: "/", selector: "[data-tour='pmc']", title: "Form lesen wie Mara", body: "Maras CTL steigt über die Wochen — die Fitness wächst. Die Form (TSB) verrät, ob sie frisch oder müde ist: produktiv müde (−10 bis −25) baut auf, vor dem Rennen tapert sie sie nach oben." },
  { route: "/plan", selector: "[data-tour='week-pmc']", title: "Aufbau kontrollieren", body: "Steuere die CTL-Ramp: Mara baut mit +3 bis +6/Woche auf — schnell genug für Fortschritt, langsam genug, um gesund zu bleiben. Über +8 würde es riskant." },
  { route: "/plan", selector: "[data-tour='readiness']", title: "Auf den Körper hören", body: "Sind Maras HRV/Schlaf schwach, entschärft sie die nächste harte Einheit statt sie durchzuziehen — so beugt sie Überlastung/Krankheit vor, ohne den Plan zu sprengen." },
  { route: "/coach", selector: "[data-tour='optimal-zones']", title: "Richtig dosieren", body: "Mara trainiert in den berechneten Zonen: Easy wirklich locker (Erholung + Fettstoffwechsel), Schwelle exakt an der Schwelle. Falsche Intensität = vergeudete Tage." },
  { route: "/coach", title: "Den großen Bogen planen", body: "Mara plant den Block bis zum Halbmarathon mit Taper + Erholung. Ein Test-Wettkampf zwischendrin zeigt ihr, ob sie auf Kurs zur Zielzeit ist — ohne voll dafür zu tapern." },
  { route: "/longterm", selector: "[data-tour='threshold-trend']", title: "Wirkt das Training?", body: "Der ehrlichste Check: Maras Schwellen-Pace wird über die Monate schneller und ihre aerobe Effizienz steigt — das Training greift. Stagnation hieße: etwas ändern." },
  { route: "/bests", selector: "[data-tour='power']", title: "Fortschritt messen", body: "Bestzeiten → VDOT/VO₂max, Lauf-Watt → CP/W′. Steigen sie, verbessert sich auch Maras Renn-Prognose. So sieht sie schwarz auf weiß, dass sie besser wird." },
  { route: "/methodik", title: "Was wirkt bei DIR?", body: "RunLog trennt Hypothesen aus Beobachtungsdaten von geprüften N-of-1-Trials. Mara startet nur Vorschläge, die nach Datenlage, Nutzen, Dauer, Risiko und Erklärbarkeit sinnvoll gerankt sind." },
  { route: "/lernen", title: "Das Zusammenspiel", body: "Fähigkeit (VDOT/CS/CP) setzt deine Zonen → Zonen erzeugen Last (TSS) → Last formt über Wochen deine Form (PMC) → Readiness entscheidet den nächsten Tag. Wer diesen Kreis liest, steuert sein Training datenbasiert." },
];

const TOURS: Record<TourKey, { label: string; steps: Step[] }> = {
  whatis: { label: "Was ist was", steps: TOUR_WHATIS },
  profit: { label: "Wie profitiere ich", steps: TOUR_PROFIT },
};

export default function Coachmark() {
  const nav = useNavigate();
  const [active, setActive] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [tourKey, setTourKey] = useState<TourKey | null>(null);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const raf = useRef(0);
  const steps = tourKey ? TOURS[tourKey].steps : [];
  const step: Step | undefined = steps[idx];

  useEffect(() => {
    const onStart = (e: Event) => {
      const k = (e as CustomEvent).detail as TourKey | null;
      if (k && TOURS[k]) { setTourKey(k); setIdx(0); setChoosing(false); setActive(true); }
      else { setChoosing(true); setTourKey(null); setActive(true); }
    };
    window.addEventListener("runlog-tour", onStart);
    return () => window.removeEventListener("runlog-tour", onStart);
  }, []);

  // Beim ersten Öffnen des Tutorial-Profils die Tour-Auswahl automatisch zeigen (einmalig).
  useEffect(() => {
    api.profiles().then((r) => {
      const act = r.profiles.find((p) => p.id === r.active);
      if ((act?.name === "Tutorial: Mara" || act?.name === "Tutorial") && !localStorage.getItem("runlog-tour-tutorial")) {
        try { localStorage.setItem("runlog-tour-tutorial", "1"); } catch { /* ignore */ }
        window.setTimeout(() => { setChoosing(true); setActive(true); }, 900);
      }
    }).catch(() => { /* ignore */ });
  }, []);

  // Pro Schritt: zur Seite, Element finden, INSTANT einscrollen, dann mehrere Frames nachmessen (Layout/Charts
  // setzen sich erst → ohne Nachmessen landet der Spotlight am falschen Element).
  useEffect(() => {
    if (!active || choosing || !step) return;
    setRect(null);
    nav(step.route);
    if (!step.selector) return;
    let cancelled = false, tries = 0, settle = 0;
    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector(step.selector!);
      if (el) setRect(el.getBoundingClientRect());
      if (settle++ < 24) raf.current = requestAnimationFrame(measure); // ~0,4 s nachmessen
    };
    const find = () => {
      if (cancelled) return;
      const el = document.querySelector(step.selector!);
      if (el) { el.scrollIntoView({ block: "center", behavior: "auto" }); raf.current = requestAnimationFrame(measure); }
      else if (tries++ < 150) raf.current = requestAnimationFrame(find);
    };
    const t = window.setTimeout(() => { raf.current = requestAnimationFrame(find); }, 140); // Route-Render abwarten
    return () => { cancelled = true; cancelAnimationFrame(raf.current); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, choosing, tourKey, idx]);

  // Spotlight beim Scrollen/Resizen nachführen.
  useEffect(() => {
    if (!active || choosing || !step?.selector) return;
    const update = () => { const el = document.querySelector(step.selector!); if (el) setRect(el.getBoundingClientRect()); };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, choosing, tourKey, idx]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!active) return null;
  function close() { setActive(false); setChoosing(false); setTourKey(null); setRect(null); }
  const pick = (k: TourKey) => { setTourKey(k); setIdx(0); setChoosing(false); };

  // --- Tour-Auswahl ---
  if (choosing) {
    return (
      <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: "92vw", background: "var(--card)", borderRadius: 14, boxShadow: "0 10px 30px rgba(15,23,42,0.25)", padding: 18 }}>
          <strong style={{ fontSize: 16 }}>🎓 Geführte Tour</strong>
          <p className="tiny muted" style={{ margin: "4px 0 12px" }}>Zwei Touren — wähle, was du brauchst:</p>
          <button className="primary" style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 8 }} onClick={() => pick("whatis")}>
            <strong>Was ist was</strong><br /><span className="tiny" style={{ opacity: 0.85 }}>Jede Grafik &amp; Tabelle einmal erklärt — der komplette Rundgang.</span>
          </button>
          <button className="primary" style={{ display: "block", width: "100%", textAlign: "left" }} onClick={() => pick("profit")}>
            <strong>Wie profitiere ich</strong><br /><span className="tiny" style={{ opacity: 0.85 }}>Am Beispiel „Mara Demo": wie man Verlauf liest und sein Training steuert.</span>
          </button>
          <div style={{ textAlign: "right", marginTop: 10 }}><button className="sm ghost" onClick={close}>Schließen</button></div>
        </div>
      </div>
    );
  }
  if (!step) return null;

  const next = () => (idx < steps.length - 1 ? setIdx(idx + 1) : close());
  const prev = () => idx > 0 && setIdx(idx - 1);
  const pad = 6;
  const vw = window.innerWidth, vh = window.innerHeight;
  const TW = 350, TH = 180;
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
      {rect ? (
        <div onClick={close} style={{ position: "fixed", top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
          borderRadius: 12, boxShadow: "0 0 0 9999px rgba(15,23,42,0.55)", border: "2px solid #fff", pointerEvents: "auto", transition: "all .15s ease" }} />
      ) : (
        <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)" }} />
      )}

      <div style={{ position: "fixed", top: tipTop, left: tipLeft, width: TW, background: "var(--card)", borderRadius: 12,
        boxShadow: "0 10px 30px rgba(15,23,42,0.25)", padding: 14, zIndex: 1001 }}>
        <div className="spread" style={{ marginBottom: 4 }}>
          <strong style={{ fontSize: 14 }}>{step.title}</strong>
          <span className="tiny muted">{TOURS[tourKey!].label} · {idx + 1}/{steps.length}</span>
        </div>
        <p className="tiny" style={{ margin: "0 0 12px", lineHeight: 1.5 }}>{step.body}</p>
        <div className="spread">
          <button className="sm ghost" onClick={close}>Beenden</button>
          <span className="row" style={{ gap: 6 }}>
            {idx > 0 && <button className="sm ghost" onClick={prev}>Zurück</button>}
            <button className="sm primary" onClick={next}>{idx < steps.length - 1 ? "Weiter" : "Fertig"}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
