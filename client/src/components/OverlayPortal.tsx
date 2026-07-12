// Vollbild-Overlays IMMER an document.body hängen: position:fixed bricht, sobald irgendein Seiten-
// Vorfahre transform/filter/backdrop-filter setzt (das erzeugt einen neuen containing block) — z. B.
// die Route-Wechsel-Animation `.route-enter` (styles.css), die JEDE Seite umschließt. Ohne Portal landet
// der Overlay dann im gescrollten Dokumentfluss statt im Viewport (Beta-Befund: Modal "springt" an den
// oberen Seitenrand statt dort zu öffnen, wo man gerade ist). Betrifft jedes `position:fixed; inset:0`.
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function OverlayPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
