// Chart-Kino-Szene: Zyklus — Phase × Reiz. Kuratiert wie Isabels echte Heatmap: 5 Phasen × 4 Reize als
// begehbare Turmlandschaft — Höhe/Farbe = Effekt (Hedges' g, geschrumpft) gegen den eigenen Reiz-Schnitt,
// graue flache Zellen = zu wenig Daten (n<3). Stars: Follikelphase×Schwelle +1.4 · späte Luteal −1.4.
// Isabel geht selbst zwischen den Türmen hindurch. Optional-Kapitel: Consent, lokal, bounded.
import * as THREE from "three";
import { KINO, block, spriteLabel, type Beat, type CinemaScene } from "../sceneKit.ts";

const PHASES = ["Menstruation", "Follikelphase", "Ovulation", "frühe Luteal", "späte Luteal"];
const STIMULI = ["Locker", "Lange Einheit", "Schwelle", "VO2max"];
// [Effekt, n] je Zelle — Zeile = Phase, Spalte = Reiz (aus Isabels echter Tabelle)
const CELLS: [number, number][][] = [
  [[-0.3, 23], [0.1, 13], [-0.6, 7], [0, 2]],
  [[0.5, 34], [-0.1, 19], [1.4, 20], [0, 1]],
  [[0.1, 16], [0.7, 6], [0.3, 9], [0, 1]],
  [[-0.1, 25], [0.1, 11], [0.3, 14], [0, 2]],
  [[-0.1, 36], [-0.3, 20], [-1.4, 24], [0, 2]],
];
const xOf = (p: number) => -2.4 + p * 1.2;   // Phase → x
const zOf = (s: number) => -0.9 + s * 0.6;   // Reiz → z
const hOf = (g: number) => 0.22 + Math.abs(g) * 0.62;
const colorOf = (g: number, n: number) => (n < 3 ? 0x475569 : g > 0.2 ? 0x22c55e : g < -0.2 ? 0xdc2626 : 0x64748b);

export function cycleScene(): CinemaScene {
  const beats: Beat[] = [
    {
      title: "Deine Zyklus-Landkarte (optionales Kapitel)",
      text: "Jeder Turm eine Frage: „Wie gut vertrage ich Reiz X in Phase Y — verglichen mit meinem eigenen Schnitt für diesen Reiz?“ Grün und hoch = besser als üblich, rot und tief = schlechter, grau und flach = noch zu wenig Daten für eine Aussage. Alles daran ist N-of-1: MEINE Muster aus MEINEN Rückmeldungen, nicht die einer Studien-Gruppe. Und alles bleibt lokal und braucht deine ausdrückliche Einwilligung.",
      cam: [0, 3.0, 6.6], look: [0, 0.5, 0],
      isabel: { kind: "pose", at: [3.3, 0, 1.6], clip: "Wave", faceTo: [3.3, 0, 7] },
    },
    {
      title: "Der Wert: Follikelphase × Schwelle +1.4",
      text: "Mein grünster Turm: Schwellen-Einheiten in der Follikelphase laufen bei mir um 1.4 Einheiten besser als mein Schwellen-Schnitt — bei n=20 Einheiten über mehrere Zyklen repliziert, das ist belastbar. Die Einheit dahinter ist ein standardisiertes Effektmaß (Hedges' g) aus meinem Session-Feedback: Anstrengung und „besser/schlechter als erwartet“.",
      cam: [-0.6, 2.2, 3.8], look: [xOf(1), 0.8, zOf(2)],
      isabel: { kind: "walk", to: [xOf(1) + 0.55, 0, zOf(2) + 0.9], then: "Point", faceTo: [xOf(1), 1.0, zOf(2)] },
      highlight: "cell:1:2",
      exclaim: "+1.4 · n=20",
    },
    {
      title: "…und der rote Zwilling",
      text: "Gleicher Reiz, andere Phase: Schwelle in der SPÄTEN Lutealphase steht bei −1.4 (n=24). Dieselbe Einheit, die mir zwei Wochen vorher leichtfällt, fühlt sich hier zäh an und bringt schlechteres Feedback. Wichtig fürs Selbstbild: Das ist kein „Schwäche-Fenster“, sondern Information — der Reiz ist nicht falsch, nur der ZEITPUNKT ist bei mir teuer. Und die grauen VO2-Türme sagen ehrlich: dazu weiß ich noch nichts.",
      cam: [2.6, 2.2, 3.6], look: [xOf(4), 0.7, zOf(2)],
      isabel: { kind: "walk", to: [xOf(4) - 0.6, 0, zOf(2) + 0.9], then: "Point", faceTo: [xOf(4), 0.8, zOf(2)] },
      highlight: "cell:4:2",
      exclaim: "−1.4?!",
    },
    {
      title: "Was das Programm damit macht — gestuft, nie Autopilot",
      text: "Die Steuerung ist bewusst vorsichtig: Erst BEOBACHTEN (nur anzeigen, wie hier), dann VORSCHLAGEN, dann — nur wenn du es aktivierst — sanft STEUERN: Der Planer verschiebt dann z. B. die Schwellen-Einheit aus der teuren Phase in die günstige, immer im Rahmen, nie den Plan umwerfend. Ein Aktivierungs-Gate schützt vor Zufallsmustern (Konfidenz + replizierte Zyklen + Mindest-Effekt), und starke Tages-Symptome übersteuern jede Kalender-Phase: Gesundheit zuerst.",
      cam: [0.6, 2.4, 5.6], look: [0, 0.6, 0],
      isabel: { kind: "walk", to: [0, 0, 1.6], then: "Interact", faceTo: [0, 0.8, -0.3] },
    },
    {
      title: "Und was machst DU damit?",
      text: "Der Aufwand ist klein: Periodenstart loggen (ein Datum je Zyklus) und bei Bedarf Tages-Symptome — den Rest rechnet die App über deine Session-Feedbacks. Nach ein paar Zyklen entsteht DEINE Landkarte, die anders aussehen wird als meine. Nutze sie fürs Legen der Qualitätstage — und wenn kein Muster kommt, ist auch das eine ehrliche, wertvolle Antwort: Dann bist du phasen-robust. Zu finden auf der Methodik-Seite im Zyklus-Tab (nach Einwilligung im Profil).",
      cam: [0, 3.0, 6.6], look: [0, 0.5, 0],
      isabel: { kind: "walk", to: [3.2, 0, 1.6], then: "Wave", faceTo: [3.2, 0, 7] },
    },
  ];

  return {
    id: "cycle",
    beats,
    hotspots: [
      { pos: [xOf(1), hOf(1.4) + 0.25, zOf(2)], beat: 1, label: "+1.4" },
      { pos: [xOf(4), hOf(-1.4) + 0.25, zOf(2)], beat: 2, label: "−1.4" },
    ],
    build(group: THREE.Group) {
      CELLS.forEach((row, p) => {
        row.forEach(([g, n], s) => {
          const h = n < 3 ? 0.1 : hOf(g);
          const tower = block([0.5, h, 0.34], [xOf(p), h / 2, zOf(s)], colorOf(g, n), { name: `cell:${p}:${s}`, emissive: n >= 3, opacity: n < 3 ? 0.5 : 1 });
          group.add(tower);
          if (n >= 3) group.add(spriteLabel(`${g > 0 ? "+" : ""}${g}`, [xOf(p), h + 0.18, zOf(s)], { size: 0.11, color: g > 0.2 ? "#4ade80" : g < -0.2 ? "#f87171" : "#94a3b8" }));
        });
        // K3 (image-41): Phasen-Labels höher + weiter vorn — dank depthTest-Fix nie mehr im Sockel versenkt
        group.add(spriteLabel(PHASES[p], [xOf(p), 0.18, 1.2], { color: KINO.text, size: 0.115 }));
      });
      STIMULI.forEach((s, i) => group.add(spriteLabel(s, [-3.35, 0.2, zOf(i)], { color: KINO.muted, size: 0.115 })));
      group.add(spriteLabel("grün = besser als dein Reiz-Schnitt · rot = schlechter · grau = n<3", [0, 2.35, -0.9], { color: KINO.muted, size: 0.12 }));
    },
  };
}
