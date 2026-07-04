// Synthese „Was hilft dir?" (Zeile 39, Deliverable A): bündelt die drei bereits vorhandenen Modell-Achsen
// zu EINEM geschichteten, erklärbaren Verdikt — pure, keine DB-Seiteneffekte (der Aufrufer reicht die
// Ergebnisse herein). Schicht 1 = beobachtet/korrelativ (Dosis/Regime/Schwerpunkt), Schicht 2 = kausal
// geprüft (prospektive Trials überlagern). Ehrlich: Korrelation ≠ Kausalität; starkes Signal ohne Beleg
// → Trial-Vorschlag. Sobald die schwere Bayes-Engine (Deliverable B) läuft, speist sie dieselben Achsen-
// Inputs (Fallback-transparent) — die Synthese bleibt unverändert.

import type { AnchoredMcid } from "./mcidAnchor.ts";

export type Conf = "hoch" | "mittel" | "niedrig" | "unzureichend";
/** Verankerte Praxis-Gates (aus mcidAnchor); optionaler Verdikt-Input. Fehlt er, greifen die dokumentierten
 *  Default-Konstanten (DOSE_MCID / MIN_CS) → pure, regressionssicher testbar. */
export interface McidGates { cs?: number; dosePerSd?: number }
const CONF_RANK: Record<Conf, number> = { unzureichend: 0, niedrig: 1, mittel: 2, hoch: 3 };
/** Normalisiert die (leicht unterschiedlichen) Konfidenz-Strings der Teilmodelle auf eine Skala. */
export function normConf(c: string | null | undefined): Conf {
  switch (c) {
    case "hoch": return "hoch";
    case "mittel": return "mittel";
    case "niedrig": return "niedrig";
    default: return "unzureichend"; // "insufficient" u.a.
  }
}
const minConf = (a: Conf, b: Conf): Conf => (CONF_RANK[a] <= CONF_RANK[b] ? a : b);

// ---- Achsen-Inputs (strukturell, entkoppelt von mlJobs/analysis — kein Import-Zyklus) ----
export interface DoseEffectLite {
  channel: string; target: string; // 'mediator' | 'composition'
  gain_mean: number | null; ci_low: number | null; ci_high: number | null;
  confidence: string; mcid_pass: number; fdr_survive: number; n_blocks: number | null;
  // B1: Bayes-Posterior (primär wenn bayes_engine gesetzt)
  posterior_mean: number | null; hdi_low: number | null; hdi_high: number | null; p_positive: number | null; bayes_engine: string | null;
  // B2a: Impulse-Response — Retention
  tau_weeks?: number | null; half_life_weeks?: number | null;
}
/** B2b: rohe Pro-Block CS-Deltas (negativ = schneller = besser) je Gruppe — Input für die hierarchische EB-Auswertung. */
export interface EbBlock { group: string; cs: number | null }
/** F3: Regime/Schwerpunkt-Effekt auf die LATENTE FITNESS (Δ Fitness je +1 SD Exposition, höher = besser). */
export interface LatentCell { label: string; beta: number; ciLow: number | null; ciHigh: number | null; pPositive: number | null }
/** Abgeschlossener prospektiver Trial (kausaler Beleg). arm = Kanal/Regime-Kennung, verdict aus prospective. */
export interface TrialResultLite { arm: string; label?: string | null; verdict: string | null; kind?: string | null; theta?: number | null; }

export interface VerdictInputs {
  dose: { mediator: DoseEffectLite[]; composition: DoseEffectLite[] };
  regime: { cells: LatentCell[] };
  emphasis: { cells: LatentCell[] };
  trials: TrialResultLite[];
}

// ---- Ausgabe ----
export interface AxisFinding {
  key: string; label: string;
  effect: number | null;        // Achsen-eigene Effekt-Metrik (Dosis: Δ Fitness/SD; Regime/Schwerpunkt: −s/km CS)
  unit: string;                 // "Δ Fitness/SD" | "s/km CS"
  betterWhenNegative: boolean;  // CS: negativ = schneller = besser
  ciLow: number | null; ciHigh: number | null;
  confidence: Conf; practical: boolean;
  direction: "hilft" | "neutral" | "kostet";
  causalProven: boolean;        // durch einen abgeschlossenen Trial belegt
  halfLifeWeeks?: number | null; // B2a: Retention (Halbwertszeit in Wochen) — nur Dosis-Achse
  pBetter?: number | null;       // B2b: Posterior-Wahrscheinlichkeit „hilft" (Regime/Schwerpunkt, hierarchisch)
  nBlocks?: number | null;       // Replikation (unabhängige Blöcke)
  significant?: boolean;         // statistisch klar (FDR bzw. HDI schließt 0 aus) — OHNE Praxis-Gate (MCID)
}
export interface AxisVerdict {
  axis: "dose" | "regime" | "emphasis";
  title: string; question: string;
  best: AxisFinding | null;
  ranking: AxisFinding[];
  insight: string;              // handlungsleitend, einfache Sprache
  confidence: Conf;
  layer: "observed" | "causal";
  engine?: string | null;       // B1: "pymc" | "conjugate" | null (Dosis-Achse) — welche Statistik lieferte den Effekt
}
export interface TrialSuggestion { axis: "dose" | "regime" | "emphasis"; key: string; label: string; reason: string; }
export interface TrainingVerdict {
  headline: string;
  axes: AxisVerdict[];
  trialSuggestions: TrialSuggestion[];
  overallConfidence: Conf;
  note: string;
  mcid?: AnchoredMcid;   // verankerte Praxisschwellen (für den UI-Erklär-Block) — additiv, von der Route gesetzt
  builtAt?: string;      // Zeitpunkt der Berechnung (Cache-Transparenz) — additiv, von der Route gesetzt
}

const CHANNEL_LABEL: Record<string, string> = {
  Long: "Longrun", Easy: "Locker (aerob)", Schwelle: "Schwelle", VO2: "VO2max",
  aerob: "Aerob", threshold: "Schwelle", vo2: "VO2max",
  E: "Easy (E)", M: "LT1 · Marathon (M)", T: "LT2 · Schwelle (T)", I: "VO2 (I)", R: "Repetition (R)",
};
export const REGIME_LABEL: Record<string, string> = { polarized: "polarisiert", pyramidal: "pyramidal", threshold: "Threshold", norwegian: "Norwegian", mixed: "gemischt" };
export const EMPHASIS_LABEL: Record<string, string> = { lt1: "LT1 (aerobe Schwelle)", vo2: "VO2max", schwelle: "Schwelle (LT2)", berg: "Berg", norwegian: "Norwegian", fartlek: "Fartlek", ausgewogen: "ausgewogen" };
const chLabel = (k: string) => CHANNEL_LABEL[k] ?? k;
const DOSE_MCID = 0.4; // kleinster praktisch relevanter Δ latente Fitness je +1 SD (= doseResponse-Default, Bayes-Pfad)

/** Passt ein Trial zu einem Achsen-Key? (grobe, tolerante Zuordnung über Label/Arm.) */
function trialProves(trials: TrialResultLite[], key: string): boolean {
  const k = key.toLowerCase();
  return trials.some((t) => {
    if ((t.verdict ?? "").toLowerCase() !== "geprueft") return false;
    const a = `${t.arm} ${t.label ?? ""}`.toLowerCase();
    return a.includes(k) || (k === "vo2" && /vo2|i\b|repet/.test(a)) || (k === "schwelle" && /schwelle|threshold|t\b/.test(a));
  });
}

/** Dosis-Achse: Kanäle nach Δ latenter Fitness je +1 SD (Mediator) ranken; Komposition liefert Mix-Hinweis. */
function doseAxis(inp: VerdictInputs, dosePerSd: number = DOSE_MCID): AxisVerdict {
  const med = inp.dose.mediator;
  let engine: string | null = null;
  const findings: AxisFinding[] = med.map((e) => {
    // B1: Bayes-Posterior primär, wenn vorhanden; sonst TS-Effekt.
    const useBayes = e.bayes_engine != null && e.posterior_mean != null;
    if (useBayes) engine = e.bayes_engine;
    const eff = useBayes ? e.posterior_mean : e.gain_mean;
    const ciLo = useBayes ? e.hdi_low : e.ci_low;
    const ciHi = useBayes ? e.hdi_high : e.ci_high;
    const ciExcl0 = ciLo != null && ciHi != null && (ciLo > 0 || ciHi < 0);
    // statistisch klar = Unsicherheit schließt 0 aus (Bayes: HDI · TS: FDR). Praktisch = zusätzlich MCID-Größe,
    // geprüft an DERSELBEN Schätzung, die angezeigt wird (Bayes: HDI-Grenze · TS: mcid_pass-Flag) — sonst kann
    // ein Bayes-Posterior von +0.96 fälschlich als „nicht praktisch" (weil der TS-Wert klein ist) durchfallen.
    const significant = useBayes ? ciExcl0 : e.fdr_survive === 1;
    const mcidOk = useBayes ? (ciLo != null && ciHi != null && (ciLo > dosePerSd || ciHi < -dosePerSd)) : e.mcid_pass === 1;
    const practical = significant && mcidOk;
    const dir: AxisFinding["direction"] = eff == null || !practical ? "neutral" : eff > 0 ? "hilft" : "kostet";
    return {
      key: e.channel, label: chLabel(e.channel), effect: eff, unit: "Δ Fitness/SD", betterWhenNegative: false,
      ciLow: ciLo, ciHigh: ciHi, confidence: normConf(e.confidence), practical, significant,
      direction: dir, causalProven: trialProves(inp.trials, e.channel), halfLifeWeeks: e.half_life_weeks ?? null,
    };
  }).sort((a, b) => (b.effect ?? -Infinity) - (a.effect ?? -Infinity));
  const top = findings.find((f) => f.direction === "hilft") ?? null;
  const conf = top?.confidence ?? "unzureichend";
  // Komposition = "Schwerpunkt bei gleichem Umfang": bester positiver Kanal → Mix-Empfehlung.
  const compTop = [...inp.dose.composition].filter((e) => (e.gain_mean ?? 0) > 0 && e.fdr_survive === 1)
    .sort((a, b) => (b.gain_mean ?? 0) - (a.gain_mean ?? 0))[0];
  let insight: string;
  if (!top) {
    // Ehrlich unterscheiden: BERECHNET, aber uneindeutig ≠ „noch keine Daten".
    if (findings.length) {
      const near = findings.filter((f) => f.significant && (f.effect ?? 0) > 0).sort((a, b) => (b.effect ?? 0) - (a.effect ?? 0))[0];
      insight = near
        ? `Berechnet, aber kein Reiz über der Praxisschwelle (MCID): ${near.label} zeigt den stärksten Zusammenhang (+${near.effect?.toFixed(2)} je SD), bleibt praktisch aber klein — statistisch klar, nicht steuerungsrelevant.`
        : "Berechnet, aber kein Kanal hebt sich klar ab — die Reize wirken bei dir aktuell ähnlich (eher ausgewogen trainieren).";
    } else {
      insight = "Sammelt noch Daten — für ein Kanal-Verdikt fehlen belastbare Wochen.";
    }
  } else {
    insight = `Am stärksten baut ${top.label} deine Fitness (+${top.effect?.toFixed(2)} je SD Last${top.causalProven ? ", kausal geprüft" : ""}).`;
    if (top.halfLifeWeeks != null) insight += ` Retention ~${top.halfLifeWeeks.toFixed(1)} Wo (Halbwertszeit) — so lange hält der Reiz, dann nachlegen.`;
    if (compTop && compTop.channel !== top.key) insight += ` Bei gleichem Umfang lohnt zusätzlich mehr Fokus auf ${chLabel(compTop.channel)}.`;
  }
  return {
    axis: "dose", title: "Reiz-Kanäle", question: "Long vs. Easy vs. Schwelle vs. VO2 — was baut deine Fitness?",
    best: top, ranking: findings, insight, confidence: conf,
    layer: top?.causalProven ? "causal" : "observed", engine,
  };
}

const MIN_CS = 1.5; // kleinster steuerungswürdiger CS-Unterschied (s/km)
const normPdfCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2)); // Φ(z)
// Abramowitz-Stegun erf-Approximation (rein, deterministisch).
function erf(x: number): number {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
/**
 * Regime-/Schwerpunkt-Achse als HIERARCHISCHES Modell (Partial Pooling, normal-normal Empirical Bayes = geschlossene
 * Form des PyMC-Pooling-Modells). Je Gruppe: Posterior-Mittel (zum Gesamtmittel geschrumpft je nach Datenlage) +
 * 95%-CI + P(hilft). Schützt gegen Klein-n-Ausreißer; ehrliche Unsicherheit statt Heuristik. CS negativ = besser.
 */
export interface EbPost { group: string; mean: number; ciLow: number; ciHigh: number; pBetter: number; nBlocks: number }
/**
 * Gruppen-Posteriors der hierarchischen (Partial-Pooling) Auswertung — normal-normal Empirical Bayes (geschlossene
 * Form). Schrumpft Gruppenmittel je nach Datenlage zum Gesamtmittel. Wiederverwendet als TS-Fallback für den
 * Sidecar-`blocks_bayes`-Job. CS negativ = besser; pBetter = P(μ<0).
 */
export function empiricalBayesGroups(blocks: EbBlock[]): EbPost[] {
  const byG = new Map<string, number[]>();
  for (const b of blocks) if (b.cs != null) (byG.get(b.group) ?? byG.set(b.group, []).get(b.group)!).push(b.cs);
  const gm = [...byG.entries()].filter(([, xs]) => xs.length >= 1).map(([g, xs]) => ({ g, n: xs.length, m: xs.reduce((a, c) => a + c, 0) / xs.length, ss: xs.reduce((a, c) => a + c * c, 0) }));
  if (!gm.length) return [];
  const N = gm.reduce((a, x) => a + x.n, 0), G = gm.length;
  const withinSS = gm.reduce((a, x) => a + (x.ss - x.n * x.m * x.m), 0);
  const s2 = Math.max(withinSS / Math.max(1, N - G), 4);           // Within-Varianz, Floor ~ (2 s/km)²
  const mu0 = gm.reduce((a, x) => a + x.n * x.m, 0) / N;           // Gesamtmittel (gewichtet)
  const Vm = G > 1 ? gm.reduce((a, x) => a + (x.m - mu0) ** 2, 0) / (G - 1) : 0;
  const meanSe = gm.reduce((a, x) => a + s2 / x.n, 0) / G;
  const tau2 = Math.max(0, Vm - meanSe);                          // Zwischen-Gruppen-Varianz (Momenten-Schätzer)
  return gm.map((x) => {
    const se2 = s2 / x.n;
    const postVar = tau2 > 0 ? 1 / (1 / se2 + 1 / tau2) : se2;
    const postMean = tau2 > 0 ? postVar * (x.m / se2 + mu0 / tau2) : mu0;
    const sd = Math.sqrt(postVar);
    return { group: x.g, mean: Math.round(postMean * 10) / 10, ciLow: Math.round((postMean - 1.96 * sd) * 10) / 10, ciHigh: Math.round((postMean + 1.96 * sd) * 10) / 10, pBetter: Math.round(normPdfCdf(-postMean / sd) * 100) / 100, nBlocks: x.n };
  });
}
/** EbPost[] → AxisFinding[] (praktisch/Direction/Label). Geteilt von ebAxis (analytisch) und dem Sidecar-Bayes-Pfad. */
export function ebFindings(posts: EbPost[], label: (k: string) => string, trials: TrialResultLite[], cs: number = MIN_CS): AxisFinding[] {
  return posts.map((p) => {
    const practical = p.ciHigh < 0 && Math.abs(p.mean) >= cs && p.nBlocks >= 2; // CI ganz < 0 · Größe (verankert) · Replikation
    return {
      key: p.group, label: label(p.group), effect: p.mean, unit: "s/km CS", betterWhenNegative: true,
      ciLow: p.ciLow, ciHigh: p.ciHigh, confidence: (p.nBlocks >= 3 && practical ? "hoch" : p.nBlocks >= 2 && practical ? "mittel" : "niedrig") as Conf,
      practical, direction: (p.mean < -cs ? "hilft" : p.mean > cs ? "kostet" : "neutral") as AxisFinding["direction"],
      causalProven: trialProves(trials, p.group), pBetter: p.pBetter, nBlocks: p.nBlocks,
    };
  }).sort((a, b) => (a.effect ?? Infinity) - (b.effect ?? Infinity));
}
function ebAxis(axis: "regime" | "emphasis", title: string, question: string, blocks: EbBlock[], label: (k: string) => string, trials: TrialResultLite[], cs: number = MIN_CS): AxisVerdict {
  const findings = ebFindings(empiricalBayesGroups(blocks), label, trials, cs);
  if (!findings.length) return { axis, title, question, best: null, ranking: [], insight: "Noch keine belastbare Präferenz — zu wenig Blöcke.", confidence: "unzureichend", layer: "observed" };
  const top = findings.find((f) => f.practical && f.direction === "hilft") ?? null;
  const insight = top
    ? `${top.label} korreliert bei dir mit dem stärksten Fortschritt (${top.effect} s/km CS, P(hilft) ${((top.pBetter ?? 0) * 100).toFixed(0)} %, ${top.nBlocks} Blöcke${top.causalProven ? ", kausal geprüft" : ""}).`
    : "Kein Regime/Schwerpunkt hebt sich hierarchisch belastbar ab — eher neutral (ehrliches Ergebnis).";
  return { axis, title, question, best: top, ranking: findings, insight, confidence: top?.confidence ?? "niedrig", layer: top?.causalProven ? "causal" : "observed" };
}

/**
 * F3: Regime/Schwerpunkt-Achse auf der LATENTEN FITNESS (Δ Fitness je +1 SD, höher = besser, bei gleichem Umfang).
 * Gleiche Einheit/Skala wie die Dosis-Achse → alle drei Achsen direkt vergleichbar. Schneller TS-Ridge mit Bayes-
 * Posterior-CI (die robusten Block-Bootstrap-CIs liefern die Karten). Praktisch = 95%-CI schließt 0 aus.
 */
function latentAxis(axis: "regime" | "emphasis", title: string, question: string, cells: LatentCell[], label: (k: string) => string, trials: TrialResultLite[]): AxisVerdict {
  if (!cells.length) return { axis, title, question, best: null, ranking: [], insight: "Noch keine Latenz-Auswertung — mehr Wochen/Regime nötig.", confidence: "unzureichend", layer: "observed" };
  const findings: AxisFinding[] = cells.map((c) => {
    const practical = c.ciLow != null && c.ciHigh != null && (c.ciLow > 0 || c.ciHigh < 0);
    return {
      key: c.label, label: label(c.label), effect: c.beta, unit: "Δ Fitness/SD", betterWhenNegative: false,
      ciLow: c.ciLow, ciHigh: c.ciHigh, confidence: (practical ? "mittel" : "niedrig") as Conf,
      practical, direction: (c.beta > 0 && practical ? "hilft" : c.beta < 0 && practical ? "kostet" : "neutral") as AxisFinding["direction"],
      causalProven: trialProves(trials, c.label), pBetter: c.pPositive,
    };
  }).sort((a, b) => (b.effect ?? -Infinity) - (a.effect ?? -Infinity)); // höher = mehr Fitness zuerst
  const top = findings.find((f) => f.practical && f.direction === "hilft") ?? null;
  const insight = top
    ? `${top.label} baut bei dir am meisten Fitness (Δ ${(top.effect ?? 0) > 0 ? "+" : ""}${top.effect} je +1 SD, bei gleichem Umfang, P>0 ${((top.pBetter ?? 0) * 100).toFixed(0)} %${top.causalProven ? ", kausal geprüft" : ""}).`
    : "Kein Regime/Schwerpunkt hebt sich auf der latenten Fitness belastbar ab — eher neutral (ehrliches Ergebnis).";
  return { axis, title, question, best: top, ranking: findings, insight, confidence: top?.confidence ?? "niedrig", layer: top?.causalProven ? "causal" : "observed", engine: "ridge (latent)" };
}

/**
 * Synthese der drei Achsen zu einem geschichteten Gesamturteil + Trial-Vorschlägen.
 * Headline = das handlungsleitendste positive Finding mit der höchsten Konfidenz über alle Achsen.
 */
export function synthesizeTrainingVerdict(inp: VerdictInputs, gates: McidGates = {}): TrainingVerdict {
  const dosePerSd = gates.dosePerSd ?? DOSE_MCID; // per-SD-Gate (Dosis-Achse); cs greift in der EB/CS-Auswertung
  const axes: AxisVerdict[] = [
    doseAxis(inp, dosePerSd),
    latentAxis("regime", "Intensitäts-Verteilung", "Welche Wochen-Verteilung baut deine Fitness?", inp.regime.cells, (k) => REGIME_LABEL[k] ?? k, inp.trials),
    latentAxis("emphasis", "Qualitäts-Schwerpunkt", "Welcher Schwerpunkt baut deine Fitness?", inp.emphasis.cells, (k) => EMPHASIS_LABEL[k] ?? k, inp.trials),
  ];

  // Headline: bestes „hilft"-Finding, priorisiert nach (kausal geprüft) → Konfidenz → praktisch.
  const candidates = axes.map((a) => a.best).filter((b): b is AxisFinding => !!b && b.direction === "hilft");
  candidates.sort((a, b) =>
    (Number(b.causalProven) - Number(a.causalProven)) ||
    (CONF_RANK[b.confidence] - CONF_RANK[a.confidence]) ||
    (Number(b.practical) - Number(a.practical)));
  const lead = candidates[0] ?? null;
  const headline = lead
    ? `Am meisten bringt dir aktuell: ${lead.label}${lead.causalProven ? " (kausal geprüft)" : ` (beobachtet, Konfidenz ${lead.confidence})`}.`
    : "Noch kein belastbares Muster — die App sammelt weiter Daten. Phasen-/methoden-neutral trainieren ist solide.";

  // Trial-Vorschläge: starkes beobachtetes Signal (praktisch, ≥ mittel) OHNE kausalen Beleg → gezielten Trial anbieten.
  const trialSuggestions: TrialSuggestion[] = [];
  for (const a of axes) {
    const b = a.best;
    if (b && b.direction === "hilft" && b.practical && CONF_RANK[b.confidence] >= CONF_RANK.mittel && !b.causalProven) {
      trialSuggestions.push({ axis: a.axis, key: b.key, label: b.label, reason: `${b.label} sieht bei dir vielversprechend aus, ist aber nur beobachtet (Korrelation). Ein randomisierter N-of-1-Block würde es kausal absichern.` });
    }
  }

  const overallConfidence = axes.map((a) => a.confidence).reduce((acc, c) => minConf(acc, c), "hoch" as Conf);
  const note = "Beobachtend = Korrelation, nicht Kausalität. Kausal belegt sind nur abgeschlossene N-of-1-Trials. Periodisierung, Erholung und Gesundheit übersteuern jede Empfehlung.";
  return { headline, axes, trialSuggestions, overallConfidence, note };
}
