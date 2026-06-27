// Lern-/Glossar-Seite (v1.9.0): nachschlagbare Erklärung aller Marker + Richtwerte + Zusammenspiel.
// Begleitet die seitenübergreifende Coachmark-Tour (Knopf oben startet sie neu). Rein erklärend, keine Daten.
import { startTour } from "../components/Coachmark.tsx";

type Term = { t: string; was: string; ref?: string; play?: string };
type Cat = { title: string; intro: string; terms: Term[] };

const CATS: Cat[] = [
  {
    title: "Form-Management (PMC)",
    intro: "Das Performance-Management-Chart bildet Fitness, Ermüdung und Form aus deiner täglichen Last (TSS) ab.",
    terms: [
      { t: "CTL — Fitness", was: "Chronische Last: 42-Tage-Durchschnitt (EWMA) deiner TSS. Steigt langsam, fällt langsam — deine Belastbarkeit.", ref: "Aufbau nachhaltig: +3 bis +6 CTL/Woche." },
      { t: "ATL — Ermüdung", was: "Akute Last: 7-Tage-EWMA deiner TSS. Reagiert schnell auf harte Tage.", ref: "Kurzfristige Spitzen sind normal — entscheidend ist die Erholung danach." },
      { t: "TSB — Form", was: "Form = CTL − ATL (Stand gestern). Wie frisch/müde du bist.", ref: "> +5 frisch · −10 bis −25 produktiv müde (Trainingszone) · < −25 Risiko · +15 bis +25 Wettkampfform (Taper).", play: "Ziel im Aufbau: kontrolliert negativ. Vor dem Rennen: TSB hoch tapern." },
      { t: "CTL-Ramp", was: "Wie schnell die Fitness steigt (CTL-Zuwachs pro Woche).", ref: "3–6/Woche nachhaltig · > +8 zu steil → Verletzungs-/Übertrainingsrisiko." },
      { t: "ACWR", was: "Verhältnis akute zu chronischer Last (7d ÷ 28d).", ref: "0,8–1,3 = sweet spot · > 1,5 = stark erhöhtes Verletzungsrisiko." },
    ],
  },
  {
    title: "Trainingslast (TSS)",
    intro: "TSS quantifiziert die Belastung jeder Einheit — geräteneutral aus Pace/HF gegen deine Schwelle.",
    terms: [
      { t: "TSS", was: "Training Stress Score: Dauer × Intensität². 100 TSS = 1 Stunde exakt an der Schwelle.", ref: "Easy ~40–60/h · Schwelle ~90–100/h · Rennen 5–10 km ~60–130." },
      { t: "IF — Intensitätsfaktor", was: "Anteil der Schwellenleistung in einer Einheit (1,0 = Schwelle).", ref: "Easy ~0,7 · Marathon ~0,85 · Schwelle ~0,95–1,0 · 5k ~1,05." },
      { t: "rTSS / Power-TSS / hrTSS", was: "TSS-Variante je Datenlage: Lauf aus NGP/Pace, Rad aus Power/FTP, sonst aus HF.", play: "RunLog nutzt für Lauf bewusst Pace/NGP statt des Uhren-Werts (z.B. COROS Load)." },
      { t: "Monotonie & Strain (Foster)", was: "Monotonie = wie gleichförmig die Woche ist; Strain = Last × Monotonie.", ref: "Monotonie < 2,0 gut · hohe Monotonie + hohe Last = Warnsignal." },
    ],
  },
  {
    title: "Zonen & Schwellen",
    intro: "Sechs Intensitätszonen, verankert an zwei physiologischen Schwellen (LT1/LT2).",
    terms: [
      { t: "LT1 — aerobe Schwelle", was: "Erster Laktatanstieg (~2 mmol/l). Obergrenze des locker-Bereichs (Z2).", ref: "Hier liegt der Großteil des Grundlagentrainings." },
      { t: "LT2 — anaerobe Schwelle / LTHR", was: "Punkt, ab dem Laktat steil ansteigt (~4 mmol/l). ≈ 1-Stunden-Renntempo.", ref: "Definiert Z4 (Schwelle) — die wichtigste Trainingsschwelle." },
      { t: "Zonen Z1–Z6", was: "Z1 Recovery · Z2 Endurance · Z3 Tempo · Z4 Threshold · Z5 VO2max · Z6 Anaerob.", play: "Optimale Zonen berechnet RunLog aus VDOT/CS, LTHR/Laktat und CP (Dashboard)." },
      { t: "Intensitätsverteilung", was: "Wie sich die Zeit auf locker / mittel / hart verteilt.", ref: "Polarisiert ≈ 80 % locker / wenig mittel / 20 % hart · Pyramidal: mehr mittel." },
      { t: "Polarisierungs-Index (PI)", was: "Misst, wie polarisiert die Verteilung ist (Z1 vs. Z3 relativ zu Z2).", ref: "PI ≥ 2,0 = polarisiert." },
    ],
  },
  {
    title: "Leistungsmarker",
    intro: "Aus Bestzeiten und Lauf-Watt geschätzte Fähigkeiten — die Treiber von Zonen und Prognosen.",
    terms: [
      { t: "VDOT / VO₂max", was: "Daniels-Leistungsindex aus deiner besten Distanzleistung — entspricht der nutzbaren VO₂max.", ref: "Höher = schneller. Treibt Pace-Zonen + Renn-Prognosen." },
      { t: "Critical Speed (CS)", was: "Schwellengeschwindigkeit aus dem Zeit-Distanz-Verhältnis mehrerer Bestzeiten.", ref: "≈ 1-Stunden-Tempo · robuster Schwellen-Anker (primärer Marker)." },
      { t: "Critical Power (CP)", was: "Analog zu CS, aber in Lauf-Watt (aus den Geräte-Laufwatt, relativ kalibriert).", ref: "Asymptote der Power-Dauer-Kurve." },
      { t: "W′ (W-prime)", was: "Anaerobe Reserve oberhalb CP — die begrenzte „Batterie“ für harte Surges.", ref: "Wird in harten Intervallen entladen und in den Pausen wieder aufgefüllt (Skiba-Modell)." },
    ],
  },
  {
    title: "Effizienz & Ermüdung",
    intro: "Marker dafür, wie ökonomisch und ermüdungsresistent du läufst.",
    terms: [
      { t: "Aerobe Entkopplung", was: "Drift von HF zu Pace über eine gleichmäßige Einheit (1. vs. 2. Hälfte).", ref: "< 5 % = gute Ausdauer · > 10 % = zu schnell oder zu früh ermüdet." },
      { t: "NGP — Normalized Graded Pace", was: "Steigungs-bereinigte Pace — vergleichbar über hügelige Strecken.", play: "Basis des Lauf-TSS (rTSS) und der Entkopplung." },
      { t: "Running Effectiveness (RE)", was: "Geschwindigkeit pro Watt — wie viel Tempo du aus deiner Leistung holst.", ref: "Steigt mit besserer Lauftechnik/Ökonomie." },
    ],
  },
  {
    title: "Readiness & Erholung",
    intro: "Tägliche Bereitschaft aus Körpersignalen — beeinflusst nur Vorschläge, nie automatisch.",
    terms: [
      { t: "HRV — Herzratenvariabilität", was: "Abstand-Variabilität der Herzschläge in Ruhe. Sinkt bei Stress/Ermüdung.", ref: "Relativ zur eigenen 7-Tage-Baseline lesen, nicht absolut." },
      { t: "Readiness-Score", was: "Fasst HRV, Ruhe-HF, Schlaf, Erholung und Muskelkater zusammen.", ref: "Grün = bereit · Gelb = etwas entschärfen · Rot = Recovery erwägen.", play: "Bei schwachen Werten schlägt RunLog vor, die nächste harte Einheit zu entschärfen." },
    ],
  },
  {
    title: "Plan & Periodisierung",
    intro: "Wie der Plan strukturiert ist und wie real vs. geplant abgeglichen wird.",
    terms: [
      { t: "Plan-Erfüllung (Adherence)", was: "Deckung Aktivität ↔ geplante Einheit aus TSS-Treffer + Zeit in der Ziel-Pace-Zone.", play: "Auto-Zuordnung nach Datum/Typ/TSS — im Tracking pro Aktivität manuell überschreibbar." },
      { t: "Periodisierung & Phasen", was: "Base → Build → Specific → Taper → Race. Block- oder traditionelles Modell.", ref: "3:1-Prinzip: 3 Aufbauwochen, 1 Entlastungswoche." },
      { t: "Taper & Recovery", was: "Vor dem Rennen Last senken (Form hoch), danach adaptive Erholung.", ref: "Nach dem Rennen so lange locker, bis TSB wieder im sicheren Band ist (Marathon länger als 5k)." },
    ],
  },
];

export default function Lernen() {
  return (
    <div>
      <div className="spread no-print">
        <div>
          <h1>Lernen &amp; Glossar</h1>
          <span className="tiny muted" style={{ display: "block", marginTop: -2 }}>Alle Kennzahlen, Richtwerte und ihr Zusammenspiel — zum Nachschlagen.</span>
        </div>
        <button className="primary" onClick={() => startTour()} title="Geführte Tour durch die echten Marker der App">▶ Geführte Tour starten</button>
      </div>

      <div className="card tight" style={{ marginBottom: 12, borderLeft: "3px solid var(--primary, #2563eb)" }}>
        <p className="tiny" style={{ margin: 0, lineHeight: 1.5 }}>
          RunLog denkt in <strong>Last</strong> (TSS → CTL/ATL/TSB), <strong>Intensität</strong> (Zonen an LT1/LT2) und
          <strong> Fähigkeit</strong> (VDOT/CS/CP). Diese drei greifen ineinander: Fähigkeit setzt deine Zonen, Zonen
          erzeugen Last, Last formt über die Zeit deine Form — und Readiness entscheidet, wie hart der nächste Tag wird.
        </p>
      </div>

      {CATS.map((c) => (
        <div key={c.title} className="card" style={{ marginBottom: 12 }}>
          <h2 style={{ marginBottom: 2 }}>{c.title}</h2>
          <p className="tiny muted" style={{ margin: "0 0 10px" }}>{c.intro}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
            {c.terms.map((term) => (
              <div key={term.t} style={{ border: "1px solid var(--border, #e3e8ef)", borderRadius: 10, padding: "9px 11px" }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>{term.t}</div>
                <div className="tiny" style={{ lineHeight: 1.45 }}>{term.was}</div>
                {term.ref && <div className="tiny" style={{ marginTop: 5, color: "var(--primary, #2563eb)", fontWeight: 600, lineHeight: 1.45 }}>▸ {term.ref}</div>}
                {term.play && <div className="tiny muted" style={{ marginTop: 4, lineHeight: 1.45 }}>↔ {term.play}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
