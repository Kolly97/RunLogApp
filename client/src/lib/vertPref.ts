// v2.11.0: globale Pref „Vert-Load (Höhenmeter) in der Auswertung zeigen". localStorage-basiert mit Event
// für Reaktivität — gleiches Muster wie sparkPref.ts/motion.ts. Default „on" (automatische Trail-Erkennung
// bleibt aktiv); wer die Kachel/das Modul grundsätzlich nicht sehen will, schaltet sie hier ab.
import { useEffect, useState } from "react";

const KEY = "runlog-vertload";
const EVT = "runlog-vertload-change";

export function getVertPref(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export function setVertPref(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "on" : "off"); window.dispatchEvent(new Event(EVT)); } catch { /* ignore */ }
}

/** Reaktiver Vert-Load-Status für Komponenten. */
export function useVertPref(): boolean {
  const [on, setOn] = useState(getVertPref);
  useEffect(() => {
    const upd = () => setOn(getVertPref());
    window.addEventListener(EVT, upd);
    return () => window.removeEventListener(EVT, upd);
  }, []);
  return on;
}
