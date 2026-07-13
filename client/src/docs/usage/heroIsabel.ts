// Hero-3D der Anleitung: Isabel joggt auf der Stelle, Kamera umkreist sie langsam.
// Rein dekorativ (keine Interaktion, kein Text) — lädt erst im Leerlauf, pausiert
// außerhalb des Viewports, entfällt komplett bei reduced-motion oder ohne WebGL.
// Eigene Actor-Instanz (statt loadIsabel-Cache), damit das Kino sie nicht „stiehlt".
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { IsabelActor } from "../../components/tutorial/cinema/isabelActor.ts";

export function initHeroIsabel(): void {
  const mount = document.querySelector<HTMLElement>(".hero-3d");
  if (!mount) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    const c = document.createElement("canvas");
    if (!c.getContext("webgl2") && !c.getContext("webgl")) return;
  } catch { return; }

  const boot = () => {
    new GLTFLoader().loadAsync("/assets/isabel.glb").then((gltf) => {
      const actor = new IsabelActor(gltf.scene, gltf.animations);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.8);
      scene.add(hemi);
      const key = new THREE.DirectionalLight(0xffffff, 1.1);
      key.position.set(2.5, 4, 3);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x2dd4bf, 0.5);
      rim.position.set(-3, 2, -2);
      scene.add(rim);

      actor.teleport(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.6, 0, 3));
      actor.play("Run");
      scene.add(actor.root);

      const cam = new THREE.PerspectiveCamera(34, mount.clientWidth / Math.max(1, mount.clientHeight), 0.1, 30);
      const clock = new THREE.Clock();
      let visible = true;
      let raf = 0;

      const loop = () => {
        raf = requestAnimationFrame(loop);
        if (!visible || document.hidden) return;
        const dt = Math.min(clock.getDelta(), 0.1);
        const t = clock.elapsedTime;
        actor.update(dt);
        const a = t * 0.16;
        cam.position.set(Math.sin(a) * 3.4, 1.35 + Math.sin(t * 0.4) * 0.06, Math.cos(a) * 3.4);
        cam.lookAt(0, 0.85, 0);
        renderer.render(scene, cam);
      };

      new ResizeObserver(() => {
        const w = mount.clientWidth, h = mount.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h);
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
      }).observe(mount);
      new IntersectionObserver((es) => { visible = es[0]?.isIntersecting ?? true; }).observe(mount);

      loop();
      window.addEventListener("pagehide", () => cancelAnimationFrame(raf), { once: true });
    }).catch(() => { /* Hero bleibt ohne 3D — kein Fehlerzustand nötig */ });
  };

  boot(); // main.ts importiert dieses Modul bereits im Leerlauf — kein weiteres Deferral nötig
}
