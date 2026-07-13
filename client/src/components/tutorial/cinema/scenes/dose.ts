// Chart-Kino-Szene: Reizkanäle („Was wirkt bei dir?“ — Forest-Plot). Kuratiert wie Isabels echtes
// Chart (5 Kanäle, Bayes/IR): LT1·Marathon +0.75 als stärkster Hebel, Easy negativ (bei gleichem
// Umfang!), MCID-Band ±0.4, Null-Wand. In 3D: schwebende CI-Stäbe mit Posterior-Kugeln.
import * as THREE from "three";
import { KINO, block, spriteLabel, type Beat, type CinemaScene } from "../sceneKit.ts";

// [Label, Effekt, CI-low, CI-high, FDR-bestätigt] — Δ latente Fitness je +1 SD Wochen-Dosis
const ROWS: [string, number, number, number, boolean][] = [
  ["Easy", -0.34, -0.62, -0.06, false],
  ["LT1 · Marathon", 0.75, 0.42, 1.10, true],
  ["LT2 · Schwelle", -0.13, -0.36, 0.10, true],
  ["VO2 / Intervall", 0.04, -0.28, 0.36, true],
  ["Repetition", 0.32, 0.08, 0.56, true],
];
// v3.1.0: dieselben Kanäle in der ABSOLUTEN Sicht (Mediator) — hier steckt der Umfang noch mit drin.
// Zahlen aus Isabels echtem Chart (Screenshot „Absolut"): der Kontrast zur volumen-bereinigten Sicht IST die
// Lehre — LT1/Marathon sieht absolut brav aus (+0.25), erst „bei gleichem Umfang" zeigt sich der wahre Hebel.
const ABS_ROWS: [string, number, number, number][] = [
  ["Easy", -0.30, -0.58, -0.02],
  ["LT1 · Marathon", 0.25, -0.05, 0.55],
  ["LT2 · Schwelle", -0.08, -0.30, 0.14],
  ["VO2 / Intervall", -0.43, -0.75, -0.11],
  ["Repetition", 0.20, 0.00, 0.40],
];
const MCID = 0.4;
const xOf = (v: number) => v * 2.2;                 // Effekt-Achse (−0.6 … +1.2)
const yOf = (row: number) => 1.75 - row * 0.32;     // eine Zeile je Kanal
const Z_ABS = -1.1;                                 // die absolute Sicht liegt als „zweite Ebene" dahinter

const colOf = (v: number, lo: number, hi: number) =>
  lo > 0 ? KINO.teal : hi < 0 ? KINO.danger : KINO.bars;

export function doseScene(): CinemaScene {
  const best = ROWS[1];

  const beats: Beat[] = [
    {
      title: "Welcher Reiz baut DEINE Fitness?",
      text: "Das ist die wichtigste Analyse der App: Meine Trainingswochen wurden in Reiz-Kanäle zerlegt (Easy, LT1/Marathon, Schwelle, VO2, Repetition), und ein Bayes-Modell schätzt, wie viel latente Fitness ein Mehr an jedem Kanal bringt. Jede Zeile ein Kanal: Kugel = wahrscheinlichster Effekt, Stab = Unsicherheit (94 %-HDI). Die weiße Wand ist die Null — was rechts von ihr schwebt, baut auf.",
      cam: [0, 2.1, 6.6], look: [0.4, 1.2, 0],
      isabel: { kind: "pose", at: [3.2, 0, 1.3], clip: "Wave", faceTo: [3.2, 0, 7] },
    },
    {
      title: `Der Wert: ${best[0]} +${best[1]}`,
      text: `Mein stärkster Hebel: ${best[0]} mit +${best[1]} latenter Fitness je +1 SD Wochen-Dosis. Entscheidend ist nicht die Kugel, sondern der STAB: Er liegt komplett rechts der Null-Wand UND ragt über das graue MCID-Band hinaus — der Effekt ist also nicht nur „wahrscheinlich positiv“, sondern auch größer als meine Messgenauigkeit. Dazu das ✓: FDR-bestätigt, kein Vielfach-Test-Zufall.`,
      cam: [1.8, 1.9, 4.2], look: [xOf(best[1]), yOf(1), 0],
      isabel: { kind: "walk", to: [1.2, 0, 1.0], then: "Point", faceTo: [xOf(best[1]), yOf(1), 0] },
      highlight: "row:1",
      exclaim: "+0.75 ✓",
    },
    {
      title: "Easy negativ?! Richtig lesen, bitte",
      text: "Oben steht Easy bei −0.34 — heißt das, locker laufen schadet? NEIN. Das Modell fragt: „Was passiert, wenn du BEI GLEICHEM GESAMTUMFANG mehr Easy statt Qualität läufst?“ Antwort: Dann fehlt der Reiz. Easy bleibt das Fundament des Umfangs — aber Easy-Minuten ERSETZEN keine Qualitäts-Minuten. Solche Verwechslungen sind der häufigste Lesefehler dieser Karte.",
      cam: [-0.4, 2.0, 4.4], look: [xOf(-0.34), yOf(0), 0],
      isabel: { kind: "walk", to: [-1.3, 0, 1.0], then: "Point", faceTo: [xOf(-0.34), yOf(0), 0] },
      highlight: "row:0",
    },
    // v3.1.0: die zwei Sichten der Karte — genau der Umschalter, den du in der App gleich selbst drückst.
    {
      title: "Zwei Sichten: absolut …",
      text: "Schau nach hinten: Das ist dieselbe Analyse in der Sicht „Absolut“ (Effekt inkl. Umfang). Sie beantwortet: „Was bringt MEHR von diesem Kanal — oben drauf?“ Hier sieht LT1/Marathon mit +0.25 fast unauffällig aus, und VO2 rutscht mit −0.43 tief ins Minus. Der Haken: In dieser Sicht steckt der GESAMTUMFANG mit drin — Wochen mit viel Kanal X sind meist auch Wochen mit vielen Kilometern.",
      cam: [-1.2, 2.2, 3.6], look: [0.2, 1.2, Z_ABS],
      isabel: { kind: "walk", to: [-2.0, 0, -0.6], then: "Point", faceTo: [0.2, 1.2, Z_ABS] },
      highlight: "abs:1",
    },
    {
      title: "… und volumen-bereinigt",
      text: "Vorne die Sicht „Volumen-bereinigt“: Sie fragt „Was bringt dieser Kanal BEI GLEICHEM Umfang?“ — der Mix, nicht die Menge. Und jetzt springt LT1/Marathon von +0.25 auf +0.75: Nicht die Kilometer machen mich schneller, sondern DIESE Kilometer. Genau deshalb gibt es beide Sichten — absolut plant dein Volumen, volumen-bereinigt plant deinen MIX. In der App schaltest du oben in der Karte zwischen beiden um.",
      cam: [0.6, 2.0, 4.6], look: [xOf(best[1]), yOf(1), -0.4],
      isabel: { kind: "walk", to: [1.4, 0, 1.0], then: "Interact", faceTo: [xOf(best[1]), yOf(1), 0] },
      highlight: "row:1",
      exclaim: "+0.25 → +0.75!",
    },
    {
      title: "Beobachtet — nicht bewiesen",
      text: "Und jetzt der wichtigste Satz: Alles hier ist BEOBACHTET. Sauber gerechnet (Volumen kontrolliert, Block-Bootstrap, FDR), aber keine Kausalität — vielleicht habe ich in Marathon-Blöcken auch einfach besser geschlafen. Deshalb trägt jede Aussage ihr Etikett, und deshalb gibt es den einzigen Beweis-Pfad: das randomisierte N-of-1-Experiment. Beobachtung liefert die Hypothese, das Experiment das Urteil.",
      cam: [0.2, 2.2, 6.2], look: [0.4, 1.2, 0],
      isabel: { kind: "walk", to: [0.2, 0, 1.3], then: "Idle", faceTo: [0.2, 1, 7] },
    },
    {
      title: "Was das Programm damit macht",
      text: "Dieses Bild steuert echt: Der Coach nimmt den stärksten belastbaren Kanal als Block-Schwerpunkt (Modus „Auto (Evidenz)“), das Verdikt „Was hilft dir?“ macht daraus die Headline, und ist ein Signal stark aber unbewiesen, schlägt dir die App das passende Experiment vor. Die Bayes-Vertiefung schätzt sogar die Halbwertszeit je Kanal — wie lange ein Reiz trägt, bevor du nachlegen solltest.",
      cam: [1.0, 2.0, 5.6], look: [0.6, 1.2, 0],
      isabel: { kind: "walk", to: [0.8, 0, 1.2], then: "Interact", faceTo: [1.0, 1.3, 0] },
      highlight: "row:4",
    },
    {
      title: "Und was machst DU damit?",
      text: "Drei Regeln: (1) Nur auf Kanäle bauen, deren Stab die Null-Wand UND das MCID-Band hinter sich lässt — alles andere ist noch Rauschen. (2) Den besten Kanal in den nächsten Block einbauen, nicht das ganze Training umwerfen. (3) Bei „kein klares Ergebnis“ nichts erzwingen: weiter füttern oder gezielt experimentieren. Die Karte wohnt auf der Methodik-Seite unter „Was wirkt?“.",
      cam: [0, 2.1, 6.6], look: [0.4, 1.2, 0],
      isabel: { kind: "walk", to: [3.2, 0, 1.3], then: "Wave", faceTo: [3.2, 0, 7] },
    },
  ];

  return {
    id: "dose",
    beats,
    hotspots: [
      { pos: [xOf(best[1]), yOf(1) + 0.22, 0], beat: 1, label: "stärkster Hebel" },
      { pos: [xOf(-0.34), yOf(0) + 0.22, 0], beat: 2, label: "Easy richtig lesen" },
    ],
    build(group: THREE.Group) {
      // Null-Wand + MCID-Band (grau, ±0.4) + Achse
      group.add(block([0.025, 1.9, 1.1], [0, 1.15, 0], 0xf8fafc, { opacity: 0.35, name: "wall:zero" }));
      group.add(block([xOf(MCID) * 2, 1.9, 0.02], [0, 1.15, -0.42], 0x64748b, { opacity: 0.14 }));
      group.add(spriteLabel("0", [0, 0.12, 0.4], { size: 0.13 }));
      group.add(spriteLabel("MCID ±0.4", [0, 2.2, -0.4], { color: KINO.muted, size: 0.12 }));
      group.add(spriteLabel("← kostet · baut auf →", [1.15, 0.12, 0.4], { color: KINO.muted, size: 0.12 }));
      ROWS.forEach(([label, v, lo, hi, fdr], r) => {
        const col = colOf(v, lo, hi);
        const y = yOf(r);
        const ci = block([xOf(hi) - xOf(lo), 0.035, 0.035], [(xOf(lo) + xOf(hi)) / 2, y, 0], col, { opacity: 0.6, emissive: true });
        ci.name = `row:${r}`;
        group.add(ci);
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 14, 14),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4 }),
        );
        dot.position.set(xOf(v), y, 0);
        group.add(dot);
        group.add(spriteLabel(label, [-2.4, y, 0], { size: 0.14 }));
        group.add(spriteLabel(`${v > 0 ? "+" : ""}${v}${fdr ? " ✓" : ""}`, [xOf(hi) + 0.42, y, 0], { color: col === KINO.bars ? "#94a3b8" : col === KINO.teal ? "#2dd4bf" : "#f87171", size: 0.13 }));
      });

      // v3.1.0: die ABSOLUTE Sicht als zweite, gedämpfte Ebene dahinter — der direkte Vergleich ist die Lehre.
      group.add(spriteLabel("Sicht: Absolut (Effekt inkl. Umfang)", [0, 2.2, Z_ABS], { color: KINO.muted, size: 0.12 }));
      group.add(spriteLabel("Sicht: Volumen-bereinigt (gleicher Umfang)", [0, 2.45, 0], { color: KINO.muted, size: 0.12 }));
      group.add(block([0.025, 1.9, 1.1], [0, 1.15, Z_ABS], 0xf8fafc, { opacity: 0.16 }));
      ABS_ROWS.forEach(([, v, lo, hi], r) => {
        const col = colOf(v, lo, hi);
        const y = yOf(r);
        const ci = block([xOf(hi) - xOf(lo), 0.03, 0.03], [(xOf(lo) + xOf(hi)) / 2, y, Z_ABS], col, { opacity: 0.28, emissive: true });
        ci.name = `abs:${r}`;
        group.add(ci);
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.055, 12, 12),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.2, transparent: true, opacity: 0.45 }),
        );
        dot.position.set(xOf(v), y, Z_ABS);
        group.add(dot);
        group.add(spriteLabel(`${v > 0 ? "+" : ""}${v}`, [xOf(hi) + 0.36, y, Z_ABS], { color: "#94a3b8", size: 0.11 }));
      });
    },
  };
}
