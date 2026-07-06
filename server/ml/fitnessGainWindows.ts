// Retrospektive Fitness-Sprung-Erkennung (v2.8.0 Item 2): findet Zeitfenster, in denen sich die latente Fitness
// (L2) signifikant verändert hat — symmetrisch, Fortschritt UND Rückschritt (Kolja-Entscheidung: beides lehrreich,
// sachlich gerahmt). Reine Segmentierungslogik, keine DB-Zugriffe (pure Modul, runner-testbar) — die Kontext-
// Anreicherung (Schlaf/HRV/Phase/Zonen-Mix) passiert im Router, der Zugriff auf die DB hat.
import { detectChangepoints } from "./causalObs.ts";
import { hedgesG } from "../cycleTraining.ts";

export interface GainWindow {
  breakDate: string;                    // Datum des erkannten Bruchs (Übergang zwischen den Segmenten)
  direction: "gain" | "setback";
  effectSize: number;                   // |Hedges' g| zwischen den beiden Segmenten
  deltaLatent: number;                   // afterMean − beforeMean (latente-Fitness-Einheiten)
  beforeMean: number; afterMean: number;
  beforeStart: string; afterEnd: string;  // volle Segment-Spannen (fürs Chart)
  // Kontext-Fenster = die Wochen VOR dem Bruch (Trainingsadaption braucht Zeit — was du VORHER gemacht hast,
  // erklärt plausibel den Bruch; die Zeit NACH dem Bruch ist das Ergebnis, nicht die Ursache).
  contextStart: string; contextEnd: string;
}

const CONTEXT_LOOKBACK_WEEKS = 6; // physiologisch plausibles Adaptationsfenster (Größenordnung, nicht exakt)

/**
 * Segmentiert `points` an erkannten Changepoints (Mean-Shift), bewertet jeden Bruch über Hedges' g zwischen dem
 * Segment davor und danach. Meldet nur Brüche mit |g| ≥ minEffectSize (Default 0.5 = Cohen's "medium",
 * Kolja-Entscheidung: ausgewogen). `points` müssen chronologisch sortiert sein, wöchentliches Raster erwartet.
 */
export function detectGainWindows(points: { date: string; value: number }[], minEffectSize = 0.5): GainWindow[] {
  const values = points.map((p) => p.value);
  const breaks = detectChangepoints(values); // minSeg=8, penaltyMult=1.5 (Standard-Defaults, wie an anderer Stelle)
  if (!breaks.length) return [];
  const bounds = [0, ...breaks, values.length];
  const windows: GainWindow[] = [];
  for (let i = 1; i < bounds.length - 1; i++) {
    const beforeSeg = values.slice(bounds[i - 1], bounds[i]);
    const afterSeg = values.slice(bounds[i], bounds[i + 1]);
    const g = hedgesG(afterSeg, beforeSeg); // afterSeg als Gruppe A → g>0 = Anstieg nach dem Bruch
    if (!g || Math.abs(g.g) < minEffectSize) continue;
    const beforeMean = beforeSeg.reduce((a, b) => a + b, 0) / beforeSeg.length;
    const afterMean = afterSeg.reduce((a, b) => a + b, 0) / afterSeg.length;
    const breakIdx = bounds[i];
    const lookback = Math.min(CONTEXT_LOOKBACK_WEEKS, breakIdx - bounds[i - 1]);
    windows.push({
      breakDate: points[breakIdx].date,
      direction: g.g > 0 ? "gain" : "setback",
      effectSize: Math.round(Math.abs(g.g) * 100) / 100,
      deltaLatent: Math.round((afterMean - beforeMean) * 100) / 100,
      beforeMean: Math.round(beforeMean * 100) / 100,
      afterMean: Math.round(afterMean * 100) / 100,
      beforeStart: points[bounds[i - 1]].date,
      afterEnd: points[Math.min(bounds[i + 1] - 1, points.length - 1)].date,
      contextStart: points[Math.max(bounds[i - 1], breakIdx - lookback)].date,
      contextEnd: points[Math.max(bounds[i - 1], breakIdx - 1)].date,
    });
  }
  return windows;
}
