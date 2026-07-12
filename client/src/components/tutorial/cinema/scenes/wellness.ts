// Chart-Kino-Szene: Wellness-Daten (Morgen-Signale). Kuratiert wie Isabels echte Kacheln: HRV, Ruhepuls
// und Schlaf über 30 Tage, jede Spur mit ihrem persönlichen Normalband — und am Ende brechen alle drei
// gleichzeitig aus (HRV 52 ↓ · Ruhepuls 49 ↑ · Schlaf 6.3 ↓). Lehrpunkt: das MUSTER zählt, nicht der Tag.
import * as THREE from "three";
import { KINO, block, ribbon, spriteLabel, type Beat, type CinemaScene } from "../sceneKit.ts";

const N = 30; // Tage
const x = (i: number) => -3.0 + (6.0 * i) / (N - 1);
// Spur-Definition: Werte-Generator, Normalband, Lane-z, Farbe, y-Mapping
const wob = (i: number, a: number, f: number) => a * Math.sin(i * f) * Math.cos(i * 0.9);

type Lane = { key: string; label: string; color: number; z: number; lo: number; hi: number; map: (v: number) => number; val: (i: number) => number; last: string; dir: string };
const LANES: Lane[] = [
  {
    key: "hrv", label: "HRV", color: 0x60a5fa, z: 0.7, lo: 57.2, hi: 65.5,
    map: (v) => (v - 46) * 0.075,
    val: (i) => (i >= N - 3 ? 61 - (i - (N - 4)) * 3.1 : 61.5 + wob(i, 2.2, 1.7)),
    last: "52", dir: "↓ niedrig",
  },
  {
    key: "rhr", label: "Ruhepuls", color: 0xec4899, z: 0, lo: 43.7, hi: 47.8,
    map: (v) => (v - 36) * 0.115,
    val: (i) => (i >= N - 3 ? 45.5 + (i - (N - 4)) * 1.3 : 45.3 + wob(i, 1.1, 2.1)),
    last: "49", dir: "↑ hoch",
  },
  {
    key: "sleep", label: "Schlaf", color: 0x8b5cf6, z: -0.7, lo: 6.7, hi: 7.7,
    map: (v) => (v - 5.4) * 0.62,
    val: (i) => (i >= N - 3 ? 7.2 - (i - (N - 4)) * 0.32 : 7.25 + wob(i, 0.32, 1.3)),
    last: "6.3 h", dir: "↓ kurz",
  },
];

export function wellnessScene(): CinemaScene {
  const beats: Beat[] = [
    {
      title: "Dein Frühwarnsystem: drei Morgen-Signale",
      text: "Drei Spuren, jeden Morgen 30 Sekunden: HRV (blau), Ruhepuls (pink), Schlaf (violett). Die transparenten Bänder sind das Entscheidende — sie zeigen DEINEN persönlichen Normalbereich, gelernt aus deinen eigenen Wochen. Absolutwerte vergleichen sich nicht zwischen Menschen; ob DU in deinem Band bist, schon.",
      cam: [0, 2.5, 7.2], look: [0, 1.1, 0],
      isabel: { kind: "pose", at: [3.4, 0, 1.4], clip: "Wave", faceTo: [3.4, 0, 7] },
    },
    {
      title: "Der Wert heute: dreimal außerhalb",
      text: "Schau ans rechte Ende: HRV 52 (Normal 57–65), Ruhepuls 49 (Normal 44–48), Schlaf 6.3 h (Normal 6.7–7.7). Jede Zahl für sich wäre ein Schulterzucken. Aber alle drei GLEICHZEITIG aus dem Band, in dieselbe schlechte Richtung, drei Tage in Folge — das ist keine Laune der Messung mehr, das ist eine Ansage deines Körpers.",
      cam: [3.0, 2.2, 4.2], look: [2.6, 1.2, 0],
      isabel: { kind: "walk", to: [2.2, 0, 1.5], then: "Point", faceTo: [2.9, 1.3, 0] },
      highlight: "zone:alert",
      exclaim: "3× außerhalb!",
    },
    {
      title: "Muster lesen, nicht Tage",
      text: "Die Leseregel: EIN Ausreißer = Rauschen (spät gegessen, Alkohol, aufregender Film — alles drückt die HRV). ZWEI bis DREI Tage Drift + MEHRERE Signale einig = ernst nehmen. Sieh dir den Rest des Monats an: ständiges Zappeln INNERHALB der Bänder, völlig normal. Wer jeden einzelnen Morgenwert dramatisiert, hört auf zu messen — wer Muster liest, gewinnt.",
      cam: [-0.5, 2.3, 5.8], look: [-0.5, 1.0, 0],
      isabel: { kind: "walk", to: [-1.2, 0, 1.5], then: "Point", faceTo: [-0.5, 1.1, 0] },
    },
    {
      title: "Was das Programm damit macht",
      text: "Genau dieses Muster füttert die Readiness: Sie verrechnet HRV, Ruhepuls und Schlaf zu einer geglätteten Bereitschaft. Bei einem Cluster wie hier schlägt RunLog vor, die nächste harte Einheit zu entschärfen — ein Klick, nie automatisch. Und hält das Muster wochenlang an, schlagen die Gesundheits-Signale an (Übertraining/RED-S-Hinweise). Kommt dir bekannt vor? Vor meiner Krankheitswoche im PMC sah es GENAU so aus.",
      cam: [1.2, 2.2, 5.6], look: [1.0, 1.1, 0],
      isabel: { kind: "walk", to: [0.6, 0, 1.5], then: "Interact", faceTo: [1.2, 1.2, 0] },
      highlight: "zone:alert",
    },
    {
      title: "Und was machst DU damit?",
      text: "Morgens 30 Sekunden eintragen (oder die Uhr syncen lassen) — und bei einem roten Cluster wie diesem: den harten Tag tauschen, easy laufen oder frei nehmen. Rechne ehrlich: Ein entschärfter Tag kostet dich nichts, eine verschleppte Erkältung drei Wochen. Genau diese Entscheidung hätte mir im November zwei Wochen gerettet. Die Kacheln findest du auf der Langzeit-Seite, gepflegt werden sie im Tracking.",
      cam: [0, 2.5, 7.2], look: [0, 1.1, 0],
      isabel: { kind: "walk", to: [3.3, 0, 1.4], then: "Wave", faceTo: [3.3, 0, 7] },
    },
  ];

  return {
    id: "wellness",
    beats,
    hotspots: [
      { pos: [x(N - 1), 2.15, 0], beat: 1, label: "heute" },
    ],
    build(group: THREE.Group) {
      for (const lane of LANES) {
        // Normalband als transparente Platte der Spur
        const yLo = lane.map(lane.lo), yHi = lane.map(lane.hi);
        group.add(block([6.15, yHi - yLo, 0.06], [0, (yLo + yHi) / 2, lane.z], lane.color, { opacity: 0.13 }));
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < N; i++) pts.push(new THREE.Vector3(x(i), lane.map(lane.val(i)), lane.z));
        group.add(ribbon(pts, lane.color, { name: `ribbon:${lane.key}`, radius: 0.032 }));
        group.add(spriteLabel(lane.label, [-3.35, lane.map(lane.val(0)) + 0.1, lane.z], { size: 0.14 }));
        group.add(spriteLabel(`${lane.last} ${lane.dir}`, [x(N - 1) + 0.45, lane.map(lane.val(N - 1)), lane.z], { color: "#fbbf24", size: 0.14 }));
      }
      // Alarm-Zone: die letzten 3 Tage — dezent rot hinterlegt
      const zone = block([0.7, 2.1, 2.0], [x(N - 2), 1.05, 0], KINO.danger, { opacity: 0.1, name: "zone:alert" });
      group.add(zone);
      group.add(spriteLabel("letzte 3 Tage", [x(N - 2), 2.24, 0], { color: "#fca5a5", size: 0.12 }));
    },
  };
}
