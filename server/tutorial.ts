// Tutorial-Profil (v2.10.0): erzeugt ein vollständiges, realistisches Demo-Profil für Isabel,
// die fiktive Halbmarathonläuferin, die zugleich als Guide durch das interaktive Tutorial führt
// (ihre Daten SIND die Tutorial-Story). Strikt auf eigenem profile_id: echte Profile bleiben unberührt.
// Deterministisch (seeded RNG), idempotent, löschbar, mit 78 Wochen Historie + 6 Wochen Ziel-HM-Plan.
import { db, setSetting, getSetting, setProfileSetting, DEFAULT_HR_ZONES } from "./db.ts";
import {
  buildFeedbackContext,
  evaluateCycleStability,
  evaluatePhaseStimulus,
  cycleIndexOf,
  type ContraceptionStatus,
  type Period,
} from "./cycleTraining.ts";
import { createProspectiveTrial } from "./mlJobs.ts";

const TUT = "Tutorial: Isabel";
// Legacy-Namen früherer Tutorial-Generationen (Alex → Mara → Isabel): nur für die einmalige Migration.
const LEGACY_TUTS = ["Tutorial: Mara", "Tutorial"];
const TUTORIAL_NAMES = [TUT, ...LEGACY_TUTS];
const MASS = 61; // kg
const HEIGHT_CM = 168;
const DAY_MS = 86_400_000;

type ProfileRow = { id: number; name: string };

// N-1: Marker-Set als autoritative Demo-Erkennung. Damit kann ein echtes Nutzerprofil (auch wenn es zufällig
// „Tutorial" heißt) NIE als Demo gelöscht/regeneriert werden. Namensauflösung bleibt nur als einmaliger
// Legacy-Fallback für Installationen VOR Einführung des Markers (Migration Alt-„Tutorial"/Alex/Mara → Isabel).
const TUT_IDS_KEY = "tutorial_profile_ids";
function markedTutorialIds(): number[] {
  const raw = getSetting<number[]>(TUT_IDS_KEY, []);
  const ids = Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isFinite(n)) : [];
  if (!ids.length) return [];
  const ph = ids.map(() => "?").join(",");
  const existing = db.prepare(`SELECT id FROM profiles WHERE id IN (${ph})`).all(...ids) as { id: number }[];
  return existing.map((r) => r.id);
}
function addTutorialMarker(id: number): void {
  const ids = new Set(markedTutorialIds()); ids.add(id);
  setSetting(TUT_IDS_KEY, [...ids]);
}
function removeTutorialMarkers(ids: number[]): void {
  setSetting(TUT_IDS_KEY, markedTutorialIds().filter((x) => !ids.includes(x)));
}

export function tutorialProfileId(): number | null {
  const marked = markedTutorialIds();
  if (marked.length) {
    const ph = marked.map(() => "?").join(",");
    const isabel = db.prepare(`SELECT id FROM profiles WHERE name=? AND id IN (${ph}) LIMIT 1`).get(TUT, ...marked) as { id: number } | undefined;
    return isabel?.id ?? marked[0];
  }
  const primary = db.prepare("SELECT id FROM profiles WHERE name=? ORDER BY id LIMIT 1").get(TUT) as { id: number } | undefined;
  if (primary) return primary.id;
  for (const name of LEGACY_TUTS) {
    const legacy = db.prepare("SELECT id FROM profiles WHERE name=? ORDER BY id LIMIT 1").get(name) as { id: number } | undefined;
    if (legacy) return legacy.id;
  }
  return null;
}

function tutorialProfiles(): ProfileRow[] {
  const marked = markedTutorialIds();
  if (marked.length) {
    const ph = marked.map(() => "?").join(",");
    return db.prepare(`SELECT id, name FROM profiles WHERE id IN (${ph}) ORDER BY CASE WHEN name=? THEN 0 ELSE 1 END, id`)
      .all(...marked, TUT) as ProfileRow[];
  }
  // Legacy-Fallback (kein Marker vorhanden): einmalige Namensauflösung für die Migration.
  const ph = TUTORIAL_NAMES.map(() => "?").join(",");
  return db.prepare(`SELECT id, name FROM profiles WHERE name IN (${ph}) ORDER BY CASE WHEN name=? THEN 0 ELSE 1 END, id`)
    .all(...TUTORIAL_NAMES, TUT) as ProfileRow[];
}

export function deleteTutorial(): void {
  const rows = tutorialProfiles();
  if (!rows.length) return;
  const ids = rows.map((r) => r.id);
  const active = Number(getActive());
  db.exec("BEGIN");
  try {
    for (const id of ids) {
      for (const t of [
        "activities", "planned_sessions", "season_weeks_v2", "daily_log_v2", "races", "lactate_tests", "vo2max_lab",
        "zone_sets", "week_log_v2", "method_experiments", "session_feedback_v2", "cycle_period_log_v2",
        "cycle_symptoms_v2", "cycle_stimulus_evidence_v2", "cycle_stability_v2", "cycle_training_settings",
        "ml_runs", "ml_latent_fitness", "ml_channel_effects", "ml_readiness", "ml_health_flags",
      ]) {
        try { db.prepare(`DELETE FROM ${t} WHERE profile_id=?`).run(id); } catch { /* Tabelle evtl. nicht vorhanden */ }
      }
      for (const key of [
        `availability_${id}`,
        `athlete:${id}`,
        `thresholds:${id}`,
        `phase_dist_overrides:${id}`,
        `cycle_consent:${id}`,
        `cycle_contraception:${id}`,
        `prospective_cooldown:${id}`,
        `tutorial_progress:${id}`,
      ]) db.prepare("DELETE FROM settings WHERE key=?").run(key);
      db.prepare("DELETE FROM settings WHERE key LIKE ?").run(`layout:%:${id}`);
      db.prepare("DELETE FROM profiles WHERE id=?").run(id);
    }
    removeTutorialMarkers(ids);
    if (ids.includes(active)) setSetting("active_profile", 1);
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  }
}

// v2.11.0 (Beta-Befund): frühe Mara→Isabel-Migrationen (vor Einführung von regenerateTutorial) haben teils
// nur den PROFILNAMEN umbenannt — die Aktivitäts-Namen von generateTutorial() trugen damals noch
// "(Mara Demo)" und wurden nie neu erzeugt. `primary` allein (Name stimmt) erkennt diesen Altstand nicht,
// darum zusätzlich auf das Legacy-Label prüfen und in dem Fall vollständig regenerieren.
function hasLegacyDemoLabel(profileId: number): boolean {
  const row = db.prepare("SELECT 1 FROM activities WHERE profile_id=? AND name LIKE '%Mara Demo%' LIMIT 1").get(profileId);
  return !!row;
}

export function ensureTutorialProfile(today: string): void {
  const rows = tutorialProfiles();
  const primary = rows.find((r) => r.name === TUT);
  if (!rows.length) generateTutorial(today);
  else if (!primary) regenerateTutorial(today); // alte "Tutorial"/Alex/Mara-Installationen durch Isabel ersetzen
  else if (hasLegacyDemoLabel(primary.id)) regenerateTutorial(today); // Alt-Aktivitäten mit "(Mara Demo)"-Label
}

export function regenerateTutorial(today: string): number {
  deleteTutorial();
  return generateTutorial(today);
}

const getActive = () => (db.prepare("SELECT value FROM settings WHERE key='active_profile'").get() as { value: string } | undefined)?.value ?? "1";

// ---- Helfer ----
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

// Deterministischer RNG (LCG) — reproduzierbare Demo.
let _seed = 22446688;
const rnd = () => (_seed = (_seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const jit = (base: number, amp: number) => base + (rnd() * 2 - 1) * amp;
const chance = (p: number) => rnd() < p;

type Key = "recovery" | "easy" | "long" | "marathon" | "threshold" | "vo2" | "reps";
type Phase = "Base" | "HM-Build" | "Threshold/HM-Pace" | "Specific" | "Taper";
type Disturbance = "illness" | "travel" | "niggle" | null;
type ActivitySeed = { id: number; date: string; type: string; key: Key; phase: Phase; disturbance: Disturbance };

const SESS: Record<Key, {
  type: string; label: string; durMin: number; durMax: number; if: number; z: Record<number, number>;
  hr: number; family: "easy" | "long" | "threshold" | "vo2"; workOffset?: number; eff?: boolean;
}> = {
  recovery: { type: "Recovery", label: "Regenerationslauf", durMin: 34, durMax: 46, if: 0.68, z: { 1: 0.45, 2: 0.55 }, hr: 126, family: "easy" },
  easy: { type: "Easy", label: "Lockerer Dauerlauf", durMin: 48, durMax: 72, if: 0.73, z: { 1: 0.15, 2: 0.85 }, hr: 139, family: "easy" },
  long: { type: "Long", label: "Longrun", durMin: 92, durMax: 145, if: 0.78, z: { 2: 0.78, 3: 0.22 }, hr: 149, family: "long", eff: true },
  marathon: { type: "MarathonPace", label: "HM-/Marathon-Pace", durMin: 56, durMax: 78, if: 0.84, z: { 2: 0.42, 3: 0.48, 4: 0.10 }, hr: 158, family: "threshold", workOffset: 10, eff: true },
  threshold: { type: "Threshold", label: "Schwelle", durMin: 54, durMax: 74, if: 0.89, z: { 2: 0.45, 3: 0.12, 4: 0.43 }, hr: 166, family: "threshold", workOffset: 0, eff: true },
  vo2: { type: "VO2", label: "VO2max", durMin: 44, durMax: 58, if: 0.93, z: { 2: 0.48, 4: 0.15, 5: 0.37 }, hr: 174, family: "vo2", workOffset: -20, eff: true },
  reps: { type: "Repetitions", label: "Repetitions", durMin: 38, durMax: 50, if: 0.88, z: { 1: 0.30, 2: 0.38, 5: 0.20, 6: 0.12 }, hr: 168, family: "vo2", workOffset: -30, eff: true },
};

function phaseForWeek(w: number, todayWeekIndex: number): Phase {
  if (w >= todayWeekIndex + 4) return "Taper";
  if (w >= todayWeekIndex - 10) return "Specific";
  if (w >= todayWeekIndex - 30) return "Threshold/HM-Pace";
  if (w >= todayWeekIndex - 54) return "HM-Build";
  return "Base";
}

function weekKeys(phase: Phase, w: number, deload: boolean): Record<number, Key> {
  if (phase === "Taper") return w % 2 === 0 ? { 0: "easy", 1: "threshold", 3: "marathon", 5: "recovery", 6: "long" } : { 0: "easy", 2: "threshold", 4: "recovery", 6: "long" };
  if (deload) return { 0: "easy", 2: "threshold", 4: "recovery", 6: "long" };
  if (phase === "Specific") return { 0: "easy", 1: "threshold", 2: "easy", 3: w % 3 === 0 ? "reps" : "marathon", 4: "recovery", 6: "long" };
  if (phase === "Threshold/HM-Pace") return { 0: "easy", 1: "threshold", 2: "easy", 3: "marathon", 4: "recovery", 6: "long" };
  if (phase === "HM-Build") return { 0: "easy", 1: "threshold", 2: "easy", 4: "recovery", 6: "long", ...(w % 3 === 1 ? { 3: "vo2" as Key } : { 3: "easy" as Key }) };
  return w % 2 === 0
    ? { 0: "easy", 2: "easy", 3: "easy", 4: "recovery", 6: "long" }
    : { 0: "easy", 1: "marathon", 2: "easy", 4: "recovery", 6: "long" };
}

function targetKmFor(phase: Phase, progress: number, deload: boolean): number {
  const base = 45 + 33 * progress;
  const phaseBump = phase === "Base" ? -2 : phase === "HM-Build" ? 0 : phase === "Threshold/HM-Pace" ? 3 : phase === "Specific" ? 4 : -20;
  const km = base + phaseBump;
  return Math.round(clamp(deload ? km * 0.76 : km, 32, 80));
}

function zoneKmFromMinutes(zMin: Record<number, number>, repPace: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [z, min] of Object.entries(zMin)) out[+z] = round2((min * 60) / repPace[+z - 1]);
  return out;
}

function addRaceSplits(totalS: number, kmCount: number, hrStart: number): string {
  return JSON.stringify(Array.from({ length: kmCount }, (_, i) => {
    const drift = i < 2 ? 2 : i > kmCount - 3 ? -2 : 0;
    return { km: i + 1, time_s: Math.round(totalS / kmCount + drift), avg_hr: hrStart + Math.min(8, Math.floor(i / 2)) };
  }));
}

function disturbanceFor(date: string, anchors: { illnessStart: string; travelStart: string; niggleStart: string }): Disturbance {
  if (date >= anchors.illnessStart && date <= addDays(anchors.illnessStart, 5)) return "illness";
  if (date >= anchors.travelStart && date <= addDays(anchors.travelStart, 6)) return "travel";
  if (date >= anchors.niggleStart && date <= addDays(anchors.niggleStart, 14)) return "niggle";
  return null;
}

// Kleiner DETERMINISTISCHER Jitter aus dem Datum (ohne den RNG-Strom zu verbrauchen) → Within-Phase-Streuung.
const symJit = (date: string, salt: number) => ((date.charCodeAt(5) + date.charCodeAt(8) + date.charCodeAt(9) + salt) % 3) - 1; // -1..+1
/**
 * Physiologisch korrektes Zyklus-Symptommuster für Isabel (natürlicher Zyklus, Kupferspirale = nicht-hormonell,
 * aber stärkere Menses/Krämpfe). 1..5. Follikel/Ovulation = Leistungshoch; späte Luteal = PMS-Gradient.
 */
function isabelSymptom(phase: string | null, cd: number, date: string): { cramps: number | null; energy: number; sleep: number; mood: number; flow: number | null; note: string } {
  const c = (v: number) => clamp(Math.round(v), 1, 5);
  switch (phase) {
    case "menstrual": // cd 1..5: Krämpfe/Flow früh stark, Energie/Mood niedrig, steigend
      return {
        cramps: c(6 - cd + symJit(date, 1)), energy: c(1.6 + cd * 0.4 + symJit(date, 2)),
        sleep: c(2.7 + cd * 0.2 + symJit(date, 3)), mood: c(2.3 + cd * 0.3 + symJit(date, 4)), flow: c(6 - cd),
        note: cd <= 2 ? "Menstruation – Krämpfe & Flow stark (Kupferspirale), Energie niedrig." : "Menstruation klingt ab, Energie kehrt zurück.",
      };
    case "follicular": // steigendes Östrogen → Feel-good-Phase
      return { cramps: c(1 + Math.max(0, symJit(date, 5))), energy: c(4 + symJit(date, 6)), sleep: c(4 + symJit(date, 7)), mood: c(4 + symJit(date, 8)), flow: null,
        note: "Follikelphase – steigendes Östrogen, hohe Energie & gute Erholung." };
    case "ovulation": // Östrogen-Peak, Leistungshoch, evtl. Mittelschmerz
      return { cramps: c(1.4 + Math.max(0, symJit(date, 9))), energy: c(5 + Math.min(0, symJit(date, 10))), sleep: c(4 + symJit(date, 11)), mood: c(5 + Math.min(0, symJit(date, 12))), flow: null,
        note: "Ovulation – Leistungshoch (Östrogen-Peak), evtl. leichter Mittelschmerz." };
    case "early_luteal": // Progesteron steigt, noch gute Belastbarkeit
      return { cramps: c(1 + Math.max(0, symJit(date, 13))), energy: c(3.6 + symJit(date, 14)), sleep: c(3.4 + symJit(date, 15)), mood: c(3.6 + symJit(date, 16)), flow: null,
        note: "Frühe Lutealphase – Progesteron steigt, noch gute Belastbarkeit." };
    case "late_luteal": { // PMS-Gradient: je näher an Menstruation, desto stärker
      const k = clamp((cd - 21) / 7, 0, 1);
      return {
        cramps: c(1 + k * 2 + symJit(date, 17)), energy: c(3.4 - k * 1.4 + symJit(date, 18)),
        sleep: c(3.4 - k * 1.2 + symJit(date, 19)), mood: c(3.4 - k * 1.5 + symJit(date, 20)), flow: null,
        note: k > 0.6 ? "Späte Lutealphase/PMS – Energie & Stimmung tief, prämenstruelle Krämpfe." : "Späte Lutealphase – Progesteron hoch, erste PMS-Zeichen.",
      };
    }
    default:
      return { cramps: c(1), energy: c(3), sleep: c(3), mood: c(3), flow: null, note: "Zwischenphase." };
  }
}

function generateCycleData(profileId: number, week0: string, today: string, nowIso: string): Period[] {
  const lastStart = addDays(today, -17); // heute = Zyklustag 18
  const starts: string[] = [];
  let cur = lastStart;
  for (let i = 0; cur >= addDays(week0, -35) && i < 24; i++) {
    starts.push(cur);
    const len = [29, 28, 29, 30, 28, 29, 29, 28][i % 8];
    cur = addDays(cur, -len);
  }
  const periods = starts.reverse().map((start) => ({ start_date: start, end_date: addDays(start, 4) }));
  const insPeriod = db.prepare("INSERT INTO cycle_period_log_v2(profile_id, start_date, end_date, notes, created_at) VALUES(?,?,?,?,?)");
  const insSymptom = db.prepare("INSERT INTO cycle_symptoms_v2(profile_id, date, cramps, energy, sleep, mood, flow, notes, created_at) VALUES(?,?,?,?,?,?,?,?,?)");
  for (const p of periods) {
    insPeriod.run(profileId, p.start_date, p.end_date, "Tutorial: stabiler natürlicher Zyklus (Kupferspirale).", nowIso);
  }
  // Tägliches, physiologisch korrektes Symptom-Tracking über die letzten ~5 Zyklen (Isabel begann vor ~150 Tagen
  // zu tracken). Kleine, deterministische Lücken (~1/12) wirken realistisch. Ältere Historie bleibt untracked.
  const symStart = addDays(today, -150);
  for (let d = 0; addDays(week0, d) <= today; d++) {
    const date = addDays(week0, d);
    if (date < symStart) continue;
    if ((date.charCodeAt(8) + date.charCodeAt(9)) % 12 === 0) continue; // ~1 von 12 Tagen ausgelassen
    const ctx = buildFeedbackContext(periods, { method: "copper_iud" }, date);
    const s = isabelSymptom(ctx.cycle_phase, ctx.cycle_day ?? 0, date);
    insSymptom.run(profileId, date, s.cramps, s.energy, s.sleep, s.mood, s.flow, s.note, nowIso);
  }
  const stab = evaluateCycleStability(periods, today);
  db.prepare("INSERT OR REPLACE INTO cycle_stability_v2(profile_id, n_cycles, median_length, length_sd, regularity, gate_passed, last_evaluated) VALUES(?,?,?,?,?,?,?)")
    .run(profileId, stab.nCycles, stab.medianLength, stab.lengthSd, stab.regularity, stab.regularity === "stable" ? 1 : 0, nowIso);
  return periods;
}

function feedbackPattern(family: string, phase: string | null, disturbance: Disturbance): number {
  let v = family === "easy" ? 0.1 : family === "long" ? 0.0 : family === "threshold" ? -0.05 : -0.12;
  if (phase === "follicular" && (family === "threshold" || family === "vo2")) v += 0.35;
  if (phase === "follicular" && family === "easy") v += 0.08;
  if (phase === "early_luteal" && family === "long") v += 0.14;
  if (phase === "early_luteal" && family === "threshold") v += 0.10;
  if (phase === "late_luteal" && (family === "threshold" || family === "vo2")) v -= 0.42;
  if (phase === "late_luteal" && family === "long") v -= 0.15;
  if (phase === "menstrual" && (family === "threshold" || family === "vo2")) v -= 0.32;
  if (phase === "menstrual" && family === "easy") v -= 0.08;
  if (disturbance === "illness") v -= 1.2;
  if (disturbance === "travel") v -= 0.45;
  if (disturbance === "niggle") v -= 0.35;
  return v;
}

type SymRow = { cramps: number | null; energy: number | null; sleep: number | null; mood: number | null; flow: number | null };
function loadTutorialSymptoms(profileId: number): Map<string, SymRow> {
  const rows = db.prepare("SELECT date, cramps, energy, sleep, mood, flow FROM cycle_symptoms_v2 WHERE profile_id=?").all(profileId) as (SymRow & { date: string })[];
  return new Map(rows.map((r) => [r.date, { cramps: r.cramps, energy: r.energy, sleep: r.sleep, mood: r.mood, flow: r.flow }]));
}
// Symptom-Last ~[-1..+1] (höher = schlechterer Tag) — Spiegel von cycleTraining.symptomBurden, für die Demo-Kopplung.
const tutorialBurden = (s?: SymRow): number => {
  if (!s) return 0;
  const t: number[] = [];
  if (s.cramps != null) t.push((s.cramps - 3) / 2);
  if (s.energy != null) t.push((3 - s.energy) / 2);
  if (s.sleep != null) t.push((3 - s.sleep) / 2);
  if (s.mood != null) t.push((3 - s.mood) / 2);
  return t.length ? t.reduce((a, b) => a + b, 0) / t.length : 0;
};

function generateFeedbackData(profileId: number, activities: ActivitySeed[], periods: Period[], contraception: ContraceptionStatus, nowIso: string): void {
  const ins = db.prepare("INSERT INTO session_feedback_v2(profile_id, activity_id, date, session_family, rpe, felt_vs_expected, life_stress, notes, cycle_phase, cycle_day, confounder_flag, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
  const symMap = loadTutorialSymptoms(profileId); // Symptome sind bereits geseedet (generateCycleData läuft vorher)
  for (const a of activities) {
    const s = SESS[a.key];
    const isKey = ["long", "threshold", "marathon", "vo2", "reps"].includes(a.key);
    if (!isKey && !chance(0.64)) continue;
    if (isKey && !chance(0.93)) continue;
    const ctx = buildFeedbackContext(periods, contraception, a.date);
    // Leichte Kopplung: an Tagen mit stärkeren Symptomen lief die Einheit etwas schlechter (Within-Phase-Signal,
    // das die Kovariaten-Korrektur in Teil 4 sichtbar herausrechnet).
    const raw = feedbackPattern(s.family, ctx.cycle_phase, a.disturbance) + jit(0, 0.42) - 0.5 * tutorialBurden(symMap.get(a.date));
    const felt = clamp(Math.round(raw), -2, 2);
    const rpeBase = s.family === "easy" ? 3.3 : s.family === "long" ? 5.2 : s.family === "threshold" ? 7.0 : 7.8;
    const rpe = clamp(Math.round(rpeBase - raw * 0.55 + jit(0, 0.7)), 1, 10);
    const stress = clamp(Math.round(jit(a.disturbance ? 5.2 : 2.6, a.disturbance ? 1.2 : 1.0)), 1, 7);
    const notes = a.disturbance === "illness" ? "Erkältung als Confounder markiert."
      : a.disturbance === "travel" ? "Reisewoche, Schlaf/Timing nicht ideal."
        : a.disturbance === "niggle" ? "Leichtes Waden-/Achilles-Ziehen, konservativ bewertet."
          : null;
    ins.run(profileId, a.id, a.date, s.family, rpe, felt, stress, notes, ctx.cycle_phase, ctx.cycle_day, a.disturbance, nowIso);
  }
  seedCycleEvidence(profileId, periods, nowIso);
}

function seedCycleEvidence(profileId: number, periods: Period[], nowIso: string): void {
  // Symptome per Datum joinen + Zyklus-Nummer (Teil 5) → geseedete Evidenz ist symptom-korrigiert UND replikations-bewusst.
  const symMap = loadTutorialSymptoms(profileId);
  const starts = periods.map((x) => x.start_date).sort();
  const rows = db.prepare("SELECT date, session_family, cycle_phase, felt_vs_expected, rpe, confounder_flag FROM session_feedback_v2 WHERE profile_id=? AND cycle_phase IS NOT NULL")
    .all(profileId) as unknown as (Parameters<typeof evaluatePhaseStimulus>[0][number] & { date: string })[];
  const feedback = rows.map((r) => ({ ...r, ...(symMap.get(r.date) ?? {}), cycle_index: cycleIndexOf(r.date, starts) }));
  const { evidence } = evaluatePhaseStimulus(feedback);
  const ins = db.prepare("INSERT INTO cycle_stimulus_evidence_v2(profile_id, phase, stimulus, n_sessions, mean_quality, effect_size, ci_low, ci_high, confidence, prior_weight, posterior_weight, last_updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
  db.prepare("DELETE FROM cycle_stimulus_evidence_v2 WHERE profile_id=?").run(profileId);
  for (const e of evidence) {
    ins.run(profileId, e.phase, e.stimulus, e.n_sessions, e.mean_quality, e.effect_size, e.ci_low, e.ci_high, e.confidence, e.prior_weight, e.posterior_weight, nowIso);
  }
}

function generateRaceAndLabData(profileId: number, today: string, raceDay: string, nowIso: string): void {
  const insRace = db.prepare("INSERT INTO races(profile_id, date, name, distance_m, time_s, placement, notes, splits, avg_hr, max_hr, elevation_m, source, goal_time_s, is_tuneup) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  insRace.run(profileId, addDays(today, -430), "10-km-Testlauf Frühform", 10000, 43 * 60 + 34, "Trainingsrennen", "Ausgangsniveau: kontrolliert, noch wenig spezifische Schwelle.", addRaceSplits(43 * 60 + 34, 10, 165), 169, 183, 44, "manual", null, 1);
  insRace.run(profileId, addDays(today, -278), "15-km-Test im HM-Build", 15000, 64 * 60 + 22, "5. AK", "Aerobe Kontinuität zeigt Wirkung; guter Longrun-Transfer.", addRaceSplits(64 * 60 + 22, 15, 164), 170, 184, 72, "manual", null, 1);
  insRace.run(profileId, addDays(today, -132), "Halbmarathon-Test", 21097.5, 91 * 60 + 18, "PB", "Solider HM-Test vor dem spezifischen Block, Potenzial klar unter 1:30 sichtbar.", addRaceSplits(91 * 60 + 18, 21, 162), 168, 184, 96, "manual", null, 1);
  insRace.run(profileId, raceDay, "Ziel-Halbmarathon", 21097.5, null, "", "Zielrennen in 6 Wochen. Wunschzeit: 1:27:00.", "[]", null, null, 68, "manual", 87 * 60, 0);

  const insLac = db.prepare("INSERT INTO lactate_tests(profile_id, date, sport, kind, notes, lt1_hr, lt1_pace, lt2_hr, lt2_pace, confidence, warnings, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
  insLac.run(profileId, addDays(today, -365), "Run", "Labortest", "Basisdiagnostik: gute Grundlage, Schwelle noch ausbaufähig.", 146, 306, 166, 257, "mittel", "[]", nowIso);
  insLac.run(profileId, addDays(today, -82), "Run", "Labortest", "Spezifischer Block: LT1 stabiler, LT2 Richtung HM-Ziel verbessert.", 151, 292, 169, 244, "hoch", "[]", nowIso);

  const insVo2 = db.prepare("INSERT INTO vo2max_lab(profile_id, date, value, source, notes, created_at) VALUES(?,?,?,?,?,?)");
  insVo2.run(profileId, addDays(today, -360), 49.2, "Lab", "Baseline vor kontinuierlichem HM-Aufbau.", nowIso);
  insVo2.run(profileId, addDays(today, -76), 52.7, "Lab", "Moderater Anstieg, passend zu Race-/Laktatdaten.", nowIso);
}

function seedActiveTrial(profileId: number, today: string, nowIso: string): void {
  const trialStart = mondayOf(addDays(today, 7));
  createProspectiveTrial(profileId, {
    kind: "channel",
    armA: { value: "aerob", label: "Aerob/Longrun-Fokus" },
    armB: { value: "threshold", label: "Schwelle/HM-Pace-Fokus" },
    nPairsPlanned: 3,
    blockWeeks: 3,
    washoutWeeks: 1,
    lagWeeks: 3,
    consentedAt: nowIso,
    proposalHash: "tutorial-isabel-aerob-longrun-vs-threshold-hmpace",
    startDate: trialStart,
  });
}

function generateTutorial(today: string): number {
  _seed = 22446688;
  const nowIso = new Date().toISOString();
  const pastWeeks = 78;
  const futureWeeks = 6;
  const totalWeeks = pastWeeks + futureWeeks;
  const todayWeekIndex = pastWeeks - 1;
  const week0 = addDays(mondayOf(today), -7 * (pastWeeks - 1));
  const raceDay = addDays(today, 42);
  const anchors = {
    illnessStart: addDays(today, -252),
    travelStart: addDays(today, -166),
    niggleStart: addDays(today, -74),
  };
  const activities: ActivitySeed[] = [];

  db.exec("BEGIN");
  try {
    const pid = Number(db.prepare("INSERT INTO profiles(name) VALUES(?)").run(TUT).lastInsertRowid);
    addTutorialMarker(pid); // N-1: ab jetzt autoritativ per Marker statt Name erkannt

    setProfileSetting("athlete", {
      name: "Isabel Demo",
      sex: "f",
      birth_year: 1995,
      weight: MASS,
      height: HEIGHT_CM,
      max_hr: 192,
      hr_rest: 44,
    }, pid);
    setProfileSetting("cycle_consent", { consented: true, consentedAt: nowIso }, pid);
    setProfileSetting("cycle_contraception", { method: "copper_iud" }, pid);
    setProfileSetting("thresholds", {
      lthr: 169,
      threshold_pace: 244,
      lt1_hr: 151,
      lt1_pace: 292,
    }, pid);
    setSetting(`availability_${pid}`, {
      minutesByWeekday: [60, 75, 55, 80, 45, 0, 145],
      longRunDay: 6,
      hardDays: [1, 3],
      hillDay: 4,
      allowDoubles: false,
      corePerWeek: 2,
      coreDays: [0, 4],
      emphasis: "HM-spezifisch: Aerob + Schwelle",
    });

    const hrZones = DEFAULT_HR_ZONES.map((z, i) => ({
      ...z,
      min: [0, 128, 146, 158, 169, 181][i],
      max: [127, 145, 157, 168, 180, 999][i],
    }));
    const paceZones = [390, 330, 292, 244, 222, 185];
    const repPace = paceZones.map((p, i) => (i === 0 ? p + 20 : Math.round((paceZones[i - 1] + p) / 2)));
    db.prepare("INSERT INTO zone_sets(profile_id, valid_from, hr_zones, pace_zones, lthr, ftp, threshold_pace, lt1_hr, lt1_pace, source, note, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(pid, addDays(today, -560), JSON.stringify(hrZones), JSON.stringify(paceZones), 169, 232, 244, 151, 292, "Tutorial", "Demo-Zonen fuer Isabel (HM-Fokus).", nowIso);

    db.prepare(
      `INSERT INTO cycle_training_settings(profile_id, cycle_adaptive_enabled, method_emphasis, method_emphasis_weight, phase_stimulus_map, feedback_sensitivity, symptom_override_enabled, observation_mode_only, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run(pid, 0, "hm_specific", 0.6, null, 0.6, 1, 1, nowIso);

    const periods = generateCycleData(pid, week0, today, nowIso);

    const insAct = db.prepare(`INSERT INTO activities(profile_id, date, sport, source, name, type, distance_m, moving_s, elapsed_s, avg_hr, max_hr, avg_power, elevation, avg_cadence, tss, zones, zone_min, zone_km, pace_zone_min, ngp, decoupling, eff_vo2max, run_np, power_curve, best_efforts, efforts, notes, match_ignore) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insWeek = db.prepare("INSERT INTO season_weeks_v2(profile_id, week_no, label, phase, start_date, end_date, target_km, goal_race, notes) VALUES(?,?,?,?,?,?,?,?,?)");
    const insPlan = db.prepare("INSERT INTO planned_sessions(profile_id, date, week_no, sport, type, planned_km, planned_min, zone_alloc, description, efforts, planned_tss, sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
    const insLog = db.prepare("INSERT INTO daily_log_v2(profile_id, date, weight, resting_hr, hrv, recovery, strain, sleep_h, soreness, motivation, rpe, sick, travel, pain, pain_location, notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const insWeekLog = db.prepare("INSERT INTO week_log_v2(profile_id, week_no, run_km, week_tss, checks) VALUES(?,?,?,?,?)");

    for (let w = 0; w < totalWeeks; w++) {
      const start = addDays(week0, w * 7);
      const end = addDays(start, 6);
      const phase = phaseForWeek(w, todayWeekIndex);
      const deload = w % 4 === 3 && phase !== "Taper";
      const progress = clamp(w / (pastWeeks - 1), 0, 1);
      const thresholdPace = 262 - 18 * progress;
      const hmPotentialS = 94 * 60 - 7 * 60 * progress;
      const hmPace = hmPotentialS / 21.0975;
      const effBase = 48.4 + 4.7 * progress + Math.sin(w / 9) * 0.35;
      const targetKm = targetKmFor(phase, progress, deload);
      const phaseNote = phase === "Base" ? "Aerobe Kontinuitaet und ruhige Longruns."
        : phase === "HM-Build" ? "Longruns wachsen, erste stabile Schwellenarbeit."
          : phase === "Threshold/HM-Pace" ? "Haupttreiber: Schwelle und HM-Pace, VO2 dosiert."
            : phase === "Specific" ? "Spezifischer HM-Block mit Race-Pace-Anteilen."
              : "Taper: Last runter, Schaerfe erhalten.";
      insWeek.run(pid, w + 1, `Isabel W${w + 1}`, phase, start, end, targetKm, w === totalWeeks - 1 ? "Ziel-Halbmarathon 1:27:00" : "", phaseNote);

      const keys = weekKeys(phase, w, deload);
      let weekKm = 0;
      let weekTss = 0;
      for (let d = 0; d < 7; d++) {
        const date = addDays(start, d);
        const k = keys[d];
        const disturb = disturbanceFor(date, anchors);
        const recentLow = date >= addDays(today, -5) && date <= today;
        if (date <= today) {
          const sick = disturb === "illness" ? 1 : 0;
          const travel = disturb === "travel" ? 1 : 0;
          const pain = disturb === "niggle" ? clamp(Math.round(jit(3, 1)), 1, 5) : clamp(Math.round(jit(0.5, 0.8)), 0, 2);
          const sleep = round1(jit(recentLow ? 6.45 : disturb ? 6.4 : 7.45, recentLow ? 0.35 : 0.65));
          const hrv = Math.round(jit(recentLow ? 55 : sick ? 50 : 62, recentLow ? 3 : 5));
          const rhr = Math.round(jit(recentLow ? 49 : sick ? 53 : 45, recentLow ? 1.5 : 2.2));
          const recovery = clamp(Math.round(jit(recentLow ? 54 : sick ? 42 : 72, recentLow ? 8 : 12)), 20, 95);
          insLog.run(pid, date, round1(jit(MASS, 0.35)), rhr, hrv, recovery, round1(jit(k ? SESS[k].if * 12 : 2.2, 1.4)), sleep,
            clamp(Math.round(jit(disturb === "niggle" ? 5 : 2, 1.2)), 0, 8), clamp(Math.round(jit(recentLow ? 6 : 7.5, 1.5)), 1, 10),
            k ? clamp(Math.round(jit(SESS[k].if * 10, 1)), 1, 10) : 1, sick, travel, pain,
            disturb === "niggle" ? "Wade/Achilles" : null,
            disturb === "illness" ? "Erkaeltung, Last bewusst reduziert." : disturb === "travel" ? "Reisewoche." : disturb === "niggle" ? "Leichter Waden-/Achilles-Niggle." : null);
        }
        if (!k) continue;
        if (disturb === "illness" && date >= anchors.illnessStart && date <= addDays(anchors.illnessStart, 4)) continue;
        const s = SESS[k];
        const isPast = date < today;
        const isRecentPlan = date >= addDays(today, -56);
        const durationScale = deload ? 0.82 : phase === "Taper" ? 0.70 : 1;
        const matureVolumeTrim = 1 - 0.09 * progress;
        const baseIntroTrim = phase === "Base" ? 0.78 + 0.18 * progress : 1;
        const dur = Math.round(jit((s.durMin + s.durMax) / 2, (s.durMax - s.durMin) / 2) * durationScale * matureVolumeTrim * baseIntroTrim * (disturb === "travel" ? 0.78 : disturb === "niggle" && k !== "easy" ? 0.70 : 1));
        const ifv = clamp(jit(s.if, 0.02) * (disturb === "niggle" && ["threshold", "vo2", "reps"].includes(k) ? 0.88 : 1), 0.58, 1.02);
        const movingS = dur * 60;
        const avgPace = Math.round(thresholdPace / ifv);
        const distM = Math.round((movingS / avgPace) * 1000);
        const tss = round1((movingS / 3600) * ifv * ifv * 100);
        const avgHr = clamp(Math.round(jit(s.hr, 3) - (deload ? 1 : 0)), 105, 190);
        const maxHr = clamp(avgHr + Math.round(jit(s.family === "vo2" ? 15 : s.family === "threshold" ? 11 : 8, 3)), avgHr + 4, 194);
        const zoneMin: Record<number, number> = {};
        for (const [z, frac] of Object.entries(s.z)) zoneMin[+z] = round1(dur * frac);
        const zoneKm = zoneKmFromMinutes(zoneMin, repPace);
        const workPace = Math.round(k === "marathon" ? hmPace + 2 : thresholdPace + (s.workOffset ?? 0));
        const bests = s.eff ? JSON.stringify({
          1000: Math.round(workPace * (k === "reps" ? 0.96 : 1.02)),
          3000: Math.round(workPace * 3 * 1.01),
          5000: Math.round((thresholdPace - 5) * 5 * 1.015),
          10000: Math.round((hmPace - 3) * 10),
        }) : null;
        const runNp = Math.round(jit(MASS * 3.45 * ifv + 28, 5));
        const decoup = ["long", "easy", "recovery"].includes(k) ? round1(jit(k === "long" ? 5.2 - 1.6 * progress : 3.0 - 0.8 * progress, 0.9)) : null;
        const effV = ["long", "easy", "recovery", "marathon"].includes(k) && dur >= 40 ? round1(jit(effBase, 1.0)) : null;
        const powerCurve = s.eff ? JSON.stringify({ 300: runNp + 22, 600: runNp + 10, 1200: runNp + 3, 1800: runNp - 2, 3600: runNp - 12 }) : null;
        const efforts = ["threshold", "marathon", "vo2", "reps"].includes(k)
          ? JSON.stringify([{
            reps: k === "vo2" ? 5 : k === "reps" ? 8 : k === "marathon" ? 3 : 4,
            sec: k === "vo2" ? 180 : k === "reps" ? 60 : k === "marathon" ? 900 : 480,
            dist_m: null,
            zone: k === "vo2" || k === "reps" ? 5 : k === "marathon" ? 3 : 4,
            pace_s: workPace,
            rest_s: k === "reps" ? 75 : 120,
            rest_type: "jog",
            label: s.type,
          }])
          : null;
        const desc = k === "threshold" ? `${dur}' inkl. 4x8' @ ${paceStr(workPace)}/km`
          : k === "marathon" ? `${dur}' inkl. 3x15' @ ${paceStr(workPace)}/km`
            : k === "vo2" ? `${dur}' inkl. 5x3' @ ${paceStr(workPace)}/km`
              : k === "reps" ? `${dur}' inkl. 8x1' zuegig`
                : k === "long" ? `${dur}' Longrun ruhig`
                  : `${dur}' ${s.type}`;
        const note = disturb === "travel" ? "Tutorial-Confounder: Reisewoche."
          : disturb === "niggle" ? "Tutorial-Confounder: leichter Waden-/Achilles-Niggle."
            : null;
        if (isPast) {
          const info = insAct.run(pid, date, "Run", "tutorial", `${s.label} (Isabel Demo)`, s.type, distM, movingS, movingS + Math.round(jit(90, 50)), avgHr, maxHr,
            runNp, Math.round(jit(k === "long" ? 180 : 55, 35)), Math.round(jit(174, 6)), tss, null, JSON.stringify(zoneMin),
            JSON.stringify(zoneKm), JSON.stringify(zoneMin), avgPace, decoup, effV, runNp, powerCurve, bests, efforts, note, 0);
          activities.push({ id: Number(info.lastInsertRowid), date, type: s.type, key: k, phase, disturbance: disturb });
          weekKm += distM / 1000;
          weekTss += tss;
        }
        if (!isPast || isRecentPlan) {
          insPlan.run(pid, date, w + 1, "Run", s.type, round1(distM / 1000), dur, JSON.stringify({ byMin: zoneMin, byKm: zoneKm }), desc, efforts, tss, d);
        }
      }
      if (end < today) {
        const checks = {
          mileage: weekKm >= targetKm * 0.82,
          threshold2x: phase === "Threshold/HM-Pace" || phase === "Specific",
          longrun: weekKm > 0,
          plyo: w % 2 === 0,
          physio: w % 3 !== 0,
          note: disturbanceFor(start, anchors) ?? null,
        };
        insWeekLog.run(pid, w + 1, round1(weekKm), Math.round(weekTss), JSON.stringify(checks));
      }
    }

    generateRaceAndLabData(pid, today, raceDay, nowIso);
    generateFeedbackData(pid, activities, periods, { method: "copper_iud" }, nowIso);
    seedActiveTrial(pid, today, nowIso);

    db.exec("COMMIT");
    return pid;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  }
}
