// v2.8.0 (Item 4): versteckte Nerd-Seite — globale Tastenkombi öffnet /nerd (alle ML-Engine-Interna, read-only).
// Exaktes Vorbild KonamiLab.tsx (globaler keydown-Listener, Eingabefelder ignoriert), aber NAVIGIERT statt Overlay.
// Eigene Sequenz (Spiegel-Umkehr von Konami ↑↑↓↓←→←→), bleibt bewusst unsichtbar (nicht in NAV_GROUPS gelistet).
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

const SEQ = ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowLeft", "ArrowUp", "ArrowDown", "ArrowUp", "ArrowDown"];

export default function NerdKeybind() {
  const navigate = useNavigate();
  const posRef = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      posRef.current = e.key === SEQ[posRef.current] ? posRef.current + 1 : (e.key === SEQ[0] ? 1 : 0);
      if (posRef.current === SEQ.length) {
        posRef.current = 0;
        navigate("/nerd");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return null;
}
