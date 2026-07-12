// Chart-Kino-Szene: Lauf-Power (Critical Power + W′). Kuratiert wie Isabels echtes Chart: Power-Duration-
// Kurve (beste Watt je Dauer, 90 Tage) mit CP-213-W-Asymptote, die W′-Batterie (9.7 kJ) als leuchtende
// Fläche über der Asymptote — und daneben der W′-bal-Sägezahn ihrer VO2-Intervall-Einheit (tiefster
// Stand 6 %). Lehrpunkt: CP = nachhaltige Leistung, W′ = begrenzter Vorrat darüber.
import * as THREE from "three";
import { KINO, block, ribbon, spriteLabel, type Beat, type CinemaScene } from "../sceneKit.ts";

const CP = 213, WPRIME = 9.7; // Watt · kJ
// Power-Duration: P(t) = CP + W'/t (t in s) — Stützpunkte 5'…60' wie im echten Chart
const DUR = [300, 600, 1200, 1800, 3600];
const P = (t: number) => CP + (WPRIME * 1000) / t;
const xPd = (k: number) => -3.0 + k * 1.05;                 // log-artige Platzierung der 5 Stützstellen
const yW = (w: number) => (w - 200) * 0.042;                // Watt-Achse

// W′-bal (rechte Bühne): 6×3' VO2-Intervalle, Erholung lädt nur teilweise nach
const WB: [number, number][] = [
  [0, 100], [1, 62], [1.4, 78], [2.4, 46], [2.8, 60], [3.8, 32], [4.2, 46], [5.2, 22], [5.6, 34], [6.6, 12], [7, 24], [8, 6], [8.6, 30],
];
const xWb = (u: number) => 0.6 + u * 0.31;                  // 0..8.6 → 0.6..3.3
const yWb = (pct: number) => 0.15 + pct * 0.016;

export function powerScene(): CinemaScene {
  const beats: Beat[] = [
    {
      title: "Watt beim Laufen — zwei Zahlen, ein Motor",
      text: "Links meine Power-Duration-Kurve: die besten Watt je Dauer aus 90 Tagen. Je länger, desto flacher — und die türkise Linie, der sie sich nähert, ist die CRITICAL POWER (213 W): die Leistung, die mein aerober Motor quasi dauerhaft halten kann. Alles darüber bezahle ich aus einem begrenzten Vorrat: W′, meine anaerobe Batterie — die goldene Fläche, 9.7 kJ groß.",
      cam: [-0.6, 2.2, 6.8], look: [-0.8, 1.0, 0],
      isabel: { kind: "pose", at: [-3.2, 0, 1.4], clip: "Wave", faceTo: [-3.2, 0, 7] },
    },
    {
      title: "Der Wert: CP 213 W · W′ 9.7 kJ",
      text: "So liest du das Paar: CP ist dein Diesel — Tempo-Dauerläufe, Schwelle, Marathon leben davon. W′ ist dein Turbo — Antritte, Berganstiege, die letzten 400 m. 9.7 kJ klingen abstrakt, heißen aber konkret: etwa 40 Sekunden mit 240 W über CP, dann ist der Tank leer. Zwei Läuferinnen mit gleicher CP können sich im Rennen völlig unterscheiden, wenn ihre Batterien verschieden groß sind.",
      cam: [-1.6, 1.9, 4.4], look: [-1.8, yW(CP) + 0.35, 0],
      isabel: { kind: "walk", to: [-1.0, 0, 1.2], then: "Point", faceTo: [-1.8, yW(CP) + 0.3, 0] },
      highlight: "line:cp",
      exclaim: "213 W",
    },
    {
      title: "Rechts: die Batterie im Live-Einsatz",
      text: "Das ist W′-bal — meine Batterie-Anzeige WÄHREND einer VO2-Intervall-Einheit (6 × 3 min). Jedes Intervall entlädt (Linie fällt), jede Trabpause lädt teilweise nach (Linie steigt — aber nie ganz zurück). Tiefster Stand: 6 %. Übersetzt: Die Einheit war exakt richtig dosiert — hart genug, um alles abzurufen, ohne dass das letzte Intervall zusammenbricht.",
      cam: [1.9, 1.9, 4.6], look: [1.9, 0.9, -0.2],
      isabel: { kind: "walk", to: [1.2, 0, 1.2], then: "Point", faceTo: [2.0, 0.6, -0.2] },
      highlight: "ribbon:wbal",
      exclaim: "tiefster Stand: 6 %",
    },
    {
      title: "Was das Programm damit macht",
      text: "CP ist der dritte Zonen-Anker (neben Pace und Herzfrequenz) und läuft als eigener Trend mit — du hast ihn im Schwellen-Trend schon violett gesehen. W′ fließt ins Intervall-Design und die Renn-Taktik: Wie viele Antritte verträgt dein Rennen, wie lang dürfen Pausen sein? Wichtig bei Lauf-Watt: Die Uhrenwerte sind RELATIV kalibriert — Trends und Verhältnisse sind belastbar, der Absolutwert je nach Gerät weniger.",
      cam: [0.2, 2.1, 6.0], look: [0, 1.0, 0],
      isabel: { kind: "walk", to: [-0.2, 0, 1.3], then: "Interact", faceTo: [0, 1.1, 0] },
    },
    {
      title: "Und was machst DU damit?",
      text: "Zwei Anwendungen: (1) Pacing — in Rennen und harten Einheiten nicht dauerhaft über CP gehen, außer du willst die Batterie gezielt leeren; am Berg kurz über CP ist okay, wenn danach eine Ladephase kommt. (2) Intervall-Kontrolle — endet deine Einheit regelmäßig bei 40 % W′-bal, war sie zu weich; crasht sie auf 0, zu hart. Der Sweetspot liegt knapp über leer, genau wie hier. Zu finden auf der Bestleistungen-Seite im Power-Block.",
      cam: [0, 2.3, 7.0], look: [0, 1.0, 0],
      isabel: { kind: "walk", to: [3.2, 0, 1.4], then: "Wave", faceTo: [3.2, 0, 7] },
    },
  ];

  return {
    id: "power",
    beats,
    hotspots: [
      { pos: [xPd(0), yW(P(300)) + 0.3, 0], beat: 1, label: "5-min-Bestwert" },
      { pos: [xWb(8), yWb(6) + 0.35, -0.2], beat: 2, label: "fast leer" },
    ],
    build(group: THREE.Group) {
      // Links: Power-Duration-Kurve + CP-Asymptote + W′-Fläche
      const pd: THREE.Vector3[] = [];
      for (let k = 0; k < DUR.length; k++) pd.push(new THREE.Vector3(xPd(k), yW(P(DUR[k])), 0));
      group.add(ribbon(pd, 0x8b5cf6, { name: "ribbon:pd", radius: 0.04 }));
      DUR.forEach((t, k) => {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), new THREE.MeshStandardMaterial({ color: 0xa78bfa, emissive: 0xa78bfa, emissiveIntensity: 0.4 }));
        dot.position.set(xPd(k), yW(P(t)), 0);
        group.add(dot);
        group.add(spriteLabel(`${t / 60}’`, [xPd(k), 0.12, 0.3], { color: KINO.muted, size: 0.11 }));
      });
      const cpLine = block([4.6, 0.02, 0.3], [-0.9, yW(CP), 0], KINO.teal, { opacity: 0.8, name: "line:cp", emissive: true });
      group.add(cpLine);
      group.add(spriteLabel(`CP ${CP} W`, [-3.15, yW(CP) + 0.16, 0], { color: "#5eead4", size: 0.14 }));
      // W′ als leuchtende Keil-Fläche zwischen Kurve und CP (vereinfachte Stufen)
      for (let k = 0; k < DUR.length - 1; k++) {
        const h = yW(P(DUR[k])) - yW(CP);
        group.add(block([0.9, h, 0.12], [xPd(k) + 0.5, yW(CP) + h / 2, -0.05], KINO.tsb, { opacity: 0.16 }));
      }
      group.add(spriteLabel(`W′ 9.7 kJ (Batterie)`, [-1.4, yW(P(420)) + 0.35, 0], { color: "#f0b429", size: 0.13 }));
      // Rechts: W′-bal-Sägezahn + Nulllinie
      const wb: THREE.Vector3[] = WB.map(([u, pct]) => new THREE.Vector3(xWb(u), yWb(pct), -0.2));
      group.add(ribbon(wb, KINO.tsb, { name: "ribbon:wbal", radius: 0.035 }));
      group.add(block([2.9, 0.012, 0.25], [2.05, yWb(0), -0.2], KINO.danger, { opacity: 0.6 }));
      group.add(spriteLabel("W′-bal im Intervall (6×3’)", [2.0, yWb(100) + 0.3, -0.2], { size: 0.13 }));
      group.add(spriteLabel("leer", [3.5, yWb(0), -0.2], { color: "#f87171", size: 0.11 }));
      group.add(spriteLabel("100 %", [0.32, yWb(100), -0.2], { color: KINO.muted, size: 0.11 }));
    },
  };
}
