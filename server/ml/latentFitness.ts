// L2 Latente Fitness (pure, kein RNG, deterministisch): fusioniert die Komposit-Indikatoren
// (eff_VO2max / Race-VDOT / Labor) zu EINER geglätteten latenten Fitness-Trajektorie mit Unsicherheit —
// via lokalem Linear-Trend-Kalmanfilter + RTS-Smoother (structural time series / state-space).
// Das ist die TS-Realisierung des Komposit-Faktors (Frage 3): die Indikatoren sind verrauschte Messungen
// EINES latenten Zustands. Der Python-Sidecar liefert später optional die GP/HMC-Variante (Research-Mode).
import type { Indicator } from "./featureBackbone.ts";

export interface LatentPoint {
  date: string;
  value: number; // rück-skaliert in VO2-äquivalente Einheit
  sd: number;
  observed: boolean; // lag an diesem Schritt mind. eine Messung vor?
}
export interface LatentFitnessResult {
  points: LatentPoint[];
  nObs: number;
  kinds: string[];
  scale: { mean: number; sd: number };
}
export interface LatentOpts {
  sigmaLevel?: number; // Prozessrauschen Level (z-Einheiten je Schritt)
  sigmaSlope?: number; // Prozessrauschen Slope
  stepDays?: number; // Zeitraster (Default 7 = wöchentlich)
}

// Beobachtungsrauschen je Quelle in z-Einheiten (kleiner = höheres Gewicht, Labor am zuverlässigsten).
const KIND_R: Record<string, number> = { lab_vo2max: 0.05, race_vdot: 0.3, eff_vo2max: 0.8 };

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function sd(xs: number[], m: number): number {
  if (xs.length < 2) return 1;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(v) || 1;
}

/**
 * Fittet die latente Fitness. Vorgehen:
 *  1. z-Standardisierung je Indikator-Quelle (so kombinieren sich verschiedene Einheiten).
 *  2. Zeitraster (wöchentlich) von erster bis letzter Messung; Messungen auf den nächsten Schritt gesnappt.
 *  3. Lokaler-Linear-Trend-Kalmanfilter vorwärts (Predict-only bei fehlenden Wochen) + RTS-Smoother rückwärts.
 *  4. Rück-Skalierung des geglätteten Levels in die VO2-äquivalente Anzeige-Einheit.
 */
export function fitLatentFitness(indicators: Indicator[], opts: LatentOpts = {}): LatentFitnessResult | null {
  if (indicators.length < 3) return null;
  const sigmaLevel = opts.sigmaLevel ?? 0.08;
  const sigmaSlope = opts.sigmaSlope ?? 0.012;
  const stepDays = opts.stepDays ?? 7;

  // --- 1) z-Standardisierung je Quelle + Anzeige-Skala (bevorzugt eff_vo2max, sonst gepoolt) ---
  const byKind = new Map<string, number[]>();
  for (const i of indicators) (byKind.get(i.kind) ?? byKind.set(i.kind, []).get(i.kind)!).push(i.value);
  const stats = new Map<string, { m: number; s: number }>();
  for (const [k, vs] of byKind) {
    const m = mean(vs);
    stats.set(k, { m, s: sd(vs, m) });
  }
  const scaleVals = byKind.get("eff_vo2max") ?? indicators.map((i) => i.value);
  const scaleMean = mean(scaleVals);
  const scaleSd = sd(scaleVals, scaleMean);

  // --- 2) Zeitraster ---
  const t0 = Date.parse(indicators[0].date);
  const tN = Date.parse(indicators[indicators.length - 1].date);
  const nSteps = Math.max(1, Math.round((tN - t0) / (stepDays * 86_400_000))) + 1;
  const stepMs = stepDays * 86_400_000;
  const dateOf = (k: number) => new Date(t0 + k * stepMs).toISOString().slice(0, 10);

  // Messungen je Schritt sammeln (z-Wert + R)
  const obsByStep: { z: number; r: number }[][] = Array.from({ length: nSteps }, () => []);
  for (const ind of indicators) {
    const st = stats.get(ind.kind)!;
    const z = (ind.value - st.m) / st.s;
    const k = Math.min(nSteps - 1, Math.max(0, Math.round((Date.parse(ind.date) - t0) / stepMs)));
    obsByStep[k].push({ z, r: KIND_R[ind.kind] ?? 0.8 });
  }

  // --- 3a) Kalman-Filter vorwärts (State = [level, slope]) ---
  // gespeicherte Prädiktions- und Filter-Zustände für den RTS-Smoother
  const xPred: number[][] = [];
  const PPred: number[][][] = [];
  const xFilt: number[][] = [];
  const PFilt: number[][][] = [];

  let x = [0, 0];
  let P = [
    [4, 0],
    [0, 0.5],
  ];
  const ql = sigmaLevel * sigmaLevel;
  const qs = sigmaSlope * sigmaSlope;

  for (let k = 0; k < nSteps; k++) {
    // Predict: F = [[1,1],[0,1]]
    const xp = [x[0] + x[1], x[1]];
    const p00 = P[0][0] + P[0][1] + P[1][0] + P[1][1] + ql;
    const p01 = P[0][1] + P[1][1];
    const p10 = P[1][0] + P[1][1];
    const p11 = P[1][1] + qs;
    let Pp = [
      [p00, p01],
      [p10, p11],
    ];
    xPred.push([xp[0], xp[1]]);
    PPred.push([
      [Pp[0][0], Pp[0][1]],
      [Pp[1][0], Pp[1][1]],
    ]);

    // Update: sequenziell für jede Messung dieses Schritts (H = [1,0])
    let xf = [xp[0], xp[1]];
    for (const o of obsByStep[k]) {
      const S = Pp[0][0] + o.r;
      const k0 = Pp[0][0] / S;
      const k1 = Pp[1][0] / S;
      const y = o.z - xf[0];
      xf = [xf[0] + k0 * y, xf[1] + k1 * y];
      const np00 = (1 - k0) * Pp[0][0];
      const np01 = (1 - k0) * Pp[0][1];
      const np10 = Pp[1][0] - k1 * Pp[0][0];
      const np11 = Pp[1][1] - k1 * Pp[0][1];
      Pp = [
        [np00, np01],
        [np10, np11],
      ];
    }
    xFilt.push([xf[0], xf[1]]);
    PFilt.push([
      [Pp[0][0], Pp[0][1]],
      [Pp[1][0], Pp[1][1]],
    ]);
    x = xf;
    P = Pp;
  }

  // --- 3b) RTS-Smoother rückwärts ---
  const xS: number[][] = xFilt.map((v) => [v[0], v[1]]);
  const PS: number[][][] = PFilt.map((m) => [
    [m[0][0], m[0][1]],
    [m[1][0], m[1][1]],
  ]);
  for (let k = nSteps - 2; k >= 0; k--) {
    const Pf = PFilt[k];
    const Pp = PPred[k + 1];
    // C = Pf * F^T * inv(Pp); F^T = [[1,0],[1,1]]
    const PfFt = [
      [Pf[0][0] + Pf[0][1], Pf[0][1]],
      [Pf[1][0] + Pf[1][1], Pf[1][1]],
    ];
    const det = Pp[0][0] * Pp[1][1] - Pp[0][1] * Pp[1][0] || 1e-9;
    const inv = [
      [Pp[1][1] / det, -Pp[0][1] / det],
      [-Pp[1][0] / det, Pp[0][0] / det],
    ];
    const C = [
      [PfFt[0][0] * inv[0][0] + PfFt[0][1] * inv[1][0], PfFt[0][0] * inv[0][1] + PfFt[0][1] * inv[1][1]],
      [PfFt[1][0] * inv[0][0] + PfFt[1][1] * inv[1][0], PfFt[1][0] * inv[0][1] + PfFt[1][1] * inv[1][1]],
    ];
    const dx = [xS[k + 1][0] - xPred[k + 1][0], xS[k + 1][1] - xPred[k + 1][1]];
    xS[k] = [xFilt[k][0] + C[0][0] * dx[0] + C[0][1] * dx[1], xFilt[k][1] + C[1][0] * dx[0] + C[1][1] * dx[1]];
    const dP = [
      [PS[k + 1][0][0] - Pp[0][0], PS[k + 1][0][1] - Pp[0][1]],
      [PS[k + 1][1][0] - Pp[1][0], PS[k + 1][1][1] - Pp[1][1]],
    ];
    // PS = Pf + C dP C^T  (nur Level-Varianz [0][0] wird angezeigt)
    const CdP = [
      [C[0][0] * dP[0][0] + C[0][1] * dP[1][0], C[0][0] * dP[0][1] + C[0][1] * dP[1][1]],
      [C[1][0] * dP[0][0] + C[1][1] * dP[1][0], C[1][0] * dP[0][1] + C[1][1] * dP[1][1]],
    ];
    const new00 = Pf[0][0] + CdP[0][0] * C[0][0] + CdP[0][1] * C[0][1];
    PS[k][0][0] = new00;
  }

  // --- 4) Rück-Skalierung in VO2-äquivalente Einheit ---
  const points: LatentPoint[] = [];
  for (let k = 0; k < nSteps; k++) {
    const z = xS[k][0];
    const varLevel = Math.max(0, PS[k][0][0]);
    points.push({
      date: dateOf(k),
      value: scaleMean + z * scaleSd,
      sd: Math.sqrt(varLevel) * scaleSd,
      observed: obsByStep[k].length > 0,
    });
  }

  return { points, nObs: indicators.length, kinds: [...stats.keys()], scale: { mean: scaleMean, sd: scaleSd } };
}
