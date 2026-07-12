// Isabel-Tutorial: Abschnitts-Registry mit allen Steps (v2.10.0 — Etappe A: Abschnitt 1+2, Etappe B:
// Abschnitt 3 Analyse + 4 Coach; das Nerd-Add-on folgt als Etappe C). Texte: Isabel = warm-kompetente
// Trainingspartnerin, duzt, wissenschaftlich ehrlich (beobachtet ≠ kausal), kein Fitness-Toy-Sprech.
import { api } from "../../lib/api.ts";
import type { TutSection } from "./types.ts";

const iso = (d: Date) => d.toISOString().slice(0, 10);
function currentWeekRange(): { from: string; to: string } {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: iso(mon), to: iso(sun) };
}

type AthleteSetting = { birth_year?: number | string; sex?: string; weight?: number | string; max_hr?: number | string };

// Abschnitt 3+4 zeigen echte Analysen an Isabels 18-Monats-Historie: der Nutzer wechselt (geführt) aufs
// Tutorial-Profil und zurück. Der Wechsel lädt die App neu — TutorialHost setzt via sessionStorage genau
// am selben Schritt fort.
async function onIsabelProfile(): Promise<boolean> {
  const [t, p] = await Promise.all([api.tutorialStatus(), api.profiles()]);
  return t.id != null && p.active === t.id;
}
/** DOM-Check für Zustände, die nur im Client leben (z. B. geladener Block-Vorschlag im Coach). */
const domHas = (selector: string) => async () => !!document.querySelector(selector);
/** Geplante Einheiten im weiten Fenster (heute−7 … +180 Tage) — Basis für „Woche übernehmen"-Erkennung. */
async function plannedSessionCount(): Promise<number> {
  const from = new Date(); from.setDate(from.getDate() - 7);
  const to = new Date(); to.setDate(to.getDate() + 180);
  return (await api.sessions({ from: iso(from), to: iso(to) })).length;
}

export const SECTIONS: TutSection[] = [
  {
    id: "start",
    nr: 1,
    icon: "🚀",
    title: "Start — deine App wird startklar",
    tagline: "Ich richte dich ein wie mich: Profil, Zonen, Strava, Verfügbarkeit.",
    minutes: 12,
    available: true,
    steps: [
      {
        kind: "say",
        title: "Hi, ich bin Isabel!",
        text: "Schön, dass du da bist. Ich bereite mich gerade auf einen Halbmarathon vor — Wunschzeit 1:27 — und RunLog ist dabei mein Trainingslabor. In diesem ersten Abschnitt machen wir DEINE App startklar: Profil, Zonen, Strava, Verfügbarkeit. Alles, was du hier einträgst, ist echt — am Ende bist du wirklich eingerichtet. Mein Training findest du übrigens jederzeit im Profil „Tutorial: Isabel“ zum Stöbern.",
      },
      {
        kind: "say",
        title: "Die Profil-Seite — hier wohnst du",
        route: "/profile",
        text: "Das ist die Profil-Seite: Athletendaten, Zonen & Schwellen, Verfügbarkeit und Leistungstests. Aus diesen Angaben rechnet RunLog alles Weitere — Trainingszonen, Belastung, Prognosen. Je ehrlicher die Daten, desto besser der Rest.",
      },
      {
        kind: "task",
        title: "Aufgabe: Trag deine Athletendaten ein",
        route: "/profile",
        text: "Fülle im Bereich „Athlet“ mindestens Geburtsjahr, Geschlecht, Gewicht und Max-HF aus. Geburtsjahr + Geschlecht brauche ich für die VO₂max-Einordnung (ACSM-Normen), die Max-HF für deine HF-Zonen. Wenn du deine Ruhe-HF kennst: auch rein — sie schärft die Readiness.",
        check: {
          test: async () => {
            const s = (await api.settings()) as { athlete?: AthleteSetting };
            const a = s.athlete ?? {};
            return !!(a.birth_year && a.sex && a.weight && a.max_hr);
          },
        },
      },
      {
        kind: "say",
        title: "Zwei Schwellen tragen alles: LT1 und LT2",
        route: "/profile",
        text: "Deine sechs Trainingszonen hängen an zwei physiologischen Schwellen. LT1 (aerobe Schwelle): bis hierhin ist es wirklich locker — hier lebt der Großteil deines Trainings. LT2 (Laktatschwelle): ungefähr dein 1-Stunden-Renntempo, die wichtigste Trainingsschwelle überhaupt. Alles in RunLog — Zonen, TSS, Vorschläge — ist an diesen beiden Ankern verankert.",
      },
      {
        kind: "task",
        title: "Aufgabe: Laktattest eintragen — oder den Weg ohne nehmen",
        route: "/profile",
        text: "Hast du Laktatwerte (Stufentest: alle 3–5 min eine Stufe schneller, nach jeder Stufe messen)? Dann trag den Test unter „Leistungstests“ ein — RunLog bestimmt LT1/LT2 automatisch (mod. Dmax) und schlägt dir Zonen vor. Kein Messgerät? Völlig okay: Überspringen — deine Zonen kommen dann aus VDOT/Critical Speed, sobald Bestleistungen da sind (nächster Schritt).",
        check: { test: async () => (await api.lactateTests()).length > 0 },
        skippable: true,
        skipNote: "Ohne Laktat rechnet RunLog deine Zonen aus VDOT/CS und Strava-Bestleistungen — wissenschaftlich solide, nur etwas gröber als ein Labortest.",
      },
      {
        kind: "say",
        title: "Optimale Zonen — berechnet, du bestätigst",
        route: "/coach",
        selector: "[data-tour='optimal-zones']",
        text: "Hier berechnet RunLog deine optimalen Zonen: Pace aus VDOT/Critical Speed, HF aus Laktat bzw. LTHR, Watt aus Critical Power — mit Quelle je Achse. Mit „Als aktives Zonen-Set übernehmen“ werden sie verbindlich. Wichtig: RunLog schlägt vor, DU entscheidest — das gilt in der ganzen App.",
      },
      {
        kind: "task",
        title: "Aufgabe: Strava verbinden & ersten Sync starten",
        route: "/settings",
        text: "In den Einstellungen verbindest du Strava (einmalig anmelden), dann „Ganzes Jahr importieren“. Ehrlich vorweg: Strava erlaubt nur ~100 Abrufe pro 15 Minuten — bei viel Historie braucht es mehrere Sync-Runden, RunLog macht automatisch da weiter, wo es aufgehört hat. Danach einmal „TSS neu berechnen“ drücken, damit die nachgeladenen Details (NGP) in die Belastung einfließen. Ohne Strava? Überspringen — Aktivitäten gehen auch manuell im Tracking.",
        check: {
          count: async () => {
            const y = new Date();
            y.setFullYear(y.getFullYear() - 1);
            return (await api.activities({ from: iso(y) })).length;
          },
        },
        skippable: true,
        skipNote: "Ohne Strava trägst du Einheiten manuell im Tracking ein — alle Auswertungen funktionieren, nur Streams (NGP, Zonen-Zeiten, Bestleistungen) fehlen dann.",
      },
      {
        kind: "task",
        title: "Aufgabe: Sag der App, wann du trainieren kannst",
        route: "/profile",
        text: "Unter „Verfügbarkeit“ trägst du dein Zeitbudget je Wochentag ein, deinen Longrun-Tag und deine Qualitätstage (die harten Tage, z. B. Di/Do). Der Coach legt harte Einheiten später NUR auf diese Tage und hält ≥48 h Abstand dazwischen — so bleibt die Erholung geschützt. Bei mir: Longrun Sonntag, hart Di + Do.",
        check: {
          test: async () => {
            const av = await api.availability();
            return !!av && Array.isArray(av.minutesByWeekday) && av.minutesByWeekday.some((m: number) => m > 0);
          },
        },
      },
      {
        kind: "say",
        title: "Auswahllisten — die App spricht deine Sprache",
        route: "/options",
        text: "Hier passt du die Listen an, mit denen du täglich arbeitest: Einheitstypen, Phasen, Tagesfaktoren, Wochen-Checks — Namen, Farben, Reihenfolge. Du musst jetzt nichts ändern; wichtig ist nur, dass du weißt, wo es liegt, wenn dich eine Bezeichnung stört.",
      },
      {
        kind: "say",
        title: "Dein Layout — Kacheln so, wie DU denkst",
        route: "/report",
        text: "Fast geschafft! Auf Wochenbericht, Langzeit und Bestleistungen kannst du unten über „Layout bearbeiten“ jede Kachel verschieben, skalieren oder ausblenden — dein Layout wird pro Seite gespeichert. Der Wochenbericht druckt übrigens exakt so als A4-PDF, wie du ihn siehst.",
      },
      {
        kind: "quiz",
        question: "Kurzer Check: Was stimmt über deine zwei Schwellen?",
        options: [
          { label: "LT1 ist die aerobe Schwelle — bis dahin ist es wirklich locker.", correct: true, feedback: "Genau! Unterhalb LT1 lebt der Großteil deines Trainings — und LT2 (≈ 1-h-Renntempo) definiert die Schwellenzone Z4." },
          { label: "LT2 ist das Tempo für lockere Dauerläufe.", feedback: "Fast andersrum: LT2 ist ungefähr dein 1-Stunden-RENNtempo — daran hängt die harte Schwellenzone Z4. Locker spielt sich unterhalb von LT1 ab." },
          { label: "Die Zonen sind bei allen Läufern gleich.", feedback: "Nein — genau deshalb haben wir gerade DEINE Schwellen bestimmt. Zwei Läufer mit gleichem Puls können in völlig verschiedenen Zonen unterwegs sein." },
        ],
      },
      {
        kind: "quiz",
        question: "Dein erster Strava-Import bleibt bei der Hälfte stehen. Was ist passiert?",
        options: [
          { label: "Strava-Rate-Limit erreicht — einfach später weitersyncen.", correct: true, feedback: "Richtig. Strava deckelt die Abrufe (~100 je 15 min). RunLog stoppt bewusst davor und macht beim nächsten Sync genau dort weiter — nichts geht verloren." },
          { label: "Die App ist abgestürzt, alles muss neu.", feedback: "Keine Sorge — das ist Stravas Abruf-Limit, kein Fehler. RunLog merkt sich den Stand und setzt beim nächsten Sync fort." },
          { label: "Mein Strava-Konto wurde gesperrt.", feedback: "Nein, alles gut: Das ist das normale Abruf-Limit der Strava-Schnittstelle. Kurz warten, nochmal syncen — RunLog macht automatisch weiter." },
        ],
      },
      {
        kind: "scene",
        title: "Startklar! 🎉",
        text: "Das war Abschnitt 1 — deine App ist eingerichtet: Athletendaten ✓ · Zonen-Anker ✓ · Daten-Zufluss ✓ · Verfügbarkeit ✓. Ab jetzt rechnet RunLog mit DEINEN Werten. Im nächsten Abschnitt zeige ich dir meinen Wochen-Rhythmus: planen, trainieren, dokumentieren — und was die Formkurve dabei erzählt.",
      },
    ],
  },
  {
    id: "plan",
    nr: 2,
    icon: "📅",
    title: "Planen & Dokumentieren — dein Wochen-Rhythmus",
    tagline: "Meine Trainingswoche: planen, tracken, den Bericht lesen — und die Formkurve verstehen.",
    minutes: 17,
    available: true,
    steps: [
      {
        kind: "say",
        title: "Mein Wochen-Rhythmus",
        text: "So läuft meine Woche: Sonntagabend plane ich die nächste Woche (10 Minuten), nach jedem Lauf landet die Einheit im Tracking, und am Wochenende lese ich den Wochenbericht wie einen kleinen Laborbefund. Diesen Rhythmus bauen wir jetzt für dich auf — mit deinen echten Daten.",
      },
      {
        kind: "say",
        title: "Der Wochenkopf: Fitness · Ermüdung · Form",
        route: "/plan",
        selector: "[data-tour='week-pmc']",
        text: "Oben in der Wochenplanung stehen drei Zahlen, die du lesen können musst: CTL = Fitness (dein 42-Tage-Lastdurchschnitt, steigt langsam), ATL = Ermüdung (7 Tage, reagiert schnell), TSB = Form (Fitness minus Ermüdung). Was die drei wirklich bedeuten, zeige ich dir jetzt an einem besonderen Ort — komm mit ins Daten-Kino.",
      },
      // Chart-Kino (v2.11.0): das PMC als begehbare 3D-Szene — ersetzt die frühere Text-Erklärung der Faustregeln.
      { kind: "chart3d", chart: "pmc", title: "Daten-Kino: deine Formkurve" },
      {
        kind: "task",
        title: "Aufgabe: Plane deine erste Einheit",
        route: "/plan",
        text: "Leg in dieser Woche eine Einheit an — z. B. einen lockeren Dauerlauf. Klick auf einen Tag, wähle Sport und Typ, trag Dauer oder km ein. RunLog berechnet die geplante Belastung (TSS) automatisch aus deinen Zonen. Tipp: Einheiten lassen sich per Drag-and-drop auf andere Tage ziehen.",
        check: {
          count: async () => (await api.sessions(currentWeekRange())).length,
        },
      },
      {
        kind: "say",
        title: "Du musst nicht alles selbst bauen",
        route: "/plan",
        text: "Der Knopf „Wochen-Vorschlag“ baut dir eine komplette Woche: konkrete Einheiten mit Tag, Dauer, Ziel-Pace und Begründung — aus deiner Form, der Saison-Phase und deiner Verfügbarkeit. Viele Einheiten sind dynamisch: „5–6 × 1000 m, heute: 5“ — die Engine wählt den Tageswert nach deiner Tagesform. Und mit dem verschachtelten Builder (Profil → eigene Einheiten) baust du jede Struktur selbst, wie an der Uhr.",
      },
      {
        kind: "say",
        title: "Readiness — die App hört auf deinen Körper",
        route: "/plan",
        selector: "[data-tour='readiness']",
        text: "Sind deine HRV- oder Schlafwerte schwach, schlägt RunLog vor, die nächste harte Einheit zu entschärfen — mit einem Klick übernommen, nie automatisch. Das ist ein Muster, das dir überall begegnet: Die App berät datenbasiert, aber die Entscheidung bleibt bei dir.",
      },
      {
        kind: "task",
        title: "Aufgabe: Dokumentiere ein Training",
        route: "/track",
        text: "Trag im Tracking eine Aktivität ein — dein letzter Lauf reicht völlig (mit Strava kommt das künftig automatisch). Schau dir danach die „% Plan“-Zahl an: Sie misst, wie gut die Aktivität zur geplanten Einheit passt (TSS-Treffer + Zeit in der Ziel-Pace-Zone). Die Auto-Zuordnung kannst du pro Aktivität manuell übersteuern.",
        check: {
          count: async () => {
            const y = new Date();
            y.setDate(y.getDate() - 60);
            return (await api.activities({ from: iso(y) })).length;
          },
        },
        skippable: true,
        skipNote: "Wenn dein Strava-Sync noch läuft, füllt sich das Tracking von selbst — schau später einmal rein.",
      },
      {
        kind: "say",
        title: "Zwei Minuten, die Gold wert sind",
        route: "/track",
        text: "Im Tracking wohnen noch zwei kleine Gewohnheiten mit großem Hebel: die Tagesfaktoren (Schlaf, HRV, Befinden — morgens, 30 Sekunden) und der Kurz-Fragebogen nach jeder Einheit (Anstrengung + „besser/schlechter als erwartet?“). Warum das zählt: Genau aus diesen Daten lernt die App später, welches Training bei DIR wirkt — das ist Abschnitt 3. Was deine Morgendaten dir sagen, zeige ich dir gleich im Kino.",
      },
      { kind: "chart3d", chart: "wellness", title: "Daten-Kino: deine Morgen-Signale" },
      {
        kind: "say",
        title: "Der Wochenbericht — dein Laborbefund",
        route: "/report",
        text: "Einmal pro Woche lese ich hier: Wie war die Intensitätsverteilung (war locker wirklich locker?), stimmen geplant vs. real (die zwei Donuts), was sagen die Wochen-Checks? Mein wichtigster Blick: der Zonen-Balken. Wenn die Mitte fett wird — zu viel „halbgas“ — weiß ich, dass ich die lockeren Läufe wieder locker machen muss.",
      },
      {
        kind: "say",
        title: "Der lange Bogen: die Langzeit-Seite",
        route: "/longterm",
        text: "Hier siehst du die Monats- und Jahresperspektive: die große Formkurve (PMC) mit Phasenband und Rennen, Wellness-Trends, Schwellen-Entwicklung. Deine Kurve ist anfangs vielleicht noch kurz — wechsle gern mal oben links auf mein Profil „Tutorial: Isabel“: Dort siehst du 18 Monate Training. Zwei dieser Langzeit-Charts sind so wichtig, dass ich sie dir im Kino zeige: meine Schwelle und meine Lauf-Power.",
      },
      { kind: "chart3d", chart: "threshold", title: "Daten-Kino: der Schwellen-Trend" },
      { kind: "chart3d", chart: "power", title: "Daten-Kino: Lauf-Power (CP · W′)" },
      {
        kind: "quiz",
        question: "Dein TSB steht mitten im Trainingsblock bei −18. Was heißt das?",
        options: [
          { label: "Produktiv müde — im Aufbau genau richtig.", correct: true, feedback: "Richtig! −10 bis −25 ist die produktive Trainingszone. Erst unter −25 wird es riskant — und vor dem Wettkampf willst du per Taper zurück ins Plus." },
          { label: "Alarmstufe rot, sofort Pause.", feedback: "Nein — −18 ist im Aufbau normal und gewollt (produktiv müde). Kritisch wird es erst unter −25 oder wenn Readiness/HRV gleichzeitig einbrechen." },
          { label: "Ich bin topfrisch für ein Rennen.", feedback: "Andersrum: Negativ heißt ermüdet. Renn-frisch bist du im Plus (Taper hebt den TSB Richtung +10 bis +25) — merk dir das für Abschnitt 4, den Coach." },
        ],
      },
      {
        kind: "quiz",
        question: "Deine CTL-Ramp zeigt +9 pro Woche. Deine Reaktion?",
        options: [
          { label: "Etwas rausnehmen — nachhaltig sind +3 bis +6.", correct: true, feedback: "Genau. Über +8 steigt das Verletzungs- und Überlastungsrisiko deutlich. Fitness, die du in 3 Wochen aufbaust, verlierst du mit einer Zerrung in 6 wieder." },
          { label: "Super, schneller fitter werden!", feedback: "Verlockend, aber riskant: Über +8/Woche steigt das Verletzungsrisiko steil. Der nachhaltige Korridor ist +3 bis +6 — Geduld schlägt Heldentum." },
          { label: "Die Zahl ist egal, Hauptsache viele Kilometer.", feedback: "Gerade die Ramp schützt dich: Sie misst, wie schnell deine Last wächst. Zu steil = klassischer Weg in die Verletzung, egal wie gut sich die Beine anfühlen." },
        ],
      },
      {
        kind: "quiz",
        question: "Was misst die „% Plan“-Zahl an einer getrackten Aktivität?",
        options: [
          { label: "Wie gut die Aktivität zur geplanten Einheit passt (TSS + Ziel-Pace-Zone).", correct: true, feedback: "Richtig — beides zusammen: die Belastung getroffen UND im richtigen Tempobereich gelaufen. Ein zu schneller „lockerer Lauf“ bekommt zu Recht weniger Prozent." },
          { label: "Wie viel Prozent meiner Wochen-km ich geschafft habe.", feedback: "Das steht woanders (Wochenziel/Saisonplan). „% Plan“ vergleicht EINE Aktivität mit IHRER geplanten Einheit: Belastung getroffen + im richtigen Tempobereich?" },
          { label: "Meinen Fitnesszuwachs durch diese Einheit.", feedback: "Fitness wächst langsam über die CTL. „% Plan“ prüft etwas Bescheideneres, aber Wichtiges: Hast du trainiert, was geplant war — richtige Dosis, richtiges Tempo?" },
        ],
      },
      {
        kind: "scene",
        title: "Dein Rhythmus steht! 🎉",
        text: "Abschnitt 2 geschafft: Du kannst planen, dokumentieren und die drei Zahlen CTL/ATL/TSB lesen — damit steuerst du schon besser als die meisten. Halte den Rhythmus ein paar Wochen durch, füttere Tagesfaktoren und Feedback. Dann wird es richtig spannend: In Abschnitt 3 zeigt dir die App, welches Training bei DIR wirkt.",
      },
    ],
  },
  {
    id: "analyse",
    nr: 3,
    icon: "🔬",
    title: "Analyse — was wirkt bei DIR?",
    tagline: "Verdikt, Dosis-Wirkung, Experimente, Zyklus — dein Trainingslabor.",
    minutes: 21,
    available: true,
    steps: [
      {
        kind: "say",
        title: "Willkommen im Trainingslabor",
        text: "Bis hierhin hast du geplant und dokumentiert — jetzt kommt der Teil, für den es RunLog wirklich gibt: herausfinden, welches Training bei DIR wirkt. Drei Unterkapitel: 3a Verdikt & Dosis-Wirkung, 3b Regime & echte Experimente, 3c Zyklus (optional). Ehrlich vorweg: Diese Analysen brauchen Monate an eigenen Daten. Damit du heute etwas Echtes siehst, schauen wir auf MEIN Profil — 18 Monate Training, lückenlos dokumentiert.",
      },
      {
        kind: "task",
        title: "Aufgabe: Wechsle auf mein Profil",
        route: "/methodik",
        text: "Wähle oben links im Profil-Umschalter (👤) das Profil „Tutorial: Isabel“. Die App lädt kurz neu — keine Sorge, das Tutorial macht genau an dieser Stelle weiter. Deine Daten bleiben unberührt: Mein Profil ist ein Sandkasten, den du in den Einstellungen jederzeit frisch erzeugen kannst.",
        check: { test: onIsabelProfile },
        skippable: true,
        skipNote: "Ohne Wechsel siehst du dieselben Karten mit deinen eigenen (anfangs vielleicht leeren) Daten — die Erklärungen funktionieren trotzdem. Falls das Tutorial-Profil fehlt: Einstellungen → Tutorial-Profil neu erzeugen.",
      },
      {
        kind: "say",
        title: "Die Methodik-Seite — deine Werkbank",
        route: "/methodik",
        text: "Hier wohnt die Analyse, in vier Bereichen: Status (Marker-Batterie, latente Fitness, Readiness & Gesundheit), „Was wirkt?“ (das Herzstück), Experimente (der einzige kausale Pfad) und Zyklus (optional). Merk dir die Arbeitsteilung: Diese Seite ERKLÄRT — einstellen und anwenden tust du im Coach. Bevor wir zum Herzstück kommen, nehme ich dich mit ins Kino: die drei Status-Größen, auf denen alles rechnet.",
      },
      { kind: "chart3d", chart: "latent", title: "Daten-Kino: die latente Fitness" },
      { kind: "chart3d", chart: "vo2", title: "Daten-Kino: eff. VO2max je Lauf" },
      { kind: "chart3d", chart: "readiness", title: "Daten-Kino: Readiness & Gesundheit" },
      {
        kind: "say",
        title: "3a · „Was hilft dir?“ — das Gesamturteil",
        route: "/methodik?tab=effects",
        selector: "[data-tour='verdict']",
        text: "Diese Karte ist die Synthese aller Modelle. Für jede der drei Fragen — welcher Trainings-Reiz, welche Wochen-Verteilung, welcher Block-Schwerpunkt — zeigt sie den besten Kandidaten mit Effektgröße, Unsicherheitsbereich und Konfidenz. „Praktisch relevant“ heißt: Der Effekt ist größer als deine eigene Messgenauigkeit (MCID) — also kein statistisches Rauschen. Und jede Aussage trägt ihr Etikett: beobachtet oder kausal geprüft.",
      },
      {
        kind: "task",
        title: "Aufgabe: Starte die Dosis-Wirkungs-Analyse",
        route: "/methodik?tab=effects",
        text: "Scrolle zur Karte „Was wirkt bei dir?“ und klicke „Neu berechnen“. Das Modell zerlegt meine Trainingswochen in Reiz-Kanäle (aerob, Schwelle, VO₂max, …) und schätzt, wie viel latente Fitness ein Mehr an jedem Kanal bringt. Die Rechnung läuft im Hintergrund — je nach Rechner Sekunden bis wenige Minuten; du siehst den Fortschritt an der Karte.",
        check: {
          test: async () => {
            const e = await api.mlEffects();
            return e.mediator.length > 0 || e.composition.length > 0;
          },
        },
        skippable: true,
        skipNote: "Lass die Rechnung einfach im Hintergrund weiterlaufen und schau am Abschnitts-Ende wieder rein — lesen lernst du die Karte im nächsten Schritt so oder so.",
      },
      { kind: "chart3d", chart: "dose", title: "Daten-Kino: der Forest-Plot" },
      {
        kind: "quiz",
        question: "Das Dosis-Modell zeigt: „+1 SD Schwellen-Minuten → +0,4 latente Fitness, Konfidenz mittel.“ Was weißt du jetzt?",
        options: [
          { label: "Schwellentraining korreliert bei mir mit Fortschritt — ein starker Hinweis, kein Beweis.", correct: true, feedback: "Genau. Beobachtete Effekte sind kontrolliert gerechnet, aber Störfaktoren (Schlaf, Stress, Saisonphase) können mitspielen. Beweisen kann das nur ein randomisiertes Experiment — kommt gleich in 3b." },
          { label: "Schwellentraining IST bewiesenermaßen die Ursache meines Fortschritts.", feedback: "Verlockend — aber dafür trägt die Aussage das Etikett „beobachtet“. Vielleicht hast du in Schwellen-Wochen auch besser geschlafen oder weniger gearbeitet. Den Kausal-Beweis liefert nur das randomisierte N-of-1-Experiment (3b)." },
          { label: "Die Zahl ist Zufall und bedeutet gar nichts.", feedback: "Doch, sie bedeutet etwas — nur eben weniger als „bewiesen“. Das Modell kontrolliert Störgrößen und zeigt seine Unsicherheit ehrlich. Als Hinweis für die Blockplanung ist das wertvoll; als Naturgesetz nicht." },
        ],
      },
      {
        kind: "say",
        title: "3b · Regime — welche Wochen-Verteilung?",
        route: "/methodik?tab=effects",
        selector: "[data-tour='regime']",
        text: "Zweite Achse: nicht WIE VIEL, sondern WIE VERTEILT. Polarisiert, pyramidal, Threshold, Norwegian — die passive Inferenz sucht zusammenhängende Wochen-Blöcke desselben Regimes und vergleicht, wie sich Critical Speed & Co. darin entwickelt haben. Wichtig: Die Konfidenz folgt der Zahl unabhängiger Blöcke, nicht der Wochenzahl — ein einziger langer Block kann täuschen. Und auch hier gilt: Korrelation, nicht Kausalität.",
      },
      {
        kind: "say",
        title: "Das Kausal-Experiment — der einzige Beweis-Pfad",
        route: "/methodik?tab=experiments",
        selector: "[data-tour='trial']",
        text: "Hier wird aus Beobachtung Wissenschaft: Ein N-of-1-Experiment randomisiert Trainingsblöcke — der Zufall entscheidet, ob ein Block Variante A oder B wird (z. B. VO₂max-Fokus vs. Schwelle). Weil der Zufall zuteilt, fallen Störfaktoren im Mittel heraus. Am Ende prüft ein Permutationstest, ob der Unterschied echt ist. Bei mir läuft gerade genau so ein Trial — du siehst den Blockplan mit Washout-Puffern dazwischen.",
      },
      {
        kind: "say",
        title: "So legst du selbst eins an",
        route: "/methodik?tab=experiments",
        text: "Du musst dir kein Experiment ausdenken: Sieht das Verdikt ein starkes beobachtetes Signal ohne Kausal-Beleg, schlägt es dir unter „Kausal absichern?“ das passende Experiment vor. Annehmen randomisiert die Blöcke und schreibt sie in deinen Plan — abbrechen geht jederzeit, die Blöcke bleiben archiviert. Mein Tipp: Starte erst, wenn ein paar Monate Grunddaten da sind, sonst fehlt dem Test die Kraft.",
      },
      {
        kind: "say",
        title: "Research-Mode — für Neugierige",
        route: "/methodik?tab=effects",
        selector: "[data-tour='verdict']",
        text: "Ganz unten in der Verdikt-Karte schlummert der Research-Mode (standardmäßig aus): ein nichtlineares Modell (LightGBM + SHAP), das zusätzlich dein Session-Feedback nutzt und auch krumme Zusammenhänge findet — etwa „VO₂max-Wochen wirken nur bei guter Readiness“. Sauber einordnen: eine Hypothesen-Maschine. Nichts davon steuert je deinen Plan — dafür sind Verdikt und Experimente da.",
      },
      {
        kind: "quiz",
        question: "Womit kann RunLog eine Ursache-Wirkungs-Beziehung wirklich BEWEISEN?",
        options: [
          { label: "Mit einem randomisierten N-of-1-Experiment.", correct: true, feedback: "Richtig — es ist der einzige kausale Pfad in der App. Die Randomisierung neutralisiert Störfaktoren; Forest-Plot, Regime-Inferenz und Research-Mode bleiben Hinweise, so wertvoll sie sind." },
          { label: "Mit genug Wochen im Forest-Plot.", feedback: "Mehr Wochen machen die Schätzung präziser — aber nicht kausal. Wenn du in harten Wochen systematisch auch besser schläfst, bleibt der Störfaktor drin, egal wie lang die Reihe ist. Beweisen kann es nur die Randomisierung." },
          { label: "Mit dem Research-Mode (SHAP).", feedback: "Der Research-Mode ist ausdrücklich das Gegenteil: eine explorative Hypothesen-Maschine, die bewusst NICHTS steuert. Er gibt dir Ideen — geprüft werden sie im randomisierten N-of-1-Experiment." },
        ],
      },
      {
        kind: "say",
        title: "3c · Zyklus (optional) — Training im Rhythmus",
        route: "/methodik?tab=cycle",
        selector: "[data-tour='cycle']",
        text: "Wenn du einen Menstruationszyklus hast, kann RunLog ihn als vierten Input in die Plansteuerung nehmen — aber nur mit deiner ausdrücklichen Einwilligung im Profil, und die Daten bleiben lokal auf deinem Rechner. Bei mir siehst du das Vollbild: Zyklus-Tracking (ich verhüte mit Kupferspirale, also natürlicher Zyklus), Symptom-Muster und die Evidenz-Tabelle: Wie gut vertrage ich welchen Reiz in welcher Phase?",
      },
      { kind: "chart3d", chart: "cycle", title: "Daten-Kino: Phase × Reiz" },
      {
        kind: "task",
        title: "Aufgabe: Wechsle zurück auf DEIN Profil",
        route: "/methodik",
        text: "Wähle oben links wieder dein eigenes Profil. Die App lädt kurz neu, das Tutorial wartet hier auf dich — dann gehört das Labor wieder dir.",
        check: { test: async () => !(await onIsabelProfile()) },
      },
      {
        kind: "say",
        title: "Und wann liefert DEINE App das alles?",
        text: "Der ehrliche Teil zum Schluss: Das Dosis-Modell und das Verdikt brauchen grob ein halbes Jahr dokumentiertes Training, das Regime-Bild mehrere Blöcke, der Zyklus ein paar stabile Zyklen. Deine App sagt dir das jeweils präzise (z. B. „noch zu wenig Daten: 12/24 Wochen“). Dein Job bis dahin ist simpel und kennst du schon aus Abschnitt 2: trainieren, tracken, Tagesfaktoren und Feedback pflegen. Die Analyse wächst von selbst nach.",
      },
      {
        kind: "scene",
        title: "Dein Labor ist eröffnet! 🔬",
        text: "Abschnitt 3 geschafft — du kannst jetzt lesen, was kaum eine Trainingsapp überhaupt anbietet: Effekt, Unsicherheit, Konfidenz, beobachtet vs. kausal geprüft. Merk dir die Leiter: Dosis-Wirkung (Hinweis) → Regime (Hinweis) → N-of-1-Experiment (Beweis). Im letzten Abschnitt bringen wir alles auf die Straße: Der Coach plant meinen Weg zum Halbmarathon — und bald deinen zu deinem Rennen.",
      },
    ],
  },
  {
    id: "coach",
    nr: 4,
    icon: "🧭",
    title: "Coach — mit Plan zum Renntag",
    tagline: "Mein Weg zum Halbmarathon: Block, Timeline, Peak, Taper.",
    minutes: 13,
    available: true,
    steps: [
      {
        kind: "say",
        title: "Der Countdown läuft: 6 Wochen bis zum Renntag",
        text: "Jetzt wird es ernst — mein Ziel-Halbmarathon ist in sechs Wochen, Wunschzeit 1:27:00. In diesem Abschnitt zeige ich dir den Coach: Er baut aus Rennen, Form, Verfügbarkeit und deiner Evidenz aus Abschnitt 3 einen kompletten Trainingsblock bis zum Renntag. Wir üben wieder in meinem Sandkasten — und am Ende richtest du deinen eigenen Weg ein.",
      },
      {
        kind: "task",
        title: "Aufgabe: Wechsle auf mein Profil",
        route: "/races",
        text: "Wie in Abschnitt 3: oben links im Profil-Umschalter (👤) „Tutorial: Isabel“ wählen. Die App lädt kurz neu, das Tutorial macht genau hier weiter.",
        check: { test: onIsabelProfile },
        skippable: true,
        skipNote: "Ohne Wechsel führst du die Schritte auf deinem eigenen Profil aus — das funktioniert, sobald du einen Saisonplan und ein Rennen hast; sonst schau einfach den Erklärungen zu.",
      },
      {
        kind: "say",
        title: "Alles beginnt mit einem Ziel",
        route: "/races",
        text: "Auf der Rennen-Seite steht mein Ziel-Halbmarathon — mit Wunsch-Zielzeit 1:27:00. Diese eine Zahl arbeitet überall: Sie treibt die Pace-Progression der Trainingseinheiten, den Soll/Ist-Abgleich und die Prognose bis zum Renntag. Darunter meine Test-Wettkämpfe: Der 15-km-Test und der Halbmarathon-Test (1:31:18) füttern VDOT und Critical Speed — deshalb sind Test-Rennen im Aufbau so wertvoll.",
      },
      {
        kind: "say",
        title: "Das Cockpit",
        route: "/coach",
        text: "Der Coach ist die Kommandozentrale: oben der Fortschritts-Check — mein letzter Test-Wettkampf gegen die Erwartung, daraus die Hauptrennen-Prognose („auf Kurs?“) —, darunter der Wettkampf-Block, das Taper-Modell, die optimalen Zonen und deine Verfügbarkeit. Hier wird aus Analyse Handlung.",
      },
      {
        kind: "task",
        title: "Aufgabe: Lade meinen Wettkampf-Block",
        route: "/coach",
        text: "Klicke in der Karte „Wettkampf-Block“ auf „▶ Block-Vorschlag laden“. Der Coach baut den kompletten Mesozyklus von der gewählten Woche bis zum Renntag — Phasen, Entlastungswochen, Taper, und jede Woche mit konkreten Einheiten.",
        check: { test: domHas("[data-tour='block-timeline']") },
        skippable: true,
        skipNote: "Wenn hier nichts lädt (auf deinem Profil braucht es Saisonplan + Rennen), überspringe — auf meinem Profil siehst du das Vollbild.",
      },
      {
        kind: "say",
        title: "Die Timeline lesen",
        route: "/coach",
        selector: "[data-tour='block-timeline']",
        text: "Jede Säule eine Woche: Farbe = Phase (Build, Specific, Taper), Höhe = Last. Darüber die Readiness-Kurve — so soll deine Form (TSB) zum Renntag ins Plus drehen — und der Zielvermerk „bereit für ~…“. Ein Klick auf eine Woche öffnet die Details: jede Einheit mit Tag, Dauer, TSS, Beschreibung — und bei Qualitätstagen ihrem „Warum“ aus dem Schwerpunkt.",
      },
      {
        kind: "say",
        title: "Das Coaching-Verdikt — deine Evidenz steuert mit",
        route: "/coach",
        selector: "[data-tour='coaching-verdict']",
        text: "Erinnerst du dich an Abschnitt 3? Hier schließt sich der Kreis: Der Block-Schwerpunkt kommt aus deiner Evidenz — ehrlich etikettiert (beobachtet vs. geprüft) und mit Begründung. Gesundheits-Signale können die Last deckeln (Health-Cap). Das letzte Wort hast du: „Auto (Evidenz)“ oder manuell pinnen. Und „→ Belege in Methodik“ springt direkt zur Beweislage.",
      },
      {
        kind: "task",
        title: "Aufgabe: Richte den Peak auf den Renntag aus",
        route: "/coach",
        text: "Klicke „🎯 Peak ausrichten“. Wenn mein persönliches Taper-Modell (Banister) belastbar ist, bestimmt ES die Taper-Länge — tages-genau, mit einem distanz-typischen Minimum als Sicherheitsnetz. Sonst greift eine sportwissenschaftliche Heuristik (1–3 Wochen). Wichtig: Das ist erst einmal nur Vorschau — festgeschrieben wird es mit „Phasen übernehmen“.",
        check: {
          test: async () => {
            const txt = document.querySelector("[data-tour='block']")?.textContent ?? "";
            return txt.includes("🎯 Taper") || txt.includes("🎯 Ausgerichtet");
          },
        },
        skippable: true,
        skipNote: "Ohne geladenen Block gibt es nichts auszurichten — die Idee nimmst du trotzdem mit: Der Taper wird aus DEINEN Daten bestimmt, nicht aus einer Pauschalregel.",
      },
      {
        kind: "say",
        title: "Vertiefung: Dein optimales Taper",
        route: "/coach",
        selector: "[data-tour='banister']",
        text: "Das Modell dahinter heißt Banister Fitness−Fatigue: Jede Einheit zahlt auf zwei Konten ein — Fitness (wirkt lange) und Ermüdung (wirkt kurz, aber stärker). Im Taper verfällt die Ermüdung schneller, als die Fitness schwindet; genau daraus errechnet die Karte, wie viele Tage vor dem Rennen du die Last senken solltest. Kalibriert an deinen eigenen Markern — und ehrlich, wenn die Datenlage dafür noch zu dünn ist.",
      },
      {
        kind: "task",
        title: "Aufgabe: Übernimm eine Woche in die Wochenplanung",
        route: "/coach",
        text: "Such dir im Block eine Woche aus und klicke „Übernehmen“ — die Einheiten landen additiv in der Wochenplanung, mit Beschreibung, Ziel-Pace und Begründung. Genau so arbeitest du im Alltag: Der Block ist die Landkarte, übernommen wird Woche für Woche. So bleibt Raum, auf Form, Readiness und das echte Leben zu reagieren.",
        check: { count: plannedSessionCount },
        skippable: true,
        skipNote: "Ohne geladenen Block geht das nicht — der Ablauf ist trotzdem einfach: Block laden → Woche wählen → „Übernehmen“.",
      },
      {
        kind: "say",
        title: "Die Woche lebt weiter",
        route: "/plan",
        text: "Zurück in der Wochenplanung: Wähle oben die übernommene Woche und du siehst die Einheiten im Kalender. Ab hier greift alles aus Abschnitt 2 — dynamische Vorgaben wie „5–6 × 1000 m“ entscheidet die Engine am Tag selbst nach deiner Tagesform, und bei schwacher Readiness schlägt sie vor, den harten Tag zu entschärfen. Plan und Realität bleiben im Gespräch.",
      },
      {
        kind: "quiz",
        question: "Was passiert physiologisch im Taper?",
        options: [
          { label: "Die Ermüdung verfällt schneller als die Fitness — die Form (TSB) dreht ins Plus.", correct: true, feedback: "Genau. Du verlierst in 10–14 ruhigeren Tagen kaum Fitness, wirst aber deutlich frischer — netto steigt die abrufbare Leistung. Deshalb gehören kurze, knackige Erinnerungs-Reize in den Taper, aber wenig Volumen." },
          { label: "Die Fitness steigt durch die Pause noch einmal kräftig an.", feedback: "Nicht ganz — die Fitness (CTL) sinkt im Taper sogar leicht. Der Gewinn kommt vom anderen Konto: Die Ermüdung baut sich viel schneller ab, und die Differenz — deine Form — dreht ins Plus." },
          { label: "Man verliert nur Form; besser bis zum Renntag durchtrainieren.", feedback: "Der klassische Fehler ehrgeiziger Läufer. Ohne Taper stehst du müde an der Startlinie — die Fitness ist da, aber nicht abrufbar. Kontrolliert Last rausnehmen macht dich am Renntag schneller, nicht langsamer." },
        ],
      },
      {
        kind: "quiz",
        question: "Woher nimmt „🎯 Peak ausrichten“ die Länge deines Tapers?",
        options: [
          { label: "Aus meinem kalibrierten Banister-Modell, wenn es belastbar ist — sonst aus einer Heuristik; nie unter dem Distanz-Minimum.", correct: true, feedback: "Richtig. Erst das persönliche Modell (tages-genau aus deinen Markern), als Fallback die sportwissenschaftliche Heuristik — und ein distanz-typisches Minimum (Marathon ≥ ~14 Tage) als Sicherheitsnetz gegen zu kurze Taper." },
          { label: "Es sind immer exakt 2 Wochen, das ist der Standard.", feedback: "Nein — genau davon will RunLog weg. Wie schnell DU Ermüdung abbaust, ist individuell; das Banister-Modell misst es an deinen Daten. Pauschal 2 Wochen sind nur eine grobe Mitte." },
          { label: "Aus dem Bauchgefühl der letzten Trainingswoche.", feedback: "Bauchgefühl ist ein wertvolles Signal fürs Tagesgeschäft — aber die Taper-Länge rechnet RunLog aus deinem Fitness-Ermüdungs-Verlauf. Beides zusammen ist die beste Kombination." },
        ],
      },
      {
        kind: "task",
        title: "Aufgabe: Wechsle zurück auf DEIN Profil",
        route: "/coach",
        text: "Oben links wieder dein eigenes Profil wählen — Zeit, das Gelernte auf dich zu übertragen.",
        check: { test: async () => !(await onIsabelProfile()) },
      },
      {
        kind: "task",
        title: "Aufgabe: Leg DEIN nächstes Rennen an",
        route: "/races",
        text: "Trag dein nächstes Rennen ein — Datum, Distanz und, wenn du magst, eine Wunsch-Zielzeit. Ab da kann der Coach für DICH rechnen: Block laden, Peak ausrichten, Woche für Woche übernehmen. Kein Rennen in Sicht? Auch ein Trainings-Testlauf über 5 oder 10 km in 8–10 Wochen ist ein wunderbares erstes Ziel.",
        check: { count: async () => (await api.races()).length },
        skippable: true,
        skipNote: "Du kannst jederzeit später ein Rennen anlegen — der Coach wartet geduldig. Ohne Ziel plant er trotzdem mit dir, nur eben ohne Renntag-Countdown.",
      },
      {
        kind: "scene",
        finale: true,
        title: "Zieleinlauf! 🏁",
        text: "Spulen wir vor — Renntag, die letzten 300 Meter, die Uhr zeigt 1:26… Zieleinlauf 1:26:48, zwölf Sekunden unter meiner Wunschzeit. Nicht wegen eines Wunder-Workouts, sondern wegen achtzehn Monaten: planen, dokumentieren, lesen, was wirkt, und dem Renntag entgegen tapern. Genau diesen Werkzeugkasten hast du jetzt. Das Tutorial ist geschafft — lauf los! Und wenn du wissen willst, wie die Modelle unter der Haube rechnen: Das Nerd-Add-on wartet unter „Lernen“.",
      },
    ],
  },
  {
    id: "nerd",
    nr: 5,
    icon: "🤓",
    title: "Nerd — die Mathematik dahinter",
    tagline: "Für Neugierige: Kalman, Bayes, Banister — Intuition + Formel.",
    minutes: 15,
    optional: true,
    available: true,
    steps: [
      {
        kind: "say",
        title: "Willkommen im Maschinenraum",
        text: "Schön, dass du neugierig bist! In diesem Add-on öffne ich sechs Motorhauben: TSS/PMC, VDOT & Critical Speed, die latente Fitness (Kalman), die Dosis-Wirkung (Ridge/Bayes), der Permutationstest und das Banister-Taper. Zu jedem Modell bekommst du erst die Intuition als Bild — und darunter, zum Aufklappen, die echte Formel, so wie RunLog sie rechnet. Kein Vorwissen nötig, aussteigen jederzeit erlaubt.",
      },
      {
        kind: "model",
        title: "TSS & PMC — Last wird Form",
        visual: "pmc",
        text: "Die grauen Balken sind deine Trainingstage. Daraus laufen zwei Gedächtnisse: Die blaue Kurve (CTL, „Fitness“) erinnert sich 42 Tage zurück und bewegt sich träge; die gelbe (ATL, „Ermüdung“) erinnert sich nur 7 Tage und zappelt. Die Differenz der beiden ist deine Form (TSB). Alles im PMC ist nur diese eine Idee: dieselben Daten, zwei verschieden lange Gedächtnisse.",
        formula: {
          lines: [
            "IF   = NGP / Schwellen-Pace            (Intensitätsfaktor)",
            "rTSS = Stunden · IF² · 100             (1 h exakt an der Schwelle = 100)",
            "CTL[t] = CTL[t−1] + (TSS[t] − CTL[t−1]) / 42",
            "ATL[t] = ATL[t−1] + (TSS[t] − ATL[t−1]) / 7",
            "TSB[t] = CTL[t−1] − ATL[t−1]",
          ],
          note: "CTL/ATL sind exponentiell gewichtete Mittel (EWMA) mit 42 bzw. 7 Tagen Zeitkonstante. Das Quadrat im TSS ist der Kern: doppelt so intensiv zählt vierfach.",
        },
      },
      {
        kind: "model",
        title: "VDOT & Critical Speed — was du kannst",
        visual: "cs",
        text: "Deine Bestleistungen (gelbe Punkte) liegen auf einer Tempo-Dauer-Kurve: Je länger die Belastung, desto näher kommt dein Tempo einer Grenze — der türkisen Linie. Das ist die Critical Speed, dein robuster Schwellen-Anker (≈ 1-Stunden-Tempo). Der Bogen darüber ist D′, deine anaerobe Reserve: ein begrenzter Meter-Vorrat oberhalb der CS. VDOT macht dasselbe mit den Daniels-Gleichungen und liefert die Pace-Zonen.",
        formula: {
          lines: [
            "d_i = D′ + CS · t_i          (Gerade durch deine Bestleistungen: Distanz ~ Zeit)",
            "v(t) = CS + D′/t             (als Tempo-Dauer-Kurve: Asymptote = CS)",
            "VO₂(v)     = −4.60 + 0.182258·v + 0.000104·v²                     (Daniels)",
            "%VO₂max(t) = 0.8 + 0.1894393·e^(−0.012778·t) + 0.2989558·e^(−0.1932605·t)",
            "VDOT = VO₂(v_Rennen) / %VO₂max(t_Rennen)",
          ],
          note: "Zwei Parameter, direkt aus deinen Rennen — deshalb füttern Test-Wettkämpfe die Zonen. D′ steht in Metern: dein „Batterie-Vorrat“ über der Critical Speed.",
        },
      },
      {
        kind: "model",
        title: "Latente Fitness — die Wahrheit hinter dem Rauschen",
        visual: "kalman",
        text: "Deine Fitness-Messungen streuen: Labortests (türkis) sind präzise, Rennen (gelb) gut, einzelne Läufe (rot) grob. Der Kalman-Filter mit RTS-Smoother zieht die glatte blaue Kurve hindurch — und gewichtet dabei jede Quelle nach ihrem Vertrauen. Die transparente Hülle ist die ehrliche Unsicherheit: Wo lange keine Messung war, wird sie breiter. Diese Kurve ist der saubere Outcome, auf dem fast alle weiteren Modelle rechnen.",
        formula: {
          lines: [
            "Zustand:  x[t] = F·x[t−1] + w      F = [[1,1],[0,1]]  (Level wächst mit Trend)",
            "Messung:  z = H·x[t] + R           H = [1,0] · R je Quelle: Labor < Rennen < Lauf",
            "Q = diag(0.08², 0.012²)            (wie schnell dürfen Level/Trend wandern)",
            "vorwärts Kalman-Filter · rückwärts RTS-Smoother",
            "f[t] = Mittel + Level[t]·Skala,    sd[t] = √Var(Level[t])·Skala",
          ],
          note: "Der RTS-Smoother nutzt auch spätere Messungen für frühere Wochen — und sd[t] wird später als Gewicht wiederverwendet: sichere Fitness-Punkte zählen mehr.",
        },
      },
      {
        kind: "model",
        title: "Dosis-Wirkung — welcher Reiz baut Fitness?",
        visual: "dose",
        text: "Jede Zeile ein Reiz-Kanal, geschätzt gegen die latente Fitness: Der Punkt ist der Effekt, der Balken die Unsicherheit, die graue Wand die Null. Liegt ein Balken komplett rechts davon (wie hier der oberste), ist das ein belastbares Signal. Gerechnet wird das zweimal — absolut (Mediator) und volumen-bereinigt (Komposition: „bei gleichem Umfang“) — und die Bayes-Vertiefung schätzt sogar, wie lange ein Reiz nachwirkt.",
        formula: {
          lines: [
            "ctl_c[t] = EWMA₄₂( Tages-TSS des Kanals c )        (Kanal-Dosis)",
            "Ridge:  (XᵀWX + λI)·β = XᵀW·y      W = Recency · λ aus blocked CV",
            "Bayes:  β_c ~ Normal(0, τ)  →  Posterior + 94%-HDI + P(β>0)",
            "IR:     g_c[t] = Σ_s z_c[s]·e^(−(t−s)/τ_c)   — der Zerfall τ_c wird mitgeschätzt",
            "Halbwertszeit = τ_c · ln 2         („so lange trägt der Reiz“)",
            "CI: Moving-Block-Bootstrap · Gates: MCID, BH-FDR, E-Value",
          ],
          note: "Drei ehrliche Sicherungen: MCID (größer als deine Messgenauigkeit?), FDR (viele Kanäle = viele Zufalls-Chancen) und E-Value (wie stark müsste ein unbeobachteter Störfaktor sein?). Und alles bleibt beobachtet, nicht kausal.",
        },
      },
      {
        kind: "quiz",
        question: "Die Bayes-Vertiefung sagt: „Schwellen-Reiz, Halbwertszeit ≈ 5 Wochen.“ Was fängst du damit an?",
        options: [
          { label: "Nach ~5 Wochen ist die halbe Wirkung verflogen — den Reiz also regelmäßig auffrischen.", correct: true, feedback: "Genau! Die Halbwertszeit (τ·ln 2) sagt dir den Nachlege-Rhythmus: Ein Block wirkt nach, aber nicht ewig. Deshalb hält der Coach wirksame Reize in der Rotation, statt sie einmal abzuhaken." },
          { label: "Nach 5 Wochen Schwellentraining bin ich austrainiert.", feedback: "Andersherum: Die Zahl beschreibt das VERGESSEN, nicht das Lernen — wie schnell die Wirkung eines Reizes abklingt, wenn du ihn weglässt. Sie sagt dir, wann du nachlegen solltest, nicht wann Schluss ist." },
          { label: "Ich darf höchstens 5 Wochen am Stück trainieren.", feedback: "Nein — mit deinem Training hat die Zahl nur indirekt zu tun. Sie misst, wie lange ein gesetzter Reiz nachwirkt. Praktische Folge: Pausiert ein Kanal länger als seine Halbwertszeit, schmilzt sein Beitrag sichtbar ab." },
        ],
      },
      {
        kind: "model",
        title: "Der Permutationstest — Beweis statt Bauchgefühl",
        visual: "permutation",
        text: "So prüft dein N-of-1-Experiment am Ende: Für jedes Blockpaar wird die Fitness-Differenz zwischen Arm A und B gebildet. Dann fragt der Test: Wenn die Zuordnung reiner Zufall gewesen wäre — welche Ergebnisse wären möglich? Er rechnet ALLE Vorzeichen-Kombinationen durch (die grauen Balken). Steht dein beobachteter Effekt (rot) weit draußen im Schwanz, war es sehr wahrscheinlich kein Zufall. Keine Normalverteilungs-Annahme, keine Tricks — nur Abzählen.",
        formula: {
          lines: [
            "d_i = Δ latente Fitness (Arm A − Arm B) im Paar i",
            "θ = Ø d_i                          (beobachteter Effekt)",
            "Referenz: ALLE 2^P Vorzeichen-Flips der d_i",
            "p_exact = Anteil der Flips mit |T*| ≥ |θ|",
          ],
          note: "Kausal belastbar, weil die Reihenfolge je Paar real randomisiert wurde — kein Beobachtungs-Störfaktor kann θ systematisch erzeugen. Der einzige Beweis-Pfad der App.",
        },
      },
      {
        kind: "quiz",
        question: "Warum darf ausgerechnet der Permutationstest „kausal“ sagen — Forest-Plot & Co. aber nicht?",
        options: [
          { label: "Weil hier real randomisiert wurde — der Zufall neutralisiert Störfaktoren, der Test zählt nur nach.", correct: true, feedback: "Richtig. Die Randomisierung passiert VOR den Daten (welcher Arm zuerst), darum kann kein Störfaktor systematisch in θ einsickern. Beobachtungsmodelle können Confounder nur kontrollieren, nie ausschließen." },
          { label: "Weil er mathematisch komplizierter ist als die anderen Modelle.", feedback: "Er ist sogar das simpelste Verfahren von allen — buchstäblich Abzählen. Die Kraft kommt nicht aus der Mathematik, sondern aus dem Design: Die Randomisierung war real, deshalb ist der Schluss kausal." },
          { label: "Weil er mit mehr Daten rechnet als die Regression.", feedback: "Meist rechnet er mit deutlich WENIGER Daten (ein paar Blockpaare). Entscheidend ist nicht die Menge, sondern das Design: echte Randomisierung schlägt beliebig viele beobachtete Wochen." },
        ],
      },
      {
        kind: "model",
        title: "Banister — warum Tapern schneller macht",
        visual: "banister",
        text: "Das älteste Modell der Trainingswissenschaft, an deinen Daten kalibriert: Jede Einheit zahlt auf zwei Konten ein — Fitness (blau, träge) und Ermüdung (gelb, flüchtig, aber schwerer gewichtet). Deine abrufbare Leistung (türkis) ist die Differenz. Ab dem Taper-Start fällt die Ermüdung schnell, die Fitness kaum — die türkise Kurve steigt und peakt idealerweise genau am Renntag (dunkler Marker). Aus dem argmax dieser Kurve kommt deine persönliche Taper-Länge in „🎯 Peak ausrichten“.",
        formula: {
          lines: [
            "Fitness:  g[t] = Σ_s TSS[s]·e^(−(t−s)/τ₁)     (langsamer Zerfall)",
            "Ermüdung: h[t] = Σ_s TSS[s]·e^(−(t−s)/τ₂)     (schneller Zerfall, τ₂ < τ₁)",
            "Leistung: P[t] = p₀ + k₁·g[t] − k₂·h[t]       (k₂ > k₁: Ermüdung wiegt schwerer)",
            "Taper-Länge = argmax P[Renntag] über den Taper-Start",
          ],
          note: "Auf Wochenraster an deinen Markern kalibriert (k₂/k₁ ≈ 1,5). Ist das Unsicherheitsband zu breit, sagt die Karte das ehrlich — und „Peak ausrichten“ fällt auf die sportwissenschaftliche Heuristik zurück.",
        },
      },
      {
        kind: "say",
        title: "Alles live, mit deinen Daten: die Nerd-Seite",
        text: "Alles, was du gerade als Intuition gesehen hast, gibt es live und mit DEINEN Zahlen: auf der versteckten Nerd-Seite (Pfeiltasten → → ← ← ↑ ↓ ↑ ↓) — jede Kennzahl mit Herkunft, jede Engine mit „so wird’s gerechnet“. Und der Lab Mode (↑ ↑ ↓ ↓ ← → ← →) zeigt deine Lifetime-Statistiken. Beide sind bewusst versteckt: Werkzeug für Neugierige, kein Ballast für alle.",
      },
      {
        kind: "scene",
        title: "Offiziell ein Nerd! 🤓",
        text: "Respekt — die wenigsten schauen unter die Haube. Du weißt jetzt: Zwei Gedächtnisse machen aus Last eine Form, ein Kalman-Filter destilliert Fitness aus Rauschen, Ridge und Bayes wägen Reize ehrlich ab, nur echte Randomisierung beweist, und Tapern ist angewandte Zerfalls-Mathematik. Wenn dir in der App je eine Zahl komisch vorkommt: Die Formel dahinter kennst du jetzt — und die Nerd-Seite zeigt sie dir live.",
      },
    ],
  },
];

export const sectionById = (id: string): TutSection | undefined => SECTIONS.find((s) => s.id === id);

/** Erstdurchlauf: Abschnitt N ist frei, wenn alle Haupt-Abschnitte davor abgeschlossen sind (Nerd immer frei). */
export function isUnlocked(section: TutSection, done: string[]): boolean {
  if (section.optional) return true;
  return SECTIONS.filter((s) => !s.optional && s.nr < section.nr).every((s) => done.includes(s.id));
}
