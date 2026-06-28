// Gemeinsame Chart-Grammatik (v1.10.0 UI A4): EINE Quelle für Tooltip-Stil, Achsen-Ticks, Gitter und Kern-Farben.
// M2: theme-fähig über CSS-Variablen — Recharts gibt stroke/fill an SVG bzw. contentStyle an ein div weiter, beide
// unterstützen var(); so passen sich Tooltip/Gitter/Ticks automatisch an Hell/Dunkel an (kein Hook nötig).
export const TOOLTIP_STYLE = { borderRadius: 10, border: "1px solid var(--border)", fontSize: 12, background: "var(--card)", color: "var(--ink)" } as const;
export const AXIS_TICK = { fontSize: 11, fill: "var(--chart-tick)" } as const;
export const AXIS_TICK_SM = { fontSize: 10, fill: "var(--chart-tick)" } as const;
export const GRID_STROKE = "var(--chart-grid)";

// Intensität (easy/mittel/hart) — kanonisch (gespiegelt aus IntensityDonut.INT_COLORS).
export const INTENSITY = { easy: "#3b82f6", mod: "#22c55e", hard: "#f97316" } as const;
// PMC (entspricht den CSS-Tokens --fitness/--fatigue/--form).
export const PMC = { ctl: "#2b6cb0", atl: "#d53f8c", tsb: "#d69e2e" } as const;
// Schwellen-/Leistungs-Trends.
export const TREND = { thrPace: "#eab308", cp: "#7c3aed", lactate: "#2b6cb0" } as const;

/**
 * Berechnet ein "nices" Y-Domain-Intervall (runde Ticks, etwas Polster oben/unten).
 * Gibt [lo, hi] zurück; lo wird nie unter 0 gedrückt wenn alle Werte ≥ 0.
 */
export function niceYDomain(min: number, max: number, pad = 0.08): [number, number] {
  const range = Math.max(max - min, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(range)));
  const step = range / mag >= 4 ? mag : mag / 2;
  const lo = Math.floor((min - range * pad) / step) * step;
  const hi = Math.ceil((max + range * pad) / step) * step;
  return [Math.min(lo, min - range * pad), hi];
}
