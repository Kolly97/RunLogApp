// P6 — Zyklusangepasste Trainingssteuerung: pure, deterministische Engine (keine DB-Seiteneffekte).
// GERÜST-Stufe (AUS): Phase/Gate/Stabilität rechnen, aber die Reiz-Empfehlung ist per Konstruktion „off/insufficient"
// (McNulty-Prior: der mittlere Gruppen-Effekt ist trivial → kein populationsweites Schema; N-of-1 erst nach Daten).
// Leitprinzip: Vorschlag statt Wahrheit; Gesundheit vor Performance; Symptom-Override schlägt Kalender.

export type CyclePhase = "menstrual" | "follicular" | "ovulation" | "early_luteal" | "late_luteal";
export type CycleMode = "natural" | "suppressed" | "uncertain";
export type Confidence = "insufficient" | "exploratory" | "low" | "medium" | "high";
export type Regularity = "stable" | "irregular" | "insufficient_data" | "amenorrhea_flag";

export interface Period { start_date: string; end_date?: string | null }
export type ContraceptionMethod =
  | "none" | "combined_pill" | "progestin_pill" | "hormonal_iud" | "copper_iud" | "implant" | "injection" | "ring" | "patch" | "unknown";
export interface ContraceptionStatus { method: ContraceptionMethod }

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sd = (xs: number[]) => { if (xs.length < 2) return 0; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };

/** Verhütungsmethode → Zyklus-Modus. Ovulationshemmend → 'suppressed' (keine natürliche Hormonfluktuation). */
export function contraceptionMode(c: ContraceptionStatus | null | undefined): CycleMode {
  switch (c?.method ?? "none") {
    case "combined_pill": case "implant": case "injection": case "ring": case "patch": return "suppressed";
    case "progestin_pill": case "hormonal_iud": return "uncertain"; // oft ovulatorisch, aber unsicher
    case "copper_iud": case "none": return "natural";
    default: return "uncertain";
  }
}

export interface StabilityResult {
  nCycles: number; medianLength: number | null; lengthSd: number | null;
  regularity: Regularity; daysSinceLast: number | null;
}
/** Zyklus-Stabilität aus den Perioden-Starts (für das Gate). */
export function evaluateCycleStability(periods: Period[], today: string): StabilityResult {
  const starts = periods.map((p) => p.start_date).filter(Boolean).sort();
  if (starts.length < 2) return { nCycles: Math.max(0, starts.length), medianLength: null, lengthSd: null, regularity: "insufficient_data", daysSinceLast: starts.length ? daysBetween(starts[starts.length - 1], today) : null };
  const lengths: number[] = [];
  for (let i = 1; i < starts.length; i++) lengths.push(daysBetween(starts[i - 1], starts[i]));
  const med = median(lengths), s = sd(lengths);
  const daysSinceLast = daysBetween(starts[starts.length - 1], today);
  const nCycles = lengths.length;
  let regularity: Regularity;
  if (daysSinceLast >= 90) regularity = "amenorrhea_flag";
  else if (nCycles < 3) regularity = "insufficient_data";
  else if (s < 7 && med >= 21 && med <= 45) regularity = "stable";
  else regularity = "irregular";
  return { nCycles, medianLength: med, lengthSd: s, regularity, daysSinceLast };
}

export interface PhaseResult { phase: CyclePhase | null; cycleDay: number | null; mode: CycleMode; confidence: Confidence }
/** Aktuelle Zyklusphase aus dem letzten Perioden-Start + (median) Zykluslänge. 'suppressed' → keine Phase. */
export function computeCyclePhase(periods: Period[], contraception: ContraceptionStatus | null | undefined, today: string): PhaseResult {
  const mode = contraceptionMode(contraception);
  if (mode === "suppressed") return { phase: null, cycleDay: null, mode, confidence: "insufficient" };
  const starts = periods.map((p) => p.start_date).filter((d) => d <= today).sort();
  if (!starts.length) return { phase: null, cycleDay: null, mode, confidence: "insufficient" };
  const stab = evaluateCycleStability(periods, today);
  const lastStart = starts[starts.length - 1];
  const day = daysBetween(lastStart, today) + 1;
  if (day > 45) return { phase: null, cycleDay: day, mode, confidence: "insufficient" }; // überfällig → keine belastbare Phase
  const len = stab.medianLength && stab.medianLength >= 21 && stab.medianLength <= 45 ? stab.medianLength : 28;
  const ovDay = Math.round(len - 14); // Lutealphase ~14 Tage fix
  let phase: CyclePhase;
  if (day <= 5) phase = "menstrual";
  else if (day < ovDay - 1) phase = "follicular";
  else if (day <= ovDay + 1) phase = "ovulation";
  else if (day <= ovDay + 6) phase = "early_luteal";
  else phase = "late_luteal";
  const confidence: Confidence = mode === "uncertain" ? "low" : stab.regularity === "stable" ? "medium" : stab.regularity === "irregular" ? "low" : "insufficient";
  return { phase, cycleDay: day, mode, confidence };
}

export interface DatedPhaseRow { id: number; date: string; cycle_phase?: string | null; cycle_day?: number | null; }
export interface PhaseStamp { id: number; date: string; phase: CyclePhase | null; cycleDay: number | null; changed: boolean; }
/**
 * Retroaktive Phasen-Rekonstruktion (#14): berechnet für jede (vergangene) Zeile die Zyklusphase aus der VOLLEN,
 * aktuellen Perioden-Historie neu — statt sie nur zum ursprünglichen POST-Zeitpunkt zu stempeln. `computeCyclePhase`
 * filtert je Zeile intern auf `start_date <= date`, also fließt keine Zukunftsinformation (nach dem Zeilendatum
 * geloggte Perioden) in die Phase dieser Zeile ein — kein Leakage. Rein aus Quelldaten abgeleitet → idempotent.
 * `changed` markiert Zeilen, deren Stempel sich gegenüber dem gespeicherten Wert unterscheidet (nur diese schreiben).
 */
export function reconstructPhases(rows: DatedPhaseRow[], periods: Period[], contraception: ContraceptionStatus | null | undefined): PhaseStamp[] {
  return rows.map((r) => {
    const ph = computeCyclePhase(periods, contraception, r.date);
    const changed = (r.cycle_phase ?? null) !== (ph.phase ?? null) || (r.cycle_day ?? null) !== (ph.cycleDay ?? null);
    return { id: r.id, date: r.date, phase: ph.phase, cycleDay: ph.cycleDay, changed };
  });
}

export interface GateResult {
  passed: boolean; mode: CycleMode; regularity: Regularity; nCycles: number; medianLength: number | null;
  reasons: string[]; healthFlags: { kind: string; message: string }[]; observationMode: boolean;
}
/** Stabilitäts-/Verhütungs-Gate: erst offen bei stabilem natürlichem Zyklus (Abschnitt 4). Sonst Beobachtungsmodus. */
export function gateCycleAdaptive(periods: Period[], contraception: ContraceptionStatus | null | undefined, today: string): GateResult {
  const mode = contraceptionMode(contraception);
  const stab = evaluateCycleStability(periods, today);
  const reasons: string[] = [];
  const healthFlags: { kind: string; message: string }[] = [];

  if (stab.regularity === "amenorrhea_flag") {
    healthFlags.push({ kind: "amenorrhea", message: "≥90 Tage ohne erfasste Periode — Gesundheits-Signal (RED-S/LEAF-Q). Erwäge, mit einer Fachperson zu sprechen. Keine Periodisierung." });
  }
  if (mode === "suppressed") reasons.push("Verhütung unterdrückt die Ovulation — keine natürliche Phasenfluktuation zum Periodisieren.");
  if (mode === "uncertain") reasons.push("Verhütungs-/Zyklus-Status unsicher — nur mit Disclaimer, konservativ.");
  if (stab.nCycles < 3) reasons.push(`Noch ${stab.nCycles}/3 vollständige Zyklen erfasst.`);
  if (stab.regularity === "irregular") reasons.push("Zyklus unregelmäßig (Längen-SD ≥ 7 Tage oder außerhalb 21–45 Tage).");

  const passed =
    mode === "natural" &&
    stab.nCycles >= 3 &&
    stab.regularity === "stable" &&
    healthFlags.length === 0;
  if (passed) reasons.push("Stabiler natürlicher Zyklus erkannt.");
  // Beobachtungsmodus: sammelt weiter, schlägt aber nichts vor (solange Gate zu, aber keine harte Kontraindikation).
  const observationMode = !passed && mode !== "suppressed" && healthFlags.length === 0;
  return { passed, mode, regularity: stab.regularity, nCycles: stab.nCycles, medianLength: stab.medianLength, reasons, healthFlags, observationMode };
}

// Schwache, mechanistische Default-Hypothese (Prior) — als HYPOTHESE gelabelt, NICHT als Fakt (Abschnitt 6.1).
const PHASE_PRIOR: Record<CyclePhase, { families: string[]; cautions: string[] }> = {
  menstrual: { families: [], cautions: ["Sehr individuell — Symptom-Override entscheidet, kein starrer Prior."] },
  follicular: { families: ["vo2", "threshold"], cautions: [] },
  ovulation: { families: ["threshold"], cautions: ["Möglicherweise erhöhte Bandlaxität (ACL) bei Sprung-/Richtungswechsel-Last — Hinweis, keine Reizregel."] },
  early_luteal: { families: ["threshold", "long"], cautions: [] },
  late_luteal: { families: ["long", "easy"], cautions: ["Höhere Kerntemperatur — lange/intensive Einheiten bei Hitze vorsichtiger steuern."] },
};

export interface StimulusRecommendation {
  preferredFamilies: string[]; cautions: string[]; rationale: string;
  confidence: Confidence; isHypothesis: boolean; active: boolean;
}
/**
 * GERÜST-Stub (per Konstruktion off): zeigt den schwachen mechanistischen Prior als HYPOTHESE, aber `active=false`
 * und `confidence='insufficient'`, solange keine individuellen Daten (Posterior) vorliegen. Kein Modell auf Null-Daten.
 */
export function phaseStimulusRecommendation(phase: CyclePhase | null, gate: GateResult): StimulusRecommendation {
  if (!phase || !gate.passed) {
    return {
      preferredFamilies: [], cautions: gate.healthFlags.map((f) => f.message),
      rationale: gate.mode === "suppressed"
        ? "Verhütung unterdrückt den Zyklus — Phasen-Steuerung ist nicht anwendbar. (Der Methoden-Schwerpunkt funktioniert unabhängig.)"
        : gate.observationMode
          ? "Beobachtungsmodus: die App sammelt Zyklus- + Feedback-Daten und schlägt (noch) nichts vor."
          : "Kein aktiver Phasen-Vorschlag.",
      confidence: "insufficient", isHypothesis: true, active: false,
    };
  }
  const prior = PHASE_PRIOR[phase];
  return {
    preferredFamilies: prior.families, cautions: prior.cautions,
    rationale: "Schwache, mechanistisch begründete Hypothese — wird an deinen Daten geprüft. Noch keine individuelle Evidenz, daher off.",
    confidence: "insufficient", isHypothesis: true, active: false, // GERÜST: bleibt off bis Posterior-Daten da sind
  };
}

export const PHASE_LABEL: Record<CyclePhase, string> = {
  menstrual: "Menstruation", follicular: "Follikelphase", ovulation: "Ovulation", early_luteal: "Frühe Lutealphase", late_luteal: "Späte Lutealphase",
};
export const CYCLE_PHASES: CyclePhase[] = ["menstrual", "follicular", "ovulation", "early_luteal", "late_luteal"];

// ---- Feedback-Loop (BUILDPLAN §3): Auto-Tag + N-of-1-Auswertung (Phase × Reiz) --------------------------------
export interface FeedbackContext { cycle_phase: CyclePhase | null; cycle_day: number | null; cycle_mode: CycleMode; }
/** Engine-Kontext für eine getrackte Einheit: setzt Phase/Tag/Modus (Nutzerin gibt das NICHT ein). */
export function buildFeedbackContext(periods: Period[], contraception: ContraceptionStatus | null | undefined, date: string): FeedbackContext {
  const ph = computeCyclePhase(periods, contraception, date);
  return { cycle_phase: ph.phase, cycle_day: ph.cycleDay, cycle_mode: ph.mode };
}

export interface FeedbackRow {
  session_family: string | null; cycle_phase: string | null;
  felt_vs_expected: number | null; rpe: number | null; confounder_flag: string | null;
}
export interface StimulusEvidence {
  phase: CyclePhase; stimulus: string; n_sessions: number; mean_quality: number | null;
  effect_size: number | null; ci_low: number | null; ci_high: number | null;
  confidence: Confidence; prior_weight: number; posterior_weight: number;
}
const N_FULL = 8; // ab so vielen sauberen Sessions dominiert der individuelle Posterior (BUILDPLAN §3.3)
const confFromN = (n: number): Confidence => (n < 3 ? "insufficient" : n < 6 ? "exploratory" : n < 10 ? "low" : "medium");
/** Outcome je Session auf ~[-2..+2]: felt_vs_expected primär, RPE (invertiert, zentriert) sekundär. */
function sessionOutcome(r: FeedbackRow): number | null {
  const felt = r.felt_vs_expected != null ? r.felt_vs_expected : null;
  const rpeTerm = r.rpe != null ? -(r.rpe - 5.5) / 2.25 : null; // RPE 1 → +2, 10 → −2 (niedriger = besser gelaufen)
  if (felt != null && rpeTerm != null) return 0.75 * felt + 0.25 * rpeTerm;
  if (felt != null) return felt;
  if (rpeTerm != null) return rpeTerm;
  return null;
}
/**
 * N-of-1-Auswertung (BUILDPLAN §3.2): je (Phase × Reiz) die standardisierte Abweichung vom Athletin-Reiz-Baseline.
 * Confounder (krank/Taper/Race) ausgeschlossen. Konfidenz aus n. „auswerten zuerst" — erzeugt KEINE aktive Steuerung.
 */
export function evaluatePhaseStimulus(feedback: FeedbackRow[]): StimulusEvidence[] {
  // saubere Zeilen mit Phase, Reiz und verwertbarem Outcome
  const rows = feedback
    .filter((r) => !r.confounder_flag && r.session_family && r.cycle_phase && CYCLE_PHASES.includes(r.cycle_phase as CyclePhase))
    .map((r) => ({ phase: r.cycle_phase as CyclePhase, stim: r.session_family as string, out: sessionOutcome(r) }))
    .filter((r) => r.out != null) as { phase: CyclePhase; stim: string; out: number }[];
  if (!rows.length) return [];

  // Baseline + SD je Reiz über ALLE Phasen
  const byStim = new Map<string, number[]>();
  for (const r of rows) (byStim.get(r.stim) ?? byStim.set(r.stim, []).get(r.stim)!).push(r.out);
  const baseline = new Map<string, { mean: number; sd: number }>();
  for (const [stim, xs] of byStim) {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const s = xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) : 0;
    baseline.set(stim, { mean: m, sd: Math.max(s, 0.5) }); // SD-Floor → keine überzogenen Effektgrößen bei Mini-n
  }

  // je (Phase × Reiz) bucket
  const buckets = new Map<string, number[]>();
  for (const r of rows) { const k = `${r.phase}|${r.stim}`; (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(r.out); }
  const out: StimulusEvidence[] = [];
  for (const [k, xs] of buckets) {
    const [phase, stim] = k.split("|") as [CyclePhase, string];
    const base = baseline.get(stim)!;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const n = xs.length;
    const effect = (mean - base.mean) / base.sd;              // standardisierter Vorteil dieser Phase
    const se = 1 / Math.sqrt(n);                              // SE des standardisierten Mittels (grob)
    const posterior = Math.min(1, n / N_FULL);
    out.push({
      phase, stimulus: stim, n_sessions: n, mean_quality: mean,
      effect_size: effect, ci_low: effect - 1.96 * se, ci_high: effect + 1.96 * se,
      confidence: confFromN(n), prior_weight: 1 - posterior, posterior_weight: posterior,
    });
  }
  return out.sort((a, b) => (CYCLE_PHASES.indexOf(a.phase) - CYCLE_PHASES.indexOf(b.phase)) || a.stimulus.localeCompare(b.stimulus));
}
