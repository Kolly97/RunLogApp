// Theme (Premium-Politur M2): Hell/Dunkel/Auto. „Auto" folgt dem System (prefers-color-scheme).
// Setzt data-theme auf <html>; die CSS-Tokens (styles.css) liefern die Paletten. Druck bleibt erzwungen hell.
import { useEffect, useState } from "react";

export type ThemePref = "auto" | "light" | "dark";
const KEY = "runlog-theme";
export const THEME_EVT = "runlog-theme-change";

export function getThemePref(): ThemePref {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "auto"; } catch { return "auto"; }
}
function systemDark(): boolean {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; }
}
export function resolvedTheme(pref: ThemePref = getThemePref()): "light" | "dark" {
  return pref === "auto" ? (systemDark() ? "dark" : "light") : pref;
}
export function applyTheme(): void {
  try { document.documentElement.setAttribute("data-theme", resolvedTheme()); } catch { /* ignore */ }
}
export function setThemePref(p: ThemePref): void {
  try { localStorage.setItem(KEY, p); } catch { /* ignore */ }
  applyTheme();
  window.dispatchEvent(new Event(THEME_EVT));
}

/** Reaktives, aufgelöstes Theme (light|dark) für theme-fähige Charts. */
export function useTheme(): "light" | "dark" {
  const [th, setTh] = useState<"light" | "dark">(resolvedTheme);
  useEffect(() => {
    const upd = () => setTh(resolvedTheme());
    window.addEventListener(THEME_EVT, upd);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener?.("change", upd);
    return () => { window.removeEventListener(THEME_EVT, upd); mq.removeEventListener?.("change", upd); };
  }, []);
  return th;
}
