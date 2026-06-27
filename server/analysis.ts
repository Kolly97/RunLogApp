// Regelbasierte Prüf-Engine: bewertet eine geplante Woche gegen Phase + Verlauf.
import { bikeTssEstimate, hrTssFromZones, rTssFromZones, powerZoneMidWatts, round1, DEFAULT_ZONE_PACE, computePmc, ctlRamp, fitCriticalSpeed, vdot, efficiencyFactor, danielsPaces, predictFromVdot, type HrZone } from "./load.ts";
import { concretizeSession, scheduleWeek, type Availability, type ZonesInput, type PlannedUnit, type Effort, type ConcreteSession } from "./planbuilder.ts";
import { pickWeekWorkouts, renderWorkout, fitnessLevel, workoutById, type WorkoutTemplate } from "./workouts.ts";

// Grobe Durchschnittsgeschwindigkeit fürs Rad (km/h), nur für km->min wenn keine Minuten geplant.
const DEFAULT_BIKE_KMH = 25;

export interface PlannedSession {
  id?: number;
  date: string;
  sport: string;
  type: string;
  planned_km?: number | null;
  planned_min?: number | null;
  planned_tss?: number | null;
  zone_alloc?: { byKm?: Record<number, number>; byMin?: Record<number, number> } | null;
  description?: string | null;
}

export interface Flag {
  level: "ok" | "info" | "warn" | "danger";
  code: string;
  message: string;
  params?: Record<string, string | number | null>;
}

export interface CategoryTotals {
  run: { km: number; min: number };
  bike: { km: number; min: number }; // BikeRoad + BikeIndoor + General (Commute)
  strength: { min: number }; // Strength + Physio, nur Zeit
}

export interface WeekTotals {
  km: number;
  bike_km: number;
  min: number;
  tss: number;
  sessions: number;
  runSessions: number;
  hardSessions: number;
  longestKm: number;
  zoneMin: Record<number, number>;
  intensity: { easy: number; mod: number; hard: number }; // % der Zeit-in-Zone
  byCategory: CategoryTotals; // ToDo 21: geplante Summen je Kategorie
}

const HARD_TYPES = new Set(["Threshold", "VO2", "Race", "Renntempo", "Hill"]);

function isBikeSport(sport?: string | null): boolean {
  return !!sport && sport.startsWith("Bike");
}

/** Geschätzte Dauer einer Einheit in Minuten (geplant, sonst aus km via Pace/Speed). */
function sessionMinutes(s: PlannedSession, paceZones?: number[]): number {
  if (s.planned_min != null) return s.planned_min;
  if (!s.planned_km) return 0;
  if (isBikeSport(s.sport)) return (s.planned_km / DEFAULT_BIKE_KMH) * 60;
  const easyPace = paceZones?.[1] || DEFAULT_ZONE_PACE[1]; // Z2-Pace s/km
  return (s.planned_km * easyPace) / 60;
}

/**
 * Minuten je HF-Zone einer geplanten Einheit — für die Verteilungs-Anzeige.
 * Lauf: Zonen-Allokation (byMin/byKm via pace_zones), sonst Typ-Defaults.
 * Rad: weiterhin grobe Typ-Schätzung; wird aber NICHT mehr für den TSS verwendet
 * (km-Allokationen würden mit Lauf-Pace in absurde Minuten übersetzt).
 */
export function sessionZoneMinutes(s: PlannedSession, zones: HrZone[], paceZones?: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  zones.forEach((z) => (out[z.z] = 0));
  const alloc = s.zone_alloc;
  if (alloc && !isBikeSport(s.sport)) {
    for (const z of zones) {
      let min = alloc.byMin?.[z.z];
      if (min == null && alloc.byKm?.[z.z] != null) {
        const pace = paceZones?.[z.z - 1] || DEFAULT_ZONE_PACE[z.z - 1];
        min = (alloc.byKm[z.z] * pace) / 60;
      }
      out[z.z] += min || 0;
    }
    return out;
  }
  if (alloc?.byMin && isBikeSport(s.sport)) {
    // Minuten-Allokation ist auch fürs Rad verlässlich — nur km-Allokation nicht.
    for (const z of zones) out[z.z] += alloc.byMin[z.z] || 0;
    return out;
  }
  // Keine (verwertbare) Allokation -> grobe Defaults nach Typ
  const min = sessionMinutes(s, paceZones);
  if (s.type === "Easy" || s.type === "Long") out[2] += min;
  else if (s.type === "Threshold") {
    out[2] += min * 0.4;
    out[4] += min * 0.6;
  } else if (s.type === "VO2" || s.type === "Race" || s.type === "Renntempo") {
    out[2] += min * 0.4;
    out[5] += min * 0.6;
  } else if (s.type === "Hill") {
    out[2] += min * 0.5;
    out[4] += min * 0.5;
  } else out[1] += min;
  return out;
}

// Ziel-Power-Zone je Einheitstyp fürs Rad (für Watt-basierten Plan-TSS).
const BIKE_TARGET_ZONE: Record<string, number> = {
  Easy: 2, Long: 2, Threshold: 4, Hill: 4, VO2: 5, Race: 5,
};

/**
 * Watt-basierter Plan-TSS fürs Rad (wenn power_zones gesetzt):
 * IF = Watt-Mittel der Zielzone / FTP, TSS = h * IF^2 * 100.
 * Mit Minuten-Allokation je Zone wird je Zone summiert; sonst Zielzone aus dem Typ.
 * Liefert null, wenn keine Power-Berechnung möglich → Aufrufer fällt auf Typ-IF zurück.
 */
function bikePowerPlannedTss(s: PlannedSession, minutes: number, powerZones?: number[], ftp?: number): number | null {
  if (!powerZones?.length || !ftp || ftp <= 0) return null;
  const byMin = s.zone_alloc?.byMin;
  if (byMin && Object.values(byMin).some((m) => (m || 0) > 0)) {
    let tss = 0;
    for (const [z, m] of Object.entries(byMin)) {
      const watt = powerZoneMidWatts(Number(z), powerZones);
      if (watt == null || !m) continue;
      const ifr = watt / ftp;
      tss += ((m || 0) / 60) * ifr * ifr * 100;
    }
    return round1(tss);
  }
  if (!minutes || minutes <= 0) return null;
  const zone = BIKE_TARGET_ZONE[s.type];
  if (zone == null) return null; // unbekannter Typ / Strength/Physio/Rest → alte Logik
  const watt = powerZoneMidWatts(zone, powerZones);
  if (watt == null) return null;
  const ifr = watt / ftp;
  return round1((minutes / 60) * ifr * ifr * 100);
}

/**
 * Geplanter TSS einer Einheit — sport-bewusst:
 * Rad: bevorzugt Watt-basiert über power_zones (IF = Zonen-Watt/FTP), sonst
 * IF-basiert nach Typ (TSS = h * IF^2 * 100), NICHT über HF-Zonen — die
 * Lauf-HF-Schätzung lieferte für Rad absurde Werte (60 min Easy-Rolle ~100 TSS).
 * Lauf: rTSS per Zone (pace_zones vs. Schwellen-Pace, ToDo v0.9.0); sonst HF-Zonen-Fallback.
 */
export function plannedSessionTss(
  s: PlannedSession,
  zones: HrZone[],
  lthr: number,
  paceZones?: number[],
  powerZones?: number[],
  ftp?: number,
  thresholdPace?: number,
): number {
  if (isBikeSport(s.sport)) {
    const min = sessionMinutes(s, paceZones);
    const powerTss = bikePowerPlannedTss(s, min, powerZones, ftp);
    if (powerTss != null) return powerTss;
    return bikeTssEstimate(min, s.type);
  }
  const zm = sessionZoneMinutes(s, zones, paceZones); // Minuten je Zone (Allokation oder Typ-Schätzung)
  const secondsPerZone: Record<number, number> = {};
  for (const z of zones) secondsPerZone[z.z] = (zm[z.z] || 0) * 60;
  // Lauf → rTSS per Zone (Pace vs. Schwellen-Pace). Ohne Schwellen-Pace: HF-Zonen-Fallback.
  if (s.sport === "Run" && thresholdPace && thresholdPace > 0) return rTssFromZones(secondsPerZone, paceZones, thresholdPace);
  return hrTssFromZones(secondsPerZone, zones, lthr);
}

export function weekTotals(
  sessions: PlannedSession[],
  zones: HrZone[],
  paceZones?: number[],
): WeekTotals {
  const zoneMin: Record<number, number> = {};
  zones.forEach((z) => (zoneMin[z.z] = 0));
  let km = 0,
    bike_km = 0,
    min = 0,
    tss = 0,
    runSessions = 0,
    hardSessions = 0,
    longestKm = 0;
  const byCategory: CategoryTotals = { run: { km: 0, min: 0 }, bike: { km: 0, min: 0 }, strength: { min: 0 } };
  for (const s of sessions) {
    const isRun = s.sport === "Run";
    const isBike = isBikeSport(s.sport);
    if (isRun) {
      km += s.planned_km || 0;
      runSessions++;
      longestKm = Math.max(longestKm, s.planned_km || 0);
      byCategory.run.km += s.planned_km || 0;
      byCategory.run.min += s.planned_min || 0;
    }
    if (isBike) bike_km += s.planned_km || 0;
    if (isBike || s.sport === "General") {
      byCategory.bike.km += s.planned_km || 0;
      byCategory.bike.min += s.planned_min || 0;
    }
    if (s.sport === "Strength" || s.sport === "Physio") byCategory.strength.min += s.planned_min || 0;
    min += s.planned_min || 0;
    tss += s.planned_tss || 0;
    if (HARD_TYPES.has(s.type)) hardSessions++;
    const zm = sessionZoneMinutes(s, zones, paceZones);
    for (const z of zones) zoneMin[z.z] += zm[z.z];
  }
  const totalZ = Object.values(zoneMin).reduce((a, b) => a + b, 0) || 1;
  const easy = ((zoneMin[1] + zoneMin[2]) / totalZ) * 100;
  const mod = (zoneMin[3] / totalZ) * 100;
  const hard = ((zoneMin[4] + zoneMin[5] + zoneMin[6]) / totalZ) * 100;
  return {
    km: r1(km),
    bike_km: r1(bike_km),
    min: r1(min),
    tss: r1(tss),
    sessions: sessions.length,
    runSessions,
    hardSessions,
    longestKm: r1(longestKm),
    zoneMin,
    intensity: { easy: r1(easy), mod: r1(mod), hard: r1(hard) },
    byCategory: {
      run: { km: r1(byCategory.run.km), min: r1(byCategory.run.min) },
      bike: { km: r1(byCategory.bike.km), min: r1(byCategory.bike.min) },
      strength: { min: r1(byCategory.strength.min) },
    },
  };
}

// ---- TSS-basierte Intensität (ToDo #7/#13) ------------------------------

export type IntLevel = "easy" | "moderate" | "hard";

/** Klassifiziert einen Wert relativ zu einer Referenz (%): <=easyPct easy, <hardPct moderate, sonst hard. */
export function classifyTss(value: number, ref: number, easyPct: number, hardPct: number): IntLevel {
  if (!(ref > 0)) return "easy";
  const pct = (value / ref) * 100;
  if (pct >= hardPct) return "hard";
  if (pct > easyPct) return "moderate";
  return "easy";
}

/**
 * Donut: TSS-Anteile (%) je Intensität — Intensität kommt aus dem EINHEITSTYP (easy/moderat/hart),
 * nicht aus der TSS-Größe (sonst würde ein langer ruhiger Lauf wegen hoher TSS „hart"). TSS ist nur
 * das Gewicht: Anteil = Σ TSS der Klasse / Σ TSS. `typeIntensity` mappt Typ → Klasse (aus den Optionen).
 */
export function typeIntensityShares(
  sessions: PlannedSession[], typeIntensity: (type: string) => IntLevel,
): { easy: number; mod: number; hard: number } {
  const acc = { easy: 0, mod: 0, hard: 0 };
  let total = 0;
  for (const s of sessions) {
    if (s.type === "Rest") continue;
    const t = s.planned_tss || 0;
    if (t <= 0) continue;
    total += t;
    const c = typeIntensity(s.type);
    if (c === "hard") acc.hard += t;
    else if (c === "moderate") acc.mod += t;
    else acc.easy += t;
  }
  if (total <= 0) return { easy: 0, mod: 0, hard: 0 };
  return { easy: r1((acc.easy / total) * 100), mod: r1((acc.mod / total) * 100), hard: r1((acc.hard / total) * 100) };
}

/** Wochen-Bewertung: Wochen-TSS vs. Ø-Wochen-TSS der letzten 4 Wochen. */
export function weekRatingLevel(weekTss: number, refWeekly: number, easyPct: number, hardPct: number) {
  return { level: classifyTss(weekTss, refWeekly, easyPct, hardPct), weekTss: r1(weekTss), avg4: r1(refWeekly) };
}

/** Wochen-TSS-Last als Flag für den Wochen-Check (ToDo Z.41: aus der Intensitäts-Karte hierher verschoben). */
export function weekLoadFlag(rating: { level: IntLevel; weekTss: number; avg4: number } | null): Flag | null {
  if (!rating) return null;
  const w = Math.round(rating.weekTss), a = Math.round(rating.avg4);
  if (rating.level === "hard") return { level: "warn", code: "week_load_high", message: `Wochen-Last hoch: ${w} TSS vs. Ø ${a} (letzte 4 Wo).`, params: { w, a } };
  if (rating.level === "easy") return { level: "info", code: "week_load_low", message: `Wochen-Last niedrig: ${w} TSS vs. Ø ${a} (letzte 4 Wo).`, params: { w, a } };
  return { level: "ok", code: "week_load_ok", message: `Wochen-Last moderat: ${w} TSS vs. Ø ${a} (letzte 4 Wo).`, params: { w, a } };
}

/**
 * TSS-Wochenempfehlung (v0.15.0, O4): Korridor aus aktueller Fitness (CTL) + Saisonplan-Phase.
 * Erhalt ≈ CTL×7 (täglicher EWMA → wöchentliche Last zum Halten). Phase steuert den Faktor und
 * setzt das 3:1-Prinzip um (Entlastung -40 %, Race Week Taper, Aufbau +5–7 CTL/Woche, krank reduziert).
 */
export type TssRec = { min: number; max: number; target: number; kind: string };
export function tssRecommendation(ctl: number, phase: string | null | undefined): TssRec {
  const base = Math.max(0, ctl) * 7; // Wochen-TSS zum Halten der CTL
  const p = (phase || "").toLowerCase();
  let lo: number, hi: number, kind: string;
  if (p.includes("entlast")) { lo = base * 0.55; hi = base * 0.65; kind = "Entlastung"; }
  else if (p.includes("race week") || p.includes("race-week") || p.includes("raceweek")) { lo = base * 0.45; hi = base * 0.55; kind = "Taper"; }
  else if (p.includes("krank")) { lo = 0; hi = base * 0.4; kind = "Reduziert"; }
  else if (p.includes("belast") || p.includes("base") || p.includes("specific") || p.includes("aufbau")) { lo = (Math.max(0, ctl) + 5) * 7; hi = (Math.max(0, ctl) + 7) * 7; kind = "Aufbau"; }
  else { lo = base * 0.95; hi = base * 1.05; kind = "Erhalt"; }
  const min = Math.round(lo / 5) * 5;
  const max = Math.round(hi / 5) * 5;
  return { min, max, target: Math.round((min + max) / 2), kind };
}

/** km-Polarisierung (Easy/Grey/Hart) als Flag für den Wochen-Check (ToDo Z.41). */
export function kmPolarizationFlag(zk: { easy: number; mod: number; hard: number } | null): Flag | null {
  if (!zk) return null;
  const e = Math.round(zk.easy), m = Math.round(zk.mod), h = Math.round(zk.hard);
  const note = `${e}/${m}/${h}% easy/grey/hart`;
  if (zk.mod >= 18) return { level: "info", code: "km_grey", message: `km-Polarisierung: viel Grey-Zone (${m}% Z3) — ${note}.`, params: { e, m, h } };
  if (zk.hard >= 25) return { level: "warn", code: "km_hard", message: `km-Polarisierung: sehr hart (${h}% > Z3) — ${note}.`, params: { e, m, h } };
  if (zk.easy >= 78 && zk.hard <= 22) return { level: "ok", code: "km_polarized", message: `km-Polarisierung: polarisiert — ${note}.`, params: { e, m, h } };
  return { level: "info", code: "km_balanced", message: `km-Polarisierung: ausgewogen — ${note}.`, params: { e, m, h } };
}

// ---- Echte Intensitätsverteilung (G4, v1.3.0): Zeit-in-Zone gegen LT1/LT2 + Polarisierungs-Index ----

export interface PhysioDist { z1: number; z2: number; z3: number; z1Min: number; z2Min: number; z3Min: number }

/**
 * Physiologische 3-Zonen-Verteilung als ZEIT-in-Zone (Seiler): Z1 < LT1, Z2 = LT1–LT2, Z3 > LT2.
 * Mappt die vorhandenen HF-Zonen-Minuten (`zoneMin`) anhand der Zonen-Mitte gegen die LT1/LT2-HF —
 * keine Roh-Stream-Neuberechnung nötig. Bei null Last → alle 0. Grenzen sind kalibrierbar (G3 füllt LT1).
 */
export function physioTimeZones(zoneMin: Record<number, number>, hrZones: HrZone[], lt1Hr: number, lt2Hr: number): PhysioDist {
  let z1 = 0, z2 = 0, z3 = 0;
  for (const z of hrZones) {
    const min = zoneMin[z.z] || 0;
    if (min <= 0) continue;
    const mid = (z.min + (z.max || z.min)) / 2; // repräsentative HF der Zone
    if (mid < lt1Hr) z1 += min;
    else if (mid < lt2Hr) z2 += min;
    else z3 += min;
  }
  const tot = z1 + z2 + z3;
  if (tot <= 0) return { z1: 0, z2: 0, z3: 0, z1Min: 0, z2Min: 0, z3Min: 0 };
  return {
    z1: r1((z1 / tot) * 100), z2: r1((z2 / tot) * 100), z3: r1((z3 / tot) * 100),
    z1Min: r1(z1), z2Min: r1(z2), z3Min: r1(z3),
  };
}

/**
 * Polarisierungs-Index (Treff et al. 2019): PI = log10( (Z1/Z2) × Z3 ), Z* = %-Zeit. PI ≥ 2.0 = polarisiert.
 * Guards: ohne harten Anteil (Z3≈0) oder ohne easy (Z1≈0) nicht definiert → null; Z2<1 % auf 1 gekappt.
 */
export function polarizationIndex(z1: number, z2: number, z3: number): number | null {
  if (z3 <= 0 || z1 <= 0) return null;
  const z2c = z2 < 1 ? 1 : z2;
  return Math.round(Math.log10((z1 / z2c) * z3) * 100) / 100;
}

export interface DistTarget { model: "pyramidal" | "polarized" | "regenerativ"; z1: number; z2: number; z3: number; label: string }

/** Verteilungs-Ziel je Saison-Phase (advisory): Base/Belastung pyramidal, Race Specific polarisiert, Entlastung/Taper regenerativ. */
export function phaseDistributionTarget(phase: string | null | undefined): DistTarget {
  const p = (phase || "").toLowerCase();
  if (p.includes("specific")) return { model: "polarized", z1: 78, z2: 4, z3: 18, label: "polarisiert" };
  if (p.includes("entlast") || p.includes("deload") || p.includes("race week") || p.includes("raceweek") || p.includes("race-week") || p.includes("krank"))
    return { model: "regenerativ", z1: 90, z2: 7, z3: 3, label: "regenerativ (Z1-lastig)" };
  return { model: "pyramidal", z1: 80, z2: 15, z3: 5, label: "pyramidal" };
}

/** Schild für die reale Zeit-Verteilung: Ist vs. Phasen-Ziel + Polarisierungs-Index. */
export function polarizationFlag(dist: PhysioDist | null, target: DistTarget, pi: number | null): Flag | null {
  if (!dist || (dist.z1 + dist.z2 + dist.z3) <= 0) return null;
  const a = Math.round(dist.z1), b = Math.round(dist.z2), c = Math.round(dist.z3);
  const piTxt = pi != null ? `PI ${pi}` : "PI n/a";
  const note = `${a}/${b}/${c}% Z1/Z2/Z3 · ${piTxt} · Ziel ${target.label} ${target.z1}/${target.z2}/${target.z3}`;
  const params = { a, b, c, pi };
  if (b >= target.z2 + 12) return { level: "info", code: "pol_grey", message: `Zeit-Verteilung: viel Grey-Zone (Z2 ${b}%) — ${note}.`, params };
  if (c >= target.z3 + 12) return { level: "warn", code: "pol_hard", message: `Zeit-Verteilung: hoher harter Anteil (Z3 ${c}%) — ${note}.`, params };
  if (target.model === "polarized" && pi != null && pi >= 2.0) return { level: "ok", code: "pol_polarized", message: `Zeit-Verteilung: polarisiert (PI ${pi}) — ${note}.`, params };
  return { level: "ok", code: "pol_ontarget", message: `Zeit-Verteilung nahe Phasen-Ziel — ${note}.`, params };
}

// ===================== Block N (v1.6.0) — Methoden-Findung (N-of-1) =====================
// Marker-Batterie + Vorher/Nachher-Vergleich. Pure: die Route holt die Daten (activities-Fenster, Zonen,
// Laktat-Tests) und ruft markerSnapshot/compareMarkers. Maximal aus vorhandener Mathe wiederverwendet
// (fitCriticalSpeed/vdot/effectiveVo2max/efficiencyFactor/physioTimeZones/polarizationIndex).

/** Aktivität, reduziert auf die für die Marker-Batterie nötigen Felder (Route füllt sie). */
export interface MarkerActivity {
  date: string;
  sport: string;
  type?: string | null;
  best_efforts?: Record<string, number> | null; // distance_m -> time_s (Strava-Bestleistungen)
  ngp?: number | null;        // grade-adjusted Pace s/km
  avg_hr?: number | null;
  decoupling?: number | null; // %
  eff_vo2max?: number | null;
  zoneMin?: Record<number, number> | null; // HF-Zonen-Minuten dieser Einheit
}

/** Schwellen-/Zonen-Kontext (aus effectiveZoneSet) für die Marker-Batterie. */
export interface MarkerZones { hr_zones: HrZone[]; threshold_pace: number; lthr: number; lt1_hr: number }

/** Laktat-Feldtest reduziert auf Datum + Stufenpunkte (für Laktat-an-Pace). */
export interface MarkerLactateTest { date: string; points: { pace_s?: number | null; speed_kmh?: number | null; lactate: number }[] }

export interface Markers {
  date: string; windowDays: number; n: number;
  csPace: number | null; csConfidence: "hoch" | "mittel" | "niedrig" | null;
  vdot: number | null;
  thresholdPace: number | null; thresholdHr: number | null;
  decoupling: number | null;
  submaxEf: number | null;
  effVo2max: number | null;
  lactateAtPace: number | null; // mmol bei thresholdPace, aus nächstem Feldtest interpoliert
  pi: number | null;
  dist: PhysioDist | null;
}

function meanRound(xs: number[], dp: number): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const f = Math.pow(10, dp);
  return Math.round(m * f) / f;
}
function daysBetweenIso(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

/** Blut-Laktat (mmol) an einer Referenz-Pace aus dem nächstgelegenen Stufentest, linear interpoliert (keine Extrapolation). */
function lactateAtReferencePace(tests: MarkerLactateTest[], endDate: string, refPaceS: number | null): number | null {
  if (!refPaceS || !tests.length) return null;
  const sorted = [...tests].filter((t) => t.points && t.points.length >= 2)
    .sort((a, b) => Math.abs(daysBetweenIso(a.date, endDate)) - Math.abs(daysBetweenIso(b.date, endDate)));
  const t = sorted[0];
  if (!t) return null;
  const pts = t.points
    .map((p) => ({ pace: p.pace_s && p.pace_s > 0 ? p.pace_s : p.speed_kmh && p.speed_kmh > 0 ? 3600 / p.speed_kmh : null, lac: p.lactate }))
    .filter((p): p is { pace: number; lac: number } => p.pace != null && p.lac != null)
    .sort((a, b) => b.pace - a.pace); // langsam -> schnell (Pace s/km absteigend)
  if (pts.length < 2) return null;
  for (let i = 0; i < pts.length - 1; i++) {
    const hi = pts[i], lo = pts[i + 1]; // hi.pace > lo.pace
    if (refPaceS <= hi.pace && refPaceS >= lo.pace) {
      const f = (hi.pace - refPaceS) / (hi.pace - lo.pace || 1);
      return Math.round((hi.lac + f * (lo.lac - hi.lac)) * 100) / 100;
    }
  }
  return null; // Referenz-Pace außerhalb der getesteten Spanne → nicht extrapolieren
}

/**
 * Marker-Batterie für einen Stichtag über ein Rückblick-Fenster (Default 14 Tage). Alle Marker null-tolerant
 * (dünne Historik → Strava-Backfill füllt nach). Primär-Marker fürs Verdikt ist die Critical Speed (csPace).
 */
export function markerSnapshot(args: {
  endDate: string; windowDays: number;
  activities: MarkerActivity[]; // bereits aufs Fenster [endDate-windowDays, endDate] gefiltert
  zones: MarkerZones;
  lactateTests?: MarkerLactateTest[];
}): Markers {
  const { endDate, windowDays, zones } = args;
  const runs = args.activities.filter((a) => /run/i.test(a.sport));

  // ---- CS + VDOT aus aggregierten Bestleistungen im Fenster ----
  const bestByDist = new Map<number, number>(); // distance_m -> bestes (kleinstes) time_s
  for (const a of runs) {
    if (!a.best_efforts) continue;
    for (const [dStr, tRaw] of Object.entries(a.best_efforts)) {
      const d = Number(dStr), t = Number(tRaw);
      if (!(d > 0) || !(t > 0)) continue;
      const cur = bestByDist.get(d);
      if (cur == null || t < cur) bestByDist.set(d, t);
    }
  }
  const allPts = [...bestByDist.entries()].map(([d, t]) => ({ distance_m: d, time_s: t }));
  const csPts = allPts.filter((p) => p.time_s >= 120 && p.time_s <= 1800); // aerobe Efforts 2–30 min (wie /api/bests)
  const cs = fitCriticalSpeed(csPts);
  let csConfidence: Markers["csConfidence"] = null;
  if (cs) {
    csConfidence = cs.n >= 4 && (cs.rSquared ?? 0) >= 0.99 ? "hoch"
      : cs.n >= 3 && (cs.rSquared ?? 0) >= 0.95 ? "mittel" : "niedrig";
  }
  let vd = 0;
  for (const p of allPts) {
    if (p.distance_m >= 1500 && p.time_s >= 180 && p.time_s <= 2400) {
      const v = vdot(p.distance_m, p.time_s);
      if (v > vd) vd = v;
    }
  }

  // ---- Submax-EF (Easy/Long) + Ø Decoupling + Ø Effective VO2max ----
  const efVals: number[] = [];
  for (const a of runs) {
    const ty = (a.type || "").toLowerCase();
    if (ty.includes("easy") || ty.includes("long")) {
      const ef = efficiencyFactor(a.ngp, a.avg_hr);
      if (ef != null) efVals.push(ef);
    }
  }
  const submaxEf = efVals.length ? meanRound(efVals, 3) : null;
  const decVals = runs.map((a) => a.decoupling).filter((x): x is number => x != null);
  const decoupling = decVals.length ? meanRound(decVals, 1) : null;
  const evVals = runs.map((a) => a.eff_vo2max).filter((x): x is number => x != null);
  const effVo2max = evVals.length ? meanRound(evVals, 1) : null;

  // ---- PI + Zeit-Verteilung über aggregierte HF-Zonen-Minuten ----
  const aggZone: Record<number, number> = {};
  for (const a of runs) {
    if (!a.zoneMin) continue;
    for (const [z, m] of Object.entries(a.zoneMin)) aggZone[Number(z)] = (aggZone[Number(z)] || 0) + (Number(m) || 0);
  }
  const dist = Object.keys(aggZone).length ? physioTimeZones(aggZone, zones.hr_zones, zones.lt1_hr, zones.lthr) : null;
  const pi = dist ? polarizationIndex(dist.z1, dist.z2, dist.z3) : null;

  const thresholdPace = zones.threshold_pace > 0 ? zones.threshold_pace : null;
  const lactateAtPace = lactateAtReferencePace(args.lactateTests || [], endDate, thresholdPace);

  return {
    date: endDate, windowDays, n: runs.length,
    csPace: cs?.cs_pace_s ?? null, csConfidence,
    vdot: vd > 0 ? round1(vd) : null,
    thresholdPace, thresholdHr: zones.lthr > 0 ? zones.lthr : null,
    decoupling, submaxEf, effVo2max, lactateAtPace, pi, dist,
  };
}

export interface MarkerDelta {
  key: string; label: string; unit: string;
  start: number | null; end: number | null; delta: number | null;
  direction: "besser" | "flach" | "schlechter" | null; // null = informativ/nicht bewertbar
}
export interface MethodEvaluation {
  primary: "csPace";
  verdict: "besser" | "flach" | "schlechter" | "unklar";
  confidence: "hoch" | "mittel" | "niedrig";
  exploratory: boolean;
  deltas: MarkerDelta[];
  note: string;
}

// Marker-Spezifikation: MCID (minimal bedeutsame Änderung gegen Tagesrauschen), Richtung, ob verdikt-relevant.
// Quellen: Test-Retest-Variabilität CS/VDOT (~1 %), EF-Drift, Laktat-Messrauschen. Richtungsbewusst.
const MARKER_SPEC: { key: keyof Markers; label: string; unit: string; mcid: number; relMcid?: number; lowerBetter: boolean; scored: boolean }[] = [
  { key: "csPace", label: "Critical Speed", unit: "s/km", mcid: 1.5, lowerBetter: true, scored: true },
  { key: "vdot", label: "VDOT", unit: "", mcid: 0.5, lowerBetter: false, scored: true },
  { key: "thresholdPace", label: "Threshold-Pace", unit: "s/km", mcid: 2, lowerBetter: true, scored: true },
  { key: "thresholdHr", label: "Threshold-HF", unit: "bpm", mcid: 3, lowerBetter: false, scored: false },
  { key: "decoupling", label: "Aerobe Entkopplung", unit: "%", mcid: 1.5, lowerBetter: true, scored: true },
  { key: "submaxEf", label: "Submax-EF", unit: "m/min/bpm", mcid: 0, relMcid: 0.02, lowerBetter: false, scored: true },
  { key: "effVo2max", label: "Effective VO2max", unit: "", mcid: 1.0, lowerBetter: false, scored: true },
  { key: "lactateAtPace", label: "Laktat @ Schwellen-Pace", unit: "mmol", mcid: 0.3, lowerBetter: true, scored: true },
  { key: "pi", label: "Polarisierungs-Index", unit: "", mcid: 0.3, lowerBetter: false, scored: false },
];

/** Vorher/Nachher-Vergleich zweier Snapshots → Marker-Deltas + Verdikt (Primär = CS) + Konfidenz (n + Konsistenz). */
export function compareMarkers(start: Markers, end: Markers): MethodEvaluation {
  const deltas: MarkerDelta[] = [];
  for (const spec of MARKER_SPEC) {
    const s = start[spec.key] as number | null;
    const e = end[spec.key] as number | null;
    let delta: number | null = null;
    let direction: MarkerDelta["direction"] = null;
    if (typeof s === "number" && typeof e === "number") {
      delta = Math.round((e - s) * 100) / 100;
      if (spec.scored) {
        const mcid = spec.relMcid ? Math.max(spec.mcid, spec.relMcid * Math.abs(s)) : spec.mcid;
        const improve = spec.lowerBetter ? s - e : e - s; // >0 = besser
        direction = improve > mcid ? "besser" : improve < -mcid ? "schlechter" : "flach";
      }
    }
    deltas.push({ key: spec.key, label: spec.label, unit: spec.unit, start: s, end: e, delta, direction });
  }
  const cs = deltas.find((d) => d.key === "csPace")!;
  const minN = Math.min(start.n, end.n);
  const exploratory = minN < 4 || cs.direction == null;
  const scored = deltas.filter((d) => d.direction);
  let verdict: MethodEvaluation["verdict"];
  if (cs.direction) verdict = cs.direction;
  else {
    const up = scored.filter((d) => d.direction === "besser").length;
    const down = scored.filter((d) => d.direction === "schlechter").length;
    verdict = up > down ? "besser" : down > up ? "schlechter" : scored.length ? "flach" : "unklar";
  }
  const agree = scored.filter((d) => d.direction === verdict).length;
  const consistency = scored.length ? agree / scored.length : 0;
  let confidence: MethodEvaluation["confidence"] = "niedrig";
  if (!exploratory && minN >= 8 && consistency >= 0.6) confidence = "hoch";
  else if (!exploratory && minN >= 4 && consistency >= 0.5) confidence = "mittel";
  const note = exploratory
    ? `Explorativ (n=${minN} Läufe je Fenster${cs.direction == null ? ", CS fehlt" : ""}) — Trend, kein belastbares Urteil.`
    : `Primär-Marker Critical Speed; ${agree}/${scored.length} bewertbare Marker stützen das Urteil. Korrelation, nicht Kausalität.`;
  return { primary: "csPace", verdict, confidence, exploratory, deltas, note };
}

// ---- Passive Inferenz: Wochen nach Regime bucketn → vorwärtsgerichtete Marker-Reaktion ranken ----

export type Regime = "polarized" | "pyramidal" | "threshold" | "norwegian" | "mixed";

export interface WeekRegimeInput {
  week_no: number;
  start_date: string;
  phase?: string | null;
  dist: PhysioDist | null;     // Zeit-Verteilung der Woche
  pi: number | null;
  ctl: number | null;          // CTL am Wochenstart (für CTL-Band-Confounder-Kontrolle)
  sessions: { type: string; subThreshold?: boolean }[]; // getrackte Qualitäts-Einheiten der Woche
  doubleThresholdDays: number; // Tage mit ≥2 Schwellen-Einheiten (Norwegian-Erkennung)
  excluded: boolean;           // Krank/Taper/Race → aus Inferenz raus
  csPace: number | null;       // Marker am Wochenende (Rolling)
  vdot: number | null;
}

/**
 * Regime einer Woche aus Verteilung (PI/Zeit-in-Zone) UND Session-Struktur (Q5). Norwegian = Doppel-Schwellen-
 * Tag oder ≥3 Sub-LT2-Schwellen-Einheiten; polarisiert = PI≥2 mit wenig Grey-Zone; threshold = ≥2 Schwellen +
 * spürbare Z2; pyramidal = substanzielle Z2 ohne Schwellen-Dominanz; sonst mixed.
 */
export function classifyWeekRegime(w: WeekRegimeInput): Regime {
  const thr = w.sessions.filter((s) => s.subThreshold || /threshold|lt2|sub|tempo|schwelle/i.test(s.type)).length;
  const z2 = w.dist?.z2 ?? null;
  if (w.doubleThresholdDays >= 1 || thr >= 3) return "norwegian";
  if (w.pi != null && w.pi >= 2.0 && (z2 == null || z2 < 12)) return "polarized";
  if (thr >= 2 && (z2 == null || z2 >= 12)) return "threshold";
  if (z2 != null && z2 >= 12) return "pyramidal";
  if (w.pi != null && w.pi >= 1.5) return "polarized";
  return "mixed";
}

export interface RegimeStat {
  regime: Regime;
  nWeeks: number;            // verwendbare Regime-Wochen (mit gültigem Forward-Paar)
  csChange: number | null;   // Ø CS-Pace-Veränderung über Lag (s/km, negativ = schneller = besser)
  vdotChange: number | null; // Ø VDOT-Veränderung (positiv = besser)
  confidence: "hoch" | "mittel" | "niedrig";
  fromDate: string | null;   // v1.10.0: Spanne der Wochen dieses Regimes (von)
  toDate: string | null;     // … bis (Ende der letzten Woche)
}
export interface MethodInferenceResult {
  regimes: RegimeStat[];
  best: Regime | null;       // null wenn keine belastbare Aussage
  lagWeeks: number;
  note: string;
  confidence: "hoch" | "mittel" | "niedrig";
}

const REGIME_LABEL: Record<Regime, string> = {
  polarized: "polarisiert", pyramidal: "pyramidal", threshold: "Threshold", norwegian: "Norwegian Double-Threshold", mixed: "gemischt",
};

function weekAtLag(sorted: WeekRegimeInput[], i: number, lagWeeks: number): WeekRegimeInput | null {
  const target = addDaysIsoLocal(sorted[i].start_date, lagWeeks * 7);
  for (let j = i + 1; j < sorted.length; j++) {
    const d = Math.abs(daysBetweenIso(sorted[j].start_date, target));
    if (d <= 3) return sorted[j];
    if (daysBetweenIso(target, sorted[j].start_date) > 3) break; // schon über dem Ziel
  }
  return null;
}

/**
 * Passive Methoden-Inferenz: jedes Wochen-Regime gegen seine Marker-Reaktion über `lagWeeks` (Default 3, also
 * 2–4) Folgewochen. Strenge Confounder-Kontrolle (Q4): Krank/Taper/Race-Wochen raus; nur Paare mit annähernd
 * stabiler CTL über das Lag (|ΔCTL| ≤ ctlBand) — so wird die Marker-Änderung dem Regime und nicht einem
 * Last-Sprung zugeschrieben. Ausgabe advisory: Korrelation, nicht Kausalität; kleine n sichtbar.
 */
export function methodInference(weeks: WeekRegimeInput[], opts?: { lagWeeks?: number; ctlBand?: number }): MethodInferenceResult {
  const lagWeeks = opts?.lagWeeks ?? 3;
  const ctlBand = opts?.ctlBand ?? 8;
  const sorted = [...weeks].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const buckets = new Map<Regime, { cs: number[]; vd: number[]; dates: string[] }>();
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i];
    if (w.excluded) continue;
    const later = weekAtLag(sorted, i, lagWeeks);
    if (!later || later.excluded) continue;
    // CTL-Band-Confounder-Kontrolle: nur Paare mit stabiler Last.
    if (w.ctl != null && later.ctl != null && Math.abs(later.ctl - w.ctl) > ctlBand) continue;
    const regime = classifyWeekRegime(w);
    const b = buckets.get(regime) ?? { cs: [], vd: [], dates: [] };
    if (w.csPace != null && later.csPace != null) b.cs.push(later.csPace - w.csPace);
    if (w.vdot != null && later.vdot != null) b.vd.push(later.vdot - w.vdot);
    b.dates.push(w.start_date);
    buckets.set(regime, b);
  }
  const regimes: RegimeStat[] = [];
  for (const [regime, b] of buckets) {
    const nWeeks = Math.max(b.cs.length, b.vd.length);
    if (nWeeks === 0) continue;
    const confidence: RegimeStat["confidence"] = nWeeks >= 6 ? "hoch" : nWeeks >= 4 ? "mittel" : "niedrig";
    const ds = [...b.dates].sort();
    regimes.push({
      regime, nWeeks,
      csChange: b.cs.length ? meanRound(b.cs, 1) : null,
      vdotChange: b.vd.length ? meanRound(b.vd, 1) : null,
      confidence,
      fromDate: ds[0] ?? null,
      toDate: ds.length ? addDaysIsoLocal(ds[ds.length - 1], 6) : null,
    });
  }
  // Ranken nach CS-Reaktion (negativ = schneller = besser); nur Regimes mit CS-Signal werten.
  const ranked = regimes.filter((r) => r.csChange != null).sort((a, b) => (a.csChange! - b.csChange!));
  regimes.sort((a, b) => (a.csChange ?? 999) - (b.csChange ?? 999));
  // „Best" nur, wenn ≥4 Regime-Wochen (Q6) und tatsächlich eine Verbesserung (negativ).
  const top = ranked[0];
  const best = top && top.nWeeks >= 4 && (top.csChange ?? 0) < -1.5 ? top.regime : null;
  const overallConf: MethodInferenceResult["confidence"] = best && top.nWeeks >= 6 ? "hoch" : best ? "mittel" : "niedrig";
  let note: string;
  if (!ranked.length) {
    note = "Noch zu wenig vergleichbare Daten (nach Confounder-Filter) für eine Methoden-Aussage.";
  } else if (best) {
    const runner = ranked[1];
    const csTxt = (v: number) => `${v <= 0 ? "" : "+"}${v} s/km CS`;
    note = `Bei dir korrelierte ${REGIME_LABEL[best]} mit ${csTxt(top.csChange!)} (n=${top.nWeeks} Wochen, ${lagWeeks}-Wochen-Lag)` +
      (runner ? `; ${REGIME_LABEL[runner.regime]} ${csTxt(runner.csChange!)} (n=${runner.nWeeks})` : "") +
      ". Korrelation, nicht Kausalität — kleine n beachten.";
  } else {
    note = `Trend, aber (noch) nicht belastbar: bestes Regime ${REGIME_LABEL[top.regime]} (${top.csChange} s/km CS, n=${top.nWeeks}). Mehr Wochen/Daten nötig.`;
  }
  return { regimes, best, lagWeeks, note, confidence: overallConf };
}

/** Kanonische Zeit-Verteilung je Regime (für den advisory N-of-1-Nudge in weekStructureRecommendation). */
function regimeDistTarget(regime: Regime): { z1: number; z2: number; z3: number; label: string } | null {
  switch (regime) {
    case "polarized": return { z1: 80, z2: 5, z3: 15, label: "polarisiert" };
    case "pyramidal": return { z1: 80, z2: 15, z3: 5, label: "pyramidal" };
    case "threshold":
    case "norwegian": return { z1: 75, z2: 22, z3: 3, label: "threshold-betont" };
    default: return null;
  }
}

/**
 * Trainings-Monotonie & -Strain (Foster, v1.2.0): `Monotonie = Ø(Tageslast)/SD(Tageslast)`,
 * `Strain = Wochenlast × Monotonie`. Hohe Monotonie bei hoher Last → mehr Infekte/Übertraining.
 * Erwartet die Tageslast (TSS) ALLER Tage der Woche inkl. Ruhetage (0) — die Nullen erzeugen die Varianz.
 */
export function trainingMonotonyStrain(dailyTss: number[]): { monotony: number; strain: number; weekTss: number; flag: Flag | null } {
  const n = dailyTss.length || 1;
  const weekTss = dailyTss.reduce((a, b) => a + (b || 0), 0);
  const mean = weekTss / n;
  const variance = dailyTss.reduce((a, b) => a + ((b || 0) - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  // SD≈0 (alle Tage gleich belastet) → maximale Monotonie; ohne Last → 0.
  const monotony = sd > 0.01 ? mean / sd : (mean > 0 ? 3 : 0);
  const m = Math.round(monotony * 100) / 100;
  const strain = Math.round(weekTss * monotony);
  let flag: Flag | null = null;
  if (weekTss > 0) {
    if (monotony >= 2.0) flag = { level: "warn", code: "monotony_high", message: `Monotonie hoch (${m}) — wenig Variation, Strain ${strain}; Erholungstage einbauen.`, params: { m, strain } };
    else if (monotony >= 1.5) flag = { level: "info", code: "monotony_mid", message: `Monotonie erhöht (${m}) — auf Erholungstage achten.`, params: { m, strain } };
    else flag = { level: "ok", code: "monotony_ok", message: `Monotonie ausgewogen (${m}).`, params: { m, strain } };
  }
  return { monotony: m, strain, weekTss: Math.round(weekTss), flag };
}

// ---- Intelligenz-Layer (v1.2.0): Readiness + regelbasierte Tages-Empfehlung ----

export type ReadinessLevel = "green" | "yellow" | "red";
export interface Readiness {
  score: number; // 0–100
  level: ReadinessLevel;
  drivers: { code: string; text: string }[];
}

/**
 * Readiness-Score (v1.2.0, advisory): HRV-Tageswert gegen rollende 7-Tage-Baseline (z-Score) als Kern,
 * plus Recovery (Whoop) / Schlaf / Muskelkater als Modifikatoren. Evidenz: HRV-gesteuert ≥ feste Pläne
 * (Kiviniemi; weniger unnötiges HIIT, weniger Negativ-Responder). Liefert null bei zu wenig Daten.
 */
export function readinessScore(args: {
  hrvToday: number | null;
  hrvBaseline: { mean: number; sd: number } | null;
  recovery: number | null; // 0–100 (Whoop)
  soreness: number | null;  // 0–10 (höher = schlechter)
  sleepH: number | null;
}): Readiness | null {
  const hasHrv = args.hrvToday != null && args.hrvBaseline != null && args.hrvBaseline.sd > 0.01;
  const hasRecovery = args.recovery != null;
  if (!hasHrv && !hasRecovery) return null; // ohne HRV-Baseline und ohne Recovery keine Aussage
  const drivers: { code: string; text: string }[] = [];
  let score = 70; // neutrale Basis
  if (hasHrv) {
    const z = (args.hrvToday! - args.hrvBaseline!.mean) / args.hrvBaseline!.sd;
    score += Math.max(-30, Math.min(20, z * 15));
    if (z <= -1) drivers.push({ code: "hrv_low", text: `HRV deutlich unter Baseline (z ${z.toFixed(1)})` });
    else if (z >= 0.5) drivers.push({ code: "hrv_high", text: `HRV über Baseline` });
  }
  if (hasRecovery) {
    score = hasHrv ? score * 0.6 + args.recovery! * 0.4 : args.recovery!; // ohne HRV trägt Recovery allein
    if (args.recovery! < 50) drivers.push({ code: "recovery_low", text: `Recovery ${Math.round(args.recovery!)} %` });
  }
  if (args.soreness != null && args.soreness >= 6) { score -= 10; drivers.push({ code: "soreness", text: `Muskelkater ${args.soreness}/10` }); }
  if (args.sleepH != null && args.sleepH < 6) { score -= 8; drivers.push({ code: "sleep_low", text: `Schlaf ${args.sleepH} h` }); }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const level: ReadinessLevel = score >= 67 ? "green" : score >= 40 ? "yellow" : "red";
  return { score, level, drivers };
}

export interface DailyRec {
  headline: string;
  sessionType: string;
  doseHint: string;
  reasons: { code: string; text: string }[];
  confidence: "hoch" | "mittel" | "niedrig";
}

/**
 * Regelbasierte Tages-Empfehlung (v1.2.0, Vorschlag-Modus): Decision-Tree aus Form (TSB/CTL-Ramp),
 * Readiness, Saison-Phase und Wochen-TSS-Ziel. Vollständig erklärbar (reasons), keine Black-Box.
 */
export function dailyRecommendation(args: {
  tsb: number | null;
  ctlRamp: number | null;
  phase: string | null | undefined;
  readinessLevel: ReadinessLevel | null;
  weekTssRec: TssRec | null;
  plannedTypes: string[];
}): DailyRec {
  const reasons: { code: string; text: string }[] = [];
  const p = (args.phase || "").toLowerCase();
  let sessionType = "Easy";
  let headline: string;
  let confidence: DailyRec["confidence"] = "mittel";

  if (args.readinessLevel === "red") {
    sessionType = "Easy"; headline = "Erholung — locker oder Ruhetag";
    reasons.push({ code: "readiness_red", text: "Readiness niedrig → heute regenerieren statt belasten" });
    confidence = "hoch";
  } else if (p.includes("race week") || p.includes("raceweek") || p.includes("race-week")) {
    sessionType = "Easy"; headline = "Taper — kurz & locker (ggf. ein paar Steigerungen)";
    reasons.push({ code: "race_week", text: "Race Week → Frische aufbauen, Last reduzieren" });
  } else if (p.includes("entlast") || p.includes("deload")) {
    sessionType = "Easy"; headline = "Entlastungswoche — locker halten";
    reasons.push({ code: "deload", text: "Entlastungsphase (3:1) → Umfang/Intensität runter" });
  } else if (args.tsb != null && args.tsb > 5 && args.readinessLevel !== "yellow") {
    sessionType = "Threshold"; headline = "Qualität möglich — Schwelle/Intervalle";
    reasons.push({ code: "fresh", text: `Form frisch (TSB ${Math.round(args.tsb)}) + Readiness ok → Schlüsseleinheit` });
    confidence = "hoch";
  } else if (args.tsb != null && args.tsb < -20) {
    sessionType = "Easy"; headline = "Ermüdet — lockerer Dauerlauf";
    reasons.push({ code: "fatigued", text: `Form ermüdet (TSB ${Math.round(args.tsb)}) → aerob locker` });
  } else {
    sessionType = "Easy"; headline = "Lockerer Dauerlauf (Grundlage)";
    reasons.push({ code: "base", text: "Standard-Grundlageneinheit (Z2)" });
  }
  if (args.readinessLevel === "yellow") reasons.push({ code: "readiness_yellow", text: "Readiness mittel → Intensität eher zurückhaltend" });
  if (args.ctlRamp != null && args.ctlRamp > 8) reasons.push({ code: "ramp_high", text: `CTL-Ramp hoch (${args.ctlRamp}/Woche) — nicht überziehen` });
  if (args.plannedTypes.length) reasons.push({ code: "already_planned", text: `Heute geplant: ${args.plannedTypes.join(", ")}` });
  const doseHint = args.weekTssRec ? `Wochen-Ziel ${args.weekTssRec.target} TSS (${args.weekTssRec.kind})` : "";
  return { headline, sessionType, doseHint, reasons, confidence };
}

// ---- Adaptiver Coach (v1.5.0): heutige geplante Einheit an Form/Readiness/Risiko anpassen ----

export interface SessionAdjustment {
  changed: boolean;
  action: string;
  headline: string;
  reasons: { code: string; text: string }[];
  confidence: "hoch" | "mittel" | "niedrig";
  mode: "advisory" | "gate";
  original: { type: string; planned_tss: number };
  adjusted: ConcreteSession | null; // null wenn unverändert
}

/**
 * Adaptiver Coach (v1.5.0, Vorschlag-Modus): passt die HEUTE geplante Einheit an die aktuelle
 * Form (TSB/CTL-Ramp), Readiness und das Überlastungsrisiko an — erklärbarer Decision-Tree
 * (Athletica/IntervalCoach-Stil, Meta-Studie A7). Re-konkretisiert über concretizeSession, sodass
 * die Plan-TSS exakt zum angepassten Ziel passt. `mode` betrifft nur die UI (gate = bestätigen/
 * erzwingen, advisory = Hinweis); die Anpassung wird immer aus den Signalen berechnet.
 * Gibt null zurück, wenn heute keine Einheit geplant ist.
 */
export function adjustTodaySession(
  planned: { type: string; planned_tss: number } | null,
  ctx: {
    tsb: number | null;
    ctlRamp: number | null;
    readinessLevel: ReadinessLevel | null;
    injuryLevel: "ok" | "info" | "warn" | "danger" | null;
    weekTssRecMin: number | null;
    weekRealizedTss: number | null;
    zones: ZonesInput;
    gateMode: "advisory" | "gate";
  },
): SessionAdjustment | null {
  if (!planned || !planned.type) return null;
  const isHard = HARD_TYPES.has(planned.type);
  const base = Math.max(1, planned.planned_tss || 0);
  const reasons: { code: string; text: string }[] = [];
  let factor = 1, newType = planned.type, action = "on_track";
  let headline = "Einheit passt — wie geplant";
  let confidence: SessionAdjustment["confidence"] = "mittel";

  if (ctx.readinessLevel === "red" && isHard) {
    newType = "Easy"; factor = 0.6; action = "gate_readiness_red"; confidence = "hoch";
    headline = "Readiness niedrig → harte Einheit auf locker reduzieren";
    reasons.push({ code: "readiness_red", text: "Readiness rot → heute regenerieren statt Qualität" });
  } else if (ctx.injuryLevel === "danger") {
    factor = 0.7; if (isHard) newType = "Easy"; action = "risk_danger"; confidence = "hoch";
    headline = "Überlastungs-Warnung → Umfang/Intensität reduzieren";
    reasons.push({ code: "risk_danger", text: "Erhöhtes Überlastungsrisiko (ACWR/Monotonie/Ramp) → defensiv" });
  } else if (ctx.tsb != null && ctx.tsb < -20 && isHard) {
    newType = "LT1"; factor = 0.8; action = "deep_fatigue"; confidence = "mittel";
    headline = "Stark ermüdet → harte Einheit zu Tempo/Steady entschärfen";
    reasons.push({ code: "deep_fatigue", text: `Form ermüdet (TSB ${Math.round(ctx.tsb)}) → Intensität runter` });
  } else if (ctx.ctlRamp != null && ctx.ctlRamp > 8) {
    factor = 0.9; action = "ramp_high"; confidence = "mittel";
    headline = "CTL-Ramp hoch → Dosis leicht reduzieren";
    reasons.push({ code: "ramp_high", text: `CTL-Ramp ${ctx.ctlRamp}/Woche → nicht überziehen` });
  } else if (
    ctx.readinessLevel === "green" && ctx.tsb != null && ctx.tsb > 5 &&
    ctx.weekTssRecMin != null && ctx.weekRealizedTss != null && ctx.weekRealizedTss < ctx.weekTssRecMin
  ) {
    factor = 1.1; action = "behind_fresh"; confidence = "mittel";
    headline = "Frisch + Wochenrückstand → Dosis leicht erhöhen";
    reasons.push({ code: "behind_fresh", text: "Readiness grün, Form frisch, Wochen-TSS unter Ziel → etwas mehr möglich" });
  }

  const changed = factor !== 1 || newType !== planned.type;
  const original = { type: planned.type, planned_tss: round1(base) };
  if (!changed) {
    return {
      changed: false, action, headline: "Einheit passt — wie geplant",
      reasons: [{ code: "on_track", text: "Form/Readiness im grünen Bereich → keine Anpassung nötig" }],
      confidence, mode: ctx.gateMode, original, adjusted: null,
    };
  }
  if (ctx.readinessLevel === "yellow") reasons.push({ code: "readiness_yellow", text: "Readiness mittel → eher zurückhaltend" });
  const targetTss = Math.max(1, round1(base * factor));
  const adjusted = concretizeSession(newType, targetTss, ctx.zones);
  return { changed: true, action, headline, reasons, confidence, mode: ctx.gateMode, original, adjusted };
}

// ---- Wochen-/Block-Empfehlungs-Engine (v1.3.0): Periodisierungs-Modell + Wochenstruktur ----

export interface WeekSessionRec {
  type: string;           // Session-Typ (z.B. "Easy", "Threshold", "Long", "VO2")
  count: number;          // Wie oft diese Woche
  tssShare: number;       // Anteil am Wochen-Ziel-TSS (%)
  hint: string;           // kurze Beschreibung (Dauer/Intensität)
}

export interface WeekStructureRec {
  headline: string;
  periodizationModel: "block" | "traditional";
  tssRange: TssRec;
  sessions: WeekSessionRec[];
  distTarget: DistTarget;
  reasons: { code: string; text: string }[];
  confidence: "hoch" | "mittel" | "niedrig";
}

/**
 * Regelbasierte Wochen-/Block-Empfehlung (v1.3.0, Vorschlag-Modus).
 * Verzahnt: Phasen-Verteilungs-Ziel (G4), TSS-Korridor (tssRecommendation), Form (TSB/CTL).
 * Periodisierungs-Prinzipien: Block ≥ traditionell für VO2max/Wmax; 3:1-Deload; Taper.
 * Evidenz: Issurin Block-Meta (2008), tssRecommendation 3:1-Prinzip, Treff Verteilung.
 */
export function weekStructureRecommendation(args: {
  ctl: number;
  tsb: number | null;
  ctlRamp: number | null;
  phase: string | null | undefined;
  weekNo?: number | null;   // für 3:1 Modulo (jede 4. Woche Deload)
  readinessLevel: ReadinessLevel | null;
  methodPreference?: { regime: Regime; confidence: "hoch" | "mittel" | "niedrig" } | null; // N-of-1 advisory Nudge
}): WeekStructureRec {
  const reasons: { code: string; text: string }[] = [];
  const p = (args.phase || "").toLowerCase();
  const tssRange = tssRecommendation(args.ctl, args.phase);
  let distTarget = phaseDistributionTarget(args.phase);
  let confidence: WeekStructureRec["confidence"] = "mittel";
  let periodizationModel: WeekStructureRec["periodizationModel"] = "traditional";
  let headline = "";
  const sessions: WeekSessionRec[] = [];

  // ---- 3:1-Entlastungswoche erkennen (wenn Phase nicht explizit gesetzt: Modulo-4) ----
  const isDeload = p.includes("entlast") || p.includes("deload");
  const isRaceWeek = p.includes("race week") || p.includes("raceweek") || p.includes("race-week");
  const isSick = p.includes("krank");
  const isBase = p.includes("base") || p.includes("aufbau") || p.includes("belast");
  const isSpecific = p.includes("specific") || p.includes("spec");
  const autoDeload = !p && args.weekNo != null && args.weekNo % 4 === 0; // 3:1-Rhythmus ohne explizite Phase (weekNo aktiviert)
  const weakForm = args.tsb != null && args.tsb < -15;
  const freshForm = args.tsb != null && args.tsb > 5;

  if (isSick) {
    headline = "Regeneration (Krank) — ausruhen, keine Belastung";
    sessions.push({ type: "Easy", count: 2, tssShare: 100, hint: "Nur wenn symptomfrei; sehr kurz & locker" });
    reasons.push({ code: "sick", text: "Phase = Krank → kein Training außer sehr lockerer Bewegung" });
    return { headline, periodizationModel, tssRange, sessions, distTarget, reasons, confidence: "hoch" };
  }

  if (isDeload || isRaceWeek || autoDeload) {
    headline = isRaceWeek ? "Race Week — Taper, Frische maximieren" : "Entlastungswoche (3:1) — Umfang −40 %, Intensität zurück";
    sessions.push({ type: "Easy", count: 3, tssShare: 70, hint: "Lockere Z1/Z2-Läufe, kurz halten" });
    if (isRaceWeek) sessions.push({ type: "Easy", count: 1, tssShare: 20, hint: "Steigerungen (5×80 m), nicht mehr" });
    else sessions.push({ type: "Threshold", count: 1, tssShare: 30, hint: "1 kurze Qualitätseinheit — halb so lang wie Normalo-Woche" });
    reasons.push({ code: isRaceWeek ? "race_week" : "deload", text: isRaceWeek ? "Race Week → TSS-Taper −50 %, letzte Einheit ≥3 Tage vor Rennen" : "Entlastungsphase → TSS −40 %, niedrige Monotonie" });
    confidence = "hoch";
    return { headline, periodizationModel, tssRange, sessions, distTarget, reasons, confidence };
  }

  if (weakForm) {
    reasons.push({ code: "fatigued", text: `Form ermüdet (TSB ${Math.round(args.tsb!)}) → Umfang/Intensität etwas zurück` });
  }
  if (args.readinessLevel === "red") {
    reasons.push({ code: "readiness_red", text: "Readiness niedrig → Intensität runter, Erholungstage einbauen" });
  }
  if (args.ctlRamp != null && args.ctlRamp > 8) {
    reasons.push({ code: "ramp_high", text: `CTL-Ramp ${args.ctlRamp}/Woche hoch — ggf. Woche beschränken` });
  }

  // ---- N-of-1-Kopplung (advisory, Q7): beste Methode nudgt das Verteilungsziel sanft, nie erzwingend ----
  if (args.methodPreference && args.methodPreference.confidence !== "niedrig") {
    const rt = regimeDistTarget(args.methodPreference.regime);
    if (rt) {
      distTarget = {
        model: distTarget.model,
        z1: Math.round((distTarget.z1 + rt.z1) / 2),
        z2: Math.round((distTarget.z2 + rt.z2) / 2),
        z3: Math.round((distTarget.z3 + rt.z3) / 2),
        label: `${distTarget.label} · N-of-1→${rt.label}`,
      };
      reasons.push({ code: "method_pref", text: `N-of-1: ${REGIME_LABEL[args.methodPreference.regime]} korrelierte bei dir mit Fortschritt → Verteilung sanft angepasst (advisory).` });
    }
  }

  // ---- Phase-spezifische Wochenstruktur ----
  if (isSpecific) {
    // Race-Specific: Block-Periodisierung, polarisierte Verteilung — qualitätsdichte Woche
    periodizationModel = "block";
    const rot = (args.weekNo ?? 0) % 2; // Wochen-zu-Wochen-Variation (P4)
    headline = "Race-Specific-Block — VO2 + Renntempo, polarisiert";
    sessions.push({ type: "VO2", count: 1, tssShare: 26, hint: rot === 0
      ? "VO2max: 5×3 min @ 3–5k-Pace (>4.5 mmol), Trab-Pause 2–3 min"
      : "VO2max: 4×4 min @ ~3k-Pace, Trab-Pause 3 min" });
    sessions.push({ type: "Threshold", count: 1, tssShare: 28, hint: rot === 0
      ? "Renntempo: 5×1 km @ Renntempo (höheres Laktat 5–10 mmol), 1–2 min Pause"
      : "Renntempo: 3×2 km @ 10k/HM-Tempo, 2–3 min Pause" });
    sessions.push({ type: "Long", count: 1, tssShare: 24, hint: "Langer Lauf Z1/Z2 — aerobe Basis erhalten" });
    sessions.push({ type: "Easy", count: 2, tssShare: 22, hint: "Locker Z1 (Recovery), polarisiert" });
    reasons.push({ code: "specific_block", text: "Race Specific → Block-Periodisierung: VO2max + Renntempo-Cluster, Schwellen-Volumen zurück, Verteilung polarisiert (Casado 2022)" });
    confidence = freshForm ? "hoch" : "mittel";
  } else if (isBase) {
    // Belastungsphase: pyramidal, Schwellen-Volumen (Sub-Threshold/Norwegian) aufbauen
    const rot = (args.weekNo ?? 0) % 2; // Variation (P4)
    headline = "Aufbau-/Belastungswoche — pyramidal, Schwellen-Volumen";
    sessions.push({ type: "Long", count: 1, tssShare: 26, hint: "Langer Lauf 90–150 min Z1/Z2 (aerobe Basis, Fettstoffwechsel)" });
    if (!weakForm && args.readinessLevel !== "red") {
      sessions.push({ type: "Threshold", count: 2, tssShare: 40, hint: rot === 0
        ? "2× Sub-Threshold (Norwegian): z.B. 5×6 min / 6×5 min @ LT2, Laktat 2.5–3.5 mmol, kurze Pause (45–90 s) — ideal als Doppel-Schwellen-Tag"
        : "2× Sub-Threshold: 20–25×400 m @ ~LT2-Pace, 30–60 s Trab — kontrolliert (<4 mmol)" });
      sessions.push({ type: "Easy", count: 2, tssShare: 34, hint: "Grundlage Z1/Z2, Umfang halten/aufbauen" });
      reasons.push({ code: "build_quality", text: "Aufbau → 2 kontrollierte Sub-Threshold-Einheiten (Norwegian) + langer Lauf; Ziel: schneller bei gleichem Laktat" });
    } else {
      sessions.push({ type: "Threshold", count: 1, tssShare: 22, hint: "1 Sub-Threshold (LT2, kontrolliert) statt 2 — Form/Readiness" });
      sessions.push({ type: "Easy", count: 3, tssShare: 52, hint: "Locker Z1/Z2 — Regeneration priorisieren" });
      reasons.push({ code: "build_reduced", text: "Aufbau, aber Form/Readiness beeinträchtigt → Schwellen-Volumen reduziert" });
    }
    confidence = "hoch";
  } else {
    // Base / Erhalt / Standard (unbekannte Phase): LT1-Volumen, aerobe Ökonomie
    headline = "Base/Grundlage — LT1-Volumen, aerobe Ökonomie";
    sessions.push({ type: "Long", count: 1, tssShare: 30, hint: "Langer Lauf Z1/Z2 — LT1-Entwicklung, Fettstoffwechsel, Ökonomie" });
    if (freshForm && args.readinessLevel !== "red") {
      sessions.push({ type: "Threshold", count: 1, tssShare: 20, hint: "1 lockere LT2-Einheit (2×15 min @ Schwelle, kontrolliert <4 mmol)" });
    }
    sessions.push({ type: "Easy", count: 3, tssShare: 50, hint: "Lockeres Z1/Z2-Volumen + Steigerungen (Ökonomie)" });
    reasons.push({ code: "base_standard", text: "Base/Erhalt → Z1/Z2-Volumen (LT1), 1 langer Lauf, pyramidal" });
    confidence = "mittel";
  }

  if (reasons.length === 0) reasons.push({ code: "default", text: "Standardplanung nach Phase und Form" });
  return { headline, periodizationModel, tssRange, sessions, distTarget, reasons, confidence };
}

// ===================== A4 — Mesozyklus-/Block-Planer bis Renntag =====================
// Iteriert die Wochen ab Start bis Renntag, projiziert die Form vorwärts (CTL/TSB akkumulieren mit dem
// generierten Plan-TSS), ruft je Woche weekStructureRecommendation und macht jede Einheit konkret (A2) +
// tagesgebunden (A3). Vorschlag-Modus: schreibt nichts — liefert reine Vorschau.

export interface BlockWeekInput { week_no: number; phase: string | null; start_date: string; dates: string[] }

export interface BlockDay {
  date: string; weekdayIdx: number; type: string; isSecond: boolean;
  planned_min: number; planned_tss: number; description: string;
  zone_alloc: { byKm?: Record<number, number>; byMin?: Record<number, number> }; efforts: Effort[] | null; paceTarget: number | null;
  prescription?: { templateId: string; progress: number; targetTss: number } | null; // v1.7.0: Intention für Live-Resolution
}
export interface BlockWeek {
  week_no: number; start_date: string; phase: string | null;
  headline: string; periodizationModel: "block" | "traditional";
  tssTarget: number; tssActual: number; ctlStart: number; tsbStart: number | null;
  isDeload: boolean; days: BlockDay[];
  reasons: { code: string; text: string }[]; confidence: WeekStructureRec["confidence"];
}
export interface BlockPlan {
  weeks: BlockWeek[]; raceDate: string | null;
  reasons: { code: string; text: string }[]; confidence: WeekStructureRec["confidence"];
}

function addDaysIsoLocal(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Leitet je Woche eine Phase ab, wenn keine explizit gesetzt ist (P1, v1.6.0). Rückwärts vom Renntag:
 * Race Week (letzte) → Race Specific (2 davor) → Aufbau-Span mit Base (frühe ~45 %) / Belastung + 3:1-
 * Entlastung jede 4. Aufbauwoche. Ohne Renntag rollender Block (Base→Belastung, 3:1). **Manuell gesetzte
 * Phasen bleiben unangetastet** — der Vorschlag passt sich an Koljas Edits an.
 */
export function derivePhaseSequence(
  weeks: { week_no: number; start_date: string; phase: string | null }[],
  raceDate: string | null,
): (string | null)[] {
  const n = weeks.length;
  const out: (string | null)[] = weeks.map((w) => (w.phase && w.phase.trim() ? w.phase : null));
  const set = (i: number, phase: string) => { if (i >= 0 && i < n && out[i] == null) out[i] = phase; };
  let raceIdx = -1;
  if (raceDate) {
    for (let i = 0; i < n; i++) {
      const end = addDaysIsoLocal(weeks[i].start_date, 6);
      if (raceDate >= weeks[i].start_date && raceDate <= end) { raceIdx = i; break; }
    }
    if (raceIdx < 0 && raceDate >= (weeks[n - 1]?.start_date ?? "")) raceIdx = n - 1; // Rennen ≥ letzte Woche
  }
  if (raceIdx >= 0) {
    set(raceIdx, "Race Week");
    const specificStart = Math.max(0, raceIdx - 2);
    for (let i = specificStart; i < raceIdx; i++) set(i, "Race Specific");
    const spanEnd = specificStart - 1; // Aufbau-Span [0 .. spanEnd]
    if (spanEnd >= 0) {
      const baseCut = Math.floor((spanEnd + 1) * 0.45); // erste ~45 % Base, Rest Belastung
      let wk = 0;
      for (let i = 0; i <= spanEnd; i++) {
        wk++;
        if (wk % 4 === 0) { set(i, "Entlastung"); continue; } // 3:1
        set(i, i < baseCut ? "Base" : "Belastung");
      }
    }
  } else {
    // kein Renntag: rollender Block
    for (let i = 0; i < n; i++) {
      if (out[i] != null) continue;
      if ((i + 1) % 4 === 0) out[i] = "Entlastung";
      else out[i] = i < 3 ? "Base" : "Belastung";
    }
  }
  return out;
}

// ===================== v1.7.0 — Fitness-Projektion + projizierte Wochen-Zonen =====================

export interface VdotProjection { perWeek: number[]; goalVdot: number; curVdot: number; infeasible: boolean }

/**
 * Wöchentliche VDOT-Projektion (v1.7.0): von der heutigen Fitness linear Richtung Ziel-VDOT, **gedeckelt** auf
 * `capPerWeek` VDOT-Punkte/Woche (kein Regress bei langsamem Ziel). Reicht die Zeit nicht → `infeasible`,
 * die Projektion bleibt unter dem Ziel (ehrlich). `perWeek[w]` = projizierte VDOT in Woche w (0 = heute).
 */
export function projectVdot(curVdot: number, goalVdot: number, weeks: number, capPerWeek = 0.4): VdotProjection {
  const need = goalVdot - curVdot;
  const W = Math.max(0, Math.round(weeks));
  const perWeek: number[] = [];
  for (let w = 0; w <= W; w++) {
    const gain = need <= 0 ? 0 : Math.min(need, capPerWeek * w);
    perWeek.push(Math.round((curVdot + gain) * 100) / 100);
  }
  return { perWeek, goalVdot, curVdot, infeasible: need > capPerWeek * W + 1e-9 };
}

/**
 * Zonen-Eingabe für eine projizierte Fitness-Woche: Pace-Anker (LT1/LT2/CS/Rep/Goal) aus dem projizierten VDOT
 * (Daniels-Paces); Renntempo aus `predictFromVdot(projVdot, goalDistanz)` (wächst Richtung Wunsch-Zeit, da die
 * Projektion am Ziel-VDOT gedeckelt ist). HF-Zonen + Pace-Zonen bleiben aus der Basis (HF physiologisch, TSS IF-normiert).
 */
export function zonesForWeek(base: ZonesInput, projVdot: number, goalDistanceM: number | null): ZonesInput {
  if (!(projVdot > 0)) return base;
  const dp = danielsPaces(projVdot);
  let goalPace = base.goal_pace ?? null;
  if (goalDistanceM && goalDistanceM > 0) {
    const pr = predictFromVdot(projVdot, [goalDistanceM]);
    if (pr.length && pr[0].time_s > 0) goalPace = Math.round(pr[0].time_s / (goalDistanceM / 1000));
  }
  return {
    ...base,
    lt1_pace: dp.marathon,        // LT1 ≈ Marathon-/Sub-Threshold-Pace
    threshold_pace: dp.threshold, // LT2
    cs_pace: dp.interval,         // VO2/CS
    rep_pace: dp.rep,
    goal_distance_m: goalDistanceM ?? base.goal_distance_m ?? null,
    goal_pace: goalPace,
  };
}

export interface ResolveCtx {
  today: string;
  curVdot: number | null;
  curCtl: number;
  baseZones: ZonesInput;        // aus effectiveZoneSet (hr_zones, pace_zones, threshold, lt1, cs)
  goalDistanceM: number | null;
  goalTimeS: number | null;
}

/**
 * Live-Resolution einer geplanten Einheit (v1.7.0): rendert Pace/HF/Struktur aus der gespeicherten Intention
 * (`prescription`) + aktueller & projizierter Fitness neu. Nur für ZUKÜNFTIGE Einheiten aufrufen (Vergangenes
 * bleibt Snapshot). Liefert null, wenn Template fehlt oder keine Fitness bekannt ist.
 */
export function resolvePlannedSession(
  presc: { templateId: string; progress: number; targetTss: number },
  sessionDate: string,
  ctx: ResolveCtx,
): { planned_min: number; zone_alloc: { byKm?: Record<number, number>; byMin?: Record<number, number> }; efforts: Effort[] | null; description: string; paceTarget: number | null } | null {
  const tpl = workoutById(presc.templateId);
  if (!tpl || !ctx.curVdot) return null;
  const weeksUntil = Math.max(0, Math.round((Date.parse(sessionDate + "T00:00:00Z") - Date.parse(ctx.today + "T00:00:00Z")) / (7 * 86400000)));
  const goalVdot = ctx.goalTimeS && ctx.goalDistanceM ? vdot(ctx.goalDistanceM, ctx.goalTimeS) : ctx.curVdot;
  const need = goalVdot - ctx.curVdot;
  const projVdot = ctx.curVdot + (need > 0 ? Math.min(need, 0.4 * weeksUntil) : 0); // gedeckelt, kein Regress
  const zones = zonesForWeek(ctx.baseZones, projVdot, ctx.goalDistanceM);
  const fitness = fitnessLevel(ctx.curCtl, zones.cs_pace ?? null);
  const c = renderWorkout(tpl, { zones, fitness, progress: presc.progress, targetTss: presc.targetTss });
  return { planned_min: c.planned_min, zone_alloc: c.zone_alloc, efforts: c.efforts, description: c.description, paceTarget: c.paceTarget };
}

/** Position der Woche innerhalb ihres zusammenhängenden Phasen-Blocks (für Rotation + Progression). */
function phaseProgress(phases: (string | null)[], wi: number): { weekInPhase: number; phaseLen: number } {
  const cur = phases[wi];
  let start = wi; while (start > 0 && phases[start - 1] === cur) start--;
  let end = wi; while (end < phases.length - 1 && phases[end + 1] === cur) end++;
  return { weekInPhase: wi - start, phaseLen: end - start + 1 };
}

/**
 * Grobe Renn-TSS aus Distanz + Zielzeit (v1.9.0): rTSS = (Dauer h)·IF²·100 mit distanzabhängigem Intensitäts-
 * faktor (5k ~1.04 · 10k ~1.0 · HM ~0.98 · Marathon ~0.92). Ohne Zielzeit: distanzbasierter Fallback.
 * Treibt die PMC-Projektion + die adaptive Recovery nach dem Rennen (Marathon → tiefer → längere Erholung).
 */
export function raceTssEstimate(distanceM: number | null, timeS: number | null): number {
  const d = distanceM ?? 0;
  const ifr = d >= 38000 ? 0.92 : d >= 18000 ? 0.98 : d >= 12000 ? 1.0 : 1.04;
  if (timeS && timeS > 0) return Math.round((timeS / 3600) * ifr * ifr * 100);
  return d >= 38000 ? 270 : d >= 18000 ? 150 : d >= 8000 ? 90 : d >= 4000 ? 55 : 40;
}

export function blockPlan(args: {
  weeks: BlockWeekInput[];
  historicalDailyTss: Map<string, number>;
  from: string;            // frühestes Datum für die PMC-Berechnung
  today: string;
  raceDate: string | null;
  zones: ZonesInput;
  availability: Availability | null;
  readinessLevel: ReadinessLevel | null;
  methodPreference?: { regime: Regime; confidence: "hoch" | "mittel" | "niedrig" } | null; // N-of-1 advisory
  goalDistanceM?: number | null; // v1.6.2: Zieldistanz → distanzgerechte Race-Specific-Auswahl
  curVdot?: number | null;       // v1.7.0: aktuelles VDOT (Start der Projektion)
  goalTimeS?: number | null;     // v1.7.0: Wunsch-Zielzeit → Ziel-VDOT (treibt die Pace-Progression)
  tuneups?: { date: string; distanceM: number | null; goalTimeS: number | null }[]; // v1.10.0: Test-/Aufbauwettkämpfe
}): BlockPlan {
  const projected = new Map<string, number>(); // generierter Plan-TSS je Tag (vorwärts akkumuliert)
  const outWeeks: BlockWeek[] = [];
  let lowConf = false;
  // P1: Phasen ableiten (nur leere füllen) — manuelle Phasen gewinnen.
  const phases = derivePhaseSequence(args.weeks.map((w) => ({ week_no: w.week_no, start_date: w.start_date, phase: w.phase })), args.raceDate);

  // v1.7.0: Fitness-Projektion heute → Wunsch-Zielzeit; je Woche progressierte Pace-Anker.
  const wkOffset = (d: string) => Math.max(0, Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(args.today + "T00:00:00Z")) / (7 * 86400000)));
  const lastStart = args.weeks.length ? args.weeks[args.weeks.length - 1].start_date : args.today;
  const totalWeeks = Math.max(1, wkOffset(args.raceDate ?? lastStart));
  const goalVdot = args.curVdot && args.goalTimeS && args.goalDistanceM ? vdot(args.goalDistanceM, args.goalTimeS) : null;
  const proj = args.curVdot && goalVdot ? projectVdot(args.curVdot, goalVdot, totalWeeks) : null;

  args.weeks.forEach((w, wi) => {
    const phase = phases[wi] ?? w.phase;
    // Projizierte Zonen dieser Woche (Paces wachsen Richtung Ziel); ohne Projektion = Basis-Zonen.
    const projVdot = proj ? proj.perWeek[Math.min(wkOffset(w.start_date), proj.perWeek.length - 1)] : null;
    const weekZones = projVdot ? zonesForWeek(args.zones, projVdot, args.goalDistanceM ?? null) : args.zones;
    // Form zu Beginn der Woche: PMC aus historischem + bisher generiertem Plan-TSS bis zum Vortag.
    const merged = new Map(args.historicalDailyTss);
    for (const [d, t] of projected) merged.set(d, (merged.get(d) ?? 0) + t);
    const endPmc = addDaysIsoLocal(w.start_date, -1);
    const pmc = computePmc(merged, args.from, endPmc, args.today);
    const last = pmc.length ? pmc[pmc.length - 1] : null;
    const ctl = last?.ctl ?? 0;
    const tsb = last?.tsb ?? null;
    const ramp = ctlRamp(pmc, 7);

    // Readiness fließt nur in die unmittelbar nächste Woche ein (Zukunft unbekannt).
    const rec = weekStructureRecommendation({
      ctl, tsb, ctlRamp: ramp, phase, weekNo: w.week_no,
      readinessLevel: wi === 0 ? args.readinessLevel : null,
      methodPreference: args.methodPreference ?? null,
    });
    const target = rec.tssRange.target;

    // v1.6.1: konkrete Einheiten aus der Workout-Bibliothek — Rotation + Progression + Fitness-Skalierung.
    const { weekInPhase, phaseLen } = phaseProgress(phases, wi);
    const progress = phaseLen > 1 ? weekInPhase / (phaseLen - 1) : 0.5;
    const fitness = fitnessLevel(ctl, weekZones.cs_pace ?? null);
    const picks = pickWeekWorkouts(phase, weekInPhase, fitness, !!args.availability?.allowDoubles, args.goalDistanceM ?? null, args.availability?.corePerWeek ?? 0,
      args.availability ? { emphasis: args.availability.emphasis, favoriteWorkouts: args.availability.favoriteWorkouts, avoidWorkouts: args.availability.avoidWorkouts } : undefined);

    // Quality-TSS schätzen → Easy/Long füllen die Restdifferenz zum Wochen-Ziel (Hybrid).
    let qTss = 0;
    for (const p of picks) if (p.role === "quality") qTss += renderWorkout(p.tpl, { zones: weekZones, fitness, progress }).planned_tss;
    const remaining = Math.max(0, target - qTss);
    const longs = picks.filter((p) => p.role === "long");
    const easies = picks.filter((p) => p.role === "easy");
    const longShare = longs.length ? (remaining * 0.45) / longs.length : 0;
    const easyShare = easies.length ? (remaining * 0.55) / easies.length : 0;
    const units: PlannedUnit[] = picks.map((p) => {
      const tgt = p.role === "long" ? Math.round(longShare) : p.role === "easy" ? Math.round(easyShare) : 0;
      return { type: p.tpl.sessionType, targetTss: tgt, ref: { tpl: p.tpl, progress, targetTss: tgt }, pair: p.pair };
    });

    // Auf Wochentage verteilen + je Einheit rendern.
    const scheduled = scheduleWeek(units, args.availability, w.dates);
    const days: BlockDay[] = [];
    let tssActual = 0, downgraded = false;
    for (const su of scheduled) {
      const ref = su.ref as { tpl: WorkoutTemplate; progress: number; targetTss: number } | undefined;
      let c;
      if (su.downgrade && ref?.tpl) {
        // Strikte Erholungsregel (v1.7.0): keine zwei harten Tage hintereinander → diese Qualität wird locker.
        const easyTpl = workoutById("easy_ga1") ?? ref.tpl;
        c = renderWorkout(easyTpl, { zones: weekZones, fitness, progress: ref.progress, targetTss: Math.round(easyShare) || 50, maxMin: su.budgetMin > 0 ? su.budgetMin : undefined });
        downgraded = true;
      } else if (ref?.tpl) {
        c = renderWorkout(ref.tpl, { zones: weekZones, fitness, progress: ref.progress, targetTss: ref.targetTss, maxMin: su.budgetMin > 0 ? su.budgetMin : undefined });
      } else {
        c = concretizeSession(su.type, su.targetTss, weekZones, su.budgetMin > 0 ? { maxMin: su.budgetMin } : undefined);
      }
      // v1.7.0: Intention (Template + Progression + Ziel-TSS) für Live-Resolution speichern.
      const prescription = ref?.tpl
        ? { templateId: su.downgrade ? "easy_ga1" : ref.tpl.id, progress: ref.progress, targetTss: su.downgrade ? (Math.round(easyShare) || 50) : ref.targetTss }
        : null;
      days.push({
        date: su.date, weekdayIdx: su.weekdayIdx, type: c.type, isSecond: su.isSecond,
        planned_min: c.planned_min, planned_tss: c.planned_tss, description: c.description,
        zone_alloc: c.zone_alloc, efforts: c.efforts, paceTarget: c.paceTarget, prescription,
      });
      projected.set(su.date, (projected.get(su.date) ?? 0) + c.planned_tss);
      tssActual += c.planned_tss;
    }
    if (downgraded) rec.reasons.push({ code: "hard_spacing", text: "Erholung geschützt: eine Qualitätseinheit zu locker umgewandelt (kein harter Folgetag im Profil möglich)." });

    // v1.9.0: in der Race-Week das ECHTE Ziel-Rennen am Renntag einsetzen (statt generischer Einheit).
    if (args.raceDate && w.dates.includes(args.raceDate)) {
      const raceTss = raceTssEstimate(args.goalDistanceM ?? null, args.goalTimeS ?? null);
      const distKm = args.goalDistanceM && args.goalDistanceM > 0 ? Math.round(args.goalDistanceM / 100) / 10 : null;
      const goalPaceS = args.goalDistanceM && args.goalTimeS ? Math.round(args.goalTimeS / (args.goalDistanceM / 1000)) : (weekZones.goal_pace ?? null);
      const ps = goalPaceS ? `${Math.floor(goalPaceS / 60)}:${String(Math.round(goalPaceS % 60)).padStart(2, "0")}` : null;
      const raceEntry: BlockDay = {
        date: args.raceDate, weekdayIdx: w.dates.indexOf(args.raceDate), type: "Race", isSecond: false,
        planned_min: distKm && goalPaceS ? Math.round((distKm * goalPaceS) / 60) : (args.goalTimeS ? Math.round(args.goalTimeS / 60) : 40),
        planned_tss: raceTss,
        description: `🏁 WETTKAMPF${distKm ? ` · ${distKm} km` : ""}${ps ? ` @ ${ps}/km` : ""}`,
        zone_alloc: { byKm: distKm ? { 4: distKm } : {} }, efforts: null, paceTarget: goalPaceS, prescription: null,
      };
      const exist = days.findIndex((d) => d.date === args.raceDate);
      const prevTss = exist >= 0 ? days[exist].planned_tss : 0;
      if (exist >= 0) days[exist] = raceEntry; else days.push(raceEntry);
      tssActual += raceTss - prevTss;
      projected.set(args.raceDate, (projected.get(args.raceDate) ?? 0) - prevTss + raceTss);
    }

    // v1.10.0: Test-/Aufbauwettkampf in dieser Woche — Mini-Taper (1–2 Tage davor locker) + 1 lockerer Tag danach,
    // KEIN voller Taper/keine Recovery-Kaskade. Der Block läuft regulär Richtung Hauptrennen weiter.
    for (const tu of args.tuneups ?? []) {
      if (!w.dates.includes(tu.date)) continue;
      const idx = w.dates.indexOf(tu.date);
      // 1–2 Tage davor + 1 Tag danach: harte Einheiten entschärfen (locker).
      for (let d = 0; d < days.length; d++) {
        const di = w.dates.indexOf(days[d].date);
        if (di < 0) continue;
        const taper = di === idx - 1 || di === idx - 2 || di === idx + 1;
        if (taper && HARD_TYPES.has(days[d].type)) {
          const easyTss = Math.round(days[d].planned_tss * 0.5);
          tssActual += easyTss - days[d].planned_tss;
          projected.set(days[d].date, (projected.get(days[d].date) ?? 0) + easyTss - days[d].planned_tss);
          days[d] = { ...days[d], type: "Easy", planned_tss: easyTss, planned_min: Math.round(days[d].planned_min * 0.7),
            description: di > idx ? "Locker — Erholung nach Test-Wettkampf" : "Locker — Mini-Taper vor Test-Wettkampf",
            zone_alloc: { byKm: {} }, efforts: null, prescription: null };
        }
      }
      // Test-Rennen als Einheit setzen.
      const tuTss = raceTssEstimate(tu.distanceM, tu.goalTimeS);
      const tuKm = tu.distanceM && tu.distanceM > 0 ? Math.round(tu.distanceM / 100) / 10 : null;
      const tuPaceS = tu.distanceM && tu.goalTimeS ? Math.round(tu.goalTimeS / (tu.distanceM / 1000)) : null;
      const tuPs = tuPaceS ? `${Math.floor(tuPaceS / 60)}:${String(Math.round(tuPaceS % 60)).padStart(2, "0")}` : null;
      const tuEntry: BlockDay = {
        date: tu.date, weekdayIdx: idx, type: "Race", isSecond: false,
        planned_min: tuKm && tuPaceS ? Math.round((tuKm * tuPaceS) / 60) : (tu.goalTimeS ? Math.round(tu.goalTimeS / 60) : 30),
        planned_tss: tuTss,
        description: `🏁 TEST-WETTKAMPF${tuKm ? ` · ${tuKm} km` : ""}${tuPs ? ` @ ${tuPs}/km` : ""}`,
        zone_alloc: { byKm: tuKm ? { 4: tuKm } : {} }, efforts: null, paceTarget: tuPaceS, prescription: null,
      };
      const tui = days.findIndex((d) => d.date === tu.date);
      const tuPrev = tui >= 0 ? days[tui].planned_tss : 0;
      if (tui >= 0) days[tui] = tuEntry; else days.push(tuEntry);
      tssActual += tuTss - tuPrev;
      projected.set(tu.date, (projected.get(tu.date) ?? 0) - tuPrev + tuTss);
    }

    if (rec.confidence === "niedrig") lowConf = true;
    const pl = (rec.headline || "").toLowerCase();
    const isDeload = pl.includes("entlast") || pl.includes("deload") || pl.includes("taper") || pl.includes("race week");
    outWeeks.push({
      week_no: w.week_no, start_date: w.start_date, phase,
      headline: rec.headline, periodizationModel: rec.periodizationModel,
      tssTarget: Math.round(target), tssActual: Math.round(tssActual),
      ctlStart: round1(ctl), tsbStart: tsb != null ? round1(tsb) : null,
      isDeload, days, reasons: rec.reasons, confidence: rec.confidence,
    });
  });

  // v1.9.0: adaptive Recovery NACH dem Rennen — Plan endet nicht am Renntag. Solange Recovery-Wochen anhängen,
  // bis die Form (TSB) wieder in einem sicheren Band ist (≥ −5). Distanzabhängig (Marathon tiefer → länger).
  if (args.raceDate && args.weeks.length) {
    const csForFit = args.zones.cs_pace ?? null;
    const lastInput = args.weeks[args.weeks.length - 1];
    let recStart = addDaysIsoLocal(lastInput.start_date, 7);
    let recNo = (outWeeks.length ? outWeeks[outWeeks.length - 1].week_no : 0) + 1;
    // Mindest-Erholung distanzabhängig (Muskelschaden ≠ nur TSB): Marathon ≥ 3 Wo · HM 2 · sonst 1 Woche.
    const rDist = args.goalDistanceM ?? 0;
    const minRec = rDist >= 38000 ? 3 : rDist >= 18000 ? 2 : 1;
    for (let i = 0; i < 4; i++) {
      const dates = Array.from({ length: 7 }, (_, d) => addDaysIsoLocal(recStart, d));
      const merged = new Map(args.historicalDailyTss);
      for (const [d, t] of projected) merged.set(d, (merged.get(d) ?? 0) + t);
      const pmc0 = computePmc(merged, args.from, addDaysIsoLocal(recStart, -1), args.today);
      const last0 = pmc0.length ? pmc0[pmc0.length - 1] : null;
      const ctl0 = last0?.ctl ?? 0, tsb0 = last0?.tsb ?? 0;
      const fit0 = fitnessLevel(ctl0, csForFit);
      const recTarget = Math.max(20, Math.round(ctl0 * 7 * (0.35 + 0.12 * i))); // locker, langsam wieder hochrampen
      const picks = pickWeekWorkouts("recovery", i, fit0, false, args.goalDistanceM ?? null, 0);
      const easies = picks.filter((p) => p.role === "easy");
      const eShare = easies.length ? recTarget / easies.length : recTarget;
      const units2: PlannedUnit[] = picks.map((p) => {
        const tgt = p.role === "easy" ? Math.round(eShare) : 0;
        return { type: p.tpl.sessionType, targetTss: tgt, ref: { tpl: p.tpl, progress: 0.3, targetTss: tgt } };
      });
      const rdays: BlockDay[] = [];
      let rtss = 0;
      for (const su of scheduleWeek(units2, args.availability, dates)) {
        const ref = su.ref as { tpl: WorkoutTemplate; progress: number; targetTss: number } | undefined;
        const c = ref?.tpl
          ? renderWorkout(ref.tpl, { zones: args.zones, fitness: fit0, progress: 0.3, targetTss: ref.targetTss, maxMin: su.budgetMin > 0 ? su.budgetMin : undefined })
          : concretizeSession(su.type, su.targetTss, args.zones);
        const prescription = ref?.tpl ? { templateId: ref.tpl.id, progress: 0.3, targetTss: ref.targetTss } : null;
        rdays.push({ date: su.date, weekdayIdx: su.weekdayIdx, type: c.type, isSecond: su.isSecond, planned_min: c.planned_min, planned_tss: c.planned_tss, description: c.description, zone_alloc: c.zone_alloc, efforts: c.efforts, paceTarget: c.paceTarget, prescription });
        projected.set(su.date, (projected.get(su.date) ?? 0) + c.planned_tss);
        rtss += c.planned_tss;
      }
      outWeeks.push({
        week_no: recNo, start_date: recStart, phase: "Recovery",
        headline: i === 0 ? "Regeneration nach dem Rennen" : "Wiedereinstieg", periodizationModel: "traditional",
        tssTarget: recTarget, tssActual: Math.round(rtss), ctlStart: round1(ctl0), tsbStart: round1(tsb0),
        isDeload: true, days: rdays, confidence: "mittel",
        reasons: [{ code: "post_race_recovery", text: "Regeneration nach dem Wettkampf — Last bewusst niedrig, bis die Form (TSB) wieder im sicheren Bereich ist." }],
      });
      recNo++; recStart = addDaysIsoLocal(recStart, 7);
      // Form am Ende dieser Recovery-Woche prüfen → bei sicherem Band (≥ −5) stoppen (mind. 1 Woche).
      const mergedE = new Map(args.historicalDailyTss);
      for (const [d, t] of projected) mergedE.set(d, (mergedE.get(d) ?? 0) + t);
      const pmcE = computePmc(mergedE, args.from, dates[6], args.today);
      const tsbE = pmcE.length ? (pmcE[pmcE.length - 1].tsb ?? 0) : 0;
      if (i + 1 >= minRec && tsbE >= -5) break; // genug Wochen + Form wieder im sicheren Band
    }
  }

  const reasons: { code: string; text: string }[] = [
    { code: "block_horizon", text: args.raceDate ? `Mesozyklus bis Renntag ${args.raceDate}: 3:1-Rhythmus + Taper` : "Rollender Block (kein Renntag gesetzt)" },
  ];
  return { weeks: outWeeks, raceDate: args.raceDate, reasons, confidence: lowConf ? "niedrig" : "mittel" };
}

// ===================== C2 — Überlastungs-/Verletzungs-Frühwarnung =====================
/**
 * Kombinierter Risiko-Flag aus ACWR (ATL/CTL, Gabbett), Monotonie (Foster), CTL-Ramp und Readiness.
 * Erklärbar: nennt die beitragenden Faktoren. Vorschlag-Modus — nur Hinweis, keine Aktion.
 * Evidenz: Gabbett ACWR-„sweet spot" 0.8–1.3 (>1.5 erhöhtes Risiko); Foster Monotonie ≥2.0; Ramp-Rate.
 */
export function injuryRiskFlag(args: {
  acwr: number | null;            // ATL/CTL
  monotony: number | null;        // Foster
  ctlRamp: number | null;         // CTL/Woche
  readinessLevel: ReadinessLevel | null;
  ctl?: number | null;            // Guard gegen Früh-Spikes bei minimaler Historie
}): Flag | null {
  if (args.ctl != null && args.ctl < 1) return null;
  const factors: string[] = [];
  let score = 0;
  const acwr = args.acwr;
  if (acwr != null) {
    if (acwr >= 1.5) { score += 2; factors.push(`ACWR ${acwr.toFixed(2)} (Lastspitze)`); }
    else if (acwr >= 1.3) { score += 1; factors.push(`ACWR ${acwr.toFixed(2)} (erhöht)`); }
  }
  const mono = args.monotony;
  if (mono != null) {
    if (mono >= 2.0) { score += 2; factors.push(`Monotonie ${mono.toFixed(1)}`); }
    else if (mono >= 1.5) { score += 1; factors.push(`Monotonie ${mono.toFixed(1)}`); }
  }
  const ramp = args.ctlRamp;
  if (ramp != null) {
    if (ramp > 10) { score += 2; factors.push(`CTL-Ramp +${Math.round(ramp)}/Wo`); }
    else if (ramp > 7) { score += 1; factors.push(`CTL-Ramp +${Math.round(ramp)}/Wo`); }
  }
  if (args.readinessLevel === "red") { score += 2; factors.push("Readiness niedrig"); }
  else if (args.readinessLevel === "yellow") { score += 1; factors.push("Readiness mittel"); }

  const params = {
    acwr: acwr != null ? Math.round(acwr * 100) / 100 : null,
    monotony: mono != null ? Math.round(mono * 10) / 10 : null,
    ramp: ramp != null ? Math.round(ramp) : null, score,
  };
  if (score >= 4) return { level: "danger", code: "injury_risk_high", message: `Überlastungsrisiko hoch — ${factors.join(", ")}. Entlastungstag/-woche einplanen.`, params };
  if (score >= 2) return { level: "warn", code: "injury_risk_mid", message: `Überlastungsrisiko erhöht — ${factors.join(", ")}. Belastung beobachten.`, params };
  if (score >= 1) return { level: "info", code: "injury_risk_low", message: `Leicht erhöhte Belastungssignale — ${factors.join(", ")}.`, params };
  return { level: "ok", code: "injury_risk_ok", message: "Belastung im grünen Bereich (ACWR/Monotonie/Ramp/Readiness unauffällig).", params };
}

/** Geplante km je HF-Zone (nur Lauf): aus zone_alloc (byKm bevorzugt, sonst byMin via Pace) oder Typ-Default. */
export function zoneKmOf(sessions: PlannedSession[], zones: HrZone[], paceZones?: number[]): Record<number, number> {
  const zk: Record<number, number> = {};
  zones.forEach((z) => (zk[z.z] = 0));
  for (const s of sessions) {
    if (s.sport !== "Run") continue;
    const km = s.planned_km || 0;
    if (km <= 0) continue;
    const alloc = s.zone_alloc;
    if (alloc?.byKm && Object.values(alloc.byKm).some((v) => (v || 0) > 0)) {
      for (const z of zones) zk[z.z] += alloc.byKm[z.z] || 0;
      continue;
    }
    if (alloc?.byMin && Object.values(alloc.byMin).some((v) => (v || 0) > 0)) {
      for (const z of zones) {
        const pace = paceZones?.[z.z - 1] || DEFAULT_ZONE_PACE[z.z - 1]; // s/km
        zk[z.z] += ((alloc.byMin[z.z] || 0) * 60) / pace; // min*60s / (s/km) = km
      }
      continue;
    }
    if (s.type === "Easy" || s.type === "Long") zk[2] += km;
    else if (s.type === "Threshold") { zk[2] += km * 0.4; zk[4] += km * 0.6; }
    else if (s.type === "VO2" || s.type === "Race" || s.type === "Renntempo") { zk[2] += km * 0.4; zk[5] += km * 0.6; }
    else if (s.type === "Hill") { zk[2] += km * 0.5; zk[4] += km * 0.5; }
    else zk[2] += km;
  }
  for (const z of zones) zk[z.z] = r1(zk[z.z]);
  return zk;
}

/** Seitenlegende: %-km je Zonen-Gruppe (Easy Z1-2 / Moderat Z3 / Hart Z4-6) aus den geplanten Lauf-km. */
export function zoneKmIntensityOf(
  sessions: PlannedSession[], zones: HrZone[], paceZones?: number[],
): { easy: number; mod: number; hard: number } {
  const zk = zoneKmOf(sessions, zones, paceZones);
  const tot = Object.values(zk).reduce((a, b) => a + b, 0) || 1;
  const easy = (((zk[1] || 0) + (zk[2] || 0)) / tot) * 100;
  const mod = ((zk[3] || 0) / tot) * 100;
  const hard = (((zk[4] || 0) + (zk[5] || 0) + (zk[6] || 0)) / tot) * 100;
  return { easy: r1(easy), mod: r1(mod), hard: r1(hard) };
}

// ---- Intervall-/Effort-Trend (ToDo 2/13/20) -----------------------------

/** Eine Belastungs-Zeile einer Aktivität (Vertrag mit client/src/lib/api.ts: Effort).
 *  v0.12.0: kann auch eine eine-Ebene-Gruppe sein (`group`/`reps`/`children`). */
export interface EffortLine {
  reps?: number | null;
  sec?: number | null;
  dist_m?: number | null;
  pace_s?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  zone?: number | null;
  label?: string;
  group?: boolean;
  children?: EffortLine[];
}

/** Gruppen (Sets) flach expandieren: Gruppen-reps × children. */
export function flattenEffortLines(rows: EffortLine[] | null | undefined): EffortLine[] {
  const out: EffortLine[] = [];
  for (const e of rows ?? []) {
    if (e.group && e.children?.length) {
      const g = e.reps && e.reps > 0 ? e.reps : 1;
      for (let i = 0; i < g; i++) for (const c of e.children) out.push(c);
    } else if (!e.group) out.push(e);
  }
  return out;
}

/** Vertrag mit client/src/lib/api.ts: IntervalEffortStat. */
export interface IntervalEffortStat {
  date: string;
  sessionType: string;
  category: "LT1" | "LT2" | "VO2short" | "VO2long" | "other";
  avg_pace_s?: number | null; // Lauf: s/km
  avg_speed_kmh?: number | null; // Rad
  avg_hr?: number | null;
  reps?: number;
  label?: string;
}

/**
 * Aggregiert die Efforts einer Aktivität zu einem Trend-Punkt.
 * sessionType: Typ der gematchten/abgeleiteten geplanten Einheit; fehlt er,
 * Heuristik über Block-Dauer und HF. Kategorie:
 * Threshold + avg_hr < LTHR-4 -> LT1, sonst Threshold -> LT2;
 * VO2 mit Block <= 120s -> VO2short, sonst VO2long; alles andere -> other.
 */
export function intervalEffortStat(args: {
  date: string;
  sport: string;
  name?: string | null;
  sessionType?: string | null;
  efforts: EffortLine[];
  lthr: number;
}): IntervalEffortStat {
  const efforts = flattenEffortLines(args.efforts); // Gruppen (Sets) flach expandieren (v0.12.0)
  let distM = 0, // Gesamt-Distanz (m) über alle Wiederholungen
    sec = 0, // Gesamt-Belastungszeit (s)
    hrWeighted = 0, // Summe avg_hr * Gewicht (Zeit)
    hrWeight = 0,
    reps = 0,
    blockSec = 0; // längster Einzel-Block (s) — bestimmt VO2short/-long
  for (const e of efforts) {
    const r = e.reps || 1;
    reps += r;
    let s = e.sec ?? null;
    let d = e.dist_m ?? null;
    if (s == null && d != null && e.pace_s) s = (d / 1000) * e.pace_s;
    if (d == null && s != null && e.pace_s) d = (s / e.pace_s) * 1000;
    if (s != null) {
      sec += s * r;
      blockSec = Math.max(blockSec, s);
    }
    if (d != null) distM += d * r;
    if (e.avg_hr) {
      const w = (s ?? 60) * r;
      hrWeighted += e.avg_hr * w;
      hrWeight += w;
    }
  }
  const avg_hr = hrWeight ? Math.round(hrWeighted / hrWeight) : null;

  // Distanz-gewichteter Pace-/Speed-Schnitt: Gesamtzeit / Gesamtdistanz.
  let avg_pace_s: number | null = null;
  let avg_speed_kmh: number | null = null;
  if (distM > 0 && sec > 0) {
    avg_pace_s = round1(sec / (distM / 1000));
    avg_speed_kmh = round1(distM / 1000 / (sec / 3600));
  } else {
    // Fallback: pace_s der Zeilen, gewichtet nach Distanz (bzw. Wiederholungen).
    let w = 0, sum = 0;
    for (const e of efforts) {
      if (!e.pace_s) continue;
      const wt = (e.dist_m ?? 1000) * (e.reps || 1);
      w += wt;
      sum += e.pace_s * wt;
    }
    if (w) {
      avg_pace_s = round1(sum / w);
      avg_speed_kmh = round1(3600 / (sum / w));
    }
  }

  // Session-Typ: geplant/gematcht, sonst Heuristik (Block-Dauer + HF vs LTHR).
  let sessionType = args.sessionType || "";
  if (!sessionType) {
    if (avg_hr != null && avg_hr >= args.lthr + 2) sessionType = "VO2";
    else if (blockSec > 0 && blockSec <= 180) sessionType = "VO2";
    else if (avg_hr != null && avg_hr >= args.lthr - 12) sessionType = "Threshold";
    else if (blockSec >= 300) sessionType = "Threshold";
    else sessionType = "Other";
  }

  let category: IntervalEffortStat["category"] = "other";
  // v0.11.0 (ToDo 10): explizite Einheitstypen direkt auf die Trend-Kategorie abbilden.
  if (sessionType === "LT1" || sessionType === "LT2" || sessionType === "VO2short" || sessionType === "VO2long") category = sessionType;
  else if (sessionType === "Threshold") category = avg_hr != null && avg_hr < args.lthr - 4 ? "LT1" : "LT2";
  else if (sessionType === "VO2") category = blockSec > 0 && blockSec <= 120 ? "VO2short" : "VO2long";

  const isBike = isBikeSport(args.sport);
  return {
    date: args.date,
    sessionType,
    category,
    avg_pace_s: isBike ? null : avg_pace_s,
    avg_speed_kmh: isBike ? avg_speed_kmh : null,
    avg_hr,
    reps,
    label: efforts.find((e) => e.label)?.label || args.name || undefined,
  };
}

export interface AnalyzeContext {
  phase?: string | null;
  targetKm?: number | null;
  recentWeeksKm?: number[]; // letzte Wochen (real), neueste zuletzt
  projectedCtlRamp?: number | null; // CTL-Punkte/Woche der geplanten Woche
  projectedTsb?: number | null; // Form am Wochenende
  // Race-Taper (v0.14.0): bezieht sich auf die 7 Tage vor dem Renntag, nicht die Kalenderwoche.
  raceDate?: string | null; // Renntag in der Woche (falls vorhanden)
  raceTsb?: number | null; // projizierte Form am Renntag
  racePre7Tss?: number | null; // Σ geplante TSS der 7 Tage vor dem Rennen
  raceAvgWeeklyTss?: number | null; // Ø geplante Wochen-TSS (Referenz fürs Tapering)
  readiness?: { recovery?: number; legsHardDays?: number; hrvTrend?: number } | null;
  thresholds: {
    volume_pct: number;
    ctl_ramp_max: number;
    acwr_high: number;
    acwr_low: number;
    hard_pct_max: number;
    z3_pct_max: number;
    longrun_pct_max: number;
    tsb_raceweek_min: number;
    raceweek_tss_max_pct: number;
  };
}

/** Plan-Erfüllung einer Einheit (v0.14.0, ToDo 12): zusammengesetzt aus TSS-Treffer + Zeit-in-Ziel-Pace-Zone.
 *  `pct` = 100·(0.5·tssScore + 0.5·zoneScore); ohne Pace-Zonen-Daten nur TSS (`tssOnly`). Ohne geplantes TSS → null. */
/**
 * Aktivität ↔ geplante Einheit zuordnen (v1.9.0). Manuelle Zuordnung (`matched_session_id`) gewinnt immer;
 * sonst greedy-Best-Match nach Datumnähe (±1 Tag) + Typ-Übereinstimmung + TSS-/Dauer-Nähe. Jede Aktivität und
 * jede Einheit höchstens einmal. Liefert Map activityId → sessionId (für korrekte Plan-Erfüllung statt Fehl-%).
 */
export function matchActivities(
  activities: { id: number; date: string; type: string | null; tss: number | null; moving_s: number | null; matched_session_id: number | null; sport: string }[],
  sessions: { id: number; date: string; type: string; planned_tss: number | null; planned_min: number | null }[],
): Map<number, number> {
  const out = new Map<number, number>();
  const usedSessions = new Set<number>();
  const sessionIds = new Set(sessions.map((s) => s.id));
  // 1) manuelle Zuordnungen fixieren.
  for (const a of activities) if (a.matched_session_id != null && sessionIds.has(a.matched_session_id)) { out.set(a.id, a.matched_session_id); usedSessions.add(a.matched_session_id); }
  // 2) auto: Score je (Aktivität, freie Einheit), beste Paare greedy zuerst.
  const score = (a: typeof activities[number], s: typeof sessions[number]): number => {
    const dd = Math.abs(Date.parse(a.date + "T00:00:00Z") - Date.parse(s.date + "T00:00:00Z")) / 86400000;
    if (dd > 1.5) return -1;
    let sc = 100 - dd * 45;
    if (a.type && s.type && a.type.toLowerCase() === s.type.toLowerCase()) sc += 25;
    if (a.tss && s.planned_tss) sc += 25 * (1 - Math.min(1, Math.abs(a.tss - s.planned_tss) / Math.max(40, s.planned_tss)));
    if (a.moving_s && s.planned_min) sc += 15 * (1 - Math.min(1, Math.abs(a.moving_s / 60 - s.planned_min) / Math.max(20, s.planned_min)));
    return sc;
  };
  const pairs: { a: number; s: number; sc: number }[] = [];
  for (const a of activities) {
    if (out.has(a.id) || a.sport !== "Run") continue;
    for (const s of sessions) if (!usedSessions.has(s.id)) { const sc = score(a, s); if (sc > 0) pairs.push({ a: a.id, s: s.id, sc }); }
  }
  pairs.sort((x, y) => y.sc - x.sc);
  const usedAct = new Set<number>();
  for (const p of pairs) { if (usedAct.has(p.a) || usedSessions.has(p.s)) continue; out.set(p.a, p.s); usedAct.add(p.a); usedSessions.add(p.s); }
  return out;
}

export function sessionCompletion(
  planned: { planned_tss?: number | null; zone_alloc?: { byKm?: Record<number, number> } | null },
  act: { tss?: number | null; pace_zone_min?: Record<number, number> | null },
  paceZones: number[] | undefined,
): { pct: number; tssScore: number; zoneScore: number | null; tssOnly: boolean } | null {
  const plannedTss = planned.planned_tss ?? 0;
  if (!(plannedTss > 0)) return null;
  const tssScore = Math.max(0, Math.min(1, (act.tss ?? 0) / plannedTss));

  let zoneScore: number | null = null;
  const byKm = planned.zone_alloc?.byKm || null;
  const aMin = act.pace_zone_min || null;
  if (byKm && Object.keys(byKm).length && aMin && Object.keys(aMin).length) {
    const pTime: Record<number, number> = {}; // geplante Zeit je Zone = km_z · pace_z
    for (const [z, km] of Object.entries(byKm)) {
      const zi = Number(z), kmv = Number(km) || 0;
      if (kmv <= 0) continue;
      pTime[zi] = kmv * (paceZones?.[zi - 1] || DEFAULT_ZONE_PACE[zi - 1] || 300);
    }
    const pSum = Object.values(pTime).reduce((s, x) => s + x, 0);
    const aSum = Object.values(aMin).reduce((s, x) => s + (Number(x) || 0), 0);
    if (pSum > 0 && aSum > 0) {
      let overlap = 0;
      for (const z of new Set([...Object.keys(pTime), ...Object.keys(aMin)].map(Number))) {
        overlap += Math.min((pTime[z] || 0) / pSum, (Number(aMin[z]) || 0) / aSum);
      }
      zoneScore = overlap;
    }
  }
  const tssOnly = zoneScore == null;
  const pct = Math.round(100 * (tssOnly ? tssScore : 0.5 * tssScore + 0.5 * zoneScore!));
  return { pct, tssScore, zoneScore, tssOnly };
}

export function analyzeWeek(totals: WeekTotals, ctx: AnalyzeContext): Flag[] {
  const flags: Flag[] = [];
  const t = ctx.thresholds;

  // 1. Volumen vs Phasenziel
  if (ctx.targetKm && ctx.targetKm > 0) {
    const diff = ((totals.km - ctx.targetKm) / ctx.targetKm) * 100;
    if (diff > t.volume_pct)
      flags.push({ level: "warn", code: "volume_high", message: `Volumen ${totals.km} km liegt ${r0(diff)}% über dem Phasenziel (${ctx.targetKm} km).`, params: { km: totals.km, diff: r0(diff), targetKm: ctx.targetKm } });
    else if (diff < -t.volume_pct)
      flags.push({ level: "info", code: "volume_low", message: `Volumen ${totals.km} km liegt ${r0(-diff)}% unter dem Phasenziel (${ctx.targetKm} km).`, params: { km: totals.km, diff: r0(-diff), targetKm: ctx.targetKm } });
    else flags.push({ level: "ok", code: "volume_ok", message: `Volumen ${totals.km} km passt zum Phasenziel (${ctx.targetKm} km).`, params: { km: totals.km, targetKm: ctx.targetKm } });
  }

  // 2. Ramp-Rate (km Woche-zu-Woche)
  if (ctx.recentWeeksKm && ctx.recentWeeksKm.length) {
    const recent = ctx.recentWeeksKm.slice(-3);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (avg > 0) {
      const jump = ((totals.km - avg) / avg) * 100;
      if (jump > 12)
        flags.push({ level: "warn", code: "ramp_fast", message: `Sprung +${r0(jump)}% ggü. Schnitt der Vorwochen (${r0(avg)} km) — Verletzungsrisiko, max. ~10%/Woche empfohlen.`, params: { jump: r0(jump), avg: r0(avg) } });
    }
  }

  // 2b. CTL-Ramp
  if (ctx.projectedCtlRamp != null && ctx.projectedCtlRamp > t.ctl_ramp_max)
    flags.push({ level: "warn", code: "ctl_ramp", message: `CTL-Ramp +${ctx.projectedCtlRamp}/Woche über Limit (${t.ctl_ramp_max}). Fitness-Aufbau zu schnell.`, params: { ramp: ctx.projectedCtlRamp, max: t.ctl_ramp_max } });

  // 3. Form / Taper Richtung Race (v0.14.0, ToDo 4): bezogen auf die 7 Tage VOR dem Renntag.
  if (ctx.raceDate) {
    const tooNeg = ctx.raceTsb != null && ctx.raceTsb < t.tsb_raceweek_min;
    const tssCap = ctx.raceAvgWeeklyTss != null ? ctx.raceAvgWeeklyTss * (t.raceweek_tss_max_pct / 100) : null;
    const tooHigh = ctx.racePre7Tss != null && tssCap != null && ctx.racePre7Tss > tssCap;
    if (tooNeg || tooHigh) {
      const parts: string[] = [];
      if (tooNeg) parts.push(`Form am Renntag (TSB ${ctx.raceTsb}) zu negativ`);
      if (tooHigh) parts.push(`geplante 7-Tage-Last (${ctx.racePre7Tss} TSS) zu hoch fürs Tapering (max ~${Math.round(tssCap!)})`);
      flags.push({ level: "warn", code: "taper", message: `Wettkampf ${ctx.raceDate}: ${parts.join(" · ")} — mehr tapern.`, params: { raceDate: ctx.raceDate ?? null, tooNeg: tooNeg ? 1 : 0, raceTsb: ctx.raceTsb ?? null, tooHigh: tooHigh ? 1 : 0, pre7tss: ctx.racePre7Tss ?? null, tssCap: tssCap != null ? Math.round(tssCap) : null } });
    } else if (ctx.raceTsb != null) {
      flags.push({ level: "ok", code: "taper_ok", message: `Wettkampf ${ctx.raceDate}: Tapering passt (Form TSB ${ctx.raceTsb}).`, params: { raceDate: ctx.raceDate ?? null, tsb: ctx.raceTsb } });
    }
  }

  // 5. Polarisierung: bewusst NICHT mehr über Zeit-in-Zone (ToDo Z.24) — die km-in-Zone-Polarisierung
  // wird in der analyze-Route als `kmPolarizationFlag` angehängt (eine einzige, km-basierte Aussage).

  // 6. Quality-Spacing
  if (totals.hardSessions > 3)
    flags.push({ level: "warn", code: "too_many_quality", message: `${totals.hardSessions} harte Einheiten — meist max. 2–3/Woche tragbar.`, params: { count: totals.hardSessions } });

  // 7. Longrun-Anteil
  if (totals.km > 0) {
    const lrShare = (totals.longestKm / totals.km) * 100;
    if (lrShare > t.longrun_pct_max)
      flags.push({ level: "info", code: "longrun_share", message: `Longrun ${totals.longestKm} km = ${r0(lrShare)}% der Wochen-km (> ${t.longrun_pct_max}%).`, params: { km: totals.longestKm, pct: r0(lrShare), max: t.longrun_pct_max } });
  }

  // 8. Readiness
  if (ctx.readiness) {
    const { recovery, legsHardDays, hrvTrend } = ctx.readiness;
    if ((recovery != null && recovery < 40) || (legsHardDays ?? 0) >= 3 || (hrvTrend != null && hrvTrend < -10))
      flags.push({ level: "warn", code: "readiness", message: `Letzte Tage Erholung niedrig (Recov/HRV/Beine) — geplante Last evtl. zu hoch, ggf. reduzieren.`, params: {} });
  }

  // 9. Phasen-Stimmigkeit
  if (ctx.phase && /entlast|deload|gesund/i.test(ctx.phase) && ctx.targetKm && totals.km > ctx.targetKm * 1.05)
    flags.push({ level: "warn", code: "deload_mismatch", message: `Phase „${ctx.phase}" sollte entlasten, geplante km aber über Ziel.`, params: { phase: ctx.phase ?? "" } });

  return flags;
}

function r1(n: number) {
  return Math.round(n * 10) / 10;
}
function r0(n: number) {
  return Math.round(n);
}
