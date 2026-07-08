// Beta-Test-Personas (v2.8.x): acht fiktive Athlet:innen mit je ~18–24 Monaten physiologisch handgeschnitzter
// Voll-Datenlage, jede auf einem eigenen, fixen profile_id (101–108). Strikt additiv: echte Profile (id<100)
// bleiben unberührt. Deterministisch (seeded RNG je Persona), idempotent (Re-Seed löscht nur Beta-IDs), löschbar.
//
// Doppelzweck: (1) Beta-/Stress-/Funktionstest der App, (2) spätere Trainings-/Validierungs-Fixtures für die
// Analyse-/ML-Modelle. Deshalb treffen bzw. verfehlen die Personas die Datenhinlänglichkeits-Gates gezielt
// (siehe je Config den Kommentar „ML-Gate“).
import { db, setSetting, getSetting, setProfileSetting, DEFAULT_HR_ZONES } from "./db.ts";
import {
  buildFeedbackContext,
  evaluateCycleStability,
  evaluatePhaseStimulus,
  cycleIndexOf,
  type ContraceptionStatus,
  type Period,
} from "./cycleTraining.ts";

const DAY_MS = 86_400_000;
const BETA_IDS_KEY = "beta_persona_ids";

// ---- geteilte Helfer (Muster tutorial.ts) ----
const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
const mondayOf = (iso: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  const wd = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -wd);
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const paceStr = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---- Session-Bibliothek (physiologische Rahmen; Bike/Ultra ergänzt gegenüber Mara-Tutorial) ----
type Key =
  | "recovery" | "easy" | "long" | "ultralong" | "marathon" | "threshold" | "lt1" | "vo2" | "reps" | "hill"
  | "bike_easy" | "bike_hard" | "strength";
type Sport = "Run" | "Bike" | "Strength";
type Family = "easy" | "long" | "threshold" | "vo2" | "bike" | "strength";
type Phase = "Base" | "Build" | "Specific" | "Taper" | "Recovery" | "Peak";

interface SessDef {
  type: string; label: string; sport: Sport; durMin: number; durMax: number; if: number;
  z: Record<number, number>; hr: number; family: Family; workOffset?: number; eff?: boolean;
}
const SESS: Record<Key, SessDef> = {
  recovery: { type: "Recovery", label: "Regenerationslauf", sport: "Run", durMin: 32, durMax: 46, if: 0.67, z: { 1: 0.5, 2: 0.5 }, hr: 124, family: "easy" },
  easy: { type: "Easy", label: "Lockerer Dauerlauf", sport: "Run", durMin: 46, durMax: 74, if: 0.72, z: { 1: 0.18, 2: 0.82 }, hr: 138, family: "easy", eff: true },
  long: { type: "Long", label: "Longrun", sport: "Run", durMin: 88, durMax: 150, if: 0.77, z: { 2: 0.8, 3: 0.2 }, hr: 148, family: "long", eff: true },
  ultralong: { type: "Long", label: "Ultra-Longrun", sport: "Run", durMin: 150, durMax: 300, if: 0.72, z: { 1: 0.15, 2: 0.7, 3: 0.15 }, hr: 143, family: "long", eff: true },
  marathon: { type: "MarathonPace", label: "Marathon-/HM-Pace", sport: "Run", durMin: 55, durMax: 90, if: 0.84, z: { 2: 0.4, 3: 0.5, 4: 0.1 }, hr: 158, family: "threshold", workOffset: 10, eff: true },
  threshold: { type: "Threshold", label: "Schwelle (LT2)", sport: "Run", durMin: 52, durMax: 76, if: 0.89, z: { 2: 0.44, 3: 0.13, 4: 0.43 }, hr: 166, family: "threshold", workOffset: 0, eff: true },
  lt1: { type: "LT1", label: "Aerobe Schwelle (LT1)", sport: "Run", durMin: 60, durMax: 95, if: 0.8, z: { 2: 0.55, 3: 0.45 }, hr: 152, family: "threshold", workOffset: 20, eff: true },
  vo2: { type: "VO2", label: "VO2max", sport: "Run", durMin: 42, durMax: 60, if: 0.93, z: { 2: 0.48, 4: 0.15, 5: 0.37 }, hr: 174, family: "vo2", workOffset: -20, eff: true },
  reps: { type: "Repetitions", label: "Repetitions", sport: "Run", durMin: 36, durMax: 50, if: 0.87, z: { 1: 0.3, 2: 0.38, 5: 0.2, 6: 0.12 }, hr: 168, family: "vo2", workOffset: -30, eff: true },
  hill: { type: "Hill", label: "Bergsprints/Hügel", sport: "Run", durMin: 40, durMax: 58, if: 0.85, z: { 1: 0.35, 2: 0.4, 5: 0.15, 6: 0.1 }, hr: 165, family: "vo2", workOffset: -25, eff: true },
  bike_easy: { type: "Bike", label: "Rad locker", sport: "Bike", durMin: 60, durMax: 130, if: 0.65, z: { 1: 0.3, 2: 0.7 }, hr: 128, family: "bike" },
  bike_hard: { type: "Bike", label: "Rad Sweetspot/Schwelle", sport: "Bike", durMin: 55, durMax: 90, if: 0.85, z: { 2: 0.35, 3: 0.35, 4: 0.3 }, hr: 155, family: "bike" },
  strength: { type: "Strength", label: "Kraft/Core", sport: "Strength", durMin: 30, durMax: 55, if: 0.6, z: { 1: 0.6, 2: 0.4 }, hr: 110, family: "strength" },
};

type Disturbance = "illness" | "travel" | "niggle" | null;
type ActivitySeed = { id: number; date: string; key: Key; phase: Phase; disturbance: Disturbance; family: Family };

// ---- Persona-Config ----
type CycleKind = "none" | "regular" | "irregular";
interface PersonaConfig {
  id: number;
  name: string;               // Profilname (erscheint im Profil-Switcher)
  displayName: string;        // Anzeigename Athlet
  sex: "m" | "f";
  birthYear: number;
  weight: number; height: number; maxHr: number; hrRest: number;
  lthr: number; thresholdPace: number; lt1Hr: number; lt1Pace: number; ftp: number;
  paceZones: number[];        // Z1..Z6 Sek/km
  hrBounds: number[];         // 6 Untergrenzen (Z1..Z6)
  pastWeeks: number; futureWeeks: number;
  activeFromWeek: number;     // ab welcher Woche überhaupt Training (Cold-Start: >0)
  emphasis: string;
  availability: Record<string, unknown>;
  // Arcs (progress = 0..1 über die aktive Historie):
  targetKm: (phase: Phase, progress: number, deload: boolean, w: number) => number;
  thresholdPaceArc: (progress: number, w: number) => number;   // Sek/km Schwellen-Pace über Zeit
  effVo2Arc: (progress: number, w: number) => number;
  phaseOf: (w: number, ctx: { todayWeekIndex: number; pastWeeks: number }) => Phase;
  weekTemplate: (phase: Phase, w: number, deload: boolean) => Partial<Record<number, Key>>;
  wellness: (date: string, progress: number, disturb: Disturbance, recentLow: boolean, rng: Rng) => WellnessRow;
  disturbances: { illnessStart?: string; travelStart?: string; niggleStart?: string };
  overreach?: boolean;        // Petra: chronische Überlast (kein Taper, ACWR-Spikes)
  cycle: CycleKind;
  contraception: ContraceptionStatus;
  cycleAdaptive?: boolean;
  races: RaceSeed[];
  labs: LabSeed[];
  vo2labs: Vo2Seed[];
  feedbackKeyChance: number;  // Anteil Key-Einheiten mit Feedback (ML-Gate-Steuerung)
  feedbackEasyChance: number;
  seed: number;
  note: string;
}
type Rng = { next: () => number; jit: (b: number, a: number) => number; chance: (p: number) => boolean };
interface WellnessRow {
  weight: number; rhr: number; hrv: number; recovery: number; strain: number; sleep: number;
  soreness: number; motivation: number; rpe: number; sick: number; travel: number; pain: number;
  painLoc: string | null; notes: string | null;
}
type RaceSeed = { dayOffset: number; name: string; distM: number; timeS: number | null; placement: string; notes: string; goalS?: number | null; tuneup?: boolean; elevM?: number };
type LabSeed = { dayOffset: number; notes: string; lt1Hr: number; lt1Pace: number; lt2Hr: number; lt2Pace: number; confidence: string };
type Vo2Seed = { dayOffset: number; value: number; notes: string };

function makeRng(seed: number): Rng {
  let s = seed;
  const next = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return { next, jit: (b, a) => b + (next() * 2 - 1) * a, chance: (p) => next() < p };
}

function zoneKmFromMinutes(zMin: Record<number, number>, repPace: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [z, min] of Object.entries(zMin)) out[+z] = round2((min * 60) / repPace[+z - 1]);
  return out;
}
function addRaceSplits(totalS: number, kmCount: number, hrStart: number): string {
  return JSON.stringify(Array.from({ length: Math.min(kmCount, 60) }, (_, i) => {
    const drift = i < 2 ? 2 : i > kmCount - 3 ? -2 : 0;
    return { km: i + 1, time_s: Math.round(totalS / kmCount + drift), avg_hr: hrStart + Math.min(8, Math.floor(i / 2)) };
  }));
}

// ---- Marker / Bestand ----
export const BETA_ID_RANGE = { min: 101, max: 108 };
function markedBetaIds(): number[] {
  const raw = getSetting<number[]>(BETA_IDS_KEY, []);
  return Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isFinite(n)) : [];
}
function setMarkedBetaIds(ids: number[]): void { setSetting(BETA_IDS_KEY, [...new Set(ids)]); }

const BETA_TABLES = [
  "activities", "planned_sessions", "season_weeks_v2", "daily_log_v2", "races", "lactate_tests", "vo2max_lab",
  "zone_sets", "week_log_v2", "method_experiments", "session_feedback_v2", "cycle_period_log_v2",
  "cycle_symptoms_v2", "cycle_stimulus_evidence_v2", "cycle_stability_v2", "cycle_training_settings",
  "ml_runs", "ml_latent_fitness", "ml_channel_effects", "ml_readiness", "ml_health_flags", "ml_verdict_cache",
];

/** Löscht ALLE Beta-Personas (nur markierte IDs im Beta-Bereich). Rührt echte Profile nie an. */
export function deleteBetaPersonas(): void {
  const ids = markedBetaIds().filter((id) => id >= BETA_ID_RANGE.min && id <= BETA_ID_RANGE.max);
  const active = Number(getSetting<string | number>("active_profile", 1));
  db.exec("BEGIN");
  try {
    for (const id of ids) {
      for (const t of BETA_TABLES) {
        try { db.prepare(`DELETE FROM ${t} WHERE profile_id=?`).run(id); } catch { /* Tabelle evtl. nicht da */ }
      }
      for (const key of [`availability_${id}`, `athlete:${id}`, `thresholds:${id}`, `phase_dist_overrides:${id}`,
        `cycle_consent:${id}`, `cycle_contraception:${id}`, `prospective_cooldown:${id}`]) {
        db.prepare("DELETE FROM settings WHERE key=?").run(key);
      }
      db.prepare("DELETE FROM settings WHERE key LIKE ?").run(`layout:%:${id}`);
      db.prepare("DELETE FROM profiles WHERE id=?").run(id);
    }
    setMarkedBetaIds([]);
    if (ids.includes(active)) setSetting("active_profile", 1);
    db.exec("COMMIT");
  } catch (e) { try { db.exec("ROLLBACK"); } catch { /* ignore */ } throw e; }
}

/** Guard: nur einen Beta-Slot belegen, wenn er frei ODER schon Beta ist — nie ein echtes Profil überschreiben. */
function assertIdFree(id: number): void {
  const row = db.prepare("SELECT id FROM profiles WHERE id=?").get(id) as { id: number } | undefined;
  if (row && !markedBetaIds().includes(id)) {
    throw new Error(`profile_id ${id} existiert bereits und ist KEIN Beta-Profil — Abbruch (Datenschutz).`);
  }
}

// ============================================================================
//  Engine: eine Persona seeden
// ============================================================================
function generatePersona(cfg: PersonaConfig, today: string): number {
  const rng = makeRng(cfg.seed);
  const nowIso = new Date().toISOString();
  const totalWeeks = cfg.pastWeeks + cfg.futureWeeks;
  const todayWeekIndex = cfg.pastWeeks - 1;
  const week0 = addDays(mondayOf(today), -7 * (cfg.pastWeeks - 1));
  const activities: ActivitySeed[] = [];

  assertIdFree(cfg.id);
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO profiles(id, name) VALUES(?,?)").run(cfg.id, cfg.name);
    const pid = cfg.id;

    setProfileSetting("athlete", {
      name: cfg.displayName, sex: cfg.sex, birth_year: cfg.birthYear,
      weight: cfg.weight, height: cfg.height, max_hr: cfg.maxHr, hr_rest: cfg.hrRest,
    }, pid);
    setProfileSetting("thresholds", { lthr: cfg.lthr, threshold_pace: cfg.thresholdPace, lt1_hr: cfg.lt1Hr, lt1_pace: cfg.lt1Pace }, pid);
    setSetting(`availability_${pid}`, cfg.availability);

    if (cfg.cycle !== "none") {
      setProfileSetting("cycle_consent", { consented: true, consentedAt: nowIso }, pid);
      setProfileSetting("cycle_contraception", cfg.contraception, pid);
    }

    const hrZones = DEFAULT_HR_ZONES.map((z, i) => ({
      ...z, min: cfg.hrBounds[i], max: i < 5 ? cfg.hrBounds[i + 1] - 1 : 999,
    }));
    const repPace = cfg.paceZones.map((p, i) => (i === 0 ? p + 20 : Math.round((cfg.paceZones[i - 1] + p) / 2)));
    db.prepare("INSERT INTO zone_sets(profile_id, valid_from, hr_zones, pace_zones, lthr, ftp, threshold_pace, lt1_hr, lt1_pace, source, note, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(pid, addDays(week0, -14), JSON.stringify(hrZones), JSON.stringify(cfg.paceZones), cfg.lthr, cfg.ftp, cfg.thresholdPace, cfg.lt1Hr, cfg.lt1Pace, "Beta", `Beta-Zonen ${cfg.displayName}.`, nowIso);

    if (cfg.cycle !== "none") {
      db.prepare(`INSERT INTO cycle_training_settings(profile_id, cycle_adaptive_enabled, method_emphasis, method_emphasis_weight, phase_stimulus_map, feedback_sensitivity, symptom_override_enabled, observation_mode_only, updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(pid, cfg.cycleAdaptive ? 1 : 0, "general", 0.5, null, 0.6, 1, cfg.cycleAdaptive ? 0 : 1, nowIso);
    }

    const periods = cfg.cycle !== "none" ? seedCycleData(cfg, pid, week0, today, nowIso, rng) : [];

    const insAct = db.prepare(`INSERT INTO activities(profile_id, date, sport, source, name, type, distance_m, moving_s, elapsed_s, avg_hr, max_hr, avg_power, elevation, avg_cadence, tss, zones, zone_min, zone_km, pace_zone_min, ngp, decoupling, eff_vo2max, run_np, power_curve, best_efforts, efforts, notes, match_ignore) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insWeek = db.prepare("INSERT INTO season_weeks_v2(profile_id, week_no, label, phase, start_date, end_date, target_km, goal_race, notes) VALUES(?,?,?,?,?,?,?,?,?)");
    const insPlan = db.prepare("INSERT INTO planned_sessions(profile_id, date, week_no, sport, type, planned_km, planned_min, zone_alloc, description, efforts, planned_tss, sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
    const insLog = db.prepare("INSERT INTO daily_log_v2(profile_id, date, weight, resting_hr, hrv, recovery, strain, sleep_h, soreness, motivation, rpe, sick, travel, pain, pain_location, notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const insWeekLog = db.prepare("INSERT INTO week_log_v2(profile_id, week_no, run_km, week_tss, checks) VALUES(?,?,?,?,?)");

    for (let w = 0; w < totalWeeks; w++) {
      const start = addDays(week0, w * 7);
      const end = addDays(start, 6);
      const active = w >= cfg.activeFromWeek;
      const phase = cfg.phaseOf(w, { todayWeekIndex, pastWeeks: cfg.pastWeeks });
      const deload = !cfg.overreach && w % 4 === 3 && phase !== "Taper" && phase !== "Recovery";
      const progress = clamp((w - cfg.activeFromWeek) / Math.max(1, cfg.pastWeeks - 1 - cfg.activeFromWeek), 0, 1);
      const thresholdPace = cfg.thresholdPaceArc(progress, w);
      const effBase = cfg.effVo2Arc(progress, w);
      const targetKm = active ? cfg.targetKm(phase, progress, deload, w) : 0;
      insWeek.run(pid, w + 1, `${cfg.displayName.split(" ")[0]} W${w + 1}`, phase, start, end, targetKm,
        w === totalWeeks - 1 ? cfg.races.find((r) => r.timeS == null)?.name ?? "" : "", phaseLabel(phase));

      const keys = active ? cfg.weekTemplate(phase, w, deload) : {};
      let weekKm = 0, weekTss = 0;
      for (let d = 0; d < 7; d++) {
        const date = addDays(start, d);
        const disturb = disturbanceFor(date, cfg.disturbances);
        const recentLow = date >= addDays(today, -5) && date <= today;
        if (date <= today && active) {
          const wl = cfg.wellness(date, progress, disturb, recentLow, rng);
          insLog.run(pid, date, wl.weight, wl.rhr, wl.hrv, wl.recovery, wl.strain, wl.sleep, wl.soreness, wl.motivation, wl.rpe, wl.sick, wl.travel, wl.pain, wl.painLoc, wl.notes);
        }
        const k = keys[d];
        if (!k) continue;
        if (disturb === "illness" && date >= (cfg.disturbances.illnessStart ?? "9999") && date <= addDays(cfg.disturbances.illnessStart ?? "9999", 4)) continue;
        const s = SESS[k];
        const isPast = date < today;
        const isRecentPlan = date >= addDays(today, -56);
        const durationScale = deload ? 0.82 : phase === "Taper" ? 0.7 : phase === "Recovery" ? 0.7 : 1;
        const introTrim = phase === "Base" ? 0.8 + 0.18 * progress : 1;
        const dur = Math.max(20, Math.round(rng.jit((s.durMin + s.durMax) / 2, (s.durMax - s.durMin) / 2) * durationScale * introTrim *
          (disturb === "travel" ? 0.78 : disturb === "niggle" && s.family !== "easy" ? 0.72 : 1)));
        const ifv = clamp(rng.jit(s.if, 0.02) * (disturb === "niggle" && (s.family === "threshold" || s.family === "vo2") ? 0.9 : 1), 0.55, 1.04);
        const movingS = dur * 60;
        const zoneMin: Record<number, number> = {};
        for (const [z, frac] of Object.entries(s.z)) zoneMin[+z] = round1(dur * frac);
        const zoneKm = zoneKmFromMinutes(zoneMin, repPace);
        const workPace = Math.round(thresholdPace + (s.workOffset ?? 0));

        let distM = 0, avgPace = 0, avgPower: number | null = null, tss = 0, ngp: number | null = null, runNp: number | null = null;
        let elevation = Math.round(rng.jit(s.family === "long" ? 160 : 55, 40));
        const overreachDrift = cfg.overreach ? 1 + 0.12 * progress : 1; // steigendes Decoupling/Ermüdung
        if (s.sport === "Bike") {
          avgPower = Math.round(rng.jit(cfg.ftp * ifv, 12));
          distM = Math.round((movingS / 3600) * rng.jit(30, 3) * 1000);
          tss = round1((movingS / 3600) * ifv * ifv * 100);
        } else if (s.sport === "Strength") {
          tss = round1(dur * 0.6);
          distM = 0;
        } else {
          avgPace = Math.round(thresholdPace / ifv);
          ngp = Math.round(avgPace * (s.family === "long" ? 0.99 : 1)); // NGP ~ pace (Elevation-neutral vereinfacht)
          distM = Math.round((movingS / avgPace) * 1000);
          runNp = Math.round(rng.jit(cfg.weight * 3.45 * ifv + 28, 5));
          tss = round1((movingS / 3600) * ifv * ifv * 100);
        }
        const avgHr = clamp(Math.round(rng.jit(s.hr * overreachDrift, 3) - (deload ? 1 : 0)), 100, cfg.maxHr - 2);
        const maxHr = clamp(avgHr + Math.round(rng.jit(s.family === "vo2" ? 15 : s.family === "threshold" ? 11 : 8, 3)), avgHr + 4, cfg.maxHr);
        const bests = s.eff && s.sport === "Run" ? JSON.stringify({
          1000: Math.round(workPace * (k === "reps" ? 0.96 : 1.02)),
          3000: Math.round(workPace * 3 * 1.01),
          5000: Math.round((thresholdPace - 5) * 5 * 1.015),
          10000: Math.round((thresholdPace + 6) * 10),
        }) : null;
        const decoup = (s.family === "long" || s.family === "easy") && s.sport === "Run"
          ? round1(rng.jit((s.family === "long" ? 5.2 : 3.0) * overreachDrift - (cfg.overreach ? 0 : 1.4 * progress), 0.9)) : null;
        const effV = s.eff && s.sport === "Run" && (s.family === "easy" || s.family === "long" || s.family === "threshold") && dur >= 40
          ? round1(rng.jit(effBase, 1.0)) : null;
        const powerCurve = s.eff && s.sport === "Run" && runNp ? JSON.stringify({ 300: runNp + 22, 600: runNp + 10, 1200: runNp + 3, 1800: runNp - 2, 3600: runNp - 12 }) : null;
        const efforts = (s.family === "threshold" || s.family === "vo2") && s.sport === "Run"
          ? JSON.stringify([{ reps: k === "vo2" ? 5 : k === "reps" ? 8 : k === "marathon" ? 3 : 4, sec: k === "vo2" ? 180 : k === "reps" ? 60 : k === "marathon" ? 900 : 480, dist_m: null, zone: k === "vo2" || k === "reps" ? 5 : k === "marathon" ? 3 : 4, pace_s: workPace, rest_s: k === "reps" ? 75 : 120, rest_type: "jog", label: s.type }]) : null;
        const desc = k === "threshold" ? `${dur}' inkl. 4x8' @ ${paceStr(workPace)}/km`
          : k === "marathon" ? `${dur}' inkl. 3x15' @ ${paceStr(workPace)}/km`
          : k === "lt1" ? `${dur}' Steady @ ${paceStr(workPace)}/km`
          : k === "vo2" ? `${dur}' inkl. 5x3' @ ${paceStr(workPace)}/km`
          : k === "reps" ? `${dur}' inkl. 8x1' zügig`
          : k === "hill" ? `${dur}' inkl. 10x15s Bergsprints`
          : k === "long" || k === "ultralong" ? `${dur}' ${s.label} ruhig`
          : s.sport === "Bike" ? `${dur}' ${s.label}`
          : `${dur}' ${s.label}`;
        const note = disturb === "travel" ? "Beta-Confounder: Reisewoche."
          : disturb === "niggle" ? "Beta-Confounder: leichter Niggle." : null;

        if (isPast) {
          const info = insAct.run(pid, date, s.sport, "beta", `${s.label} (${cfg.displayName})`, s.type, distM, movingS, movingS + Math.round(rng.jit(90, 50)),
            avgHr, maxHr, avgPower, elevation, s.sport === "Run" ? Math.round(rng.jit(174, 6)) : null, tss, null, JSON.stringify(zoneMin),
            JSON.stringify(zoneKm), s.sport === "Run" ? JSON.stringify(zoneMin) : null, ngp, decoup, effV, runNp, powerCurve, bests, efforts, note, 0);
          activities.push({ id: Number(info.lastInsertRowid), date, key: k, phase, disturbance: disturb, family: s.family });
          weekKm += distM / 1000; weekTss += tss;
        }
        if ((!isPast || isRecentPlan) && s.sport === "Run") {
          insPlan.run(pid, date, w + 1, "Run", s.type, round1(distM / 1000), dur, JSON.stringify({ byMin: zoneMin, byKm: zoneKm }), desc, efforts, tss, d);
        }
      }
      if (end < today && active) {
        insWeekLog.run(pid, w + 1, round1(weekKm), Math.round(weekTss), JSON.stringify({
          mileage: weekKm >= targetKm * 0.82, longrun: weekKm > 0, plyo: w % 2 === 0, physio: w % 3 !== 0,
          note: disturbanceFor(start, cfg.disturbances),
        }));
      }
    }

    seedRacesAndLabs(cfg, pid, today, nowIso);
    if (cfg.cycle !== "none") seedFeedback(cfg, pid, activities, periods, nowIso, rng);
    else seedFeedbackNoCycle(cfg, pid, activities, nowIso, rng);

    db.exec("COMMIT");
    return pid;
  } catch (e) { try { db.exec("ROLLBACK"); } catch { /* ignore */ } throw e; }
}

function phaseLabel(p: Phase): string {
  return p === "Base" ? "Aerobe Basis, ruhige Longruns."
    : p === "Build" ? "Aufbau: Longruns wachsen, Schwellenarbeit."
    : p === "Specific" ? "Spezifischer Block mit Race-Pace-Anteilen."
    : p === "Taper" ? "Taper: Last runter, Schärfe erhalten."
    : p === "Peak" ? "Formaufbau zum Renntag."
    : "Regeneration nach dem Rennen.";
}
function disturbanceFor(date: string, a: { illnessStart?: string; travelStart?: string; niggleStart?: string }): Disturbance {
  if (a.illnessStart && date >= a.illnessStart && date <= addDays(a.illnessStart, 5)) return "illness";
  if (a.travelStart && date >= a.travelStart && date <= addDays(a.travelStart, 9)) return "travel";
  if (a.niggleStart && date >= a.niggleStart && date <= addDays(a.niggleStart, 14)) return "niggle";
  return null;
}

// ---- Races/Labs ----
function seedRacesAndLabs(cfg: PersonaConfig, pid: number, today: string, nowIso: string): void {
  const insRace = db.prepare("INSERT INTO races(profile_id, date, name, distance_m, time_s, placement, notes, splits, avg_hr, max_hr, elevation_m, source, goal_time_s, is_tuneup) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const r of cfg.races) {
    const km = Math.max(1, Math.round(r.distM / 1000));
    const splits = r.timeS != null ? addRaceSplits(r.timeS, km, cfg.lthr - 4) : "[]";
    insRace.run(pid, addDays(today, r.dayOffset), r.name, r.distM, r.timeS, r.placement, r.notes, splits,
      r.timeS != null ? cfg.lthr : null, r.timeS != null ? cfg.maxHr - 4 : null, r.elevM ?? Math.round(r.distM / 1000 * 8),
      "manual", r.goalS ?? null, r.tuneup ? 1 : 0);
  }
  const insLac = db.prepare("INSERT INTO lactate_tests(profile_id, date, sport, kind, notes, lt1_hr, lt1_pace, lt2_hr, lt2_pace, confidence, warnings, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const l of cfg.labs) insLac.run(pid, addDays(today, l.dayOffset), "Run", "Labortest", l.notes, l.lt1Hr, l.lt1Pace, l.lt2Hr, l.lt2Pace, l.confidence, "[]", nowIso);
  const insVo2 = db.prepare("INSERT INTO vo2max_lab(profile_id, date, value, source, notes, created_at) VALUES(?,?,?,?,?,?)");
  for (const v of cfg.vo2labs) insVo2.run(pid, addDays(today, v.dayOffset), v.value, "Lab", v.notes, nowIso);
}

// ---- Feedback ----
function feedbackPattern(family: Family, phase: string | null, disturb: Disturbance, overreach: boolean): number {
  let v = family === "easy" ? 0.1 : family === "long" ? 0.0 : family === "bike" ? 0.05 : family === "strength" ? 0.05 : family === "threshold" ? -0.05 : -0.12;
  if (phase === "follicular" && (family === "threshold" || family === "vo2")) v += 0.35;
  if (phase === "ovulation" && (family === "threshold" || family === "vo2")) v += 0.25;
  if (phase === "early_luteal" && family === "long") v += 0.14;
  if (phase === "late_luteal" && (family === "threshold" || family === "vo2")) v -= 0.42;
  if (phase === "menstrual" && (family === "threshold" || family === "vo2")) v -= 0.32;
  if (disturb === "illness") v -= 1.2;
  if (disturb === "travel") v -= 0.45;
  if (disturb === "niggle") v -= 0.35;
  if (overreach) v -= 0.5; // chronische Überlast: Einheiten fühlen sich zunehmend schlechter an
  return v;
}
function insertFeedback(pid: number, a: ActivitySeed, ctx: { cycle_phase: string | null; cycle_day: number | null }, cfg: PersonaConfig, rng: Rng, nowIso: string, ins: ReturnType<typeof db.prepare>): void {
  const raw = feedbackPattern(a.family, ctx.cycle_phase, a.disturbance, !!cfg.overreach) + rng.jit(0, 0.42);
  const felt = clamp(Math.round(raw), -2, 2);
  const rpeBase = a.family === "easy" ? 3.3 : a.family === "long" ? 5.2 : a.family === "bike" ? 4.5 : a.family === "strength" ? 4 : a.family === "threshold" ? 7.0 : 7.8;
  const rpe = clamp(Math.round(rpeBase - raw * 0.55 + rng.jit(0, 0.7) + (cfg.overreach ? 1 : 0)), 1, 10);
  const stress = clamp(Math.round(rng.jit(a.disturbance ? 5.2 : cfg.overreach ? 4.5 : 2.6, 1.0)), 1, 7);
  const notes = a.disturbance === "illness" ? "Erkältung als Confounder markiert." : a.disturbance === "travel" ? "Reisewoche." : a.disturbance === "niggle" ? "Leichter Niggle, konservativ." : null;
  ins.run(pid, a.id, a.date, a.family, rpe, felt, stress, notes, ctx.cycle_phase, ctx.cycle_day, a.disturbance, nowIso);
}
function seedFeedbackNoCycle(cfg: PersonaConfig, pid: number, activities: ActivitySeed[], nowIso: string, rng: Rng): void {
  const ins = db.prepare("INSERT INTO session_feedback_v2(profile_id, activity_id, date, session_family, rpe, felt_vs_expected, life_stress, notes, cycle_phase, cycle_day, confounder_flag, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const a of activities) {
    const isKey = a.family === "threshold" || a.family === "vo2" || a.family === "long";
    if (isKey ? !rng.chance(cfg.feedbackKeyChance) : !rng.chance(cfg.feedbackEasyChance)) continue;
    insertFeedback(pid, a, { cycle_phase: null, cycle_day: null }, cfg, rng, nowIso, ins);
  }
}
function seedFeedback(cfg: PersonaConfig, pid: number, activities: ActivitySeed[], periods: Period[], nowIso: string, rng: Rng): void {
  const ins = db.prepare("INSERT INTO session_feedback_v2(profile_id, activity_id, date, session_family, rpe, felt_vs_expected, life_stress, notes, cycle_phase, cycle_day, confounder_flag, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const a of activities) {
    const isKey = a.family === "threshold" || a.family === "vo2" || a.family === "long";
    if (isKey ? !rng.chance(cfg.feedbackKeyChance) : !rng.chance(cfg.feedbackEasyChance)) continue;
    const ctx = buildFeedbackContext(periods, cfg.contraception, a.date);
    insertFeedback(pid, a, ctx, cfg, rng, nowIso, ins);
  }
  seedCycleEvidence(pid, periods, nowIso);
}
function seedCycleEvidence(pid: number, periods: Period[], nowIso: string): void {
  const starts = periods.map((x) => x.start_date).sort();
  const rows = db.prepare("SELECT date, session_family, cycle_phase, felt_vs_expected, rpe, confounder_flag FROM session_feedback_v2 WHERE profile_id=? AND cycle_phase IS NOT NULL")
    .all(pid) as unknown as (Parameters<typeof evaluatePhaseStimulus>[0][number] & { date: string })[];
  const feedback = rows.map((r) => ({ ...r, cycle_index: cycleIndexOf(r.date, starts) }));
  const { evidence } = evaluatePhaseStimulus(feedback);
  const ins = db.prepare("INSERT INTO cycle_stimulus_evidence_v2(profile_id, phase, stimulus, n_sessions, mean_quality, effect_size, ci_low, ci_high, confidence, prior_weight, posterior_weight, last_updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
  db.prepare("DELETE FROM cycle_stimulus_evidence_v2 WHERE profile_id=?").run(pid);
  for (const e of evidence) ins.run(pid, e.phase, e.stimulus, e.n_sessions, e.mean_quality, e.effect_size, e.ci_low, e.ci_high, e.confidence, e.prior_weight, e.posterior_weight, nowIso);
}

// ---- Zyklus-Daten ----
function seedCycleData(cfg: PersonaConfig, pid: number, week0: string, today: string, nowIso: string, rng: Rng): Period[] {
  const starts: string[] = [];
  if (cfg.cycle === "regular") {
    let cur = addDays(today, -17); // heute ~ Zyklustag 18
    const lens = [28, 29, 28, 29, 28, 29, 28, 30];
    for (let i = 0; cur >= addDays(week0, -35) && i < 26; i++) { starts.push(cur); cur = addDays(cur, -lens[i % lens.length]); }
  } else {
    // irregular: nur die letzten ~10 Monate natürlich (davor hormonell → keine Logs), stark schwankende Längen + Lücke.
    let cur = addDays(today, -52); // eine „überfällige“ Lücke (>45 d, aber <90 → keine Amenorrhoe-Flag)
    const lens = [24, 41, 33, 26, 44, 30, 22, 47]; // hohe SD → regularity 'irregular'
    for (let i = 0; cur >= addDays(today, -300) && i < 10; i++) { starts.push(cur); cur = addDays(cur, -lens[i % lens.length]); }
  }
  const periods = starts.reverse().map((start) => ({ start_date: start, end_date: addDays(start, 4) }));
  const insP = db.prepare("INSERT INTO cycle_period_log_v2(profile_id, start_date, end_date, notes, created_at) VALUES(?,?,?,?,?)");
  const note = cfg.cycle === "regular" ? "Beta: stabiler natürlicher Zyklus." : "Beta: unregelmäßiger Zyklus (nach Absetzen hormoneller Verhütung).";
  for (const p of periods) insP.run(pid, p.start_date, p.end_date, note, nowIso);

  const insS = db.prepare("INSERT INTO cycle_symptoms_v2(profile_id, date, cramps, energy, sleep, mood, flow, notes, created_at) VALUES(?,?,?,?,?,?,?,?,?)");
  const symStart = addDays(today, cfg.cycle === "regular" ? -160 : -120);
  for (let dd = 0; addDays(week0, dd) <= today; dd++) {
    const date = addDays(week0, dd);
    if (date < symStart) continue;
    if ((date.charCodeAt(8) + date.charCodeAt(9)) % 12 === 0) continue;
    const ctx = buildFeedbackContext(periods, cfg.contraception, date);
    const s = cycleSymptom(ctx.cycle_phase, ctx.cycle_day ?? 0, rng);
    insS.run(pid, date, s.cramps, s.energy, s.sleep, s.mood, s.flow, s.note, nowIso);
  }
  const stab = evaluateCycleStability(periods, today);
  db.prepare("INSERT OR REPLACE INTO cycle_stability_v2(profile_id, n_cycles, median_length, length_sd, regularity, gate_passed, last_evaluated) VALUES(?,?,?,?,?,?,?)")
    .run(pid, stab.nCycles, stab.medianLength, stab.lengthSd, stab.regularity, stab.regularity === "stable" ? 1 : 0, nowIso);
  return periods;
}
function cycleSymptom(phase: string | null, cd: number, rng: Rng): { cramps: number | null; energy: number; sleep: number; mood: number; flow: number | null; note: string } {
  const c = (v: number) => clamp(Math.round(v), 1, 5);
  const j = () => (rng.next() < 0.5 ? -1 : rng.next() < 0.5 ? 0 : 1);
  switch (phase) {
    case "menstrual": return { cramps: c(6 - cd + j()), energy: c(1.8 + cd * 0.4 + j()), sleep: c(2.8 + cd * 0.2), mood: c(2.4 + cd * 0.3 + j()), flow: c(6 - cd), note: "Menstruation." };
    case "follicular": return { cramps: c(1 + Math.max(0, j())), energy: c(4 + j()), sleep: c(4), mood: c(4 + j()), flow: null, note: "Follikelphase – hohe Energie." };
    case "ovulation": return { cramps: c(1.4), energy: c(5), sleep: c(4), mood: c(5), flow: null, note: "Ovulation – Leistungshoch." };
    case "early_luteal": return { cramps: c(1), energy: c(3.6 + j()), sleep: c(3.4), mood: c(3.6), flow: null, note: "Frühe Lutealphase." };
    case "late_luteal": { const k = clamp((cd - 21) / 7, 0, 1); return { cramps: c(1 + k * 2), energy: c(3.4 - k * 1.4), sleep: c(3.4 - k * 1.2), mood: c(3.4 - k * 1.5), flow: null, note: "Späte Lutealphase/PMS." }; }
    default: return { cramps: c(1), energy: c(3), sleep: c(3), mood: c(3), flow: null, note: "Zwischenphase." };
  }
}

// ============================================================================
//  Wellness-Generatoren (per Persona wiederverwendet)
// ============================================================================
function healthyWellness(weight: number): PersonaConfig["wellness"] {
  return (_date, _progress, disturb, recentLow, rng) => {
    const sick = disturb === "illness" ? 1 : 0, travel = disturb === "travel" ? 1 : 0;
    const pain = disturb === "niggle" ? clamp(Math.round(rng.jit(3, 1)), 1, 5) : clamp(Math.round(rng.jit(0.5, 0.8)), 0, 2);
    return {
      weight: round1(rng.jit(weight, 0.4)), rhr: Math.round(rng.jit(recentLow ? 49 : sick ? 53 : 45, 2.2)),
      hrv: Math.round(rng.jit(recentLow ? 55 : sick ? 50 : 62, 5)), recovery: clamp(Math.round(rng.jit(sick ? 42 : 72, 12)), 20, 95),
      strain: round1(rng.jit(6, 1.6)), sleep: round1(rng.jit(disturb ? 6.4 : 7.4, 0.6)),
      soreness: clamp(Math.round(rng.jit(disturb === "niggle" ? 5 : 2, 1.2)), 0, 8), motivation: clamp(Math.round(rng.jit(7.5, 1.5)), 1, 10),
      rpe: clamp(Math.round(rng.jit(5, 1.5)), 1, 10), sick, travel, pain,
      painLoc: disturb === "niggle" ? "Wade/Achilles" : null,
      notes: disturb === "illness" ? "Erkältung, Last reduziert." : disturb === "travel" ? "Reisewoche." : null,
    };
  };
}
function overreachWellness(weight: number): PersonaConfig["wellness"] {
  // Chronische Überlast: RHR driftet hoch, HRV/Recovery/Motivation sinken über die Zeit — RED-S/Übertrainings-Signatur.
  return (_date, progress, disturb, _recentLow, rng) => {
    const sick = disturb === "illness" ? 1 : 0, travel = disturb === "travel" ? 1 : 0;
    return {
      weight: round1(rng.jit(weight - progress * 1.5, 0.4)), // leichter Gewichtsverlust (Energiemangel)
      rhr: Math.round(rng.jit(46 + progress * 9, 2)), hrv: Math.round(rng.jit(60 - progress * 16, 4)),
      recovery: clamp(Math.round(rng.jit(70 - progress * 30, 10)), 12, 90), strain: round1(rng.jit(8 + progress * 2, 1.4)),
      sleep: round1(rng.jit(7.3 - progress * 1.0, 0.6)), soreness: clamp(Math.round(rng.jit(3 + progress * 3, 1.2)), 0, 9),
      motivation: clamp(Math.round(rng.jit(8 - progress * 3.5, 1.2)), 1, 10), rpe: clamp(Math.round(rng.jit(6 + progress * 2, 1.2)), 1, 10),
      sick, travel, pain: clamp(Math.round(rng.jit(1 + progress * 2, 1)), 0, 6),
      painLoc: progress > 0.6 ? "Achillessehne" : null,
      notes: progress > 0.7 ? "Anhaltende Müdigkeit, Beine schwer." : null,
    };
  };
}

export { generatePersona }; // (für Runner-Tests einzeln aufrufbar)

// ============================================================================
//  Persona-Configs
// ============================================================================
// gemeinsame Standard-Verfügbarkeit
const avail = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  minutesByWeekday: [60, 75, 55, 80, 45, 0, 140], longRunDay: 6, hardDays: [1, 3], hillDay: 4,
  allowDoubles: false, corePerWeek: 2, coreDays: [0, 4], emphasis: "Allgemein", ...over,
});

// Standard-Wochentemplate für periodisierte Läufer:innen
function stdTemplate(phase: Phase, w: number, deload: boolean): Partial<Record<number, Key>> {
  if (phase === "Taper") return w % 2 === 0 ? { 0: "easy", 1: "threshold", 3: "marathon", 5: "recovery", 6: "long" } : { 0: "easy", 2: "reps", 4: "recovery", 6: "long" };
  if (phase === "Recovery") return { 0: "recovery", 2: "easy", 4: "recovery", 6: "easy" };
  if (deload) return { 0: "easy", 2: "threshold", 4: "recovery", 6: "long" };
  if (phase === "Specific" || phase === "Peak") return { 0: "easy", 1: "threshold", 2: "easy", 3: w % 3 === 0 ? "reps" : "marathon", 4: "recovery", 6: "long" };
  if (phase === "Build") return { 0: "easy", 1: "threshold", 2: "easy", 3: w % 3 === 1 ? "vo2" : "easy", 4: "recovery", 6: "long" };
  // Base
  return w % 2 === 0 ? { 0: "easy", 2: "lt1", 3: "easy", 4: "recovery", 6: "long" } : { 0: "easy", 1: "hill", 2: "easy", 4: "recovery", 6: "long" };
}

// zwei saubere Makrozyklen (A-Rennen bei todayWeekIndex und in der Vergangenheit)
function macroPhase(w: number, c: { todayWeekIndex: number; pastWeeks: number }): Phase {
  const t = c.todayWeekIndex;
  if (w >= t + 4) return "Taper";
  if (w >= t - 8) return "Specific";
  if (w >= t - 24) return "Build";
  if (w >= t - 30) return "Recovery"; // nach dem ersten A-Rennen (~Woche t-30)
  if (w >= t - 38) return "Specific";
  if (w >= t - 54) return "Build";
  return "Base";
}

function stdPaceArc(start: number, end: number): PersonaConfig["thresholdPaceArc"] {
  return (progress, w) => Math.round(lerp(start, end, progress) + Math.sin(w / 9) * 1.2);
}
function stdVo2Arc(start: number, end: number): PersonaConfig["effVo2Arc"] {
  return (progress, w) => round1(lerp(start, end, progress) + Math.sin(w / 9) * 0.35);
}

const CLARA: PersonaConfig = {
  id: 101, name: "Beta: Clara", displayName: "Clara Beta", sex: "f", birthYear: 1993,
  weight: 58, height: 168, maxHr: 190, hrRest: 44,
  lthr: 168, thresholdPace: 244, lt1Hr: 150, lt1Pace: 292, ftp: 210,
  paceZones: [390, 330, 292, 244, 222, 190], hrBounds: [0, 128, 146, 158, 168, 180],
  pastWeeks: 96, futureWeeks: 6, activeFromWeek: 0, emphasis: "HM/Marathon: Aerob + Schwelle",
  availability: avail({ emphasis: "HM/Marathon: Aerob + Schwelle" }),
  targetKm: (phase, progress, deload) => Math.round(clamp((45 + 33 * progress + (phase === "Base" ? -3 : phase === "Build" ? 0 : phase === "Specific" ? 4 : phase === "Taper" ? -22 : phase === "Recovery" ? -25 : 0)) * (deload ? 0.76 : 1), 24, 85)),
  thresholdPaceArc: stdPaceArc(262, 240), effVo2Arc: stdVo2Arc(48.5, 54),
  phaseOf: macroPhase, weekTemplate: stdTemplate, wellness: healthyWellness(58),
  disturbances: { illnessStart: addDaysStatic(-300), niggleStart: addDaysStatic(-140) },
  cycle: "none", contraception: { method: "none" },
  races: [
    { dayOffset: -560, name: "10 km Frühform", distM: 10000, timeS: 43 * 60 + 20, placement: "AK3", notes: "Ausgangsniveau.", tuneup: true },
    { dayOffset: -370, name: "Halbmarathon Frühjahr", distM: 21097.5, timeS: 92 * 60, placement: "PB", notes: "Erstes A-Rennen, sauberer Aufbau." },
    { dayOffset: -210, name: "10 km Bahn", distM: 10000, timeS: 41 * 60 + 10, placement: "AK1", notes: "Zwischenschärfe.", tuneup: true },
    { dayOffset: -30, name: "Marathon Herbst", distM: 42195, timeS: 3 * 3600 + 12 * 60, placement: "PB", notes: "Zweites A-Rennen, Peak getroffen." },
    { dayOffset: 42, name: "Ziel-Halbmarathon", distM: 21097.5, timeS: null, placement: "", notes: "Zielrennen, Wunsch 1:26.", goalS: 86 * 60 },
  ],
  labs: [
    { dayOffset: -540, notes: "Baseline.", lt1Hr: 146, lt1Pace: 306, lt2Hr: 166, lt2Pace: 258, confidence: "mittel" },
    { dayOffset: -180, notes: "Nach 1. Makrozyklus, LT2 verbessert.", lt1Hr: 149, lt1Pace: 296, lt2Hr: 168, lt2Pace: 248, confidence: "hoch" },
    { dayOffset: -40, notes: "Peak-Diagnostik.", lt1Hr: 150, lt1Pace: 292, lt2Hr: 168, lt2Pace: 244, confidence: "hoch" },
  ],
  vo2labs: [{ dayOffset: -540, value: 49, notes: "Baseline." }, { dayOffset: -180, value: 52, notes: "Fortschritt." }, { dayOffset: -40, value: 54, notes: "Peak." }],
  feedbackKeyChance: 0.95, feedbackEasyChance: 0.6, seed: 10111213,
  note: "Lehrbuch-Periodisierung, Referenz. ML-Gate: trifft Research-Mode + Banister + Dose-Response.",
};

const PETRA: PersonaConfig = {
  id: 103, name: "Beta: Petra", displayName: "Petra Beta", sex: "f", birthYear: 1996,
  weight: 55, height: 165, maxHr: 194, hrRest: 46,
  lthr: 172, thresholdPace: 250, lt1Hr: 154, lt1Pace: 298, ftp: 205,
  paceZones: [396, 336, 298, 250, 228, 196], hrBounds: [0, 132, 150, 162, 172, 184],
  pastWeeks: 84, futureWeeks: 6, activeFromWeek: 0, emphasis: "Marathon (aggressiv)",
  availability: avail({ emphasis: "Marathon (aggressiv)", hardDays: [1, 3, 5] }),
  // steigendes Volumen ohne echten Deload, ACWR-Spikes
  targetKm: (_phase, progress, _deload, w) => Math.round(clamp(50 + 45 * progress + (w % 5 === 0 ? 14 : 0), 30, 120)),
  thresholdPaceArc: (progress, w) => Math.round(lerp(256, 250, progress) + Math.sin(w / 7) * 1.5), // kaum Fortschritt trotz Last
  effVo2Arc: (progress, w) => round1(lerp(50, 51.5, Math.min(progress, 0.5)) - Math.max(0, progress - 0.5) * 2 + Math.sin(w / 8) * 0.4), // Plateau, dann Abfall (Überreichweite)
  phaseOf: (w, c) => (w >= c.todayWeekIndex - 4 ? "Specific" : w >= c.todayWeekIndex - 20 ? "Build" : "Base"),
  weekTemplate: (phase, w, _deload) => phase === "Base"
    ? { 0: "easy", 1: "threshold", 2: "easy", 3: "vo2", 4: "easy", 5: "threshold", 6: "long" }
    : { 0: "easy", 1: "threshold", 2: "marathon", 3: "vo2", 4: "easy", 5: "reps", 6: "long" }, // 4-5 harte Tage/Woche
  wellness: overreachWellness(55), overreach: true,
  disturbances: { niggleStart: addDaysStatic(-40) },
  cycle: "none", contraception: { method: "none" },
  races: [
    { dayOffset: -300, name: "Halbmarathon", distM: 21097.5, timeS: 95 * 60, placement: "AK5", notes: "Guter Start ins Projekt." },
    { dayOffset: -120, name: "30 km Testlauf", distM: 30000, timeS: 2 * 3600 + 24 * 60, placement: "—", notes: "Schwerer Tag, Beine leer.", tuneup: true },
    { dayOffset: 28, name: "Ziel-Marathon", distM: 42195, timeS: null, placement: "", notes: "Wunsch 3:15 — Aufbau ohne Taper riskant.", goalS: 3 * 3600 + 15 * 60 },
  ],
  labs: [
    { dayOffset: -260, notes: "Baseline gut.", lt1Hr: 152, lt1Pace: 304, lt2Hr: 170, lt2Pace: 254, confidence: "mittel" },
    { dayOffset: -50, notes: "Stagnation trotz hoher Last — Warnsignal.", lt1Hr: 156, lt1Pace: 302, lt2Hr: 173, lt2Pace: 252, confidence: "mittel" },
  ],
  vo2labs: [{ dayOffset: -260, value: 50, notes: "Baseline." }, { dayOffset: -50, value: 49, notes: "Kein Fortschritt/leichter Rückgang." }],
  feedbackKeyChance: 0.9, feedbackEasyChance: 0.55, seed: 30313233,
  note: "Übertraining/Warnlogik. ML-Gate: trifft Research-Mode; Health-Flags sollen anspringen.",
};

const TOM: PersonaConfig = {
  id: 106, name: "Beta: Tom", displayName: "Tom Beta", sex: "m", birthYear: 1970,
  weight: 82, height: 180, maxHr: 168, hrRest: 58,
  lthr: 150, thresholdPace: 320, lt1Hr: 136, lt1Pace: 372, ftp: 180,
  paceZones: [468, 402, 360, 320, 296, 260], hrBounds: [0, 112, 128, 140, 150, 160],
  pastWeeks: 60, futureWeeks: 6, activeFromWeek: 24, emphasis: "Einstieg 10 km",
  availability: avail({ minutesByWeekday: [0, 40, 0, 45, 0, 0, 70], longRunDay: 6, hardDays: [3], corePerWeek: 1, coreDays: [1], emphasis: "Einstieg 10 km" }),
  targetKm: (_phase, progress, _deload) => Math.round(clamp(14 + 26 * progress, 8, 42)),
  thresholdPaceArc: stdPaceArc(345, 315), effVo2Arc: stdVo2Arc(35, 39),
  phaseOf: (w, c) => (w >= c.todayWeekIndex - 3 ? "Specific" : w >= c.todayWeekIndex - 16 ? "Build" : "Base"),
  weekTemplate: (phase, w, _deload) => phase === "Base"
    ? { 1: "easy", 3: "easy", 6: "long" }
    : { 1: "easy", 3: w % 2 === 0 ? "threshold" : "hill", 6: "long" },
  wellness: healthyWellness(82),
  disturbances: { illnessStart: addDaysStatic(-90) },
  cycle: "none", contraception: { method: "none" },
  races: [{ dayOffset: 44, name: "Erster 10-km-Volkslauf", distM: 10000, timeS: null, placement: "", notes: "Premiere. Ziel: durchkommen, ~55 min.", goalS: 55 * 60 }],
  labs: [], // keine Labortests → LT-Confidence bleibt niedrig (Cold-Start)
  vo2labs: [], // nur eff-VO2max aus Läufen
  feedbackKeyChance: 0.4, feedbackEasyChance: 0.2, seed: 60616263, // dünnes Feedback → verfehlt Research-Gate bewusst
  note: "Cold-Start/Master 55+. ML-Gate: verfehlt Research-Mode/Banister (Degradations-Test), Norm-Klassifikation aktiv.",
};

const ELITE: PersonaConfig = {
  id: 107, name: "Beta: Noah (Elite)", displayName: "Noah Beta", sex: "m", birthYear: 2001,
  weight: 62, height: 178, maxHr: 196, hrRest: 38,
  lthr: 176, thresholdPace: 186, lt1Hr: 160, lt1Pace: 214, ftp: 330,
  paceZones: [300, 250, 214, 186, 172, 156], hrBounds: [0, 138, 156, 168, 176, 188],
  pastWeeks: 96, futureWeeks: 6, activeFromWeek: 0, emphasis: "10 km/HM Elite (norwegisch)",
  availability: avail({ minutesByWeekday: [90, 110, 90, 110, 90, 60, 150], allowDoubles: true, hardDays: [1, 3], emphasis: "10 km/HM Elite (norwegisch)" }),
  targetKm: (phase, progress, deload) => Math.round(clamp((120 + 30 * progress + (phase === "Specific" ? 6 : phase === "Taper" ? -45 : 0)) * (deload ? 0.82 : 1), 70, 180)),
  thresholdPaceArc: stdPaceArc(196, 184), effVo2Arc: stdVo2Arc(68, 73),
  phaseOf: macroPhase,
  weekTemplate: (phase, w, deload) => {
    const base = stdTemplate(phase, w, deload);
    // norwegische Double-Threshold-Tage: zusätzliche Sub-Threshold-Reize
    if (phase !== "Taper" && phase !== "Recovery" && !deload) { base[2] = "threshold"; base[5] = "lt1"; }
    return base;
  },
  wellness: healthyWellness(62),
  disturbances: { travelStart: addDaysStatic(-200) },
  cycle: "none", contraception: { method: "none" },
  races: [
    { dayOffset: -520, name: "10 km Straße", distM: 10000, timeS: 29 * 60 + 40, placement: "2.", notes: "Saisonstart." },
    { dayOffset: -330, name: "Halbmarathon", distM: 21097.5, timeS: 64 * 60 + 30, placement: "1.", notes: "PB." },
    { dayOffset: -150, name: "10 km Bahn", distM: 10000, timeS: 28 * 60 + 55, placement: "1.", notes: "Formhoch." },
    { dayOffset: -25, name: "Halbmarathon", distM: 21097.5, timeS: 63 * 60 + 20, placement: "1.", notes: "PB, Peak getroffen." },
    { dayOffset: 42, name: "Ziel-10-km", distM: 10000, timeS: null, placement: "", notes: "Sub-28 Versuch.", goalS: 27 * 60 + 55 },
  ],
  labs: [
    { dayOffset: -500, notes: "Elite-Baseline.", lt1Hr: 158, lt1Pace: 220, lt2Hr: 174, lt2Pace: 190, confidence: "hoch" },
    { dayOffset: -160, notes: "LT2 auf Weltklasse-Niveau.", lt1Hr: 160, lt1Pace: 214, lt2Hr: 176, lt2Pace: 186, confidence: "hoch" },
  ],
  vo2labs: [{ dayOffset: -500, value: 70, notes: "Baseline." }, { dayOffset: -160, value: 73, notes: "Peak." }],
  feedbackKeyChance: 0.95, feedbackEasyChance: 0.7, seed: 70717273,
  note: "Elite/Hochlast. ML-Gate: trifft alle; Chart-Dichte + Forecast-Präzision im Fokus.",
};

const ULTRA: PersonaConfig = {
  id: 108, name: "Beta: Yara (Ultra)", displayName: "Yara Beta", sex: "f", birthYear: 1985,
  weight: 60, height: 170, maxHr: 184, hrRest: 48,
  lthr: 162, thresholdPace: 300, lt1Hr: 146, lt1Pace: 348, ftp: 200,
  paceZones: [480, 408, 348, 300, 276, 240], hrBounds: [0, 124, 142, 154, 162, 174],
  pastWeeks: 90, futureWeeks: 6, activeFromWeek: 0, emphasis: "Trail-Ultra (50k/100k)",
  availability: avail({ minutesByWeekday: [50, 70, 50, 70, 40, 120, 240], longRunDay: 6, hardDays: [3], hillDay: 1, emphasis: "Trail-Ultra (50k/100k)" }),
  targetKm: (phase, progress, deload) => Math.round(clamp((70 + 40 * progress + (phase === "Specific" ? 15 : phase === "Taper" ? -35 : 0)) * (deload ? 0.8 : 1), 45, 150)),
  thresholdPaceArc: stdPaceArc(312, 296), effVo2Arc: stdVo2Arc(50, 54),
  phaseOf: macroPhase,
  weekTemplate: (phase, w, deload) => {
    if (phase === "Taper") return { 0: "easy", 2: "lt1", 4: "recovery", 6: "long" };
    if (phase === "Recovery") return { 0: "recovery", 3: "easy", 6: "easy" };
    if (deload) return { 0: "easy", 2: "lt1", 4: "recovery", 6: "long" };
    // Ultra: viel lockeres Volumen, Hügel, sehr lange Longruns (teils Doppel-Longrun am Wochenende)
    return { 0: "easy", 1: "hill", 2: "lt1", 3: "easy", 4: "recovery", 5: "long", 6: "ultralong" };
  },
  wellness: healthyWellness(60),
  disturbances: { niggleStart: addDaysStatic(-160), travelStart: addDaysStatic(-60) },
  cycle: "none", contraception: { method: "none" },
  races: [
    { dayOffset: -400, name: "Trail-Marathon", distM: 44000, timeS: 4 * 3600 + 40 * 60, placement: "AK2", notes: "2200 hm.", elevM: 2200 },
    { dayOffset: -180, name: "50 km Ultra", distM: 50000, timeS: 5 * 3600 + 35 * 60, placement: "AK1", notes: "Solide, gutes Pacing.", elevM: 2600 },
    { dayOffset: 49, name: "100 km Ziel-Ultra", distM: 100000, timeS: null, placement: "", notes: "Saisonhöhepunkt, 4500 hm.", goalS: 13 * 3600, elevM: 4500 },
  ],
  labs: [{ dayOffset: -380, notes: "Fettstoffwechsel stark, LT1 tief.", lt1Hr: 144, lt1Pace: 352, lt2Hr: 160, lt2Pace: 304, confidence: "mittel" }],
  vo2labs: [{ dayOffset: -380, value: 51, notes: "Baseline." }, { dayOffset: -170, value: 53, notes: "Fortschritt." }],
  feedbackKeyChance: 0.85, feedbackEasyChance: 0.5, seed: 80818283,
  note: "Ultra/Trail. Prüft Elevation/NGP/Minetti + sehr lange Einheiten; erwartet Lücken (Höhe/Hitze/Vert).",
};

const MIRA: PersonaConfig = {
  id: 104, name: "Beta: Mira", displayName: "Mira Beta", sex: "f", birthYear: 1998,
  weight: 57, height: 166, maxHr: 191, hrRest: 45,
  lthr: 169, thresholdPace: 250, lt1Hr: 151, lt1Pace: 300, ftp: 205,
  paceZones: [402, 342, 300, 250, 228, 196], hrBounds: [0, 130, 148, 160, 169, 181],
  pastWeeks: 90, futureWeeks: 6, activeFromWeek: 0, emphasis: "HM: Aerob + Schwelle",
  availability: avail({ emphasis: "HM: Aerob + Schwelle" }),
  targetKm: (phase, progress, deload) => Math.round(clamp((44 + 30 * progress + (phase === "Base" ? -2 : phase === "Specific" ? 4 : phase === "Taper" ? -20 : 0)) * (deload ? 0.78 : 1), 26, 78)),
  thresholdPaceArc: stdPaceArc(264, 248), effVo2Arc: stdVo2Arc(48, 53),
  phaseOf: macroPhase, weekTemplate: stdTemplate, wellness: healthyWellness(57),
  disturbances: { niggleStart: addDaysStatic(-120) },
  cycle: "regular", contraception: { method: "none" }, cycleAdaptive: true,
  races: [
    { dayOffset: -330, name: "Halbmarathon", distM: 21097.5, timeS: 94 * 60, placement: "PB", notes: "Erster HM." },
    { dayOffset: -60, name: "10 km", distM: 10000, timeS: 42 * 60 + 30, placement: "AK2", notes: "Zwischenform.", tuneup: true },
    { dayOffset: 42, name: "Ziel-Halbmarathon", distM: 21097.5, timeS: null, placement: "", notes: "Wunsch 1:29.", goalS: 89 * 60 },
  ],
  labs: [{ dayOffset: -300, notes: "Baseline.", lt1Hr: 149, lt1Pace: 308, lt2Hr: 167, lt2Pace: 258, confidence: "mittel" }, { dayOffset: -60, notes: "Fortschritt.", lt1Hr: 151, lt1Pace: 300, lt2Hr: 169, lt2Pace: 250, confidence: "hoch" }],
  vo2labs: [{ dayOffset: -300, value: 48, notes: "Baseline." }, { dayOffset: -60, value: 52, notes: "Fortschritt." }],
  feedbackKeyChance: 0.95, feedbackEasyChance: 0.65, seed: 40414243,
  note: "Regelmäßiger Zyklus, cycle-adaptive AN. ML-Gate: Zyklus-Gate besteht, Phasen-Evidenz aktivierbar.",
};

const SINA: PersonaConfig = {
  id: 105, name: "Beta: Sina", displayName: "Sina Beta", sex: "f", birthYear: 1994,
  weight: 63, height: 172, maxHr: 189, hrRest: 47,
  lthr: 167, thresholdPace: 258, lt1Hr: 149, lt1Pace: 306, ftp: 200,
  paceZones: [408, 348, 306, 258, 234, 202], hrBounds: [0, 128, 146, 158, 167, 179],
  pastWeeks: 88, futureWeeks: 6, activeFromWeek: 0, emphasis: "HM: Aerob + Schwelle",
  availability: avail({ emphasis: "HM: Aerob + Schwelle" }),
  targetKm: (phase, progress, deload) => Math.round(clamp((42 + 28 * progress + (phase === "Specific" ? 4 : phase === "Taper" ? -18 : 0)) * (deload ? 0.78 : 1), 26, 74)),
  thresholdPaceArc: stdPaceArc(270, 256), effVo2Arc: stdVo2Arc(46, 50),
  phaseOf: macroPhase, weekTemplate: stdTemplate, wellness: healthyWellness(63),
  disturbances: { travelStart: addDaysStatic(-100) },
  cycle: "irregular", contraception: { method: "none" }, cycleAdaptive: true,
  races: [
    { dayOffset: -320, name: "Halbmarathon", distM: 21097.5, timeS: 98 * 60, placement: "AK6", notes: "Solide." },
    { dayOffset: 42, name: "Ziel-Halbmarathon", distM: 21097.5, timeS: null, placement: "", notes: "Wunsch 1:33.", goalS: 93 * 60 },
  ],
  labs: [{ dayOffset: -300, notes: "Baseline.", lt1Hr: 147, lt1Pace: 314, lt2Hr: 165, lt2Pace: 266, confidence: "mittel" }],
  vo2labs: [{ dayOffset: -300, value: 46, notes: "Baseline." }, { dayOffset: -70, value: 49, notes: "Fortschritt." }],
  feedbackKeyChance: 0.9, feedbackEasyChance: 0.6, seed: 50515253,
  note: "Unregelmäßiger Zyklus (nach hormoneller Verhütung). ML-Gate: Zyklus-Gate MUSS scheitern (insufficient/irregular), kein Schein-Bias.",
};

const JONAS: PersonaConfig = {
  id: 102, name: "Beta: Jonas", displayName: "Jonas Beta", sex: "m", birthYear: 1987,
  weight: 74, height: 182, maxHr: 186, hrRest: 50,
  lthr: 164, thresholdPace: 235, lt1Hr: 148, lt1Pace: 282, ftp: 260,
  paceZones: [378, 320, 282, 235, 214, 182], hrBounds: [0, 126, 144, 156, 164, 176],
  pastWeeks: 88, futureWeeks: 6, activeFromWeek: 0, emphasis: "HM + Rad (Multisport)",
  availability: avail({ emphasis: "HM + Rad (Multisport)", allowDoubles: true }),
  targetKm: (phase, progress, deload) => Math.round(clamp((40 + 24 * progress + (phase === "Specific" ? 3 : phase === "Taper" ? -16 : 0)) * (deload ? 0.8 : 1), 20, 70)),
  thresholdPaceArc: stdPaceArc(250, 233), effVo2Arc: stdVo2Arc(50, 53),
  phaseOf: (w, c) => (w >= c.todayWeekIndex + 4 ? "Taper" : w >= c.todayWeekIndex - 8 ? "Specific" : w >= c.todayWeekIndex - 26 ? "Build" : "Base"),
  weekTemplate: (phase, w, deload) => {
    // Multisport: manche Tage Rad statt Lauf; unregelmäßig
    if (deload) return { 1: "easy", 3: "bike_easy", 6: "long" };
    if (phase === "Taper") return { 1: "threshold", 4: "bike_easy", 6: "long" };
    return w % 2 === 0
      ? { 0: "bike_easy", 1: "threshold", 3: "easy", 4: "bike_hard", 6: "long" }
      : { 1: "easy", 2: "bike_hard", 3: "vo2", 5: "bike_easy", 6: "long" };
  },
  wellness: healthyWellness(74),
  disturbances: { illnessStart: addDaysStatic(-240), travelStart: addDaysStatic(-150), niggleStart: addDaysStatic(-60) },
  cycle: "none", contraception: { method: "none" },
  races: [
    { dayOffset: -260, name: "Halbmarathon", distM: 21097.5, timeS: 85 * 60, placement: "AK4", notes: "Trotz Chaos ordentlich." },
    { dayOffset: -80, name: "Radmarathon (RTF)", distM: 120000, timeS: 4 * 3600 + 5 * 60, placement: "—", notes: "Multisport-Beleg.", tuneup: true, elevM: 1400 },
    { dayOffset: 42, name: "Ziel-Halbmarathon", distM: 21097.5, timeS: null, placement: "", notes: "Wunsch 1:22.", goalS: 82 * 60 },
  ],
  labs: [{ dayOffset: -220, notes: "Baseline.", lt1Hr: 146, lt1Pace: 292, lt2Hr: 162, lt2Pace: 240, confidence: "mittel" }],
  vo2labs: [{ dayOffset: -220, value: 51, notes: "Baseline." }],
  feedbackKeyChance: 0.7, feedbackEasyChance: 0.35, seed: 20212223,
  note: "Chaos/Robustheit/Multisport. ML-Gate: Confounder-Flags (Krankheit/Reise), Fallback-Pfade, Idempotenz.",
};

export const BETA_PERSONAS: PersonaConfig[] = [CLARA, JONAS, PETRA, MIRA, SINA, TOM, ELITE, ULTRA];

// addDaysStatic: die Disturbance-Anker sind relativ zu "heute" — aber die Config wird zur Modulladezeit gebaut.
// Wir markieren sie als Offset-Tage und lösen sie erst in generatePersona gegen `today` auf.
function addDaysStatic(offset: number): string { return `@${offset}`; } // Platzhalter, in resolveAnchors ersetzt

function resolveAnchors(cfg: PersonaConfig, today: string): PersonaConfig {
  const fix = (v?: string) => (v && v.startsWith("@") ? addDays(today, Number(v.slice(1))) : v);
  return { ...cfg, disturbances: { illnessStart: fix(cfg.disturbances.illnessStart), travelStart: fix(cfg.disturbances.travelStart), niggleStart: fix(cfg.disturbances.niggleStart) } };
}

/** Seede alle acht Beta-Personas frisch (idempotent: löscht zuvor vorhandene Beta-Profile). */
export function seedAllBetaPersonas(today: string): { id: number; name: string }[] {
  deleteBetaPersonas();
  const out: { id: number; name: string }[] = [];
  const ids: number[] = [];
  for (const base of BETA_PERSONAS) {
    const cfg = resolveAnchors(base, today);
    generatePersona(cfg, today);
    ids.push(cfg.id);
    out.push({ id: cfg.id, name: cfg.name });
  }
  setMarkedBetaIds(ids);
  return out;
}
