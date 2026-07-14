// Chart-Kino: gemeinsames Vokabular aller Szenen — Beat-Schema (Didaktik: Wert → Lesen → Interpretieren →
// Programm-Reaktion → Deine Reaktion) + 3D-Bausteine im Holodeck-Look (leuchtende Ribbons, Sprite-Labels).
// Eine Szene = kuratierter Snapshot + build() + BEATS; die Zahlen der Beat-Texte kommen aus DENSELBEN
// Arrays wie die Geometrie (eine Wahrheitsquelle, nichts doppelt gepflegt).
import * as THREE from "three";
import type { CinemaChartId } from "../types.ts";
import type { ClipName } from "./isabelActor.ts";

export type Vec3 = [number, number, number];

export type BeatIsabel =
  | { kind: "walk"; to: Vec3; run?: boolean; then?: ClipName; faceTo?: Vec3 }   // hingehen, dann Geste
  | { kind: "path"; dur: number }                                               // scene.runPath ablaufen
  | { kind: "pose"; at?: Vec3; clip: ClipName; faceTo?: Vec3 };                 // direkt posieren

export type Beat = {
  title: string;
  text: string;
  cam: Vec3;            // Kamera-Position des Beats (danach frei orbitierbar)
  look: Vec3;           // Blickpunkt (auch OrbitControls-Target)
  isabel?: BeatIsabel;
  highlight?: string;   // Objektname in der Szenen-Gruppe → pulsiert
  exclaim?: string;     // kurzer Ausruf als Blase an Isabels Kopf
  sandbox?: boolean;    // zeigt den Was-wäre-wenn-Slider (nur PMC)
  toggle?: boolean;     // zeigt den Sicht-Umschalter der Szene (nur dose: absolut ↔ volumen-bereinigt)
};

export type Hotspot = { pos: Vec3; beat: number; label: string };

export type CinemaScene = {
  id: CinemaChartId;    // Chip-Label/Icon liegen in meta.ts (kein three-Import für den Hub)
  build(group: THREE.Group): void;
  beats: Beat[];
  hotspots: Hotspot[];
  runPath?: Vec3[];     // Pfad für den Landschafts-Beat (Isabel läuft die Kurve)
  /** Was-wäre-wenn (0..1) — baut die dynamischen Teile um und liefert den Kommentar zur Reaktion. */
  applySandbox?(group: THREE.Group, value01: number): string;
  /** Sicht-Umschalter (v3.1.0, dose): EIN Balkensatz, der zwischen zwei Wertesätzen MORPHT. Der Host animiert
   *  `u` (0 = Zustand A … 1 = Zustand B) über ~0.8 s und ruft das hier je Frame — bei reduced-motion springt er
   *  direkt auf 1. `toggle` beschriftet den Schalter in der HUD. */
  toggle?: { label: string; off: string; on: string };
  applyToggle?(group: THREE.Group, u: number): void;
  /** Kommentar zur Umschaltung (einmal je Klick, nicht je Frame). */
  toggleNote?(on: boolean): string;
};

// Holodeck-Palette — bewusst die Farben der echten Recharts (Wiedererkennung).
export const KINO = {
  ctl: 0x60a5fa, atl: 0xec4899, tsb: 0xf0b429, bars: 0x64748b,
  teal: 0x2dd4bf, ok: 0x4ade80, warn: 0xf59e0b, danger: 0xef4444,
  text: "#e2e8f0", muted: "#94a3b8",
};

/** Leuchtender Kurven-Schlauch (Linie → Ribbon). `name` macht ihn highlight-/austauschbar. */
export function ribbon(points: THREE.Vector3[], color: number, opts: { name?: string; radius?: number; opacity?: number } = {}): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, Math.min(240, points.length * 4), opts.radius ?? 0.035, 8, false);
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.4, emissive: color, emissiveIntensity: 0.35,
    transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  if (opts.name) mesh.name = opts.name;
  return mesh;
}

/** Text als Sprite (Canvas-Textur) — Achsenwerte, Marker, Legenden. `size` = Höhe in Welt-Einheiten.
 *  K3: halbtransparentes Plättchen dahinter + depthTest aus → Labels clippen nie in Geometrie/Sockel
 *  und bleiben in jeder Kamera-Lage lesbar (Beta-Befund image-41). */
export function spriteLabel(text: string, pos: Vec3, opts: { color?: string; size?: number; plain?: boolean } = {}): THREE.Sprite {
  const fs = 46, padX = 16, padY = 9, radius = 14;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `600 ${fs}px system-ui, -apple-system, sans-serif`;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(probe.measureText(text).width) + padX * 2;
  canvas.height = fs + padY * 2;
  const ctx = canvas.getContext("2d")!;
  if (!opts.plain) {
    ctx.fillStyle = "rgba(10, 16, 30, 0.78)";
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, radius);
    ctx.fill();
  }
  ctx.font = `600 ${fs}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = opts.color ?? KINO.text;
  ctx.textBaseline = "middle";
  ctx.fillText(text, padX, canvas.height / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  spr.renderOrder = 20; // über der Chart-Geometrie
  const size = opts.size ?? 0.17;
  spr.scale.set(size * canvas.width / canvas.height, size, 1);
  spr.position.set(...pos);
  return spr;
}

/** Vertikaler Marker-Stab (heute, Renntag) mit optionalem Label darüber. */
export function marker(group: THREE.Group, x: number, height: number, color: number, name: string, label?: string): void {
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, height, 8),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 }),
  );
  post.position.set(x, height / 2, 0);
  post.name = name;
  group.add(post);
  if (label) group.add(spriteLabel(label, [x, height + 0.14, 0], { size: 0.15 }));
}

export const v3 = (p: Vec3) => new THREE.Vector3(...p);

/** Quader (Säulen, Bänder, Zonen) — pos = Mittelpunkt. */
export function block(size: Vec3, pos: Vec3, color: number, opts: { name?: string; opacity?: number; emissive?: boolean } = {}): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.6,
    emissive: opts.emissive ? color : 0x000000, emissiveIntensity: opts.emissive ? 0.35 : 0,
    transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1,
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  m.position.set(...pos);
  if (opts.name) m.name = opts.name;
  return m;
}

/** EWMA-Folge (PMC-Mathematik — dieselbe wie im Server, Zeitkonstante in Tagen). */
export function ewma(daily: number[], tau: number, start: number): number[] {
  const out: number[] = [];
  let v = start;
  for (const d of daily) { v += (d - v) / tau; out.push(v); }
  return out;
}
