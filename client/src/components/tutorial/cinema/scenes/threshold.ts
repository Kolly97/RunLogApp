// Chart-Kino-Szene: Schwellen-Trend. Kuratiert wie Isabels echtes Chart: Schwellen-Pace (gold) über
// 12 Monate von 4:19 auf 4:01/km (Sprünge nach Tests/Blöcken, schneller = höher gezeichnet) und
// Critical Power (violett) von 218 auf 213 W leicht fallend — die ehrliche Divergenz-Geschichte:
// zwei unabhängige Messwege, die man gegeneinander lesen muss.
import * as THREE from "three";
import { KINO, block, ribbon, spriteLabel, type Beat, type CinemaScene } from "../sceneKit.ts";

// Monats-Stützstellen (14 Punkte ≈ 13 Monate)
const PACE: number[] = [259, 258, 257, 256, 255, 254, 253, 254, 254, 253, 252, 246, 241, 241]; // s/km
const CP: number[] = [218, 218, 217, 218, 218, 218, 217, 216, 214, 214, 214, 214, 213.5, 213]; // Watt
const N = PACE.length;
const x = (i: number) => -3.0 + (6.0 * i) / (N - 1);
const yPace = (s: number) => (266 - s) * 0.075;     // schneller (weniger s/km) = höher
const yCp = (w: number) => (w - 205) * 0.135;
const fmtPace = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}/km`;

export function thresholdScene(): CinemaScene {
  const paceNow = PACE[N - 1], paceGain = PACE[0] - paceNow, cpNow = CP[N - 1];

  const beats: Beat[] = [
    {
      title: "Deine wichtigste Schwelle — im Zeitraffer",
      text: "LT2, die Laktatschwelle: ungefähr dein 1-Stunden-Renntempo, der Anker fast aller Zonen. Diese Szene zeigt ihren Verlauf über ein Jahr — zweimal gemessen: GOLD die Schwellen-Pace (aus Tests, Bestleistungen, Laktat) und VIOLETT die Critical Power (aus den Lauf-Watt). Schneller bzw. stärker = höher. Zwei unabhängige Messwege für dieselbe Fähigkeit.",
      cam: [0, 2.3, 7.2], look: [0, 1.1, 0],
      isabel: { kind: "pose", at: [3.4, 0, 1.3], clip: "Wave", faceTo: [3.4, 0, 7] },
    },
    {
      title: `Der Wert heute: ${fmtPace(paceNow)}`,
      text: `Meine Schwellen-Pace steht bei ${fmtPace(paceNow)} — ${paceGain} Sekunden pro Kilometer schneller als vor einem Jahr. Auf Halbmarathon-Distanz sind das über sechs Minuten. Und sieh dir die FORM des Fortschritts an: kein sanfter Anstieg, sondern Treppenstufen.`,
      cam: [3.0, 2.1, 4.0], look: [2.7, yPace(paceNow), 0],
      isabel: { kind: "walk", to: [2.3, 0, 1.1], then: "Point", faceTo: [2.9, yPace(paceNow), 0] },
      highlight: "ribbon:pace",
      exclaim: fmtPace(paceNow),
    },
    {
      title: "Warum Treppen statt Rampe?",
      text: "Physiologie ändert sich langsam — aber MESSEN kannst du sie nur punktuell. Jede Stufe ist ein Ereignis: ein Laktattest, ein Test-Wettkampf, ein abgeschlossener Block, der neue Bestleistungen liefert. Dazwischen bleibt die Linie flach, weil es schlicht keine neue Information gibt. Die große Stufe hier hinten? Mein spezifischer Block plus der Labortest danach. Flache Phasen heißen also nicht Stillstand — oft heißt sie nur: lange nicht getestet.",
      cam: [1.4, 2.0, 4.8], look: [x(11), yPace(248), 0],
      isabel: { kind: "walk", to: [x(11) - 0.5, 0, 1.1], then: "Point", faceTo: [x(11), yPace(246), 0] },
      highlight: "zone:jump",
    },
    {
      title: "Die Divergenz: Pace rauf, Watt runter?",
      text: `Jetzt der Profi-Blick: Die goldene Pace ist stark gestiegen, die violette Critical Power (${cpNow} W) leicht GEFALLEN. Widerspruch? Nicht unbedingt: CP rechnet im rollenden 90-Tage-Fenster aus harten Watt-Efforts — waren die letzten Monate arm an langen harten Intervallen, sinkt CP, obwohl die Schwelle real steigt. Aber genau solche Scheren sind dein Prüfsignal: Laufen beide Wege auseinander, schau nach, WELCHER gerade schlecht gefüttert ist — statt blind einer Zahl zu glauben.`,
      cam: [0.2, 2.0, 5.4], look: [0.6, yCp(215) , 0],
      isabel: { kind: "walk", to: [-0.2, 0, 1.2], then: "Point", faceTo: [0.6, yCp(214), -0.5] },
      highlight: "ribbon:cp",
    },
    {
      title: "Programm & du",
      text: "Was das Programm macht: An dieser Schwelle hängen deine Pace-Zonen, das TSS, jede Ziel-Pace im Wochen-Vorschlag — nach einem Test schlägt RunLog dir vor, die optimalen Zonen zu übernehmen (du bestätigst). Was DU machst: alle 6–8 Wochen einen Testreiz setzen (Laktattest, Test-Rennen oder harter Tempodauerlauf), nach jeder Stufe die Zonen aktualisieren — und Divergenzen als Frage lesen, nie als Panik. Das Chart wohnt auf der Langzeit-Seite.",
      cam: [0, 2.3, 7.2], look: [0, 1.1, 0],
      isabel: { kind: "walk", to: [3.3, 0, 1.3], then: "Wave", faceTo: [3.3, 0, 7] },
    },
  ];

  return {
    id: "threshold",
    beats,
    hotspots: [
      { pos: [x(11.5), yPace(243) + 0.4, 0], beat: 2, label: "die große Stufe" },
      { pos: [x(9), yCp(214) + 0.35, -0.5], beat: 3, label: "Divergenz" },
    ],
    build(group: THREE.Group) {
      const pace: THREE.Vector3[] = [];
      const cp: THREE.Vector3[] = [];
      for (let i = 0; i < N; i++) {
        pace.push(new THREE.Vector3(x(i), yPace(PACE[i]), 0));
        cp.push(new THREE.Vector3(x(i), yCp(CP[i]), -0.5));
      }
      group.add(ribbon(pace, KINO.tsb, { name: "ribbon:pace", radius: 0.045 }));
      group.add(ribbon(cp, 0x8b5cf6, { name: "ribbon:cp", radius: 0.035 }));
      group.add(spriteLabel(`Schwellen-Pace ${fmtPace(PACE[N - 1])}`, [x(N - 1) - 0.2, yPace(PACE[N - 1]) + 0.3, 0], { color: "#f0b429", size: 0.15 }));
      group.add(spriteLabel(`Critical Power ${CP[N - 1]} W`, [x(N - 1) - 0.3, yCp(CP[N - 1]) - 0.28, -0.5], { color: "#a78bfa", size: 0.14 }));
      // Stufen-Zone (Test/Block) markieren
      group.add(block([1.0, 2.0, 0.02], [x(11.5), 1.0, -0.85], KINO.teal, { opacity: 0.08, name: "zone:jump" }));
      group.add(spriteLabel("Block + Labortest", [x(11.5), 2.1, -0.85], { color: "#5eead4", size: 0.12 }));
      // Pace-Gitter (4:00 / 4:10 / 4:20)
      for (const s of [240, 250, 260]) {
        group.add(block([6.2, 0.008, 0.02], [0, yPace(s), 0.35], 0x334155, { opacity: 0.5 }));
        group.add(spriteLabel(fmtPace(s).replace("/km", ""), [-3.3, yPace(s), 0.35], { color: KINO.muted, size: 0.11 }));
      }
    },
  };
}
