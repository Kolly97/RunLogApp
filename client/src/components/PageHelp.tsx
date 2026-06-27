// Seiten-Hilfe (v1.8.0): dezenter „!"-Button unten je Seite → kurze Erklärung der Diagramme/Funktionen
// ('so liest du das, so hilft es dir') + Link zur vollständigen Anleitung. Druckt nicht mit.
import { useState } from "react";

const HELP: Record<string, { title: string; bullets: string[] }> = {
  dashboard: { title: "Dashboard — dein Status heute", bullets: [
    "CTL = Fitness (42-Tage-Last), ATL = Ermüdung (7-Tage), TSB = Form (CTL−ATL): >+5 frisch, −10 bis −25 produktiv müde.",
    "Oben: Readiness, heutige Empfehlung und — falls ein Ziel-Rennen mit Wunschzeit gesetzt ist — der Soll/Ist-Abgleich.",
    "Kacheln lassen sich per 'Bearbeiten' verschieben/ausblenden. Lange Verläufe stehen auf der Seite Langzeit.",
  ] },
  plan: { title: "Wochenplanung — die Woche bauen", bullets: [
    "Wochen-Vorschlag erzeugt konkrete Einheiten (Variety-Engine: Pace-Bereich, HF, Pausen). Block-Vorschau plant bis zum Renntag.",
    "'Phasen übernehmen' schreibt die Periodisierung in den Saisonplan. Die Phase-Pille ist klickbar.",
    "Die Paces der übernommenen Einheiten passen sich live an deine projizierte Fitness Richtung Wunsch-Zielzeit an.",
  ] },
  track: { title: "Tracking — gelaufene Einheiten", bullets: [
    "Hier erscheinen Strava-Importe und manuelle Einträge. Intervalle inkl. Pausen sind erfassbar.",
    "TSS wird geräteneutral aus Pace/NGP gegen deine Schwelle berechnet — unabhängig vom Uhren-Wert.",
  ] },
  report: { title: "Wochenbericht — diese Woche im Detail", bullets: [
    "Geplant vs. real: Zonen-Verteilung (Zeit-in-Zone = Leit-Intensität) und TSS-Anteil nach Einheitstyp (ergänzend).",
    "Wochen-Checks als Ampel: grün gut, gelb grenzwertig, rot Warnung. Die Seite ist druckbar.",
  ] },
  longterm: { title: "Langzeit — Trends übers Jahr", bullets: [
    "PMC, VO2max/Critical Speed, Lauf-Power, Intensität und Wellness im Verlauf. Zeitraum oben wählbar.",
    "Modell-Schätzungen (eff. VO2max, N-of-1) sind als 'explorativ' gekennzeichnet — robuste Werte stehen im Vordergrund.",
  ] },
  races: { title: "Races — Wettkämpfe & Ziele", bullets: [
    "Ergebnisse + km-Splits. Trage am Ziel-Rennen eine Wunsch-Zielzeit ein.",
    "Die Wunschzeit treibt die Pace-Progression der Trainings-Einheiten und den Soll/Ist-Abgleich in der Wochenplanung.",
  ] },
  bests: { title: "Bestzeiten — Leistungsmarker", bullets: [
    "PB je Distanz → VDOT/VO2max + Renn-Prognose. Critical Power (CP) + Power-Kurve aus den Coros-Laufwatt (relativ zu deinem Gerät).",
    "W′ = anaerobe Reserve oberhalb CP. Kacheln verschieb-/ausblendbar.",
  ] },
  methodik: { title: "Methodik — was bei DIR wirkt (N-of-1)", bullets: [
    "Marker-Batterie (Critical Speed primär), geführte Methoden-Experimente (Vorher/Nachher) und passive Inferenz.",
    "Wichtig: Korrelation, nicht Kausalität — kleine Stichproben sind als 'explorativ' markiert. Beratend, nie zwingend.",
  ] },
  profile: { title: "Profil — Athlet, Zonen & Präferenzen", bullets: [
    "Links die Bereiche: Athlet, Zonen/Schwellen, Verfügbarkeit & Block-Präferenzen (Schwerpunkt, Lieblings/Vermeiden), Leistungstests.",
    "Block-Präferenzen wirken beratend auf die Einheiten-Auswahl — Periodisierung und Erholungsregeln bleiben verbindlich.",
    "Das 'Tutorial'-Profil enthält ein komplettes Beispieljahr zum gefahrlosen Ausprobieren.",
  ] },
};

export default function PageHelp({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  const h = HELP[page];
  if (!h) return null;
  return (
    <div className="no-print" style={{ marginTop: 20 }}>
      <button className="sm ghost" onClick={() => setOpen((o) => !o)} title="Hilfe & Tipps zu dieser Seite"
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ display: "inline-flex", width: 16, height: 16, borderRadius: 999, border: "1.5px solid currentColor", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>!</span>
        {open ? "Hilfe schließen" : "Hilfe & Tipps zu dieser Seite"}
      </button>
      {open && (
        <div className="card" style={{ marginTop: 6, borderLeft: "3px solid var(--primary, #3b82f6)" }}>
          <strong>{h.title}</strong>
          <ul style={{ margin: "6px 0 8px 16px", padding: 0, fontSize: 13, lineHeight: 1.5 }}>
            {h.bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
          <a className="tiny" href="/usage.html" target="_blank" rel="noreferrer">→ Vollständige Anleitung öffnen</a>
        </div>
      )}
    </div>
  );
}
