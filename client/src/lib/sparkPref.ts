// T15 (WP-E): globale Pref „Marker-Sparklines an/aus". localStorage-basiert mit Event für Reaktivität —
// gleiches Muster wie lib/motion.ts. Default „on". Toggle sitzt im App-Footer, gelesen auf der Methodik-Seite.
import { useEffect, useState } from "react";

const KEY = "runlog-sparklines";
const EVT = "runlog-sparklines-change";

export function getSparkPref(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export function setSparkPref(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "on" : "off"); window.dispatchEvent(new Event(EVT)); } catch { /* ignore */ }
}

/** Reaktiver Sparkline-Status für Komponenten. */
export function useSparkPref(): boolean {
  const [on, setOn] = useState(getSparkPref);
  useEffect(() => {
    const upd = () => setOn(getSparkPref());
    window.addEventListener(EVT, upd);
    return () => window.removeEventListener(EVT, upd);
  }, []);
  return on;
}
