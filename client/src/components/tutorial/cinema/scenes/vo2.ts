// Chart-Kino-Szene: Effective VO2max je Lauf. Kuratiert wie Isabels echtes Chart: graue, stark
// verrauschte Pro-Lauf-Schätzungen (submaximale HF↔Pace), blauer Wochen-Trend 49 → 54, grüne
// Labor-Anker. Lehrpunkt: Rauschen je Lauf ist normal — der Trend zählt, das Labor eicht.
import * as THREE from "three";
import { KINO, block, marker, ribbon, spriteLabel, type Beat, type CinemaScene } from "../sceneKit.ts";

const N = 150; // Läufe über ~12 Monate
const x = (i: number) => -3.0 + (6.0 * i) / (N - 1);
const trend = (i: number) => 49.1 + (i / (N - 1)) * 4.6;
// deterministisches Pro-Lauf-Rauschen (±~1.3), gelegentliche Ausreißer (hügelig/heiß/müde)
const noise = (i: number) => 1.1 * Math.sin(i * 2.17) * Math.cos(i * 0.53) + (i % 29 === 0 ? -1.6 : 0) + (i % 37 === 0 ? 1.3 : 0);
const yOf = (v: number) => (v - 47.5) * 0.36;
const LABS: [number, number][] = [[6, 49.2], [96, 52.6]];

export function vo2Scene(): CinemaScene {
  const now = Math.round(trend(N - 1) * 10) / 10;

  const beats: Beat[] = [
    {
      title: "Jeder Lauf misst deine VO2max — ein bisschen",
      text: "Für jeden gleichmäßigen Lauf schätzt RunLog aus dem Verhältnis von Herzfrequenz zu Tempo ein effektives VO2max — die graue Zackenlinie. Ein einzelner Wert ist grob, aber hunderte Läufe ergeben zusammen ein scharfes Bild: der blaue Trend. Und die grünen Punkte? Echte Labor-Messungen, auf die alles geeicht wird.",
      cam: [0, 2.2, 7.2], look: [0, 1.0, 0],
      isabel: { kind: "pose", at: [3.4, 0, 1.3], clip: "Wave", faceTo: [3.4, 0, 7] },
    },
    {
      title: `Der Wert heute: ${now}`,
      text: `Der Trend steht bei ${now} — von 49 auf fast 54 in einem Jahr. Wichtig: Diese Zahl kommt aus SUBMAXIMALEN Läufen. Du musst dich nie ausbelasten, damit die App deine Sauerstoffaufnahme schätzen kann — dein ganz normales Training ist der Test.`,
      cam: [3.1, 2.0, 3.8], look: [2.7, yOf(now), 0],
      isabel: { kind: "walk", to: [2.4, 0, 1.0], then: "Point", faceTo: [3.0, yOf(now), 0] },
      highlight: "marker:now",
      exclaim: `${now}!`,
    },
    {
      title: "Das Zacken-Rauschen richtig lesen",
      text: "Warum zappelt die graue Linie so? Hitze, Hügel, Müdigkeit, Koffein — alles verschiebt den Puls bei gleichem Tempo. ±1 bis 2 Punkte je Lauf sind völlig normal und KEINE Formschwankung. Fehler, den fast alle machen: einen einzelnen Ausreißer ernst nehmen. Regel: Ein Punkt ist Wetter, zehn Punkte sind ein Trend.",
      cam: [-0.8, 1.9, 5.4], look: [-0.6, 0.9, 0],
      isabel: { kind: "walk", to: [-1.4, 0, 1.1], then: "Point", faceTo: [-0.8, 1.0, 0] },
      highlight: "ribbon:raw",
    },
    {
      title: "Was das Programm damit macht",
      text: "Diese Pro-Lauf-Schätzungen sind eine der drei Quellen der latenten Fitness — die grobe, aber fleißigste (jeder Lauf zählt ein wenig). Die grünen Labor-Anker ziehen die Skala gerade, damit „53“ auch wirklich 53 bedeutet. Dazu ordnet RunLog den Wert alters- und geschlechtsbereinigt ein (ACSM-Normen) — deshalb wollte ich in Abschnitt 1 dein Geburtsjahr wissen.",
      cam: [0.8, 2.0, 5.8], look: [0.6, 1.1, 0],
      isabel: { kind: "walk", to: [0.2, 0, 1.2], then: "Interact", faceTo: [0.8, 1.2, 0] },
      highlight: "src:lab",
    },
    {
      title: "Und was machst DU damit?",
      text: "Fast nichts — das ist das Schöne. Lauf einfach; besonders wertvoll sind gleichmäßige, ruhige Dauerläufe (saubere HF↔Pace-Beziehung). Wenn du magst: ab und zu ein Labortest oder Wettkampf als Anker. Und wenn die Zacken mal eine Woche nach unten zeigen, atme durch — erst der Trend über Wochen ist eine Nachricht. Du findest das Chart auf der Langzeit-Seite.",
      cam: [0, 2.3, 7.2], look: [0, 1.0, 0],
      isabel: { kind: "walk", to: [3.3, 0, 1.3], then: "Wave", faceTo: [3.3, 0, 7] },
    },
  ];

  return {
    id: "vo2",
    beats,
    hotspots: [
      { pos: [x(LABS[1][0]), yOf(LABS[1][1]) + 0.35, 0.1], beat: 3, label: "Labor" },
      { pos: [x(N - 1), yOf(now) + 0.5, 0], beat: 1, label: "aktuell" },
    ],
    build(group: THREE.Group) {
      const raw: THREE.Vector3[] = [];
      for (let i = 0; i < N; i += 1) raw.push(new THREE.Vector3(x(i), yOf(trend(i) + noise(i)), -0.15));
      group.add(ribbon(raw, 0x94a3b8, { name: "ribbon:raw", radius: 0.016, opacity: 0.55 }));
      const tr: THREE.Vector3[] = [];
      for (let i = 0; i < N; i += 3) tr.push(new THREE.Vector3(x(i), yOf(trend(i)), 0));
      group.add(ribbon(tr, KINO.ctl, { name: "ribbon:trend", radius: 0.045 }));
      for (const [i, v] of LABS) {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 12, 12),
          new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x4ade80, emissiveIntensity: 0.45 }),
        );
        m.position.set(x(i), yOf(v), 0.12);
        m.name = "src:lab";
        group.add(m);
        group.add(spriteLabel(`Labor ${v}`, [x(i), yOf(v) + 0.26, 0.12], { color: "#4ade80", size: 0.12 }));
      }
      marker(group, x(N - 1), yOf(now) + 0.35, 0xf8fafc, "marker:now");
      group.add(spriteLabel(`aktuell ${now}`, [x(N - 1) - 0.15, yOf(now) + 0.58, 0], { size: 0.15 }));
      for (const v of [49, 51, 53]) {
        group.add(block([6.2, 0.008, 0.02], [0, yOf(v), -0.35], 0x334155, { opacity: 0.5 }));
        group.add(spriteLabel(String(v), [-3.25, yOf(v), -0.35], { color: KINO.muted, size: 0.11 }));
      }
    },
  };
}
