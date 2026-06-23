// Regelbasierte Prüf-Engine: bewertet eine geplante Woche gegen Phase + Verlauf.
import { bikeTssEstimate, hrTssFromZones, rTssFromZones, powerZoneMidWatts, round1, DEFAULT_ZONE_PACE, computePmc, ctlRamp, type HrZone } from "./load.ts";
import { concretizeSession, scheduleWeek, type Availability, type ZonesInput, type PlannedUnit, type Effort } from "./planbuilder.ts";

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

const HARD_TYPES = new Set(["Threshold", "VO2", "Race", "Hill"]);

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
  } else if (s.type === "VO2" || s.type === "Race") {
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
}): WeekStructureRec {
  const reasons: { code: string; text: string }[] = [];
  const p = (args.phase || "").toLowerCase();
  const tssRange = tssRecommendation(args.ctl, args.phase);
  const distTarget = phaseDistributionTarget(args.phase);
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
  const weakForm = args.tsb != null && args.tsb < -15;
  const freshForm = args.tsb != null && args.tsb > 5;

  if (isSick) {
    headline = "Regeneration (Krank) — ausruhen, keine Belastung";
    sessions.push({ type: "Easy", count: 2, tssShare: 100, hint: "Nur wenn symptomfrei; sehr kurz & locker" });
    reasons.push({ code: "sick", text: "Phase = Krank → kein Training außer sehr lockerer Bewegung" });
    return { headline, periodizationModel, tssRange, sessions, distTarget, reasons, confidence: "hoch" };
  }

  if (isDeload || isRaceWeek) {
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

  // ---- Phase-spezifische Wochenstruktur ----
  if (isSpecific) {
    // Race-Specific: Block-Periodisierung, polarisierte Verteilung — qualitätsdichte Woche
    periodizationModel = "block";
    headline = "Race-Specific-Block — 2 Schlüsseleinheiten, polarisiert";
    sessions.push({ type: "Threshold", count: 1, tssShare: 30, hint: "Tempo/Renntempo-Einheit, 20–40 min im Bereich LT2" });
    sessions.push({ type: "VO2", count: 1, tssShare: 25, hint: "VO2max-Intervalle (4–6×3–5 min mit Pause)" });
    sessions.push({ type: "Long", count: 1, tssShare: 25, hint: "Langer Lauf Z1/Z2 (auch aerobe Basis erhalten)" });
    sessions.push({ type: "Easy", count: 2, tssShare: 20, hint: "Locker Z1/Z2 als Auflockerung/Recovery" });
    reasons.push({ code: "specific_block", text: "Race Specific → Block-Periodisierung: Qualitäts-Cluster + aerobe Basis (Issurin)" });
    confidence = freshForm ? "hoch" : "mittel";
  } else if (isBase) {
    // Belastungsphase: traditionell pyramidal, 1 Schlüsseleinheit
    headline = "Aufbau-/Belastungswoche — pyramidal, 1 Schlüsseleinheit";
    sessions.push({ type: "Long", count: 1, tssShare: 30, hint: "Langer Lauf (20–35 % Wochen-km, Z1/Z2)" });
    if (!weakForm && args.readinessLevel !== "red") {
      sessions.push({ type: "Threshold", count: 1, tssShare: 25, hint: "Schwellen-Einheit (3×10–20 min LT2-Pace), Z4" });
      reasons.push({ code: "build_quality", text: "Aufbau → 1 Schlüsseleinheit (Schwelle) + langer Lauf + Grundlage" });
    } else {
      sessions.push({ type: "Easy", count: 1, tssShare: 25, hint: "Locker statt Qualität (Form/Readiness)" });
      reasons.push({ code: "build_reduced", text: "Aufbau, aber Form/Readiness beeinträchtigt → Qualität zurückgenommen" });
    }
    sessions.push({ type: "Easy", count: 3, tssShare: 45, hint: "Grundlage Z1/Z2, Umfang aufbauen" });
    confidence = "hoch";
  } else {
    // Base / Erhalt / Standard (unbekannte Phase)
    headline = "Grundlagen-/Erhaltswoche — Z1/Z2-Fokus";
    sessions.push({ type: "Long", count: 1, tssShare: 30, hint: "Langer Lauf Z1/Z2 (aerobe Basis)" });
    if (freshForm && args.readinessLevel !== "red") {
      sessions.push({ type: "Threshold", count: 1, tssShare: 20, hint: "1 moderate Schwelleneinheit (2×15 min)" });
    }
    sessions.push({ type: "Easy", count: 3, tssShare: 50, hint: "Locker Z1/Z2, ggf. Steigerungen einbauen" });
    reasons.push({ code: "base_standard", text: "Base/Erhalt → Volumen Z1/Z2-Fokus, 1 langer Lauf" });
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
  zone_alloc: { byMin: Record<number, number> }; efforts: Effort[] | null; paceTarget: number | null;
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

export function blockPlan(args: {
  weeks: BlockWeekInput[];
  historicalDailyTss: Map<string, number>;
  from: string;            // frühestes Datum für die PMC-Berechnung
  today: string;
  raceDate: string | null;
  zones: ZonesInput;
  availability: Availability | null;
  readinessLevel: ReadinessLevel | null;
}): BlockPlan {
  const projected = new Map<string, number>(); // generierter Plan-TSS je Tag (vorwärts akkumuliert)
  const outWeeks: BlockWeek[] = [];
  let lowConf = false;

  args.weeks.forEach((w, wi) => {
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
      ctl, tsb, ctlRamp: ramp, phase: w.phase, weekNo: w.week_no,
      readinessLevel: wi === 0 ? args.readinessLevel : null,
    });
    const target = rec.tssRange.target;

    // rec.sessions (Typ/Anzahl/Anteil) → einzelne Einheiten mit Ziel-TSS.
    const units: PlannedUnit[] = [];
    for (const s of rec.sessions) {
      const per = s.count > 0 ? Math.round((target * (s.tssShare / 100)) / s.count) : 0;
      for (let i = 0; i < s.count; i++) units.push({ type: s.type, targetTss: per });
    }

    // Auf Wochentage verteilen + konkretisieren.
    const scheduled = scheduleWeek(units, args.availability, w.dates);
    const days: BlockDay[] = [];
    let tssActual = 0;
    for (const su of scheduled) {
      const c = concretizeSession(su.type, su.targetTss, args.zones, su.budgetMin > 0 ? { maxMin: su.budgetMin } : undefined);
      days.push({
        date: su.date, weekdayIdx: su.weekdayIdx, type: su.type, isSecond: su.isSecond,
        planned_min: c.planned_min, planned_tss: c.planned_tss, description: c.description,
        zone_alloc: c.zone_alloc, efforts: c.efforts, paceTarget: c.paceTarget,
      });
      projected.set(su.date, (projected.get(su.date) ?? 0) + c.planned_tss);
      tssActual += c.planned_tss;
    }

    if (rec.confidence === "niedrig") lowConf = true;
    const pl = (rec.headline || "").toLowerCase();
    const isDeload = pl.includes("entlast") || pl.includes("deload") || pl.includes("taper") || pl.includes("race week");
    outWeeks.push({
      week_no: w.week_no, start_date: w.start_date, phase: w.phase,
      headline: rec.headline, periodizationModel: rec.periodizationModel,
      tssTarget: Math.round(target), tssActual: Math.round(tssActual),
      ctlStart: round1(ctl), tsbStart: tsb != null ? round1(tsb) : null,
      isDeload, days, reasons: rec.reasons, confidence: rec.confidence,
    });
  });

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
    else if (s.type === "VO2" || s.type === "Race") { zk[2] += km * 0.4; zk[5] += km * 0.6; }
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
