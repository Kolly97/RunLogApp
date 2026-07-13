// Kleiner Helfer für Analyse-Rechnungen: misst Zeitpunkt + Dauer der letzten Berechnung (persistent via localStorage)
// und liefert ein dezentes Label „zuletzt: vor X · dauerte Ys". Rein client-seitig, kein Server nötig.
import { useCallback, useState } from "react";

export interface ComputeStamp { ts: number; ms: number }

export function useComputeStamp(key: string) {
  const k = `compute:${key}`;
  const [stamp, setStamp] = useState<ComputeStamp | null>(() => {
    try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as ComputeStamp) : null; } catch { return null; }
  });
  const mark = useCallback((ms: number) => {
    const st: ComputeStamp = { ts: Date.now(), ms: Math.max(0, Math.round(ms)) };
    setStamp(st);
    try { localStorage.setItem(k, JSON.stringify(st)); } catch { /* Storage voll/aus */ }
  }, [k]);
  // Wraps eine asynchrone Berechnung, stempelt Zeit + Dauer. Für Poll-basierte Läufe: mark(ms) manuell.
  const runTimed = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try { return await fn(); } finally { mark(Date.now() - t0); }
  }, [mark]);
  return { stamp, runTimed, mark };
}

/** v3.1.0: „vor X" aus einem Server-Zeitstempel (Methodik-Cache `builtAt`) — überlebt Seitenwechsel/Neustart. */
export function agoLabel(iso?: string | null): string {
  if (!iso) return "";
  const secs = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(secs)) return "";
  return secs < 45 ? "gerade eben"
    : secs < 3600 ? `vor ${Math.round(secs / 60)} min`
      : secs < 86_400 ? `vor ${Math.round(secs / 3600)} h`
        : secs < 7 * 86_400 ? `vor ${Math.round(secs / 86_400)} Tagen`
          : new Date(iso).toLocaleDateString();
}

export function stampLabel(s: ComputeStamp | null): string {
  if (!s) return "";
  const secs = Math.max(0, Math.round((Date.now() - s.ts) / 1000));
  const ago = secs < 45 ? "gerade eben"
    : secs < 3600 ? `vor ${Math.round(secs / 60)} min`
      : secs < 86_400 ? `vor ${Math.round(secs / 3600)} h`
        : new Date(s.ts).toLocaleDateString();
  const dur = s.ms < 1000 ? `${s.ms} ms` : `${(s.ms / 1000).toFixed(1)} s`;
  return `zuletzt berechnet ${ago} · dauerte ${dur}`;
}
