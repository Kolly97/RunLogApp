// L6 Exploratives Mining (NUR Hypothesen, NIE Verdikt): leichter, erklärbarer Pure-TS-Scan, der lagged/
// kontextabhängige Muster sucht, die das lineare L3-Modell verpassen könnte. Streng als „Hypothese
// (beobachtet)" gelabelt, hinter ExpertDetails — speist später die prospektiven Blöcke (L5), nie den Verdikt.
// Volles LightGBM+SHAP läuft im Research-Mode-Sidecar; hier die robuste Minimalvariante.
import type { DesignRow } from "./doseResponse.ts";

export interface Hypothesis {
  kind: "lag" | "modifier";
  text: string;
  strength: number; // |Korrelation| bzw. Effekt-Differenz — nur zum Ranken, kein p-Wert
}
export interface ExploratoryResult {
  hypotheses: Hypothesis[];
  note: string;
}

/** Gewichtete Pearson-Korrelation. */
function wcorr(x: number[], y: number[], w: number[]): number {
  let sw = 0, mx = 0, my = 0;
  for (let i = 0; i < x.length; i++) {
    sw += w[i];
    mx += w[i] * x[i];
    my += w[i] * y[i];
  }
  if (sw <= 0) return 0;
  mx /= sw;
  my /= sw;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += w[i] * dx * dy;
    sxx += w[i] * dx * dx;
    syy += w[i] * dy * dy;
  }
  const den = Math.sqrt(sxx * syy);
  return den > 1e-9 ? sxy / den : 0;
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/**
 * Scan über das aktive Design. (1) Lag-Response: bei welcher Verzögerung (Wochen) korreliert die Kanal-Last
 * am stärksten mit der späteren Fitness? (2) Effekt-Modifikation: wirkt ein Kanal v.a. bei hohem/niedrigem
 * Gesamtumfang? Konservative Schwellen → nur deutliche Muster werden als Hypothese ausgegeben.
 */
export function exploratoryScan(design: DesignRow[], channels: string[]): ExploratoryResult {
  const hyps: Hypothesis[] = [];
  const n = design.length;
  if (n >= 24) {
    const w = design.map((r) => r.weight);
    const out = design.map((r) => r.outcome);

    // (1) Lag-Response: peak-Lag je Kanal (Wochenraster)
    const LAGS = [0, 2, 4, 6];
    for (const c of channels) {
      const x = design.map((r) => r.ctl[c] ?? 0);
      let best = { lag: 0, corr: 0 };
      for (const L of LAGS) {
        const r = wcorr(x.slice(0, n - L), out.slice(L), w.slice(0, n - L));
        if (Math.abs(r) > Math.abs(best.corr)) best = { lag: L, corr: r };
      }
      if (best.lag > 0 && Math.abs(best.corr) >= 0.25) {
        hyps.push({ kind: "lag", text: `${c}: stärkste Assoziation mit der Fitness ~${best.lag} Wochen später (r≈${best.corr.toFixed(2)})`, strength: Math.abs(best.corr) });
      }
    }

    // (2) Effekt-Modifikation nach Gesamtumfang (high/low am Median der Gesamt-CTL)
    const med = median(design.map((r) => r.total));
    const lowIdx = design.map((_, i) => i).filter((i) => design[i].total <= med);
    const highIdx = design.map((_, i) => i).filter((i) => design[i].total > med);
    if (lowIdx.length >= 10 && highIdx.length >= 10) {
      for (const c of channels) {
        const x = design.map((r) => r.ctl[c] ?? 0);
        const cl = wcorr(lowIdx.map((i) => x[i]), lowIdx.map((i) => out[i]), lowIdx.map((i) => w[i]));
        const ch = wcorr(highIdx.map((i) => x[i]), highIdx.map((i) => out[i]), highIdx.map((i) => w[i]));
        if (Math.abs(ch - cl) >= 0.35 && Math.max(Math.abs(cl), Math.abs(ch)) >= 0.3) {
          const where = Math.abs(ch) > Math.abs(cl) ? "hohem" : "niedrigem";
          hyps.push({ kind: "modifier", text: `${c} wirkt v.a. bei ${where} Gesamtumfang (r ${cl.toFixed(2)}→${ch.toFixed(2)})`, strength: Math.abs(ch - cl) });
        }
      }
    }
  }
  hyps.sort((a, b) => b.strength - a.strength);
  return {
    hypotheses: hyps.slice(0, 6),
    note: "Explorativ, NICHT kausal getestet — Korrelationen als Hypothesen für gezielte (prospektive) Prüfung.",
  };
}
