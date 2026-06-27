// Tutorial-Profil (v1.8.0): erzeugt ein vollständiges, realistisches Beispieljahr für einen fiktiven Sportler
// („Alex Demo", 10-km-Fokus). Strikt auf einem EIGENEN profile_id — Bestandsdaten werden nie berührt.
// Idempotent (ensureTutorialProfile), löschbar (deleteTutorial), neu erzeugbar (regenerateTutorial).
// Deterministisch (seeded RNG) → gleiche Demo bei jedem Neuaufbau. Deckt alle Seiten/Funktionen mit Daten ab.
import { db, setSetting, DEFAULT_HR_ZONES } from "./db.ts";

const TUT = "Tutorial";
const MASS = 68; // kg (für Watt/RE)

export function tutorialProfileId(): number | null {
  const r = db.prepare("SELECT id FROM profiles WHERE name=?").get(TUT) as { id: number } | undefined;
  return r?.id ?? null;
}

export function deleteTutorial(): void {
  const id = tutorialProfileId();
  if (!id) return;
  for (const t of ["activities", "planned_sessions", "season_weeks_v2", "daily_log_v2", "races", "lactate_tests", "zone_sets", "week_log_v2", "method_experiments"]) {
    try { db.prepare(`DELETE FROM ${t} WHERE profile_id=?`).run(id); } catch { /* Tabelle evtl. nicht vorhanden */ }
  }
  db.prepare("DELETE FROM settings WHERE key=?").run(`availability_${id}`);
  if (Number(getActive()) === id) setSetting("active_profile", 1); // nicht das Tutorial aktiv lassen
  db.prepare("DELETE FROM profiles WHERE id=?").run(id);
}

export function ensureTutorialProfile(today: string): void {
  if (!tutorialProfileId()) generateTutorial(today);
}
export function regenerateTutorial(today: string): number {
  deleteTutorial();
  return generateTutorial(today);
}

const getActive = () => (db.prepare("SELECT value FROM settings WHERE key='active_profile'").get() as { value: string } | undefined)?.value ?? "1";

// ---- Helfer ----
const addDays = (iso: string, n: number): string => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (iso: string): string => { const d = new Date(iso + "T00:00:00Z"); const wd = (d.getUTCDay() + 6) % 7; return addDays(iso, -wd); };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Deterministischer RNG (LCG) — reproduzierbare Demo.
let _seed = 987654321;
const rnd = () => (_seed = (_seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const jit = (base: number, amp: number) => base + (rnd() * 2 - 1) * amp;

type Key = "recovery" | "easy" | "long" | "threshold" | "vo2" | "fartlek";
const SESS: Record<Key, { type: string; durMin: number; durMax: number; if: number; z: Record<number, number>; eff?: boolean; work?: number; hr: number }> = {
  recovery: { type: "Easy", durMin: 32, durMax: 42, if: 0.70, z: { 1: 0.35, 2: 0.65 }, hr: 126 },
  easy: { type: "Easy", durMin: 50, durMax: 68, if: 0.78, z: { 1: 0.1, 2: 0.9 }, hr: 141 },
  long: { type: "Long", durMin: 92, durMax: 132, if: 0.84, z: { 2: 0.82, 3: 0.18 }, hr: 151 },
  threshold: { type: "Threshold", durMin: 48, durMax: 60, if: 0.92, z: { 2: 0.45, 3: 0.1, 4: 0.45 }, eff: true, work: -2, hr: 167 },
  vo2: { type: "VO2", durMin: 44, durMax: 54, if: 0.95, z: { 2: 0.5, 4: 0.15, 5: 0.35 }, eff: true, work: -22, hr: 176 },
  fartlek: { type: "VO2", durMin: 46, durMax: 56, if: 0.90, z: { 2: 0.5, 4: 0.2, 5: 0.3 }, eff: true, work: -12, hr: 164 },
};

// Wochen-Struktur je Phase (Wochentag 0=Mo..6=So → Session-Key).
function weekKeys(phase: string, wi: number): Record<number, Key> {
  if (phase === "Entlastung") return { 0: "easy", 2: "threshold", 4: "recovery", 6: "long" };
  if (phase === "Race-Week") return { 1: "vo2", 3: "easy", 5: "recovery" };
  if (phase === "Specific") return { 0: "easy", 1: "vo2", 2: "easy", 3: wi % 2 ? "threshold" : "fartlek", 4: "recovery", 6: "long" };
  if (phase === "Belastung") return { 0: "easy", 1: "threshold", 2: "easy", 3: wi % 2 ? "vo2" : "fartlek", 4: "recovery", 6: "long" };
  return { 0: "easy", 1: "threshold", 2: "easy", 3: "fartlek", 4: "recovery", 6: "long" }; // Base
}

function phaseFor(weeksToRace: number): string {
  if (weeksToRace === 0) return "Race-Week";
  if (weeksToRace <= 4) return "Specific";
  if (weeksToRace <= 16) return weeksToRace % 4 === 0 ? "Entlastung" : "Belastung";
  return "Base";
}

function generateTutorial(today: string): number {
  _seed = 987654321;
  const pid = Number(db.prepare("INSERT INTO profiles(name) VALUES(?)").run(TUT).lastInsertRowid);
  const nowIso = new Date().toISOString();

  // Zonen (10-km-Sportler, Schwelle ~4:00/km).
  const hrZones = DEFAULT_HR_ZONES.map((z, i) => ({ ...z, min: [0, 131, 151, 162, 173, 185][i], max: [130, 150, 161, 172, 184, 999][i] }));
  const paceZones = [330, 285, 258, 244, 222, 150];
  db.prepare(`INSERT INTO zone_sets(profile_id, valid_from, hr_zones, pace_zones, lthr, ftp, threshold_pace, source, note, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(pid, addDays(today, -400), JSON.stringify(hrZones), JSON.stringify(paceZones), 168, 250, 244, "Tutorial", "Demo-Zonen (Alex Demo)", nowIso);

  // Verfügbarkeit (für Block-/Wochen-Vorschlag).
  setSetting(`availability_${pid}`, { minutesByWeekday: [60, 75, 60, 80, 50, 90, 150], longRunDay: 6, hardDays: [1, 3], hillDay: 4, allowDoubles: false, corePerWeek: 2, coreDays: [0, 2], emphasis: "ausgewogen" });

  const NWEEKS = 52;
  const raceDay = addDays(today, 21);
  const week0 = addDays(mondayOf(raceDay), -7 * (NWEEKS - 1)); // Montag der ersten Demo-Woche

  const insAct = db.prepare(`INSERT INTO activities(profile_id, date, sport, source, name, type, distance_m, moving_s, elapsed_s, avg_hr, max_hr, avg_power, elevation, avg_cadence, tss, zones, zone_min, zone_km, pace_zone_min, ngp, decoupling, eff_vo2max, run_np, power_curve, best_efforts, efforts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insWeek = db.prepare(`INSERT INTO season_weeks_v2(profile_id, week_no, label, phase, start_date, end_date, target_km, goal_race, notes) VALUES(?,?,?,?,?,?,?,?,?)`);
  const insPlan = db.prepare(`INSERT INTO planned_sessions(profile_id, date, week_no, sport, type, planned_km, planned_min, zone_alloc, description, planned_tss, sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const insLog = db.prepare(`INSERT INTO daily_log_v2(profile_id, date, hrv, resting_hr, recovery, sleep_h, soreness, motivation, rpe) VALUES(?,?,?,?,?,?,?,?,?)`);

  const DAY_NAME = ["Lockerer Dauerlauf", "Schwellenlauf", "Lockerer Dauerlauf", "Tempo/Intervalle", "Regeneration", "", "Longrun"];
  db.exec("BEGIN");
  try {
    for (let w = 0; w < NWEEKS; w++) {
      const start = addDays(week0, w * 7);
      const end = addDays(start, 6);
      const weeksToRace = NWEEKS - 1 - w;
      const phase = phaseFor(weeksToRace);
      const tp = Math.round(jit(250 - 12 * (w / (NWEEKS - 1)), 1.5)); // Schwellen-Pace verbessert sich übers Jahr
      const effBase = 53 + 5 * (w / (NWEEKS - 1));
      const targetKm = Math.round(phase === "Entlastung" ? 42 : phase === "Race-Week" ? 28 : phase === "Specific" ? 70 : phase === "Belastung" ? 64 : 52);
      insWeek.run(pid, w + 1, `KW ${w + 1}`, phase, start, end, targetKm,
        weeksToRace === 0 ? "10 km Frühjahrslauf (Ziel 36:00)" : "",
        w === 0 ? "Saisonstart — ruhiger Wiedereinstieg." : phase === "Specific" ? "Wettkampfspezifik, polarisiert." : "");

      const keys = weekKeys(phase, w);
      for (let d = 0; d < 7; d++) {
        const date = addDays(start, d);
        const k = keys[d];
        const isPast = date < today;
        const isRecent = date >= addDays(today, -8 * 7); // letzte 8 Wochen → auch Plan (für Adherence)
        // Wellness (nur Vergangenheit, leichte Schwankung; ein paar müde Tage).
        if (isPast) insLog.run(pid, date, Math.round(jit(62, 6)), Math.round(jit(46, 3)), Math.round(jit(70, 14)), Math.round(jit(7.4, 0.8) * 10) / 10, clamp(Math.round(jit(2, 1.5)), 0, 6), clamp(Math.round(jit(7, 2)), 1, 10), k ? clamp(Math.round(jit(SESS[k].if * 10, 1)), 1, 10) : 1);
        if (!k) continue;
        const s = SESS[k];
        const ifv = clamp(jit(s.if, 0.02), 0.6, 1.05);
        const dur = Math.round(jit((s.durMin + s.durMax) / 2, (s.durMax - s.durMin) / 2));
        const movingS = dur * 60;
        const avgPace = Math.round(tp / ifv);
        const distM = Math.round((movingS / avgPace) * 1000);
        const tss = Math.round((movingS / 3600) * ifv * ifv * 100 * 10) / 10;
        const avgHr = clamp(Math.round(jit(s.hr, 3)), 100, 195);
        const maxHr = clamp(avgHr + Math.round(jit(k === "vo2" ? 14 : k === "long" ? 10 : 12, 3)), avgHr + 4, 198);
        const zoneMin: Record<number, number> = {}, paceZoneMin: Record<number, number> = {};
        for (const [z, frac] of Object.entries(s.z)) { zoneMin[+z] = Math.round(dur * frac * 10) / 10; paceZoneMin[+z] = Math.round(dur * frac * 10) / 10; }
        const wp = tp + (s.work ?? 0);
        const bests = s.eff ? JSON.stringify({ 1000: Math.round(wp), 3000: Math.round(wp * 3 * 1.01), 5000: Math.round(wp * 5 * 1.02) }) : null;
        const np = Math.round(jit(MASS * 4.0 * ifv + 25, 4));
        const isSteady = k === "easy" || k === "long" || k === "recovery";
        const decoup = isSteady && dur >= 30 ? Math.round(jit(k === "long" ? 4.5 : 2.6, 1.2) * 10) / 10 : null;
        const effV = isSteady && dur >= 30 ? Math.round(jit(effBase, 1.2) * 10) / 10 : null;
        const pc = s.eff ? JSON.stringify({ 300: np + 18, 600: np + 6, 1200: Math.max(0, np - 2) }) : (k === "long" ? JSON.stringify({ 1800: Math.max(0, np - 6), 3600: Math.max(0, np - 14) }) : null);
        const efforts = (k === "vo2" || k === "threshold" || k === "fartlek")
          ? JSON.stringify([{ reps: k === "vo2" ? 5 : k === "fartlek" ? 8 : 4, sec: k === "vo2" ? 180 : k === "fartlek" ? 60 : 480, dist_m: null, zone: k === "vo2" || k === "fartlek" ? 5 : 4, pace_s: wp, rest_s: k === "fartlek" ? 60 : 90, rest_type: "jog", label: s.type }]) : null;
        if (isPast) {
          insAct.run(pid, date, "Run", "tutorial", `${DAY_NAME[d] || s.type} (Alex Demo)`, s.type, distM, movingS, movingS + Math.round(jit(120, 60)), avgHr, maxHr, np, Math.round(jit(k === "long" ? 180 : 60, 40)), Math.round(jit(172, 6)), tss, null, JSON.stringify(zoneMin), null, JSON.stringify(paceZoneMin), avgPace, decoup, effV, np, pc, bests, efforts);
        }
        // Plan: kommende Wochen + jüngste Vergangenheit (für Plan-Erfüllung). Beschreibung kurz.
        if (!isPast || isRecent) {
          const desc = k === "threshold" ? `${dur}' inkl. 4×8' @ ${paceStr(wp)}/km` : k === "vo2" ? `${dur}' inkl. 5×3' @ ${paceStr(wp)}/km` : k === "fartlek" ? `${dur}' Fartlek 8×1'` : k === "long" ? `${dur}' Longrun ruhig` : `${dur}' ${s.type}`;
          insPlan.run(pid, date, w + 1, "Run", s.type, Math.round(distM / 100) / 10, dur, JSON.stringify({ byMin: zoneMin }), desc, tss, d);
        }
      }
    }

    // Wettkämpfe: 5 km (vor ~5 Monaten), 10 km (vor ~2 Monaten), 10 km Ziel (raceDay, mit Wunsch-Zielzeit).
    const insRace = db.prepare(`INSERT INTO races(profile_id, date, name, distance_m, time_s, placement, notes, splits, avg_hr, max_hr, elevation_m, source, goal_time_s) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const splits10 = (total: number) => JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ km: i + 1, time_s: Math.round(total / 10 + (i < 2 ? 2 : i > 7 ? -2 : 0)), avg_hr: 168 + (i > 5 ? 6 : 0), pace_s: Math.round(total / 10) })));
    insRace.run(pid, addDays(today, -150), "Stadtlauf 5 km", 5000, 17 * 60 + 40, "8. AK", "Solider Frühform-Test.", JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ km: i + 1, time_s: 212 + (i > 3 ? -3 : 0), avg_hr: 175 }))), 176, 188, 35, "manual", null);
    insRace.run(pid, addDays(today, -60), "Herbst 10 km", 10000, 37 * 60 + 10, "12. gesamt", "PB! Pacing gut getroffen.", splits10(37 * 60 + 10), 173, 187, 70, "manual", null);
    insRace.run(pid, raceDay, "Frühjahrslauf 10 km", 10000, null, "", "Zielwettkampf — Wunschzeit 36:00.", "[]", null, null, 60, "manual", 36 * 60);

    // Laktat-Test (vor ~3 Monaten) — eicht LT1/LT2.
    db.prepare(`INSERT INTO lactate_tests(profile_id, date, sport, kind, notes, lt1_hr, lt1_pace, lt2_hr, lt2_pace, confidence, warnings, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(pid, addDays(today, -90), "Run", "Feldtest", "Stufentest auf der Bahn (6 Stufen).", 151, 280, 172, 244, "hoch", "[]", nowIso);

    // Methoden-Experiment (für die Methodik-Seite).
    db.prepare(`INSERT INTO method_experiments(profile_id, start_date, end_date, method, label, notes, created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(pid, addDays(today, -120), addDays(today, -92), "norwegian_double_threshold", "Norwegian-Block (4 Wo.)", "Doppel-Schwellen-Tage getestet.", nowIso);
    db.exec("COMMIT");
  } catch (e) { try { db.exec("ROLLBACK"); } catch { /* */ } throw e; }
  return pid;
}

const paceStr = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
