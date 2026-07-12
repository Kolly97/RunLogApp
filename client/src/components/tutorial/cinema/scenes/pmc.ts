// Chart-Kino-Szene: PMC (Formkurve). Kuratierter 16-Wochen-Snapshot an Isabels Story: 12 echte Wochen
// (3:1-Rhythmus, Krankheitswoche 8) + 4 geplante Wochen (Taper → Renntag) als Geister-Ribbons rechts von
// „heute“ — wie im echten Chart. CTL/ATL/TSB werden mit der ECHTEN EWMA-Mathematik aus den Tages-TSS
// gerechnet; alle Zahlen in den Beat-Texten kommen aus denselben Arrays wie die Geometrie.
import * as THREE from "three";
import { KINO, block, ewma, marker, ribbon, spriteLabel, type Beat, type CinemaScene, type Vec3 } from "../sceneKit.ts";

// Abgestimmt, damit die Lehr-Werte sitzen: heute TSB ≈ −14 (produktiv müde), Krank-Spitze ≈ +20,
// Renntag ≈ +12 (Wettkampf-Fenster), Ramp ≈ +4 (grüner Korridor).
const REAL_WEEKS = [340, 360, 380, 240, 390, 410, 250, 60, 210, 420, 450, 500]; // Wo 8 = krank
const PLAN_WEEKS = [330, 290, 240, 200];                                        // Taper → Rennwoche
const SHARE = [0.14, 0.04, 0.2, 0.12, 0.02, 0.2, 0.28];                         // Mo..So (So = Longrun)
const CTL0 = 46, ATL0 = 46;

const dailyOf = (weeks: number[]) => weeks.flatMap((w) => SHARE.map((s) => w * s));

function series(planWeeks: number[]) {
  const daily = [...dailyOf(REAL_WEEKS), ...dailyOf(planWeeks)];
  const ctl = ewma(daily, 42, CTL0);
  const atl = ewma(daily, 7, ATL0);
  const tsb = daily.map((_, i) => (i === 0 ? CTL0 - ATL0 : ctl[i - 1] - atl[i - 1]));
  return { daily, ctl, atl, tsb };
}

// Boden-Bänder (K3): Trainingsphasen + Zyklus — wie die Markierungsleisten unten im echten Chart.
// [Start-Woche, Ende-Woche exkl., Label, Farbe] — passend zur 16-Wochen-Story oben.
const PHASE_BAND: [number, number, string, number][] = [
  [0, 4, "Base", 0x3b82f6],
  [4, 7, "Build", 0x8b5cf6],
  [7, 8, "krank", 0xef4444],
  [8, 12, "Build", 0x8b5cf6],
  [12, 14, "Specific", 0xf59e0b],
  [14, 16, "Taper", 0x2dd4bf],
];
const CYCLE_LEN = 28; // Isabels Zyklus: Menstruation (dunkelrot) → Follikel (grün) → Ovulation (teal) → Luteal (violett)
const CYCLE_SEG: [number, number, number][] = [[0, 5, 0x9f1239], [5, 13, 0x15803d], [13, 16, 0x0d9488], [16, 28, 0x6d28d9]];

const N = (REAL_WEEKS.length + PLAN_WEEKS.length) * 7;
const TODAY = REAL_WEEKS.length * 7 - 1;
const x = (i: number) => -3.1 + (6.2 * i) / (N - 1);
const yLoad = (v: number) => v * 0.026;              // CTL/ATL-Achse (50 → 1.3)
const yTsb = (v: number) => 1.0 + v * 0.022;         // TSB-Achse (0 → 1.0, −18 → 0.6)
const Z = { ctl: 0, atl: -0.3, tsb: 0.35, bars: -0.65 };

const pts = (vals: number[], from: number, to: number, y: (v: number) => number, z: number) => {
  const out: THREE.Vector3[] = [];
  for (let i = from; i <= to; i++) out.push(new THREE.Vector3(x(i), y(vals[i]), z));
  return out;
};

function weekBars(weeks: number[], firstWeek: number, ghost: boolean): THREE.Group {
  const g = new THREE.Group();
  weeks.forEach((w, k) => {
    const h = (w / 450) * 1.15;
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, h, 0.1),
      new THREE.MeshStandardMaterial({ color: KINO.bars, transparent: true, opacity: ghost ? 0.16 : 0.3, roughness: 0.8 }),
    );
    bar.position.set(x((firstWeek + k) * 7 + 3), h / 2, Z.bars);
    g.add(bar);
  });
  return g;
}

/** Geplanter (Geister-)Teil rechts von „heute“ — wird auch vom Sandbox-Slider neu gebaut.
 *  Die Form-Linie färbt sich rot und das Renntag-Label warnt, sobald der Taper den Peak nicht mehr schafft. */
function buildPlanned(group: THREE.Group, s: ReturnType<typeof series>): void {
  const race = Math.round(s.tsb[N - 1]);
  const good = race >= 5;
  const mk = (vals: number[], y: (v: number) => number, z: number, color: number, name: string, radius = 0.03) => {
    const m = ribbon(pts(vals, TODAY, N - 1, y, z), color, { name, opacity: 0.42, radius });
    group.add(m);
  };
  mk(s.ctl, yLoad, Z.ctl, KINO.ctl, "ghost:ctl");
  mk(s.atl, yLoad, Z.atl, KINO.atl, "ghost:atl");
  mk(s.tsb, yTsb, Z.tsb, good ? KINO.tsb : KINO.danger, "ghost:tsb", good ? 0.03 : 0.045);
  const lab = spriteLabel(
    `Renntag: TSB ${race >= 0 ? "+" : ""}${race}${good ? " ✓" : " ✗"}`,
    [x(N - 1) - 0.05, yTsb(s.tsb[N - 1]) + 0.24, Z.tsb],
    { color: good ? "#4ade80" : "#f87171", size: 0.16 },
  );
  lab.name = "ghost:racelab";
  group.add(lab);
}

function disposeByName(group: THREE.Group, prefix: string): void {
  for (const o of [...group.children]) {
    if (o.name.startsWith(prefix)) {
      group.remove(o);
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as (THREE.Material & { map?: THREE.Texture }) | undefined;
      mat?.map?.dispose?.();
      mat?.dispose?.();
    }
  }
}

export function pmcScene(): CinemaScene {
  const base = series(PLAN_WEEKS);
  const r = Math.round;
  const ctlT = r(base.ctl[TODAY]), atlT = r(base.atl[TODAY]), tsbT = r(base.tsb[TODAY]);
  const sickPeak = r(Math.max(...base.tsb.slice(7 * 7, 9 * 7)));            // TSB-Spitze in/nach Krankwoche
  const tsbRace = r(base.tsb[N - 1]);
  const ramp = r(base.ctl[TODAY] - base.ctl[TODAY - 7]);
  const iSick = 7 * 7 + 5;                                                  // Ende der Krankheitswoche
  const xT = x(TODAY), xSick = x(iSick), xRace = x(N - 1);

  const beats: Beat[] = [
    {
      title: "Deine Formkurve — das große Bild",
      text: "Willkommen in meinem PMC — hier begehbar in 3D. Die grauen Säulen sind meine Wochenlast (TSS). Daraus laufen drei Linien: BLAU meine Fitness (CTL, 42-Tage-Gedächtnis, träge), PINK die Ermüdung (ATL, 7 Tage, nervös) und GOLD die Form (TSB) — die Differenz der beiden. Rechts der weißen Marke „heute“ wird der Plan weitergerechnet. Schau dich ruhig um: Ziehen dreht die Szene, „Weiter“ holt dich zurück.",
      cam: [0, 2.5, 7.8], look: [0, 1.05, 0],
      isabel: { kind: "pose", at: [3.5, 0, 1.4], clip: "Wave", faceTo: [3.5, 0, 7] },
    },
    {
      title: `Der Wert heute: CTL ${ctlT} · ATL ${atlT} · TSB ${tsbT}`,
      text: `So liest du den Marker: Fitness ${ctlT} — mein Lastniveau, über Monate aufgebaut. Ermüdung ${atlT} — die letzten Tage waren fordernd. Form ${tsbT} = Fitness minus Ermüdung (Stand gestern): Ich bin gerade müder, als ich fit bin. Klingt negativ? Im Aufbau ist genau das der Zweck — der Reiz ist gesetzt, die Anpassung läuft.`,
      cam: [xT + 1.7, 1.8, 3.8], look: [xT, 1.1, 0],
      isabel: { kind: "walk", to: [xT + 0.5, 0, 1.0], then: "Point", faceTo: [xT, 1.4, 0] },
      highlight: "marker:today",
      exclaim: `TSB ${tsbT}!`,
    },
    {
      title: "Die Form-Zonen — ich lauf sie dir ab",
      text: "Ich laufe jetzt auf meiner goldenen Form-Linie durch die letzten Wochen. Merk dir drei Zonen: −10 bis −25 = produktiv müde, die Trainingszone — hier verbringe ich den Aufbau. Unter −25 = Keller, Überlastungsrisiko. Über +5 = frisch — gut vor Rennen, auf Dauer aber Stillstand. Sieh, wie die Linie nach jeder harten Welle in der Entlastungswoche auftaucht: Das 3:1-Atmen des Trainings.",
      cam: [0.2, 2.0, 6.6], look: [0, 0.9, 0.35],
      isabel: { kind: "path", dur: 8 },
      highlight: "ribbon:tsb",
    },
    {
      title: `Vorsicht beim Lesen: das +${sickPeak} war kein gutes Zeichen`,
      text: `Hier, Woche 8: Die Form schießt auf +${sickPeak} — sieht nach Bestform aus, war aber eine Krankheitswoche. Die Ermüdung fiel, weil ich kaum trainieren KONNTE, und die blaue Fitness bröckelt darunter leise ab. Lektion: TSB hoch heißt nur „erholt relativ zur eigenen Last“ — WARUM, sagen dir erst Wellness-Daten und Kontext. Frisch durch Taper und frisch durch Fieber sehen im PMC gleich aus.`,
      cam: [xSick + 0.2, 1.9, 4.2], look: [xSick, 1.05, 0],
      isabel: { kind: "walk", to: [xSick + 0.55, 0, 1.05], then: "Point", faceTo: [xSick, 1.3, 0.35] },
      highlight: "zone:sick",
      exclaim: `+${sickPeak}?!`,
    },
    {
      title: "Was das Programm daraus macht",
      text: `Rechts von „heute“ siehst du RunLogs Antwort: Die geplanten Einheiten werden zu einer Prognose weitergerechnet. Der Wochen-Vorschlag dosiert nach Form und Ramp (aktuell +${ramp} CTL/Woche — im grünen Korridor), die Readiness entschärft harte Tage bei schwachen Werten, und der Coach legt den Taper so, dass die goldene Linie am Renntag bei etwa +${tsbRace} ankommt: erholt, aber nicht eingerostet.`,
      cam: [1.6, 2.0, 5.6], look: [xRace - 1.2, 1.1, 0.1],
      isabel: { kind: "walk", to: [xRace - 0.5, 0, 1.1], then: "Point", faceTo: [xRace, 1.6, 0] },
      highlight: "marker:race",
      exclaim: "Renntag! 🏁",
    },
    {
      title: "Und was machst DU damit?",
      text: "Drei Handgriffe reichen: (1) Im Aufbau die Form in der produktiven Zone halten — fühlt sich müde an, ist gewollt. (2) Die Ramp beobachten: +3 bis +6 CTL pro Woche ist nachhaltig, ab +8 ziehst du besser raus. (3) Vor dem Wettkampf der goldenen Linie ins Plus folgen — dem Taper vertrauen, nicht in Panik nachtrainieren. Und: Nie einen einzelnen TSB-Tag jagen; der Trend und dein Körpergefühl entscheiden zusammen.",
      cam: [-0.5, 2.3, 7.0], look: [0, 1.0, 0],
      isabel: { kind: "walk", to: [-0.4, 0, 1.4], then: "Idle", faceTo: [-0.4, 1, 7] },
    },
    {
      title: "Die Bänder unten — Kontext auf einen Blick",
      text: "Wirf noch einen Blick nach unten: Zwei Leisten tragen den Kontext, genau wie im echten Chart. Oben die TRAININGSPHASEN — Base blau, Build violett, Specific bernstein, Taper türkis, und rot meine Krankheitswoche. Darunter mein ZYKLUS: dunkelrot Menstruation, grün Follikelphase, türkis Ovulation, violett Lutealphase. Warum das zählt: Dieselbe Form-Zahl liest sich je nach Phase anders — −15 mitten im Build ist Plan, −15 im Taper wäre Alarm. Und fallen zähe Wochen immer wieder mit der späten Lutealphase zusammen, siehst du es hier zuerst — genau das greift die Zyklus-Analyse später auf.",
      cam: [0.5, 1.7, 5.0], look: [0.2, 0.3, 1.0],
      isabel: { kind: "walk", to: [1.7, 0, 2.0], then: "Point", faceTo: [0.6, 0.25, 1.0] },
      highlight: "bands",
      exclaim: "Schau nach unten!",
    },
    {
      title: "Spiel damit: sabotiere meinen Taper",
      text: "Jetzt du: Der Regler unten packt Extra-Last in JEDE meiner Restwochen bis zum Rennen — also genau das, was ehrgeizige Läufer aus Panik tun. Beobachte die Geister-Linien und das Renntag-Label: Die pinke Ermüdung fließt nicht mehr ab, die Form-Linie färbt sich rot und steht am Renntag im Minus — kaputt statt spitz an der Startlinie. Die blaue Fitness steigt zwar etwas — aber Form entscheidet, wie viel davon auf die Straße kommt: nicht abrufbare Fitness ist verschenkte Fitness.",
      cam: [2.0, 1.9, 5.0], look: [2.1, 1.0, 0.2],
      isabel: { kind: "walk", to: [1.3, 0, 1.15], then: "Point", faceTo: [2.4, 1.2, 0.35] },
      sandbox: true,
    },
    {
      title: "Das war die Formkurve",
      text: "Merksatz: Zwei Gedächtnisse, eine Differenz — und du steuerst über die goldene Linie. Im echten RunLog findest du dieses Chart groß auf der Langzeit-Seite und als Drei-Zahlen-Kopf in der Wochenplanung. Die leuchtenden Punkte hier in der Szene kannst du übrigens anklicken, um zu einer Stelle zurückzuspringen. Bis gleich!",
      cam: [0, 2.5, 7.8], look: [0, 1.05, 0],
      isabel: { kind: "walk", to: [3.3, 0, 1.4], then: "Wave", faceTo: [3.3, 0, 7] },
    },
  ];

  return {
    id: "pmc",
    beats,
    hotspots: [
      { pos: [xT, 2.35, 0], beat: 1, label: "heute" },
      { pos: [xSick, 2.0, 0.35], beat: 3, label: "Krankheitswoche" },
      { pos: [xRace, 2.35, 0], beat: 4, label: "Renntag" },
      { pos: [x(13 * 7), 0.32, 1.05], beat: 6, label: "Phasen & Zyklus" },
    ],
    runPath: (() => {
      const p: Vec3[] = [];
      for (let i = 4 * 7; i <= TODAY; i += 2) p.push([x(i), yTsb(base.tsb[i]) + 0.02, Z.tsb]);
      return p;
    })(),
    build(group: THREE.Group) {
      group.add(weekBars(REAL_WEEKS, 0, false));
      const ghostBars = weekBars(PLAN_WEEKS, REAL_WEEKS.length, true);
      ghostBars.name = "ghost:bars";
      group.add(ghostBars);
      group.add(ribbon(pts(base.ctl, 0, TODAY, yLoad, Z.ctl), KINO.ctl, { name: "ribbon:ctl" }));
      group.add(ribbon(pts(base.atl, 0, TODAY, yLoad, Z.atl), KINO.atl, { name: "ribbon:atl" }));
      group.add(ribbon(pts(base.tsb, 0, TODAY, yTsb, Z.tsb), KINO.tsb, { name: "ribbon:tsb", radius: 0.042 }));
      buildPlanned(group, base);
      // TSB-Nulllinie als Glasplatte + Zonen-Labels an der TSB-Spur
      const zero = new THREE.Mesh(
        new THREE.BoxGeometry(6.4, 0.012, 0.36),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.25 }),
      );
      zero.position.set(0, yTsb(0), Z.tsb);
      group.add(zero);
      group.add(spriteLabel("TSB 0", [-3.35, yTsb(0), Z.tsb], { color: KINO.muted, size: 0.13 }));
      group.add(spriteLabel("produktiv müde (−10…−25)", [-3.05, yTsb(-19), Z.tsb], { color: "#f0b429", size: 0.12 }));
      // Marker + Wert-Labels (Zahlen = dieselben Arrays wie die Beats)
      marker(group, xT, 2.25, 0xf8fafc, "marker:today", "heute");
      marker(group, xRace, 2.25, KINO.tsb, "marker:race", "Renntag 🏁");
      group.add(spriteLabel(`CTL ${ctlT}`, [xT + 0.42, yLoad(base.ctl[TODAY]) + 0.16, Z.ctl], { color: "#60a5fa", size: 0.14 }));
      group.add(spriteLabel(`ATL ${atlT}`, [xT + 0.42, yLoad(base.atl[TODAY]) + 0.34, Z.atl], { color: "#ec4899", size: 0.14 }));
      group.add(spriteLabel(`TSB ${tsbT}`, [xT + 0.42, yTsb(base.tsb[TODAY]) - 0.2, Z.tsb], { color: "#f0b429", size: 0.14 }));
      // Krankheitswoche: dezente rote Zone hinter den Kurven
      const sick = new THREE.Mesh(
        new THREE.BoxGeometry(0.98, 2.0, 0.02),
        new THREE.MeshStandardMaterial({ color: KINO.danger, transparent: true, opacity: 0.12 }),
      );
      sick.position.set(x(7 * 7 + 3), 1.0, -0.8);
      sick.name = "zone:sick";
      group.add(sick);
      group.add(spriteLabel("krank 🤒", [x(7 * 7 + 3), 2.12, -0.8], { color: "#fca5a5", size: 0.13 }));
      // Boden-Bänder (K3): Trainingsphasen + Zyklus als Kontext-Leisten vor der Szene (Gruppe → Highlight pulsiert alles)
      const bands = new THREE.Group();
      bands.name = "bands";
      for (const [w0, w1, label, color] of PHASE_BAND) {
        const x0 = x(w0 * 7), x1 = x(Math.min(w1 * 7, N - 1));
        bands.add(block([x1 - x0 - 0.02, 0.045, 0.16], [(x0 + x1) / 2, 0.05, 0.95], color, { opacity: 0.9, emissive: true }));
        if (label !== "krank") bands.add(spriteLabel(label, [(x0 + x1) / 2, 0.2, 0.95], { color: "#cbd5e1", size: 0.095 }));
      }
      // Zyklus-Band: 28-Tage-Rhythmus, zusammenhängende Segmente statt Tages-Klötzchen (Drawcalls)
      const cycleColor = (d: number) => CYCLE_SEG.find(([a, b]) => ((d + 3) % CYCLE_LEN) >= a && ((d + 3) % CYCLE_LEN) < b)![2];
      let runStart = 0;
      for (let d = 1; d <= N; d++) {
        if (d === N || cycleColor(d) !== cycleColor(runStart)) {
          const x0 = x(runStart), x1 = x(d - 1);
          bands.add(block([Math.max(x1 - x0, 6.2 / N), 0.04, 0.11], [(x0 + x1) / 2, 0.05, 1.22], cycleColor(runStart), { opacity: 0.75, emissive: true }));
          runStart = d;
        }
      }
      bands.add(spriteLabel("Phasen", [-3.5, 0.08, 0.95], { color: KINO.muted, size: 0.1 }));
      bands.add(spriteLabel("Zyklus", [-3.5, 0.08, 1.22], { color: KINO.muted, size: 0.1 }));
      group.add(bands);
    },
    applySandbox(group: THREE.Group, value01: number): string {
      // Der Regler sabotiert den TAPER: Extra-Last in JEDER Restwoche bis zum Rennen — so wird sichtbar,
      // dass die Ermüdung bis zur Startlinie nicht mehr abfließt und die Form am Renntag kippt.
      const extra = Math.round(value01 * 260);
      const plan = PLAN_WEEKS.map((w) => w + extra);
      const s = series(plan);
      disposeByName(group, "ghost:");
      buildPlanned(group, s);
      const ghostBars = weekBars(plan, REAL_WEEKS.length, true);
      ghostBars.name = "ghost:bars";
      group.add(ghostBars);
      const atlRace = Math.round(s.atl[N - 1]);
      const race = Math.round(s.tsb[N - 1]);
      const dCtl = Math.round((s.ctl[N - 1] - base.ctl[N - 1]) * 10) / 10;
      if (extra === 0) return `Zurück auf Plan: Der Taper lässt die Ermüdung abfließen — TSB am Renntag ≈ +${race} ✓.`;
      const verdict = race < 0
        ? `Form am Renntag ${race} — du stündest KAPUTT statt spitz an der Startlinie. Genau so verschenkt man einen Wettkampf.`
        : race < 5
          ? `Form am Renntag nur +${race} — zu müde für Bestform, der Taper konnte die Extra-Ermüdung nicht mehr abbauen.`
          : `Form am Renntag noch +${race} — gerade so okay, aber der Puffer schmilzt.`;
      return `+${extra} TSS je Restwoche → Ermüdung bleibt bis zur Startlinie bei ~${atlRace}. ${verdict} Die ${dCtl > 0 ? "+" : ""}${dCtl} CTL mehr stehen zwar auf dem Papier — abrufen kannst du davon am Renntag nichts. RunLog: Ramp-Warnung, Readiness würde entschärfen, der Coach den Taper verteidigen.`;
    },
  };
}
