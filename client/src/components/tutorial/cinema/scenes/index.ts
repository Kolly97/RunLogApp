// Chart-Kino: Szenen-Registry — alle 9 Szenen (K1: PMC · K2: der Rest).
import type { CinemaChartId } from "../../types.ts";
import type { CinemaScene } from "../sceneKit.ts";
import { pmcScene } from "./pmc.ts";
import { latentScene } from "./latent.ts";
import { doseScene } from "./dose.ts";
import { wellnessScene } from "./wellness.ts";
import { readinessScene } from "./readiness.ts";
import { thresholdScene } from "./threshold.ts";
import { powerScene } from "./power.ts";
import { vo2Scene } from "./vo2.ts";
import { cycleScene } from "./cycle.ts";

const FACTORIES: Partial<Record<CinemaChartId, () => CinemaScene>> = {
  pmc: pmcScene,
  latent: latentScene,
  dose: doseScene,
  wellness: wellnessScene,
  readiness: readinessScene,
  threshold: thresholdScene,
  power: powerScene,
  vo2: vo2Scene,
  cycle: cycleScene,
};

const cache = new Map<CinemaChartId, CinemaScene>();

export function getScene(id: CinemaChartId): CinemaScene | null {
  if (!cache.has(id)) {
    const make = FACTORIES[id];
    if (!make) return null;
    cache.set(id, make());
  }
  return cache.get(id)!;
}

/** Für den Lernen-Hub: welche Kino-Szenen es schon gibt (Reihenfolge = Anzeige). */
export const CINEMA_AVAILABLE = Object.keys(FACTORIES) as CinemaChartId[];
