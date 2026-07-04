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
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Tag-im-Zyklus (1-basiert) → Phase (Ovulation ~ len−14, Luteal ~14 Tage fix). Geteilt von computeCyclePhase + Projektion. */
function phaseFromCycleDay(day: number, len: number): CyclePhase {
  const ovDay = Math.round(len - 14);
  if (day <= 5) return "menstrual";
  if (day < ovDay - 1) return "follicular";
  if (day <= ovDay + 1) return "ovulation";
  if (day <= ovDay + 6) return "early_luteal";
  return "late_luteal";
}
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
  const phase = phaseFromCycleDay(day, len);
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

export type RecoVerdict = "suppressed" | "observation" | "hypothesis" | "activatable" | "active" | "no_consistent_effect";
export interface FamilyTendency {
  family: string; tendency: number; effect: number | null; nSessions: number; nCycles: number;
  confidence: Confidence; ciExcludesZero: boolean; source: "prior" | "measured";
  reliable: boolean;   // erfüllt die Aktivierungs-Kriterien (Konf≥mittel · CI≠0 · |g|≥0.2 · ≥2 Zyklen)
  activated: boolean;  // vom Nutzer für diese Phase×Reiz-Zelle freigeschaltet (Opt-in)
}
export interface StimulusRecommendation {
  preferredFamilies: string[]; cautions: string[]; rationale: string;
  confidence: Confidence; isHypothesis: boolean; active: boolean;
  symptomOverride?: { active: boolean; reasons: string[] };
  verdict?: RecoVerdict; perFamily?: FamilyTendency[]; nCyclesObserved?: number;
}

const FAMILY_LABEL_DE: Record<string, string> = { vo2: "VO2max", threshold: "Schwelle", long: "Lange Einheit", easy: "Locker", norwegian: "Norwegian", speed: "Speed", hill: "Berg" };
const famLabel = (s: string) => FAMILY_LABEL_DE[s] ?? s;
const CONF_RANK: Record<Confidence, number> = { insufficient: 0, exploratory: 1, low: 2, medium: 3, high: 4 };
const PRIOR_SCORE = 0.25;   // schwacher mechanistischer Nudge in SMD-Einheiten (Prior ist Hypothese, kein Fakt)
const MIN_EFFECT = 0.2;     // kleinster steuerungswürdiger Effekt (Cohen small) — Schutz gegen „signifikant, aber winzig"
const priorScore = (phase: CyclePhase, stim: string) => (PHASE_PRIOR[phase]?.families.includes(stim) ? PRIOR_SCORE : 0);

export interface CalibratedTendency {
  phase: CyclePhase; stimulus: string; prior: number; effect: number | null; tendency: number;
  priorWeight: number; posteriorWeight: number; nSessions: number; nCycles: number;
  ciExcludesZero: boolean; confidence: Confidence;
}
/**
 * Kalibrierung (BUILDPLAN §3.3): mischt den schwachen mechanistischen Prior mit der gemessenen Evidenz.
 *   tendency = priorWeight·priorScore + posteriorWeight·effect
 * posteriorWeight wächst mit n UND mit der Replikation über Zyklen (min(1, nCycles/2)) — Einzel-Zyklus-Daten
 * bekommen nie volles Gewicht. `feedback_sensitivity` skaliert, wie schnell N_FULL erreicht ist. Transparent.
 */
export function calibrateStimulusWeights(evidence: StimulusEvidence[], opts: { sensitivity?: number } = {}): CalibratedTendency[] {
  const sens = Math.max(0, Math.min(1, opts.sensitivity ?? 0.5));
  const nFull = N_FULL * (1.5 - sens); // höhere Sensitivität → kleineres N_FULL → schnellerer Posterior
  return evidence.map((e) => {
    const pw = Math.max(0, Math.min(1, (e.n_sessions / nFull) * Math.min(1, e.n_cycles / 2)));
    const prior = priorScore(e.phase, e.stimulus);
    const effect = e.effect_size ?? 0;
    return {
      phase: e.phase, stimulus: e.stimulus, prior, effect: e.effect_size,
      tendency: round2((1 - pw) * prior + pw * effect), priorWeight: round2(1 - pw), posteriorWeight: round2(pw),
      nSessions: e.n_sessions, nCycles: e.n_cycles, ciExcludesZero: e.ci_excludes_zero, confidence: e.confidence,
    };
  });
}

export const isReliable = (c: CalibratedTendency) =>
  CONF_RANK[c.confidence] >= CONF_RANK.medium && c.ciExcludesZero && Math.abs(c.effect ?? 0) >= MIN_EFFECT && c.nCycles >= 2;

/** Stabiler Schlüssel einer Phase×Reiz-Zelle für den Opt-in-Satz. */
export const cellKey = (phase: CyclePhase | string, stimulus: string) => `${phase}:${stimulus}`;

export interface RecoContext {
  calibrated: CalibratedTendency[];
  totalCycles: number;
  adaptiveEnabled?: boolean;   // Master-Schalter „Aktivierung erlauben" (cycle_adaptive_enabled)
  activated?: Set<string>;     // vom Nutzer freigeschaltete Zellen (cellKey), aus phase_stimulus_map
}
/**
 * Datengetriebene Phasen-Reiz-Empfehlung (Teil 5) — REIN ANZEIGE/beratend, kein Planer-Eingriff.
 * Aktivierung nur, wenn eine Zelle der aktuellen Phase ALLE Bedingungen erfüllt (konjunktiv, gegen Multiplizität):
 *   Konfidenz ≥ mittel · 95%-CI schließt 0 aus · |Effekt| ≥ 0.2 · ≥ 2 Zyklen Replikation.
 * Abschalt-Regel: ≥ 3 Zyklen erfasst, aber NIRGENDS ein belastbarer Effekt → ehrlich „phasen-neutral optimal".
 * Solange nicht belastbar: der schwache Prior wird als HYPOTHESE gezeigt (isHypothesis), bleibt aber off.
 */
export function phaseStimulusRecommendation(phase: CyclePhase | null, gate: GateResult, ctx?: RecoContext): StimulusRecommendation {
  const cal = ctx?.calibrated ?? [];
  const totalCycles = ctx?.totalCycles ?? 0;
  const adaptiveEnabled = ctx?.adaptiveEnabled ?? false;   // Master-Schalter; ohne ihn nie „aktiv"
  const activated = ctx?.activated ?? new Set<string>();   // vom Nutzer freigeschaltete Zellen (Opt-in je Effekt)
  const isActivated = (c: CalibratedTendency) => adaptiveEnabled && activated.has(cellKey(c.phase, c.stimulus));

  if (!phase || !gate.passed) {
    const verdict: RecoVerdict = gate.mode === "suppressed" ? "suppressed" : "observation";
    return {
      preferredFamilies: [], cautions: gate.healthFlags.map((f) => f.message),
      rationale: gate.mode === "suppressed"
        ? "Verhütung unterdrückt den Zyklus — Phasen-Steuerung ist nicht anwendbar. (Der Methoden-Schwerpunkt funktioniert unabhängig.)"
        : gate.observationMode
          ? `Beobachtungsmodus: die App sammelt Zyklus- + Feedback-Daten (${totalCycles} Zyklen) und schlägt (noch) nichts vor.`
          : "Kein aktiver Phasen-Vorschlag.",
      confidence: "insufficient", isHypothesis: true, active: false, verdict, nCyclesObserved: totalCycles,
    };
  }

  const prior = PHASE_PRIOR[phase];
  // Abschalt-Regel: genug Zyklen, aber NIRGENDS (über alle Phasen) ein belastbarer Effekt → ehrlich melden.
  if (totalCycles >= 3 && !cal.some(isReliable)) {
    return {
      preferredFamilies: [], cautions: prior.cautions,
      rationale: `Über ${totalCycles} Zyklen ist bei dir kein konsistenter Phasen-Effekt messbar — du trainierst am besten phasen-neutral. Das ist ein gültiges Ergebnis, kein Versagen (deckt sich mit der Gruppen-Evidenz für viele Frauen).`,
      confidence: "low", isHypothesis: false, active: false, verdict: "no_consistent_effect", nCyclesObserved: totalCycles, perFamily: [],
    };
  }

  const here = cal.filter((c) => c.phase === phase);
  const perFamily: FamilyTendency[] = here
    .map((c) => ({ family: c.stimulus, tendency: c.tendency, effect: c.effect, nSessions: c.nSessions, nCycles: c.nCycles, confidence: c.confidence, ciExcludesZero: c.ciExcludesZero, source: (c.posteriorWeight >= 0.5 ? "measured" : "prior") as "prior" | "measured", reliable: isReliable(c), activated: isActivated(c) }))
    .sort((a, b) => b.tendency - a.tendency);
  const reliable = here.filter(isReliable);
  // Teil 5: „aktiv" nur für vom Nutzer freigeschaltete (opt-in) belastbare Zellen — beratend, kein Planer-Eingriff.
  const active = reliable.filter(isActivated);
  const positives = active.filter((c) => (c.effect ?? 0) > 0).sort((a, b) => b.tendency - a.tendency);
  const negatives = active.filter((c) => (c.effect ?? 0) < 0);

  if (positives.length || negatives.length) {
    const bestConf = active.reduce<Confidence>((acc, c) => (CONF_RANK[c.confidence] > CONF_RANK[acc] ? c.confidence : acc), "medium");
    const cautions = [
      ...prior.cautions,
      ...negatives.map((c) => `${famLabel(c.stimulus)} lief in dieser Phase bei dir messbar schlechter (g=${c.effect}, ${c.nCycles} Zyklen) — eher verschieben.`),
    ];
    return {
      preferredFamilies: positives.map((c) => c.stimulus), cautions,
      rationale: positives.length
        ? `Aus deinen Daten (${totalCycles} Zyklen): in dieser Phase wirkt ${positives.map((c) => famLabel(c.stimulus)).join(", ")} bei dir überdurchschnittlich (Phase gegen die übrigen Phasen, Hedges' g, CI schließt 0 aus). Du hast das aktiviert. Beratend, nicht bindend — Periodisierung & Erholung übersteuern immer.`
        : `Aus deinen Daten (${totalCycles} Zyklen): in dieser Phase laufen aktivierte Reize bei dir messbar schlechter — siehe Hinweise.`,
      confidence: bestConf, isHypothesis: false, active: true, verdict: "active", perFamily, nCyclesObserved: totalCycles,
    };
  }

  // Belastbare Effekte vorhanden, aber (noch) nicht freigeschaltet bzw. Master-Schalter aus → „aktivierbar".
  // Ehrlich: die Zellen sind messbar, warten aber auf das bewusste Opt-in des Nutzers (Vorschlag statt Wahrheit).
  if (reliable.length) {
    const relPos = reliable.filter((c) => (c.effect ?? 0) > 0).sort((a, b) => b.tendency - a.tendency);
    const bestConf = reliable.reduce<Confidence>((acc, c) => (CONF_RANK[c.confidence] > CONF_RANK[acc] ? c.confidence : acc), "medium");
    return {
      preferredFamilies: [], cautions: prior.cautions,
      rationale: adaptiveEnabled
        ? `In dieser Phase ist bei dir ein belastbarer Effekt gemessen (${relPos.map((c) => famLabel(c.stimulus)).join(", ") || "siehe Tabelle"}, Hedges' g mit CI ohne 0, ≥2 Zyklen). Schalte den Effekt frei, um ihn als aktive, beratende Empfehlung zu übernehmen.`
        : `In dieser Phase ist bei dir ein belastbarer Effekt gemessen. Aktiviere oben „Aktivierung erlauben" und schalte den Effekt frei, um ihn als beratende Empfehlung zu nutzen.`,
      confidence: bestConf, isHypothesis: false, active: false, verdict: "activatable", perFamily, nCyclesObserved: totalCycles,
    };
  }

  // Noch nicht belastbar → schwacher Prior als HYPOTHESE (sichtbar zur Einordnung, aber off).
  // Unterscheide ehrlich: „getestet, aber kein Effekt in dieser Phase" vs. „noch zu wenig Daten".
  const maxHere = here.reduce<Confidence>((acc, c) => (CONF_RANK[c.confidence] > CONF_RANK[acc] ? c.confidence : acc), "insufficient");
  const testedHere = here.some((c) => CONF_RANK[c.confidence] >= CONF_RANK.medium && c.nCycles >= 2);
  return {
    preferredFamilies: testedHere ? [] : prior.families, cautions: prior.cautions,
    rationale: testedHere
      ? "In dieser Phase ist bei dir kein belastbarer Reiz-Unterschied messbar — getestet (≥ mittlere Konfidenz, ≥ 2 Zyklen), aber die CIs überlappen 0 bzw. der Effekt ist zu klein. Eher phasen-neutral."
      : "Schwache, mechanistisch begründete Hypothese — wird an deinen Daten geprüft. Noch zu wenig belastbare Evidenz (≥ mittlere Konfidenz, ≥ 2 Zyklen, klarer Effekt mit CI ohne 0) für einen datengestützten Vorschlag.",
    confidence: maxHere, isHypothesis: true, active: false, verdict: "hypothesis", perFamily, nCyclesObserved: totalCycles,
  };
}

export interface TodaySymptoms { cramps?: number | null; energy?: number | null; sleep?: number | null; mood?: number | null; flow?: number | null }
/**
 * Symptom-Override (BUILDPLAN §0 Regel 5 / §3.4, health-first): deutliche Tages-Symptome überschreiben JEDE
 * Kalender-Phase. Rein beratend (kein Planer-Eingriff): dreht die Empfehlung auf aerob/locker + Health-Hinweis.
 * Trigger (Default): cramps ≥ 4 ODER energy ≤ 2 ODER sleep ≤ 2.
 */
export function applySymptomOverride(rec: StimulusRecommendation, sym: TodaySymptoms | null | undefined, enabled: boolean): StimulusRecommendation {
  if (!enabled || !sym) return rec;
  const reasons: string[] = [];
  if ((sym.cramps ?? 0) >= 4) reasons.push("starke Krämpfe");
  if (sym.energy != null && sym.energy <= 2) reasons.push("niedrige Energie");
  if (sym.sleep != null && sym.sleep <= 2) reasons.push("schlechter Schlaf");
  if (!reasons.length) return rec;
  return {
    ...rec,
    preferredFamilies: ["easy", "long"],
    cautions: [
      `Symptome heute deutlich (${reasons.join(", ")}) — Health-first: Intensität verschieben, aerob/locker; höre auf deinen Körper. Überschreibt die Kalender-Phase.`,
      ...rec.cautions,
    ],
    rationale: "Symptom-Override aktiv: die heutigen Symptome überschreiben jeden phasenbasierten Vorschlag.",
    isHypothesis: false,
    active: false, // beratend, kein Planer-Eingriff (Entscheidung: nur Anzeige)
    symptomOverride: { active: true, reasons },
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
  // Teil 4: Symptome des Session-Tages (aus cycle_symptoms_v2, per Datum gejoint). 1..5.
  cramps?: number | null; energy?: number | null; sleep?: number | null; mood?: number | null; flow?: number | null;
  // Teil 5: Zyklus-Nummer der Session (aus Perioden abgeleitet) — für die Replikations-Bedingung (n_cycles).
  cycle_index?: number | null;
}
export interface StimulusEvidence {
  phase: CyclePhase; stimulus: string; n_sessions: number; n_cycles: number; mean_quality: number | null;
  effect_size: number | null;            // Hedges' g: Phase gegen die ÜBRIGEN Phasen desselben Reizes (kein Selbst-Bias)
  ci_low: number | null; ci_high: number | null; ci_excludes_zero: boolean;
  confidence: Confidence; prior_weight: number; posterior_weight: number;
}
export interface PhaseSymptomStat {
  phase: CyclePhase; n: number; meanBurden: number | null; // Symptom-Last ~[-1..+1], höher = schlechterer Tag
  cramps: number | null; energy: number | null; sleep: number | null;
}
export interface PhaseStimulusResult {
  evidence: StimulusEvidence[];
  symptomByPhase: PhaseSymptomStat[]; // Outcome-Achse (b): Symptomschwere je Phase (deskriptiv)
  symptomAdjusted: boolean;           // wurde die Within-Phase-Kovariaten-Korrektur (a) angewandt?
  symptomSlope: number | null;        // β: Effekt einer Einheit Symptom-Tagesabweichung auf das Outcome (transparent)
}
const N_FULL = 8; // ab so vielen sauberen Sessions dominiert der individuelle Posterior (BUILDPLAN §3.3)
const round2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const varianceOf = (xs: number[], m: number) => (xs.length > 1 ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) : 0);
/**
 * Konfidenz aus DATENMENGE + REPLIKATION: n_cycles < 2 deckelt bei 'exploratory' — ein einzelner Zyklus kann
 * einen Effekt nicht replizieren (Wasserfestigkeit gegen Einzel-Zyklus-Überanpassung).
 */
function confFromEvidence(n: number, nCycles: number): Confidence {
  if (n < 3) return "insufficient";
  if (nCycles < 2) return "exploratory";       // nur ein Zyklus → nicht replizierbar
  if (n < 8) return "low";
  if (n < 12) return "medium";
  return "high";
}
/**
 * Standardisierte Effektgröße Gruppe A vs. B als Hedges' g (Cohen's d mit Small-Sample-Korrektur J) inkl. echtem
 * Standardfehler und 95%-CI. Gepoolte SD mit Floor (0.5) gegen überzogene Effekte bei Mini-Varianz. A,B ≥ 2 nötig.
 */
function hedgesG(a: number[], b: number[]): { g: number; ciLow: number; ciHigh: number } | null {
  const nA = a.length, nB = b.length;
  if (nA < 2 || nB < 2) return null;
  const mA = mean(a), mB = mean(b);
  const vA = varianceOf(a, mA), vB = varianceOf(b, mB);
  const df = nA + nB - 2;
  const sp = Math.sqrt(Math.max(((nA - 1) * vA + (nB - 1) * vB) / df, 0.25)); // Var-Floor 0.25 → SD ≥ 0.5
  const d = (mA - mB) / sp;
  const J = 1 - 3 / (4 * df - 1);                                            // Small-Sample-Korrektur
  const g = J * d;
  const se = J * Math.sqrt((nA + nB) / (nA * nB) + (d * d) / (2 * df));      // SE(g), Hedges 1985
  return { g: round2(g), ciLow: round2(g - 1.96 * se), ciHigh: round2(g + 1.96 * se) };
}
/** Zyklus-Nummer eines Datums = Index des jüngsten Perioden-Starts ≤ Datum (0-basiert); null vor dem ersten Start. */
export function cycleIndexOf(date: string, sortedStarts: string[]): number | null {
  let idx: number | null = null;
  for (let i = 0; i < sortedStarts.length; i++) { if (sortedStarts[i] <= date) idx = i; else break; }
  return idx;
}
/** Outcome je Session auf ~[-2..+2]: felt_vs_expected primär, RPE (invertiert, zentriert) sekundär. */
function sessionOutcome(r: FeedbackRow): number | null {
  const felt = r.felt_vs_expected != null ? r.felt_vs_expected : null;
  const rpeTerm = r.rpe != null ? -(r.rpe - 5.5) / 2.25 : null; // RPE 1 → +2, 10 → −2 (niedriger = besser gelaufen)
  if (felt != null && rpeTerm != null) return 0.75 * felt + 0.25 * rpeTerm;
  if (felt != null) return felt;
  if (rpeTerm != null) return rpeTerm;
  return null;
}
/** Symptom-Last des Tages ~[-1..+1] (höher = schlechter): cramps↑, energy/sleep/mood↓. Ø der vorhandenen Felder. */
function symptomBurden(r: FeedbackRow): number | null {
  const terms: number[] = [];
  if (r.cramps != null) terms.push((r.cramps - 3) / 2);
  if (r.energy != null) terms.push((3 - r.energy) / 2);
  if (r.sleep != null) terms.push((3 - r.sleep) / 2);
  if (r.mood != null) terms.push((3 - r.mood) / 2);
  return terms.length ? terms.reduce((a, b) => a + b, 0) / terms.length : null;
}
/** Outcome-Achse (b): mittlere Symptomschwere je Phase — beschreibend, unabhängig von der Reiz-Auswertung. */
function summarizeSymptomsByPhase(clean: FeedbackRow[]): PhaseSymptomStat[] {
  const meanOf = (rs: FeedbackRow[], sel: (r: FeedbackRow) => number | null | undefined) => {
    const xs = rs.map(sel).filter((x): x is number => x != null);
    return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
  };
  return CYCLE_PHASES.map((ph) => {
    const rs = clean.filter((r) => r.cycle_phase === ph);
    const burdens = rs.map(symptomBurden).filter((x): x is number => x != null);
    return {
      phase: ph, n: rs.length,
      meanBurden: burdens.length ? Math.round((burdens.reduce((a, b) => a + b, 0) / burdens.length) * 100) / 100 : null,
      cramps: meanOf(rs, (r) => r.cramps), energy: meanOf(rs, (r) => r.energy), sleep: meanOf(rs, (r) => r.sleep),
    };
  }).filter((s) => s.n > 0);
}
/**
 * N-of-1-Auswertung (BUILDPLAN §3.2): je (Phase × Reiz) die standardisierte Abweichung vom Athletin-Reiz-Baseline.
 * Confounder (krank/Taper/Race) ausgeschlossen. Konfidenz aus n. „auswerten zuerst" — erzeugt KEINE aktive Steuerung.
 *
 * Teil 4 — Symptome:
 *  (a) KOVARIATE: das Outcome wird um die WITHIN-PHASE-zentrierte Symptomlast korrigiert. So wird nur das
 *      Tages-Rauschen (Symptome schlechter/besser als für diese Phase typisch) herausgerechnet — das
 *      phasen-durchschnittliche Symptomniveau bleibt, weil es echtes Phasen-Signal ist (keine Über-Adjustierung).
 *      Pooled Slope β (transparent), nur ab genug Symptom-Sessions und mit Streuung.
 *  (b) OUTCOME-ACHSE: separat die mittlere Symptomschwere je Phase (deskriptiv).
 */
export function evaluatePhaseStimulus(feedback: FeedbackRow[]): PhaseStimulusResult {
  // saubere Zeilen mit gültiger Phase (Confounder raus) — Basis für beide Achsen.
  const clean = feedback.filter((r) => !r.confounder_flag && r.cycle_phase && CYCLE_PHASES.includes(r.cycle_phase as CyclePhase));
  const symptomByPhase = summarizeSymptomsByPhase(clean);

  // Für die Reiz-Auswertung zusätzlich Reiz + verwertbares Outcome nötig (inkl. Zyklus-Nummer für Replikation).
  const withOut = clean
    .filter((r) => r.session_family)
    .map((r) => ({ phase: r.cycle_phase as CyclePhase, stim: r.session_family as string, out: sessionOutcome(r), burden: symptomBurden(r), cycle: r.cycle_index ?? null }))
    .filter((r) => r.out != null) as { phase: CyclePhase; stim: string; out: number; burden: number | null; cycle: number | null }[];
  if (!withOut.length) return { evidence: [], symptomByPhase, symptomAdjusted: false, symptomSlope: null };

  // (a) Within-Phase-Symptomlast → pooled Slope β = cov(out, dev)/var(dev). dev = Symptomlast − Phasen-Mittel.
  const meanBurdenByPhase = new Map<CyclePhase, number>();
  const byPh = new Map<CyclePhase, number[]>();
  for (const r of withOut) if (r.burden != null) (byPh.get(r.phase) ?? byPh.set(r.phase, []).get(r.phase)!).push(r.burden);
  for (const [ph, xs] of byPh) meanBurdenByPhase.set(ph, xs.reduce((a, b) => a + b, 0) / xs.length);
  const devPairs = withOut.filter((r) => r.burden != null).map((r) => ({ out: r.out, dev: r.burden! - (meanBurdenByPhase.get(r.phase) ?? 0) }));
  let slope: number | null = null;
  if (devPairs.length >= 6) {
    const mDev = devPairs.reduce((a, b) => a + b.dev, 0) / devPairs.length;
    const mOut = devPairs.reduce((a, b) => a + b.out, 0) / devPairs.length;
    let cov = 0, varr = 0;
    for (const pr of devPairs) { cov += (pr.dev - mDev) * (pr.out - mOut); varr += (pr.dev - mDev) ** 2; }
    if (varr > 1e-6) slope = cov / varr;
  }
  const adj = withOut.map((r) => ({
    phase: r.phase, stim: r.stim, cycle: r.cycle,
    out: slope != null && r.burden != null ? r.out - slope * (r.burden - (meanBurdenByPhase.get(r.phase) ?? 0)) : r.out,
  }));

  // Reiz-Auswertung als PHASE-GEGEN-REST-Kontrast (kein Selbst-Bias durch Einschluss der Phase im Baseline).
  // Je Reiz: A = Sessions dieser Phase, B = Sessions ALLER anderen Phasen → Hedges' g mit CI. n_cycles = Replikation.
  const byStim = new Map<string, { phase: CyclePhase; out: number; cycle: number | null }[]>();
  for (const r of adj) (byStim.get(r.stim) ?? byStim.set(r.stim, []).get(r.stim)!).push(r);
  const evidence: StimulusEvidence[] = [];
  for (const [stim, items] of byStim) {
    const phasesHere = [...new Set(items.map((i) => i.phase))];
    for (const phase of phasesHere) {
      const inPhase = items.filter((i) => i.phase === phase);
      const rest = items.filter((i) => i.phase !== phase);
      const n = inPhase.length;
      const nCycles = new Set(inPhase.map((i) => i.cycle).filter((c) => c != null)).size;
      const g = hedgesG(inPhase.map((i) => i.out), rest.map((i) => i.out)); // null bei nA<2 oder nB<2
      const posterior = Math.min(1, n / N_FULL);
      const ciExcludes = g != null && (g.ciLow > 0 || g.ciHigh < 0);
      evidence.push({
        phase, stimulus: stim, n_sessions: n, n_cycles: nCycles, mean_quality: round2(mean(inPhase.map((i) => i.out))),
        effect_size: g ? g.g : null, ci_low: g ? g.ciLow : null, ci_high: g ? g.ciHigh : null, ci_excludes_zero: ciExcludes,
        confidence: confFromEvidence(n, nCycles), prior_weight: round2(1 - posterior), posterior_weight: round2(posterior),
      });
    }
  }
  evidence.sort((a, b) => (CYCLE_PHASES.indexOf(a.phase) - CYCLE_PHASES.indexOf(b.phase)) || a.stimulus.localeCompare(b.stimulus));
  return { evidence, symptomByPhase, symptomAdjusted: slope != null, symptomSlope: slope != null ? Math.round(slope * 100) / 100 : null };
}

// ---- Planungs-Steuerung (Teil: „Zyklus steuert den Plan") — pure, bounded, gestuft --------------------------------
export interface ProjectedPhase { phase: CyclePhase | null; cycleDay: number | null; projected: boolean; confidence: Confidence }
const CONF_LADDER: Confidence[] = ["insufficient", "exploratory", "low", "medium", "high"];
const decayConf = (c: Confidence, steps: number): Confidence => CONF_LADDER[Math.max(0, CONF_RANK[c] - Math.max(0, steps))];
/**
 * Zyklusphase für ein (auch ZUKÜNFTIGES) Datum — für die Blockplanung/Timeline. Bis 45 Tage nach dem letzten Start =
 * echte Phase (wie computeCyclePhase). Weiter voraus nur bei STABILEM natürlichem Zyklus mit der Median-Länge
 * fortgerollt (prognostiziert, Konfidenz sinkt je Zyklus voraus); sonst null. Stabilität wird an HEUTE bewertet
 * (nicht am Zukunftsdatum — sonst würde daysSinceLast fälschlich das Amenorrhö-Flag auslösen). Kein Leakage in die
 * Vergangenheit: `computeCyclePhase` bleibt für das rückwirkende Session-Tagging die Quelle.
 */
export function projectedPhaseForDate(
  periods: Period[], contraception: ContraceptionStatus | null | undefined, date: string, today: string,
): ProjectedPhase {
  const mode = contraceptionMode(contraception);
  if (mode === "suppressed") return { phase: null, cycleDay: null, projected: false, confidence: "insufficient" };
  const starts = periods.map((p) => p.start_date).filter((d) => d && d <= date).sort();
  if (!starts.length) return { phase: null, cycleDay: null, projected: false, confidence: "insufficient" };
  const stab = evaluateCycleStability(periods, today);
  const lastStart = starts[starts.length - 1];
  const daysOut = daysBetween(lastStart, date);
  const isFuture = date > today;
  const len = stab.medianLength && stab.medianLength >= 21 && stab.medianLength <= 45 ? stab.medianLength : 28;
  if (daysOut > 45 && !(mode === "natural" && stab.regularity === "stable")) {
    return { phase: null, cycleDay: daysOut + 1, projected: isFuture, confidence: "insufficient" };
  }
  const dayInCycle = (daysOut % len) + 1;
  const cyclesAhead = Math.max(0, Math.floor(daysOut / len));
  const base: Confidence = mode === "uncertain" ? "low" : stab.regularity === "stable" ? "medium" : stab.regularity === "irregular" ? "low" : "insufficient";
  return { phase: phaseFromCycleDay(dayInCycle, len), cycleDay: dayInCycle, projected: isFuture, confidence: decayConf(base, cyclesAhead) };
}

export interface CyclePlanningBias {
  phase: CyclePhase | null;
  emphasis: string | null;      // Planer-Emphasis (vo2|schwelle|berg|norwegian|fartlek) oder null (kein Typ-Tilt)
  loadFactor: number;           // sanfter Wochenlast-Faktor (~0.9..1.08)
  qualityVolFactor: number;     // Qualitäts-Volumen-Dämpfung (~0.8..1) bei aerob-/soften-Phasen
  tier: "measured" | "prior" | null;
  soften: boolean;
  reason: string | null;
}
// Reiz-Familie → Planer-Emphasis-Vokabular (workouts.ts pickWeekWorkouts). long/easy = KEIN Qualitäts-Tilt → aerob/soften.
const FAMILY_TO_EMPHASIS: Record<string, string> = { vo2: "vo2", threshold: "schwelle", hill: "berg", norwegian: "norwegian", speed: "fartlek" };
// Phasen-Last-Prior (sanft, health-first, physiologisch): Menstruation/späte Luteal etwas runter, Follikel leicht rauf.
const PHASE_LOAD: Record<CyclePhase, number> = { menstrual: 0.94, follicular: 1.05, ovulation: 1.02, early_luteal: 1.0, late_luteal: 0.96 };
/**
 * Gestufte, gebundene Planungs-Steuerung je Phase (der 4. Steuer-Input, „Typ + sanfte Last"):
 *  - belastbar GEMESSEN (`isReliable`: Konf≥mittel · CI≠0 · |g|≥0.2 · ≥2 Zyklen) → voller Typ-Tilt + Phasen-Last-Faktor.
 *  - sonst schwacher Prior (`PHASE_PRIOR`) → nur sanfter Tie-Breaker (halber Last-Nudge), tier `prior` (= Hypothese).
 *  - ohne Master-Schalter (`adaptiveEnabled`) oder ohne Gate → tier `null` (kein Eingriff, nur Anzeige).
 *  - heutiger Symptom-Override → soften erzwungen (health-first). Alles klein & geklemmt; Periodisierung/km-Ceiling/
 *    Health-Cap übersteuern IMMER (das passiert eine Ebene höher in blockPlan).
 */
export function cyclePlanningBias(
  phase: CyclePhase | null,
  calibrated: CalibratedTendency[],
  gate: GateResult,
  opts: { adaptiveEnabled?: boolean; symptomOverride?: boolean } = {},
): CyclePlanningBias {
  const off: CyclePlanningBias = { phase, emphasis: null, loadFactor: 1, qualityVolFactor: 1, tier: null, soften: false, reason: null };
  if (!phase || !gate.passed || !opts.adaptiveEnabled) return off;
  if (opts.symptomOverride) {
    return { phase, emphasis: null, loadFactor: 0.92, qualityVolFactor: 0.8, tier: "measured", soften: true,
      reason: `Zyklus (${PHASE_LABEL[phase]}): heutige Symptome deutlich → Qualität sanfter, Last −8 % (health-first).` };
  }
  const here = calibrated.filter((c) => c.phase === phase);
  const reliablePos = here.filter((c) => isReliable(c) && (c.effect ?? 0) > 0).sort((a, b) => (b.effect ?? 0) - (a.effect ?? 0));
  const reliableAny = here.some((c) => isReliable(c));
  const loadPhase = PHASE_LOAD[phase];
  if (reliableAny) {
    const top = reliablePos[0];
    const emph = top ? (FAMILY_TO_EMPHASIS[top.stimulus] ?? null) : null;
    const soften = !emph;
    return { phase, emphasis: emph, loadFactor: round2(clamp(loadPhase, 0.9, 1.08)), qualityVolFactor: soften ? 0.85 : 1, tier: "measured", soften,
      reason: emph
        ? `Zyklus (${PHASE_LABEL[phase]}, gemessen): ${famLabel(top!.stimulus)} wirkt bei dir hier überdurchschnittlich → betont.`
        : `Zyklus (${PHASE_LABEL[phase]}, gemessen): hier lockere/aerobe Reize besser → Qualität sanfter.` };
  }
  const priorFams = PHASE_PRIOR[phase]?.families ?? [];
  const emphP = priorFams.map((f) => FAMILY_TO_EMPHASIS[f]).find((e): e is string => !!e) ?? null;
  const soften = !emphP && (phase === "menstrual" || phase === "late_luteal");
  if (!emphP && !soften) return { phase, emphasis: null, loadFactor: 1, qualityVolFactor: 1, tier: "prior", soften: false, reason: null };
  const loadPrior = 1 + (loadPhase - 1) * 0.5;
  return { phase, emphasis: emphP, loadFactor: round2(clamp(loadPrior, 0.94, 1.05)), qualityVolFactor: soften ? 0.9 : 1, tier: "prior", soften,
    reason: emphP
      ? `Zyklus (${PHASE_LABEL[phase]}, Hypothese): ${famLabel(priorFams[0])} könnte hier besser anschlagen → leicht betont (noch nicht an deinen Daten bestätigt).`
      : `Zyklus (${PHASE_LABEL[phase]}, Hypothese): tendenziell lockerer → Qualität leicht sanfter (health-first).` };
}
