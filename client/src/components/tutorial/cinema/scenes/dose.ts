// Chart-Kino-Szene: Reizkanäle („Was wirkt bei dir?“ — Forest-Plot). Kuratiert wie Isabels echtes
// Chart (5 Kanäle, Bayes/IR): LT1·Marathon +0.75 als stärkster Hebel, Easy negativ (bei gleichem
// Umfang!), MCID-Band ±0.4, Null-Wand. In 3D: schwebende CI-Stäbe mit Posterior-Kugeln.
//
// v3.1.0: EIN Balkensatz statt zwei nebeneinander liegender Ebenen (die waren unübersichtlich — man sah zwei
// Bilder, statt den Unterschied zu VERSTEHEN). Stattdessen ein Umschalter „Absolut ↔ Volumen-bereinigt“:
// dieselben Balken MORPHEN animiert zwischen den beiden Wertesätzen, die Zahlen zählen mit. Die Bewegung IST
// die Lehre — man sieht, welcher Kanal beim Wechsel springt (LT1/Marathon: +0.25 → +0.75).
import * as THREE from "three";
import { KINO, block, spriteLabel, type Beat, type CinemaScene } from "../sceneKit.ts";

// Ein Kanal, zwei Sichten — EINE Wahrheitsquelle für Geometrie UND Beat-Texte.
// abs = absolut (Effekt inkl. Umfang) · adj = volumen-bereinigt (gleicher Umfang, nur der Mix).
type Row = { label: string; abs: [number, number, number]; adj: [number, number, number]; fdr: boolean };
const ROWS: Row[] = [
  { label: "Easy",            abs: [-0.30, -0.58, -0.02], adj: [-0.34, -0.62, -0.06], fdr: false },
  { label: "LT1 · Marathon",  abs: [0.25, -0.05, 0.55],   adj: [0.75, 0.42, 1.10],    fdr: true },
  { label: "LT2 · Schwelle",  abs: [-0.08, -0.30, 0.14],  adj: [-0.13, -0.36, 0.10],  fdr: true },
  { label: "VO2 / Intervall", abs: [-0.43, -0.75, -0.11], adj: [0.04, -0.28, 0.36],   fdr: true },
  { label: "Repetition",      abs: [0.20, 0.00, 0.40],    adj: [0.32, 0.08, 0.56],    fdr: true },
];
const BEST = 1;          // LT1 · Marathon — der Kanal, der beim Umschalten am deutlichsten springt
const MCID = 0.4;
const xOf = (v: number) => v * 2.2;                 // Effekt-Achse (−0.8 … +1.2)
const yOf = (row: number) => 1.75 - row * 0.32;     // eine Zeile je Kanal

// u = 0 → volumen-bereinigt (die Sicht, die den MIX plant) · u = 1 → absolut (inkl. Umfang).
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const valsAt = (r: Row, u: number): [number, number, number] =>
  [lerp(r.adj[0], r.abs[0], u), lerp(r.adj[1], r.abs[1], u), lerp(r.adj[2], r.abs[2], u)];
const colOf = (lo: number, hi: number) => (lo > 0 ? KINO.teal : hi < 0 ? KINO.danger : KINO.bars);
const colHex = (c: number) => (c === KINO.teal ? "#2dd4bf" : c === KINO.danger ? "#f87171" : "#94a3b8");
const fmt = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;

export function doseScene(): CinemaScene {
  const best = ROWS[BEST];
  // Die Wert-Labels werden beim Morph neu gezeichnet → wir halten sie (und ihre Gruppe) fest.
  let valueLabels: (THREE.Sprite | null)[] = [];
  let host: THREE.Group | null = null;

  const beats: Beat[] = [
    {
      title: "Welcher Reiz baut DEINE Fitness?",
      text: "Das ist die wichtigste Analyse der App: Meine Trainingswochen wurden in Reiz-Kanäle zerlegt (Easy, LT1/Marathon, Schwelle, VO2, Repetition), und ein Bayes-Modell schätzt, wie viel latente Fitness ein Mehr an jedem Kanal bringt. Jede Zeile ein Kanal: Kugel = wahrscheinlichster Effekt, Stab = Unsicherheit (94 %-HDI). Die weiße Wand ist die Null — was rechts von ihr schwebt, baut auf.",
      cam: [0, 2.1, 6.6], look: [0.4, 1.2, 0],
      isabel: { kind: "pose", at: [3.2, 0, 1.3], clip: "Wave", faceTo: [3.2, 0, 7] },
    },
    {
      title: `Der Wert: ${best.label} ${fmt(best.adj[0])}`,
      text: `Mein stärkster Hebel: ${best.label} mit ${fmt(best.adj[0])} latenter Fitness je +1 SD Wochen-Dosis. Entscheidend ist nicht die Kugel, sondern der STAB: Er liegt komplett rechts der Null-Wand UND ragt über das graue MCID-Band hinaus — der Effekt ist also nicht nur „wahrscheinlich positiv“, sondern auch größer als meine Messgenauigkeit. Dazu das ✓: FDR-bestätigt, kein Vielfach-Test-Zufall.`,
      cam: [1.8, 1.9, 4.2], look: [xOf(best.adj[0]), yOf(BEST), 0],
      isabel: { kind: "walk", to: [1.2, 0, 1.0], then: "Point", faceTo: [xOf(best.adj[0]), yOf(BEST), 0] },
      highlight: `row:${BEST}`,
      exclaim: "+0.75 ✓",
    },
    {
      title: "Easy negativ?! Richtig lesen, bitte",
      text: "Oben steht Easy bei −0.34 — heißt das, locker laufen schadet? NEIN. Das Modell fragt: „Was passiert, wenn du BEI GLEICHEM GESAMTUMFANG mehr Easy statt Qualität läufst?“ Antwort: Dann fehlt der Reiz. Easy bleibt das Fundament des Umfangs — aber Easy-Minuten ERSETZEN keine Qualitäts-Minuten. Solche Verwechslungen sind der häufigste Lesefehler dieser Karte.",
      cam: [-0.4, 2.0, 4.4], look: [xOf(-0.34), yOf(0), 0],
      isabel: { kind: "walk", to: [-1.3, 0, 1.0], then: "Point", faceTo: [xOf(-0.34), yOf(0), 0] },
      highlight: "row:0",
    },
    // v3.1.0: der Umschalter — DU drückst ihn, die Balken wandern. Genau der Knopf, den du in der App gleich
    // selbst findest. Der Sprung von LT1/Marathon ist die eigentliche Lehre dieser Szene.
    {
      title: "Drück den Schalter: absolut ↔ bei gleichem Umfang",
      text: "Jetzt du: Schalte unten die Sicht um und schau, welcher Balken WANDERT. „Absolut“ fragt „Was bringt MEHR von diesem Kanal — oben drauf?“ — da steckt der Gesamtumfang mit drin, denn Wochen mit viel Kanal X sind meist auch Wochen mit vielen Kilometern. „Volumen-bereinigt“ fragt „Was bringt dieser Kanal BEI GLEICHEM Umfang?“ — also der Mix, nicht die Menge. Sieh hin: LT1/Marathon springt von +0.25 auf +0.75, VO2 von −0.43 auf +0.04. Nicht die Kilometer machen mich schneller, sondern DIESE Kilometer.",
      cam: [0.6, 2.0, 5.0], look: [xOf(0.3), yOf(BEST), 0],
      isabel: { kind: "walk", to: [1.4, 0, 1.1], then: "Interact", faceTo: [xOf(0.5), yOf(BEST), 0] },
      highlight: `row:${BEST}`,
      toggle: true,
      exclaim: "+0.25 → +0.75!",
    },
    {
      title: "Welche Sicht wofür?",
      text: "Beide sind wahr, sie beantworten nur verschiedene Fragen: ABSOLUT plant dein VOLUMEN („lohnt sich mehr Training?“), VOLUMEN-BEREINIGT plant deinen MIX („welche Minuten sollen es sein?“). Der Coach nutzt die bereinigte Sicht für den Block-Schwerpunkt — denn deine Zeit ist begrenzt, die Frage lautet also fast immer: Womit fülle ich die Stunden, die ich habe?",
      cam: [-0.6, 2.2, 5.2], look: [0.2, 1.2, 0],
      isabel: { kind: "walk", to: [-1.6, 0, 1.2], then: "Point", faceTo: [0.2, 1.2, 0] },
      toggle: true,
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
      { pos: [xOf(best.adj[0]), yOf(BEST) + 0.22, 0], beat: 1, label: "stärkster Hebel" },
      { pos: [xOf(-0.34), yOf(0) + 0.22, 0], beat: 2, label: "Easy richtig lesen" },
    ],
    toggle: { label: "Sicht", off: "Volumen-bereinigt", on: "Absolut" },
    toggleNote: (on: boolean) =>
      on
        ? "Absolut: der Effekt INKLUSIVE Umfang. LT1/Marathon fällt auf +0.25, VO2 rutscht auf −0.43 — in dieser Sicht steckt drin, dass Wochen mit viel Kanal X meist auch kilometerstarke Wochen sind."
        : "Volumen-bereinigt: derselbe Kanal BEI GLEICHEM Umfang. LT1/Marathon springt auf +0.75 — nicht die Kilometer wirken, sondern diese Kilometer. Das ist die Sicht, mit der der Coach deinen Mix plant.",

    build(group: THREE.Group) {
      host = group;
      // Null-Wand + MCID-Band (grau, ±0.4) + Achse
      group.add(block([0.025, 1.9, 1.1], [0, 1.15, 0], 0xf8fafc, { opacity: 0.35, name: "wall:zero" }));
      group.add(block([xOf(MCID) * 2, 1.9, 0.02], [0, 1.15, -0.42], 0x64748b, { opacity: 0.14 }));
      group.add(spriteLabel("0", [0, 0.12, 0.4], { size: 0.13 }));
      group.add(spriteLabel("MCID ±0.4", [0, 2.2, -0.4], { color: KINO.muted, size: 0.12 }));
      group.add(spriteLabel("← kostet · baut auf →", [1.15, 0.12, 0.4], { color: KINO.muted, size: 0.12 }));

      valueLabels = ROWS.map(() => null);
      ROWS.forEach((r, i) => {
        const [v, lo, hi] = r.adj;                     // Start: volumen-bereinigt (die Sicht des Coaches)
        const col = colOf(lo, hi);
        const y = yOf(i);
        // CI-Stab: Einheits-Box, per scale/position gemorpht (kein Geometrie-Neubau je Frame).
        const ci = block([1, 0.035, 0.035], [(xOf(lo) + xOf(hi)) / 2, y, 0], col, { opacity: 0.6, emissive: true });
        ci.scale.x = xOf(hi) - xOf(lo);
        ci.name = `row:${i}`;
        group.add(ci);
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 14, 14),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4 }),
        );
        dot.position.set(xOf(v), y, 0);
        dot.name = `dot:${i}`;
        group.add(dot);
        group.add(spriteLabel(r.label, [-2.4, y, 0], { size: 0.14 }));
        const lab = spriteLabel(`${fmt(v)}${r.fdr ? " ✓" : ""}`, [xOf(hi) + 0.42, y, 0], { color: colHex(col), size: 0.13 });
        valueLabels[i] = lab;
        group.add(lab);
      });
    },

    // Host-getrieben (0.8 s, ease): Balken/Kugeln wandern, Farben folgen dem Vorzeichen, Zahlen zählen mit.
    applyToggle(group: THREE.Group, u: number) {
      ROWS.forEach((r, i) => {
        const [v, lo, hi] = valsAt(r, u);
        const col = colOf(lo, hi);
        const ci = group.getObjectByName(`row:${i}`) as THREE.Mesh | undefined;
        if (ci) {
          ci.position.x = (xOf(lo) + xOf(hi)) / 2;
          ci.scale.x = Math.max(0.001, xOf(hi) - xOf(lo));
          const m = ci.material as THREE.MeshStandardMaterial;
          m.color.setHex(col); m.emissive.setHex(col);
        }
        const dot = group.getObjectByName(`dot:${i}`) as THREE.Mesh | undefined;
        if (dot) {
          dot.position.x = xOf(v);
          const m = dot.material as THREE.MeshStandardMaterial;
          m.color.setHex(col); m.emissive.setHex(col);
        }
        // Zahl zählt mit: Sprite neu zeichnen (5 Labels je Frame — günstig genug, kein Ruckeln).
        const old = valueLabels[i];
        if (old && host) {
          const next = spriteLabel(`${fmt(v)}${r.fdr ? " ✓" : ""}`, [xOf(hi) + 0.42, yOf(i), 0], { color: colHex(col), size: 0.13 });
          host.add(next);
          host.remove(old);
          (old.material as THREE.SpriteMaterial).map?.dispose();
          (old.material as THREE.SpriteMaterial).dispose();
          valueLabels[i] = next;
        }
      });
    },
  };
}
