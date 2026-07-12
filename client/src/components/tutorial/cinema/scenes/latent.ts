// Chart-Kino-Szene: Latente Fitness. Kuratierter 78-Wochen-Snapshot an Isabels Story (48.7 → 53.5
// VO2-äquivalent, wie ihr echtes Chart): glatte Kalman-Kurve mit ±SD-Hülle, darum die verrauschten
// Quell-Messungen (Labor präzise · Rennen gut · Einzel-Läufe grob). Isabel läuft die Kurve hinauf.
import * as THREE from "three";
import { KINO, block, marker, ribbon, spriteLabel, type Beat, type CinemaScene, type Vec3 } from "../sceneKit.ts";

const N = 78; // Wochen
const x = (i: number) => -3.0 + (6.0 * i) / (N - 1);
// Fitness-Verlauf: Aufbau → Plateau (Krankheits-Delle um Woche 62) → spezifischer Schub am Ende.
const f = (i: number) => {
  const u = i / (N - 1);
  let v = 48.7 + 4.4 * u + 0.55 * Math.sin(u * 5.2) * u;
  if (i > 58 && i < 66) v -= 0.35 * Math.exp(-((i - 62) ** 2) / 8); // Krankheitswoche drückt kurz
  return v;
};
const sd = (i: number) => 0.28 + 0.14 * Math.abs(Math.sin(i * 0.7)) + (i > 30 && i < 40 ? 0.18 : 0); // Messlücke → breiter
const yOf = (v: number) => (v - 47.5) * 0.42;

// Quell-Messungen: [Woche, Abweichung, Typ] — Labor (präzise) · Rennen · Einzel-Lauf (grob)
const SOURCES: [number, number, "lab" | "race" | "run"][] = [
  [4, 0.05, "lab"], [52, -0.08, "lab"],
  [14, 0.2, "race"], [40, 0.15, "race"], [70, -0.1, "race"],
  [8, -0.7, "run"], [18, 0.8, "run"], [26, -0.9, "run"], [34, 0.7, "run"], [45, -0.6, "run"],
  [56, 0.9, "run"], [63, -1.0, "run"], [72, 0.6, "run"], [76, -0.5, "run"],
];
const SRC_STYLE = { lab: { color: 0x4ade80, r: 0.075 }, race: { color: 0xf0b429, r: 0.06 }, run: { color: 0x94a3b8, r: 0.042 } };

export function latentScene(): CinemaScene {
  const now = f(N - 1), nowSd = sd(N - 1), gain = now - f(0);
  const rd = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  const pts = (yShift = 0) => Array.from({ length: N }, (_, i) => new THREE.Vector3(x(i), yOf(f(i)) + yShift, 0));

  const beats: Beat[] = [
    {
      title: "Eine Zahl für deine Fitness",
      text: "Labor-Tests, Rennen, einzelne Läufe — jede Quelle misst deine Fitness anders und alle rauschen. Diese Kurve ist RunLogs Antwort: die LATENTE Fitness, eine einzige geglättete Trajektorie aus allen Quellen (VO2-äquivalent), mit ehrlichem Unsicherheitsband. Sie ist der Boden, auf dem fast jede Analyse der App rechnet.",
      cam: [0, 2.3, 7.4], look: [0, 1.1, 0],
      isabel: { kind: "pose", at: [3.4, 0, 1.3], clip: "Wave", faceTo: [3.4, 0, 7] },
    },
    {
      title: `Der Wert heute: ${rd(now)} (±${rd(nowSd)})`,
      text: `Rechts endet die Kurve bei ${rd(now)} — mit einem schmalen Band von ±${rd(nowSd)}. Das Band ist keine Deko, es IST die Aussage: „Deine Fitness liegt sehr wahrscheinlich hier.“ Schmal = viele frische Messungen, breit = die App ist ehrlich unsicher. Eine Zahl ohne Unsicherheit wäre gelogen.`,
      cam: [3.2, 2.2, 3.6], look: [2.6, yOf(now), 0],
      isabel: { kind: "walk", to: [2.5, 0, 1.0], then: "Point", faceTo: [3.0, yOf(now), 0] },
      highlight: "marker:now",
      exclaim: `${rd(now)}!`,
    },
    {
      title: "Die Punkte drumherum: wer darf wie laut reden?",
      text: "Jeder Punkt ist eine Messung. GRÜN = Labor (präzise, darf die Kurve stark ziehen). GOLD = Rennen (VDOT — sehr gut). GRAU = einzelne Läufe (eff. VO2max — nützlich, aber verrauscht, zählen einzeln wenig). Der Kalman-Filter gewichtet genau danach — und wo länger nichts gemessen wurde, läuft der Trend weiter und das Band wird breiter. Schau dir die Delle um Woche 62 an: meine Krankheitswoche, du kennst sie aus dem PMC.",
      cam: [-0.6, 2.0, 5.6], look: [-0.4, 1.0, 0],
      isabel: { kind: "walk", to: [-1.2, 0, 1.1], then: "Point", faceTo: [-0.8, 1.2, 0] },
      highlight: "src:lab",
    },
    {
      title: `18 Monate in einem Anstieg: +${rd(gain)} Punkte`,
      text: `Ich lauf ihn dir ab: Von ${rd(f(0))} auf ${rd(now)} — plus ${rd(gain)} VO2-äquivalente Punkte in anderthalb Jahren. Kein einzelnes Wunder-Workout, sondern die Summe aus konsequenten Blöcken, Entlastung und zwei Test-Rennen. So sieht echter Fortschritt aus: unspektakulär pro Woche, gewaltig über die Zeit.`,
      cam: [0.3, 2.1, 6.8], look: [0, 1.2, 0],
      isabel: { kind: "path", dur: 7 },
      highlight: "ribbon:f",
    },
    {
      title: "Was das Programm damit macht",
      text: "Diese Kurve ist der OUTCOME aller Wirkungs-Analysen: „Was wirkt bei dir?“ misst die Reiz-Kanäle GEGEN die latente Fitness, das Regime-Bild und die Experimente auch. Und die Praxisschwelle (MCID) kommt aus dem Band: Nur Veränderungen, die größer sind als dein eigenes Messrauschen, gelten als echt. Deshalb: je sauberer diese Kurve, desto klüger die ganze App.",
      cam: [1.4, 2.0, 5.8], look: [1.2, 1.3, 0],
      isabel: { kind: "walk", to: [0.6, 0, 1.2], then: "Interact", faceTo: [1.4, 1.4, 0] },
    },
    {
      title: "Und was machst DU damit?",
      text: "Zwei Dinge: (1) Den TREND lesen, nicht den Tageswert — die Kurve ist bewusst träge, ein einzelner schlechter Lauf verschiebt sie kaum. (2) Sie regelmäßig füttern: Alle 6–8 Wochen ein Test-Rennen oder Labortest zieht das Band eng und macht jede weitere Analyse schärfer. Im echten RunLog wohnt die Karte auf der Methodik-Seite unter „Status“ — mit „neu berechnen“, wenn sie veraltet ist.",
      cam: [0, 2.4, 7.4], look: [0, 1.1, 0],
      isabel: { kind: "walk", to: [3.3, 0, 1.3], then: "Wave", faceTo: [3.3, 0, 7] },
    },
  ];

  return {
    id: "latent",
    beats,
    hotspots: [
      { pos: [x(4), yOf(f(4)) + 0.45, 0], beat: 2, label: "Labor" },
      { pos: [x(N - 1), yOf(now) + 0.5, 0], beat: 1, label: "aktuell" },
    ],
    runPath: (() => {
      const p: Vec3[] = [];
      for (let i = 0; i <= N - 1; i += 2) p.push([x(i), yOf(f(i)) + 0.02, 0]);
      return p;
    })(),
    build(group: THREE.Group) {
      group.add(ribbon(pts(), KINO.ctl, { name: "ribbon:f", radius: 0.045 }));
      // ±SD-Hülle: transparente dicke Röhre folgt der Kurve (Radius ~ Band)
      const hull = ribbon(pts(), KINO.ctl, { name: "band", radius: 0.16, opacity: 0.14 });
      group.add(hull);
      for (const [w, dv, kind] of SOURCES) {
        const st = SRC_STYLE[kind];
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(st.r, 12, 12),
          new THREE.MeshStandardMaterial({ color: st.color, emissive: st.color, emissiveIntensity: 0.4 }),
        );
        m.position.set(x(w), yOf(f(w) + dv), 0.12);
        if (kind === "lab") m.name = "src:lab";
        group.add(m);
      }
      marker(group, x(N - 1), yOf(now) + 0.4, 0xf8fafc, "marker:now");
      group.add(spriteLabel(`aktuell ${Math.round(now * 10) / 10} (±${Math.round(sd(N - 1) * 100) / 100})`, [x(N - 1) - 0.1, yOf(now) + 0.62, 0], { size: 0.15 }));
      group.add(spriteLabel("Labor", [x(4), yOf(f(4)) + 0.28, 0.1], { color: "#4ade80", size: 0.12 }));
      group.add(spriteLabel("Rennen (VDOT)", [x(14), yOf(f(14)) + 0.5, 0.1], { color: "#f0b429", size: 0.12 }));
      group.add(spriteLabel("einzelne Läufe", [x(26), yOf(f(26)) - 0.55, 0.1], { color: KINO.muted, size: 0.12 }));
      group.add(spriteLabel("krank", [x(62), yOf(f(62)) - 0.35, 0], { color: "#fca5a5", size: 0.11 }));
      // dezente y-Gitterlinien mit Skala
      for (const v of [49, 51, 53]) {
        group.add(block([6.2, 0.008, 0.02], [0, yOf(v), -0.3], 0x334155, { opacity: 0.5 }));
        group.add(spriteLabel(String(v), [-3.25, yOf(v), -0.3], { color: KINO.muted, size: 0.11 }));
      }
    },
  };
}
