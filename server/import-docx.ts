// Seed: bestehender Saisonplan (Trainingsplan_KW_10-17.docx, Wochen 0-8) als erste Saison.
// Die Tages-Einheiten sind als Klartext eingebettet; Typ/Sport/km werden heuristisch geparst.
// Schreibt ins AKTIVE Profil (v2-Tabellen).
import { db, initSchema, activeProfile } from "./db.ts";
import { plannedSessionTss } from "./analysis.ts";
import { effectiveZoneSetForSeed } from "./zones.ts";

interface WeekSeed {
  no: number; phase: string; start: string; end: string; target: number; goal?: string; days: string[];
}

const SEASON: WeekSeed[] = [
  { no: 0, phase: "Race", start: "2026-02-23", end: "2026-03-01", target: 65, goal: "5 km Hawei", days: [
    "Krankengymnastik", "VO2max: 5x800 @ Z5 P130''", "6 km E", "6 km E + 2x2' @ 5k RP",
    "Race: 5 km Hawei", "11 km E", "Longrun: 21 km" ] },
  { no: 1, phase: "Belastung", start: "2026-03-02", end: "2026-03-08", target: 70, days: [
    "Rennrad: 90 min @Z1", "T1: 4x6' @ Z4 (90'' jog) (14 km)", "6 km E", "T2: 3x8' @ Z4 (2' jog) (14 km)",
    "Krankengymnastik + 6 km E", "Berg: 10x2' (SHA) (12 km)", "18 km E (AM)" ] },
  { no: 2, phase: "Belastung", start: "2026-03-09", end: "2026-03-15", target: 76, goal: "Race", days: [
    "3x12 min Z2 Rolle (60 min)", "6x4' P2' (14 km)", "Krankengymnastik + 4 km E", "10 km E",
    "4 km E + Abläufe", "10 km Schriesheim", "18 km E (AM)" ] },
  { no: 3, phase: "Belastung", start: "2026-03-16", end: "2026-03-22", target: 82, days: [
    "1 h E Rolle + Stabi", "T2: 10x1000 @ Z4 (1' jog) (16 km)", "Krankengymnastik + 8 km E",
    "Sub T: 3x8' P2' @ max.172 bpm (16 km)", "8 km E", "Berg: 10x500m MTG (16 km)", "20 km E (AM)" ] },
  { no: 4, phase: "Entlastung", start: "2026-03-23", end: "2026-03-29", target: 65, days: [
    "30 min Rolle + Stabi", "2k WU / 6k @ Z3 / 2k CD", "Krankengymnastik + 5 km E",
    "3x8' Sub-Threshold max. 175 bpm", "8 km E", "9 km E", "Longrun 18 km" ] },
  { no: 5, phase: "Belastung 1/2", start: "2026-03-30", end: "2026-04-05", target: 80, days: [
    "8 km E + 20' Stabi", "TWL: 5x(1200/800) (4:00/2:56)", "8 km E", "3x8' Sub-T P2' HR (168-175)",
    "60' Rolle", "10 km E + 40 min Stabi", "Longrun 21 km (last 5 k Steady)" ] },
  { no: 6, phase: "Belastung 2/2", start: "2026-04-06", end: "2026-04-12", target: 88, days: [
    "Rest !!!", "3x(1000-1000-200-200)", "6 km (am) + 6 km (pm) E", "4x8' Sub-T P2' HR (168-172)",
    "10 km", "3x2k (10k effort) P2.5'", "Longrun 18 km E" ] },
  { no: 7, phase: "Race Week", start: "2026-04-13", end: "2026-04-19", target: 60, goal: "10 k Suprema (Mannheim)", days: [
    "8 km E + Strides", "6x400 P2' (76-72 sec)", "60 min Rolle E", "6 km E + Lauf ABC + Strides",
    "45 min Rolle E", "4 km Shake Out + Strides", "10 k Suprema Race (Mannheim)" ] },
  { no: 8, phase: "Gesund werden", start: "2026-04-20", end: "2026-04-26", target: 24, days: [
    "45 min Rolle", "", "6 km Easy", "", "8 km Easy", "", "70 min Rolle + 50 min core Training" ] },  

{ no: 9, phase: "Gesund werden", start: "2026-04-27", end: "2026-05-03", target: 25, days: [
    "45 min Rolle + 15 min mobility", "9 km Easy", "", "", " 11.2 km Wanderung mit Eltern", "7 km Wanderung + 16 km Trail run", "10 km Easy" ] },
];

function parseSport(t: string): string {
  if (/rennrad/i.test(t)) return "BikeRoad";
  if (/rolle/i.test(t)) return "BikeIndoor";
  if (/^rest/i.test(t) || t.trim() === "") return "Rest";
  if (/krankengymnastik/i.test(t) && !/\bkm\b/i.test(t)) return "Physio";
  if (/stabi|athletik/i.test(t) && !/\bkm\b/i.test(t)) return "Strength";
  return "Run";
}

function parseType(t: string): string {
  if (/rest|^$/i.test(t.trim())) return "Rest";
  if (/vo2|x800|x400|6x400|5x800/i.test(t)) return "VO2";
  if (/race|suprema|hawei/i.test(t)) return "Race";
  if (/berg|mtg|sha\b|hill/i.test(t)) return "Hill";
  if (/t1|t2|sub.?t|threshold|schwelle|twl|@ ?z4|x1000|x8'|3x8|4x8|6x4|1200\/800|@ ?z3/i.test(t)) return "Threshold";
  if (/longrun|long/i.test(t)) return "Long";
  if (/krankengymnastik/i.test(t) && !/\bkm\b/i.test(t)) return "Physio";
  if (/stabi|athletik/i.test(t) && !/\bkm\b/i.test(t)) return "Strength";
  if (/rolle|rennrad/i.test(t)) return "Easy";
  return "Easy";
}

function parseKm(t: string): number | null {
  // bevorzugt km in Klammern (Intervall-Gesamt), sonst erstes "NN km"/"NNk"
  const paren = t.match(/\((\d+(?:[.,]\d+)?)\s*k(?:m)?\)/i);
  if (paren) return parseFloat(paren[1].replace(",", "."));
  const all = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*km/gi)].map((m) => parseFloat(m[1].replace(",", ".")));
  if (all.length) return all.reduce((a, b) => a + b, 0);
  const kSuffix = t.match(/(\d+(?:[.,]\d+)?)\s*k\b/i);
  if (kSuffix) return parseFloat(kSuffix[1].replace(",", "."));
  return null;
}

function parseMin(t: string): number | null {
  const min = t.match(/(\d+)\s*min/i);
  if (min) return parseInt(min[1]);
  const h = t.match(/(\d+(?:[.,]\d+)?)\s*h\b/i);
  if (h) return Math.round(parseFloat(h[1].replace(",", ".")) * 60);
  const tick = t.match(/(\d{2,3})'/);
  if (tick && parseInt(tick[1]) >= 30) return parseInt(tick[1]);
  return null;
}

export function seedSeason(): { weeks: number; sessions: number } {
  initSchema();
  let sessions = 0;
  const zs = effectiveZoneSetForSeed();
  const profile = activeProfile();
  for (const w of SEASON) {
    db.prepare(
      `INSERT INTO season_weeks_v2(profile_id, week_no, label, phase, start_date, end_date, target_km, goal_race, notes)
       VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(profile_id, week_no) DO UPDATE SET label=excluded.label, phase=excluded.phase,
         start_date=excluded.start_date, end_date=excluded.end_date, target_km=excluded.target_km, goal_race=excluded.goal_race`,
    ).run(profile, w.no, `Woche ${w.no}`, w.phase, w.start, w.end, w.target, w.goal || "", "");

    // alte geplante Einheiten dieser Woche entfernen (idempotent)
    db.prepare("DELETE FROM planned_sessions WHERE week_no=? AND profile_id=?").run(w.no, profile);
    w.days.forEach((text, i) => {
      if (!text.trim()) return;
      const date = addDays(w.start, i);
      const sport = parseSport(text);
      const type = parseType(text);
      const km = sport.startsWith("Bike") ? null : parseKm(text);
      const min = parseMin(text);
      const tss = plannedSessionTss({ date, sport, type, planned_km: km, planned_min: min, zone_alloc: null }, zs.hr_zones, zs.lthr, zs.pace_zones, undefined, undefined, zs.threshold_pace);
      db.prepare(
        `INSERT INTO planned_sessions(profile_id, date, week_no, sport, type, planned_km, planned_min, zone_alloc, description, planned_tss, sort_order)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(profile, date, w.no, sport, type, km, min, null, text, tss, 0);
      sessions++;
    });
  }
  return { weeks: SEASON.length, sessions };
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// CLI: `npm run seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = seedSeason();
  console.log(`Seed fertig: ${r.weeks} Wochen, ${r.sessions} Einheiten importiert.`);
}
