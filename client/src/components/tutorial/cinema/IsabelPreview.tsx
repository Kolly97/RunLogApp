// Dev-Modell-Viewer (nur im Dev-Modus erreichbar, Route /isabel-preview): Isabel begutachten —
// Clips durchschalten, Orbit frei. Kein Produktions-Feature.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadIsabel, type IsabelActor, type ClipName } from "./isabelActor.ts";

const CLIPS: ClipName[] = ["Idle", "Walk", "Run", "Wave", "Point", "Interact"];
export default function IsabelPreview() {
  const wrap = useRef<HTMLDivElement>(null);
  const actorRef = useRef<IsabelActor | null>(null);
  const [clip, setClip] = useState<ClipName>("Idle");

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1526);
    const cam = new THREE.PerspectiveCamera(38, el.clientWidth / el.clientHeight, 0.1, 50);
    cam.position.set(0.9, 1.5, 2.6);
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    scene.add(new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 4, 3);
    scene.add(key);
    const grid = new THREE.GridHelper(8, 16, 0x22314f, 0x141f38);
    scene.add(grid);
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.target.set(0, 1.1, 0);
    controls.enableDamping = true;

    let disposed = false;
    loadIsabel().then((a) => {
      if (disposed) return;
      actorRef.current = a;
      a.teleport(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 5));
      a.play("Idle");
      scene.add(a.root);
    }).catch(() => {});

    const clock = new THREE.Clock();
    let raf = 0;
    const loop = () => {
      if (disposed) return;
      raf = requestAnimationFrame(loop);
      actorRef.current?.update(Math.min(clock.getDelta(), 0.1));
      controls.update();
      renderer.render(scene, cam);
    };
    loop();
    const ro = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      cam.aspect = el.clientWidth / el.clientHeight;
      cam.updateProjectionMatrix();
    });
    ro.observe(el);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (actorRef.current) scene.remove(actorRef.current.root); // Actor ist global gecacht — nie disposen
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div style={{ display: "flex", gap: 14, height: "calc(100vh - 140px)" }}>
      <div ref={wrap} style={{ flex: 1, minWidth: 0, borderRadius: 12, overflow: "hidden" }} />
      <div className="card" style={{ width: 280, flexShrink: 0, overflowY: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Isabel-Preview <span className="tiny muted">(dev)</span></h2>
        <div className="tiny muted" style={{ marginBottom: 8 }}>Clips:</div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {CLIPS.map((c) => (
            <button key={c} className={`sm ${clip === c ? "primary" : "ghost"}`}
              onClick={() => { setClip(c); actorRef.current?.play(c); }}>{c}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
