// Chart-Kino (v2.11.0): Isabel als echtes Low-Poly-GLTF. Basis: Quaternius-Frau mit hochgestecktem
// Haar (CC0, volles CharacterArmature-Gesten-Rig — Winken/Zeigen/Interact), zur Laufzeit in RunLog-
// Farben umgefärbt (blond + Blau). Keine Haar-Anbauten (bewusste Entscheidung nach mehreren Anläufen).
// Begutachtung im Dev-Viewer /isabel-preview. Der Actor kapselt Clips hinter sprechenden Namen;
// einmal geladen, für alle Szenen gecacht.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type ClipName = "Idle" | "Walk" | "Run" | "Wave" | "Point" | "Interact";

// Clip-Namen des Modells → sprechende API (Reihenfolge = Fallback-Kette; fehlt alles → Idle).
// CharacterArmature-Rig (24 Clips): Zeigen = Gun-Pointing-Pose ohne Waffe.
const CLIP_MAP: Record<ClipName, string[]> = {
  Idle: ["Idle_Neutral", "Idle"],
  Walk: ["Walk", "Walking"],
  Run: ["Run", "Running"],
  Wave: ["Wave", "Jump"],
  Point: ["Idle_Gun_Pointing", "Idle"],
  Interact: ["Interact", "PickUp"],
};
// Gesten-Clips, die nur EINMAL laufen und dann weich zurück zu Idle blenden.
const ONCE_CLIPS = new Set(["Jump", "Jump2", "PickUp", "Punch", "Wave", "Interact"]);

const HAIR = 0xe7d39b; // helles Goldblond (nach Vorlage)
// Umfärbung nach Material-Namen — RunLog-Look für das Dutt-Modell (Skin/Red/Brown/LimeGreen/Gold);
// die White/Grey/…-Einträge decken die Casual-Schwester ab. EINE Stelle zum Nachjustieren (Dev-Viewer!).
const RECOLOR: Record<string, number> = {
  Red: HAIR,            // Haar (rothaarig → blond)
  LimeGreen: 0x2563eb,  // Kleid → RunLog-Blau
  Gold: 0x2dd4bf,       // Gürtel → Teal
  Brown: 0xf0b429,      // Schuhe → Amber
  Skin: 0xf2d2ba,       // heller Teint
  White: 0x2563eb,
  Grey: 0x1e293b,
  Orange: 0x2dd4bf,
  Hair_Brown: HAIR,
  Hair_Blond: HAIR,
};

const HEIGHT = 1.44; // Zielhöhe in Szenen-Einheiten: Isabel ist zierliche 1,60 m (Referenzfigur der Bühne ≈ 1,72 m)

type WalkJob = { to: THREE.Vector3; speed: number; resolve: () => void };
type PathJob = { curve: THREE.CatmullRomCurve3; dur: number; t: number; resolve: () => void };

export class IsabelActor {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions = new Map<ClipName, THREE.AnimationAction>();
  private once = new Set<ClipName>(); // ClipNames, deren aufgelöster Clip nur einmal läuft
  private current: ClipName | null = null;
  private head: THREE.Object3D | null;
  private walk: WalkJob | null = null;
  private path: PathJob | null = null;

  constructor(model: THREE.Group, clips: THREE.AnimationClip[]) {
    // Höhe normalisieren + (falls benannte Materialien) umfärben.
    const box = new THREE.Box3().setFromObject(model);
    const s = HEIGHT / Math.max(0.001, box.max.y - box.min.y);
    model.scale.setScalar(s);
    model.position.y = -box.min.y * s;
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false; // skinned Meshes: Bounds wandern mit der Pose — Culling-Flackern vermeiden
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (std?.name && RECOLOR[std.name] != null) std.color.setHex(RECOLOR[std.name]);
      }
    });
    this.head = model.getObjectByName("Head") ?? null;
    this.root.add(model);

    this.mixer = new THREE.AnimationMixer(model);
    for (const key of Object.keys(CLIP_MAP) as ClipName[]) {
      for (const raw of CLIP_MAP[key]) {
        const clip = clips.find((c) => c.name === raw || c.name.endsWith(`|${raw}`));
        if (clip) {
          this.actions.set(key, this.mixer.clipAction(clip));
          if (ONCE_CLIPS.has(raw)) this.once.add(key);
          break;
        }
      }
    }
    // Einmal-Gesten (Hüpfer-Gruß, PickUp): nach dem Durchlauf weich zurück in Idle.
    this.mixer.addEventListener("finished", () => {
      if (this.current && this.once.has(this.current)) this.play("Idle");
    });
  }

  /** Läuft gerade ein Weg-/Pfad-Job? (adaptiver Render-Loop hält dann die volle Bildrate) */
  get busy(): boolean {
    return this.walk != null || this.path != null;
  }

  play(name: ClipName, fadeS = 0.25): void {
    if (this.current === name) return;
    const next = this.actions.get(name) ?? this.actions.get("Idle");
    if (!next) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    if (this.once.has(name)) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = false;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    next.reset().fadeIn(fadeS).play();
    if (prev && prev !== next) prev.fadeOut(fadeS);
    this.current = name;
  }

  /** Sofort an Position (Reduced-Motion-Pfad und Szenen-Setup). */
  teleport(pos: THREE.Vector3, faceTo?: THREE.Vector3): void {
    this.walk = null; this.path = null;
    this.root.position.copy(pos);
    if (faceTo) this.face(faceTo);
  }

  face(target: THREE.Vector3): void {
    this.root.rotation.y = Math.atan2(target.x - this.root.position.x, target.z - this.root.position.z);
  }

  /** Geht (bzw. joggt) am Boden zur Zielposition; Promise löst bei Ankunft. */
  walkTo(to: THREE.Vector3, run = false): Promise<void> {
    this.path = null;
    this.play(run ? "Run" : "Walk");
    this.face(to);
    return new Promise((resolve) => { this.walk = { to: to.clone(), speed: run ? 1.7 : 0.85, resolve }; });
  }

  /** Läuft eine Kurve entlang (Landschafts-Beat) — Blick in Laufrichtung. */
  followPath(points: THREE.Vector3[], durS: number): Promise<void> {
    this.walk = null;
    this.play("Run");
    const curve = new THREE.CatmullRomCurve3(points);
    return new Promise((resolve) => { this.path = { curve, dur: durS, t: 0, resolve }; });
  }

  /** Kopfposition in Weltkoordinaten (für die Ausruf-Blase). */
  headWorldPos(out: THREE.Vector3): THREE.Vector3 {
    if (this.head) return this.head.getWorldPosition(out);
    return out.copy(this.root.position).add(new THREE.Vector3(0, HEIGHT, 0));
  }

  update(dt: number): void {
    this.mixer.update(dt);
    if (this.walk) {
      const { to, speed, resolve } = this.walk;
      const pos = this.root.position;
      const dist = pos.distanceTo(to);
      const step = speed * dt;
      if (dist <= step) { pos.copy(to); this.walk = null; this.play("Idle"); resolve(); }
      else pos.add(to.clone().sub(pos).normalize().multiplyScalar(step));
    }
    if (this.path) {
      this.path.t = Math.min(1, this.path.t + dt / this.path.dur);
      const p = this.path.curve.getPointAt(this.path.t);
      const ahead = this.path.curve.getPointAt(Math.min(1, this.path.t + 0.02));
      this.root.position.copy(p);
      this.face(ahead);
      if (this.path.t >= 1) { const r = this.path.resolve; this.path = null; this.play("Idle"); r(); }
    }
  }
}

let cached: Promise<IsabelActor> | null = null;

/** Lädt Isabel einmalig (1,5-MB-GLB) und liefert denselben Actor für alle Szenen. */
export function loadIsabel(): Promise<IsabelActor> {
  if (!cached) {
    cached = new GLTFLoader().loadAsync("/assets/isabel.glb")
      .then((gltf) => new IsabelActor(gltf.scene, gltf.animations))
      .catch((e) => { cached = null; throw e; }); // Fehlversuch nicht einfrieren — nächster Aufruf probiert neu
  }
  return cached;
}
