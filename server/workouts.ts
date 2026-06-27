// Trainings-Einheiten-Bibliothek (v1.6.1) — sportwissenschaftlich fundierte Vorlagen für den Block-Vorschlag.
// Quellen: Daniels (T/I/R-Pace), Bakken/Casado et al. 2023 (Norwegian sub-threshold/LGTIT), Seiler (polarisiert),
// Billat (30/30), Casado 2022 (Periodisierung), neuromuskuläre Hügelläufe. Pure Modul (keine DB).
//  - WORKOUT_LIBRARY: Katalog mit Metadaten (Familie, Phase, Anstrengung, Nutzen, Synergie, Quelle).
//  - fitnessLevel(): CTL/CS → low|mid|high (skaliert Wiederholungszahlen; 20×400 nur bei hoher Fitness).
//  - pickWeekWorkouts(): Wochen-Komposition je Phase + Rotation (weekInPhase) + Progression + Doubles.
//  - renderWorkout(): Vorlage → konkrete Einheit mit Pace-BEREICH (Anker LT1/LT2/CS) + HF-Spanne + Pausen.
import { paceOf, thrOf, tssPerMin, paceStr, type ZonesInput, type Effort, type ConcreteSession } from "./planbuilder.ts";

export type Family = "Easy" | "Long" | "LT1" | "LT2" | "VO2" | "Hill" | "Speed" | "Race" | "Core";
export type FitnessLevel = "low" | "mid" | "high";
type Anchor = "easy" | "lt1" | "lt2" | "cs" | "rep" | "mp" | "race" | null;

/**
 * Ein Segment einer mehrsegmentigen Einheit (Ladder/Cut-down/Mixed/Float, v1.8.0): eigene Distanz/Dauer,
 * Pace-Versatz zum Anker (negativ = schneller) und Pause. So lassen sich gemischte Rep-Distanzen UND
 * progressiv schnellere Reps abbilden, ohne den TSS-/byKm-Pfad zu ändern.
 */
export interface WorkoutSegment {
  reps?: number;                  // Wiederholungen je Satz (Default 1)
  dist_m?: number; sec?: number;  // Distanz ODER Dauer je Rep
  paceOffset?: number;            // s/km relativ zum Anker (− = schneller)
  restSec?: number; restType?: "jog" | "stand";
  label?: string;
}

export interface WorkoutTemplate {
  id: string;
  family: Family;
  sessionType: string;          // bestehende Option (Easy/Long/Steady/Threshold/VO2/Hill/Race)
  name: string;                 // Anzeige-Kurzname
  purpose: string;              // Nutzen
  phases: string[];             // passende Phasen (Substring-Match)
  effort: 1 | 2 | 3 | 4 | 5;    // Anstrengung
  kind: "steady" | "intervals" | "hill" | "double" | "core";
  workZone: number;             // physiologische Zone (TSS-Basis)
  anchor: Anchor;               // Pace-Anker für den Bereich
  paceWindow: number;           // ± s/km um den Anker
  minMin?: number; maxMin?: number;        // steady: Dauer-Klammer
  repSec?: number; repDist_m?: number;     // Intervall: Dauer ODER Distanz je Rep
  restSec?: number; restType?: "jog" | "stand";
  repsByFitness?: { low: [number, number]; mid: [number, number]; high: [number, number] };
  segments?: WorkoutSegment[];             // v1.8.0: mehrsegmentig (Ladder/Cut-down/Mixed/Float)
  setsByFitness?: { low: number; mid: number; high: number }; // wie oft die Segment-Liste wiederholt wird
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
  { id: "norw_pm_400s", family: "LT2", sessionType: "Threshold", name: "Sub-Threshold 400er (PM)", purpose: "PM-Hälfte einer Doppel-Schwelle — reduziertes 400er-Volumen", phases: ["belast"], effort: 4, kind: "intervals", workZone: 4, anchor: "lt2", paceWindow: 3, repDist_m: 400, restSec: 40, restType: "jog", repsByFitness: RB([8, 8], [9, 10], [10, 12]), synergy: "PM-Hälfte einer Doppel-Schwelle (nach 6'-Reps am Morgen)", lit: "Bakken/Casado 2023" },
  // v1.8.0 Coach-Variation: gemischte Distanzen statt monotoner gleicher Reps.
  { id: "lt2_ladder", family: "LT2", sessionType: "Threshold", name: "Schwellen-Ladder", purpose: "Schwellen-Spektrum über fallende Distanzen — Tempogefühl + Volumen", phases: ["belast", "specific"], effort: 4, kind: "intervals", workZone: 4, anchor: "lt2", paceWindow: 4, restSec: 75, restType: "jog", segments: [{ dist_m: 2000 }, { dist_m: 1000 }, { dist_m: 600 }, { dist_m: 400 }], setsByFitness: { low: 1, mid: 1, high: 2 }, synergy: "Build/Specific-Variante zu Cruise; abwechslungsreich", lit: "Daniels/Coach-Praxis" },
  { id: "lt2_cutdown", family: "LT2", sessionType: "Threshold", name: "Cut-down 1000er", purpose: "progressiv schneller — Pacing-Gefühl + Schluss-Härte", phases: ["belast", "specific"], effort: 4, kind: "intervals", workZone: 4, anchor: "lt2", paceWindow: 4, restSec: 75, restType: "jog", segments: [{ dist_m: 1000, paceOffset: 4 }, { dist_m: 1000, paceOffset: 0 }, { dist_m: 1000, paceOffset: -4 }, { dist_m: 1000, paceOffset: -8 }, { dist_m: 1000, paceOffset: -12 }], setsByFitness: { low: 1, mid: 1, high: 1 }, synergy: "Specific-Schärfung; startet sub-T, endet ~Renntempo", lit: "Coach-Praxis (cut-down)" },
  { id: "lt2_mixed", family: "LT2", sessionType: "Threshold", name: "Mixed 1000+400", purpose: "Schwelle + Schnelligkeit kombiniert — Renn-Härte", phases: ["belast", "specific"], effort: 4, kind: "intervals", workZone: 4, anchor: "lt2", paceWindow: 4, restSec: 60, restType: "jog", segments: [{ dist_m: 1000, label: "Schwelle" }, { dist_m: 400, paceOffset: -10, restSec: 90, label: "flott" }], setsByFitness: { low: 3, mid: 4, high: 5 }, synergy: "Build/Specific; bricht die Monotonie der 1000er", lit: "Coach-Praxis" },
  { id: "lt2_broken_tempo", family: "LT2", sessionType: "Threshold", name: "Gebrochener Tempolauf", purpose: "Schwellen-Dauer in Blöcken — mehr Volumen bei kontrolliertem Laktat", phases: ["belast", "specific"], effort: 4, kind: "intervals", workZone: 4, anchor: "lt2", paceWindow: 3, repSec: 480, restSec: 90, restType: "jog", repsByFitness: RB([2, 3], [3, 3], [3, 4]), synergy: "ruhigere Alternative zu Cruise/1000ern", lit: "Daniels (T-Blöcke)" },
  { id: "norw_double", family: "LT2", sessionType: "Threshold", name: "Doppel-Schwelle (AM+PM)", purpose: "maximales sub-T-Volumen über zwei Einheiten/Tag", phases: ["belast"], effort: 4, kind: "double", workZone: 4, anchor: "lt2", paceWindow: 3, restSec: 50, restType: "jog", repsByFitness: RB([4, 8], [5, 10], [6, 12]), synergy: "nur bei Doubles & guter Fitness; nicht in derselben Woche wie VO2-Block", lit: "Ingebrigtsen/Bakken" },

  // ---- VO2max ----
  { id: "vo2_long", family: "VO2", sessionType: "VO2", name: "VO2max 3'-Intervalle", purpose: "VO2max, aerobe Leistung", phases: ["specific"], effort: 5, kind: "intervals", workZone: 5, anchor: "cs", paceWindow: 5, repSec: 180, restSec: 180, restType: "jog", repsByFitness: RB([5, 5], [5, 6], [6, 6]), synergy: "baut auf Schwellen-Basis auf; nicht neben Doppel-Schwelle", lit: "Daniels (I)" },
  { id: "vo2_45", family: "VO2", sessionType: "VO2", name: "VO2max 4–5'-Intervalle", purpose: "lange Intervalle, mehr Zeit > 90 % VO2max", phases: ["specific"], effort: 5, kind: "intervals", workZone: 5, anchor: "cs", paceWindow: 4, repSec: 270, restSec: 210, restType: "jog", repsByFitness: RB([4, 4], [4, 5], [5, 5]), synergy: "rotiert mit 3'/1000ern", lit: "Daniels; PMC11743937" },
  { id: "vo2_1000s", family: "VO2", sessionType: "VO2", name: "1000er @ VO2/3–5k", purpose: "VO2 + Renntempo-Spezifik", phases: ["specific"], effort: 5, kind: "intervals", workZone: 5, anchor: "cs", paceWindow: 3, repDist_m: 1000, restSec: 150, restType: "jog", repsByFitness: RB([4, 5], [5, 5], [5, 6]), synergy: "Übergang VO2→Renntempo", lit: "Daniels" },
  { id: "vo2_400s", family: "VO2", sessionType: "VO2", name: "400er @ 3k/Mile", purpose: "aerobe Power, Speed-Erhalt", phases: ["belast", "specific"], effort: 5, kind: "intervals", workZone: 5, anchor: "rep", paceWindow: 4, repDist_m: 400, restSec: 90, restType: "jog", repsByFitness: RB([8, 10], [10, 12], [12, 15]), synergy: "ergänzt Schwellen-Block; Sharpening", lit: "Daniels" },
  { id: "vo2_3030", family: "VO2", sessionType: "VO2", name: "30/30 (Billat)", purpose: "maximale Zeit an VO2max, geringe Ermüdung", phases: ["specific"], effort: 5, kind: "intervals", workZone: 5, anchor: "cs", paceWindow: 5, restType: "jog", repSec: 30, restSec: 30, repsByFitness: RB([12, 14], [14, 18], [18, 20]), synergy: "spät im Specific-Block", lit: "Billat 30/30" },
  // v1.8.0 Coach-Variation: Fartlek (Tempowechsel) — strukturiert + nach Gefühl.
  { id: "fartlek_structured", family: "VO2", sessionType: "VO2", name: "Fartlek (strukturiert)", purpose: "aerobe Power + Tempowechsel, weniger monoton als Bahnintervalle", phases: ["base", "belast", "specific"], effort: 4, kind: "intervals", workZone: 5, anchor: "cs", paceWindow: 6, repSec: 60, restSec: 60, restType: "jog", repsByFitness: RB([6, 8], [8, 10], [10, 12]), synergy: "spielerische VO2/Tempo-Variante; gut in Base/Build", lit: "Fartlek (Holmér)" },
  { id: "fartlek_free", family: "VO2", sessionType: "VO2", name: "Fartlek (nach Gefühl)", purpose: "Tempowechsel nach Gefühl — Renn-Härte, Kopf frei", phases: ["base", "belast", "specific"], effort: 4, kind: "intervals", workZone: 4, anchor: "lt2", paceWindow: 10, repSec: 90, restSec: 90, restType: "jog", repsByFitness: RB([5, 6], [6, 8], [8, 10]), synergy: "auflockernd; ersetzt mal ein striktes Intervall", lit: "Fartlek (Holmér)" },

  // ---- Berg + Speed/Reps ----
  { id: "hill_sprints", family: "Hill", sessionType: "Hill", name: "Bergsprints (kurz)", purpose: "Neuromuskulär, Ökonomie, Kraft", phases: ["base", "belast", "specific"], effort: 4, kind: "hill", workZone: 5, anchor: null, paceWindow: 0, repSec: 12, restSec: 60, restType: "jog", repsByFitness: RB([8, 8], [8, 10], [10, 12]), synergy: "low-load; passt an jeden Easy-Tag, baut auf Speed", lit: "neuromuskuläre Hügelläufe" },
  { id: "hill_reps_short", family: "Hill", sessionType: "Hill", name: "Hügel-Reps 60–90s", purpose: "Kraftausdauer, VO2 bergauf (gelenkschonend)", phases: ["base", "belast"], effort: 5, kind: "hill", workZone: 5, anchor: null, paceWindow: 0, repSec: 75, restSec: 90, restType: "jog", repsByFitness: RB([6, 6], [6, 8], [8, 10]), synergy: "Base/Build-Stärke vor Bahn-VO2", lit: "Daniels/Magness" },
  { id: "hill_reps_long", family: "Hill", sessionType: "Hill", name: "Hügel-Reps 2–3'", purpose: "Stärke-Ausdauer, Schwelle bergauf", phases: ["belast"], effort: 5, kind: "hill", workZone: 4, anchor: null, paceWindow: 0, repSec: 150, restSec: 150, restType: "jog", repsByFitness: RB([4, 4], [4, 5], [5, 6]), synergy: "Build-Alternative zur Schwelle", lit: "Canova" },
  // v1.8.0 Coach-Variation: lange Bergintervalle (Berg-Pendant zu langen VO2-Reps).
  { id: "hill_reps_xlong", family: "Hill", sessionType: "Hill", name: "Lange Hügel-Reps 3–4'", purpose: "Kraftausdauer + VO2 bergauf, gelenkschonend", phases: ["belast", "specific"], effort: 5, kind: "hill", workZone: 4, anchor: null, paceWindow: 0, repSec: 210, restSec: 210, restType: "jog", repsByFitness: RB([4, 4], [4, 5], [5, 6]), synergy: "Build/Specific; Berg-Pendant zu langen VO2-Intervallen", lit: "Canova (long hills)" },
  { id: "reps_R", family: "Speed", sessionType: "VO2", name: "200–400er @ R-Pace", purpose: "Laufökonomie, Speed (volle Pause)", phases: ["base", "belast", "specific"], effort: 5, kind: "intervals", workZone: 5, anchor: "rep", paceWindow: 4, repDist_m: 300, restSec: 120, restType: "stand", repsByFitness: RB([8, 8], [8, 10], [10, 12]), synergy: "ergänzt aerobe Arbeit ohne große Last (Daniels R)", lit: "Daniels (R)" },
  { id: "strides", family: "Speed", sessionType: "Easy", name: "Steigerungen", purpose: "Neuromuskulär, Lockerheit", phases: ["base", "belast", "specific", "entlast", "race"], effort: 2, kind: "intervals", workZone: 5, anchor: "rep", paceWindow: 6, repSec: 18, restSec: 60, restType: "stand", repsByFitness: RB([6, 6], [6, 8], [8, 8]), synergy: "an Easy-Tage/Taper anhängen", lit: "Standard" },

  // ---- Race ----
  { id: "race_pace", family: "Race", sessionType: "Race", name: "Renntempo-Intervalle", purpose: "Wettkampf-Spezifik (kurze Distanz, 5–10k)", phases: ["specific", "race"], effort: 5, kind: "intervals", workZone: 4, anchor: "race", paceWindow: 4, repDist_m: 1000, restSec: 90, restType: "jog", repsByFitness: RB([3, 4], [4, 5], [5, 6]), synergy: "Specific-Phase; ersetzt eine Schwelle", lit: "Casado 2022" },
  { id: "race_pace_long", family: "Race", sessionType: "Race", name: "Renntempo-Blöcke (lang)", purpose: "Renntempo-Spezifik für HM/Marathon", phases: ["specific", "race"], effort: 4, kind: "intervals", workZone: 4, anchor: "race", paceWindow: 4, repDist_m: 2000, restSec: 90, restType: "jog", repsByFitness: RB([3, 3], [3, 4], [4, 5]), synergy: "HM/Marathon-Block; ersetzt VO2-Schärfung durch Renntempo-Volumen", lit: "Canova/Casado" },
  // v1.8.0 Coach-Variation: Renntempo-Float (Renntempo abwechselnd mit Schwellen-Float, kaum Pause).
  { id: "race_mix", family: "Race", sessionType: "Race", name: "Renntempo-Float", purpose: "Renntempo mit Schwellen-Float — spezifische Härte ohne Vollstopp", phases: ["specific", "race"], effort: 4, kind: "intervals", workZone: 4, anchor: "race", paceWindow: 4, restSec: 20, restType: "jog", segments: [{ dist_m: 1000, label: "Renntempo" }, { dist_m: 1000, paceOffset: 12, label: "Float" }], setsByFitness: { low: 2, mid: 3, high: 4 }, synergy: "HM/Marathon-Specific; Renntempo-Ausdauer", lit: "Canova (float)" },
  { id: "long_mp_segments", family: "Long", sessionType: "Long", name: "Longrun mit MP-Blöcken", purpose: "Marathon-Tempo unter Ermüdung, Glykogen-Ökonomie", phases: ["belast", "specific"], effort: 4, kind: "steady", workZone: 2, anchor: "race", paceWindow: 0, minMin: 90, maxMin: 150, synergy: "Marathon-Long-Slot; 2–3×15–20' @ Marathon-Pace im Longrun", lit: "Canova" },

  // ---- Stabi/Core (v1.7.0) ----
  { id: "core_strength", family: "Core", sessionType: "Strength", name: "Stabi/Core", purpose: "Rumpf/Hüfte/Plyometrie — Verletzungsprävention + Laufökonomie", phases: ["base", "belast", "specific", "entlast", "race"], effort: 2, kind: "core", workZone: 1, anchor: null, paceWindow: 0, minMin: 15, maxMin: 30, synergy: "an Easy-Tage angehängt; belastet harte Tage nicht", lit: "Standard (Stärke/Plyo)" },
];

/** Workout-Vorlage per id (für Live-Resolution + Downgrade-Fallback). */
export function workoutById(id: string): WorkoutTemplate | undefined { return byId.get(id) ?? customById.get(id); }

const byId = new Map(WORKOUT_LIBRARY.map((w) => [w.id, w]));
// v1.9.0 (Z14): eigene Einheiten je Profil. index.ts ruft setCustomWorkouts() vor jeder Vorschlags-/Block-Anfrage.
let CUSTOM: WorkoutTemplate[] = [];
const customById = new Map<string, WorkoutTemplate>();
export function setCustomWorkouts(list: WorkoutTemplate[]): void {
  CUSTOM = list.filter((w) => w && w.id && !byId.has(w.id)); // Bibliothek nie überschreiben
  customById.clear();
  for (const w of CUSTOM) customById.set(w.id, w);
}
export function customWorkoutList(): WorkoutTemplate[] { return CUSTOM; }
const hasWk = (id: string): boolean => byId.has(id) || customById.has(id);
const getWk = (id: string): WorkoutTemplate | undefined => byId.get(id) ?? customById.get(id);
const wk = (id: string): WorkoutTemplate => (byId.get(id) ?? customById.get(id))!;

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
export interface WorkoutPick { tpl: WorkoutTemplate; role: "quality" | "long" | "easy" | "core"; pair?: string } // v1.7: pair = Doppel-Tag (AM+PM)
const rot = <T,>(arr: T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length];

/**
 * Wählt die Einheiten einer Woche je Phase. `weekInPhase` rotiert die Qualitäts-Slots (Abwechslung);
 * die Progression (Dosis) kommt über `progress` im Renderer. Doubles erzeugen einen Doppel-Schwellen-Tag.
 * `corePerWeek` hängt v1.7.0-Stabi/Core-Einheiten an (role „core", an Easy-Tage geplant).
 */
export interface BlockPrefs { emphasis?: string | null; favoriteWorkouts?: string[]; avoidWorkouts?: string[] }

export function pickWeekWorkouts(phase: string | null | undefined, weekInPhase: number, fitness: FitnessLevel, allowDoubles: boolean, goalDistanceM: number | null = null, corePerWeek = 0, prefs?: BlockPrefs): WorkoutPick[] {
  const core = Array.from({ length: Math.max(0, Math.min(3, corePerWeek)) }, (): WorkoutPick => ({ tpl: wk("core_strength"), role: "core" }));

  // v1.8.0 Block-Präferenzen (advisory): Vermeiden raus, Schwerpunkt + Favoriten häufiger. Erholung/Phasen bleiben verbindlich.
  const avoid = new Set(prefs?.avoidWorkouts ?? []);
  const favs = (prefs?.favoriteWorkouts ?? []).filter((id) => hasWk(id));
  const EMPH: Record<string, (t: WorkoutTemplate) => boolean> = {
    schwelle: (t) => t.family === "LT2", vo2: (t) => t.family === "VO2" && !t.id.startsWith("fartlek"),
    berg: (t) => t.family === "Hill", norwegian: (t) => t.id.startsWith("norw"), fartlek: (t) => t.id.startsWith("fartlek"),
  };
  const emphMatch = prefs?.emphasis && prefs.emphasis !== "ausgewogen" ? EMPH[prefs.emphasis] : null;
  const av = (list: string[]): string[] => { const f = list.filter((id) => !avoid.has(id)); return f.length ? f : list; };
  const pref = (list: string[]): string[] => {
    const out = av(list);
    for (const f of favs) if (!out.includes(f)) out.push(f); // Favoriten in den rotierten Pool aufnehmen
    return out;
  };
  const EMPH_POOL: Record<string, string[]> = {
    berg: ["hill_reps_xlong", "hill_reps_short", "hill_reps_long"],
    fartlek: ["fartlek_structured", "fartlek_free"],
    vo2: ["vo2_long", "vo2_45", "vo2_1000s"],
    schwelle: ["lt2_cruise", "lt2_ladder", "lt2_mixed", "lt2_1000s", "lt2_broken_tempo"],
    norwegian: ["norw_400s", "norw_short_reps"],
  };
  // Eine einzelne Qualität (nicht strides/Doppel) Richtung Schwerpunkt drehen — nur Build/Specific, phasengerecht.
  const emphasize = (picks: WorkoutPick[]): WorkoutPick[] => {
    if (!emphMatch || !prefs?.emphasis) return picks;
    const ph = (phase || "").toLowerCase();
    if (!(ph.includes("belast") || ph.includes("build") || ph.includes("aufbau") || ph.includes("spec"))) return picks;
    const pool = (EMPH_POOL[prefs.emphasis] ?? []).filter((id) => !avoid.has(id) && hasWk(id) && getWk(id)!.phases.some((x) => ph.includes(x)));
    if (!pool.length) return picks;
    if (picks.some((p) => p.role === "quality" && !p.pair && emphMatch!(p.tpl))) return picks; // schon vertreten
    const idx = picks.map((p, i) => ({ p, i })).reverse().find(({ p }) => p.role === "quality" && !p.pair && p.tpl.id !== "strides" && !emphMatch!(p.tpl))?.i;
    if (idx == null) return picks;
    const next = [...picks];
    next[idx] = { tpl: wk(rot(pool, weekInPhase)), role: "quality" };
    return next;
  };

  return [...emphasize(pickPhase()), ...core];

  function pickPhase(): WorkoutPick[] {
  const p = (phase || "").toLowerCase();
  const Q = (id: string): WorkoutPick => ({ tpl: wk(id), role: "quality" });
  const QP = (id: string, pair: string): WorkoutPick => ({ tpl: wk(id), role: "quality", pair }); // Doppel-Tag-Hälfte
  const L = (id: string): WorkoutPick => ({ tpl: wk(id), role: "long" });
  const E = (id: string): WorkoutPick => ({ tpl: wk(id), role: "easy" });
  // Distanz-Bucket fürs Renntempo: short ≤15k (5–10k) · mid HM · long ≥30k (Marathon). 0/null → wie short.
  const dist = goalDistanceM ?? 0;
  const isLong = dist >= 30000;
  const isMid = dist >= 15000 && dist < 30000;

  // v1.8.0 Coach-Matrix — Distanz × Niveau: Einsteiger bekommen einfache, gleiche Reps; Fortgeschrittene
  // gemischte/progressive Sessions (Ladder/Cut-down/Mixed). Fartlek bringt Abwechslung, lange Bergintervalle
  // sind das Berg-Pendant zu VO2. Pools rotieren über `weekInPhase` → keine zwei identischen Wochen.
  const lt2Pool = pref(fitness === "high" ? ["lt2_cutdown", "lt2_ladder", "lt2_mixed", "lt2_cruise", "lt2_1000s", "lt2_broken_tempo"]
    : fitness === "mid" ? ["lt2_ladder", "lt2_mixed", "lt2_cruise", "lt2_1000s", "lt2_broken_tempo"]
      : ["lt2_cruise", "lt2_1000s", "lt2_broken_tempo", "norw_short_reps"]); // low: einfache, gleiche Reps
  const vo2Pool = pref(fitness === "low" ? ["vo2_long", "fartlek_structured", "vo2_long", "vo2_45"]
    : ["vo2_long", "vo2_45", "vo2_1000s", "fartlek_structured", "vo2_3030"]);
  const hillPool = pref(fitness === "low" ? ["hill_reps_short", "hill_reps_long"] : ["hill_reps_xlong", "hill_reps_short", "hill_reps_long"]);

  if (p.includes("krank")) return [E("easy_recovery"), E("easy_recovery")];
  if (p.includes("recovery") || p.includes("erholung")) return [E("easy_recovery"), E("easy_ga1"), E("easy_recovery"), Q("strides")];

  if (p.includes("race week") || p.includes("raceweek") || p.includes("race-week")) {
    return [Q("strides"), Q(rot(av(["race_pace", "vo2_400s"]), weekInPhase)), E("easy_ga1"), E("easy_recovery"), E("easy_recovery")];
  }
  if (p.includes("entlast") || p.includes("deload")) {
    return [L("long_aerobic"), Q(rot(av(["lt2_cruise", "strides"]), weekInPhase)), E("easy_ga1"), E("easy_recovery"), E("easy_recovery")];
  }
  if (p.includes("specific") || p.includes("spec")) {
    if (isLong) { // Marathon: Schwelle/MP-lastig, Renntempo-Blöcke + Float, MP-Longrun, VO2 reduziert
      return [
        L("long_mp_segments"),
        Q(rot(av(["race_pace_long", "race_mix", "lt2_broken_tempo", "race_pace_long"]), weekInPhase)),
        Q(rot(av([lt2Pool[0], "race_pace_long", lt2Pool[1] ?? "lt2_cruise", "lt2_broken_tempo"]), weekInPhase)),
        Q("strides"), E("easy_ga1"), E("easy_recovery"),
      ];
    }
    if (isMid) { // HM: Schwelle + Renntempo-Blöcke + Float + 1 VO2
      return [
        L(weekInPhase >= 1 ? "long_fastfinish" : "long_aerobic"),
        Q(rot(av(["race_pace_long", "race_mix", "vo2_1000s", "race_pace_long"]), weekInPhase)),
        Q(rot(av([lt2Pool[0], "vo2_45", "race_mix", lt2Pool[1] ?? "lt2_cruise"]), weekInPhase)),
        Q("strides"), E("easy_ga1"), E("easy_recovery"),
      ];
    }
    // short / kein Ziel: VO2-lastig (5–10k) + kurze Renntempo-Intervalle (für Fortgeschrittene Cut-down)
    return [
      L(weekInPhase >= 1 ? "long_fastfinish" : "long_aerobic"),
      Q(rot(vo2Pool, weekInPhase)),
      Q(rot(av(["race_pace", fitness === "low" ? "lt2_cruise" : "lt2_cutdown", "race_pace", "vo2_400s"]), weekInPhase)),
      Q("strides"), E("easy_ga1"), E("easy_recovery"),
    ];
  }
  if (p.includes("belast") || p.includes("build") || p.includes("aufbau")) {
    // Build: 1. Schwellen-Slot aus dem niveaugerechten LT2-Pool; 2. Slot = Berg/Fartlek/VO2-Abwechslung.
    const thr1 = rot(lt2Pool, weekInPhase);
    const thr2 = rot(av([hillPool[0], "fartlek_structured", "vo2_400s", lt2Pool[1] ?? "lt2_cruise"]), weekInPhase);
    // Marathon-Ziel: spätere Aufbauwochen bekommen den MP-Block-Longrun statt reinem Dauerlauf.
    const picks: WorkoutPick[] = [L(isLong && weekInPhase >= 1 ? "long_mp_segments" : "long_aerobic")];
    if (allowDoubles && fitness !== "low") {
      // Doppel-Schwellen-Tag als ZWEI Einheiten (AM 6'-Reps + PM 400er) am selben Tag (v1.7).
      picks.push(QP("norw_short_reps", "double_thr"));
      picks.push(QP("norw_pm_400s", "double_thr"));
      picks.push(Q(rot(av([hillPool[0], "vo2_400s", "fartlek_structured"]), weekInPhase)));
    } else {
      picks.push(Q(thr1), Q(thr2));
    }
    picks.push(Q("strides"), E("easy_ga1"), E("easy_recovery"));
    return picks;
  }
  // Base (Default): viel Z1/Z2, LT1 + Hügel/Speed-Ökonomie + spielerischer Fartlek, kaum LT2.
  return [
    L("long_aerobic"),
    Q(rot(av(["lt1_continuous", "lt1_long_reps", "fartlek_free", "hill_reps_short"]), weekInPhase)),
    Q(rot(av(["hill_sprints", "strides", "reps_R", "fartlek_structured"]), weekInPhase)),
    E("easy_ga1"), E("easy_ga1"), E("easy_recovery"),
  ];
  }
}

// ---------------- Renderer ----------------
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Minuten je Zone → km je Zone (v1.7-Fix): `km = min·60/paceOf(z)` — dieselbe Pace, die `sessionZoneMinutes`
 *  zur Rückrechnung byKm→min nutzt → Plan-TSS exakt unverändert, aber die Modal-Felder (km je Zone) füllen sich. */
function byMinToByKm(byMin: Record<number, number>, zones: ZonesInput): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [z, min] of Object.entries(byMin)) {
    const zi = Number(z), pace = paceOf(zi, zones);
    if (min > 0 && pace > 0) out[zi] = Math.round(((min * 60) / pace) * 100) / 100;
  }
  return out;
}

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
// v1.7.0: optionaler Watt-Zusatzanker (CP × %CP-Band je Zone). Pace bleibt führend.
const CP_BANDS: Record<number, [number, number]> = { 1: [0.6, 0.75], 2: [0.75, 0.85], 3: [0.85, 0.92], 4: [0.92, 1.0], 5: [1.0, 1.1], 6: [1.1, 1.25] };
function wattRangeStr(z: number, zones: ZonesInput): string {
  const cp = zones.cp;
  if (!cp || cp <= 0) return "";
  const [lo, hi] = CP_BANDS[z] ?? CP_BANDS[4];
  return `${Math.round(cp * lo)}–${Math.round(cp * hi)} W`;
}
/** HF + optional Watt zu einer Klammer-Angabe „166–182 bpm · 290–310 W" zusammenfassen. */
function metricsStr(z: number, zones: ZonesInput): string {
  return [hrRangeStr(z, zones), wattRangeStr(z, zones)].filter(Boolean).join(" · ");
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

  if (tpl.kind === "core") {
    // Stabi/Core: feste kurze Einheit, trägt keine Lauf-TSS (leere zone_alloc → Server-TSS = 0).
    const min = Math.round(((tpl.minMin ?? 15) + (tpl.maxMin ?? 30)) / 2);
    return {
      type: tpl.sessionType, planned_min: min, zone_alloc: { byKm: {} },
      efforts: null, paceTarget: null,
      description: `${min} min ${tpl.name} (Rumpf · Hüfte · Plyometrie)`,
      planned_tss: 0,
    };
  }

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
    const hr = metricsStr(z, zones);
    const racePace = anchorCenter("race", zones);
    const extra = tpl.id === "long_fastfinish" ? ` · letzte 15–20' @ Renntempo${racePace ? ` (~${paceStr(racePace)}/km)` : ""}`
      : tpl.id === "long_mp_segments" ? ` · 2–3×15–20' @ Marathon-Pace${racePace ? ` (~${paceStr(racePace)}/km)` : ""}`
      : "";
    return {
      type: tpl.sessionType, planned_min: min, zone_alloc: { byKm: byMinToByKm({ [z]: min }, zones) },
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
    const hr = metricsStr(z, zones), paceTxt = paceRangeStr(center, tpl.paceWindow);
    const efforts: Effort[] = [
      { reps: amReps, sec: 360, zone: z, pace_s: center, rest_s: 60, rest_type: "jog", label: "Sub-T AM" },
      { reps: pmReps, dist_m: 400, zone: z, pace_s: center, rest_s: 40, rest_type: "jog", label: "Sub-T PM" },
    ];
    return {
      type: tpl.sessionType, planned_min: r0(z1 + workMin), zone_alloc: { byKm: byMinToByKm({ 1: r1(z1), [z]: r1(workMin) }, zones) },
      efforts, paceTarget: center,
      description: `Doppel-Schwelle @ ${paceTxt}${hr ? ` (${hr})` : ""} — AM ${amReps}×6' /60s · PM ${pmReps}×400m /40s`,
      planned_tss: r1(z1 * tpmE + workMin * tpmW),
    };
  }

  // ---- mehrsegmentig: Ladder / Cut-down / Mixed / Float (v1.8.0) ----
  if (tpl.segments && tpl.segments.length) {
    const z = tpl.workZone;
    const tpmW = tssPerMin(z, zones), tpmE = tssPerMin(1, zones);
    const center = anchorCenter(tpl.anchor, zones) ?? paceOf(z, zones);
    const wuCd = tpl.family === "VO2" || tpl.family === "Race" ? 25 : 22;
    const wu = r0(wuCd / 2);
    const build = (sets: number) => {
      const efforts: Effort[] = [];
      const parts: string[] = [];
      let workMin = 0, totalRestSec = 0, lastRestSec = 60;
      for (const seg of tpl.segments!) {
        const segReps = (seg.reps ?? 1) * sets;
        const segPace = Math.round(center + (seg.paceOffset ?? 0));
        const segMin = seg.dist_m ? (seg.dist_m / 1000) * segPace / 60 : (seg.sec ?? 60) / 60;
        const restSec = seg.restSec ?? tpl.restSec ?? 60;
        workMin += segReps * segMin;
        totalRestSec += segReps * restSec;
        lastRestSec = restSec;
        efforts.push({ reps: segReps, dist_m: seg.dist_m ?? null, sec: seg.sec ?? null, zone: z, pace_s: segPace, rest_s: restSec, rest_type: seg.restType ?? tpl.restType ?? "jog", label: seg.label ?? tpl.name });
        const repLabel = seg.dist_m ? `${seg.dist_m}m` : durLabel(seg.sec ?? 60);
        parts.push(`${segReps > 1 ? `${segReps}×` : ""}${repLabel}${seg.paceOffset ? ` @${paceStr(segPace)}` : ""}`);
      }
      const restMin = Math.max(0, totalRestSec - lastRestSec) / 60; // letzte Wiederholung ohne Pause
      const z1Min = wuCd + restMin;
      return { efforts, parts, workMin, z1Min, planned_min: r0(z1Min + workMin) };
    };
    let sets = tpl.setsByFitness?.[fitness] ?? 1;
    let b = build(sets);
    while (sets > 1 && b.planned_min > maxMin) { sets--; b = build(sets); }
    const hr = metricsStr(z, zones);
    const paceTxt = paceRangeStr(center, tpl.paceWindow);
    const description = `${wu}' WU · ${b.parts.join(" · ")} @ ${paceTxt}${hr ? ` (${hr})` : ""} · ${wu}' CD`;
    return {
      type: tpl.sessionType, planned_min: b.planned_min,
      zone_alloc: { byKm: byMinToByKm({ 1: r1(b.z1Min), [z]: r1(b.workMin) }, zones) },
      efforts: b.efforts, paceTarget: center, description, planned_tss: r1(b.z1Min * tpmE + b.workMin * tpmW),
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
  const hr = tpl.effort <= 2 ? "" : metricsStr(z, zones);
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
    type: tpl.sessionType, planned_min, zone_alloc: { byKm: byMinToByKm({ 1: r1(z1Min), [z]: r1(workMin) }, zones) },
    efforts: [effort], paceTarget: tpl.kind === "hill" ? null : center ?? paceOf(z, zones),
    description, planned_tss: r1(z1Min * tpmE + workMin * tpmW),
  };
}

// ---------------- Eigene Einheiten (v1.9.0, Z14) ----------------
const SESSION_TYPE: Record<Family, string> = { Easy: "Easy", Long: "Long", LT1: "Steady", LT2: "Threshold", VO2: "VO2", Hill: "Hill", Speed: "VO2", Race: "Race", Core: "Stabi" };
const ANCHOR_BY_ZONE: Anchor[] = [null, "easy", "easy", "lt1", "lt2", "cs", "rep"]; // Index = Zone (1..6)
const IF_BY_ZONE = [0, 0.65, 0.72, 0.85, 0.95, 1.05, 1.12];
function hashStr(s: string): number { let h = 0; for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

export interface CustomInput {
  name: string; family: Family; kind: "steady" | "intervals"; workZone: number;
  minMin?: number; maxMin?: number; reps?: number; repSec?: number; repDist_m?: number; restSec?: number;
  phases?: string[]; goalPaceS?: number;
}

/** Aus den Form-Eingaben eine gültige WorkoutTemplate bauen + Familie/Anstrengung/TSS vorschätzen (Z14). */
export function estimateCustom(inp: CustomInput): { template: WorkoutTemplate; tssEstimate: number; durationMin: number } {
  const z = Math.max(1, Math.min(6, Math.round(inp.workZone || 4)));
  const anchor = ANCHOR_BY_ZONE[z];
  const IF = IF_BY_ZONE[z];
  const effort = (z <= 1 ? 1 : z >= 5 ? 5 : z) as 1 | 2 | 3 | 4 | 5;
  const reps = Math.max(1, inp.reps ?? 5);
  const id = "custom_" + ((inp.name || "einheit").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "einheit") + "_" + Math.abs(hashStr(inp.name || "")).toString(36).slice(0, 4);
  let tss: number, durationMin: number;
  if (inp.kind === "steady") {
    const dur = Math.round(((inp.minMin ?? 30) + (inp.maxMin ?? inp.minMin ?? 40)) / 2);
    durationMin = dur; tss = Math.round((dur * IF * IF * 100) / 60);
  } else {
    const repMin = inp.repSec ? inp.repSec / 60 : (inp.repDist_m && inp.goalPaceS ? (inp.repDist_m / 1000) * (inp.goalPaceS / 60) : 3);
    const restMin = (inp.restSec ?? 90) / 60;
    const workMin = reps * repMin, recMin = reps * restMin, wucd = 26;
    durationMin = Math.round(workMin + recMin + wucd);
    tss = Math.round(((workMin * IF * IF + recMin * 0.3 + wucd * 0.36) * 100) / 60);
  }
  const template: WorkoutTemplate = {
    id, family: inp.family, sessionType: SESSION_TYPE[inp.family] ?? "Steady", name: inp.name || "Eigene Einheit",
    purpose: "Eigene Einheit", phases: inp.phases?.length ? inp.phases : ["base", "belast", "specific"],
    effort, kind: inp.kind === "steady" ? "steady" : "intervals", workZone: z, anchor, paceWindow: inp.kind === "steady" ? 0 : 4,
    minMin: inp.kind === "steady" ? (inp.minMin ?? 30) : undefined, maxMin: inp.kind === "steady" ? (inp.maxMin ?? 40) : undefined,
    repSec: inp.kind === "intervals" ? inp.repSec : undefined, repDist_m: inp.kind === "intervals" ? inp.repDist_m : undefined,
    restSec: inp.kind === "intervals" ? (inp.restSec ?? 90) : undefined, restType: "jog",
    repsByFitness: inp.kind === "intervals" ? { low: [Math.max(1, reps - 1), reps], mid: [reps, reps], high: [reps, reps + 1] } : undefined,
    synergy: "eigene Einheit", lit: "—",
  };
  return { template, tssEstimate: tss, durationMin };
}
