// L4 Beobachtungs-Kausal ("as-if causal"): Robustheits- und Multiplizitäts-Schicht auf den L3-Effekten.
// - Benjamini-Hochberg-FDR gegen multiples Testen über die Kanäle (Frage 13: konfirmatorisch + FDR).
// - E-Value (VanderWeele/Ding): wie stark müsste ein UNBEOBACHTETER Confounder sein, um den Effekt zu erklären
//   → eine ehrliche Zahl für „as-if causal".
// - Changepoint-Erkennung auf der latenten Fitness (Regimewechsel/Verletzung/Schuhe, Frage 12).
// Pure, deterministisch, keine Seiteneffekte.

/** Benjamini-Hochberg-FDR → q-Werte (gleiche Reihenfolge wie die Eingabe-p-Werte). */
export function benjaminiHochberg(pvals: number[]): number[] {
  const n = pvals.length;
  if (!n) return [];
  const order = pvals.map((p, i) => [p, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const q = new Array<number>(n).fill(1);
  let prev = 1;
  for (let k = n - 1; k >= 0; k--) {
    const [p, i] = order[k];
    prev = Math.min(prev, (p * n) / (k + 1));
    q[i] = prev;
  }
  return q;
}

/**
 * E-Value für einen standardisierten Effekt `d` (Δ Outcome je +1 SD). VanderWeele/Ding-Näherung:
 * RR ≈ exp(0.91·|d|), E = RR + √(RR·(RR−1)). `ciNull` = die der Null nächste CI-Grenze (mit Vorzeichen);
 * überlappt das CI die 0, ist die CI-E-Value 1 (keine Robustheit). Werte ≈1 = fragil, große Werte = robust.
 */
export function eValue(d: number, ciNull: number): { point: number; ci: number } {
  const ev = (x: number): number => {
    const rr = Math.exp(0.91 * Math.abs(x));
    return rr + Math.sqrt(Math.max(0, rr * (rr - 1)));
  };
  const ciCrosses = d === 0 || ciNull === 0 || Math.sign(ciNull) !== Math.sign(d);
  return { point: ev(d), ci: ciCrosses ? 1 : ev(ciNull) };
}

/**
 * Binäre Segmentierung: Changepoints (Mean-Shift) in einer Reihe. Akzeptiert einen Bruch nur, wenn die
 * SSE-Reduktion eine BIC-artige Penalty (globale Varianz · ln n) übersteigt. Gibt Bruch-Indizes zurück.
 */
export function detectChangepoints(values: number[], minSeg = 8, penaltyMult = 1.5): number[] {
  const n = values.length;
  if (n < 2 * minSeg) return [];
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const sse = (a: number[]) => {
    const m = mean(a);
    return a.reduce((s, x) => s + (x - m) ** 2, 0);
  };
  const globalVar = sse(values) / n || 1e-9;
  const penalty = penaltyMult * globalVar * Math.log(n);
  const breaks: number[] = [];
  const seg = (lo: number, hi: number) => {
    if (hi - lo < 2 * minSeg) return;
    const base = sse(values.slice(lo, hi));
    let bestGain = 0, bestK = -1;
    for (let k = lo + minSeg; k <= hi - minSeg; k++) {
      const gain = base - sse(values.slice(lo, k)) - sse(values.slice(k, hi));
      if (gain > bestGain) {
        bestGain = gain;
        bestK = k;
      }
    }
    if (bestK >= 0 && bestGain > penalty) {
      breaks.push(bestK);
      seg(lo, bestK);
      seg(bestK, hi);
    }
  };
  seg(0, n);
  return breaks.sort((a, b) => a - b);
}
