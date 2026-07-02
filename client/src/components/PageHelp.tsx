// Seiten-Hilfe: dezenter „!"-Button unten je Seite → kurze Erklärung + Link zur Anleitung. Druckt nicht mit.
import { useState } from "react";

export const HELP: Record<string, { title: string; bullets: string[] }> = {
  dashboard: { title: "Dashboard — dein Status heute", bullets: [
    "CTL = Fitness (42-Tage-Last), ATL = Ermüdung (7-Tage), TSB = Form (CTL−ATL): >+5 frisch, −10 bis −25 produktiv müde. Sparklines zeigen den Verlauf der letzten Wochen.",
    "Oben: Form-Ribbon (CTL/ATL/TSB-Band der letzten ~6 Wochen) — zeigt auf einen Blick, ob du aufbaust, erhältst oder entlastest.",
    "Kacheln lassen sich per 'Bearbeiten' verschieben/ausblenden. Lange Verläufe stehen auf der Seite Langzeit.",
  ] },
  plan: { title: "Wochenplanung — die Woche bauen", bullets: [
    "Wochen-Vorschlag erzeugt konkrete Einheiten (Variety-Engine: Pace-Bereich, HF, Pausen). Block-Vorschau plant bis zum Renntag.",
    "Einheiten zeigen von–bis-Wiederholungen + Tageswert nach Form (TSB), Fitness und Phase — mit 'angepasst'-Notiz wenn die Engine anpasst.",
    "'Phasen übernehmen' schreibt die Periodisierung in den Saisonplan. Die Paces passen sich live an deine projizierte Fitness Richtung Wunsch-Zielzeit an.",
  ] },
  coach: { title: "Coach — Training gestalten", bullets: [
    "Wettkampf-Block: kompletter Mesozyklus bis zum Renntag — pro Woche selektiv übernehmbar; 'Phasen übernehmen' schreibt die Periodisierung.",
    "Eigene Einheiten: verschachtelter Builder (Coros-artig) — Segmente & Gruppen in beliebiger Tiefe, Spielraum auf der Anzahl (von–bis), Pace-Offset und Pausen. Die Engine wählt den Tageswert nach deiner Form.",
    "Bibliotheks- und eigene Einheiten werden mit deinen echten Zonen gerendert — Struktur-Spalte + aufklappbare Detailzeile in der Tabelle.",
  ] },
  track: { title: "Tracking — gelaufene Einheiten", bullets: [
    "Hier erscheinen Strava-Importe und manuelle Einträge. Intervalle inkl. Pausen sind erfassbar.",
    "Aktivitäten können bewusst 'nicht zuordnen' sein: sie zählen weiter zur realen Last, aber nicht zur Plan-Erfüllung.",
    "Zyklus/Symptome erscheinen nur nach Opt-in im Methodik-Tab 'Zyklus' und bleiben lokale Beobachtungsdaten.",
    "TSS wird geräteneutral aus Pace/NGP gegen deine Schwelle berechnet — unabhängig vom Uhren-Wert.",
  ] },
  report: { title: "Wochenbericht — diese Woche im Detail", bullets: [
    "Geplant vs. real: Zonen-Verteilung (Zeit-in-Zone = Leit-Intensität) und TSS-Anteil nach Einheitstyp (ergänzend).",
    "Periodisierungs-Ziel je Phase (pyramidal/polarisiert/regenerativ) mit Begründung — und manuellem Override falls gewünscht.",
    "Wochen-Checks als Ampel: grün gut, gelb grenzwertig, rot Warnung. Die Seite ist druckbar (immer hell).",
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
    "Tabs: Status zeigt Marker/Readiness, 'Was wirkt?' zeigt Beobachtungs-ML, Experimente enthält randomisierte Trials, Zyklus bleibt separat opt-in.",
    "Beobachtungs-ML liefert Hypothesen/Korrelationen. Nur prospektiv randomisierte N-of-1-Blöcke dürfen später als 'geprüft' gelten.",
    "Trial-Vorschläge sind gerankt nach Datenlage, Nutzen, Dauer, Risiko und Erklärbarkeit. Beratend, nie zwingend.",
  ] },
  profile: { title: "Profil — Athlet, Zonen & Präferenzen", bullets: [
    "Athlet · Zonen/Schwellen · Verfügbarkeit · Block-Präferenzen (Schwerpunkt, Lieblings/Vermeiden) · Leistungstests.",
    "Eigene Einheiten: Coros-artiger Builder — Segmente & Gruppen, Spielraum auf Anzahl, Pausen, Pace-Offset. Engine löst Tageswert nach Form auf.",
    "'Tutorial: Mara' enthält 18 Monate HM-Demo-Daten plus Zukunftsplan zum gefahrlosen Ausprobieren.",
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
