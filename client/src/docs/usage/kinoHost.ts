// Daten-Kino in der Anleitung: schlanker, framework-freier Host für die bestehenden
// Chart-Kino-Szenen (client/src/components/tutorial/cinema/scenes) — dieselben Szenen
// wie im Isabel-Tutorial, hier inline in der Doku statt als Vollbild-Overlay.
// Destillat von ChartCinema.tsx: Holodeck-Bühne, Beat-Kamerafahrten, Isabel-Actor,
// klickbare Hotspots, Aufbau-Reveal, adaptiver Render-Loop. Lazy: erst der Klick auf
// das Poster lädt three + Szene; nur eine Szene läuft gleichzeitig (dispose beim Wechsel).
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CinemaChartId } from "../../components/tutorial/types.ts";
import { loadIsabel, type IsabelActor } from "../../components/tutorial/cinema/isabelActor.ts";
import { getScene } from "../../components/tutorial/cinema/scenes/index.ts";
import { v3, type CinemaScene } from "../../components/tutorial/cinema/sceneKit.ts";

const ease = (u: number) => u * u * (3 - 2 * u);
const motionOk = (): boolean => !matchMedia("(prefers-reduced-motion: reduce)").matches;

type Tween = { fromP: THREE.Vector3; toP: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number; dur: number };

function makeHalo(): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  g.addColorStop(0, "rgba(94, 234, 212, 0.95)");
  g.addColorStop(0.4, "rgba(45, 212, 191, 0.35)");
  g.addColorStop(1, "rgba(45, 212, 191, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  spr.scale.setScalar(0.55);
  spr.renderOrder = 15;
  return spr;
}

function setEmissivePulse(obj: THREE.Object3D | null, elapsed: number, active: boolean): void {
  if (!obj) return;
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m?.emissive) m.emissiveIntensity = active ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(elapsed * 5)) : 0.35;
  });
}

class KinoInstance {
  private renderer!: THREE.WebGLRenderer;
  private scene3!: THREE.Scene;
  private cam!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private group!: THREE.Group;
  private actor: IsabelActor | null = null;
  private hotspots: THREE.Mesh[] = [];
  private halos: THREE.Sprite[] = [];
  private highlightObj: THREE.Object3D | null = null;
  private tween: Tween | null = null;
  private reveal: { plane: THREE.Plane; sprites: THREE.SpriteMaterial[]; t: number } | null = null;
  private clock = new THREE.Clock();
  private raf = 0;
  private frame = 0;
  private activeUntil = 0;
  private disposed = false;
  private beatIdx = 0;
  private firstTween = true;
  private ro!: ResizeObserver;

  constructor(
    private scene: CinemaScene,
    private stage: HTMLElement,
    private canvasWrap: HTMLElement,
    private hud: { no: HTMLElement; title: HTMLElement; text: HTMLElement; prev: HTMLButtonElement; next: HTMLButtonElement },
  ) {}

  start(): void {
    const el = this.canvasWrap;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.renderer.domElement.className = "kino-canvas";
    el.appendChild(this.renderer.domElement);

    this.scene3 = new THREE.Scene();
    this.scene3.background = new THREE.Color(0x0d1526);
    this.scene3.fog = new THREE.Fog(0x0d1526, 10, 22);
    this.cam = new THREE.PerspectiveCamera(38, el.clientWidth / el.clientHeight, 0.1, 80);
    if (motionOk()) {
      const look0 = v3(this.scene.beats[0].look);
      const start = v3(this.scene.beats[0].cam).sub(look0).multiplyScalar(1.9).add(look0);
      start.y += 1.6;
      this.cam.position.copy(start);
    } else {
      this.cam.position.set(...this.scene.beats[0].cam);
    }

    // Holodeck-Bühne (identisch zum Tutorial-Kino)
    this.scene3.add(new THREE.GridHelper(26, 52, 0x22314f, 0x141f38));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(5.4, 48), new THREE.MeshStandardMaterial({ color: 0x111c33, roughness: 0.95 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.005;
    this.scene3.add(disc);
    this.scene3.add(new THREE.AmbientLight(0xffffff, 0.4));
    this.scene3.add(new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(3, 6, 4);
    this.scene3.add(key);
    const rim = new THREE.DirectionalLight(0x2dd4bf, 0.4);
    rim.position.set(-4, 3, -3);
    this.scene3.add(rim);

    this.group = new THREE.Group();
    this.scene.build(this.group);
    this.hotspots = this.scene.hotspots.map((h, i) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 14, 14),
        new THREE.MeshStandardMaterial({ color: 0x5eead4, emissive: 0x2dd4bf, emissiveIntensity: 1.0 }),
      );
      m.position.set(...h.pos);
      m.userData.beat = h.beat;
      m.userData.hotspot = i;
      this.group.add(m);
      const halo = makeHalo();
      halo.position.set(...h.pos);
      halo.userData.hotspot = i;
      this.group.add(halo);
      this.halos.push(halo);
      return m;
    });
    this.scene3.add(this.group);

    if (motionOk()) {
      const plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), -3.6);
      const sprites: THREE.SpriteMaterial[] = [];
      this.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const mat of mats) {
          if ((mat as THREE.SpriteMaterial).isSpriteMaterial) {
            (mat as THREE.SpriteMaterial).opacity = 0;
            sprites.push(mat as THREE.SpriteMaterial);
          } else {
            (mat as THREE.Material).clippingPlanes = [plane];
          }
        }
      });
      this.renderer.localClippingEnabled = true;
      this.reveal = { plane, sprites, t: 0 };
    }

    this.controls = new OrbitControls(this.cam, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 16;
    this.controls.minDistance = 1.4;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.target.set(...this.scene.beats[0].look);
    this.controls.addEventListener("change", () => this.bump(1.2));

    loadIsabel()
      .then((actor) => {
        if (this.disposed) return;
        this.actor = actor;
        actor.teleport(new THREE.Vector3(3.5, 0, 1.4), new THREE.Vector3(3.5, 0, 7));
        actor.play("Idle");
        this.scene3.add(actor.root);
        this.applyBeat(0);
      })
      .catch(() => {
        // Ohne Isabel trotzdem zeigen — Szene + Beats funktionieren auch ohne Actor.
        if (!this.disposed) this.applyBeat(0);
      });

    // Hotspot-Klick + Hover-Cursor
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (ev: PointerEvent): THREE.Mesh | null => {
      const r = this.renderer.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.cam);
      const hit = ray.intersectObjects(this.hotspots, false)[0];
      return (hit?.object as THREE.Mesh) ?? null;
    };
    this.renderer.domElement.addEventListener("pointerdown", (ev) => {
      const h = pick(ev);
      if (h) this.applyBeat(h.userData.beat as number);
    });
    this.renderer.domElement.addEventListener("pointermove", (ev) => {
      this.renderer.domElement.style.cursor = pick(ev) ? "pointer" : "grab";
    });

    this.ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h);
      this.cam.aspect = w / h;
      this.cam.updateProjectionMatrix();
    });
    this.ro.observe(el);

    this.hud.prev.addEventListener("click", () => this.applyBeat(this.beatIdx - 1));
    this.hud.next.addEventListener("click", () => this.applyBeat(this.beatIdx + 1));

    this.activeUntil = performance.now() / 1000 + 3;
    this.loop();
  }

  private bump(sec: number): void {
    this.activeUntil = Math.max(this.activeUntil, performance.now() / 1000 + sec);
  }

  private applyBeat(idx: number): void {
    const beats = this.scene.beats;
    this.beatIdx = Math.max(0, Math.min(beats.length - 1, idx));
    const beat = beats[this.beatIdx];
    const motion = motionOk();
    this.bump(beat.isabel?.kind === "path" ? beat.isabel.dur + 3 : 6);

    this.controls.enabled = false;
    const dur = !motion ? 0 : this.firstTween ? 2.4 : 1.4;
    this.firstTween = false;
    this.tween = { fromP: this.cam.position.clone(), toP: v3(beat.cam), fromT: this.controls.target.clone(), toT: v3(beat.look), t: 0, dur };

    setEmissivePulse(this.highlightObj, 0, false);
    this.highlightObj = beat.highlight ? this.group.getObjectByName(beat.highlight) ?? null : null;

    const act = this.actor;
    const isa = beat.isabel;
    if (act && isa) {
      if (isa.kind === "pose") {
        if (isa.at) act.teleport(v3(isa.at));
        if (isa.faceTo) act.face(v3(isa.faceTo));
        act.play(isa.clip);
      } else if (isa.kind === "walk") {
        const finish = () => { if (isa.faceTo) act.face(v3(isa.faceTo)); act.play(isa.then ?? "Idle"); };
        if (motion) act.walkTo(v3(isa.to), isa.run).then(() => { if (!this.disposed) finish(); });
        else { act.teleport(v3(isa.to)); finish(); }
      } else if (isa.kind === "path" && this.scene.runPath?.length) {
        if (motion) act.followPath(this.scene.runPath.map(v3), isa.dur);
        else act.teleport(v3(this.scene.runPath[this.scene.runPath.length - 1]));
      }
    }

    this.hud.no.textContent = `Beat ${this.beatIdx + 1} / ${beats.length}`;
    this.hud.title.textContent = beat.title;
    this.hud.text.textContent = beat.text;
    this.hud.prev.disabled = this.beatIdx === 0;
    this.hud.next.disabled = this.beatIdx === beats.length - 1;
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.frame++;
    const busy = !!this.tween || !!this.reveal || !!this.actor?.busy;
    const active = busy || performance.now() / 1000 < this.activeUntil;
    if (!active && this.frame % 2 === 1) return;
    const dt = Math.min(this.clock.getDelta(), 0.12);
    const elapsed = this.clock.elapsedTime;
    this.actor?.update(dt);
    if (this.reveal) {
      this.reveal.t = Math.min(1, this.reveal.t + dt / 1.1);
      this.reveal.plane.constant = -3.6 + ease(this.reveal.t) * 7.8;
      for (const sm of this.reveal.sprites) sm.opacity = this.reveal.t;
      if (this.reveal.t >= 1) {
        this.group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
          for (const mat of mats) if (!(mat as THREE.SpriteMaterial).isSpriteMaterial) (mat as THREE.Material).clippingPlanes = null;
        });
        this.renderer.localClippingEnabled = false;
        this.reveal = null;
      }
    }
    if (this.tween) {
      this.tween.t = Math.min(1, this.tween.t + (this.tween.dur > 0 ? dt / this.tween.dur : 1));
      const u = ease(this.tween.t);
      this.cam.position.lerpVectors(this.tween.fromP, this.tween.toP, u);
      this.controls.target.lerpVectors(this.tween.fromT, this.tween.toT, u);
      if (this.tween.t >= 1) { this.tween = null; this.controls.enabled = true; }
    }
    this.controls.update();
    setEmissivePulse(this.highlightObj, elapsed, true);
    for (const h of this.hotspots) h.scale.setScalar(1 + 0.22 * Math.sin(elapsed * 3 + (h.userData.hotspot as number)));
    for (const halo of this.halos) halo.scale.setScalar(0.55 + 0.16 * Math.sin(elapsed * 3 + (halo.userData.hotspot as number)));
    this.renderer.render(this.scene3, this.cam);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    if (this.actor) this.scene3.remove(this.actor.root); // Actor bleibt global gecacht
    this.controls.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats as (THREE.Material & { map?: THREE.Texture })[]) {
        mat.map?.dispose?.();
        mat.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

let activeKino: { el: HTMLElement; inst: KinoInstance } | null = null;

function closeActive(): void {
  if (!activeKino) return;
  activeKino.inst.dispose();
  activeKino.el.classList.remove("open");
  activeKino.el.querySelector(".kino-stage")?.remove();
  activeKino = null;
}

function openKino(box: HTMLElement, chartId: CinemaChartId): void {
  closeActive();
  const scene = getScene(chartId);
  if (!scene) return;

  const stage = document.createElement("div");
  stage.className = "kino-stage";
  stage.innerHTML = `
    <button class="kino-close" title="Szene schließen" aria-label="Szene schließen">✕</button>
    <div class="kino-canvas-wrap"></div>
    <div class="kino-hud">
      <div class="beat">
        <span class="b-no"></span>
        <div class="b-title"></div>
        <p class="b-text"></p>
      </div>
      <div class="k-nav">
        <button class="k-prev" title="Voriger Beat" aria-label="Voriger Beat">←</button>
        <button class="k-next" title="Nächster Beat" aria-label="Nächster Beat">→</button>
      </div>
    </div>`;
  box.appendChild(stage);
  box.classList.add("open");

  const canvasWrap = stage.querySelector<HTMLElement>(".kino-canvas-wrap")!;
  canvasWrap.style.height = "min(62vh, 520px)";
  const inst = new KinoInstance(scene, stage, canvasWrap, {
    no: stage.querySelector(".b-no")!,
    title: stage.querySelector(".b-title")!,
    text: stage.querySelector(".b-text")!,
    prev: stage.querySelector<HTMLButtonElement>(".k-prev")!,
    next: stage.querySelector<HTMLButtonElement>(".k-next")!,
  });
  stage.querySelector<HTMLButtonElement>(".kino-close")!.addEventListener("click", closeActive);
  activeKino = { el: box, inst };
  inst.start();
}

/** Öffnet die Kino-Szene einer .kino-Box (wird von main.ts lazy importiert und aufgerufen). */
export function openKinoBox(box: HTMLElement): void {
  const webgl = (() => {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch { return false; }
  })();
  const poster = box.querySelector<HTMLElement>(".kino-poster");
  if (!webgl) {
    if (poster) {
      poster.style.cursor = "default";
      const btn = poster.querySelector(".k-btn");
      if (btn) btn.textContent = "3D nicht verfügbar (WebGL fehlt) — die Erklärung steht im Text oben.";
    }
    return;
  }
  openKino(box, box.dataset.chart as CinemaChartId);
}
