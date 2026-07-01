// Schlanke API-Schicht.
import type { Option } from "./options.ts";

export interface Profile { id: number; name: string; }
export interface RaceSplit { km?: number | null; time_s?: number | null; pace_s?: number | null; avg_hr?: number | null; max_hr?: number | null; elevation_m?: number | null; }
export interface Race {
  id?: number; date: string; name?: string; distance_m?: number | null; time_s?: number | null;
  placement?: string; notes?: string; splits?: RaceSplit[];
  max_hr?: number | null; avg_hr?: number | null; elevation_m?: number | null; source?: string;
  activity_id?: number | null; // v0.14.0: verknüpfte getrackte Einheit (Race aus Tracking)
  goal_time_s?: number | null;  // v1.7.0: Wunsch-Zielzeit → treibt die Pace-Progression
  is_tuneup?: number | boolean | null; // v1.10.0: Test-/Aufbauwettkampf (Mini-Taper statt voller Taper)
}
export interface TuneupProgress {
  tuneup: { date: string; name: string | null; distanceM: number; timeS: number; vdot: number; expectedTimeS: number | null; vsExpectedS: number | null } | null;
  goal?: { date: string; distanceM: number; goalTimeS: number; goalVdot: number; weeksTo: number; predictedTimeS: number | null; deltaS: number | null; status: "ahead" | "on_track" | "behind" | "unknown" };
}
// C1 (#9): Prognose-Zeit als Bereich Bestfall–Realistisch.
export interface PredRange { time_s: number; best_s: number; realistic_s: number; }
export interface EffVo2Src { value: number; confidence: "hoch" | "mittel" | "niedrig"; calibrated: boolean; level?: string | null; }
// ML-Engine (Plan: ML-Trainingssteuerung)
export interface MlSettings { profile_id: number; enabled: number; channel_count: number; channel_auto: number; mcid_json: string | null; forgetting_halflife_days: number; sensitivity: number; research_mode_enabled: number; schedule_mode: string; }
export interface MlFreshness { state: "fresh" | "stale" | "none" | "running"; runId: number | null; lastRun: string | null; reason?: string; }
export interface MlRun { id: number; kind: string; status: string; progress: number; error: string | null; input_hash: string | null; model_version: string | null; engine: string | null; finished_at: string | null; created_at: string; }
export interface MlStatus { freshness: MlFreshness; latest: MlRun | null; }
export interface MlLatentPoint { date: string; value: number; sd: number; }
export interface MlEffect { channel: string; target: string; gain_mean: number | null; ci_low: number | null; ci_high: number | null; n_blocks: number | null; collinearity_flag: number; mcid_pass: number; confidence: string; p_boot: number | null; q_fdr: number | null; e_value: number | null; e_value_ci: number | null; fdr_survive: number; }
export interface MlVerdict { kind: "ranked" | "null" | "insufficient"; text: string; ranking?: string[]; }
export interface MlLadderStep { count: number; channels: string[]; identifiable: boolean; reason: string; maxVif: number; sparseChannels: string[]; }
export interface MlHypothesis { kind: string; text: string; strength: number; }
export interface MlEffectsMeta { activeCount: number; ladder: MlLadderStep[]; channels: string[]; auto?: boolean; start?: number; changepoints?: string[]; exploratory?: { hypotheses: MlHypothesis[]; note: string }; verdict: { mediator: MlVerdict; composition: MlVerdict }; }
export interface MlEffects { runId: number | null; finishedAt: string | null; meta: MlEffectsMeta | null; mediator: MlEffect[]; composition: MlEffect[]; }
export type MlKindName = "latent_fitness" | "dose_response" | "readiness";
export interface MlReadinessPoint { date: string; value: number; sd: number; }
export interface MlHealthFlag { date: string; kind: string; severity: string; message: string; }
export interface MlReadiness { runId: number | null; finishedAt: string | null; meta: { insufficient?: boolean; nDays?: number; drivers?: string[]; disclaimer?: string; bmi?: number | null } | null; points: MlReadinessPoint[]; flags: MlHealthFlag[]; }
export interface MlFeedback { id?: number; activity_id?: number | null; date?: string; session_family?: string | null; rpe?: number | null; felt_vs_expected?: number | null; life_stress?: number | null; notes?: string | null; }
// P5 — prospektiv randomisierte N-of-1-Blöcke (der einzige kausale Pfad)
export interface MlProspectiveArm { kind: "channel" | "regime"; value: string; label: string; }
export interface MlProspectiveProposal {
  kind: "channel" | "regime";
  armA: MlProspectiveArm; armB: MlProspectiveArm;
  rationale: string; overlap: number | null; source: "effects" | "default"; proposalHash: string;
  defaults: { nPairsPlanned: number; blockWeeks: number; washoutWeeks: number; lagWeeks: number; mcid: number; alpha: number; pairsForSignif: number };
}
export interface MlProspectiveBlock { pair: number; arm: string; startDate: string; endDate: string; outcome?: number | null; outcomeSd?: number | null; excluded?: boolean; }
export interface MlProspectiveTrial {
  id: number; profile_id: number; state: string | null; trial_kind: string | null;
  arm_a: string | null; arm_b: string | null; arm_a_label: string | null; arm_b_label: string | null;
  start_date: string; end_date: string | null; seed: number | null;
  n_pairs_planned: number | null; n_pairs_done: number | null;
  verdict: string | null; theta: number | null; p_exact: number | null;
  lag_weeks: number | null; washout: number | null;
  consented_at: string | null; proposal_hash: string | null;
  config_json: string | null; blocks_json: string | null;
  label: string | null; notes: string | null; created_at: string;
}
export interface MlProspectiveState { trials: MlProspectiveTrial[]; proposal: MlProspectiveProposal | null; }
export interface MlAcceptTrialBody {
  kind: "channel" | "regime"; armA: { value: string; label: string }; armB: { value: string; label: string };
  nPairsPlanned: number; proposalHash: string; consentedAt: string;
  lagWeeks?: number; blockWeeks?: number; washoutWeeks?: number; mcid?: number; alpha?: number;
}
// P5-Folge: Auto-Plan des aktuellen Trial-Blocks (load-matched, getaggt)
export interface MlTrialBlockDay { date: string; type: string; planned_min: number; planned_tss: number; description: string; isSecond: boolean; week_no: number | null; }
export interface MlTrialBlockGen {
  block: { pair: number; arm: string; startDate: string; endDate: string };
  armLabel: string; emphasis: string; regime: string; note: string; days: MlTrialBlockDay[];
}
export interface MlTrialPlanResult { ok: boolean; written: number; skipped: number; block: { startDate: string; endDate: string }; armLabel: string; }
// P6 — Zyklus-Steuerung (Gerüst, Consent-Hard-Gate)
export type CycleMethod = "none" | "combined_pill" | "progestin_pill" | "hormonal_iud" | "copper_iud" | "implant" | "injection" | "ring" | "patch" | "unknown";
export interface CycleGate { passed: boolean; mode: string; regularity: string; nCycles: number; medianLength: number | null; reasons: string[]; healthFlags: { kind: string; message: string }[]; observationMode: boolean; }
export interface CyclePhaseInfo { phase: string | null; cycleDay: number | null; mode: string; confidence: string; }
export interface CycleRecommendation { preferredFamilies: string[]; cautions: string[]; rationale: string; confidence: string; isHypothesis: boolean; active: boolean; }
export interface CyclePeriodRow { id: number; start_date: string; end_date: string | null; }
export interface CycleSettings { profile_id?: number; cycle_adaptive_enabled: number; method_emphasis: string; method_emphasis_weight?: number; feedback_sensitivity?: number; symptom_override_enabled?: number; observation_mode_only: number; }
export interface CycleStatus {
  needsConsent: boolean;
  contraception?: { method: CycleMethod };
  gate?: CycleGate; phase?: CyclePhaseInfo; recommendation?: CycleRecommendation;
  settings?: CycleSettings; periods?: CyclePeriodRow[];
}
export interface CycleSymptom { id?: number; date: string; cramps: number | null; energy: number | null; sleep: number | null; mood: number | null; flow: number | null; notes?: string | null; }
export interface CycleEvidence { phase: string; stimulus: string; n_sessions: number; mean_quality: number | null; effect_size: number | null; ci_low: number | null; ci_high: number | null; confidence: string; prior_weight: number; posterior_weight: number; }
export interface CyclePhaseSpan { from: string; to: string; phase: string; }
export interface GoalGap {
  race: { id: number; name: string; date: string; distance_m: number } | null;
  weeks: number; curVdot: number | null; goalVdot: number | null;
  predictedTimeS: number | null; goalTimeS: number | null; gapS: number | null;
  reqVdotPerWeek: number | null; feasible: boolean | null; projEndTimeS: number | null;
  // C1: zweite Quelle effektive VO2max (Q1 getrennt, Q2 Fallback) + Bereiche (Q4).
  predictedRange?: PredRange | null;
  effVo2?: EffVo2Src | null;
  predictedEffTimeS?: number | null;
  predictedEffRange?: PredRange | null;
}
// Lauf-Power (Coros via Strava, Stryd-Stil) — v1.7.0
export interface PowerZoneBand { z: number; name: string; lo: number; hi: number | null }
export interface PowerCurve {
  window: number; n: number; curve: Record<number, number>; durations: number[];
  cp: number | null; wPrime: number | null; rSquared: number | null;
  zones: PowerZoneBand[];
  recent: { date: string; name: string | null; runNp: number | null; rss: number | null }[];
}
export interface CpTrend { points: { date: string; cp: number }[] }
// Optimale Zonen (Pace/HF/Watt) — v1.9.0
export interface OptimalZones {
  pace_zones: number[]; hr_zones: HrZone[]; power_zones: number[] | null;
  threshold_pace: number; lthr: number; cp: number | null;
  sources: { pace: string; hr: string; power: string | null };
}
export interface OptimalZonesResult { zones: OptimalZones | null; vdot: number | null; today: string }
export interface ThresholdTrend { points: { date: string; thrPace: number | null; cp: number | null }[] }
export interface RunEffectiveness { window: number; mass: number; n: number; points: { date: string; re: number }[]; early: number | null; late: number | null; deltaPct: number | null }
export interface WPrimeLatest {
  available: boolean;
  activity?: { id: number; date: string; name: string | null; type: string };
  cp?: number; wPrime?: number; minBal?: number; minPct?: number; timeInDeficitS?: number; tau?: number;
  curve?: { t: number; bal: number }[]; verdict?: string;
}

// Bestzeiten + VDOT-Prognose (v0.14.0, ToDo 8)
export interface Pb { distance_m: number; time_s: number; pace_s: number; date: string; name: string; manual?: boolean; }
export interface PredItem extends PredRange { distance_m: number; }
export interface BestsResult {
  pbs: Pb[]; vdot: number | null; vdotLevel: string | null; age: number | null;
  predictions: PredItem[];
  // C1 (#9): zweite, getrennt ausgewiesene Quelle (effektive VO2max, labor-kalibriert).
  effVo2?: EffVo2Src | null;
  predictionsEff?: PredItem[];
}
// Lifetime-Summen für das „Lab Mode"-Panel (M7 Easter Egg).
export interface Overview { n: number; dist_m: number; elev_m: number; moving_s: number; kcal: number; }
// VO2max/VDOT + Renn-Prognose-Verlauf (v0.15.0, O1/O2)
export interface FitnessTrendPoint { date: string; vdot: number | null; p5000: number | null; p10000: number | null; p21097: number | null; p42195: number | null; }
export interface FitnessTrend { points: FitnessTrendPoint[]; current: FitnessTrendPoint | null; age: number | null; level: string | null; }
export interface Vo2maxLab { id: number; profile_id: number; date: string; value: number; source?: string | null; notes?: string | null; created_at: string; }
export interface EffVo2maxPoint { date: string; est: number; calibrated: number; }
export interface EffVo2maxTrend { points: EffVo2maxPoint[]; lab: { date: string; value: number }[]; calibrated: boolean; }
export interface PlanAdherenceWeek { week_no: number; start: string; end: string; pct: number | null; n: number; }
// Seiten-Layout (T8): freies Raster (react-grid-layout-Koordinaten) je Chart-Block.
// x/y/w/h in Rastereinheiten (12 Spalten); fehlende Felder → Default des Blocks.
export interface BlockOverride { x?: number; y?: number; w?: number; h?: number; hidden?: boolean; page?: number; }
export type LayoutMap = Record<string, BlockOverride>;

export interface HrZone { z: number; min: number; max: number; label: string; color: string; }
export interface ZoneSet { id: number; valid_from?: string; hr_zones: HrZone[]; hr_zones_bike?: HrZone[] | null; pace_zones: number[]; speed_zones?: number[]; power_zones?: number[]; lthr: number; ftp: number; threshold_pace: number; source?: string; note?: string; }
export interface SeasonWeek { week_no: number; label: string; phase: string; start_date: string; end_date: string; target_km: number | null; target_km_bike?: number | null; goal_race: string; notes: string; }
export interface ZoneAlloc { byKm?: Record<number, number>; byMin?: Record<number, number>; }
/** Strukturierte Belastung (Intervall/Schwelle): pro Wiederholung Zeit/Distanz/Pace/HF — ToDo 1/20.
 *  v0.12.0 (ToDo 2): kann auch eine eine-Ebene-Gruppe sein (`group`, `reps`, `children`) für Coros-Sets
 *  wie 3×(1000+200). Gruppen-`children` sind immer Leaf-Efforts (keine weitere Verschachtelung). */
export interface Effort {
  reps?: number; sec?: number | null; dist_m?: number | null; pace_s?: number | null;
  avg_hr?: number | null; max_hr?: number | null; zone?: number | null; label?: string;
  group?: boolean; children?: Effort[];
  rest_s?: number | null; rest_type?: "jog" | "stand" | null; hr_recovery?: number | null; // v1.6.0: Intervall-Pause
  // T7 (v1.11.0): von-bis-Bänder. reps = empfohlener Zielwert (heute), reps_lo/hi = Band; pace_lo/hi = Pace-Band.
  reps_lo?: number | null; reps_hi?: number | null; pace_lo?: number | null; pace_hi?: number | null;
}
export interface PlannedSession {
  id?: number; date: string; week_no?: number | null; sport: string; type: string;
  planned_km?: number | null; planned_min?: number | null; zone_alloc?: ZoneAlloc | null;
  description?: string; structured?: unknown; efforts?: Effort[] | null; planned_tss?: number | null; sort_order?: number;
  prescription?: Prescription | null; // v1.7.0 Live-Resolution-Intention
  adaptNote?: string | null;          // T7: „angepasst an …" (live aufgelöst)
}
// Einheiten-Vorlage = Inhalt einer PlannedSession ohne Datum/Woche (per Klick in einen Tag einsetzbar).
export interface SessionTemplate {
  id?: number; name: string; sport: string; type: string;
  planned_km?: number | null; planned_min?: number | null; zone_alloc?: ZoneAlloc | null;
  description?: string; efforts?: Effort[] | null; sort_order?: number;
}
export interface Activity {
  id?: number; strava_id?: string | null; date: string; sport: string; type?: string | null; source: string; name?: string;
  distance_m?: number | null; moving_s?: number | null; elapsed_s?: number | null; avg_hr?: number | null;
  max_hr?: number | null; avg_power?: number | null; elevation?: number | null; avg_cadence?: number | null;
  training_load?: number | null; tss?: number | null; kcal?: number | null;
  ngp?: number | null; np?: number | null; // grade-adjusted Pace (s/km, Lauf) / Normalized Power (W, Rad)
  decoupling?: number | null; // aerobe Entkopplung Pa:HR (%, Lauf) — v1.2.0
  zones?: Record<number, number> | null; zone_min?: Record<number, number> | null;
  zone_km?: Record<number, number> | null; efforts?: Effort[] | null;
  overrides?: string[]; matched_session_id?: number | null; notes?: string;
}
export interface DailyLog { date: string; [k: string]: unknown; }
export interface PmcPoint { date: string; tss: number; ctl: number; atl: number; tsb: number; planned?: boolean; }
export interface Flag { level: "ok" | "info" | "warn" | "danger"; code: string; message: string; params?: Record<string, string | number | null>; }
export interface WeekTotals {
  km: number; bike_km: number; min: number; tss: number; sessions: number; runSessions: number;
  hardSessions: number; longestKm: number; zoneMin: Record<number, number>;
  intensity: { easy: number; mod: number; hard: number };
  // ToDo 21 — Kategorie-Summen (Agent A füllt, Agent C zeigt): Lauf / Rad(indoor+outdoor) / Kraft+Mobility(nur Zeit)
  byCategory?: { run: { km: number; min: number }; bike: { km: number; min: number }; strength: { min: number } };
}
export interface IntensityShare { easy: number; mod: number; hard: number; }
export interface WeekRating { level: "easy" | "moderate" | "hard"; weekTss: number; avg4: number; }
export interface AnalyzeResult {
  totals: WeekTotals; flags: Flag[]; zones: HrZone[]; week: SeasonWeek | null;
  projectedCtlRamp: number | null; projectedTsb: number | null;
  pmc?: { ctl: number; atl: number; tsb: number; ramp: number | null; spark: { d: string; ctl: number; tsb: number }[] } | null; // v1.9.0 Wochen-Header-PMC
  vo2max?: { now: number; prev: number | null } | null; // v1.9.0 Wochenbericht-Kopf
  // ToDo #7/#13 — TSS-basierte Intensität (optional, defensiv konsumieren)
  tssIntensity?: IntensityShare; zoneKmIntensity?: IntensityShare; weekRating?: WeekRating | null;
  // ToDo Z.7 — reale TSS-Intensität (hybrid) + reale Gesamt-TSS für den „Real"-Donut
  realTssIntensity?: IntensityShare; realTotalTss?: number;
  // v0.11.0 (ToDo 2) — reale Schilder für den Wochenbericht (Planung nutzt `flags` = geplant).
  realLoadFlag?: Flag | null; realKmFlag?: Flag | null; realKmIntensity?: IntensityShare;
  // reale + geplante Verteilung/Kategorien (vom Server geliefert)
  plannedZoneKm?: Record<number, number>;
  realZoneMin?: Record<number, number>; realZoneKm?: Record<number, number>;
  realByCategory?: { run: { km: number; min: number; h: number }; bike: { km: number; min: number; h: number }; strength: { min: number; h: number } };
  // v0.14.0 (ToDo 12) — Plan-Erfüllung je gematchter Einheit + Wochenmittel
  adherence?: { perSession: { session_id: number; date: string; type: string; pct: number; tssOnly: boolean }[]; weekPct: number | null; matchByActivity?: Record<number, number> };
  // v0.15.0 (O4) — TSS-Wochenempfehlung (Korridor) aus CTL + Saisonplan-Phase, 3:1-Prinzip
  tssRec?: { min: number; max: number; target: number; level: "under" | "ok" | "over"; phaseLabel: string; basis: string } | null;
  // v1.2.0 — Trainings-Monotonie & -Strain (Foster) der realen Woche
  monotony?: number; strain?: number; monotonyFlag?: Flag | null;
  // v1.3.0 (G4) — echte Zeit-in-Zone-Verteilung (Z1<LT1 / Z2 LT1–LT2 / Z3>LT2) + Polarisierungs-Index + Phasen-Ziel
  physioDist?: { z1: number; z2: number; z3: number; z1Min: number; z2Min: number; z3Min: number };
  polarizationIndex?: number | null;
  phaseTarget?: { model: "pyramidal" | "polarized" | "regenerativ"; z1: number; z2: number; z3: number; label: string; rationale?: string; overridden?: boolean };
  realPolarizationFlag?: Flag | null;
}

// v1.2.0 — Coach „Heute": Readiness + regelbasierte Tages-Empfehlung (Vorschlag-Modus).
export interface TodayResult {
  date: string;
  form: { ctl: number; atl: number; tsb: number | null; ramp: number };
  phase: string | null;
  weekTssRec: { min: number; max: number; target: number; kind: string } | null;
  readiness: { score: number; level: "green" | "yellow" | "red"; drivers: { code: string; text: string }[] } | null;
  plannedTypes: string[];
  recommendation: { headline: string; sessionType: string; doseHint: string; reasons: { code: string; text: string }[]; confidence: "hoch" | "mittel" | "niedrig" };
  adjustment: SessionAdjustment | null;
  nextHard?: { date: string; type: string; adjustment: SessionAdjustment } | null; // v1.9.0: nächste harte Einheit
}
export interface SessionAdjustment {
  changed: boolean;
  action: string;
  headline: string;
  reasons: { code: string; text: string }[];
  confidence: "hoch" | "mittel" | "niedrig";
  mode: "advisory" | "gate";
  original: { type: string; planned_tss: number };
  adjusted: { type: string; planned_min: number; zone_alloc: { byMin: Record<number, number> }; efforts: unknown[] | null; description: string; planned_tss: number; paceTarget: number | null } | null;
  originalSessionId: number;
}

// v1.3.0 (G3) — Laktat-/Feldtest-Diagnostik.
export interface LactateTestPoint {
  id?: number; stage?: number | null;
  speed_kmh?: number | null; pace_s?: number | null; power_w?: number | null;
  hr?: number | null; lactate: number; rpe?: number | null;
}
export interface LactateThresholdPoint { speed_kmh: number; pace_s: number; hr: number | null; lactate: number }
export interface LactateAnalysis {
  lt1: LactateThresholdPoint | null; lt2: LactateThresholdPoint | null;
  baseline: number; method: string; confidence: string; warnings: string[];
  fixed2: LactateThresholdPoint | null; fixed4: LactateThresholdPoint | null; fatmax: LactateThresholdPoint | null;
  r2: number | null; curve: { speed_kmh: number; pace_s: number; lactate: number }[];
}
export interface LactateTest {
  id: number; profile_id: number; date: string; sport: string; kind?: string | null; notes?: string | null;
  lt1_hr?: number | null; lt1_pace?: number | null; lt2_hr?: number | null; lt2_pace?: number | null;
  confidence?: string | null; warnings: string[]; created_at: string;
  points?: LactateTestPoint[];
  analysis?: LactateAnalysis | null; // v1.10.0 volle Auswertung (vom GET /:id)
}
export interface LactateThresholdResult {
  lt1: { speed_kmh: number; pace_s: number; hr: number | null; lactate: number } | null;
  lt2: { speed_kmh: number; pace_s: number; hr: number | null; lactate: number } | null;
  confidence: string; warnings: string[];
}
export interface LactateZoneProposal {
  valid_from: string; lthr: number; threshold_pace: number | null;
  lt1_hr: number; lt1_pace: number | null;
  hr_zones: HrZone[]; pace_zones: number[];
  source: string; note: string;
}

// v1.4.0 (A1) — Verfügbarkeits-/Präferenz-Profil (gespiegelt aus server/planbuilder.ts).
// minutesByWeekday[7]: 0=Ruhetag; Wochentag-Index 0=Mo…6=So.
export interface Availability {
  daysPerWeek?: number | null;
  minutesByWeekday: number[];
  longRunDay?: number | null;
  hardDays?: number[];
  allowDoubles?: boolean;
  doubleDays?: number[];
  hillDay?: number | null;      // v1.7.0: bevorzugter Berglauf-Tag
  corePerWeek?: number | null;  // v1.7.0: Stabi/Core-Einheiten pro Woche
  coreDays?: number[];          // v1.7.0: bevorzugte Core-Tage
  emphasis?: string | null;     // v1.8.0: Block-Schwerpunkt
  favoriteWorkouts?: string[];  // v1.8.0: bevorzugte Einheiten-IDs
  avoidWorkouts?: string[];     // v1.8.0: zu vermeidende Einheiten-IDs
}
export interface WorkoutInfo {
  id: string; name: string; family: string; purpose: string; effort: number; custom?: boolean;
  workZone?: number; anchor?: string | null; kind?: string;
  // v1.12.0: vom Server mit echten Zonen gerendert — volle Struktur + Tageswerte.
  description?: string | null; efforts?: Effort[] | null;
  planned_min?: number | null; planned_tss?: number | null; adaptNote?: string | null;
}
// Eigene Einheiten (v1.9.0, Z14)
export type CustomFamily = "Easy" | "Long" | "LT1" | "LT2" | "VO2" | "Hill" | "Speed";
// v1.12.0: rekursiver Struktur-Knoten (gespiegelt aus server/workouts.ts SegNode).
export interface SegNode {
  kind: "rep" | "group";
  reps?: number; reps_lo?: number | null; reps_hi?: number | null;
  children?: SegNode[];
  dist_m?: number | null; sec?: number | null;
  paceOffset?: number; restSec?: number | null; restType?: "jog" | "stand";
  label?: string;
}
export interface CustomInput {
  name: string; family: CustomFamily; kind: "steady" | "intervals"; workZone: number;
  minMin?: number; maxMin?: number; reps?: number; repSec?: number; repDist_m?: number; restSec?: number; phases?: string[];
  structure?: SegNode[]; // v1.12.0: frei verschachtelte Struktur (Vorrang vor Flach-Feldern)
}
export interface CustomEstimate { template: { id: string; family: string; effort: number; anchor: string | null; sessionType: string }; tssEstimate: number; durationMin: number }
export interface CustomWorkout { id: number; name: string; family: string; template: { id: string; effort: number; workZone: number; kind: string }; created_at: string }

// v1.3.0 (Engine) — Wochen-/Block-Empfehlungs-Engine.
export interface WeekSessionRec { type: string; count: number; tssShare: number; hint: string; }
export interface WeekStructureRec {
  headline: string;
  periodizationModel: "block" | "traditional";
  tssRange: { min: number; max: number; target: number; kind: string };
  sessions: WeekSessionRec[];
  distTarget: { model: string; z1: number; z2: number; z3: number; label: string };
  reasons: { code: string; text: string }[];
  confidence: "hoch" | "mittel" | "niedrig";
}
export interface WeekSuggestionResult {
  week: SeasonWeek | null;
  phase: string | null;
  form: { ctl: number; tsb: number | null; ramp: number };
  readiness: { score: number; level: "green" | "yellow" | "red"; drivers: { code: string; text: string }[] } | null;
  recommendation: WeekStructureRec;
}

// v1.4.0 (C3) — Zonen-Histogramm (aggregierte Zeit in HF/Pace-Zonen)
export interface ZoneBand { zone: number; label: string; min: number; color: string; pctOfMax?: string; }
export interface ZoneHistogramData { hrBands: ZoneBand[]; paceBands: ZoneBand[]; totalMin: number; }

// v1.4.0 (C1) — Durability/Decoupling-Trend
export interface DecouplingPoint { date: string; decoupling: number; distance_km: number | null; }

// v1.4.0 (B1/B2) — Race-Pacing: Splits + GAP
export interface PacingSplit {
  km: number; dist_km: number; gradient: number;
  pace_s: number; gap_s: number; cum_s: number; elev_gain_m: number | null;
}
export interface PacingResult {
  distance_m: number; target_time_s: number; even_pace_s: number; gap_pace_s: number;
  negativeSplit: boolean; hasProfile: boolean; splits: PacingSplit[];
}

// v1.4.0 (A5) — Block-/Mesoplaner: konkrete Tage + Wochen-Zusammenfassungen.
export interface Prescription { templateId: string; progress: number; targetTss: number }
export interface BlockDay {
  date: string; weekdayIdx: number; type: string; isSecond: boolean;
  planned_min: number; planned_tss: number; description: string;
  zone_alloc: ZoneAlloc; efforts: Effort[] | null; paceTarget: number | null;
  prescription?: Prescription | null; // v1.7.0 Live-Resolution
  adaptNote?: string | null;          // T7: „angepasst an …"
}
export interface BlockWeek {
  week_no: number; start_date: string; phase: string | null;
  headline: string; periodizationModel: "block" | "traditional";
  tssTarget: number; tssActual: number; ctlStart: number; tsbStart: number | null;
  isDeload: boolean; days: BlockDay[];
  reasons: { code: string; text: string }[]; confidence: "hoch" | "mittel" | "niedrig";
}
// Item 3 (#7): distanzspezifisches Trainingskonzept (Stoffwechsel + Schlüssel-Einheiten).
export interface DistanceConcept { distanceM: number; label: string; metabolic: string; keySessions: string[]; longRunNote: string; }
export interface BlockPlan {
  weeks: BlockWeek[]; raceDate: string | null;
  reasons: { code: string; text: string }[]; confidence: "hoch" | "mittel" | "niedrig";
  goalDistanceM?: number | null;
  distanceConcept?: DistanceConcept | null;
}

// ToDo 2/13/20 — Intervall-/Effort-Trend (Agent A liefert via /api/intervals/trend, Agent C visualisiert).
export interface IntervalEffortStat {
  date: string;
  sessionType: string;
  category: "LT1" | "LT2" | "VO2short" | "VO2long" | "other";
  avg_pace_s?: number | null;   // Lauf: s/km
  avg_speed_kmh?: number | null; // Rad
  avg_hr?: number | null;
  reps?: number;
  label?: string;
}

// ---- N-of-1 Methoden-Findung (v1.6.0) ----
export interface MethodExperiment {
  id: number;
  profile_id: number;
  start_date: string;
  end_date: string | null;
  method: string; // polarized | pyramidal | threshold | norwegian_double_threshold | custom
  label: string | null;
  notes: string | null;
  created_at: string;
}
export interface PhysioDist { z1: number; z2: number; z3: number; z1Min: number; z2Min: number; z3Min: number }
export interface Markers {
  date: string; windowDays: number; n: number;
  csPace: number | null; csConfidence: "hoch" | "mittel" | "niedrig" | null;
  vdot: number | null;
  thresholdPace: number | null; thresholdHr: number | null;
  decoupling: number | null;
  submaxEf: number | null;
  effVo2max: number | null;
  lactateAtPace: number | null;
  pi: number | null;
  dist: PhysioDist | null;
}
export interface MarkerDelta {
  key: string; label: string; unit: string;
  start: number | null; end: number | null; delta: number | null;
  direction: "besser" | "flach" | "schlechter" | null;
}
export interface MethodEvaluation {
  primary: "csPace";
  verdict: "besser" | "flach" | "schlechter" | "unklar";
  confidence: "hoch" | "mittel" | "niedrig";
  exploratory: boolean;
  deltas: MarkerDelta[];
  note: string;
}
export interface MethodEvaluationResult {
  experiment?: MethodExperiment; // bei Regime-/Range-Auswertung nicht gesetzt (v1.10.0)
  window: number;
  start: Markers;
  end: Markers;
  evaluation: MethodEvaluation;
}
export interface RegimeStat {
  regime: "polarized" | "pyramidal" | "threshold" | "norwegian" | "mixed";
  nWeeks: number;
  nBlocks?: number;          // T6: Anzahl zusammenhängender Blöcke (unabhängige Beobachtungen)
  csChange: number | null;
  vdotChange: number | null;
  confidence: "hoch" | "mittel" | "niedrig";
  fromDate?: string | null; // v1.10.0 Zeitraum der Regime-Wochen
  toDate?: string | null;
}
export interface MethodInferenceResult {
  regimes: RegimeStat[];
  best: RegimeStat["regime"] | null;
  lagWeeks: number;
  note: string;
  confidence: "hoch" | "mittel" | "niedrig";
}

async function j<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
}

export const api = {
  settings: () => j<any>("/api/settings"),
  saveSettings: (b: Record<string, unknown>) => j("/api/settings", { method: "PUT", body: JSON.stringify(b) }),

  zonesets: () => j<ZoneSet[]>("/api/zonesets"),
  zoneset: (date: string) => j<ZoneSet>(`/api/zoneset?date=${date}`),
  addZoneset: (b: Partial<ZoneSet>) => j<{ id: number }>("/api/zonesets", { method: "POST", body: JSON.stringify(b) }),
  updateZoneset: (id: number, b: Partial<ZoneSet>) => j(`/api/zonesets/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteZoneset: (id: number) => j(`/api/zonesets/${id}`, { method: "DELETE" }),
  // HF-/Power-Zonen aus Strava importieren (v0.14.0, ToDo 10)
  importStravaZones: (valid_from: string) => j<{ ok: true }>("/api/strava/import-zones", { method: "POST", body: JSON.stringify({ valid_from }) }),

  // v1.3.0 (G3) — Laktat-/Feldtest-Diagnostik
  lactateTests: () => j<LactateTest[]>("/api/lactate-tests"),
  lactateTest: (id: number) => j<LactateTest>(`/api/lactate-tests/${id}`),
  addLactateTest: (b: { date: string; sport?: string; kind?: string; notes?: string; points: LactateTestPoint[] }) =>
    j<LactateThresholdResult & { id: number }>("/api/lactate-tests", { method: "POST", body: JSON.stringify(b) }),
  updateLactateTest: (id: number, b: { date?: string; sport?: string; kind?: string; notes?: string; points?: LactateTestPoint[] }) =>
    j<{ ok: true } & Partial<LactateThresholdResult>>(`/api/lactate-tests/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteLactateTest: (id: number) => j<{ ok: true }>(`/api/lactate-tests/${id}`, { method: "DELETE" }),
  proposeLactateZoneset: (id: number, maxHr?: number) =>
    j<LactateZoneProposal>(`/api/lactate-tests/${id}/propose-zoneset`, { method: "POST", body: JSON.stringify({ max_hr: maxHr ?? null }) }),

  vo2maxLabs: () => j<Vo2maxLab[]>("/api/vo2max-lab"),
  addVo2maxLab: (b: { date: string; value: number; source?: string; notes?: string }) =>
    j<{ id: number }>("/api/vo2max-lab", { method: "POST", body: JSON.stringify(b) }),
  updateVo2maxLab: (id: number, b: { date: string; value: number; source?: string; notes?: string }) =>
    j<{ ok: true }>(`/api/vo2max-lab/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteVo2maxLab: (id: number) => j<{ ok: true }>(`/api/vo2max-lab/${id}`, { method: "DELETE" }),
  effVo2maxTrend: (from?: string, to?: string) => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return j<EffVo2maxTrend>(`/api/effective-vo2max-trend${p.toString() ? `?${p}` : ""}`);
  },

  // N-of-1 Methoden-Findung (v1.6.0)
  methodExperiments: () => j<MethodExperiment[]>("/api/method-experiments"),
  addMethodExperiment: (b: { start_date: string; end_date?: string | null; method: string; label?: string; notes?: string }) =>
    j<{ id: number }>("/api/method-experiments", { method: "POST", body: JSON.stringify(b) }),
  updateMethodExperiment: (id: number, b: { start_date: string; end_date?: string | null; method: string; label?: string; notes?: string }) =>
    j<{ ok: true }>(`/api/method-experiments/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteMethodExperiment: (id: number) => j<{ ok: true }>(`/api/method-experiments/${id}`, { method: "DELETE" }),
  methodEvaluation: (id: number, window?: number) =>
    j<MethodEvaluationResult>(`/api/method-experiments/${id}/evaluation${window ? `?window=${window}` : ""}`),
  rangeEvaluation: (from: string, to: string, window = 14) => // v1.10.0: Auswertung eines Regime-Abschnitts
    j<MethodEvaluationResult>(`/api/range-evaluation?from=${from}&to=${to}&window=${window}`),
  markers: (date?: string, window?: number) => {
    const p = new URLSearchParams();
    if (date) p.set("date", date);
    if (window) p.set("window", String(window));
    return j<Markers>(`/api/markers${p.toString() ? `?${p}` : ""}`);
  },
  methodInference: () => j<MethodInferenceResult>("/api/method-inference"),

  season: () => j<SeasonWeek[]>("/api/season"),
  saveWeek: (no: number, b: Partial<SeasonWeek>) => j(`/api/season/week/${no}`, { method: "PUT", body: JSON.stringify(b) }),
  setWeekPhase: (no: number, phase: string) => j(`/api/season/week/${no}/phase`, { method: "PUT", body: JSON.stringify({ phase }) }), // v1.7.0
  deleteWeek: (no: number) => j(`/api/season/week/${no}`, { method: "DELETE" }),

  sessions: (q: { week?: number; from?: string; to?: string }) => {
    const p = new URLSearchParams(q as Record<string, string>).toString();
    return j<PlannedSession[]>(`/api/sessions?${p}`);
  },
  addSession: (b: PlannedSession) => j<{ id: number; planned_tss: number }>("/api/sessions", { method: "POST", body: JSON.stringify(b) }),
  updateSession: (id: number, b: PlannedSession) => j<{ planned_tss: number }>(`/api/sessions/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteSession: (id: number) => j(`/api/sessions/${id}`, { method: "DELETE" }),
  applyAdjustment: (id: number, adjusted: object) =>
    j<{ ok: true; planned_tss: number }>(`/api/sessions/${id}/apply-adjustment`, { method: "POST", body: JSON.stringify(adjusted) }),
  enrichProgress: () => j<{ total: number; details: number; streams: number }>("/api/enrich-progress"),
  overview: () => j<Overview>("/api/overview"), // Lifetime-Summen (Lab Mode, M7)

  activities: (q: { from?: string; to?: string }) => {
    const p = new URLSearchParams(q as Record<string, string>).toString();
    return j<Activity[]>(`/api/activities?${p}`);
  },
  addActivity: (b: Activity) => j<{ id: number }>("/api/activities", { method: "POST", body: JSON.stringify(b) }),
  updateActivity: (id: number, b: Activity) => j(`/api/activities/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteActivity: (id: number) => j(`/api/activities/${id}`, { method: "DELETE" }),
  matchActivity: (id: number, sessionId: number | null) => j(`/api/activities/${id}/match`, { method: "POST", body: JSON.stringify({ session_id: sessionId }) }), // v1.9.0
  relinkEfforts: (id: number) => j(`/api/activities/${id}/relink-efforts`, { method: "POST" }),

  daily: (q: { from?: string; to?: string }) => {
    const p = new URLSearchParams(q as Record<string, string>).toString();
    return j<DailyLog[]>(`/api/daily?${p}`);
  },
  saveDaily: (date: string, b: Record<string, unknown>) => j(`/api/daily/${date}`, { method: "PUT", body: JSON.stringify(b) }),

  weeklog: (week: number) => j<any>(`/api/weeklog/${week}`),
  saveWeeklog: (week: number, b: Record<string, unknown>) => j(`/api/weeklog/${week}`, { method: "PUT", body: JSON.stringify(b) }),
  weeklogs: () => j<{ week_no: number; checks: Record<string, boolean> }[]>("/api/weeklogs"),

  pmc: (from: string, to: string) => j<{ pmc: PmcPoint[]; ctlRamp7: number; ctlRamp28: number }>(`/api/pmc?from=${from}&to=${to}`),
  analyzeWeek: (no: number) => j<AnalyzeResult>(`/api/analyze/week/${no}`),
  today: (date?: string) => j<TodayResult>(`/api/today${date ? `?date=${date}` : ""}`),
  weekSuggestion: (weekNo?: number) => j<WeekSuggestionResult>(`/api/plan/week-suggestion${weekNo != null ? `?week=${weekNo}` : ""}`),
  blockSuggestion: (weekNo?: number) => j<BlockPlan>(`/api/plan/block-suggestion${weekNo != null ? `?week=${weekNo}` : ""}`),
  intervalsTrend: (q: { from?: string; to?: string }) => {
    const p = new URLSearchParams(q as Record<string, string>).toString();
    return j<IntervalEffortStat[]>(`/api/intervals/trend?${p}`);
  },
  cleanupOrphans: () => j<{ removed: number }>("/api/season/cleanup-orphans", { method: "POST" }),

  // Profile (leichter Account-Wechsel, ToDo #9)
  profiles: () => j<{ profiles: Profile[]; active: number }>("/api/profiles"),
  addProfile: (name: string) => j<{ id: number }>("/api/profiles", { method: "POST", body: JSON.stringify({ name }) }),
  renameProfile: (id: number, name: string) => j(`/api/profiles/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  setActiveProfile: (id: number) => j("/api/profile/active", { method: "PUT", body: JSON.stringify({ id }) }),
  deleteProfile: (id: number) => j(`/api/profiles/${id}`, { method: "DELETE" }),
  resetProfile: (id: number, code: string) => j<{ activities: number; daily: number; weeklogs: number; sessions: number; weeks: number; races: number }>(`/api/profiles/${id}/reset`, { method: "POST", body: JSON.stringify({ code }) }),

  // Races / Wettkämpfe (ToDo #24)
  races: (q?: { from?: string; to?: string }) => {
    const p = q ? new URLSearchParams(q as Record<string, string>).toString() : "";
    return j<Race[]>(`/api/races${p ? `?${p}` : ""}`);
  },
  addRace: (b: Race) => j<{ id: number }>("/api/races", { method: "POST", body: JSON.stringify(b) }),
  updateRace: (id: number, b: Race) => j(`/api/races/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  goalGap: () => j<GoalGap>("/api/plan/goal-gap"),
  tuneupProgress: () => j<TuneupProgress>("/api/tuneup-progress"), // v1.10.0
  powerCurve: (window = 90) => j<PowerCurve>(`/api/power-curve?window=${window}`), // v1.7.0
  cpTrend: (months = 12) => j<CpTrend>(`/api/cp-trend?months=${months}`),
  optimalZones: () => j<OptimalZonesResult>("/api/optimal-zones"), // v1.9.0
  thresholdTrend: (months = 12) => j<ThresholdTrend>(`/api/threshold-trend?months=${months}`),
  runEffectiveness: (window = 90) => j<RunEffectiveness>(`/api/run-effectiveness?window=${window}`), // v1.8.0
  wprimeLatest: () => j<WPrimeLatest>("/api/wprime/latest"),
  deleteRace: (id: number) => j(`/api/races/${id}`, { method: "DELETE" }),
  importRacesFromSeason: () => j<{ created: number }>("/api/races/import-from-season", { method: "POST" }),
  racePacing: (id: number, q?: { target?: number; neg?: boolean }) => {
    const p = new URLSearchParams();
    if (q?.target) p.set("target", String(q.target));
    if (q?.neg) p.set("neg", "1");
    const qs = p.toString();
    return j<PacingResult>(`/api/races/${id}/pacing${qs ? `?${qs}` : ""}`);
  },

  // Bestzeiten + Critical Speed (v0.14.0, ToDo 8)
  bests: () => j<BestsResult>("/api/bests"),
  setBestOverride: (distance_m: number, time_s: number, date: string) =>
    j<{ ok: boolean }>("/api/bests/override", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ distance_m, time_s, date }) }),
  deleteBestOverride: (distance_m: number) =>
    j<{ ok: boolean }>(`/api/bests/override/${distance_m}`, { method: "DELETE" }),
  fitnessTrend: (from?: string, to?: string) => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return j<FitnessTrend>(`/api/fitness-trend${p.toString() ? `?${p}` : ""}`);
  },
  // Plan-Erfüllung je Saisonwoche (v0.14.0, ToDo 12)
  planAdherence: () => j<PlanAdherenceWeek[]>("/api/plan-adherence"),
  // v1.4.0 (C1) — Durability/Decoupling
  decouplingTrend: (q?: { from?: string; to?: string }) => {
    const p = new URLSearchParams((q as Record<string, string>) || {}).toString();
    return j<DecouplingPoint[]>(`/api/decoupling-trend${p ? `?${p}` : ""}`);
  },
  // v1.4.0 (C3) — Zonen-Histogramm
  zoneHistogram: (q?: { from?: string; to?: string; sport?: string }) => {
    const p = new URLSearchParams((q as Record<string, string>) || {}).toString();
    return j<ZoneHistogramData>(`/api/zone-histogram${p ? `?${p}` : ""}`);
  },

  // Seiten-Layout (T8): anpassbares Chart-Raster je Seite + Profil
  getLayout: (page: string) => j<LayoutMap>(`/api/layout/${page}`),
  setLayout: (page: string, map: LayoutMap) =>
    j<{ ok: boolean }>(`/api/layout/${page}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(map) }),

  // v1.4.0 (A1) — Verfügbarkeits-/Präferenz-Profil
  availability: () => j<Availability | null>("/api/availability"),
  saveAvailability: (b: Availability) => j<{ ok: boolean }>("/api/availability", { method: "PUT", body: JSON.stringify(b) }),
  workouts: () => j<WorkoutInfo[]>("/api/workouts"), // v1.8.0 Bibliothek für Block-Präferenzen
  customWorkouts: () => j<CustomWorkout[]>("/api/custom-workouts"), // v1.9.0 Z14
  estimateCustomWorkout: (b: CustomInput) => j<CustomEstimate>("/api/custom-workouts/estimate", { method: "POST", body: JSON.stringify(b) }),
  addCustomWorkout: (b: CustomInput) => j<{ id: number; tssEstimate: number }>("/api/custom-workouts", { method: "POST", body: JSON.stringify(b) }),
  deleteCustomWorkout: (id: number) => j(`/api/custom-workouts/${id}`, { method: "DELETE" }),
  tutorialStatus: () => j<{ id: number | null }>("/api/tutorial"), // v1.8.0 Tutorial-Profil
  regenerateTutorial: () => j<{ ok: boolean; id: number }>("/api/tutorial/regenerate", { method: "POST" }),
  deleteTutorial: () => j<{ ok: boolean }>("/api/tutorial", { method: "DELETE" }),

  // konfigurierbare Auswahllisten (ToDo 13/24)
  options: (kind?: string) => j<Option[]>(`/api/options${kind ? `?kind=${kind}` : ""}`),
  addOption: (b: Partial<Option>) => j<{ id: number }>("/api/options", { method: "POST", body: JSON.stringify(b) }),
  updateOption: (id: number, b: Partial<Option>) => j(`/api/options/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteOption: (id: number) => j(`/api/options/${id}`, { method: "DELETE" }),

  // wiederverwendbare Einheiten-Vorlagen (häufige Einheiten 1× speichern, per Klick einsetzen)
  templates: () => j<SessionTemplate[]>("/api/templates"),
  addTemplate: (b: SessionTemplate) => j<{ id: number }>("/api/templates", { method: "POST", body: JSON.stringify(b) }),
  updateTemplate: (id: number, b: SessionTemplate) => j(`/api/templates/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteTemplate: (id: number) => j(`/api/templates/${id}`, { method: "DELETE" }),

  // ML-Engine (Plan: ML-Trainingssteuerung)
  mlSettings: () => j<MlSettings>("/api/ml/settings"),
  mlSaveSettings: (s: Partial<MlSettings>) => j<{ ok: boolean }>("/api/ml/settings", { method: "PUT", body: JSON.stringify(s) }),
  mlRecompute: (kind?: MlKindName) => j<{ runId: number; reused?: boolean }>(`/api/ml/recompute${kind ? `?kind=${kind}` : ""}`, { method: "POST" }),
  mlCancel: (runId: number) => j<{ ok: boolean }>(`/api/ml/cancel?runId=${runId}`, { method: "POST" }),
  mlProgress: (runId: number) => j<{ id: number; status: string; progress: number; error: string | null }>(`/api/ml/progress?runId=${runId}`),
  mlStatus: (kind?: MlKindName) => j<MlStatus>(`/api/ml/status${kind ? `?kind=${kind}` : ""}`),
  mlLatentFitness: () => j<MlLatentPoint[]>("/api/ml/latent-fitness"),
  mlEffects: () => j<MlEffects>("/api/ml/effects"),
  mlReadiness: () => j<MlReadiness>("/api/ml/readiness"),
  mlGetFeedback: (activityId: number) => j<MlFeedback | null>(`/api/ml/feedback?activityId=${activityId}`),
  mlSaveFeedback: (b: MlFeedback) => j<{ id: number }>("/api/ml/feedback", { method: "POST", body: JSON.stringify(b) }),
  mlProspective: () => j<MlProspectiveState>("/api/ml/prospective"),
  mlProposeTrial: () => j<MlProspectiveProposal>("/api/ml/prospective/propose", { method: "POST" }),
  mlAcceptTrial: (b: MlAcceptTrialBody) => j<{ id: number }>("/api/ml/prospective/accept", { method: "POST", body: JSON.stringify(b) }),
  mlDeclineTrial: () => j<{ ok: boolean }>("/api/ml/prospective/decline", { method: "POST" }),
  mlEvaluateTrial: (id: number) => j<MlProspectiveTrial | null>(`/api/ml/prospective/${id}/evaluate`, { method: "POST" }),
  mlAbortTrial: (id: number, reason: "user" | "health" = "user") => j<{ ok: boolean; removedSessions?: number }>(`/api/ml/prospective/${id}/abort`, { method: "POST", body: JSON.stringify({ reason }) }),
  mlTrialPlanPreview: (id: number) => j<MlTrialBlockGen>(`/api/ml/prospective/${id}/plan-preview`),
  mlTrialPlanBlock: (id: number) => j<MlTrialPlanResult>(`/api/ml/prospective/${id}/plan-block`, { method: "POST" }),
  cycleStatus: () => j<CycleStatus>("/api/cycle-training/status"),
  cycleConsent: (consent: boolean, contraception?: { method: CycleMethod }) => j<{ ok: boolean; consented: boolean }>("/api/cycle-training/consent", { method: "POST", body: JSON.stringify({ consent, contraception }) }),
  cycleDeleteData: () => j<{ ok: boolean }>("/api/cycle-training/data", { method: "DELETE" }),
  cycleSaveSettings: (s: Partial<CycleSettings>) => j<{ ok: boolean }>("/api/cycle-training/settings", { method: "PUT", body: JSON.stringify(s) }),
  cycleAddPeriod: (start_date: string) => j<{ id: number }>("/api/cycle-training/period", { method: "POST", body: JSON.stringify({ start_date }) }),
  cycleDeletePeriod: (id: number) => j<{ ok: boolean }>(`/api/cycle-training/period/${id}`, { method: "DELETE" }),
  cycleSymptoms: (from?: string, to?: string) => j<CycleSymptom[]>(`/api/cycle-training/symptoms${from && to ? `?from=${from}&to=${to}` : ""}`),
  cycleSaveSymptom: (s: CycleSymptom) => j<{ id: number }>("/api/cycle-training/symptoms", { method: "POST", body: JSON.stringify(s) }),
  cycleEvaluate: () => j<{ ok: boolean; evidence: CycleEvidence[]; nFeedback: number }>("/api/cycle-training/evaluate", { method: "POST" }),
  cycleEvidence: () => j<CycleEvidence[]>("/api/cycle-training/evidence"),
  cyclePhaseBands: (from: string, to: string) => j<CyclePhaseSpan[]>(`/api/cycle-training/phase-bands?from=${from}&to=${to}`),
};
