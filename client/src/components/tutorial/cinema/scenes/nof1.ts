// Chart-Kino-Szene: das randomisierte N-of-1-Experiment — der EINZIGE Pfad in dieser App, der von „beobachtet"
// zu „kausal geprüft" führt. Drei Akte: (1) der Zufall verteilt die Blöcke, (2) die latente Fitness antwortet,
// (3) die Nullverteilung entscheidet, ob das Ergebnis mehr ist als Glück.
//
// EINE Wahrheitsquelle: Alle Zahlen unten stammen aus Isabels ECHT ausgewertetem Trial im Demo-Profil
// (`server/tutorial.ts` seedet ihn, die reale Engine wertet ihn aus) — 6 Paare, θ = 0,51, p = 0,031,
// MCID 0,32 (an ihre eigene Messgenauigkeit verankert). Die Nullverteilung im dritten Akt wird hier NICHT
// hingemalt, sondern aus denselben sechs Paar-Differenzen GERECHNET (alle 2⁶ = 64 Vorzeichen-Anordnungen) —
// die Szene kann also gar nichts anderes zeigen als das, was die Engine auch rechnet.
import * as THREE from "three";
import { KINO, block, ribbon, spriteLabel, type Beat, type CinemaScene, type Vec3 } from "../sceneKit.ts";

// Isabels 6 Paare in Randomisierungs-Reihenfolge. `first` = der Arm, den der Zufall im Paar VORNE zog.
// outcome = latente-Fitness-Antwort des Blocks (Engine-Wert), diff = Schwelle − VO2 (das Paar-Ergebnis).
type Pair = { first: "T" | "V"; t: number; v: number };
const PAIRS: Pair[] = [
  { first: "T", t: 0.634, v: 0.270 },
  { first: "T", t: 0.203, v: -0.085 },
  { first: "T", t: 0.024, v: -0.436 },
  { first: "V", t: 0.228, v: -0.335 },
  { first: "V", t: 1.165, v: 0.482 },
  { first: "T", t: 0.901, v: 0.186 },
];
const DIFFS = PAIRS.map((p) => p.t - p.v);                       // +0.36 … +0.72 — alle sechs positiv
const THETA = DIFFS.reduce((a, b) => a + b, 0) / DIFFS.length;   // 0.512 (= Engine-θ)
const MCID = 0.32;                                               // an Isabels eigene Messgenauigkeit verankert
const P_EXACT = 2 / 2 ** PAIRS.length;                           // 0.03125 — kleinstmöglich bei 6 Paaren

/** Alle 2⁶ Vorzeichen-Anordnungen → die Nullverteilung („wenn der Arm egal wäre"). Echte Rechnung, kein Bild. */
function nullDistribution(): number[] {
  const out: number[] = [];
  for (let mask = 0; mask < 2 ** DIFFS.length; mask++) {
    let sum = 0;
    DIFFS.forEach((d, i) => { sum += (mask >> i) & 1 ? -d : d; });
    out.push(sum / DIFFS.length);
  }
  return out;
}
const NULLS = nullDistribution();
const EXTREME = NULLS.filter((v) => Math.abs(v) >= THETA - 1e-9).length;   // 2 von 64

const fmt2 = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;

// --- Zwei Bühnen: Akt 1+2 auf der Zeitachse (z ≈ 0), Akt 3 als Nullverteilung WEIT dahinter (z = Z_HIST).
// Der Abstand ist Absicht: Solange es um die Messung geht, soll der Beweis-Wald nicht ins Bild drängen —
// man dreht sich in Akt 3 bewusst zur zweiten Bühne um. ---
const BLOCK_W = 0.42, GAP = 0.2;                       // Block + Washout-Lücke
const xBlock = (i: number) => -3.0 + i * (BLOCK_W + GAP);   // i = 0..11 (12 Blöcke)
const yArrow = (v: number) => v * 1.05;                // Paar-Differenz → Pfeilhöhe (gemeinsame Skala mit MCID)
const ARROW_BASE = 0.62, ARROW_Z = 0.55;
const Z_HIST = -8.0;
const COL_T = KINO.teal, COL_V = KINO.warn;

/** Reihenfolge der 12 Blöcke, wie der Zufall sie zog. */
const BLOCKS: { pair: number; arm: "T" | "V"; out: number }[] = PAIRS.flatMap((p, i) =>
  (p.first === "T" ? (["T", "V"] as const) : (["V", "T"] as const)).map((arm) => ({
    pair: i, arm, out: arm === "T" ? p.t : p.v,
  })));

export function nof1Scene(): CinemaScene {
  const beats: Beat[] = [
    {
      title: "Der einzige echte Beweis",
      text: "Alle anderen Karten der App BEOBACHTEN — sie finden Muster in dem, was ich ohnehin getan habe. Das hier ist anders: ein randomisiertes Experiment an einer einzigen Person, an mir. Die Frage war konkret: Bringt mir ein Schwellen-Block mehr latente Fitness als ein VO2max-Block? Nicht „bringt es Läufern allgemein“ — sondern: bringt es MIR. Genau dafür ist N-of-1 gemacht.",
      cam: [0, 2.4, 7.4], look: [0, 1.3, 0],
      isabel: { kind: "pose", at: [3.4, 0, 1.6], clip: "Wave", faceTo: [3.4, 0, 7] },
    },
    {
      title: "Akt 1 — der Zufall verteilt",
      text: "Sechs Paare, in jedem Paar EIN Schwellen-Block und EIN VO2-Block, je vier Wochen. Wer im Paar zuerst dran ist, entscheidet der Zufall — hier: T·V, T·V, T·V, V·T, V·T, T·V. Warum das der Kern von allem ist: Meine Form steigt über das Jahr ohnehin. Läge Schwelle immer hinten, würde ich diesen Trend messen und für Wirkung halten. Der Münzwurf mischt die Reihenfolge — und macht Trend, Jahreszeit und Motivation zu Rauschen statt zu Erklärung.",
      cam: [-1.8, 2.4, 6.2], look: [-1.4, 0.9, 0],
      isabel: { kind: "walk", to: [-2.6, 0, 1.6], then: "Point", faceTo: [-2.2, 1.0, 0] },
      highlight: "blk:0",
      exclaim: "Zufall entscheidet!",
    },
    {
      title: "Warum vier Wochen und eine Woche Pause?",
      text: "Ein Reiz braucht Zeit, bis er Fitness WIRD — deshalb vier Wochen je Block, ein echter Mesozyklus, kein Wochen-Experiment. Danach eine Woche Washout: Die Nachwirkung des einen Arms soll nicht in die Messung des nächsten laufen. Und gemessen wird mit einer Woche Verzögerung (Lag), weil die latente Fitness der Belastung hinterherhinkt. Das sind die Lücken, die du zwischen den Blöcken siehst.",
      cam: [-0.6, 2.0, 5.0], look: [-0.6, 0.7, 0],
      isabel: { kind: "walk", to: [-1.0, 0, 1.4], then: "Point", faceTo: [-0.6, 0.8, 0] },
      highlight: "wash:1",
    },
    {
      title: "Akt 2 — die Antwort",
      text: "Und jetzt die Messung: Über jedem Block steht, wie stark meine latente Fitness in diesem Block gestiegen ist (die Kurve darüber ist mein Fitness-Niveau, nicht die Tagesform). Schau auf die Farben: In den Schwellen-Blöcken (türkis) klettert sie steiler als in den VO2-Blöcken (orange). Wichtig: Nicht jeder einzelne Block ist schön — Paar 3 liegt insgesamt tief, Paar 5 hoch. Absolute Höhen schwanken. Das macht nichts, denn verglichen wird nur INNERHALB eines Paares.",
      cam: [0.4, 3.0, 7.8], look: [0, 1.7, 0],
      isabel: { kind: "walk", to: [1.6, 0, 2.0], then: "Interact", faceTo: [0.4, 1.6, 0] },
      highlight: "curve",
    },
    {
      title: "Sechs Paare, sechs Differenzen",
      text: `Der eigentliche Messwert ist die DIFFERENZ je Paar: Schwellen-Block minus VO2-Block. Das sind die Pfeile: ${DIFFS.map((d) => fmt2(d)).join(" · ")}. Und jetzt das, was mir beim ersten Ansehen die Sprache verschlagen hat: ALLE SECHS zeigen nach oben. Nicht ein einziges Paar, in dem VO2 vorne lag. Genau diese Konsistenz ist das Signal — nicht der einzelne große Ausschlag.`,
      cam: [0, 2.7, 7.2], look: [0, 1.5, 0],
      isabel: { kind: "walk", to: [-3.6, 0, 1.8], then: "Point", faceTo: [0, 1.5, 0] },
      highlight: "arrow:4",
      exclaim: "6 von 6 ↑",
    },
    {
      title: `θ = ${THETA.toFixed(2)} — groß genug?`,
      text: `Der Mittelwert der sechs Differenzen ist mein Effekt: θ = ${THETA.toFixed(2)} latente Fitness zugunsten der Schwelle. Aber „positiv“ reicht nicht — die Frage ist, ob es PRAKTISCH etwas bedeutet. Dafür hat der Trial VORHER eine Schwelle festgelegt: MCID = ${MCID} — abgeleitet aus meiner eigenen Messgenauigkeit (wie stark meine latente Kurve ohnehin zittert). θ liegt darüber. Der Effekt ist also nicht nur da, er ist größer als mein Rauschen.`,
      cam: [1.2, 2.3, 6.2], look: [0.6, 1.3, 0],
      isabel: { kind: "walk", to: [3.4, 0, 1.8], then: "Point", faceTo: [1.4, 1.2, 0] },
      highlight: "theta-line",
    },
    {
      title: "Akt 3 — und wenn es Zufall war?",
      text: `Der ehrlichste Test, den es gibt: Nehmen wir an, der Arm wäre völlig egal gewesen. Dann hätte jede Differenz genauso gut ihr Vorzeichen tauschen können — die Münze hätte ja anders fallen können. Also spielen wir ALLE ${NULLS.length} möglichen Anordnungen durch (2⁶ = 64 Vorzeichen-Kombinationen). Das ist der Säulenwald hinter mir: die Welt, in der meine Trainingswahl nichts bewirkt.`,
      cam: [-0.2, 3.0, -0.8], look: [0.1, 1.0, Z_HIST],
      isabel: { kind: "walk", to: [-2.6, 0, -6.4], then: "Interact", faceTo: [0, 1.2, Z_HIST] },
      highlight: "hist",
    },
    {
      title: `p = ${P_EXACT.toFixed(3)} — das Urteil`,
      text: `Jetzt vergleiche: Mein θ (der rote Marker) liegt ganz außen am Rand dieses Waldes. Nur ${EXTREME} der ${NULLS.length} Zufalls-Anordnungen sind so extrem wie mein Ergebnis — das sind ${(P_EXACT * 100).toFixed(1)} %. Das ist der p-Wert: ${P_EXACT.toFixed(3)}. Ehrlich dazugesagt: Bei sechs Paaren ist ${P_EXACT.toFixed(3)} der KLEINSTE Wert, der überhaupt herauskommen kann — mehr Sicherheit gäbe es nur mit mehr Paaren. Verdikt der App: „geprüft“ — kausal, nicht nur beobachtet.`,
      cam: [1.4, 2.6, -1.6], look: [0.9, 0.9, Z_HIST],
      isabel: { kind: "walk", to: [2.6, 0, -6.4], then: "Point", faceTo: [1.8, 1.0, Z_HIST] },
      highlight: "theta",
      exclaim: "p = 0,031",
    },
    {
      title: "Was das Programm damit macht",
      text: "Ein „geprüft“ wiegt in dieser App schwerer als jede Beobachtung: Der Coach zieht Schwelle als Block-Schwerpunkt mit VOLLEM Gewicht (statt nur sanft), das Verdikt „Was hilft dir?“ trägt das Etikett „kausal geprüft“, und die Forest-Karte tritt in den Hintergrund — sie hat ihre Aufgabe erfüllt, sie hat die Hypothese geliefert. Nur der Gesundheits-Cap steht weiterhin über allem: Kein Beweis der Welt sticht ein Verletzungs-Signal.",
      cam: [0.6, 2.4, 6.4], look: [0.2, 1.3, 0],
      isabel: { kind: "walk", to: [0.8, 0, 1.8], then: "Interact", faceTo: [0.6, 1.4, 0] },
    },
    {
      title: "Und was machst DU damit?",
      text: "Vier Regeln, die diesen Beweis überhaupt erst zu einem machen: (1) Frage VORHER festlegen — Arme, Blocklänge, MCID; nachträglich „passend“ auswerten ist kein Experiment, sondern eine Erzählung. (2) Immer nur EIN Experiment gleichzeitig, sonst weißt du nicht, was gewirkt hat. (3) Blöcke durchziehen, auch wenn ein Arm sich zäh anfühlt — genau da entsteht die Antwort. (4) Kein Ergebnis ist auch ein Ergebnis: Dann weißt du, dass es bei DIR keinen Unterschied macht — und du planst nach Vorliebe. Anlegen kannst du das unter „Methodik → Experimente“.",
      cam: [0, 2.4, 7.4], look: [0, 1.3, 0],
      isabel: { kind: "walk", to: [3.4, 0, 1.6], then: "Wave", faceTo: [3.4, 0, 7] },
    },
  ];

  return {
    id: "nof1",
    beats,
    hotspots: [
      { pos: [xBlock(0) + BLOCK_W / 2, 0.62, 0], beat: 1, label: "der Münzwurf" },
      { pos: [0, ARROW_BASE + yArrow(THETA) + 0.5, ARROW_Z], beat: 4, label: "6 von 6 Paaren" },
      { pos: [0, 2.0, Z_HIST], beat: 7, label: "Nullverteilung" },
    ],

    build(group: THREE.Group) {
      // ---- Akt 1+2: Zeitachse mit 12 Blöcken ----
      group.add(spriteLabel("6 Paare × (4 Wo. Block + 1 Wo. Washout)", [-1.6, 2.85, 0], { color: KINO.muted, size: 0.13 }));
      group.add(block([7.0, 0.02, 0.9], [0, 0.02, 0], 0x334155, { opacity: 0.5 }));  // Boden/Zeitachse

      BLOCKS.forEach((b, i) => {
        const col = b.arm === "T" ? COL_T : COL_V;
        const x = xBlock(i) + BLOCK_W / 2;
        // Der Block selbst (4 Wochen Training) — Farbe = Arm, den der Zufall gezogen hat.
        const bar = block([BLOCK_W, 0.16, 0.7], [x, 0.1, 0], col, { opacity: 0.85, emissive: true });
        bar.name = `blk:${i}`;
        group.add(bar);
        // Die gemessene Antwort als Zahl über dem Block (statt einer zweiten Säulenreihe — das Bild bleibt ruhig).
        group.add(spriteLabel(fmt2(b.out), [x, 0.34, 0], { color: b.arm === "T" ? "#2dd4bf" : "#fbbf24", size: 0.1 }));
        // Washout-Lücke sichtbar machen (die Pause IST Teil des Designs).
        if (i < BLOCKS.length - 1) {
          const wash = block([GAP * 0.6, 0.04, 0.3], [x + BLOCK_W / 2 + GAP / 2, 0.06, 0], 0x94a3b8, { opacity: 0.3 });
          wash.name = `wash:${i}`;
          group.add(wash);
        }
      });
      group.add(spriteLabel("■ Schwelle", [-3.9, 0.62, 0.55], { color: "#2dd4bf", size: 0.12 }));
      group.add(spriteLabel("■ VO2max", [-3.9, 0.38, 0.55], { color: "#f59e0b", size: 0.12 }));

      // Latente Fitness als Kurve über den Blöcken (sie AKKUMULIERT — sie oszilliert nicht).
      let acc = 0;
      const pts = BLOCKS.map((b, i) => {
        acc += b.out * 0.30;
        return new THREE.Vector3(xBlock(i) + BLOCK_W / 2, 2.05 + acc, -0.3);
      });
      group.add(ribbon([new THREE.Vector3(xBlock(0) - 0.35, 2.05, -0.3), ...pts], KINO.ctl, { name: "curve", radius: 0.032 }));
      group.add(spriteLabel("latente Fitness", [-3.75, 2.05, -0.3], { color: "#93c5fd", size: 0.12 }));

      // ---- Paar-Differenzen: ein Pfeil je Paar, VOR den Blöcken (alle sechs zeigen nach oben) ----
      PAIRS.forEach((_, p) => {
        const d = DIFFS[p];
        const x = (xBlock(p * 2) + xBlock(p * 2 + 1)) / 2 + BLOCK_W / 2;
        const h = yArrow(d);
        const shaft = block([0.05, h, 0.05], [x, ARROW_BASE + h / 2, ARROW_Z], KINO.ok, { emissive: true });
        shaft.name = `arrow:${p}`;
        group.add(shaft);
        const head = new THREE.Mesh(
          new THREE.ConeGeometry(0.09, 0.16, 12),
          new THREE.MeshStandardMaterial({ color: KINO.ok, emissive: KINO.ok, emissiveIntensity: 0.45 }),
        );
        head.position.set(x, ARROW_BASE + h + 0.08, ARROW_Z);
        group.add(head);
        group.add(spriteLabel(fmt2(d), [x, ARROW_BASE + h + 0.3, ARROW_Z], { color: "#86efac", size: 0.12 }));
      });
      group.add(spriteLabel("Differenz je Paar: Schwelle − VO2", [-3.55, ARROW_BASE - 0.3, ARROW_Z + 0.3], { color: KINO.muted, size: 0.12 }));

      // Zwei waagerechte Latten auf DERSELBEN Skala wie die Pfeile — so wird der Vergleich, auf den es ankommt,
      // wörtlich sichtbar: θ (das Mittel der sechs Pfeile) gegen MCID (die vorab festgelegte Praxisschwelle).
      // Verglichen wird θ vs. MCID — NICHT jeder einzelne Pfeil; die Latten machen genau das ablesbar.
      const mcidY = ARROW_BASE + yArrow(MCID);
      group.add(block([7.2, 0.02, 0.12], [0, mcidY, ARROW_Z], 0xf8fafc, { name: "mcid", opacity: 0.4 }));
      group.add(spriteLabel(`MCID ${MCID} — meine Messgenauigkeit`, [3.35, mcidY - 0.16, ARROW_Z], { color: KINO.muted, size: 0.11 }));
      const thetaY = ARROW_BASE + yArrow(THETA);
      group.add(block([7.2, 0.025, 0.12], [0, thetaY, ARROW_Z], KINO.danger, { name: "theta-line", opacity: 0.65, emissive: true }));
      group.add(spriteLabel(`θ = ${THETA.toFixed(2)} — Ø der sechs Pfeile`, [3.35, thetaY + 0.16, ARROW_Z], { color: "#f87171", size: 0.11 }));

      // ---- Akt 3: Nullverteilung (64 Anordnungen) als Histogramm dahinter ----
      const hist = new THREE.Group();
      hist.name = "hist";
      const BINS = 17, LO = -0.6, HI = 0.6, bw = (HI - LO) / BINS;
      const counts = new Array(BINS).fill(0);
      for (const v of NULLS) counts[Math.max(0, Math.min(BINS - 1, Math.floor((v - LO) / bw)))]++;
      const maxC = Math.max(...counts);
      counts.forEach((c, i) => {
        if (!c) return;
        const x = (LO + (i + 0.5) * bw) * 4.4;              // Effekt-Achse gedehnt (θ liegt ganz außen)
        const h = (c / maxC) * 1.5;
        const extreme = Math.abs(LO + (i + 0.5) * bw) >= THETA - bw / 2;
        group.add(block([0.24, h, 0.24], [x, h / 2 + 0.05, Z_HIST], extreme ? KINO.danger : KINO.bars,
          { opacity: extreme ? 0.9 : 0.55, emissive: extreme }));
      });
      group.add(hist);
      group.add(spriteLabel("Wenn der Arm egal wäre: alle 64 Anordnungen", [0, 2.15, Z_HIST], { color: KINO.muted, size: 0.13 }));
      group.add(spriteLabel("0", [0, -0.18, Z_HIST], { color: KINO.muted, size: 0.12 }));

      // θ-Marker: ganz außen, wo fast nichts mehr liegt.
      const tx = THETA * 4.4;
      group.add(block([0.05, 1.75, 0.05], [tx, 0.9, Z_HIST], KINO.danger, { name: "theta", emissive: true }));
      group.add(spriteLabel(`θ = ${THETA.toFixed(2)}`, [tx, 1.95, Z_HIST], { color: "#f87171", size: 0.14 }));
      group.add(spriteLabel(`nur ${EXTREME}/${NULLS.length} so extrem → p = ${P_EXACT.toFixed(3)}`, [tx + 0.1, -0.18, Z_HIST], { color: "#f87171", size: 0.12 }));
    },
  };
}

/** Für Tests/Doku: die Zahlen, mit denen die Szene rechnet (dieselben wie in Isabels Trial). */
export const NOF1_FACTS: { theta: number; p: number; mcid: number; pairs: number; extreme: number; nulls: number; diffs: number[]; cam: Vec3 } = {
  theta: THETA, p: P_EXACT, mcid: MCID, pairs: PAIRS.length, extreme: EXTREME, nulls: NULLS.length, diffs: DIFFS, cam: [0, 2.4, 7.4],
};
