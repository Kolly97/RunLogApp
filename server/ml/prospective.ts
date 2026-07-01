// L5 Prospektiv-Kausal (pure, deterministisch): der EINZIGE „geprüft/verursacht"-Pfad. Within-Athlete
// COUNTERBALANCED AB/BA N-of-1-Trial — paarweise Arme, Reihenfolge je Paar randomisiert (gespeicherter Seed),
// exakter WITHIN-PAIR-PERMUTATIONSTEST (alle 2^P Vorzeichen-Flips) auf Δ latente Fitness. KEIN stochastischer
// Bandit (zu wenig effektives n): deterministischer information-greedy Empfehler. Arme können EINZEL-KANÄLE
// (VO2max vs Schwelle) ODER ganze REGIMES (polarisiert/pyramidal/threshold/norwegian) sein.

export type ArmKind = "channel" | "regime";
export interface TrialArm {
  kind: ArmKind;
  value: string; // channel: 'I'|'T'|... ; regime: 'polarized'|'pyramidal'|'threshold'|'norwegian'|'vo2'|'thresholdHeavy'
  label: string;
}
export interface Block {
  pair: number; // 0-basierter Paar-Index
  arm: string; // value des Arms in DIESEM Block
  startDate: string;
  endDate: string;
  outcome?: number | null; // Δ latente Fitness am Lag
  outcomeSd?: number | null;
  excluded?: boolean; // Health-Override/Confounder → aus dem Kontrast raus
}

// ---- seeded PRNG (mulberry32) — reproduzierbare Randomisierung + Re-Derivation der Permutations-Referenz ----
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

/** Counterbalanced AB/BA: je Paar eine randomisierte Reihenfolge (0 = A,B ; 1 = B,A). Seed gespeichert. */
export function randomizePairOrders(nPairs: number, seed: number): (0 | 1)[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: nPairs }, () => (rnd() < 0.5 ? 0 : 1) as 0 | 1);
}

/** Block-Plan aus den Paar-Reihenfolgen: 2 Blöcke je Paar (Arm A/B in randomisierter Reihenfolge), je
 * blockWeeks lang, dazwischen washoutWeeks Pause. */
export function buildBlockSchedule(
  armA: string, armB: string, pairOrders: (0 | 1)[], startDate: string, blockWeeks = 4, washoutWeeks = 1,
): Block[] {
  const out: Block[] = [];
  let cursor = Date.parse(startDate);
  const blockMs = blockWeeks * 7 * 86_400_000;
  const washMs = washoutWeeks * 7 * 86_400_000;
  pairOrders.forEach((order, p) => {
    const arms = order === 0 ? [armA, armB] : [armB, armA];
    for (const arm of arms) {
      const start = cursor;
      const end = start + blockMs;
      out.push({ pair: p, arm, startDate: new Date(start).toISOString().slice(0, 10), endDate: new Date(end).toISOString().slice(0, 10) });
      cursor = end + washMs;
    }
  });
  return out;
}

/** Δ latente Fitness eines Blocks am festen Lag: L(end + lag) − L(start). Null, wenn Fenster nicht abgedeckt. */
export function blockOutcome(
  block: Block, latent: { date: string; value: number; sd: number }[], lagWeeks = 3, toleranceDays = 10,
): { value: number; sd: number } | null {
  if (!latent.length) return null;
  const nearest = (targetMs: number) => {
    let best: { date: string; value: number; sd: number } | null = null, bd = Infinity;
    for (const p of latent) { const d = Math.abs(Date.parse(p.date) - targetMs); if (d < bd) { bd = d; best = p; } }
    return bd <= toleranceDays * 86_400_000 ? best : null;
  };
  const a = nearest(Date.parse(block.startDate));
  const b = nearest(Date.parse(block.endDate) + lagWeeks * 7 * 86_400_000);
  if (!a || !b) return null;
  return { value: b.value - a.value, sd: Math.sqrt(a.sd * a.sd + b.sd * b.sd) };
}

export type Verdict = "geprueft" | "hypothese" | "inconclusive" | "insufficient";
export interface TrialResult {
  nPairs: number; // vollständige, saubere Paare
  theta: number | null; // Ø within-pair-Differenz (Arm A − Arm B), in latente-Fitness-Einheiten
  pExact: number | null; // exakter zweiseitiger Permutations-p
  achievableMinP: number; // bestmögliches p bei aktuellem P (= 2/2^P); zeigt ehrlich, ob ein Verdikt überhaupt möglich ist
  pairsForSignif: number; // wie viele Paare nötig, damit p ≤ alpha überhaupt erreichbar ist
  mcidPass: boolean;
  verdict: Verdict;
  reason: string;
}

/**
 * Exakter Within-Pair-Permutationstest. d_p = Outcome(Arm A) − Outcome(Arm B) je sauberem Paar; T = Ø d_p.
 * Referenz = alle 2^P Vorzeichen-Flips (die einzige Randomisierung, die tatsächlich stattfand: Reihenfolge je
 * Paar). p_exact = Anteil |T*| ≥ |T_obs|. Keine iid-/Normal-Annahme.
 */
export function evaluateTrial(
  blocks: Block[], armA: string, opts: { mcid: number; alpha?: number },
): TrialResult {
  const alpha = opts.alpha ?? 0.05;
  // Paare bilden: je Paar die zwei Blöcke, beide mit gültigem, nicht-ausgeschlossenem Outcome
  const byPair = new Map<number, Block[]>();
  for (const b of blocks) {
    if (b.excluded || b.outcome == null) continue;
    (byPair.get(b.pair) ?? byPair.set(b.pair, []).get(b.pair)!).push(b);
  }
  const d: number[] = [];
  for (const [, bs] of byPair) {
    if (bs.length !== 2) continue;
    const a = bs.find((x) => x.arm === armA);
    const o = bs.find((x) => x.arm !== armA);
    if (!a || !o) continue;
    d.push((a.outcome as number) - (o.outcome as number));
  }
  const P = d.length;
  const achievableMinP = P > 0 ? 2 / Math.pow(2, P) : 1;
  const pairsForSignif = Math.ceil(Math.log2(2 / alpha)); // kleinstes P mit 2/2^P ≤ alpha (≈6 bei α=0.05)

  if (P < 2) {
    return { nPairs: P, theta: P ? d[0] : null, pExact: null, achievableMinP, pairsForSignif, mcidPass: false, verdict: "insufficient", reason: `Erst ${P} sauberes Paar — mindestens ${pairsForSignif} Paare nötig, bevor ein Verdikt überhaupt möglich ist.` };
  }
  const theta = d.reduce((s, x) => s + x, 0) / P;
  // exakte Permutation: 2^P Vorzeichen-Muster
  let ge = 0;
  const tObs = Math.abs(theta);
  for (let mask = 0; mask < (1 << P); mask++) {
    let sum = 0;
    for (let i = 0; i < P; i++) sum += (mask & (1 << i)) ? -d[i] : d[i];
    if (Math.abs(sum / P) >= tObs - 1e-12) ge++;
  }
  const pExact = ge / (1 << P);
  const mcidPass = Math.abs(theta) >= opts.mcid;

  let verdict: Verdict, reason: string;
  if (pExact <= alpha && mcidPass) {
    verdict = "geprueft";
    reason = `Randomisiert geprüft: Δ ${theta.toFixed(2)} (Arm A − B), p=${pExact.toFixed(3)}, ≥ MCID, ${P} Paare.`;
  } else if (mcidPass) {
    verdict = "hypothese";
    reason = `Richtung sichtbar (Δ ${theta.toFixed(2)}), aber p=${pExact.toFixed(3)} > ${alpha}${achievableMinP > alpha ? ` — bei ${P} Paaren ist das beste erreichbare p ${achievableMinP.toFixed(3)}; ≥${pairsForSignif} Paare nötig.` : "."}`;
  } else {
    verdict = "inconclusive";
    reason = `Kein bedeutsamer Unterschied (Δ ${theta.toFixed(2)} < MCID) — bei dir gleichwertig, trainiere ausgewogen.`;
  }
  return { nPairs: P, theta, pExact, achievableMinP, pairsForSignif, mcidPass, verdict, reason };
}

// ---- Empfehler: aus den L3-Kanal-Effekten den UNKLARSTEN wertvollen Kontrast (größter Informationsgewinn) ----
export interface ChannelEffectLite { channel: string; gain_mean: number | null; ci_low: number | null; ci_high: number | null; }
export interface ContrastProposal {
  kind: ArmKind;
  armA: TrialArm;
  armB: TrialArm;
  rationale: string;
  overlap: number; // CI-Überlappungs-Maß (höher = unklarer = mehr Info aus dem Test)
}
const CH_LABEL: Record<string, string> = { I: "VO2max", T: "Schwelle", vo2: "VO2max", threshold: "Schwelle", aerob: "Aerob", E: "Easy", M: "Marathon", R: "Repetition", Long: "Long", Easy: "Easy", Schwelle: "Schwelle", VO2: "VO2max" };

/** Wählt das Kanal-Paar mit der GRÖSSTEN CI-Überlappung (am wenigsten trennbar beobachtend → höchster Testwert).
 * Bevorzugt Build-relevante Reize. Default-Fallback: Schwelle vs VO2max. */
export function proposeChannelContrast(effects: ChannelEffectLite[]): ContrastProposal | null {
  const usable = effects.filter((e) => e.gain_mean != null && e.ci_low != null && e.ci_high != null);
  if (usable.length < 2) return null;
  const overlapOf = (a: ChannelEffectLite, b: ChannelEffectLite) => {
    const lo = Math.max(a.ci_low as number, b.ci_low as number);
    const hi = Math.min(a.ci_high as number, b.ci_high as number);
    const inter = Math.max(0, hi - lo);
    const span = Math.max(a.ci_high as number, b.ci_high as number) - Math.min(a.ci_low as number, b.ci_low as number);
    return span > 1e-9 ? inter / span : 1; // 1 = vollständig überlappend (maximal unklar)
  };
  let best: ContrastProposal | null = null;
  for (let i = 0; i < usable.length; i++) {
    for (let k = i + 1; k < usable.length; k++) {
      const ov = overlapOf(usable[i], usable[k]);
      if (!best || ov > best.overlap) {
        best = {
          kind: "channel",
          armA: { kind: "channel", value: usable[i].channel, label: CH_LABEL[usable[i].channel] ?? usable[i].channel },
          armB: { kind: "channel", value: usable[k].channel, label: CH_LABEL[usable[k].channel] ?? usable[k].channel },
          rationale: `Kontrast mit der größten Unsicherheit (CI-Überlappung) — hier bringt ein randomisierter Test am meisten Klarheit.`,
          overlap: ov,
        };
      }
    }
  }
  return best;
}
