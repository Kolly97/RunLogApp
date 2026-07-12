// Chart-Kino (v2.11.0): Vollbild-3D-Szene, in der Isabel (GLTF) ein echtes Diagramm Beat für Beat erklärt.
// Layout: Canvas oben (Holodeck-Bühne), Tutorial-Karte unten (Beat-Text + Navigation + Beat-Punkte).
// Kamera: Autopilot-Fahrt je Beat, dazwischen frei orbitierbar („Weiter" übernimmt wieder). Hotspots sind
// klickbare Leuchtpunkte (springen zum passenden Beat); Ausrufe hängen als projizierte Blase an Isabels Kopf.
// Reduced Motion: harte Schnitte statt Fahrten, Isabel teleportiert und posiert statt zu laufen.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { motionEnabled } from "../../../lib/motion.ts";
import type { CinemaChartId } from "../types.ts";
import { CARD, IsabelHead, OverlayPortal } from "../ui.tsx";
import { loadIsabel, type IsabelActor } from "./isabelActor.ts";
import { CINEMA_META } from "./meta.ts";
import { getScene } from "./scenes/index.ts";
import { v3, type CinemaScene } from "./sceneKit.ts";

type Tween = { fromP: THREE.Vector3; toP: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number; dur: number };
type Reveal = { plane: THREE.Plane; sprites: THREE.SpriteMaterial[]; t: number };

type World = {
  renderer: THREE.WebGLRenderer;
  scene3: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group: THREE.Group;
  actor: IsabelActor | null;
  hotspots: THREE.Mesh[];
  halos: THREE.Sprite[];
  highlightObj: THREE.Object3D | null;
  tween: Tween | null;
  reveal: Reveal | null;      // Aufbau-Animation: Clipping-Plane wandert links → rechts
  activeUntil: number;        // adaptiver Loop: bis dahin volle Bildrate, danach ~30 fps
  autoLow: boolean;           // Auto-Detect hat auf Low geschaltet
  frame: number;
  clock: THREE.Clock;
  raf: number;
  disposed: boolean;
};

const ease = (u: number) => u * u * (3 - 2 * u); // smoothstep

type Quality = "auto" | "high" | "low";
const QUALITY_KEY = "runlog-cinema-quality";
const QUALITY_LABEL: Record<Quality, string> = { auto: "Auto", high: "Hoch", low: "Niedrig" };
const readQuality = (): Quality => {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    return v === "high" || v === "low" ? v : "auto";
  } catch { return "auto"; }
};

/** Low-Preset anwenden: halbe Auflösung + Glüh-Halos aus (größter Kostenpunkt zuerst). */
function applyQuality(w: World, el: HTMLElement, low: boolean): void {
  w.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 2));
  w.renderer.setSize(el.clientWidth, el.clientHeight);
  for (const h of w.halos) h.visible = !low;
}

/** Weicher Glüh-Halo (Radialgradient) für Hotspots — additiv, billig, gut sichtbar. */
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
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
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

export default function ChartCinema({ chart, stepInfo, onDone, onClose, doneLabel }: {
  chart: CinemaChartId;
  stepInfo: string;
  onDone: () => void;
  onClose: () => void;
  doneLabel?: string;
}) {
  const scene: CinemaScene | null = getScene(chart);
  const wrap = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const world = useRef<World | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [beatIdx, setBeatIdx] = useState(0);
  const firstTween = useRef(true); // Einfahrt: die allererste Kamerafahrt ist die langsame Establisher-Fahrt
  const [exclaim, setExclaim] = useState<string | null>(null);
  const [sandboxVal, setSandboxVal] = useState(0);
  const [sandboxNote, setSandboxNote] = useState("");
  // Qualitäts-Preset (K3): Auto erkennt zähe GPUs selbst; ⚙ übersteuert manuell (persistiert).
  const [quality, setQualityState] = useState<Quality>(readQuality);
  const qualityRef = useRef<Quality>(quality);
  const cycleQuality = () => {
    const next: Quality = quality === "auto" ? "high" : quality === "high" ? "low" : "auto";
    setQualityState(next);
    qualityRef.current = next;
    try { localStorage.setItem(QUALITY_KEY, next); } catch { /* ohne Persistenz weiter */ }
    const w = world.current;
    if (w && wrap.current) applyQuality(w, wrap.current, next === "low" || (next === "auto" && w.autoLow));
  };

  // ---- Welt aufbauen (einmal je Chart) ----
  useEffect(() => {
    const el = wrap.current;
    if (!el || !scene) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    const scene3 = new THREE.Scene();
    scene3.background = new THREE.Color(0x0d1526);
    scene3.fog = new THREE.Fog(0x0d1526, 10, 22);
    const cam = new THREE.PerspectiveCamera(38, el.clientWidth / el.clientHeight, 0.1, 80);
    // Kamera-Einfahrt: Start weiter draußen + erhöht; der erste Beat fährt langsam auf Position (nur mit Animationen).
    if (motionEnabled()) {
      const look0 = v3(scene.beats[0].look);
      const start = v3(scene.beats[0].cam).sub(look0).multiplyScalar(1.9).add(look0);
      start.y += 1.6;
      cam.position.copy(start);
    } else {
      cam.position.set(...scene.beats[0].cam);
    }

    // Holodeck: Grid + Bühnenscheibe + Licht (Hemi kühl/warm, Key, Teal-Rim — wie die Isabel-Szenen)
    const grid = new THREE.GridHelper(26, 52, 0x22314f, 0x141f38);
    grid.position.y = 0;
    scene3.add(grid);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(5.4, 48), new THREE.MeshStandardMaterial({ color: 0x111c33, roughness: 0.95 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.005;
    scene3.add(disc);
    scene3.add(new THREE.AmbientLight(0xffffff, 0.4));
    scene3.add(new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(3, 6, 4);
    scene3.add(key);
    const rim = new THREE.DirectionalLight(0x2dd4bf, 0.4);
    rim.position.set(-4, 3, -3);
    scene3.add(rim);

    const group = new THREE.Group();
    scene.build(group);
    // Hotspots (K3): größere Kugel + Glüh-Halo. Bewusst OHNE eigenes Label — die Szenen beschriften ihre
    // Stellen selbst (heute/Renntag/krank/…); ein zweites Label am Leuchtpunkt war doppelt (Kolja-Befund).
    const halos: THREE.Sprite[] = [];
    const hotspots: THREE.Mesh[] = scene.hotspots.map((h, i) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 14, 14),
        new THREE.MeshStandardMaterial({ color: 0x5eead4, emissive: 0x2dd4bf, emissiveIntensity: 1.0 }),
      );
      m.position.set(...h.pos);
      m.userData.beat = h.beat;
      m.userData.hotspot = i;
      group.add(m);
      const halo = makeHalo();
      halo.position.set(...h.pos);
      halo.userData.hotspot = i;
      group.add(halo);
      halos.push(halo);
      return m;
    });
    scene3.add(group);

    // Aufbau-Reveal (K3): Chart wächst von links nach rechts — Clipping-Plane nur auf Chart-Materialien,
    // Sprites (Labels/Halos) faden parallel per Opacity (Schnittkanten durch Buchstaben wären hässlich).
    let reveal: Reveal | null = null;
    if (motionEnabled()) {
      const plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), -3.6); // sichtbar, wo x ≤ Konstante
      const revealSprites: THREE.SpriteMaterial[] = [];
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const mat of mats) {
          if ((mat as THREE.SpriteMaterial).isSpriteMaterial) {
            const sm = mat as THREE.SpriteMaterial;
            sm.opacity = 0;
            revealSprites.push(sm);
          } else {
            (mat as THREE.Material).clippingPlanes = [plane];
          }
        }
      });
      renderer.localClippingEnabled = true;
      reveal = { plane, sprites: revealSprites, t: 0 };
    }

    const controls = new OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxDistance = 16;
    controls.minDistance = 1.4;
    controls.maxPolarAngle = Math.PI * 0.52; // nicht unter den Boden
    controls.target.set(...scene.beats[0].look);

    const w: World = {
      renderer, scene3, cam, controls, actor: null, group, hotspots, halos, highlightObj: null,
      tween: null, reveal, activeUntil: performance.now() / 1000 + 3, autoLow: false, frame: 0,
      clock: new THREE.Clock(), raf: 0, disposed: false,
    };
    world.current = w;
    const bump = (sec: number) => { w.activeUntil = Math.max(w.activeUntil, performance.now() / 1000 + sec); };
    controls.addEventListener("change", () => bump(1.2)); // Orbit/Damping hält die volle Bildrate
    if (qualityRef.current === "low") applyQuality(w, el, true);

    loadIsabel()
      .then((actor) => {
        if (w.disposed) return;
        w.actor = actor;
        actor.teleport(new THREE.Vector3(3.5, 0, 1.4), new THREE.Vector3(3.5, 0, 7));
        actor.play("Idle");
        scene3.add(actor.root);
        setStatus("ready");
      })
      .catch(() => { if (!w.disposed) setStatus("error"); });

    // Interaktion: Hotspot-Klick + Hover-Cursor (Raycast)
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (ev: PointerEvent): THREE.Mesh | null => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, cam);
      const hit = ray.intersectObjects(hotspots, false)[0];
      return (hit?.object as THREE.Mesh) ?? null;
    };
    const onClick = (ev: PointerEvent) => { const h = pick(ev); if (h) setBeatIdx(h.userData.beat as number); };
    const onMove = (ev: PointerEvent) => { renderer.domElement.style.cursor = pick(ev) ? "pointer" : "grab"; };
    renderer.domElement.addEventListener("pointerdown", onClick);
    renderer.domElement.addEventListener("pointermove", onMove);

    const onResize = () => {
      const width = el.clientWidth, height = el.clientHeight;
      renderer.setSize(width, height);
      cam.aspect = width / height;
      cam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);

    // ---- Render-Loop (K3: adaptiv — volle Bildrate nur bei Aktivität, sonst ~30 fps) ----
    const headPos = new THREE.Vector3();
    let slowFrames = 0;
    const loop = () => {
      if (w.disposed) return;
      w.raf = requestAnimationFrame(loop);
      w.frame++;
      const busy = !!w.tween || !!w.reveal || !!w.actor?.busy;
      const active = busy || performance.now() / 1000 < w.activeUntil;
      if (!active && w.frame % 2 === 1) return; // Ruhe-Modus: jeden 2. Frame (dt akkumuliert im Clock)
      const dt = Math.min(w.clock.getDelta(), 0.12);
      const elapsed = w.clock.elapsedTime;
      // Auto-Detect (Startphase): dauerhaft zähe aktive Frames → Low-Preset, einmalig
      if (!w.autoLow && w.frame > 10 && w.frame <= 120 && active && dt > 0.034) {
        if (++slowFrames > 18) { w.autoLow = true; if (qualityRef.current === "auto") applyQuality(w, el, true); }
      }
      w.actor?.update(dt);
      // Aufbau-Reveal: Schnittkante wandert, Labels faden mit; am Ende Clipping wieder abbauen (Perf)
      if (w.reveal) {
        w.reveal.t = Math.min(1, w.reveal.t + dt / 1.1);
        w.reveal.plane.constant = -3.6 + ease(w.reveal.t) * 7.8;
        for (const sm of w.reveal.sprites) sm.opacity = w.reveal.t;
        if (w.reveal.t >= 1) {
          group.traverse((o) => {
            const mesh = o as THREE.Mesh;
            const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
            for (const mat of mats) if (!(mat as THREE.SpriteMaterial).isSpriteMaterial) (mat as THREE.Material).clippingPlanes = null;
          });
          renderer.localClippingEnabled = false;
          w.reveal = null;
        }
      }
      if (w.tween) {
        w.tween.t = Math.min(1, w.tween.t + (w.tween.dur > 0 ? dt / w.tween.dur : 1));
        const u = ease(w.tween.t);
        cam.position.lerpVectors(w.tween.fromP, w.tween.toP, u);
        controls.target.lerpVectors(w.tween.fromT, w.tween.toT, u);
        if (w.tween.t >= 1) { w.tween = null; controls.enabled = true; }
      }
      controls.update();
      setEmissivePulse(w.highlightObj, elapsed, true);
      for (const h of w.hotspots) h.scale.setScalar(1 + 0.22 * Math.sin(elapsed * 3 + (h.userData.hotspot as number)));
      for (const halo of w.halos) halo.scale.setScalar(0.55 + 0.16 * Math.sin(elapsed * 3 + (halo.userData.hotspot as number)));
      // Ausruf-Blase an Isabels Kopf (Projektion → CSS-Transform, kein React-State pro Frame)
      if (bubble.current && w.actor) {
        const p = w.actor.headWorldPos(headPos).clone().add(new THREE.Vector3(0, 0.32, 0)).project(cam);
        const visible = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
        bubble.current.style.opacity = visible ? "1" : "0";
        bubble.current.style.transform = `translate(-50%, -100%) translate(${((p.x + 1) / 2) * el.clientWidth}px, ${((1 - p.y) / 2) * el.clientHeight}px)`;
      }
      renderer.render(scene3, cam);
    };
    loop();

    return () => {
      w.disposed = true;
      cancelAnimationFrame(w.raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onClick);
      renderer.domElement.removeEventListener("pointermove", onMove);
      if (w.actor) scene3.remove(w.actor.root); // Actor bleibt global gecacht — nur aus der Szene nehmen
      controls.dispose();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats as (THREE.Material & { map?: THREE.Texture })[]) {
          mat.map?.dispose?.(); // Canvas-Texturen der Labels/Halos
          mat.dispose();
        }
      });
      renderer.dispose();
      el.removeChild(renderer.domElement);
      world.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart]);

  // ---- Beat anwenden: Kamera-Fahrt, Isabel-Aktion, Highlight, Ausruf ----
  useEffect(() => {
    const w = world.current;
    if (!w || !scene || status !== "ready") return;
    const beat = scene.beats[beatIdx];
    const motion = motionEnabled();
    // Aktivitäts-Fenster für den adaptiven Loop (Kamerafahrt + Isabel-Weg abdecken)
    w.activeUntil = Math.max(w.activeUntil, performance.now() / 1000 + (beat.isabel?.kind === "path" ? beat.isabel.dur + 3 : 6));
    // Kamera (erste Fahrt = langsame Einfahrt von der Establisher-Position)
    w.controls.enabled = false;
    const dur = !motion ? 0 : firstTween.current ? 2.4 : 1.4;
    firstTween.current = false;
    w.tween = { fromP: w.cam.position.clone(), toP: v3(beat.cam), fromT: w.controls.target.clone(), toT: v3(beat.look), t: 0, dur };
    // Highlight umschalten (altes zurücksetzen)
    setEmissivePulse(w.highlightObj, 0, false);
    w.highlightObj = beat.highlight ? w.group.getObjectByName(beat.highlight) ?? null : null;
    // Isabel
    const act = w.actor;
    const isa = beat.isabel;
    if (act && isa) {
      if (isa.kind === "pose") {
        if (isa.at) act.teleport(v3(isa.at));
        if (isa.faceTo) act.face(v3(isa.faceTo));
        act.play(isa.clip);
      } else if (isa.kind === "walk") {
        const finish = () => { if (isa.faceTo) act.face(v3(isa.faceTo)); act.play(isa.then ?? "Idle"); };
        if (motion) act.walkTo(v3(isa.to), isa.run).then(() => { if (!w.disposed) finish(); });
        else { act.teleport(v3(isa.to)); finish(); }
      } else if (isa.kind === "path" && scene.runPath?.length) {
        if (motion) act.followPath(scene.runPath.map(v3), isa.dur);
        else act.teleport(v3(scene.runPath[scene.runPath.length - 1]));
      }
    }
    // Ausruf
    setExclaim(beat.exclaim ?? null);
    if (beat.exclaim) {
      const t = window.setTimeout(() => setExclaim(null), 3200);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatIdx, status]);

  if (!scene) return null;
  const beat = scene.beats[beatIdx];
  const last = beatIdx === scene.beats.length - 1;

  return (
    <OverlayPortal>
    <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "#0d1526", display: "flex", flexDirection: "column" }}>
      <div ref={wrap} style={{ flex: 1, minHeight: 0, position: "relative", touchAction: "none" }}>
        {status === "loading" && (
          <div className="tiny muted" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", zIndex: 2 }}>
            Isabel betritt die Bühne… (3D-Modell lädt)
          </div>
        )}
        {status === "error" && (
          <div className="tiny" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 10, alignItems: "center", justifyContent: "center", color: "#e2e8f0", zIndex: 2 }}>
            <span>Das 3D-Modell konnte nicht geladen werden (assets/isabel.glb fehlt oder ist defekt).</span>
            <button className="sm ghost" onClick={onClose}>Schließen</button>
          </div>
        )}
        <div ref={bubble} style={{ position: "absolute", top: 0, left: 0, opacity: 0, transition: "opacity .2s", pointerEvents: "none", zIndex: 3, background: "#f8fafc", color: "#0f172a", fontSize: 12.5, fontWeight: 700, padding: "4px 10px", borderRadius: 10, whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(0,0,0,0.35)" }}>
          {exclaim ?? ""}
        </div>
        <span className="tiny" style={{ position: "absolute", top: 10, right: 14, color: "#64748b", zIndex: 2, display: "flex", alignItems: "center", gap: 12 }}>
          🖱 ziehen = drehen · scrollen = zoomen · Leuchtpunkte sind klickbar
          <button onClick={cycleQuality} title="Render-Qualität (Auto erkennt schwache GPUs selbst)"
            style={{ background: "rgba(148,163,184,0.12)", border: "1px solid rgba(148,163,184,0.3)", color: "#94a3b8", borderRadius: 8, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>
            ⚙ {QUALITY_LABEL[quality]}
          </button>
        </span>
      </div>

      <div style={{ ...CARD, width: "min(880px, 96vw)", margin: "0 auto 14px", flexShrink: 0 }}>
        <div className="spread" style={{ alignItems: "flex-start" }}>
          <IsabelHead sub={`${stepInfo} · ${CINEMA_META[chart]?.icon ?? "🎬"} ${CINEMA_META[chart]?.label ?? chart}`} />
          <span className="row" style={{ gap: 5, marginTop: 4 }}>
            {scene.beats.map((_, i) => (
              <button key={i} onClick={() => setBeatIdx(i)} title={`Beat ${i + 1}`}
                style={{ width: 9, height: 9, borderRadius: 999, border: "none", cursor: "pointer", padding: 0, background: i === beatIdx ? "var(--accent, #0ea5e9)" : i < beatIdx ? "#475569" : "var(--border, #e3e8ef)" }} />
            ))}
          </span>
        </div>
        <strong style={{ fontSize: 14 }}>{beat.title}</strong>
        <p className="tiny" style={{ margin: "6px 0 10px", lineHeight: 1.55 }}>{beat.text}</p>
        {beat.sandbox && scene.applySandbox && (
          <div style={{ margin: "0 0 10px", padding: "8px 10px", borderRadius: 8, background: "var(--surface2, rgba(148,163,184,0.1))" }}>
            <label className="tiny" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ whiteSpace: "nowrap", fontWeight: 700 }}>Extra-Last je Woche bis zum Rennen</span>
              <input type="range" min={0} max={100} value={sandboxVal} style={{ flex: 1 }}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSandboxVal(v);
                  const wld = world.current;
                  if (wld && scene.applySandbox) {
                    setSandboxNote(scene.applySandbox(wld.group, v / 100));
                    wld.activeUntil = Math.max(wld.activeUntil, performance.now() / 1000 + 2.5);
                  }
                }} />
              <span className="muted" style={{ whiteSpace: "nowrap" }}>+{Math.round(sandboxVal * 2.6)} TSS/Wo</span>
            </label>
            {sandboxNote && <p className="tiny muted" style={{ margin: "6px 0 0", lineHeight: 1.45 }}>{sandboxNote}</p>}
          </div>
        )}
        <div className="spread">
          <button className="sm ghost" onClick={onClose}>{doneLabel ? "Schließen" : "Pause"}</button>
          <span className="row" style={{ gap: 6 }}>
            {beatIdx > 0 && <button className="sm ghost" onClick={() => setBeatIdx(beatIdx - 1)}>Zurück</button>}
            {last
              ? <button className="sm primary" onClick={onDone}>{doneLabel ?? "Szene abschließen ✓"}</button>
              : <button className="sm primary" onClick={() => setBeatIdx(beatIdx + 1)} disabled={status !== "ready"}>Weiter</button>}
          </span>
        </div>
      </div>
    </div>
    </OverlayPortal>
  );
}
