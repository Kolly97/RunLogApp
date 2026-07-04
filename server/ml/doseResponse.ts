// L3 Dosis-Wirkung (pure, deterministisch via Seed): schätzt, welcher Reiz-Kanal bei DIESEM Athleten die
// latente Fitness baut — als regularisierte (Ridge) gewichtete Regression der latenten Fitness auf die
// kanal-spezifische CTL. Generisch über eine "Treatment-Dimension" (Kanäle): derselbe Schätzer trägt später
// auch Phase-Buckets (Komponente A) und Phase×Methode (Kreuzprodukt) — er bekommt nur einen anderen Kanal-Satz.
//
// Entscheidungen: zwei Modelle als Sensitivität (Frage 11) — Mediator (absolute Kanal-CTL) + Komposition
// (volumen-bereinigt: Kanäle gegen Gesamt-CTL residualisiert → "Schwerpunkt bei gleichem Umfang"); Auto-Kollaps
// 5→3 bei Kollinearität (Frage 9); ehrliche CIs via Moving-Block-Bootstrap gegen Autokorrelation (Frage 16);
// MCID-Gate + Confidence + "kein Kanal hebt sich ab"-Verdikt (Frage 7). BEOBACHTEND → as-if causal / Hypothese.
import { CHANNEL_SETS, type ChannelCount } from "./featureBackbone.ts";
import { benjaminiHochberg, eValue } from "./causalObs.ts";
import { DOSE_PER_SD_MCID } from "./mcidAnchor.ts";

export type Confidence = "insufficient" | "niedrig" | "mittel" | "hoch";

export interface DesignRow {
  date: string;
  outcome: number; // latente Fitness an diesem Wochenpunkt
  ctl: Record<string, number>;
  total: number;
  weight: number; // Recency-Gewicht (Frage 12)
}
export interface ChannelEffect {
  channel: string;
  effectPerSd: number; // Δ latente Fitness je +1 SD Kanal-CTL
  ciLow: number;
  ciHigh: number;
  collinear: boolean;
  mcidPass: boolean;
  confidence: Confidence;
  // L4 Robustheit:
  pBoot: number; // zweiseitiger Bootstrap-p
  qFdr: number; // BH-FDR-q über die Kanäle (Frage 13)
  fdrSurvive: boolean; // q<0.05 UND CI schließt 0 aus
  eValue: number; // E-Value der Punktschätzung
  eValueCi: number; // E-Value der null-nächsten CI-Grenze (1 = fragil)
}
export interface DoseModelResult {
  model: "mediator" | "composition";
  channels: string[];
  effects: ChannelEffect[];
  verdict: { kind: "ranked" | "null" | "insufficient"; text: string; ranking?: string[] };
  diagnostics: { maxVif: number; nWeeks: number; lambda: number; bootReps: number };
}
export interface LadderStep {
  count: number;
  channels: string[];
  identifiable: boolean;
  reason: string; // 'ok' | 'kollinear (VIF X)' | 'spärlich: …' | 'keine Daten'
  maxVif: number;
  sparseChannels: string[];
}
export interface DoseResult {
  activeCount: number;
  ladder: LadderStep[];
  mediator: DoseModelResult;
  composition: DoseModelResult;
}
export interface DoseOpts {
  seed?: number;
  mcid?: number; // minimal sinnvoller Δ latent (VO2-äquiv.)
  bootReps?: number;
  blockWeeks?: number;
  minWeeks?: number;
  vifThreshold?: number; // harter Kollinearitäts-Cap (Koeffizient-Flag, Default 8)
  autoVifThreshold?: number; // VIF-Reserve für die Auto-Wahl: feiner nur, wenn deutlich trennbar (Default 6)
  auto?: boolean; // Leiter 5→4→3 (Default) vs. feste Stufe (Pin)
  minWeeksPerChannel?: number; // Sparsity-Schwelle für Identifizierbarkeit (Frage 7)
}

// ---- seeded PRNG (mulberry32) — reproduzierbare Bootstrap-CIs ----
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- dichte lineare Algebra (p klein) ----
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}

/** Gewichtete Ridge-Regression: (X'WX + λI) β = X'Wy. X/y sind bereits zentriert/standardisiert. */
function weightedRidge(X: number[][], y: number[], w: number[], lambda: number): number[] | null {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (!p) return null;
  const XtWX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const XtWy = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const wi = w[i];
    for (let a = 0; a < p; a++) {
      XtWy[a] += wi * X[i][a] * y[i];
      for (let b = 0; b < p; b++) XtWX[a][b] += wi * X[i][a] * X[i][b];
    }
  }
  for (let a = 0; a < p; a++) XtWX[a][a] += lambda;
  return solve(XtWX, XtWy);
}

// ---- gewichtete Statistik ----
function wmean(v: number[], w: number[]): number {
  let s = 0, sw = 0;
  for (let i = 0; i < v.length; i++) {
    s += w[i] * v[i];
    sw += w[i];
  }
  return sw > 0 ? s / sw : 0;
}
function wsd(v: number[], w: number[], m: number): number {
  let s = 0, sw = 0;
  for (let i = 0; i < v.length; i++) {
    s += w[i] * (v[i] - m) ** 2;
    sw += w[i];
  }
  const sd = sw > 0 ? Math.sqrt(s / sw) : 0;
  return sd > 1e-9 ? sd : 1;
}
/** Residualisiere v gegen z (gewichtete OLS v ~ a + b·z) — für das volumen-bereinigte Komposit-Modell. */
function residualize(v: number[], z: number[], w: number[]): number[] {
  const mz = wmean(z, w), mv = wmean(v, w);
  let szz = 0, szv = 0;
  for (let i = 0; i < v.length; i++) {
    szz += w[i] * (z[i] - mz) ** 2;
    szv += w[i] * (z[i] - mz) * (v[i] - mv);
  }
  const b = szz > 1e-9 ? szv / szz : 0;
  const a = mv - b * mz;
  return v.map((x, i) => x - (a + b * z[i]));
}

/** Baut die standardisierte Designmatrix X (zentriert/standardisiert) + zentriertes y für ein Modell. */
function buildColumns(design: DesignRow[], channels: string[], model: "mediator" | "composition", w: number[]) {
  const total = design.map((r) => r.total);
  let cols = channels.map((c) => design.map((r) => r.ctl[c] ?? 0));
  let y = design.map((r) => r.outcome);
  if (model === "composition") {
    cols = cols.map((col) => residualize(col, total, w));
    y = residualize(y, total, w);
  }
  const my = wmean(y, w);
  const yc = y.map((v) => v - my);
  const means = cols.map((col) => wmean(col, w));
  const sds = cols.map((col, j) => wsd(col, w, means[j]));
  const X = design.map((_, i) => cols.map((col, j) => (col[i] - means[j]) / sds[j]));
  return { X, y: yc };
}

/** VIF je Kanal (auf den standardisierten Mediator-Spalten): R²_j aus OLS X_j ~ andere → VIF = 1/(1−R²). */
function vifs(X: number[][], w: number[]): number[] {
  const p = X[0]?.length ?? 0;
  const out: number[] = [];
  for (let j = 0; j < p; j++) {
    const others = X.map((row) => row.filter((_, k) => k !== j));
    const yj = X.map((row) => row[j]);
    if (!others[0]?.length) { out.push(1); continue; }
    const beta = weightedRidge(others, yj, w, 1e-6);
    if (!beta) { out.push(99); continue; }
    const myj = wmean(yj, w);
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < X.length; i++) {
      const pred = others[i].reduce((s, x, k) => s + x * beta[k], 0);
      ssRes += w[i] * (yj[i] - pred) ** 2;
      ssTot += w[i] * (yj[i] - myj) ** 2;
    }
    const r2 = ssTot > 1e-9 ? 1 - ssRes / ssTot : 0;
    out.push(r2 < 0.999 ? 1 / (1 - r2) : 1000);
  }
  return out;
}

/** λ per blocked rolling-origin CV (expanding window, gewichtete MSE) aus einem kleinen Raster. */
function chooseLambda(X: number[][], y: number[], w: number[]): number {
  const grid = [0.5, 2, 8, 32];
  const n = X.length;
  const folds = 4;
  let best = grid[0], bestErr = Infinity;
  for (const lam of grid) {
    let err = 0, cnt = 0;
    for (let f = 1; f < folds; f++) {
      const split = Math.floor((n * f) / folds);
      const testEnd = Math.floor((n * (f + 1)) / folds);
      const trX = X.slice(0, split), trY = y.slice(0, split), trW = w.slice(0, split);
      const beta = weightedRidge(trX, trY, trW, lam);
      if (!beta) continue;
      for (let i = split + 1; i < testEnd; i++) {
        const pred = X[i].reduce((s, x, k) => s + x * beta[k], 0);
        err += w[i] * (y[i] - pred) ** 2;
        cnt += w[i];
      }
    }
    const mse = cnt > 0 ? err / cnt : Infinity;
    if (mse < bestErr) { bestErr = mse; best = lam; }
  }
  return best;
}

/** Moving-Block-Bootstrap der Koeffizienten → ehrliche CIs unter Autokorrelation. */
function blockBootstrapCIs(
  X: number[][], y: number[], w: number[], lambda: number, blockLen: number, reps: number, seed: number,
): { lo: number; hi: number; p: number }[] {
  const n = X.length;
  const p = X[0].length;
  const rnd = mulberry32(seed);
  const samples: number[][] = Array.from({ length: p }, () => []);
  const nBlocks = Math.ceil(n / blockLen);
  for (let r = 0; r < reps; r++) {
    const idx: number[] = [];
    for (let b = 0; b < nBlocks; b++) {
      const start = Math.floor(rnd() * Math.max(1, n - blockLen + 1));
      for (let k = 0; k < blockLen && idx.length < n; k++) idx.push(start + k);
    }
    const bx = idx.map((i) => X[i]);
    const by = idx.map((i) => y[i]);
    const bw = idx.map((i) => w[i]);
    const beta = weightedRidge(bx, by, bw, lambda);
    if (!beta) continue;
    for (let j = 0; j < p; j++) samples[j].push(beta[j]);
  }
  return samples.map((s) => {
    if (!s.length) return { lo: NaN, hi: NaN, p: 1 };
    s.sort((a, b) => a - b);
    const q = (pp: number) => s[Math.min(s.length - 1, Math.max(0, Math.floor(pp * (s.length - 1))))];
    const nNeg = s.filter((v) => v <= 0).length; // zweiseitiger Bootstrap-p
    const pv = (2 * Math.min(nNeg, s.length - nNeg)) / s.length;
    return { lo: q(0.025), hi: q(0.975), p: Math.max(pv, 1 / s.length) };
  });
}

function channelConfidence(eff: { ciLow: number; ciHigh: number; collinear: boolean }, nWeeks: number, mcid: number): Confidence {
  if (nWeeks < 12) return "insufficient";
  const excludesZero = eff.ciLow > 0 || eff.ciHigh < 0;
  const beyondMcid = eff.ciLow > mcid || eff.ciHigh < -mcid;
  if (eff.collinear) return excludesZero ? "niedrig" : "niedrig";
  if (!excludesZero) return "niedrig";
  if (beyondMcid) return nWeeks >= 40 ? "hoch" : "mittel";
  return "mittel";
}

/** Fittet beide Modelle (Mediator + Komposition) für einen Kanal-Satz. */
function fitModels(design: DesignRow[], channels: string[], opts: Required<DoseOpts>): {
  mediator: DoseModelResult; composition: DoseModelResult; maxVif: number;
} {
  const w = design.map((r) => r.weight);
  const nWeeks = design.length;

  // VIF auf Mediator-Spalten (für Kollaps-Entscheidung)
  const med = buildColumns(design, channels, "mediator", w);
  const vifArr = nWeeks >= 4 ? vifs(med.X, w) : channels.map(() => 1);
  const maxVif = vifArr.length ? Math.max(...vifArr) : 1;

  const run = (model: "mediator" | "composition"): DoseModelResult => {
    const { X, y } = model === "mediator" ? med : buildColumns(design, channels, "composition", w);
    if (nWeeks < opts.minWeeks) {
      return {
        model, channels,
        effects: channels.map((c, j) => ({ channel: c, effectPerSd: NaN, ciLow: NaN, ciHigh: NaN, collinear: vifArr[j] > opts.vifThreshold, mcidPass: false, confidence: "insufficient" as Confidence, pBoot: 1, qFdr: 1, fdrSurvive: false, eValue: 1, eValueCi: 1 })),
        verdict: { kind: "insufficient", text: `Noch zu wenig Wochen (${nWeeks}) für ein belastbares Verdikt.` },
        diagnostics: { maxVif, nWeeks, lambda: 0, bootReps: 0 },
      };
    }
    const lambda = chooseLambda(X, y, w);
    const beta = weightedRidge(X, y, w, lambda) ?? channels.map(() => 0);
    const cis = blockBootstrapCIs(X, y, w, lambda, opts.blockWeeks, opts.bootReps, opts.seed);
    const qvals = benjaminiHochberg(cis.map((c) => c.p)); // FDR über die Kanäle (Frage 13)
    const effects: ChannelEffect[] = channels.map((c, j) => {
      const ciLow = cis[j].lo, ciHigh = cis[j].hi, est = beta[j];
      const collinear = vifArr[j] > opts.vifThreshold;
      const mcidPass = ciLow > opts.mcid || ciHigh < -opts.mcid;
      const excl0 = ciLow > 0 || ciHigh < 0;
      const ev = eValue(est, est >= 0 ? ciLow : ciHigh); // null-nächste CI-Grenze
      return {
        channel: c, effectPerSd: est, ciLow, ciHigh, collinear, mcidPass,
        confidence: channelConfidence({ ciLow, ciHigh, collinear }, nWeeks, opts.mcid),
        pBoot: cis[j].p, qFdr: qvals[j], fdrSurvive: qvals[j] < 0.05 && excl0,
        eValue: ev.point, eValueCi: ev.ci,
      };
    });
    // Verdikt rigoros: nur FDR-überlebende Kanäle ranken (Frage 13).
    const signif = effects.filter((e) => e.fdrSurvive).sort((a, b) => b.effectPerSd - a.effectPerSd);
    const verdict = signif.length
      ? { kind: "ranked" as const, text: `Stärkster Reiz bei dir: ${signif[0].channel} (Δ ${signif[0].effectPerSd.toFixed(2)} latente Fitness je +1 SD; FDR-bestätigt).`, ranking: signif.map((e) => e.channel) }
      : { kind: "null" as const, text: "Kein Kanal hebt sich nach FDR-Korrektur klar ab — du trainierst am besten ausgewogen (deckt sich oft mit der Gruppenevidenz)." };
    return { model, channels, effects, verdict, diagnostics: { maxVif, nWeeks, lambda, bootReps: opts.bootReps } };
  };

  return { mediator: run("mediator"), composition: run("composition"), maxVif };
}

/** Identifizierbarkeit eines Rungs: VIF ≤ Schwelle UND jeder Kanal in ≥ minWeeks Wochen nennenswert aktiv. */
function identifiability(
  design: DesignRow[], channels: string[], vifCap: number, minWeeksPerChannel: number,
): { maxVif: number; sparse: string[]; ok: boolean } {
  if (design.length < 4) return { maxVif: Infinity, sparse: channels, ok: false };
  const w = design.map((r) => r.weight);
  const med = buildColumns(design, channels, "mediator", w);
  const vifArr = vifs(med.X, w);
  const maxVif = vifArr.length ? Math.max(...vifArr) : 1;
  const sparse: string[] = [];
  for (const c of channels) {
    const vals = design.map((r) => r.ctl[c] ?? 0);
    const mx = Math.max(0, ...vals);
    const activeWeeks = mx > 0 ? vals.filter((v) => v > 0.1 * mx).length : 0;
    if (activeWeeks < minWeeksPerChannel) sparse.push(c);
  }
  // ok = trennbar mit VIF-Reserve (vifCap = autoVifThreshold): Auto splittet nur, wenn die Stufe DEUTLICH trennbar ist.
  return { maxVif, sparse, ok: maxVif <= vifCap && sparse.length === 0 };
}

/**
 * Top-Level: adaptive Modell-Leiter. Auto (Default): probiert ab `requested` herunter (5→4→3) und nimmt das
 * FEINSTE *trennbare* Modell (Step-down NUR bei Nicht-Identifizierbarkeit, Frage 1). 3 ist immer Endstufe.
 * Nicht-Auto: nutzt exakt `requested` (Pin). Der Leiter-Trail erklärt, warum welches Modell aktiv ist (Frage 6).
 */
export function estimateDoseResponse(
  designByCount: Partial<Record<ChannelCount, DesignRow[]>>,
  requested: ChannelCount,
  opts: DoseOpts = {},
): DoseResult {
  const o: Required<DoseOpts> = {
    seed: opts.seed ?? 42,
    mcid: opts.mcid ?? DOSE_PER_SD_MCID, // zentrale per-SD-Dosis-Schwelle (eine Wahrheitsquelle mit dem Verdikt)

    bootReps: opts.bootReps ?? 600,
    blockWeeks: opts.blockWeeks ?? 10,
    minWeeks: opts.minWeeks ?? 24,
    vifThreshold: opts.vifThreshold ?? 8,
    autoVifThreshold: opts.autoVifThreshold ?? 6,
    auto: opts.auto ?? true,
    minWeeksPerChannel: opts.minWeeksPerChannel ?? 8,
  };
  const ladderCounts: ChannelCount[] = o.auto ? ([5, 4, 3] as ChannelCount[]).filter((c) => c <= requested) : [requested];
  if (o.auto && !ladderCounts.includes(3)) ladderCounts.push(3);

  const trail: LadderStep[] = [];
  let chosen: ChannelCount | null = null;
  for (const c of ladderCounts) {
    const design = designByCount[c] ?? [];
    const id = identifiability(design, CHANNEL_SETS[c], o.autoVifThreshold, o.minWeeksPerChannel);
    const vifStr = Number.isFinite(id.maxVif) ? id.maxVif.toFixed(1) : "∞";
    const reason = !design.length
      ? "keine Daten"
      : id.ok
        ? "ok"
        : id.maxVif > o.vifThreshold
          ? `kollinear (VIF ${vifStr})`
          : id.maxVif > o.autoVifThreshold
            ? `grenzwertig (VIF ${vifStr}) — für Auto zu knapp`
            : `spärlich: ${id.sparse.join(", ")}`;
    trail.push({ count: c, channels: CHANNEL_SETS[c], identifiable: id.ok, reason, maxVif: Number.isFinite(id.maxVif) ? Math.round(id.maxVif * 10) / 10 : 999, sparseChannels: id.sparse });
    if (id.ok && chosen === null) {
      chosen = c;
      if (o.auto) break;
    }
  }
  const activeCount: ChannelCount = chosen ?? ladderCounts[ladderCounts.length - 1];
  const fitted = fitModels(designByCount[activeCount] ?? [], CHANNEL_SETS[activeCount], o);
  return { activeCount, ladder: trail, mediator: fitted.mediator, composition: fitted.composition };
}
