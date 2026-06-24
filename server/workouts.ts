// Trainings-Einheiten-Bibliothek (v1.6.1) — sportwissenschaftlich fundierte Vorlagen für den Block-Vorschlag.
// Quellen: Daniels (T/I/R-Pace), Bakken/Casado et al. 2023 (Norwegian sub-threshold/LGTIT), Seiler (polarisiert),
// Billat (30/30), Casado 2022 (Periodisierung), neuromuskuläre Hügelläufe. Pure Modul (keine DB).
//  - WORKOUT_LIBRARY: Katalog mit Metadaten (Familie, Phase, Anstrengung, Nutzen, Synergie, Quelle).
//  - fitnessLevel(): CTL/CS → low|mid|high (skaliert Wiederholungszahlen; 20×400 nur bei hoher Fitness).
//  - pickWeekWorkouts(): Wochen-Komposition je Phase + Rotation (weekInPhase) + Progression + Doubles.
//  - renderWorkout(): Vorlage → konkrete Einheit mit Pace-BEREICH (Anker LT1/LT2/CS) + HF-Spanne + Pausen.
import { paceOf, thrOf, tssPerMin, paceStr, type ZonesInput, type Effort, type ConcreteSession } from "./planbuilder.ts";

export type Family = "Easy" | "Long" | "LT1" | "LT2" | "VO2" | "Hill" | "Speed" | "Race";
export type FitnessLevel = "low" | "mid" | "high";
type Anchor = "easy" | "lt1" | "lt2" | "cs" | "rep" | "mp" | "race" | null;

export interface WorkoutTemplate {
  id: string;
  family: Family;
  sessionType: string;          // bestehende Option (Easy/Long/Steady/Threshold/VO2/Hill/Race)
  name: string;                 // Anzeige-Kurzname
  purpose: string;              // Nutzen
  phases: string[];             // passende Phasen (Substring-Match)
  effort: 1 | 2 | 3 | 4 | 5;    // Anstrengung
  kind: "steady" | "intervals" | "hill" | "double";
  workZone: number;             // physiologische Zone (TSS-Basis)
  anchor: Anchor;               // Pace-Anker für den Bereich
  paceWindow: number;           // ± s/km um den Anker
  minMin?: number; maxMin?: number;        // steady: Dauer-Klammer
  repSec?: number; repDist_m?: number;     // Intervall: Dauer ODER Distanz je Rep
  restSec?: number; restType?: "jog" | "stand";
  repsByFitness?: { low: [number, number]; mid: [number, number]; high: [number, number] };
  synergy: string;
  lit: string;
}

const RB = (lo: [number, number], mid: [number, number], hi: [number, number]) => ({ low: lo, mid, high: hi });

export const WORKOUT_LIBRARY: WorkoutTemplate[] = [
  // ---- Easy / Long ----
  { id: "easy_recovery", family: "Easy", sessionType: "Easy", name: "Recovery", purpose: "Regeneration, Durchblutung", phases: ["base", "belast", "specific", "entlast", "race"], effort: 1, kind: "steady", workZone: 2, anchor: "easy", paceWindow: 0, minMin: 25, maxMin: 50, synergy: "nach harten Tagen / zwischen Qualität", lit: "Seiler" },
  { id: "easy_ga1", family: "Easy", sessionType: "Easy", name: "Easy / GA1", purpose: "aerobe Basis, Mitochondrien", phases: ["base", "belast", "specific"], effort: 2, kind: "steady", workZone: 2, anchor: "easy", paceWindow: 0, minMin: 45, maxMin: 80, synergy: "Grundgerüst jeder Woche", lit: "Seiler/Casado" },
  { id: "long_aerobic", family: "Long", sessionType: "Long", name: "Longrun", purpose: "Grundlagenausdauer, Fettstoffwechsel", phases: ["base", "belast", "specific"], effort: 3, kind: "steady", workZone: 2, anchor: "easy", paceWindow: 0, minMin: 80, maxMin: 150, synergy: "Wochen-Anker; ergänzt Schwellen-Volumen", lit: "Daniels" },
  { id: "long_fastfinish", family: "Long", sessionType: "Long", name: "Longrun mit schnellem Ende", purpose: "Ermüdungsresistenz, Renntempo unter Ermüdung", phases: ["belast", "specific"], effort: 3, kind: "steady", workZone: 2, anchor: "easy", paceWindow: 0, minMin: 80, maxMin: 140, synergy: "ersetzt Longrun spät im Block; nicht direkt nach hartem VO2", lit: "Canova" },

  // ---- LT1 / Sub-Threshold ----
  { id: "lt1_continuous", family: "LT1", sessionType: "Steady", name: "Sub-Threshold LT1 (kont.)", purpose: "aerobe Schwelle, Laktat-Clearance", phases: ["base", "belast"], effort: 3, kind: "steady", workZone: 3, anchor: "lt1", paceWindow: 6, minMin: 25, maxMin: 50, synergy: "Brücke Easy→LT2; viel davon in Base", lit: "Casado/Bakken" },
  { id: "lt1_long_reps", family: "LT1", sessionType: "Steady", name: "LT1-Reps", purpose: "LT1-Volumen ohne Ermüdung", phases: ["base", "belast"], effort: 3, kind: "intervals", workZone: 3, anchor: "lt1", paceWindow: 5, repSec: 540, restSec: 90, restType: "jog", repsByFitness: RB([3, 4], [4, 5], [5, 6]), synergy: "Base-Alternative zum kont. LT1", lit: "Casado" },

  // ---- LT2 / Threshold ----
  { id: "lt2_tempo", family: "LT2", sessionType: "Threshold", name: "Tempolauf LT2 (kont.)", purpose: "Schwellen-Dauerleistung", phases: ["belast", "specific"], effort: 4, kind: "steady", workZone: 4, anchor: "lt2", paceWindow: 4, minMin: 20, maxMin: 40, synergy: "klassische T-Einheit; ergänzt Longrun", lit: "Daniels (T)" },
  { id: "lt2_cruise", family: "LT2", sessionType: "Threshold", name: "Cruise-Intervalle", purpose: "mehr Zeit an der Schwelle bei höherer Qualität", phases: ["belast", "specific"], effort: 4, kind: "intervals", workZone: 4, anchor: "lt2", paceWindow: 4, repSec: 600, restSec: 90, restType: "jog", repsByFitness: RB([3, 3], [4, 4], [4, 5]), synergy: "Brot-und-Butter im Build; vor VO2-Block", lit: "Daniels (cruise)" },
  { id: "lt2_1000s", family: "LT2", sessionType: "Threshold", name: "1000er @ Schwelle", purpose: "Schwellen-Reps, Renn-Rhythmus", phases: ["belast"], effort: 4, kind: "intervals", workZone: 4, anchor: "lt2", paceWindow: 4, repDist_m: 1000, restSec: 75, restType: "jog", repsByFitness: RB([4, 5], [5, 6], [6, 8]), synergy: "rotiert mit cruise/norw", lit: "Daniels" },
  { id: "norw_400s", family: "LT2", sessionType: "Threshold", name: "Norwegian 400er (sub-T)", purpose: "hohes Schwellen-Volumen bei kontrolliertem Laktat (2,5–3,5 mmol)", phases: ["belast"], effort: 4, kind: "intervals", workZone: 4, anchor: "lt2", paceWindow: 3, repDist_m: 400, restSec: 40, restType: "jog", repsByFitness: RB([10, 12], [14, 18], [20, 25]), synergy: "Kernstück Norwegian; 20×400 nur bei hoher Fitness", lit: "Bakken/Casado 2023" },
  { id: "norw_short_reps", family: "LT2", sessionType: "Threshold", name: "Sub-Threshold 6'-Reps", purpose: "kontrolliertes Schwellen-Volumen", phases: ["belast"], effort: 4, kind: "intervals", workZone: 4, anchor: "lt2", paceWindow: 3, repSec: 360, restSec: 60, restType: "jog", repsByFitness: RB([4, 4], [5, 5], [5, 6]), synergy: "AM-Hälfte einer Doppel-Schwelle", lit: "Bakken" },
  { id: "norw_double", family: "LT2", sessionType: "Threshold", name: "Doppel-Schwelle (AM+PM)", purpose: "maximales sub-T-Volumen über zwei Einheiten/Tag", phases: ["belast"], effort: 4, kind: "double", workZone: 4, anchor: "lt2", paceWindow: 3, restSec: 50, restType: "jog", repsByFitness: RB([4, 8], [5, 10], [6, 12]), synergy: "nur bei Doubles & guter Fitness; nicht in derselben Woche wie VO2-Block", lit: "Ingebrigtsen/Bakken" },

  // ---- VO2max ----
  { id: "vo2_long", family: "VO2", sessionType: "VO2", name: "VO2max 3'-Intervalle", purpose: "VO2max, aerobe Leistung", phases: ["specific"], effort: 5, kind: "intervals", workZone: 5, anchor: "cs", paceWindow: 5, repSec: 180, restSec: 180, restType: "jog", repsByFitness: RB([5, 5], [5, 6], [6, 6]), synergy: "baut auf Schwellen-Basis auf; nicht neben Doppel-Schwelle", lit: "Daniels (I)" },
  { id: "vo2_45", family: "VO2", sessionType: "VO2", name: "VO2max 4–5'-Intervalle", purpose: "lange Intervalle, mehr Zeit > 90 % VO2max", phases: ["specific"], effort: 5, kind: "intervals", workZone: 5, anchor: "cs", paceWindow: 4, repSec: 270, restSec: 210, restType: "jog", repsByFitness: RB([4, 4], [4, 5], [5, 5]), synergy: "rotiert mit 3'/1000ern", lit: "Daniels; PMC11743937" },
  { id: "vo2_1000s", family: "VO2", sessionType: "VO2", name: "1000er @ VO2/3–5k", purpose: "VO2 + Renntempo-Spezifik", phases: ["specific"], effort: 5, kind: "intervals", workZone: 5, anchor: "cs", paceWindow: 3, repDist_m: 1000, restSec: 150, restType: "jog", repsByFitness: RB([4, 5], [5, 5], [5, 6]), synergy: "Übergang VO2→Renntempo", lit: "Daniels" },
  { id: "vo2_400s", family: "VO2", sessionType: "VO2", name: "400er @ 3k/Mile", purpose: "aerobe Power, Speed-Erhalt", phases: ["belast", "specific"], effort: 5, kind: "intervals", workZone: 5, anchor: "rep", paceWindow: 4, repDist_m: 400, restSec: 90, restType: "jog", repsByFitness: RB([8, 10], [10, 12], [12, 15]), synergy: "ergänzt Schwellen-Block; Sharpening", lit: "Daniels" },
  { id: "vo2_3030", family: "VO2", sessionType: "VO2", name: "30/30 (Billat)", purpose: "maximale Zeit an VO2max, geringe Ermüdung", phases: ["specific"], effort: 5, kind: "intervals", workZone: 5, anchor: "cs", paceWindow: 5, repSec: 30, restSec: 30, restType: "jog", repsByFitness: RB([12, 14], [14, 18], [18, 20]), synergy: "spät im Specific-Block", lit: "Billat 30/30" },

  // ---- Berg + Speed/Reps ----
  { id: "hill_sprints", family: "Hill", sessionType: "Hill", name: "Bergsprints (kurz)", purpose: "Neuromuskulär, Ökonomie, Kraft", phases: ["base", "belast", "specific"], effort: 4, kind: "hill", workZone: 5, anchor: null, paceWindow: 0, repSec: 12, restSec: 60, restType: "jog", repsByFitness: RB([8, 8], [8, 10], [10, 12]), synergy: "low-load; passt an jeden Easy-Tag, baut auf Speed", lit: "neuromuskuläre Hügelläufe" },
  { id: "hill_reps_short", family: "Hill", sessionType: "Hill", name: "Hügel-Reps 60–90s", purpose: "Kraftausdauer, VO2 bergauf (gelenkschonend)", phases: ["base", "belast"], effort: 5, kind: "hill", workZone: 5, anchor: null, paceWindow: 0, repSec: 75, restSec: 90, restType: "jog", repsByFitness: RB([6, 6], [6, 8], [8, 10]), synergy: "Base/Build-Stärke vor Bahn-VO2", lit: "Daniels/Magness" },
  { id: "hill_reps_long", family: "Hill", sessionType: "Hill", name: "Hügel-Reps 2–3'", purpose: "Stärke-Ausdauer, Schwelle bergauf", phases: ["belast"], effort: 5, kind: "hill", workZone: 4, anchor: null, paceWindow: 0, repSec: 150, restSec: 150, restType: "jog", repsByFitness: RB([4, 4], [4, 5], [5, 6]), synergy: "Build-Alternative zur Schwelle", lit: "Canova" },
  { id: "reps_R", family: "Speed", sessionType: "VO2", name: "200–400er @ R-Pace", purpose: "Laufökonomie, Speed (volle Pause)", phases: ["base", "belast", "specific"], effort: 5, kind: "intervals", workZone: 5, anchor: "rep", paceWindow: 4, repDist_m: 300, restSec: 120, restType: "stand", repsByFitness: RB([8, 8], [8, 10], [10, 12]), synergy: "ergänzt aerobe Arbeit ohne große Last (Daniels R)", lit: "Daniels (R)" },
  { id: "strides", family: "Speed", sessionType: "Easy", name: "Steigerungen", purpose: "Neuromuskulär, Lockerheit", phases: ["base", "belast", "specific", "entlast", "race"], effort: 2, kind: "intervals", workZone: 5, anchor: "rep", paceWindow: 6, repSec: 18, restSec: 60, restType: "stand", repsByFitness: RB([6, 6], [6, 8], [8, 8]), synergy: "an Easy-Tage/Taper anhängen", lit: "Standard" },

  // ---- Race ----
  { id: "race_pace", family: "Race", sessionType: "Race", name: "Renntempo-Intervalle", purpose: "Wettkampf-Spezifik (kurze Distanz, 5–10k)", phases: ["specific", "race"], effort: 5, kind: "intervals", workZone: 4, anchor: "race", paceWindow: 4, repDist_m: 1000, restSec: 90, restType: "jog", repsByFitness: RB([3, 4], [4, 5], [5, 6]), synergy: "Specific-Phase; ersetzt eine Schwelle", lit: "Casado 2022" },
  { id: "race_pace_long", family: "Race", sessionType: "Race", name: "Renntempo-Blöcke (lang)", purpose: "Renntempo-Spezifik für HM/Marathon", phases: ["specific", "race"], effort: 4, kind: "intervals", workZone: 4, anchor: "race", paceWindow: 4, repDist_m: 2000, restSec: 90, restType: "jog", repsByFitness: RB([3, 3], [3, 4], [4, 5]), synergy: "HM/Marathon-Block; ersetzt VO2-Schärfung durch Renntempo-Volumen", lit: "Canova/Casado" },
  { id: "long_mp_segments", family: "Long", sessionType: "Long", name: "Longrun mit MP-Blöcken", purpose: "Marathon-Tempo unter Ermüdung, Glykogen-Ökonomie", phases: ["belast", "specific"], effort: 4, kind: "steady", workZone: 2, anchor: "race", paceWindow: 0, minMin: 90, maxMin: 150, synergy: "Marathon-Long-Slot; 2–3×15–20' @ Marathon-Pace im Longrun", lit: "Canova" },
];

const byId = new Map(WORKOUT_LIBRARY.map((w) => [w.id, w]));
const wk = (id: string): WorkoutTemplate => byId.get(id)!;

// ---------------- Fitness-Stufe ----------------
export function fitnessLevel(ctl: number, csPace?: number | null): FitnessLevel {
  let lvl: FitnessLevel = ctl >= 65 ? "high" : ctl >= 40 ? "mid" : "low";
  if (csPace && csPace > 0) {
    if (csPace < 205 && lvl === "mid") lvl = "high";   // < ~3:25/km
    if (csPace > 270 && lvl === "high") lvl = "mid";
  }
  return lvl;
}

// ---------------- Wochen-Komposition (Phase + Rotation + Doubles) ----------------
export interface WorkoutPick { tpl: WorkoutTemplate; role: "quality" | "long" | "easy" }
const rot = <T,>(arr: T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length];

/**
 * Wählt die Einheiten einer Woche je Phase. `weekInPhase` rotiert die Qualitäts-Slots (Abwechslung);
 * die Progression (Dosis) kommt über `progress` im Renderer. Doubles erzeugen einen Doppel-Schwellen-Tag.
 */
export function pickWeekWorkouts(phase: string | null | undefined, weekInPhase: number, fitness: FitnessLevel, allowDoubles: boolean, goalDistanceM: number | null = null): WorkoutPick[] {
  const p = (phase || "").toLowerCase();
  const Q = (id: string): WorkoutPick => ({ tpl: wk(id), role: "quality" });
  const L = (id: string): WorkoutPick => ({ tpl: wk(id), role: "long" });
  const E = (id: string): WorkoutPick => ({ tpl: wk(id), role: "easy" });
  // Distanz-Bucket fürs Renntempo: short ≤15k (5–10k) · mid HM · long ≥30k (Marathon). 0/null → wie short.
  const dist = goalDistanceM ?? 0;
  const isLong = dist >= 30000;
  const isMid = dist >= 15000 && dist < 30000;

  if (p.includes("krank")) return [E("easy_recovery"), E("easy_recovery")];

  if (p.includes("race week") || p.includes("raceweek") || p.includes("race-week")) {
    return [Q("strides"), Q(rot(["race_pace", "vo2_400s"], weekInPhase)), E("easy_ga1"), E("easy_recovery"), E("easy_recovery")];
  }
  if (p.includes("entlast") || p.includes("deload")) {
    return [L("long_aerobic"), Q(rot(["lt2_cruise", "strides"], weekInPhase)), E("easy_ga1"), E("easy_recovery"), E("easy_recovery")];
  }
  if (p.includes("specific") || p.includes("spec")) {
    if (isLong) { // Marathon: Schwelle/MP-lastig, längere Renntempo-Blöcke, MP-Longrun, VO2 reduziert
      return [
        L("long_mp_segments"),
        Q(rot(["race_pace_long", "lt2_cruise", "race_pace_long", "lt2_tempo"], weekInPhase)),
        Q(rot(["lt2_cruise", "vo2_1000s", "lt2_1000s", "race_pace_long"], weekInPhase)),
        Q("strides"), E("easy_ga1"), E("easy_recovery"),
      ];
    }
    if (isMid) { // HM: Schwelle + Renntempo-Blöcke + 1 VO2
      return [
        L(weekInPhase >= 1 ? "long_fastfinish" : "long_aerobic"),
        Q(rot(["race_pace_long", "lt2_cruise", "vo2_1000s", "race_pace_long"], weekInPhase)),
        Q(rot(["lt2_cruise", "vo2_45", "race_pace_long", "lt2_tempo"], weekInPhase)),
        Q("strides"), E("easy_ga1"), E("easy_recovery"),
      ];
    }
    // short / kein Ziel: VO2-lastig (5–10k) + kurze Renntempo-Intervalle
    return [
      L(weekInPhase >= 1 ? "long_fastfinish" : "long_aerobic"),
      Q(rot(["vo2_long", "vo2_45", "vo2_1000s", "vo2_3030"], weekInPhase)),
      Q(rot(["race_pace", "lt2_cruise", "race_pace", "vo2_400s"], weekInPhase)),
      Q("strides"), E("easy_ga1"), E("easy_recovery"),
    ];
  }
  if (p.includes("belast") || p.includes("build") || p.includes("aufbau")) {
    // Build: 2 Schwellen-Slots rotieren; bei Doubles + guter Fitness ein Doppel-Schwellen-Tag.
    const thr1 = rot(["lt2_cruise", "lt2_1000s", "norw_400s", "norw_short_reps"], weekInPhase);
    const thr2 = rot(["hill_reps_short", "vo2_400s", "lt2_tempo", "lt2_cruise"], weekInPhase);
    // Marathon-Ziel: spätere Aufbauwochen bekommen den MP-Block-Longrun statt reinem Dauerlauf.
    const picks: WorkoutPick[] = [L(isLong && weekInPhase >= 1 ? "long_mp_segments" : "long_aerobic")];
    if (allowDoubles && fitness !== "low") {
      picks.push(Q("norw_double"));
      picks.push(Q(rot(["hill_reps_short", "vo2_400s"], weekInPhase)));
    } else {
      picks.push(Q(thr1), Q(thr2));
    }
    picks.push(Q("strides"), E("easy_ga1"), E("easy_recovery"));
    return picks;
  }
  // Base (Default): viel Z1/Z2, LT1 + Hügel/Speed-Ökonomie, kaum LT2.
  return [
    L("long_aerobic"),
    Q(rot(["lt1_continuous", "lt1_long_reps", "lt1_continuous", "hill_reps_short"], weekInPhase)),
    Q(rot(["hill_sprints", "strides", "reps_R", "hill_sprints"], weekInPhase)),
    E("easy_ga1"), E("easy_ga1"), E("easy_recovery"),
  ];
}

// ---------------- Renderer ----------------
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

function anchorCenter(a: Anchor, z: ZonesInput): number | null {
  switch (a) {
    case "lt2": return thrOf(z);
    case "lt1": return z.lt1_pace && z.lt1_pace > 0 ? z.lt1_pace : paceOf(3, z);
    case "cs": return z.cs_pace && z.cs_pace > 0 ? z.cs_pace : paceOf(5, z);
    case "rep": return z.rep_pace && z.rep_pace > 0 ? z.rep_pace : z.cs_pace && z.cs_pace > 0 ? r0(z.cs_pace - 8) : paceOf(6, z);
    case "mp": return z.lt1_pace && z.lt1_pace > 0 ? r0(z.lt1_pace + 5) : r0(thrOf(z) + 18);
    case "race": return z.goal_pace && z.goal_pace > 0 ? z.goal_pace : anchorCenter("cs", z); // Zielpace, sonst CS
    case "easy": return paceOf(2, z);
    default: return null;
  }
}
function paceRangeStr(center: number, window: number): string {
  if (window <= 0) return `~${paceStr(center)}/km`;
  return `${paceStr(r0(center - window))}–${paceStr(r0(center + window))}/km`;
}
function zoneBandStr(z: number, zones: ZonesInput): string {
  const fast = paceOf(z, zones);
  const slow = z > 1 ? paceOf(z - 1, zones) : fast + 30;
  return `${paceStr(r0(fast))}–${paceStr(r0(slow))}/km`;
}
function hrRangeStr(z: number, zones: ZonesInput): string {
  const zn = zones.hr_zones?.find((x) => x.z === z);
  if (!zn || !(zn.min > 0)) return "";
  const hi = zn.max >= 990 ? "max" : String(zn.max);
  return `${zn.min}–${hi} bpm`;
}
function durLabel(sec: number): string {
  if (sec % 60 === 0) return `${sec / 60}'`;
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
function restLabel(sec: number, type: "jog" | "stand"): string {
  return `${durLabel(sec)} ${type === "jog" ? "Trab" : "Stehen"}`;
}
function repsForFitness(tpl: WorkoutTemplate, fitness: FitnessLevel, progress: number): number {
  const band = tpl.repsByFitness![fitness];
  return Math.round(band[0] + (band[1] - band[0]) * Math.max(0, Math.min(1, progress)));
}

export interface RenderCtx { zones: ZonesInput; fitness: FitnessLevel; progress: number; targetTss?: number; maxMin?: number }

/** Vorlage → konkrete Einheit (Pace-Bereich + HF + Pausen). Steady nutzt targetTss; Intervalle Fitness+Progression. */
export function renderWorkout(tpl: WorkoutTemplate, ctx: RenderCtx): ConcreteSession {
  const { zones, fitness, progress } = ctx;
  const maxMin = ctx.maxMin && ctx.maxMin > 0 ? ctx.maxMin : Infinity;

  if (tpl.kind === "steady") {
    const z = tpl.workZone;
    const tpm = tssPerMin(z, zones);
    const lo = tpl.minMin ?? 30, hi = tpl.maxMin ?? 60;
    // targetTss (Easy/Long-Ausgleich) → Dauer; sonst progressive Default-Dauer (für steady-Qualität wie LT1/Tempo).
    let min = ctx.targetTss && tpm > 0 ? ctx.targetTss / tpm : lo + (hi - lo) * (0.4 + 0.4 * Math.max(0, Math.min(1, progress)));
    min = Math.max(lo, Math.min(hi, min));
    min = Math.min(min, maxMin);
    min = Math.max(10, r0(min));
    const center = anchorCenter(tpl.anchor, zones);
    // Easy/Long-Dauerläufe immer im Zonen-Band anzeigen (Anker „race" nur für die Schluss-/MP-Block-Notiz).
    const paceTxt = center != null && tpl.family !== "Easy" && tpl.family !== "Long" ? paceRangeStr(center, tpl.paceWindow) : zoneBandStr(z, zones);
    const hr = hrRangeStr(z, zones);
    const racePace = anchorCenter("race", zones);
    const extra = tpl.id === "long_fastfinish" ? ` · letzte 15–20' @ Renntempo${racePace ? ` (~${paceStr(racePace)}/km)` : ""}`
      : tpl.id === "long_mp_segments" ? ` · 2–3×15–20' @ Marathon-Pace${racePace ? ` (~${paceStr(racePace)}/km)` : ""}`
      : "";
    return {
      type: tpl.sessionType, planned_min: min, zone_alloc: { byMin: { [z]: min } },
      efforts: null, paceTarget: center ?? paceOf(z, zones),
      description: `${min} min ${tpl.name} @ ${paceTxt}${hr ? ` (${hr})` : ""} (Z${z})${extra}`,
      planned_tss: r1(min * tpm),
    };
  }

  if (tpl.kind === "double") {
    // Doppel-Schwelle: AM 5×6' + PM N×400m sub-T (eine Plan-Einheit, ein Tag).
    const amReps = Math.max(4, repsForFitness({ ...tpl, repsByFitness: { low: [4, 4], mid: [5, 5], high: [5, 6] } } as WorkoutTemplate, fitness, progress));
    const pmReps = repsForFitness(tpl, fitness, progress);
    const center = anchorCenter("lt2", zones)!;
    const z = tpl.workZone, tpmW = tssPerMin(z, zones), tpmE = tssPerMin(1, zones);
    const amWorkMin = amReps * 6, pmWorkMin = pmReps * (((400 / 1000) * center) / 60);
    const wuCd = 24, restMin = ((amReps - 1) * 60 + (pmReps - 1) * 40) / 60;
    const z1 = wuCd + restMin, workMin = amWorkMin + pmWorkMin;
    const hr = hrRangeStr(z, zones), paceTxt = paceRangeStr(center, tpl.paceWindow);
    const efforts: Effort[] = [
      { reps: amReps, sec: 360, zone: z, pace_s: center, rest_s: 60, rest_type: "jog", label: "Sub-T AM" },
      { reps: pmReps, dist_m: 400, zone: z, pace_s: center, rest_s: 40, rest_type: "jog", label: "Sub-T PM" },
    ];
    return {
      type: tpl.sessionType, planned_min: r0(z1 + workMin), zone_alloc: { byMin: { 1: r1(z1), [z]: r1(workMin) } },
      efforts, paceTarget: center,
      description: `Doppel-Schwelle @ ${paceTxt}${hr ? ` (${hr})` : ""} — AM ${amReps}×6' /60s · PM ${pmReps}×400m /40s`,
      planned_tss: r1(z1 * tpmE + workMin * tpmW),
    };
  }

  // ---- intervals / hill ----
  const z = tpl.workZone;
  const tpmW = tssPerMin(z, zones), tpmE = tssPerMin(1, zones);
  const center = anchorCenter(tpl.anchor, zones);
  let reps = repsForFitness(tpl, fitness, progress);
  // Rep-Dauer (min): aus repSec ODER repDist via Anker-/Zonenpace.
  const repPaceForTime = center ?? paceOf(z, zones);
  const repMin = tpl.repDist_m ? (tpl.repDist_m / 1000) * repPaceForTime / 60 : (tpl.repSec ?? 60) / 60;
  const restSec = tpl.restSec ?? 60;
  const wuCd = tpl.family === "VO2" || tpl.family === "Race" ? 25 : tpl.family === "Hill" || tpl.family === "Speed" ? 18 : 22;
  const totalAt = (n: number) => wuCd + n * repMin + Math.max(0, n - 1) * (restSec / 60);
  const minReps = tpl.repsByFitness![fitness][0];
  while (reps > minReps && totalAt(reps) > maxMin) reps--;
  const restMin = Math.max(0, reps - 1) * (restSec / 60);
  const workMin = reps * repMin;
  const z1Min = wuCd + restMin;
  const planned_min = r0(z1Min + workMin);
  // HF nur sinnvoll bei längeren/intensiven Reps; bei Steigerungen (kurz, neuromuskulär) irreführend → weglassen.
  const hr = tpl.effort <= 2 ? "" : hrRangeStr(z, zones);
  const repLabel = tpl.repDist_m ? `${tpl.repDist_m}m` : durLabel(tpl.repSec ?? 60);
  const wu = r0(wuCd / 2);

  const effort: Effort = {
    reps, sec: tpl.repSec ?? null, dist_m: tpl.repDist_m ?? null, zone: z,
    pace_s: tpl.kind === "hill" ? null : center, rest_s: restSec, rest_type: tpl.restType ?? "jog", label: tpl.name,
  };
  let description: string;
  if (tpl.kind === "hill") {
    description = `${wu}' WU · ${reps}×${repLabel} bergauf @ Aufwand ${tpl.effort}/5${hr ? ` (${hr})` : ""} / ${restLabel(restSec, tpl.restType ?? "jog")} (Trab-down) · ${wu}' CD`;
  } else {
    const paceTxt = center != null ? paceRangeStr(center, tpl.paceWindow) : `~${paceStr(paceOf(z, zones))}/km`;
    description = `${wu}' WU · ${reps}×${repLabel} @ ${paceTxt}${hr ? ` (${hr})` : ""} / ${restLabel(restSec, tpl.restType ?? "jog")} · ${wu}' CD`;
  }
  return {
    type: tpl.sessionType, planned_min, zone_alloc: { byMin: { 1: r1(z1Min), [z]: r1(workMin) } },
    efforts: [effort], paceTarget: tpl.kind === "hill" ? null : center ?? paceOf(z, zones),
    description, planned_tss: r1(z1Min * tpmE + workMin * tpmW),
  };
}
