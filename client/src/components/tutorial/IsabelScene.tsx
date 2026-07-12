// Isabel-3D-Moment (v2.11.0 K3): Abschluss-Szenen nutzen jetzt DIESELBE GLTF-Isabel wie das Chart-Kino
// (geteilter Actor-Cache aus cinema/isabelActor). Die Bahn bleibt der Erzähl-Ort (Finale = Zieleinlauf),
// das Licht ist ans Holodeck angeglichen. Lazy geladen; GLB-Ladefehler → Szene zeigt nur die Bahn (kein
// Blocker). Respektiert den globalen Animationen-Schalter: aus → statische Pose, ein Render.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { motionEnabled } from "../../lib/motion.ts";
import { loadIsabel, type IsabelActor } from "./cinema/isabelActor.ts";

const H = 210;

export default function IsabelScene({ finale = false }: { finale?: boolean }) {
  const mount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    const w = el.clientWidth || 480;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, H);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(38, w / H, 0.1, 60);
    cam.position.set(0, 1.35, 5.4);
    cam.lookAt(0, 0.85, 0);

    // Licht: Holodeck-Stimmung (Hemi kühl/warm + Key + Teal-Rim) — eine Lichtsprache mit dem Kino.
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    scene.add(new THREE.HemisphereLight(0xdbeafe, 0xb45309, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2.5, 4, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x2dd4bf, 0.45);
    rim.position.set(-3, 2, -2);
    scene.add(rim);

    const mats: THREE.Material[] = [];
    const mat = (m: THREE.Material) => { mats.push(m); return m; };

    // Bahn: flacher Ring mit Markierungslinie (der Erzähl-Ort bleibt).
    const track = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.4, 0.06, 48),
      mat(new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.95 })),
    );
    track.position.y = -0.03;
    scene.add(track);
    const line = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.012, 6, 64), mat(new THREE.MeshBasicMaterial({ color: 0xf8fafc })));
    line.rotation.x = Math.PI / 2;
    line.position.y = 0.032;
    scene.add(line);

    // Kontaktschatten unter Isabel (Politur aus Etappe C).
    const shadowMat = mat(new THREE.MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.2 })) as THREE.MeshBasicMaterial;
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.04, 2.6);
    scene.add(shadow);

    // Finale: Zielbogen (zwei Pfosten + Banner mit Schachbrett-Feldern).
    if (finale) {
      const postMat = mat(new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }));
      for (const px of [-1.25, 1.25]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.2, 10), postMat);
        post.position.set(px, 1.1, 1.85);
        scene.add(post);
      }
      const banner = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.34, 0.05), mat(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 })));
      banner.position.set(0, 2.05, 1.85);
      scene.add(banner);
      const dark = mat(new THREE.MeshBasicMaterial({ color: 0x0f172a }));
      const light = mat(new THREE.MeshBasicMaterial({ color: 0xf8fafc }));
      for (let i = 0; i < 12; i++) {
        for (let row = 0; row < 2; row++) {
          const cell = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.052), (i + row) % 2 ? dark : light);
          cell.position.set(-1.1 + i * 0.2, 2.11 - row * 0.13, 1.852);
          scene.add(cell);
        }
      }
    }

    const animate = motionEnabled();
    let actor: IsabelActor | null = null;
    let disposed = false;
    let frame = 0;
    let t = 0;

    const render = () => {
      const dt = 0.016;
      if (actor) {
        actor.update(dt);
        if (finale) {
          // Jubel vor dem Zielbogen: Wave-Clip + leichtes Freuden-Hüpfen.
          const hop = animate ? Math.abs(Math.sin(t * 2.6)) : 0;
          actor.root.position.set(0, hop * 0.07, 2.6);
          actor.root.rotation.set(0, 0, 0);
          shadow.position.set(0, 0.04, 2.6);
          shadow.scale.setScalar(1 - hop * 0.25);
          shadowMat.opacity = 0.2 - hop * 0.08;
        } else if (animate) {
          // Rundenlauf auf der Linie: Run-Clip, Kreisbahn + Kurvenlage; Schatten folgt am Boden.
          const a = t * 0.35;
          actor.root.position.set(Math.sin(a) * 2.6, 0, Math.cos(a) * 2.6);
          actor.root.rotation.set(0, a + Math.PI / 2, 0.09);
          shadow.position.set(actor.root.position.x, 0.04, actor.root.position.z);
        }
      }
      renderer.render(scene, cam);
      if (animate) {
        t += 0.028;
        frame = requestAnimationFrame(render);
      }
    };

    loadIsabel()
      .then((a) => {
        if (disposed) return; // Actor ist ein geteilter Singleton — nie in eine tote Szene hängen
        actor = a;
        if (finale) {
          a.teleport(new THREE.Vector3(0, 0, 2.6), new THREE.Vector3(0, 0, 7));
          a.play("Wave");
        } else {
          a.teleport(new THREE.Vector3(0, 0, 2.6));
          a.play(animate ? "Run" : "Idle");
        }
        scene.add(a.root);
        if (!animate) { a.update(0.4); renderer.render(scene, cam); } // eine Pose, ein Render
      })
      .catch(() => { /* GLB fehlt → Bahn ohne Figur, Szene bleibt nutzbar */ });

    render();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      if (actor) scene.remove(actor.root); // VOR dem Dispose-Traverse — der Actor ist gecacht, nie disposen
      renderer.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      for (const m of mats) m.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [finale]);

  return <div ref={mount} style={{ width: "100%", height: H, marginBottom: 10 }} />;
}
