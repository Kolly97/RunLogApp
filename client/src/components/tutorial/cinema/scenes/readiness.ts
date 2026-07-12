// Chart-Kino-Szene: Readiness & Gesundheit. Kuratiert wie Isabels echtes Chart: geglättete latente
// Readiness (Kalman aus HRV·Ruhepuls·Schlaf) um ~50 pendelnd, der Krankheits-Einbruch im November
// (auf 26) und der AKTUELLE Absturz auf 23 — die Fortsetzung der Wellness-Story. Beschreibend, nicht
// diagnostisch; steht bewusst außerhalb der automatischen Trainings-Steuerung.
import * as THREE from "three";
import { KINO, block, marker, ribbon, spriteLabel, type Beat, type CinemaScene } from "../sceneKit.ts";

const N = 120; // Tage (~4 Monate Ausschnitt + Historie komprimiert)
const x = (i: number) => -3.0 + (6.0 * i) / (N - 1);
const val = (i: number) => {
  let v = 50 + 4.5 * Math.sin(i * 0.35) * Math.cos(i * 0.11);
  v -= 24 * Math.exp(-((i - 68) ** 2) / 14);          // Krankheits-Einbruch (November)
  if (i > N - 6) v -= (i - (N - 6)) * 5.4;            // aktueller Absturz auf ~23
  return Math.max(20, v);
};
const yOf = (v: number) => v * 0.028;

export function readinessScene(): CinemaScene {
  const now = Math.round(val(N - 1));

  const beats: Beat[] = [
    {
      title: "Readiness — die geglättete Wahrheit",
      text: "Die Morgen-Signale aus der Wellness-Szene zappeln täglich. Diese grüne Kurve ist ihre destillierte Form: eine GEGLÄTTETE latente Bereitschaft (gleiche Kalman-Technik wie bei der Fitness) aus HRV, Ruhepuls und Schlaf. Sie zeigt den Zustand deines Systems — nicht die Laune eines einzelnen Morgens. Wichtig vorweg: Sie ist beschreibend, keine Diagnose, und steuert nichts automatisch.",
      cam: [0, 2.3, 7.2], look: [0, 1.2, 0],
      isabel: { kind: "pose", at: [3.4, 0, 1.3], clip: "Wave", faceTo: [3.4, 0, 7] },
    },
    {
      title: `Der Wert heute: ${now} — Alarmstufe`,
      text: `Rechts fällt die Kurve steil auf ${now} — so tief stand sie zuletzt in meiner Krankheitswoche. Die Skala liest sich einfach: um 50 pendeln = normales Auf und Ab des Trainingslebens. Unter ~35 = das System kämpft. Und ein STEILER Abfall zählt mehr als der Absolutwert: Es geht gerade schnell bergab.`,
      cam: [3.0, 2.0, 4.0], look: [2.7, yOf(now) + 0.3, 0],
      isabel: { kind: "walk", to: [2.3, 0, 1.1], then: "Point", faceTo: [2.9, yOf(now) + 0.3, 0] },
      highlight: "marker:now",
      exclaim: `${now}?!`,
    },
    {
      title: "Der November-Einbruch — schon mal gesehen?",
      text: "Diese Delle kennst du jetzt aus drei Perspektiven: Im PMC schoss die Form scheinbar „erholt“ nach oben, in den Wellness-Kacheln brachen HRV und Schlaf aus den Bändern, und hier stürzte die Readiness auf 26 ab. DAS ist der Punkt dieser Szene: Erst mehrere Sichten zusammen erzählen die wahre Geschichte — die Readiness ist die Sicht, die Krankheit und Überlastung am frühesten zusammenfasst.",
      cam: [0.5, 2.0, 4.6], look: [x(68), yOf(26) + 0.4, 0],
      isabel: { kind: "walk", to: [x(68) + 0.5, 0, 1.1], then: "Point", faceTo: [x(68), yOf(26) + 0.3, 0] },
      highlight: "zone:sick",
    },
    {
      title: "Was das Programm damit macht",
      text: "Bewusst wenig — und das ist ein Feature: Die Readiness BERÄT. Bei schwachen Werten schlägt die Wochenplanung vor, den nächsten harten Tag zu entschärfen (du klickst, nie die App allein). Hält ein Tief an, springen die Gesundheits-Signale an (Übertraining/RED-S-Hinweise, nicht-diagnostisch) — und dann deckelt das Verdikt sogar seine eigenen Intensitäts-Empfehlungen: Priorität Erholung. Gesundheit übersteuert immer den Plan.",
      cam: [1.2, 2.1, 5.6], look: [1.2, 1.2, 0],
      isabel: { kind: "walk", to: [0.6, 0, 1.2], then: "Interact", faceTo: [1.2, 1.3, 0] },
    },
    {
      title: "Und was machst DU damit?",
      text: "Nutze sie als Ampel vor harten Tagen: Kurve stabil um 50 → Plan fahren. Steiler Abfall oder unter ~35 → Intensität raus, Ursache suchen (Schlaf? Infekt? Lebensstress?), im Zweifel ein Tag frei. Und vergiss die Richtung nicht: Die Kurve verbietet dir nichts — sie schenkt dir den Blick, den du an ehrgeizigen Tagen selbst nicht hast. Zu finden auf der Methodik-Seite unter „Status“.",
      cam: [0, 2.3, 7.2], look: [0, 1.2, 0],
      isabel: { kind: "walk", to: [3.3, 0, 1.3], then: "Wave", faceTo: [3.3, 0, 7] },
    },
  ];

  return {
    id: "readiness",
    beats,
    hotspots: [
      { pos: [x(68), yOf(26) + 0.55, 0], beat: 2, label: "November-Einbruch" },
      { pos: [x(N - 1), yOf(now) + 0.5, 0], beat: 1, label: "aktuell" },
    ],
    build(group: THREE.Group) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < N; i += 1) pts.push(new THREE.Vector3(x(i), yOf(val(i)), 0));
      group.add(ribbon(pts, KINO.ok, { name: "ribbon:ready", radius: 0.04 }));
      // Skala-Linien 25/50/75
      for (const v of [25, 50, 75]) {
        group.add(block([6.2, 0.008, 0.02], [0, yOf(v), -0.3], 0x334155, { opacity: 0.55 }));
        group.add(spriteLabel(String(v), [-3.25, yOf(v), -0.3], { color: KINO.muted, size: 0.11 }));
      }
      // Krankheits-Zone + aktueller Marker
      group.add(block([0.7, 2.2, 0.02], [x(68), 1.1, -0.5], KINO.danger, { opacity: 0.1, name: "zone:sick" }));
      group.add(spriteLabel("krank (Nov)", [x(68), 2.3, -0.5], { color: "#fca5a5", size: 0.12 }));
      marker(group, x(N - 1), yOf(now) + 0.4, 0xf87171, "marker:now");
      group.add(spriteLabel(`aktuell ${now} ↓`, [x(N - 1) - 0.2, yOf(now) + 0.62, 0], { color: "#f87171", size: 0.15 }));
    },
  };
}
