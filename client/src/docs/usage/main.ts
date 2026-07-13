// Entry der Anleitung (/usage.html): Design-System + Doku-Interaktion.
// 3D (three.js + Szenen + Isabel) lädt strikt lazy — erst beim Poster-Klick bzw. im
// Leerlauf fürs Hero — damit die Anleitung selbst sofort da ist.
import "../docs.css";
import { initDocPage } from "../theme.ts";

initDocPage();

// Kino: Klick aufs Poster lädt den 3D-Chunk und startet die Szene.
document.querySelectorAll<HTMLElement>(".kino[data-chart]").forEach((box) => {
  const poster = box.querySelector<HTMLElement>(".kino-poster");
  poster?.addEventListener("click", () => {
    import("./kinoHost.ts").then((m) => m.openKinoBox(box));
  });
});

// Hero-Isabel: dekorativ, lädt im Leerlauf (Modul prüft reduced-motion/WebGL selbst).
const bootHero = () => import("./heroIsabel.ts").then((m) => m.initHeroIsabel());
if ("requestIdleCallback" in window) {
  (window as Window & { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback(bootHero, { timeout: 3000 });
} else {
  setTimeout(bootHero, 800);
}
