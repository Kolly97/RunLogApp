// Chart-Kino: leichte Metadaten (Chips im Lernen-Hub, Kopfzeile) — bewusst OHNE three-Import, damit der
// Lernen-Hub sie statisch laden kann, ohne den 3D-Chunk ins Haupt-Bundle zu ziehen.
import type { CinemaChartId } from "../types.ts";

export const CINEMA_META: Partial<Record<CinemaChartId, { icon: string; label: string }>> = {
  pmc: { icon: "📈", label: "Formkurve (PMC)" },
  latent: { icon: "🧬", label: "Latente Fitness" },
  dose: { icon: "🎯", label: "Reizkanäle (Was wirkt?)" },
  wellness: { icon: "🌙", label: "Wellness-Signale" },
  readiness: { icon: "🫀", label: "Readiness & Gesundheit" },
  threshold: { icon: "⚡", label: "Schwellen-Trend" },
  power: { icon: "🔋", label: "Lauf-Power (CP · W′)" },
  vo2: { icon: "🫁", label: "Eff. VO2max je Lauf" },
  cycle: { icon: "🌗", label: "Zyklus: Phase × Reiz" },
};

/** Reihenfolge der verfügbaren Szenen im Hub. */
export const CINEMA_READY = Object.keys(CINEMA_META) as CinemaChartId[];
