// Lernen-Seite (v3.3.0): „Das Handbuch" — klinisches Fachlexikon. Vollständige Erklärung aller sport-
// wissenschaftlichen Analysen, Einheiten und Abkürzungen (8 Kapitel), plus geführter Einstieg (Isabel-Tutorial +
// Daten-Kino als Übersicht). Minimalistische Linien-Piktogramme statt Emoji; Evidenz-Etiketten + Literaturanker;
// „→ ansehen"-Deeplinks zur Stelle in der App, wo der eigene Wert lebt. Ersetzt den alten Tutorial-Hub + Glossar.
import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { api, type TutorialProgress } from "../lib/api.ts";
import { startTutorial } from "../components/tutorial/TutorialHost.tsx";
import { SECTIONS, isUnlocked } from "../components/tutorial/sections.ts";
import { CINEMA_READY } from "../components/tutorial/cinema/meta.ts";
import { OverlayPortal } from "../components/tutorial/ui.tsx";
import type { CinemaChartId } from "../components/tutorial/types.ts";

const ChartCinema = lazy(() => import("../components/tutorial/cinema/ChartCinema.tsx"));

// ---- Piktogramm-Sprite (minimalistische Linien-Icons, currentColor → theme-fähig, ein Sprite pro Seite) ----
function LxSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <symbol id="i-start" viewBox="0 0 24 24"><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><circle cx="10" cy="9" r="2.2" /><circle cx="15" cy="15" r="2.2" /></symbol>
      <symbol id="i-plan" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2" /><line x1="4" y1="9.5" x2="20" y2="9.5" /><line x1="8.5" y1="3" x2="8.5" y2="6.5" /><line x1="15.5" y1="3" x2="15.5" y2="6.5" /></symbol>
      <symbol id="i-analyse" viewBox="0 0 24 24"><path d="M9.5 3h5" /><path d="M10.5 3.5v5.5l-4 7.2a2 2 0 0 0 1.75 3h7.5a2 2 0 0 0 1.75-3l-4-7.2V3.5" /><line x1="8.2" y1="14.5" x2="15.8" y2="14.5" /></symbol>
      <symbol id="i-coach" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z" /></symbol>
      <symbol id="i-nerd" viewBox="0 0 24 24"><path d="M5 4v15h15" /><path d="M6 16c3.5 0 4.5-9 8.5-9 2 0 3 2 4.5 2" /></symbol>
      <symbol id="i-pmc" viewBox="0 0 24 24"><path d="M5 4v15h15" /><polyline points="6,15 10,9 13,12 19,6" /></symbol>
      <symbol id="i-latent" viewBox="0 0 24 24"><path d="M4 13c3-7 6 7 8 0s5-7 8 0" /></symbol>
      <symbol id="i-forest" viewBox="0 0 24 24"><line x1="4" y1="7" x2="15" y2="7" /><circle cx="9.5" cy="7" r="1.5" /><line x1="7" y1="12" x2="20" y2="12" /><circle cx="13.5" cy="12" r="1.5" /><line x1="4" y1="17" x2="13" y2="17" /><circle cx="8.5" cy="17" r="1.5" /></symbol>
      <symbol id="i-wellness" viewBox="0 0 24 24"><path d="M20 13.5A7.5 7.5 0 1 1 10.5 4a6 6 0 0 0 9.5 9.5z" /></symbol>
      <symbol id="i-readiness" viewBox="0 0 24 24"><path d="M12 20S5 15.3 5 10a3.8 3.8 0 0 1 7-2 3.8 3.8 0 0 1 7 2c0 5.3-7 10-7 10z" /><polyline points="8,12 10.5,12 12,9.5 13.5,13.5 15,12 16,12" /></symbol>
      <symbol id="i-threshold" viewBox="0 0 24 24"><polyline points="4,17 9,17 9,9 15,9 15,13 20,13" /></symbol>
      <symbol id="i-power" viewBox="0 0 24 24"><path d="M13 3L6 13h5l-1 8 9-11h-5l1-7z" /></symbol>
      <symbol id="i-vo2" viewBox="0 0 24 24"><path d="M4.5 17a7.5 7.5 0 0 1 15 0" /><line x1="12" y1="17" x2="15.5" y2="11.5" /><circle cx="12" cy="17" r="1.2" /></symbol>
      <symbol id="i-cycle" viewBox="0 0 24 24"><path d="M5 12a7 7 0 0 1 12-4.9" /><polyline points="17,3.5 17,7.5 13,7.5" /><path d="M19 12a7 7 0 0 1-12 4.9" /><polyline points="7,20.5 7,16.5 11,16.5" /></symbol>
      <symbol id="i-nof1" viewBox="0 0 24 24"><path d="M4 8h3.5l9 8H20" /><path d="M4 16h3.5l2.2-2" /><path d="M20 8l-2.2 2" /><polyline points="17,5 20,8 17,11" /><polyline points="17,13 20,16 17,19" /></symbol>
      <symbol id="i-lock" viewBox="0 0 24 24"><rect x="6" y="11" width="12" height="9" rx="2" /><path d="M9 11V8a3 3 0 0 1 6 0v3" /></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><polyline points="5,12.5 10,17.5 19,7" /></symbol>
    </svg>
  );
}
function Ico({ n, sm }: { n: string; sm?: boolean }) {
  return <svg className={sm ? "lx-ico lx-ico-sm" : "lx-ico"} aria-hidden="true"><use href={`#${n}`} /></svg>;
}

// Tutorial-Abschnitt (id) → Piktogramm · Kino-Szene (chart id) → Piktogramm + emoji-freies Label.
const TUT_ICON: Record<string, string> = { start: "i-start", plan: "i-plan", analyse: "i-analyse", coach: "i-coach", nerd: "i-nerd" };
const KINO_ICON: Partial<Record<CinemaChartId, string>> = { pmc: "i-pmc", latent: "i-latent", dose: "i-forest", wellness: "i-wellness", readiness: "i-readiness", threshold: "i-threshold", power: "i-power", vo2: "i-vo2", cycle: "i-cycle", nof1: "i-nof1" };
const KINO_LABEL: Partial<Record<CinemaChartId, string>> = { pmc: "Formkurve (PMC)", latent: "Latente Fitness", dose: "Reizkanäle (Was wirkt?)", wellness: "Wellness-Signale", readiness: "Readiness & Gesundheit", threshold: "Schwellen-Trend", power: "Lauf-Power (CP · W′)", vo2: "Eff. VO₂max je Lauf", cycle: "Zyklus: Phase × Reiz", nof1: "N-of-1: der Beweis" };

// ---- Lexikon-Datenmodell ----
type Ev = "rct" | "obs" | "konv" | "mod";
type Rng = { band: [number, number]; labels: [string, string, string]; hi: number };
type Dist = { segs: [number, string][]; text: string; ev: Ev; evLabel?: string; cite: string };
type Entry = {
  term: string; abbr?: string; unit?: string; def: string;
  richtwert?: string; range?: Rng; zones?: boolean; dist?: Dist;
  use?: string; link?: [string, string];
  sci?: { ev: Ev; txt?: string; cite: string };
};
type Chapter = { id: string; n: string; title: string; hue: string; note?: string; scaffold?: boolean; status?: string; entries: Entry[] };

const EVI_LABEL: Record<Ev, string> = { rct: "RCT / Meta", obs: "Beobachtung", konv: "Konvention", mod: "Modell" };
const ZONES: [number, string][] = [[34, "#60a5fa"], [24, "#34d399"], [10, "#a3e635"], [12, "#facc15"], [10, "#fb923c"], [6, "#ef4444"]];

const CHAPTERS: Chapter[] = [
  {
    id: "last", n: "01", title: "Trainingslast & Form", hue: "var(--lx-load)",
    note: "Wie viel du trägst — von der einzelnen Einheit (TSS) bis zu Fitness, Ermüdung und Form über Wochen (PMC).",
    entries: [
      { term: "Training Stress Score", abbr: "TSS", unit: "Dauer × Intensität²", def: "Ein Maß für die Gesamtbelastung einer Einheit. 100 TSS = eine Stunde exakt an der Schwelle.", range: { band: [8, 30], labels: ["Easy ~40–60/h", "Schwelle ~90–100/h", "Rennen 60–130"], hi: 1 }, use: "geräteneutral, für den Lauf bewusst aus Pace/NGP — nicht aus dem Uhren-Wert (z. B. COROS Load).", link: ["Tracking", "/track"] },
      { term: "TSS-Varianten", abbr: "rTSS · Power-TSS · hrTSS", def: "Dieselbe Größe, je nach Datenlage anders gerechnet: Lauf aus NGP/Pace (rTSS), Rad aus Power/FTP über NP (Power-TSS), sonst aus der Herzfrequenz (hrTSS).", use: "manueller TSS wird immer respektiert; Lauf priorisiert Pace/NGP.", link: ["Einstellungen", "/settings"] },
      { term: "Intensitätsfaktor", abbr: "IF", unit: "Anteil der Schwelle", def: "Wie hart eine Einheit relativ zur Schwellenleistung war (1,0 = Schwelle).", richtwert: "Easy ~0,70 · Marathon ~0,85 · Schwelle ~0,95–1,0 · 5 km ~1,05" },
      { term: "Normalized Power", abbr: "NP", unit: "Watt (Rad)", def: "Gewichtete Ø-Leistung, die stark schwankende Belastung physiologisch ehrlicher abbildet als reine Durchschnittswatt. Basis des Power-TSS über die FTP." },
      { term: "Normalized Graded Pace", abbr: "NGP", unit: "min/km, steigungs-korr.", def: "Steigungs-bereinigte Pace (Minetti-Kostenmodell) — vergleichbar über hügelige Strecken. Grundlage von Lauf-TSS und aerober Entkopplung.", use: "aus den Streams jeder Aktivität.", link: ["Tracking", "/track"] },
      { term: "CTL — Fitness", abbr: "CTL", unit: "42-Tage-EWMA", def: "Chronische Last: exponentieller 42-Tage-Schnitt deiner TSS. Steigt langsam, fällt langsam — deine Belastbarkeit.", richtwert: "nachhaltiger Aufbau +3 bis +6 CTL/Woche.", link: ["Dashboard", "/"] },
      { term: "ATL — Ermüdung", abbr: "ATL", unit: "7-Tage-EWMA", def: "Akute Last: 7-Tage-Schnitt der TSS. Reagiert schnell auf harte Tage — kurzfristige Spitzen sind normal, entscheidend ist die Erholung danach." },
      { term: "TSB — Form", abbr: "TSB", unit: "CTL − ATL (gestern)", def: "Trainings-Stress-Balance: wie frisch oder müde du bist.", range: { band: [34, 44], labels: ["< −25 Risiko", "−10…−25 produktiv", "+15…+25 Rennform"], hi: 1 }, use: "Sicherung: die Form fällt im Plan nie unter TSB −30.", link: ["Dashboard", "/"] },
      { term: "CTL-Ramp", abbr: "Ramp", unit: "ΔCTL / Woche", def: "Wie schnell die Fitness steigt.", richtwert: "3–6/Woche nachhaltig · > +8 zu steil → Verletzungs-/Übertrainingsrisiko. RunLog deckelt bei +5/Woche." },
      { term: "Acute:Chronic Ratio", abbr: "ACWR", unit: "7d ÷ 28d", def: "Verhältnis akuter zu chronischer Last — ein Frühwarn-Maß für zu schnelles Zuviel.", range: { band: [16, 34], labels: ["0,8", "Sweet Spot 0,8–1,3", "> 1,5 Risiko"], hi: 1 }, use: "km-Ceiling ACWR ≤ 1,45; eine von mehreren entkoppelten Bremsen.", link: ["Langzeit", "/longterm"], sci: { ev: "obs", txt: "Assoziation Last-Spike ↔ Verletzung; die Kausalität ist umstritten.", cite: "Gabbett 2016 · Kritik: Impellizzeri 2020" } },
      { term: "Monotonie & Strain", abbr: "Foster", def: "Monotonie = wie gleichförmig die Woche ist (Ø ÷ Streuung der Tages-TSS); Strain = Wochenlast × Monotonie.", richtwert: "Monotonie < 2,0 gut · hohe Monotonie + hohe Last = klassisches Warnsignal (der „jeden Tag mittel“-Fehler)." },
    ],
  },
  {
    id: "int", n: "02", title: "Zonen & Schwellen", hue: "var(--lx-int)",
    note: "Wie hart es ist — sechs Zonen, verankert an zwei physiologischen Schwellen, plus die Maße für Verteilung und Ökonomie.",
    entries: [
      { term: "LT1 — aerobe Schwelle", abbr: "LT1", unit: "~2 mmol/l Laktat", def: "Erster nennenswerter Laktatanstieg. Obergrenze des locker-Bereichs (Z2) — hier liegt der Großteil des Grundlagentrainings." },
      { term: "LT2 — anaerobe Schwelle", abbr: "LT2 · LTHR", unit: "~4 mmol/l Laktat", def: "Punkt, ab dem Laktat steil ansteigt — ≈ dein 1-Stunden-Renntempo. Definiert Z4, die wichtigste Trainingsschwelle." },
      { term: "Laktat-Diagnostik", abbr: "mod. Dmax", unit: "mmol/l", def: "Aus einer Laktat-Leistungskurve (Stufentest) werden LT1 und LT2 bestimmt — RunLog nutzt die modifizierte Dmax-Methode.", use: "Feldtests + Laborwerte pflegbar; überschreibt die abgeleiteten Schwellen.", link: ["Einstellungen", "/settings"] },
      { term: "Zonen Z1–Z6", abbr: "Z1…Z6", def: "Z1 Recovery · Z2 Endurance · Z3 Tempo · Z4 Threshold · Z5 VO2max · Z6 Anaerob.", zones: true, use: "optimale Zonen aus VDOT/CS, LTHR/Laktat und CP.", link: ["Einstellungen", "/settings"] },
      { term: "Intensitätsverteilung", abbr: "locker/mittel/hart", def: "Wie sich deine Zeit auf die Intensitäten verteilt.", richtwert: "Polarisiert ≈ 80 % locker · wenig Mitte · ~20 % hart. Pyramidal: mehr Mitte (für Anfänger konservativ üblich).", sci: { ev: "rct", txt: "Bei Trainierten schlägt polarisiert die schwellenlastige Verteilung; ~80/20 ist eine der robustesten Beobachtungen des Ausdauersports.", cite: "Stöggl & Sperlich 2014 · Seiler 2010" } },
      { term: "Polarisierungs-Index", abbr: "PI", def: "Misst, wie polarisiert die Verteilung ist (Z1 vs. Z3 relativ zu Z2).", richtwert: "PI ≥ 2,0 = polarisiert." },
      { term: "Efficiency Factor", abbr: "EF", unit: "NGP-Tempo / Ø-HF", def: "Meter pro Minute je Herzschlag bei lockeren Läufen — höher = ökonomischer. Nach harten Vortagen erwartbar etwas gedämpft (Carry-over).", use: "je Wochentag; „hart davor“ markiert die Tage nach harten Einheiten.", link: ["Wochenbericht", "/report"] },
      { term: "Running Effectiveness", abbr: "RE", unit: "Geschw. / Watt", def: "Wie viel Tempo du aus deiner Leistung holst — steigt mit besserer Lauftechnik/Ökonomie." },
    ],
  },
  {
    id: "cap", n: "03", title: "Fähigkeit & Leistungsmarker", hue: "var(--lx-cap)",
    note: "Was du kannst — aus Bestleistungen und Lauf-Watt geschätzt. Diese Marker setzen deine Zonen und treiben die Prognosen.",
    entries: [
      { term: "VDOT / VO₂max", abbr: "VDOT", unit: "ml·kg⁻¹·min⁻¹ (äquiv.)", def: "Daniels-Leistungsindex aus deiner besten Distanzleistung — entspricht der nutzbaren VO₂max. Höher = schneller; treibt Pace-Zonen und Renn-Prognosen.", use: "die VO₂max-Prognose im Coach läuft aus der geplanten Plan-Last (kein Messwert, gedeckelt auf realistisch Erreichbares).", link: ["Bestzeiten", "/bests"] },
      { term: "VO₂max-Norm", abbr: "ACSM / Cooper", def: "Alters- und geschlechts-graduierte Einordnung deiner VO₂max (schwach … elite) nach etablierten Normtabellen." },
      { term: "Critical Speed", abbr: "CS", unit: "min/km", def: "Schwellen-Geschwindigkeit aus dem Zeit-Distanz-Verhältnis mehrerer Bestleistungen. ≈ 1-Stunden-Tempo — der robusteste Schwellen-Anker (primärer Marker in RunLog)." },
      { term: "Critical Power", abbr: "CP", unit: "Lauf-Watt", def: "Analog zu CS, aber in Lauf-Watt (relativ kalibriert aus den Geräte-Laufwatt). Asymptote der Power-Dauer-Kurve." },
      { term: "W-prime", abbr: "W′", unit: "kJ (Reserve)", def: "Die begrenzte anaerobe „Batterie“ oberhalb von CP — wird in harten Intervallen entladen und in den Pausen wieder aufgefüllt.", use: "W′-Verlauf während einer Einheit (W′bal).", link: ["Bestzeiten", "/bests"], sci: { ev: "mod", txt: "Entlade-/Auflade-Modell der anaeroben Reserve oberhalb CP.", cite: "Skiba 2012" } },
      { term: "Daniels-Paces", abbr: "E · M · T · I · R", def: "Aus dem VDOT abgeleitete Trainingstempi: Easy · Marathon · Threshold · Intervals · Repetitions — die Ziel-Paces deiner Zonen." },
      { term: "Bestleistungen", abbr: "PB / Best efforts", def: "Deine besten Zeiten je Distanz (auch aus Trainings-Segmenten). Sie speisen das PB- und Critical-Speed-Modell und damit die gesamte Fähigkeits-Schätzung.", use: "manuell überschreibbar.", link: ["Bestzeiten", "/bests"] },
    ],
  },
  {
    id: "ready", n: "04", title: "Readiness & Erholung", hue: "var(--lx-ready)",
    note: "Tägliche Bereitschaft aus Körpersignalen — sie beeinflusst nur Vorschläge, nie automatisch den Plan.",
    entries: [
      { term: "Herzratenvariabilität", abbr: "HRV", unit: "ms", def: "Abstands-Variabilität der Herzschläge in Ruhe. Sinkt bei Stress/Ermüdung.", richtwert: "relativ zur eigenen 7-Tage-Baseline lesen, nicht absolut." },
      { term: "Ruhe-Herzfrequenz", abbr: "RHR", unit: "bpm", def: "Herzfrequenz in Ruhe; ein erhöhter Morgenwert kann Ermüdung oder beginnende Krankheit anzeigen — ebenfalls relativ zur Baseline." },
      { term: "Readiness-Score", abbr: "Ampel", def: "Fasst HRV, Ruhe-HF, Schlaf, Erholung und Muskelkater zu einer Tages-Bereitschaft zusammen.", range: { band: [60, 0], labels: ["Rot: Recovery", "Gelb: entschärfen", "Grün: bereit"], hi: 2 }, use: "bei schwachen Werten wird vorgeschlagen, die nächste harte Einheit zu entschärfen — nie erzwungen.", link: ["Tracking", "/track"] },
      { term: "Aerobe Entkopplung", abbr: "Decoupling", unit: "%", def: "Drift von Herzfrequenz zu Pace über eine gleichmäßige Einheit (1. vs. 2. Hälfte) — der Ausdauer-Härtetest.", range: { band: [0, 62], labels: ["< 5 % gut", "5–10 %", "> 10 % zu früh müde"], hi: 0 }, use: "Trend über die Zeit.", link: ["Langzeit", "/longterm"] },
    ],
  },
  {
    id: "cycle", n: "05", title: "Zyklus-Steuerung", hue: "var(--lx-cycle)",
    note: "Der Menstruationszyklus als vierter, gestufter und begrenzter Steuer-Input — health-first, ehrlich zur dünnen Evidenz, individualisiert per N-of-1. Er greift nie in die Sicherungen ein.",
    entries: [
      { term: "Zyklus-Phasen", abbr: "Men · Fol · Ovu · Lut", def: "Menstruation · Follikelphase · Ovulation · frühe Luteal · späte Luteal. RunLog projiziert die (voraussichtliche) Phase je Blockwoche und zeigt sie als eigenes Timeline-Band.", sci: { ev: "obs", txt: "Die mittleren Leistungseffekte über den Zyklus sind klein und uneinheitlich, mit hoher individueller Streuung.", cite: "Meta: McNulty 2020" } },
      { term: "Zyklus-adaptives Training", abbr: "4. Steuer-Input", def: "Ein bounded Bias je Woche: Last und Qualitäts-Volumen werden leicht angepasst und dabei fest ins Periodisierungs-Band geklemmt. Reihenfolge: Health-Cap > Periodisierung > Zyklus > Block-Schwerpunkt.", use: "nur nach Einwilligung aktiv; TSB-Boden, Rampe und km-Ceiling bleiben unantastbar darüber.", link: ["Methodik", "/methodik"] },
      { term: "Symptom-Override", abbr: "health-first", def: "Akute Symptome von heute (starke Krämpfe, sehr niedrige Energie oder schlechter Schlaf) drücken die Qualität der unmittelbar nächsten Woche herunter — Gesundheit vor Reiz." },
      { term: "Kontrazeptions-Status", abbr: "hormonell?", def: "Hormonelle Kontrazeption verändert die zyklische Hormonlage — RunLog berücksichtigt den Status, bevor es überhaupt eine Phasenlogik anwendet.", sci: { ev: "obs", cite: "Elliott-Sale 2020" } },
      { term: "Zyklus-Evidenz (N-of-1)", abbr: "geprüft", def: "Weil die Allgemein-Evidenz dünn ist, ist der individuelle Verlauf die belastbarste Quelle: die adaptive Steuerung schärft sich aus deinen eigenen Phasen-Rückmeldungen, nicht aus einem Lehrbuch-Schema.", use: "derselbe randomisierte N-of-1-Pfad wie bei den Methoden-Vergleichen.", link: ["Methodik", "/methodik"] },
    ],
  },
  {
    id: "plan", n: "06", title: "Plan & Periodisierung", hue: "var(--lx-plan)",
    note: "Wie der Plan aufgebaut ist und wie real gegen geplant abgeglichen wird.",
    entries: [
      { term: "Plan-Erfüllung", abbr: "Adherence", def: "Deckung Aktivität ↔ geplante Einheit — aus TSS-Treffer und Zeit in der Ziel-Pace-Zone (fällt auf TSS-only zurück, wenn Pace-Zonen fehlen).", use: "Auto-Zuordnung nach Datum/Typ/TSS, je Aktivität überschreibbar.", link: ["Tracking", "/track"] },
      { term: "Periodisierung & Phasen", abbr: "Base→Race", def: "Base → Build → Specific → Taper → Race. Block- oder traditionelles Modell." },
      { term: "Mesozyklus / Deload", abbr: "3:1", def: "Rhythmus aus Belastungs- und Entlastungswochen.", richtwert: "3:1 als Standard · 2:1 für Hobby/Masters (geringere Belastbarkeitsreserve)." },
      { term: "Taper & Recovery", abbr: "Anspitzen", def: "Vor dem Rennen Last senken (Form hoch), danach adaptive Erholung.", richtwert: "Volumen runter, Intensität halten (Hickson/Mujika); Marathon länger als 5 km.", sci: { ev: "rct", txt: "Reduziertes Volumen bei gehaltener Intensität erhält/steigert die Leistung; optimaler Taper ~2 Wochen.", cite: "Mujika & Padilla 2000 · Bosquet 2007" } },
      { term: "Banister Fitness-Fatigue", abbr: "Impulse-Response", def: "Zweikomponenten-Modell (Fitness − Ermüdung), das aus deinen Markern die persönlich optimale Taper-Länge schätzt.", use: "speist „Peak ausrichten“ und die Taper-Karte im Coach.", link: ["Coach", "/coach"] },
    ],
  },
  {
    id: "schools", n: "07", title: "Methodik-Schulen (Coach)", hue: "var(--lx-school)",
    scaffold: true, status: "Grundgerüst · füllt sich mit den Coach-Updates",
    entries: [
      { term: "Daniels-klassisch", abbr: "T · I · R", def: "Zonen-Präzision und Ökonomie — definierte Tempo-, Intervall- und Repetition-Reize, direkt aus dem VDOT.", dist: { segs: [[80, "#60a5fa"], [10, "#eab308"], [8, "#f97316"]], text: "~80 % easy · 10 % T · ≤ 8 % I", ev: "konv", evLabel: "Lehrbuch", cite: "Daniels' Running Formula" } },
      { term: "Norwegian sub-Threshold", abbr: "Doppel-Schwelle", def: "Hohes, laktatkontrolliertes Schwellen-Volumen (2,5–3,5 mmol) — Doppel-Schwellen-Tage nur bei Semi-Profis.", dist: { segs: [[78, "#60a5fa"], [17, "#eab308"], [5, "#f97316"]], text: "~78 % easy · 15–18 % sub-T", ev: "obs", cite: "Bakken; Casado & Tjelta 2023" } },
      { term: "Polarized (Seiler)", abbr: "hart / locker", def: "Hart hart, locker locker — lange VO2-Intervalle, bewusst wenig Mitte.", dist: { segs: [[80, "#60a5fa"], [5, "#a3e635"], [15, "#f97316"]], text: "~80 % easy · < 5 % Mitte · 15 % hart", ev: "rct", cite: "Stöggl & Sperlich 2014; Esteve-Lanao 2007" } },
      { term: "Canova-spezifisch", abbr: "Race-Pace", def: "Renntempo als Organisationsprinzip — spät im Aufbau viel Race-Pace, Specials, Fast-Finish-Longruns.", dist: { segs: [], text: "phasenabhängig, spät race-pace-lastig", ev: "konv", evLabel: "Trainer-Praxis", cite: "Canova — keine RCT" } },
    ],
  },
  {
    id: "model", n: "08", title: "Modelle & Diagnostik", hue: "var(--lx-model)",
    note: "Die fortgeschrittenen, statistischen Analysen — ehrlich etikettiert: beobachtet ≠ kausal ≠ prognostiziert.",
    entries: [
      { term: "Latente Fitness", abbr: "L2 · Kalman", def: "Eine geglättete, verborgene Fitness-Trajektorie, aus deinen Leistungssignalen gefiltert — ruhiger und aussagekräftiger als jeder einzelne Messtag." },
      { term: "Dose-Response", abbr: "L3", def: "Modelliert, wie ein Reiz-Kanal (z. B. Schwellen-km) mit zeitlichem Verzug auf eine Zielgröße wirkt — die Basis der individuellen Fitness-Prognose (IR-Fitness)." },
      { term: "Forest-Plot / Kanal-Effekte", abbr: "CI", def: "Zeigt je Reiz-Kanal den geschätzten Effekt mit Konfidenzintervall — welche Reize bei dir wirken und wie sicher das ist.", use: "volumen-bereinigt und absolut umschaltbar.", link: ["Methodik", "/methodik"] },
      { term: "MCID", abbr: "Relevanz-Schwelle", def: "Kleinster klinisch relevanter Unterschied — an deine eigene Messgenauigkeit verankert, damit ein Effekt erst als „echt“ gilt, wenn er das Rauschen übersteigt." },
      { term: "N-of-1-Trial", abbr: "Permutationstest", def: "Ein randomisierter Einzelfall-Versuch (z. B. Methode A vs. B) mit exaktem Permutationstest — der einzige Pfad in RunLog, der Kausalität stützt.", richtwert: "ein p-Wert < 0,05 gilt als „geprüft“.", link: ["Methodik", "/methodik"] },
      { term: "Freshness eines Laufs", abbr: "fresh · stale", def: "Ob ein (teures) ML-Ergebnis noch zu deinen aktuellen Daten passt — „stale“ heißt: es wird ehrlich als veraltet angezeigt statt still neu gerechnet." },
      { term: "Evidenz-Etiketten", abbr: "4 Stufen", def: "Jede Aussage trägt ihr Etikett: Standard (Lehrbuch/Konvention) · beobachtet (Korrelation, nicht kausal) · geprüft (randomisierter N-of-1) · Prognose ± Band (Modell mit Unsicherheit)." },
      { term: "Readiness-Filter", abbr: "Kalman-Online", def: "Verrechnet die täglichen Wellness-Signale laufend zu einem stabilen Readiness-Zustand, ohne auf einzelne Ausreißer überzureagieren." },
    ],
  },
];

const hue = (v: string): CSSProperties => ({ ["--h"]: v } as CSSProperties);

function Bar({ segs, cls }: { segs: [number, string][]; cls: string }) {
  return <div className={cls}>{segs.map(([f, c], i) => <span key={i} style={{ flex: f, background: c }} />)}</div>;
}
function RangeStrip({ r }: { r: Rng }) {
  return (
    <div className="lx-range">
      <div className="track"><span className="band" style={{ left: `${r.band[0]}%`, right: `${r.band[1]}%` }} /></div>
      <div className="scale">{r.labels.map((l, i) => <span key={i} className={i === r.hi ? "hi" : ""}>{l}</span>)}</div>
    </div>
  );
}
function EntryRow({ e }: { e: Entry }) {
  return (
    <div className="lx-entry">
      <div>
        <div className="lx-name">{e.term}</div>
        {e.abbr && <span className="lx-abbr">{e.abbr}</span>}
        {e.unit && <div className="lx-unit">{e.unit}</div>}
      </div>
      <div>
        <p className="lx-def">{e.def}</p>
        {e.zones && <Bar cls="lx-zbar" segs={ZONES} />}
        {e.dist && e.dist.segs.length > 0 && <Bar cls="lx-dist" segs={e.dist.segs} />}
        {e.range && <RangeStrip r={e.range} />}
        {e.richtwert && <p className="lx-meta"><span className="lx-mlab">Richtwert</span>{e.richtwert}</p>}
        {e.dist && (
          <p className="lx-meta"><span className="lx-mlab">Verteilung</span>{e.dist.text}{" "}
            <span className={"lx-evi " + e.dist.ev}>{e.dist.evLabel ?? EVI_LABEL[e.dist.ev]}</span>{" "}
            <span className="lx-cite">{e.dist.cite}</span></p>
        )}
        {(e.use || e.link) && (
          <p className="lx-use">
            {e.use && <span className="txt"><span className="lx-mlab">In RunLog</span>{e.use}</span>}
            {e.link && <Link className="lx-go" to={e.link[1]}>{e.link[0]} <span className="ar">→</span></Link>}
          </p>
        )}
        {e.sci && (
          <p className="lx-sci"><span className="lx-mlab">Wissenschaft</span>{" "}
            <span className={"lx-evi " + e.sci.ev}>{EVI_LABEL[e.sci.ev]}</span>
            {e.sci.txt && <> <span className="txt">{e.sci.txt}</span></>}{" "}
            <span className="lx-cite">{e.sci.cite}</span></p>
        )}
      </div>
    </div>
  );
}

// Geführter Einstieg: Übersicht ALLER Tutorial-Abschnitte (mit Status) + ALLER Daten-Kino-Szenen.
function GuidedOverview({ done, onKino }: { done: string[]; onKino: (id: CinemaChartId) => void }) {
  const mains = SECTIONS.filter((s) => !s.optional);
  const doneMain = mains.filter((s) => done.includes(s.id)).length;
  const currentId = SECTIONS.find((s) => !s.optional && s.available && !done.includes(s.id))?.id;
  return (
    <div className="lx-guided">
      <div className="gk">Geführt lernen</div>
      <div className="gsub">Isabel führt dich Schritt für Schritt durch den Workflow — vom Einrichten bis zum Coach-Block. Das Daten-Kino zeigt jede wichtige Kennzahl in einer begehbaren 3D-Szene.</div>
      <div className="lx-ggrid">
        <div>
          <div className="lx-gh"><span className="t">Isabel-Tutorial</span><span className="m lx-mono">{doneMain} / {mains.length} Abschnitte</span></div>
          <ol className="lx-tut">
            {SECTIONS.map((s) => {
              const isDone = done.includes(s.id);
              const unlocked = isDone || isUnlocked(s, done);
              const clickable = s.available && (unlocked || isDone);
              const isNow = !isDone && !s.optional && s.id === currentId;
              const cls = [isDone && "done", isNow && "now", (!unlocked && s.available && !s.optional) && "locked", s.optional && "opt", clickable && "click"].filter(Boolean).join(" ");
              const status = isDone ? <Ico n="i-check" sm />
                : !s.available ? <span>bald</span>
                  : !unlocked ? <Ico n="i-lock" sm />
                    : s.optional ? <span>· frei</span>
                      : <span aria-hidden="true">▸</span>;
              return (
                <li key={s.id} className={cls}
                  onClick={clickable ? () => startTutorial(s.id) : undefined}
                  role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
                  onKeyDown={clickable ? (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); startTutorial(s.id); } } : undefined}>
                  <span className="n">{s.optional ? "+" : String(s.nr).padStart(2, "0")}</span>
                  <span className="i"><Ico n={TUT_ICON[s.id] ?? "i-start"} /></span>
                  <div className="x"><div className="tt">{s.title.split(" — ")[0]}</div><div className="tg">{s.tagline}</div></div>
                  <span className="mm">{s.minutes}′ {status}</span>
                </li>
              );
            })}
          </ol>
        </div>
        <div>
          <div className="lx-gh"><span className="t">Daten-Kino</span><span className="m lx-mono">{CINEMA_READY.length} Szenen</span></div>
          <div className="lx-kino">
            {CINEMA_READY.map((id) => (
              <div key={id} className="lx-ksc" role="button" tabIndex={0}
                onClick={() => onKino(id)}
                onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onKino(id); } }}>
                <span className="ki"><Ico n={KINO_ICON[id] ?? "i-pmc"} /></span> {KINO_LABEL[id] ?? id}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Lernen() {
  const [progress, setProgress] = useState<TutorialProgress>({ done: [], dismissed: true });
  const [openKino, setOpenKino] = useState<CinemaChartId | null>(null);
  useEffect(() => { api.tutorialProgress().then(setProgress).catch(() => {}); }, []);
  const done = progress.done;

  return (
    <div className="lx-page">
      <LxSprite />

      <header className="lx-mast no-print">
        <div className="lx-kick">RunLog · Handbuch</div>
        <h1>Alles, was deine Zahlen bedeuten — an einem Ort erklärt.</h1>
        <p className="lx-lede">Das vollständige Nachschlagewerk zu jeder sportwissenschaftlichen Analyse, Einheit und
          Abkürzung, die RunLog nutzt. Jeder Eintrag: was es ist, welche Werte typisch sind, wie RunLog es rechnet —
          und ein Klick dorthin, wo du deinen eigenen Wert siehst.</p>
        <div className="lx-spine">
          <b>Fähigkeit</b> <span className="op">setzt</span> Zonen <span className="op">→</span> <b>Zonen</b> <span className="op">erzeugen</span> Last <span className="op">→</span> <b>Last</b> <span className="op">formt</span> Form <span className="op">→</span> <b>Readiness</b> <span className="op">steuert</span> den nächsten Tag.
        </div>
        <div className="lx-legend">
          <span><span className="lab">Def</span> was es ist</span>
          <span><span className="lab">Richtwert</span> typische Werte</span>
          <span><span className="lab">In RunLog</span> wie es genutzt wird</span>
          <span><span className="lab">→</span> zu deinem Wert in der App</span>
        </div>
        <div className="lx-stance">
          <span className="h">Wissenschaftliche Haltung</span>
          <span>Jede Aussage trägt ihr Etikett —</span>
          <span className="lx-evi rct">RCT / Meta</span><span className="lx-evi obs">Beobachtung</span><span className="lx-evi konv">Konvention</span><span className="lx-evi mod">Modell</span>
          <span>· beobachtet ≠ kausal ≠ prognostiziert.</span>
        </div>
      </header>

      <div className="lx-shell">
        <nav className="lx-index no-print" aria-label="Kapitel">
          <div className="h">Kapitel</div>
          <ol>
            {CHAPTERS.map((c) => (
              <li key={c.id} style={hue(c.hue)}><a href={`#lx-${c.id}`}><span>{c.title}</span><span className="sw" /></a></li>
            ))}
          </ol>
        </nav>

        <main>
          <GuidedOverview done={done} onKino={setOpenKino} />

          {CHAPTERS.map((c) => (
            <section key={c.id} id={`lx-${c.id}`} className="lx-sec" style={hue(c.hue)}>
              <div className="lx-sech">
                <span className="n">{c.n}</span>
                <h2>{c.title}</h2>
                {c.scaffold ? <span className="status">{c.status}</span> : <span className="cnt">{c.entries.length} Einträge</span>}
              </div>
              {c.note && <p className="lx-note">{c.note}</p>}
              {c.scaffold && (
                <div className="lx-scaffold">
                  <b>Im Aufbau.</b> Der Coach bekommt schrittweise <b>benennbare Trainings-Schulen</b> als vollständige
                  Wochen-Rezepte (Verteilungs-Ziele, bevorzugte Q-Familien, Doubles-Politik, Longrun-Charakter). Dieses
                  Kapitel ist das Gerüst — die Details werden hier gefüllt, sobald die Schulen in den Coach-Updates landen.<br />
                  <b>Ehrliche Grundlage:</b> <span className="lx-evi rct">RCT / Meta</span> Zwischen den Schulen gibt es
                  <b> keine gesicherte Überlegenheit für jeden</b> Athleten; Elite nutzt phasenabhängig pyramidal UND
                  polarisiert. <span className="lx-cite">Stöggl &amp; Sperlich 2015; Casado 2022</span> — darum: Schule
                  wählbar + individuelle Evidenz (N-of-1) entscheidet, kein verstecktes Einheits-Rezept.
                </div>
              )}
              {c.entries.map((e, i) => <EntryRow key={i} e={e} />)}
            </section>
          ))}

          <div className="lx-foot no-print">
            <b>Für Entdecker.</b> Es gibt zwei versteckte Seiten: die <b>Nerd-Seite</b> (Rohdaten &amp; Mathematik hinter
            allen ML-Kennzahlen) öffnet sich mit den Pfeiltasten → → ← ← ↑ ↓ ↑ ↓, der <b>Lab Mode</b>
            {" "}(Lifetime-Statistiken) mit ↑ ↑ ↓ ↓ ← → ← →.
          </div>
        </main>
      </div>

      {openKino && (
        <OverlayPortal>
          <Suspense fallback={<div className="tiny muted" style={{ position: "fixed", inset: 0, zIndex: 1100, background: "#0d1526", color: "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center" }}>Das Daten-Kino öffnet…</div>}>
            <ChartCinema chart={openKino} stepInfo="Daten-Kino" onDone={() => setOpenKino(null)} onClose={() => setOpenKino(null)} doneLabel="Schließen ✓" />
          </Suspense>
        </OverlayPortal>
      )}
    </div>
  );
}
