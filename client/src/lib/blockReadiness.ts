// Baustein 2.2/2.3: Form-Readiness je Woche = Fitness × Frische(TSB). Fitness = individuelle IR-Prognose
// (`irFitness`, 2.3) falls vorhanden, sonst CTL (2.2). Geteilt zwischen BlockTimeline (Anzeige) und dem
// Coach-Peak-Optimierer (2.4), damit beide dieselbe Kurve/Peak-Logik nutzen.
import type { BlockWeek } from "./api.ts";

// Gauss-Frische: Peak ~TSB +12 (frisch nach Taper), fällt zu tief-negativ (müde) und zu hoch (Detraining).
const freshness = (tsb: number) => Math.exp(-Math.pow((tsb - 12) / 22, 2));

export interface BlockReadiness {
  readiness: number[]; // 0..100 je Woche
  peakIdx: number;     // Woche mit max. Readiness (nur bis einschließlich Renntag gesucht)
  raceIdx: number;     // Index der Renntags-Woche (-1 = keiner)
  hasIr: boolean;      // true = individuelle IR-Prognose, false = PMC-Form-Fallback
}

export function blockReadiness(weeks: BlockWeek[], raceDate: string | null): BlockReadiness {
  const hasIr = weeks.some((w) => w.irFitness != null && w.irFitness !== 0);
  const fitness = weeks.map((w) => (hasIr ? Math.max(0, w.irFitness ?? 0) : (w.ctlStart ?? 0)));
  const maxFit = Math.max(1, ...fitness);
  const readiness = weeks.map((w, i) =>
    Math.round(Math.max(0, Math.min(1, (fitness[i] / maxFit) * freshness(w.tsbStart ?? 0))) * 100));

  let raceIdx = -1;
  if (raceDate) {
    for (let i = 0; i < weeks.length; i++) {
      const next = weeks[i + 1]?.start_date;
      if (weeks[i].start_date <= raceDate && (!next || next > raceDate)) { raceIdx = i; break; }
    }
  }
  const peakEnd = raceIdx >= 0 ? raceIdx : weeks.length - 1;
  let peakIdx = 0;
  for (let i = 0; i <= peakEnd; i++) if (readiness[i] > readiness[peakIdx]) peakIdx = i;

  return { readiness, peakIdx, raceIdx, hasIr };
}
