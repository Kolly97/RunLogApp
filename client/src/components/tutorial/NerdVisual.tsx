// Nerd-Add-on (v2.10.0 Etappe C): je ML-Modell eine kleine Three.js-Intuition — 3D-Datenskizzen, keine
// Deko. Deterministisch (feste Daten, kein Math.random), lazy geladen (teilt den Three-Chunk mit der
// IsabelScene). Respektiert den globalen Animationen-Schalter: aus → statisches Bild.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { motionEnabled } from "../../lib/motion.ts";

export type NerdVisualKind = "pmc" | "cs" | "kalman" | "dose" | "permutation" | "banister";

const H = 190;
const COL = { blue: 0x2563eb, teal: 0x2dd4bf, amber: 0xf0b429, red: 0xdc2626, slate: 0x94a3b8, dark: 0x334155 };

function tube(points: THREE.Vector3[], color: number, radius = 0.035, opacity = 1) {
  const curve = new THREE.CatmullRomCurve3(points);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, transparent: opacity < 1, opacity });
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 90, radius, 8, false), mat);
}
function bar(x: number, h: number, color: number, w = 0.09, z = 0, opacity = 1) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: opacity < 1, opacity });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, Math.max(h, 0.02), w), mat);
  m.position.set(x, Math.max(h, 0.02) / 2, z);
  return m;
}
function dot(x: number, y: number, z: number, color: number, r = 0.05) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
  m.position.set(x, y, z);
  return m;
}
/** Grundplatte + Nulllinie — gemeinsamer Rahmen aller Skizzen. */
function base(group: THREE.Group) {
  const plate = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.04, 1.6), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.9, transparent: true, opacity: 0.55 }));
  plate.position.y = -0.02;
  group.add(plate);
}

// Feste „Trainings-Tage" (30 Werte, handgesetzt: harte Tage, Ruhetage, Deload in Woche 3).
const DAYS = [55, 0, 95, 40, 0, 120, 60, 45, 0, 100, 50, 0, 130, 65, 30, 20, 0, 45, 25, 0, 60, 110, 0, 90, 55, 0, 125, 70, 40, 0];

function buildPmc(group: THREE.Group) {
  base(group);
  const x0 = -2.1, dx = 4.2 / (DAYS.length - 1), scale = 1 / 140;
  let ctl = 0.45, atl = 0.45;
  const ctlPts: THREE.Vector3[] = [], atlPts: THREE.Vector3[] = [];
  DAYS.forEach((tss, i) => {
    const x = x0 + i * dx;
    group.add(bar(x, tss * scale * 0.9, COL.slate, 0.07, 0.35, 0.75));
    // echte EWMAs über die Balken — die Kurven SIND aus den Tagesdaten gerechnet (nur Zeitkonstanten gestaucht).
    ctl += (tss * scale - ctl) / 12;
    atl += (tss * scale - atl) / 3;
    ctlPts.push(new THREE.Vector3(x, 0.35 + ctl * 1.5, 0));
    atlPts.push(new THREE.Vector3(x, 0.35 + atl * 1.5, -0.3));
  });
  group.add(tube(ctlPts, COL.blue, 0.04));   // CTL: träge
  group.add(tube(atlPts, COL.amber, 0.032)); // ATL: nervös
}

function buildCs(group: THREE.Group) {
  base(group);
  // v(t) = CS + D'/t — Tempo-Dauer-Kurve mit Asymptote; Bestleistungen als Punkte auf der Kurve.
  const CS = 0.55, Dp = 0.55;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = 0.35 + (i / 40) * 4.2;
    pts.push(new THREE.Vector3(-2.15 + t, CS + Dp / t, 0));
  }
  group.add(tube(pts, COL.blue, 0.04));
  const asym = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.015, 0.5), new THREE.MeshBasicMaterial({ color: COL.teal }));
  asym.position.set(0, CS, 0);
  group.add(asym); // die Asymptote: Critical Speed
  for (const t of [0.55, 1.1, 2.2, 3.9]) group.add(dot(-2.15 + t, CS + Dp / t, 0, COL.amber, 0.06)); // Bestleistungen
}

function buildKalman(group: THREE.Group) {
  base(group);
  // glatter latenter Verlauf + verrauschte Messpunkte dreier Quellen (Rauschen je Quelle unterschiedlich groß).
  const latent = (x: number) => 0.7 + 0.35 * Math.sin(x * 0.9 + 0.4) + 0.12 * x;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = -2.1 + (i / 40) * 4.2;
    pts.push(new THREE.Vector3(x, latent(x), 0));
  }
  group.add(tube(pts, COL.blue, 0.035));
  group.add(tube(pts, COL.blue, 0.11, 0.16)); // ±sd-Band als transparente Hülle
  // Messpunkte: [x-Versatz, Rauschen, Quelle] — Labor (teal, präzise) · Rennen (amber) · Einzel-Lauf (rot, grob)
  const meas: [number, number, number, number][] = [
    [-1.9, 0.03, COL.teal, 0.07], [-1.2, -0.18, COL.red, 0.05], [-0.8, 0.14, COL.amber, 0.06],
    [-0.3, -0.22, COL.red, 0.05], [0.2, 0.05, COL.teal, 0.07], [0.7, 0.2, COL.red, 0.05],
    [1.2, -0.12, COL.amber, 0.06], [1.7, 0.16, COL.red, 0.05], [2.0, -0.04, COL.teal, 0.07],
  ];
  for (const [x, noise, color, r] of meas) group.add(dot(x, latent(x) + noise, 0.14, color, r));
}

function buildDose(group: THREE.Group) {
  base(group);
  // Forest-Plot in 3D: je Kanal Punkt (β) + CI-Balken; Null-Ebene senkrecht — was rechts liegt, baut Fitness.
  const zero = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.35, 1.2), new THREE.MeshStandardMaterial({ color: COL.slate, transparent: true, opacity: 0.35 }));
  zero.position.set(0, 0.7, 0);
  group.add(zero);
  // [β, ciLow, ciHigh, Farbe] auf x — Schwelle klar positiv, Long knapp, Easy um 0, VO2 breit/unklar.
  const rows: [number, number, number, number][] = [
    [1.05, 0.45, 1.65, COL.teal],
    [0.45, -0.1, 1.0, COL.blue],
    [0.05, -0.5, 0.6, COL.slate],
    [0.35, -0.75, 1.45, COL.amber],
  ];
  rows.forEach(([b, lo, hi, color], i) => {
    const y = 1.15 - i * 0.28;
    const ci = new THREE.Mesh(new THREE.BoxGeometry(hi - lo, 0.035, 0.035), new THREE.MeshStandardMaterial({ color, roughness: 0.5, transparent: true, opacity: 0.55 }));
    ci.position.set((lo + hi) / 2, y, 0);
    group.add(ci);
    group.add(dot(b, y, 0, color, 0.065));
  });
}

function buildPermutation(group: THREE.Group) {
  base(group);
  // Null-Verteilung (alle Vorzeichen-Flips) als Histogramm — und der beobachtete Effekt θ weit im Schwanz.
  const heights = [0.06, 0.12, 0.24, 0.42, 0.68, 0.95, 1.15, 1.22, 1.15, 0.95, 0.68, 0.42, 0.24, 0.12, 0.06];
  heights.forEach((h, i) => group.add(bar(-1.55 + i * 0.22, h, COL.slate, 0.16, 0, 0.8)));
  const theta = new THREE.Mesh(new THREE.BoxGeometry(0.045, 1.3, 0.045), new THREE.MeshStandardMaterial({ color: COL.red, roughness: 0.4 }));
  theta.position.set(1.85, 0.65, 0);
  group.add(theta);
  group.add(dot(1.85, 1.38, 0, COL.red, 0.07)); // θ_obs — kaum ein Flip kommt hierhin
}

function buildBanister(group: THREE.Group) {
  base(group);
  // Fitness (träge) vs. Ermüdung (flüchtig) nach Taper-Start — die Differenz (Leistung) peakt am Renntag.
  const taperX = 0.6; // ab hier Last runter
  const fitPts: THREE.Vector3[] = [], fatPts: THREE.Vector3[] = [], perfPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 48; i++) {
    const x = -2.1 + (i / 48) * 4.2;
    const load = x < taperX ? 1 : Math.exp(-(x - taperX) * 1.1); // Taper: Last exponentiell runter
    const fit = 0.95 + 0.1 * Math.min(x + 2.1, 2.7) - (x > taperX ? 0.06 * (x - taperX) : 0); // τ1 groß
    const fat = 0.55 + 0.4 * load;                                                            // τ2 klein
    fitPts.push(new THREE.Vector3(x, fit, 0));
    fatPts.push(new THREE.Vector3(x, fat, -0.3));
    perfPts.push(new THREE.Vector3(x, 0.25 + (fit - fat) * 1.6, 0.3));
  }
  group.add(tube(fitPts, COL.blue, 0.035));
  group.add(tube(fatPts, COL.amber, 0.035));
  group.add(tube(perfPts, COL.teal, 0.045));
  const race = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.5, 0.04), new THREE.MeshStandardMaterial({ color: COL.dark }));
  race.position.set(2.05, 0.75, 0.3);
  group.add(race); // Renntag — genau dort, wo die Leistungs-Kurve oben ankommt
}

const BUILDERS: Record<NerdVisualKind, (g: THREE.Group) => void> = {
  pmc: buildPmc, cs: buildCs, kalman: buildKalman, dose: buildDose, permutation: buildPermutation, banister: buildBanister,
};

export default function NerdVisual({ kind }: { kind: NerdVisualKind }) {
  const mount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    const w = el.clientWidth || 520;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, H);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(34, w / H, 0.1, 60);
    cam.position.set(0, 1.7, 4.6);
    cam.lookAt(0, 0.62, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(2, 4, 3);
    scene.add(key);

    const group = new THREE.Group();
    BUILDERS[kind](group);
    scene.add(group);

    const animate = motionEnabled();
    let frame = 0;
    let t = 0;
    const render = () => {
      if (animate) {
        t += 0.012;
        group.rotation.y = Math.sin(t) * 0.16; // sanftes Pendeln — genug 3D-Gefühl, keine Kirmes
        frame = requestAnimationFrame(render);
      } else {
        group.rotation.y = 0.12;
      }
      renderer.render(scene, cam);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      renderer.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      el.removeChild(renderer.domElement);
    };
  }, [kind]);

  return <div ref={mount} style={{ width: "100%", height: H, marginBottom: 10 }} />;
}
