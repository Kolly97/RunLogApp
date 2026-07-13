// Regelbasierte Prüf-Engine: bewertet eine geplante Woche gegen Phase + Verlauf.
import { bikeTssEstimate, hrTssFromZones, rTssFromZones, powerZoneMidWatts, round1, DEFAULT_ZONE_PACE, computePmc, ctlRamp, fitCriticalSpeed, vdot, efficiencyFactor, danielsPaces, predictFromVdot, type HrZone } from "./load.ts";
import { concretizeSession, scheduleWeek, type Availability, type ZonesInput, type PlannedUnit, type Effort, type ConcreteSession } from "./planbuilder.ts";
import { pickWeekWorkouts, renderWorkout, fitnessLevel, workoutById, longRunShare, phaseKind, type WorkoutTemplate } from "./workouts.ts";

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
  // Item 4: km-Fallback — vorgeschlagene/ältere Einheiten haben oft kein planned_km, aber zone_alloc.byKm.
  const kmOf = (s: PlannedSession): number => {
    if (s.planned_km != null) return s.planned_km;
    const bk = s.zone_alloc?.byKm;
    return bk ? Object.values(bk).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
  };
  for (const s of sessions) {
    const isRun = s.sport === "Run";
    const isBike = isBikeSport(s.sport);
    const skm = kmOf(s);
    if (isRun) {
      km += skm;
      runSessions++;
      longestKm = Math.max(longestKm, skm);
      byCategory.run.km += skm;
      byCategory.run.min += s.planned_min || 0;
    }
    if (isBike) bike_km += skm;
    if (isBike || s.sport === "General") {
      byCategory.bike.km += skm;
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
  const base = Math.max(0, ctl) * 7; // Wochen-TSS = ATL:CTL 1.0 (Erhalt der CTL)
  const p = (phase || "").toLowerCase();
  // C1 (Load-Regler): Zielband als ATL:CTL-Ratio, kalibriert auf den Intensity-Trend / COROS „Load Impact / Base
  // Fitness". Belastung/Specific am OBEREN „Optimized"-Rand (produktive Überlast), Base darunter, Entlastung/Taper
  // drunter (Erholung). Nie ins „Excessive" (≥150 %): harte Kappung bei 1.45.
  let rLo: number, rHi: number, kind: string;
  if (p.includes("entlast") || p.includes("deload")) { rLo = 0.60; rHi = 0.75; kind = "Entlastung"; }          // Resuming (Erholung)
  else if (p.includes("race week") || p.includes("race-week") || p.includes("raceweek")) { rLo = 0.45; rHi = 0.58; kind = "Taper"; }
  else if (p.includes("krank")) { rLo = 0; rHi = 0.40; kind = "Reduziert"; }
  else if (p.includes("belast") || p.includes("specific") || p.includes("spec") || p.includes("aufbau")) { rLo = 1.15; rHi = 1.32; kind = "Aufbau"; } // oberer Optimized-Rand
  else if (p.includes("base")) { rLo = 1.02; rHi = 1.15; kind = "Base"; }                                       // Maintaining / low-Optimized
  else { rLo = 0.95; rHi = 1.08; kind = "Erhalt"; }
  const lo = base * rLo;
  const hi = Math.min(base * rHi, base * 1.45); // < Excessive (150 %)
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

export type DistModel = "pyramidal" | "polarized" | "regenerativ";
export interface DistTarget {
  model: DistModel; z1: number; z2: number; z3: number; label: string;
  rationale?: string;     // T14: Klartext, WARUM dieses Modell (aus Phase abgeleitet oder manuell)
  overridden?: boolean;   // T14: true, wenn manuell pro Phase überschrieben
}

/** Kanonische Verteilungs-Modelle (Z1/Z2/Z3-%). */
export const DIST_MODELS: Record<DistModel, Omit<DistTarget, "rationale" | "overridden">> = {
  pyramidal: { model: "pyramidal", z1: 80, z2: 15, z3: 5, label: "pyramidal" },
  polarized: { model: "polarized", z1: 78, z2: 4, z3: 18, label: "polarisiert" },
  regenerativ: { model: "regenerativ", z1: 90, z2: 7, z3: 3, label: "regenerativ (Z1-lastig)" },
};
const MODEL_RATIONALE: Record<DistModel, string> = {
  pyramidal: "Base-/Belastungsphase → pyramidal: viel Z1-Grundlage + spürbares Z2-Schwellenvolumen, wenig Z3.",
  polarized: "Race-Specific-Phase → polarisiert: viel lockeres Z1 plus harte Z3-Reize (VO2/Renntempo), kaum Grey-Zone.",
  regenerativ: "Entlastung/Taper → regenerativ: Z1-lastig zur Erholung, Intensität nur als kurze Reize.",
};

/**
 * Verteilungs-Ziel je Saison-Phase (advisory). Default-Mapping: Race Specific → polarisiert,
 * Entlastung/Taper/Race-Week/Krank → regenerativ, sonst (Base/Belastung) → pyramidal.
 * T14: optionaler manueller Override pro Phase (`overrides[phaseLower] = model`) hat Vorrang; Klartext-`rationale`.
 */
export function phaseDistributionTarget(phase: string | null | undefined, overrides?: Record<string, string> | null, goalDistanceM?: number | null): DistTarget {
  const p = (phase || "").toLowerCase();
  const ovRaw = overrides && p ? overrides[p] : undefined;
  if (ovRaw && (ovRaw === "pyramidal" || ovRaw === "polarized" || ovRaw === "regenerativ")) {
    return { ...DIST_MODELS[ovRaw], overridden: true, rationale: `Manuell für Phase „${phase}" gesetzt: ${DIST_MODELS[ovRaw].label}.` };
  }
  let model: DistModel = "pyramidal";
  if (p.includes("specific")) model = "polarized";
  else if (p.includes("entlast") || p.includes("deload") || p.includes("race week") || p.includes("raceweek") || p.includes("race-week") || p.includes("krank")) model = "regenerativ";
  const base = { ...DIST_MODELS[model], rationale: MODEL_RATIONALE[model] };
  // Item 3 (Frage B): Distanz verschiebt das Soll leicht — kurze Distanz polarisierter (mehr Z3), HM/Marathon
  // schwellenlastiger (mehr Z2). Taper/Erholung unangetastet. Distanz = Rahmen (Frage 8), Athlet moduliert sonst.
  const d = goalDistanceM ?? 0;
  if (d > 0 && model !== "regenerativ") {
    const dz3 = d <= 12000 ? 4 : d >= 21000 ? -3 : 0; // 5k/10k → +Z3 · HM/M → +Z2
    if (dz3 !== 0) {
      return { ...base, z3: Math.max(2, base.z3 + dz3), z2: Math.max(2, base.z2 - dz3),
        rationale: `${base.rationale} Distanz-Anpassung (${Math.round(d / 1000)} km): ${dz3 > 0 ? "etwas polarisierter" : "mehr Z2-Schwellenvolumen"}.` };
    }
  }
  return base;
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
export interface MarkerZones { hr_zones: HrZone[]; threshold_pace: number; lthr: number; lt1_hr: number; lt1_pace?: number | null }

/** Laktat-Feldtest reduziert auf Datum + Stufenpunkte (für Laktat-an-Pace). */
export interface MarkerLactateTest { date: string; points: { pace_s?: number | null; speed_kmh?: number | null; lactate: number }[] }

export interface Markers {
  date: string; windowDays: number; n: number;
  csPace: number | null; csConfidence: "hoch" | "mittel" | "niedrig" | null;
  vdot: number | null;
  lt1Pace: number | null; // aerobe Schwelle LT1 (Pace s/km) aus dem Zonen-Set — kleiner = schneller (LT1 < LT2)
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
  const lt1Pace = zones.lt1_pace && zones.lt1_pace > 0 ? zones.lt1_pace : null;
  const lactateAtPace = lactateAtReferencePace(args.lactateTests || [], endDate, thresholdPace);

  return {
    date: endDate, windowDays, n: runs.length,
    csPace: cs?.cs_pace_s ?? null, csConfidence,
    vdot: vd > 0 ? round1(vd) : null,
    lt1Pace, thresholdPace, thresholdHr: zones.lthr > 0 ? zones.lthr : null,
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

/** Einzelne Wahrheitsquelle der physiologischen Marker-Floors (Test-Retest-MCIDs) für die MCID-Verankerung
 *  (`ml/mcidAnchor.ts`) — direkt aus MARKER_SPEC abgeleitet, damit CS/effVo2max nirgends doppelt hart kodiert sind. */
export const MARKER_MCID = Object.fromEntries(MARKER_SPEC.map((s) => [s.key, s.mcid])) as Record<keyof Markers, number>;

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
  declaredEmphasis?: string | null; // v2.4.0: gewählter Block-Schwerpunkt dieser Woche (Komponente B, deklariert)
  weekTss?: number | null;     // F3: Wochen-Gesamtlast (für Regime/Schwerpunkt-Expositions-EWMA auf latenter Fitness)
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
  nWeeks: number;            // Summe der Wochen in zusammenhängenden Regime-Blöcken (T6: contiguous, nicht überlappende Paare)
  nBlocks: number;           // Anzahl zusammenhängender Blöcke dieses Regimes (unabhängige Beobachtungen)
  csChange: number | null;   // Ø CS-Pace-Veränderung Block-Start→Block-Ende (s/km, negativ = schneller = besser)
  vdotChange: number | null; // Ø VDOT-Veränderung (positiv = besser)
  confidence: "hoch" | "mittel" | "niedrig";
  fromDate: string | null;   // früheste Block-Startwoche dieses Regimes
  toDate: string | null;     // … bis Ende des spätesten Blocks
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

/**
 * Passive Methoden-Inferenz (T6, block-basiert): Wochen werden zuerst in ZUSAMMENHÄNGENDE Regime-Blöcke
 * gruppiert (gleiche Klassifikation, lückenlos ≤10 Tage, Krank/Taper/Race-Wochen brechen einen Block).
 * Je Block wird die Marker-Reaktion als Block-Start→Block-Ende gemessen — CS/VDOT sind bereits 42-Tage-rollend,
 * ein zusätzlicher Lag würde Post-Block-Training importieren. Confounder-Kontrolle (Q4): nur Blöcke mit
 * annähernd stabiler CTL über den Block (|ΔCTL| ≤ ctlBand·Blockwochen/3) — so wird die Marker-Änderung dem
 * Regime und nicht einem Last-Sprung zugeschrieben. `nWeeks` = echte Blockwochen, `nBlocks` = unabhängige
 * Beobachtungen (Konfidenz folgt nBlocks, nicht überlappenden Paaren). Advisory: Korrelation, nicht Kausalität.
 */
export function methodInference(weeks: WeekRegimeInput[], opts?: { lagWeeks?: number; ctlBand?: number }): MethodInferenceResult {
  const r = inferByClassifier<Regime>(weeks, classifyWeekRegime, (g) => REGIME_LABEL[g], opts);
  return {
    regimes: r.groups.map((g) => ({
      regime: g.group, nWeeks: g.nWeeks, nBlocks: g.nBlocks, csChange: g.csChange, vdotChange: g.vdotChange,
      confidence: g.confidence, fromDate: g.fromDate, toDate: g.toDate,
    })),
    best: r.best, lagWeeks: r.lagWeeks, note: r.note, confidence: r.confidence,
  };
}

export interface BlockDelta { group: string; cs: number | null; vd: number | null; weeks: number }
/**
 * Rohe Pro-Block-Marker-Deltas (CS/VDOT Start→Ende, CTL-confounder-kontrolliert) je Gruppe — Grundlage für die
 * hierarchische (Partial-Pooling) Auswertung der Regime-/Schwerpunkt-Achse. Gleiche Block-Bildung wie inferByClassifier.
 */
export function blockDeltas(weeks: WeekRegimeInput[], kind: "regime" | "emphasis", opts?: { ctlBand?: number }): BlockDelta[] {
  const classify: (w: WeekRegimeInput) => string | null = kind === "regime" ? classifyWeekRegime : classifyWeekEmphasis;
  const ctlBand = opts?.ctlBand ?? 8;
  const sorted = [...weeks].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const blocks: { group: string; idx: number[] }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i];
    if (w.excluded) continue;
    const group = classify(w);
    if (group == null) continue;
    const cur = blocks[blocks.length - 1];
    const prevIdx = cur ? cur.idx[cur.idx.length - 1] : -2;
    const prevW = prevIdx >= 0 ? sorted[prevIdx] : null;
    const contiguous = cur != null && cur.group === group && prevIdx === i - 1 && prevW != null && daysBetweenIso(prevW.start_date, w.start_date) <= 10;
    if (contiguous) cur!.idx.push(i); else blocks.push({ group, idx: [i] });
  }
  const out: BlockDelta[] = [];
  for (const blk of blocks) {
    const first = sorted[blk.idx[0]], last = sorted[blk.idx[blk.idx.length - 1]], blkWeeks = blk.idx.length;
    const allow = ctlBand * Math.max(1, blkWeeks / 3);
    if (!(first.ctl == null || last.ctl == null || Math.abs(last.ctl - first.ctl) <= allow)) continue;
    out.push({
      group: blk.group,
      cs: first.csPace != null && last.csPace != null ? Math.round((last.csPace - first.csPace) * 10) / 10 : null,
      vd: first.vdot != null && last.vdot != null ? Math.round((last.vdot - first.vdot) * 10) / 10 : null,
      weeks: blkWeeks,
    });
  }
  return out;
}

// ---- Generischer Block-Inferenz-Kern (T6): geteilt von methodInference (Regime) und evaluateMethodEmphasis ----

export interface GroupStat<T extends string = string> {
  group: T; nWeeks: number; nBlocks: number; csChange: number | null; vdotChange: number | null;
  confidence: "hoch" | "mittel" | "niedrig"; fromDate: string | null; toDate: string | null;
}
export interface GroupInferenceResult<T extends string = string> {
  groups: GroupStat<T>[]; best: T | null; lagWeeks: number; note: string; confidence: "hoch" | "mittel" | "niedrig";
}

/**
 * Block-basierte Vorwärts-Inferenz über beliebige Wochen-Gruppierung `classify`: Wochen werden in
 * ZUSAMMENHÄNGENDE Blöcke gruppiert (gleiche Gruppe, lückenlos ≤10 Tage; Krank/Taper/Race ODER
 * classify→null brechen einen Block). Je Block wird die Marker-Reaktion Block-Start→Block-Ende gemessen
 * (CS/VDOT sind bereits 42-Tage-rollend), mit längen-skalierter CTL-Confounder-Kontrolle
 * (|ΔCTL| ≤ ctlBand·Blockwochen/3). `nWeeks` = echte Blockwochen, `nBlocks` = unabhängige Beobachtungen
 * (Konfidenz folgt nBlocks). Advisory: Korrelation, nicht Kausalität.
 */
function inferByClassifier<T extends string>(
  weeks: WeekRegimeInput[],
  classify: (w: WeekRegimeInput) => T | null,
  labelOf: (t: T) => string,
  opts?: { lagWeeks?: number; ctlBand?: number; noun?: string; topic?: string },
): GroupInferenceResult<T> {
  const lagWeeks = opts?.lagWeeks ?? 3;
  const ctlBand = opts?.ctlBand ?? 8;
  const noun = opts?.noun ?? "Regime";
  const topic = opts?.topic ?? "Methoden-Aussage";
  const sorted = [...weeks].sort((a, b) => a.start_date.localeCompare(b.start_date));

  // 1) Zusammenhängende Gruppen-Blöcke bilden. Excluded ODER classify→null brechen jeden Block
  //    (kein index-Anschluss). Kalenderlücke >10 Tage (fehlende/leere Woche) bricht ebenfalls.
  interface Block { group: T; idx: number[]; }
  const blocks: Block[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i];
    if (w.excluded) continue;
    const group = classify(w);
    if (group == null) continue;
    const cur = blocks[blocks.length - 1];
    const prevIdx = cur ? cur.idx[cur.idx.length - 1] : -2;
    const prevW = prevIdx >= 0 ? sorted[prevIdx] : null;
    const contiguous = cur != null && cur.group === group && prevIdx === i - 1
      && prevW != null && daysBetweenIso(prevW.start_date, w.start_date) <= 10;
    if (contiguous) cur!.idx.push(i);
    else blocks.push({ group, idx: [i] });
  }

  // 2) Je Block die Marker-Reaktion (Start→Ende) mit längen-skalierter CTL-Confounder-Kontrolle.
  const buckets = new Map<T, { cs: number[]; vd: number[]; nBlocks: number; weeks: number; from: string[]; to: string[] }>();
  for (const blk of blocks) {
    const first = sorted[blk.idx[0]];
    const last = sorted[blk.idx[blk.idx.length - 1]];
    const blkWeeks = blk.idx.length;
    const b = buckets.get(blk.group) ?? { cs: [], vd: [], nBlocks: 0, weeks: 0, from: [], to: [] };
    b.nBlocks += 1;
    b.weeks += blkWeeks;
    b.from.push(first.start_date);
    b.to.push(addDaysIsoLocal(last.start_date, 6));
    // CTL-Drift über den Block proportional zur Blocklänge erlauben (ctlBand ist je 3 Wochen definiert).
    const allow = ctlBand * Math.max(1, blkWeeks / 3);
    const ctlOk = first.ctl == null || last.ctl == null || Math.abs(last.ctl - first.ctl) <= allow;
    if (ctlOk) {
      if (first.csPace != null && last.csPace != null) b.cs.push(last.csPace - first.csPace);
      if (first.vdot != null && last.vdot != null) b.vd.push(last.vdot - first.vdot);
    }
    buckets.set(blk.group, b);
  }

  const groups: GroupStat<T>[] = [];
  for (const [group, b] of buckets) {
    if (b.weeks === 0) continue;
    // Konfidenz folgt unabhängigen Blöcken (Replikation), nicht der reinen Wochenzahl.
    const confidence: GroupStat["confidence"] = b.nBlocks >= 2 && b.weeks >= 6 ? "hoch" : b.weeks >= 4 ? "mittel" : "niedrig";
    const froms = [...b.from].sort();
    const tos = [...b.to].sort();
    groups.push({
      group, nWeeks: b.weeks, nBlocks: b.nBlocks,
      csChange: b.cs.length ? meanRound(b.cs, 1) : null,
      vdotChange: b.vd.length ? meanRound(b.vd, 1) : null,
      confidence,
      fromDate: froms[0] ?? null,
      toDate: tos[tos.length - 1] ?? null,
    });
  }
  // Ranken nach CS-Reaktion (negativ = schneller = besser); nur Gruppen mit CS-Signal werten.
  const ranked = groups.filter((r) => r.csChange != null).sort((a, b) => (a.csChange! - b.csChange!));
  groups.sort((a, b) => (a.csChange ?? 999) - (b.csChange ?? 999));
  // „Best" nur, wenn ≥4 Gruppen-Wochen (Q6) und tatsächlich eine Verbesserung (negativ).
  const top = ranked[0];
  const best = top && top.nWeeks >= 4 && (top.csChange ?? 0) < -1.5 ? top.group : null;
  const overallConf: GroupInferenceResult["confidence"] = best && top.nBlocks >= 2 && top.nWeeks >= 6 ? "hoch" : best ? "mittel" : "niedrig";
  const blkTxt = (r: GroupStat<T>) => `n=${r.nWeeks} Wochen${r.nBlocks > 1 ? ` in ${r.nBlocks} Blöcken` : ""}`;
  let note: string;
  // M-6: Wer konsistent trainiert, erzeugt keinen Block-Kontrast → Passive Inferenz bleibt dauerhaft „nicht belastbar".
  // Deshalb aktiv erklären, was es dafür braucht, statt nur „mehr Daten nötig".
  const contrastHint = "Für eine belastbare Aussage brauchst du bewusst kontrastierende Blöcke (mehrere Wochen mit klar unterschiedlichem Schwerpunkt) — oder starte einen gezielten N-of-1-Trial (Geführte Experimente).";
  if (!ranked.length) {
    note = `Noch zu wenig vergleichbare Daten (nach Confounder-Filter) für eine ${topic}. ${contrastHint}`;
  } else if (best) {
    const runner = ranked[1];
    const csTxt = (v: number) => `${v <= 0 ? "" : "+"}${v} s/km CS`;
    note = `Bei dir korrelierte ${labelOf(best)} mit ${csTxt(top.csChange!)} (${blkTxt(top)}, Block-Auswertung)` +
      (runner ? `; ${labelOf(runner.group)} ${csTxt(runner.csChange!)} (${blkTxt(runner)})` : "") +
      ". Korrelation, nicht Kausalität — kleine n beachten.";
  } else {
    note = `Trend, aber (noch) nicht belastbar: bestes ${noun} ${labelOf(top.group)} (${top.csChange} s/km CS, ${blkTxt(top)}). ${contrastHint}`;
  }
  return { groups, best, lagWeeks, note, confidence: overallConf };
}

// ---- Komponente B (BUILDPLAN §1/§6.3): Methoden-Schwerpunkt auswertbar machen ----------------------------------

export type EmphasisKey = "lt1" | "vo2" | "schwelle" | "berg" | "norwegian" | "fartlek" | "ausgewogen";
export const EMPHASIS_LABEL: Record<EmphasisKey, string> = {
  lt1: "LT1 (aerobe Schwelle)", vo2: "VO2max", schwelle: "Schwelle (LT2)", berg: "Berg", norwegian: "Norwegian", fartlek: "Fartlek", ausgewogen: "ausgewogen",
};
// Familien-Erkennung aus dem (freien) Aktivitäts-Typ. Reihenfolge = Priorität; „intervall" bewusst NICHT bei
// vo2 (würde Schwellen-Intervalle verschlucken). Norwegian primär über Doppel-Schwellen-Tag (struktureller Marker).
// lt1 VOR schwelle: aerobe Schwelle (LT1/Steady/Marathon-Pace) ≠ Laktatschwelle (LT2).
const EMPHASIS_RE: { key: Exclude<EmphasisKey, "ausgewogen">; re: RegExp }[] = [
  { key: "norwegian", re: /norw/i },
  { key: "fartlek", re: /fartlek/i },
  { key: "berg", re: /hill|berg|steig/i },
  { key: "vo2", re: /vo2|vo₂/i },
  { key: "lt1", re: /lt1|steady|marathon|\bmp\b|aerobe? schwelle/i },
  { key: "schwelle", re: /threshold|lt2|schwelle|tempo|sub/i },
];
/** Dominante Qualitäts-Familie einer Woche im einheitlichen Schwerpunkt-Vokabular (aus sessions[].type). */
export function classifyWeekEmphasis(w: WeekRegimeInput): EmphasisKey {
  if (w.doubleThresholdDays >= 1) return "norwegian";
  const counts: Partial<Record<EmphasisKey, number>> = {};
  for (const s of w.sessions) {
    for (const { key, re } of EMPHASIS_RE) { if (re.test(s.type)) { counts[key] = (counts[key] ?? 0) + 1; break; } }
  }
  let bestKey: EmphasisKey = "ausgewogen"; let bestN = 0;
  for (const { key } of EMPHASIS_RE) { const n = counts[key] ?? 0; if (n > bestN) { bestN = n; bestKey = key; } }
  return bestN > 0 ? bestKey : "ausgewogen";
}

export interface EmphasisEvaluation {
  chosen: string;                              // aktuell gewählter Block-Schwerpunkt (availability.emphasis)
  observed: GroupStat<EmphasisKey>[];          // Ranking nach BEOBACHTETEM Training (retrospektiv, sofort)
  observedBest: EmphasisKey | null;
  declared: GroupStat<EmphasisKey>[] | null;   // Ranking nach DEKLARIERTEM Schwerpunkt (null = zu wenig Historie)
  declaredBest: EmphasisKey | null;
  chosenStanding: { rank: number; of: number; stat: GroupStat<EmphasisKey> } | null; // Rang des gewählten im beobachteten Ranking
  verdict: string;
  confidence: "hoch" | "mittel" | "niedrig";
  note: string;
}
/**
 * Komponente B: wertet den Methoden-Schwerpunkt aus (funktioniert OHNE Zyklus, für alle Profile).
 * `observed` = beobachtetes Training (classifyWeekEmphasis); `declared` = gewählter Schwerpunkt pro Woche,
 * sobald Historie da ist. Beide über denselben Block-Inferenz-Kern → CS/VDOT-Response je Schwerpunkt.
 * Rein beratend, Korrelation nicht Kausalität. `byPhase` (Kreuzprodukt Phase×Methode) folgt später (Teil 4).
 */
export function evaluateMethodEmphasis(weeks: WeekRegimeInput[], opts: { chosen: string; byPhase?: boolean }): EmphasisEvaluation {
  const cfg = { noun: "Schwerpunkt", topic: "Schwerpunkt-Aussage" };
  const obs = inferByClassifier<EmphasisKey>(weeks, classifyWeekEmphasis, (g) => EMPHASIS_LABEL[g], cfg);
  const hasDeclared = weeks.some((w) => w.declaredEmphasis != null);
  const dec = hasDeclared
    ? inferByClassifier<EmphasisKey>(weeks, (w) => (w.declaredEmphasis as EmphasisKey | null) ?? null, (g) => EMPHASIS_LABEL[g], cfg)
    : null;
  // Standing des aktuell gewählten Schwerpunkts im beobachteten Ranking (nur CS-bewertbare Gruppen).
  const rankable = obs.groups.filter((g) => g.csChange != null);
  const idx = rankable.findIndex((g) => g.group === opts.chosen);
  const chosenStanding = idx >= 0 ? { rank: idx + 1, of: rankable.length, stat: rankable[idx] } : null;
  return {
    chosen: opts.chosen,
    observed: obs.groups, observedBest: obs.best,
    declared: dec?.groups ?? null, declaredBest: dec?.best ?? null,
    chosenStanding, verdict: obs.note, confidence: obs.confidence, note: obs.note,
  };
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
  overtrainingHigh?: boolean;  // H-1: chronische Übertrainings-/RED-S-Signatur aktiv → Erholung an die Hauptfläche
  overtrainingWarn?: boolean;  // H-1: früher Wellness-Drift → keine Intensitäts-Empfehlung anbieten
}): DailyRec {
  const reasons: { code: string; text: string }[] = [];
  const p = (args.phase || "").toLowerCase();
  let sessionType = "Easy";
  let headline: string;
  let confidence: DailyRec["confidence"] = "mittel";

  if (args.overtrainingHigh) {
    sessionType = "Easy"; headline = "Erholung — deine Wellness-Werte deuten auf Übertraining";
    reasons.push({ code: "health_overtraining", text: "Chronische Wellness-Signale (Übertraining/RED-S) → Erholung geht heute vor Intensität" });
    confidence = "hoch";
  } else if (args.readinessLevel === "red") {
    sessionType = "Easy"; headline = "Erholung — locker oder Ruhetag";
    reasons.push({ code: "readiness_red", text: "Readiness niedrig → heute regenerieren statt belasten" });
    confidence = "hoch";
  } else if (p.includes("race week") || p.includes("raceweek") || p.includes("race-week")) {
    sessionType = "Easy"; headline = "Taper — kurz & locker (ggf. ein paar Steigerungen)";
    reasons.push({ code: "race_week", text: "Race Week → Frische aufbauen, Last reduzieren" });
  } else if (p.includes("entlast") || p.includes("deload")) {
    sessionType = "Easy"; headline = "Entlastungswoche — locker halten";
    reasons.push({ code: "deload", text: "Entlastungsphase (3:1) → Umfang/Intensität runter" });
  } else if (args.tsb != null && args.tsb > 5 && args.readinessLevel !== "yellow" && !args.overtrainingWarn) {
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
  if (args.overtrainingWarn && !args.overtrainingHigh) reasons.push({ code: "health_drift", text: "Wellness driftet (HRV/Ruhepuls) → Intensität heute konservativ halten" });
  if (args.readinessLevel === "yellow") reasons.push({ code: "readiness_yellow", text: "Readiness mittel → Intensität eher zurückhaltend" });
  if (args.ctlRamp != null && args.ctlRamp > CTL_RAMP_WARN) reasons.push({ code: "ramp_high", text: `CTL-Ramp hoch (${args.ctlRamp}/Woche) — nicht überziehen` });
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
  } else if (ctx.ctlRamp != null && ctx.ctlRamp > CTL_RAMP_WARN) {
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
  goalDistanceM?: number | null; // Item 3 (Frage B): Zieldistanz verschiebt das Verteilungs-Soll leicht
  healthCap?: { loadFactor: number; dropTopIntensity: boolean } | null; // Coach ToDo 35: hartes Gesundheits-Veto (RED-S/Übertraining)
  targetCtl?: number | null; // T8 (v2.7.0): progressive Überlast — rampt das TSS-Zielband gegen ein STEIGENDES Ziel-CTL
  //                            (statt gegen die aktuelle CTL, die im Erhaltungs-Gleichgewicht flach ausläuft). Das
  //                            Load-Impact-% bleibt gegen die ECHTE CTL (ehrlich). blockPlan deckelt zusätzlich per ACWR.
}): WeekStructureRec {
  const reasons: { code: string; text: string }[] = [];
  const p = (args.phase || "").toLowerCase();
  // T8: Zielband gegen das (ggf. gerampte) Ziel-CTL bilden; ohne targetCtl unverändert die aktuelle CTL.
  const bandCtl = args.targetCtl != null && args.targetCtl > args.ctl ? args.targetCtl : args.ctl;
  let tssRange = tssRecommendation(bandCtl, args.phase);
  // Health-first: ein high/warn-Gesundheits-Flag kappt die Wochenlast HART (skaliert das TSS-Ziel). Der konkrete
  // Intensitäts-Verzicht (VO2 raus) passiert in blockPlan an den echten Einheiten.
  if (args.healthCap && args.healthCap.loadFactor < 1) {
    const f = args.healthCap.loadFactor;
    tssRange = { ...tssRange, min: Math.round(tssRange.min * f), target: Math.round(tssRange.target * f), max: Math.round(tssRange.max * f) };
    reasons.push({ code: "health_cap", text: `Gesundheits-Cap: Wochenlast ×${f} (Health-first, übersteuert die Evidenz).` });
    if (args.healthCap.dropTopIntensity) reasons.push({ code: "health_intensity", text: "Gesundheits-Cap: höchste Intensität (VO2/Intervalle) diese Woche ausgesetzt." });
  }
  // C1 (Load-Regler): transparentes Load-Impact-Ziel (ATL:CTL) — konsistent mit dem Intensity-Trend-Graph.
  const loadPct = args.ctl > 0 ? Math.round((tssRange.target / (args.ctl * 7)) * 100) : null;
  if (loadPct != null) reasons.push({ code: "load_target", text: `Load-Impact-Ziel ~${loadPct}% ATL:CTL (${tssRange.kind}${loadPct >= 100 ? " · produktiv, Basis steigt" : " · Erholung/Erhalt"})` });
  let distTarget = phaseDistributionTarget(args.phase, null, args.goalDistanceM ?? null);
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
  if (args.ctlRamp != null && args.ctlRamp > CTL_RAMP_WARN) {
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

export interface BlockWeekInput { week_no: number; phase: string | null; start_date: string; dates: string[]; target_km?: number | null }

export interface BlockDay {
  date: string; weekdayIdx: number; type: string; isSecond: boolean;
  planned_min: number; planned_tss: number; description: string;
  zone_alloc: { byKm?: Record<number, number>; byMin?: Record<number, number> }; efforts: Effort[] | null; paceTarget: number | null;
  prescription?: { templateId: string; progress: number; ctlProgress?: number; targetTss: number } | null; // v1.7.0/v2.8.0: Intention für Live-Resolution
  adaptNote?: string | null; // T7: „angepasst an: Phase · TSB · Fitness · VDOT"
  emphasisNote?: string | null; // „Warum diese Einheit" (tpl.purpose) + Schwerpunkt-Label am evidenz-getriebenen Tag
}
export interface BlockWeek {
  week_no: number; start_date: string; phase: string | null;
  headline: string; periodizationModel: "block" | "traditional";
  tssTarget: number; tssActual: number; ctlStart: number; tsbStart: number | null;
  isDeload: boolean; days: BlockDay[];
  irFitness?: number | null; // Baustein 2.3: IR-Faltungs-Fitness je Woche (additiv im Endpoint gesetzt, wenn ein Dose-Run vorliegt)
  projVdot?: number | null;  // T10 (v2.7.0): prognostizierte VDOT/VO2max-Äquivalent je Woche (Richtung Ziel-VDOT, gedeckelt) — nur Anzeige
  cyclePhase?: string | null; // Zyklus-Steuerung: (ggf. prognostizierte) Menstruationszyklus-Phase dieser Woche (nur Anzeige/Timeline)
  reasons: { code: string; text: string }[]; confidence: WeekStructureRec["confidence"];
}

/** Zyklus-Bias je Planwoche (4. Steuer-Input) — vom Aufrufer (Coach-Route) aus der Zyklus-Engine abgeleitet, bounded. */
export interface CycleWeekBias {
  phase: string | null;
  emphasis: string | null;      // Planer-Emphasis (vo2|schwelle|berg|norwegian|fartlek) oder null (kein Typ-Tilt)
  loadFactor: number;           // sanfter Wochenlast-Faktor (~0.9..1.08), auf das Periodisierungs-Band geklemmt
  qualityVolFactor: number;     // Qualitäts-Volumen-Dämpfung (~0.85..1) bei aerob-/soften-Phasen
  tier: "measured" | "prior" | null;
  soften: boolean;
  reason: string | null;
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
  taperWeeks = 2, // Baustein 2.4: Anzahl Race-Specific-Wochen vor der Race Week = Taper-Länge (sportwiss. valide 1–3)
  forceTaperWindow = false, // v2.7.0 (T4 „Peak ausrichten"-Fix): Taper-Fenster (Race Week + Race Specific) auch
  //                          über bereits gepinnte Phasen NEU legen. Nur so kann eine geänderte Taper-Länge den
  //                          Peak verschieben, wenn die Wochen schon phasiert sind (sonst „wirkt nur 1×"). Der
  //                          Aufbau-Span davor bleibt respektvoll (nur leere füllen) — manuelle Phasen dort bleiben.
): (string | null)[] {
  const n = weeks.length;
  const out: (string | null)[] = weeks.map((w) => (w.phase && w.phase.trim() ? w.phase : null));
  // Bei erzwungenem Taper-Fenster: alte Taper-STRUKTUR-Pins (Race Week/Specific) tail-weit löschen, damit eine
  // KÜRZERE Taper-Länge keine veraltete Race-Specific-Woche vor dem neuen Fenster stehen lässt. Aufbau-Pins
  // (Base/Belastung/Entlastung) bleiben unberührt — nur die Renn-Anlauf-Struktur wird neu gelegt.
  if (forceTaperWindow) {
    for (let i = 0; i < n; i++) if (out[i] && /race ?week|race-week|race specific/i.test(out[i]!)) out[i] = null;
  }
  const set = (i: number, phase: string) => { if (i >= 0 && i < n && out[i] == null) out[i] = phase; };
  // Taper-Fenster: bei forceTaperWindow unbedingt setzen (überschreibt auch manuelle Aufbau-Pins im Fenster), sonst wie set.
  const setTaper = (i: number, phase: string) => { if (i >= 0 && i < n && (forceTaperWindow || out[i] == null)) out[i] = phase; };
  let raceIdx = -1;
  if (raceDate) {
    for (let i = 0; i < n; i++) {
      const end = addDaysIsoLocal(weeks[i].start_date, 6);
      if (raceDate >= weeks[i].start_date && raceDate <= end) { raceIdx = i; break; }
    }
    if (raceIdx < 0 && raceDate >= (weeks[n - 1]?.start_date ?? "")) raceIdx = n - 1; // Rennen ≥ letzte Woche
  }
  if (raceIdx >= 0) {
    setTaper(raceIdx, "Race Week");
    const specificStart = Math.max(0, raceIdx - Math.max(1, Math.min(3, Math.round(taperWeeks))));
    for (let i = specificStart; i < raceIdx; i++) setTaper(i, "Race Specific");
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

// VDOT/VO2max-Projektion (v2.7.0 — physiologisch korrigiert). VO2max wächst NICHT linear/unbegrenzt: der Zuwachs
// folgt abnehmendem Grenzertrag (schnell früh, dann Plateau) und ist über eine Saison realistisch BEGRENZT — je
// näher am eigenen Leistungs-Plateau, desto knapper. Der frühere lineare 0.4-VDOT/Woche-Ansatz projizierte über
// lange Blöcke absurde Zuwächse (+25 VDOT) — ersetzt durch eine Sättigungskurve gegen einen realistisch erreichbaren
// Zuwachs (nicht gegen ein evtl. utopisches Ziel-VDOT).
const VDOT_ANNUAL_GAIN = 4.5; // realistischer VDOT-Zuwachs pro JAHR bei vollem Kopfraum (Entwickler); mit Fitness sinkend
/** Kopf­raum bis zum Plateau: weniger realistischer Zuwachs, je höher die aktuelle Fitness (diminishing returns). */
function vdotHeadroom(curVdot: number): number {
  return Math.max(0.15, Math.min(1.1, (72 - curVdot) / 16)); // ~1.1 ≤VDOT 54, ~0.81 bei 59, ~0.5 bei 64, ~0.25 bei 68
}
/** Realistisch erreichbarer VDOT-Zuwachs über `weeks` (horizont-abhängig, mit Fitness-Kopfraum + Sättigung über Jahre). */
export function realisticVdotReach(curVdot: number, weeks: number): number {
  const years = Math.max(0, weeks) / 52;
  return VDOT_ANNUAL_GAIN * vdotHeadroom(curVdot) * Math.min(Math.sqrt(years), 2); // √Jahre = Sättigung, Deckel 2 Jahre
}

/**
 * Wöchentliche VDOT-Projektion: Sättigungskurve (diminishing returns) von der heutigen Fitness Richtung Ziel,
 * gedeckelt auf einen **horizont-abhängigen, realistisch erreichbaren** Zuwachs (`realisticVdotReach`) — mehr Zeit
 * ⇒ mehr möglich, aber je fitter, desto knapper. `perWeek[w]` = projizierte VDOT in Woche w (0 = heute).
 * `infeasible` = Ziel liegt ÜBER dem realistisch Erreichbaren (ehrlich — die Prognose reicht dann nicht ans Ziel).
 */
export function projectVdot(curVdot: number, goalVdot: number, weeks: number): VdotProjection {
  const need = goalVdot - curVdot;
  const W = Math.max(0, Math.round(weeks));
  const reach = need <= 0 ? 0 : Math.min(need, realisticVdotReach(curVdot, W)); // realistisch erreichbarer Zuwachs
  const tau = Math.max(6, Math.min(20, W / 3)); // Sättigungs-Zeitkonstante (Wochen) — skaliert mit dem Block
  const perWeek: number[] = [];
  for (let w = 0; w <= W; w++) {
    const gain = reach > 0 ? reach * (1 - Math.exp(-w / tau)) : 0; // abnehmender Grenzertrag, Plateau gegen reach
    perWeek.push(Math.round((curVdot + gain) * 100) / 100);
  }
  return { perWeek, goalVdot, curVdot, infeasible: need > reach + 1e-9 };
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
  curTsb?: number | null;       // T7: aktuelle Form → verschiebt den Reps-Zielwert im Band (nur naher Live-Kontext)
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
  presc: { templateId: string; progress: number; ctlProgress?: number; targetTss: number },
  sessionDate: string,
  ctx: ResolveCtx,
): { planned_min: number; planned_km?: number | null; zone_alloc: { byKm?: Record<number, number>; byMin?: Record<number, number> }; efforts: Effort[] | null; description: string; paceTarget: number | null; adaptNote?: string | null } | null {
  const tpl = workoutById(presc.templateId);
  if (!tpl || !ctx.curVdot) return null;
  const weeksUntil = Math.max(0, Math.round((Date.parse(sessionDate + "T00:00:00Z") - Date.parse(ctx.today + "T00:00:00Z")) / (7 * 86400000)));
  const goalVdot = ctx.goalTimeS && ctx.goalDistanceM ? vdot(ctx.goalDistanceM, ctx.goalTimeS) : ctx.curVdot;
  // v2.7.0: konsistent mit projectVdot — Sättigungskurve statt linear (physiologisch, diminishing returns).
  const projVdot = projectVdot(ctx.curVdot, goalVdot, weeksUntil).perWeek[weeksUntil] ?? ctx.curVdot;
  const zones = zonesForWeek(ctx.baseZones, projVdot, ctx.goalDistanceM);
  const fitness = fitnessLevel(ctx.curCtl, zones.cs_pace ?? null, ctx.curVdot); // T7: VDOT verfeinert
  const tsb = weeksUntil <= 1 ? (ctx.curTsb ?? null) : null; // TSB nur für die nahe Einheit (Projektion sonst unsicher)
  // v2.8.0: persistiertes ctlProgress (aus dem Block-Bau) wieder mitgeben — resolvePlannedSession kennt selbst
  // keine Season-Baseline, kann ctlProgress also nicht neu herleiten, nur den gespeicherten Wert weiterreichen.
  const c = renderWorkout(tpl, { zones, fitness, progress: presc.progress, ctlProgress: presc.ctlProgress, targetTss: presc.targetTss, tsb, vdot: ctx.curVdot, goalDistanceM: ctx.goalDistanceM ?? null });
  return { planned_min: c.planned_min, planned_km: c.planned_km ?? null, zone_alloc: c.zone_alloc, efforts: c.efforts, description: c.description, paceTarget: c.paceTarget, adaptNote: c.adaptNote ?? null };
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

// ---- Baustein B1: per-Einheiten-Typ Volumen-Loop aus RPE + felt_vs_expected ----------------------------------
export interface SessionFbRow { session_family: string | null; rpe: number | null; felt_vs_expected: number | null; confounder_flag: string | null }
/** Grobe Qualitäts-Familie eines Typs/`session_family` fürs Matching (vo2/race/lt2/lt1/hill). */
function normFamily(s: string | null | undefined): string {
  const t = (s ?? "").toLowerCase();
  if (/vo2|intervall/.test(t)) return "vo2";
  if (/renntempo|race|renn/.test(t)) return "race";
  if (/lt2|threshold|schwelle|tempo/.test(t)) return "lt2";
  if (/lt1|steady|marathon|sub/.test(t)) return "lt1";
  if (/hill|berg/.test(t)) return "hill";
  if (/long/.test(t)) return "long";
  if (/easy|ga1|recovery/.test(t)) return "easy";
  return t || "other";
}
/**
 * Aus den letzten Rückmeldungen je Qualitäts-Familie einen Volumen-Faktor ableiten: `felt_vs_expected` (positiv =
 * leichter/stärker → mehr; negativ = härter → weniger) + RPE (hoch = härter → weniger). Confounder (krank/Reise) raus.
 * Bounded 0.8..1.15; erst ab ≥2 Einheiten. Rein — DB-Abfrage macht der Aufrufer.
 */
export function typeVolumeFactors(rows: SessionFbRow[], maxPerFamily = 4): { factors: Record<string, number>; notes: string[] } {
  const byFam = new Map<string, SessionFbRow[]>();
  for (const r of rows) {
    if (r.confounder_flag) continue;
    const f = normFamily(r.session_family);
    if (f === "easy" || f === "long" || f === "other") continue; // nur echte Qualität steuern
    const arr = byFam.get(f) ?? []; if (arr.length < maxPerFamily) { arr.push(r); byFam.set(f, arr); }
  }
  const factors: Record<string, number> = {}; const notes: string[] = [];
  const LABEL: Record<string, string> = { vo2: "VO2max", race: "Race Specific", lt2: "LT2 (Schwelle)", lt1: "LT1", hill: "Berg" };
  for (const [fam, arr] of byFam) {
    if (arr.length < 2) continue;
    const felts = arr.map((r) => r.felt_vs_expected).filter((v): v is number => v != null);
    const rpes = arr.map((r) => r.rpe).filter((v): v is number => v != null);
    const feltAvg = felts.length ? felts.reduce((a, b) => a + b, 0) / felts.length : 0;
    const rpeAvg = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
    let factor = 1 + feltAvg * 0.06 + (rpeAvg != null ? -(rpeAvg - 6) * 0.03 : 0);
    factor = Math.max(0.8, Math.min(1.15, Math.round(factor * 100) / 100));
    factors[fam] = factor;
    if (Math.abs(factor - 1) >= 0.05) notes.push(`${LABEL[fam] ?? fam} zuletzt ${factor < 1 ? "härter als erwartet → Volumen −" : "leichter → Volumen +"} (×${factor}, Pace bleibt)`);
  }
  return { factors, notes };
}

// T8 (v2.7.0) — Progressive Überlast. Ohne diesen Lift referenziert das TSS-Zielband die AKTUELLE CTL und läuft
// über die Blöcke in ein Erhaltungs-Gleichgewicht (CTL steigt anfangs, plateaut dann — sichtbar flach übers Jahr,
// img-30). Produktive Aufbauwochen (Base/Belastung) rampen deshalb das Band-Ziel-CTL modest über die aktuelle CTL,
// sodass die Last kontinuierlich STEIGT. ACWR-gedeckelt: Lift ≤ PROG_LIFT_CAP der aktuellen CTL, und die fertige
// Wochenlast zusätzlich hart auf ACWR_WEEK_CAP × (CTL×7) geklemmt. Specific (Schärfung) und Deload/Taper rampen NICHT.
const PROG_RAMP_PER_WEEK = 0.02; // Band-Ziel-CTL-Lift je produktiver Aufbauwoche (kumulativ bis Cap)
const PROG_LIFT_CAP = 0.10;      // max. Band-CTL-Lift über der aktuellen CTL (Sicherheits-Deckel)
const ACWR_WEEK_CAP = 1.45;      // harte Wochen-Deckelung acute:chronic — konsistent mit tssRecommendation

// T9a (v2.7.0) — Taper-Guard: kein harter Reiz zu nah am Rennen, sonst kommt die Superkompensation nicht an
// (behebt „VO2max 2 Tage vorm Rennen"). Eine geplante Qualität mit effort ≥ HARD gilt als „hart"; fällt sie in die
// letzten RACE_HARD_CUTOFF_DAYS vor dem Renntag, wird sie als locker gerendert (downgrade → easy_ga1). Steigerungen
// (strides, effort 2) bleiben erlaubt (neuromuskuläre Öffner sind vor dem Rennen erwünscht).
const RACE_HARD_CUTOFF_DAYS = 4; // letzte harte Einheit ≥ 4 Tage vor dem Rennen (Standard-Taper-Regel)
const TAPER_HARD_EFFORT = 4;     // effort ≥ 4 = harte Qualität (LT2/VO2/Renntempo/lange Berg-Reps)

// CTL-Ramp-Steuerung (v2.7.0): „physiologisch sinnvoller Fitnessanstieg" — Warnung ab 6 CTL/Woche (aggressiver
// Bereich), harte Kappung der Wochenlast, sodass die projizierte Ramp 8 CTL/Woche nicht übersteigt (Verletzungs-/
// Übertrainings-Grenze). Umrechnung Ramp→Wochen-TSS über die CTL-EWMA (7-Tage-Anteil ≈ 0.1545 → 45 TSS je Ramp-Punkt
// über der Erhaltung von CTL×7).
const CTL_RAMP_WARN = 6;         // Grund „ramp_high" ab dieser Wochen-Ramp (vorher 8) — „eher so 6"
const RAMP_HARD_CAP = 8;         // projizierte Wochen-Ramp NIE über 8 CTL/Woche
// v3.1.0: Spielraum des km-Angleichs (Easy/Long an das Wochen-km-Ziel). Vorher 0.7…1.4 — zu eng: ein bewusst
// gesetztes km-Ziel (Wizard/Saisonplan) konnte den Plan nicht wirklich steuern. Qualität bleibt unskaliert.
const KM_ALIGN_MIN = 0.55;
const KM_ALIGN_MAX = 1.45;
const RAMP_TSS_PER_POINT = 45;   // Wochen-TSS je zusätzlichem Ramp-Punkt über CTL×7 (aus der 42-Tage-EWMA)
// v2.7.0 (Kolja): produktive Aufbauwochen (Nicht-Deload) zielen an den oberen sicheren ACWR-Rand, damit die
// CTL-Ramp über MEHR VOLUMEN so hoch wie sicher möglich wird (Wunsch „Ramp Richtung 4"). Physik: Ramp 4 bräuchte
// ACWR ~1.52 (>1.45) bei CTL 50 — daher hier der Rand knapp unter dem Cap; die volle 4 erreicht die Ramp erst mit
// steigender CTL (bei CTL ~60 = ACWR ~1.43). ACWR_WEEK_CAP + RAMP_HARD_CAP + Deloads + Health-Cap bleiben Sicherung.
const PRODUCTIVE_ACWR_BASE = 1.30;  // Ziel-acute:chronic in Base-Wochen (Volumen-Grundlage, etwas moderater)
const PRODUCTIVE_ACWR_BUILD = 1.42; // Ziel-acute:chronic in Belastungswochen (knapp unter dem Cap 1.45)
//                                     Base < Build erhält die Progression über den Mesozyklus; die Mesozyklus-weite
//                                     Progression kommt zusätzlich aus der steigenden CTL (gleicher ACWR ⇒ mehr TSS).

// Item 1 (v2.8.0) — Reps/Sets/Dauer-Progression: `ctlProgress` (0..1) = wie weit der aktuelle CTL-Anstieg über die
// Block-Baseline das Reps/Sets-Band ausschöpft. CEILING_MULT moderat (Kolja-Entscheidung: +35% CTL = volles Band).
const CTLPROGRESS_CEILING_MULT = 1.35;
// Sprung-Limiter (Kolja: „mittlerer Deckel, max 1-2 Bandstufen/Woche") — begrenzt den week-over-week-Sprung von
// ctlProgress selbst (nicht erst am Output), damit ALLE Templates gleichermaßen geschützt sind. Kalibriert per
// Runner: 0.15 entspricht bei repräsentativen Bändern (z.B. norw_400s [10,12]→[20,25]) ~1-2 Reps/Woche.
const MAX_CTLPROGRESS_STEP_PER_WEEK = 0.15;

// Distanz-abhängiger Taper-Floor (v2.7.0): ein Marathon braucht trainingswissenschaftlich MEHR Taper als ein 5k —
// gerade nach vielen Trainingswochen. Der persönliche (Banister-)Taper darf den Floor VERLÄNGERN, aber nicht
// unterschreiten (auch wenn die Eigen-Analyse „nur 3 Tage" sagt — bei wenig/keiner Renn-Erfahrung ist der
// distanz-typische Taper die sichere Untergrenze). Race-Specific-Wochen VOR der Race Week + Tages-Ramp.
function taperFloorWeeks(goalDistanceM: number | null): number {
  const m = goalDistanceM ?? 0;
  if (m >= 30000) return 2; // Marathon: ≥2 Race-Specific-Wochen (+ Race Week ≈ 3 Wo Taper)
  return 1;                 // HM/10k/5k: ≥1
}
function taperFloorDays(goalDistanceM: number | null): number {
  const m = goalDistanceM ?? 0;
  if (m >= 30000) return 14; // Marathon: mind. 2 Wochen Tages-Taper
  if (m >= 15000) return 10; // HM
  if (m >= 7000) return 7;   // 10k
  return 5;                  // 5k/kurz
}

// T12 (v2.7.0) — Reverse-from-Race-Peak-Steuerung: progressiver Volumen-Taper im Renn-Anlauf. Ohne ihn bleiben die
// „Race Specific"-Wochen hoch belastet (Ratio 1.15–1.32), die Ermüdung wird nicht abgebaut → die Renn-Woche erreicht
// nicht den Frische-Sweet-Spot (TSB ~+12), und der Form-Peak fällt auf eine FRÜHERE Deload-Woche (Bug „Peak zu früh").
// Die Wochenlast (acute:chronic) wird im letzten Taper-Fenster fallend gedeckelt (Fensteranfang → Renntag); die
// Qualitäts-AUSWAHL (Intensität) bleibt, nur das VOLUMEN sinkt (klassischer Taper: Volumen runter, Intensität halten).
const TAPER_START_RATIO = 0.92; // Wochenlast am Taper-Fensteranfang (acute:chronic)
const TAPER_RACE_RATIO = 0.50;  // Wochenlast in der Renn-Woche (tiefster Punkt)

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
  emphasisPreference?: string | null; // Coach ToDo 35: evidenz-/manuell-aufgelöster Schwerpunkt → pickWeekWorkouts
  emphasisTier?: "beobachtet" | "geprüft" | null; // v3.1.0: nur „geprüft" darf einen Distanz-Pflichtreiz verschieben
  healthCap?: { loadFactor: number; dropTopIntensity: boolean } | null; // Coach ToDo 35: hartes Gesundheits-Veto (nur nächste Woche)
  goalDistanceM?: number | null; // v1.6.2: Zieldistanz → distanzgerechte Race-Specific-Auswahl
  curVdot?: number | null;       // v1.7.0: aktuelles VDOT (Start der Projektion)
  goalTimeS?: number | null;     // v1.7.0: Wunsch-Zielzeit → Ziel-VDOT (treibt die Pace-Progression)
  tuneups?: { date: string; distanceM: number | null; goalTimeS: number | null }[]; // v1.10.0: Test-/Aufbauwettkämpfe
  taperWeeks?: number; // Baustein 2.4: Taper-Länge (Race-Specific-Wochen vor der Race Week); Default 2
  taperDays?: number;  // Banister: renntag-genaue Taper-Länge (Tage). Rampt die Last tages-präzise in die Grenzwoche
  //                      vor der Race Week (die Race Week trägt ihren eigenen Wochen-Taper). Null = keine Tages-Rampe.
  kmCeilingBase?: number | null; // Baustein A1: verletzungssicheres km-Ceiling (nächste Woche); wächst ~7%/Blockwoche
  volumeByFamily?: Record<string, number>; // Baustein B1: Volumen-Faktor je Qualitäts-Familie (RPE/Completion-Loop)
  cycleByWeek?: Map<number, CycleWeekBias>; // 4. Steuer-Input: Zyklus-Bias je Woche (week_no), gestuft + bounded
}): BlockPlan {
  const projected = new Map<string, number>(); // generierter Plan-TSS je Tag (vorwärts akkumuliert)
  const outWeeks: BlockWeek[] = [];
  let lowConf = false;
  let productiveWeeks = 0; // T8: Zähler produktiver Aufbauwochen (Base/Belastung) für die progressive Last-Rampe
  // v2.8.0 (Item 1): kontinuierlicher CTL-Fortschritts-Score fürs Reps/Sets/Dauer-Ceiling — ersetzt das phasen-
  // lokale (bei jedem 4.-Wochen-Deload sägezahnende) `progress` in workouts.ts. `baselineCtl` wird bei wi===0
  // (heutige Fitness) einmalig gesnapshotet; `prevCtlProgress` trägt den Sprung-Limiter (Kolja: max ~1-2
  // Reps/Sets-Einheiten Sprung pro Woche, kalibriert über MAX_CTLPROGRESS_STEP_PER_WEEK).
  let baselineCtl = 0;
  let prevCtlProgress: number | null = null;
  // P1: Phasen ableiten (nur leere füllen) — manuelle Phasen gewinnen. Ausnahme: „Peak ausrichten" liefert explizit
  // taperWeeks/taperDays → dann wird das Taper-Fenster neu gelegt (T4-Fix), sonst „wirkt es nur einmal".
  const forceTaper = args.taperWeeks != null || args.taperDays != null;
  // v2.7.0 Taper-Floor: distanz-typische Untergrundgrenze — persönlicher Taper darf verlängern, nicht unterschreiten.
  // Der Tages-Taper wird jetzt IMMER angewandt (nicht nur bei „Peak ausrichten"), sonst tapert der Normal-Pfad einen
  // Marathon faktisch nur die Race Week (= „kaum tabern"). Ohne Renntag: kein Taper.
  const effTaperWeeks = args.taperWeeks != null ? Math.max(args.taperWeeks, taperFloorWeeks(args.goalDistanceM ?? null)) : args.taperWeeks;
  const effTaperDays = args.raceDate
    ? Math.max(args.taperDays ?? 0, taperFloorDays(args.goalDistanceM ?? null))
    : (args.taperDays ?? undefined);
  const phases = derivePhaseSequence(args.weeks.map((w) => ({ week_no: w.week_no, start_date: w.start_date, phase: w.phase })), args.raceDate, effTaperWeeks, forceTaper);
  // T12: Index der Renn-Woche (für den Taper-Ramp „Wochen bis zur Renn-Woche" — nicht bis zum Renn-DATUM, sonst
  // bekäme die Renn-Woche selbst nur den halben Taper, weil das Rennen an ihrem Ende liegt).
  let raceWkIdx = -1;
  if (args.raceDate) {
    for (let i = 0; i < args.weeks.length; i++) {
      const end = addDaysIsoLocal(args.weeks[i].start_date, 6);
      if (args.raceDate >= args.weeks[i].start_date && args.raceDate <= end) { raceWkIdx = i; break; }
    }
    if (raceWkIdx < 0 && args.raceDate >= (args.weeks[args.weeks.length - 1]?.start_date ?? "")) raceWkIdx = args.weeks.length - 1;
  }
  // T12: Länge des Renn-Anlaufs (zusammenhängende Race-Specific + Race Week bis zum Renntag) aus der Phasenfolge —
  // der Volumen-Taper spannt den GANZEN Anlauf, nicht nur die distanz-typische Zahl (sonst tapert die erste
  // Race-Specific-Woche nicht mit und bleibt hoch belastet).
  let taperSpanWks = 0;
  if (raceWkIdx >= 0) {
    for (let i = raceWkIdx; i >= 0; i--) {
      if (/race ?week|raceweek|race ?specific/.test((phases[i] ?? "").toLowerCase())) taperSpanWks++;
      else break;
    }
  }
  taperSpanWks = Math.max(1, taperSpanWks);

  // v1.7.0: Fitness-Projektion heute → Wunsch-Zielzeit; je Woche progressierte Pace-Anker.
  const wkOffset = (d: string) => Math.max(0, Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(args.today + "T00:00:00Z")) / (7 * 86400000)));
  const lastStart = args.weeks.length ? args.weeks[args.weeks.length - 1].start_date : args.today;
  const totalWeeks = Math.max(1, wkOffset(args.raceDate ?? lastStart));
  const goalVdot = args.curVdot && args.goalTimeS && args.goalDistanceM ? vdot(args.goalDistanceM, args.goalTimeS) : null;
  const proj = args.curVdot && goalVdot ? projectVdot(args.curVdot, goalVdot, totalWeeks) : null;

  args.weeks.forEach((w, wi) => {
    const phase = phases[wi] ?? w.phase;
    // 4. Steuer-Input: Zyklus-Bias dieser Woche (bounded); null = kein Eingriff. Reuse taperFactor/target/emphasis-Hebel.
    const cyc = args.cycleByWeek?.get(w.week_no) ?? null;
    // Baustein 2.4 + T12: Taper/Deload → VOLUMEN runter (Qualitäts-Reps UND Easy/Long), Pace/Intensität bleibt.
    // Ein EINHEITLICHER taperRatio steuert den ganzen Renn-Anlauf (Race Specific + Race Week) fallend Richtung Renntag:
    // damit sinkt das Volumen der quality-dichten Race-Specific-Wochen (vorher voll belastet → Ermüdung blieb, Peak
    // fiel zu früh). Deload = 0.7, normal = 1. Zyklus dämpft zusätzlich (health-first).
    const pLow = (phase ?? "").toLowerCase();
    const inRaceTaper = /race ?week|raceweek|race ?specific/.test(pLow);
    let taperRatio = /entlast|deload/.test(pLow) ? 0.7 : 1;
    if (args.raceDate && inRaceTaper && raceWkIdx >= 0) {
      const weeksToRace = Math.max(0, raceWkIdx - wi); // 0 = Renn-Woche, 1 = letzte Race-Specific, …
      const frac = Math.min(1, weeksToRace / taperSpanWks); // 0 = Renn-Woche, →1 = Anlauf-Beginn (spannt den ganzen Anlauf)
      taperRatio = TAPER_RACE_RATIO + (TAPER_START_RATIO - TAPER_RACE_RATIO) * frac;
    }
    const taperFactor = taperRatio * (cyc?.qualityVolFactor ?? 1);
    // Baustein B1: Volumen-Faktor je Pick aus dem RPE/Completion-Loop (Familie des Templates).
    const volFor = (t?: WorkoutTemplate | null): number => (t ? (args.volumeByFamily?.[normFamily(t.family)] ?? 1) : 1);
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

    // Item 1 (v2.8.0): kontinuierlicher Reps/Sets/Dauer-Fortschritts-Score aus dem CTL-Anstieg über die Block-
    // Baseline (heutige Fitness bei wi===0) — ersetzt das phasen-lokale, sägezahnende `progress` in workouts.ts.
    if (wi === 0) baselineCtl = ctl;
    let ctlProgress = baselineCtl > 0 ? Math.max(0, Math.min(1, (ctl - baselineCtl) / (baselineCtl * (CTLPROGRESS_CEILING_MULT - 1)))) : 0;
    if (prevCtlProgress != null) {
      ctlProgress = Math.max(prevCtlProgress - MAX_CTLPROGRESS_STEP_PER_WEEK, Math.min(prevCtlProgress + MAX_CTLPROGRESS_STEP_PER_WEEK, ctlProgress));
    }
    prevCtlProgress = ctlProgress;

    // T8: progressive Überlast — nur produktive Aufbauwochen (Base/Belastung, kein Deload) rampen das Band-Ziel-CTL
    // modest über die aktuelle CTL. Specific/Deload/Taper/Recovery halten bzw. reduzieren (Schärfung/Erholung).
    const pL = (phase || "").toLowerCase();
    const isProductive = /base|aufbau|belast/.test(pL) && !/entlast|deload|specific|spec|race|krank|recovery|erholung/.test(pL);
    const progLift = isProductive ? Math.min(PROG_LIFT_CAP, PROG_RAMP_PER_WEEK * productiveWeeks) : 0;
    const targetCtl = progLift > 0 && ctl > 0 ? ctl * (1 + progLift) : null;
    if (isProductive) productiveWeeks++;

    // Readiness fließt nur in die unmittelbar nächste Woche ein (Zukunft unbekannt).
    const rec = weekStructureRecommendation({
      ctl, tsb, ctlRamp: ramp, phase, weekNo: w.week_no,
      readinessLevel: wi === 0 ? args.readinessLevel : null,
      methodPreference: args.methodPreference ?? null,
      goalDistanceM: args.goalDistanceM ?? null,
      healthCap: wi === 0 ? (args.healthCap ?? null) : null, // Gesundheits-Cap nur auf die unmittelbar nächste Woche (Zukunft = Erholung erhofft)
      targetCtl, // T8: gerampte Band-Basis (nur produktive Wochen); null = aktuelle CTL wie bisher
    });
    // Zyklus-Last (sanft): Ziel-TSS × loadFactor, GEKLEMMT ins Periodisierungs-Band [min,max] → km-Ceiling + Health-Cap
    // kappen unverändert darüber; Menstruation/späte Luteal etwas weniger, günstige Phase minimal mehr.
    const rawTarget = cyc?.loadFactor && cyc.loadFactor !== 1
      ? Math.max(rec.tssRange.min, Math.min(rec.tssRange.max, Math.round(rec.tssRange.target * cyc.loadFactor)))
      : rec.tssRange.target;
    // T8: harte ACWR-Deckelung der fertigen Wochenlast relativ zur AKTUELLEN CTL (acute:chronic ≤ Cap) — der Lift
    // darf die Basis anheben, aber nie eine einzelne Woche über den sicheren acute:chronic-Bereich treiben.
    const acwrCap = ctl > 0 ? Math.round(ACWR_WEEK_CAP * ctl * 7) : Infinity;
    // v2.7.0: zusätzliche harte Ramp-Deckelung — die Wochenlast darf die projizierte CTL-Ramp nicht über RAMP_HARD_CAP
    // (8/Woche) treiben. Greift v.a. bei niedriger CTL / Wiedereinstieg (dort hat ACWR mehr Spielraum als sinnvoll).
    const rampCap = ctl > 0 ? Math.round(7 * ctl + RAMP_TSS_PER_POINT * RAMP_HARD_CAP) : Infinity;
    // Kolja: produktive Aufbauwochen an den oberen ACWR-Rand heben (Ramp über Volumen maximieren) — gedeckelt vom
    // ACWR-Cap; nur Base/Belastung (isProductive), Deload/Taper/Recovery bleiben unberührt. Greift nur nach oben.
    // Base moderater als Belastung → Progression über den Mesozyklus.
    const acwrAim = /belast|build|aufbau/.test(pL) ? PRODUCTIVE_ACWR_BUILD : PRODUCTIVE_ACWR_BASE;
    const productiveFloor = isProductive && ctl > 0 ? Math.round(acwrAim * ctl * 7) : 0;
    const rawTargetFloored = Math.max(rawTarget, productiveFloor);
    // T12: der oben berechnete taperRatio deckelt zusätzlich die Wochenlast (acute:chronic) im Renn-Anlauf → Easy/Long
    // sinken parallel zum Qualitäts-Volumen, TSB steigt in den Frische-Sweet-Spot, Peak fällt auf den Renntag.
    const taperCap = args.raceDate && inRaceTaper && ctl > 0 ? Math.round(taperRatio * ctl * 7) : Infinity;
    const target = Math.min(rawTargetFloored, acwrCap, rampCap, taperCap);
    if (progLift > 0 && target > rec.tssRange.target * 0.999) {
      rec.reasons.push({ code: "progressive_overload", text: `Progressive Überlast: Aufbau-Ziel +${Math.round(progLift * 100)}% über Erhalt → Fitness steigt kontinuierlich (ACWR-gedeckelt, Deloads bleiben)` });
    }

    // v1.6.1: konkrete Einheiten aus der Workout-Bibliothek — Rotation + Progression + Fitness-Skalierung.
    const { weekInPhase, phaseLen } = phaseProgress(phases, wi);
    const progress = phaseLen > 1 ? weekInPhase / (phaseLen - 1) : 0.5;
    const fitness = fitnessLevel(ctl, weekZones.cs_pace ?? null, args.curVdot); // T7: VDOT verfeinert das Level
    // Coach ToDo 35: der aufgelöste Schwerpunkt (Evidenz gewinnt bei Belastbarkeit, sonst manuell) ersetzt die
    // Availability-Emphasis. pickWeekWorkouts dreht daraufhin EINE Qualität Richtung Schwerpunkt (nur Build/Specific).
    // Zyklus-Typ-Tilt der Woche gewinnt über den Block-Schwerpunkt (Reihenfolge: Health-Cap > Periodisierung > Zyklus > Block).
    const effEmphasis = cyc?.emphasis ?? args.emphasisPreference ?? args.availability?.emphasis ?? null;
    let picks = pickWeekWorkouts(phase, weekInPhase, fitness, !!args.availability?.allowDoubles, args.goalDistanceM ?? null, args.availability?.corePerWeek ?? 0,
      { emphasis: effEmphasis, favoriteWorkouts: args.availability?.favoriteWorkouts, avoidWorkouts: args.availability?.avoidWorkouts, ctlProgress, emphasisTier: args.emphasisTier ?? null });
    // Gesundheits-Cap (nur nächste Woche): höchste Intensität raus — VO2-Qualitäten entfernen (Easy/Long füllen die Last).
    if (wi === 0 && args.healthCap?.dropTopIntensity) picks = picks.filter((pk) => !(pk.role === "quality" && pk.tpl.family === "VO2"));

    // T12: im Renn-Anlauf die ANZAHL harter Qualitäten reduzieren (nicht nur die Reps) — die quality-dichten
    // Race-Specific-Wochen bleiben sonst zu schwer, die Ermüdung wird nicht abgebaut, der Peak fällt zu früh.
    // Tiefe je taperRatio: früh im Anlauf 2 harte Reize, mittlerer Taper 1 (kurze Schärfe), Race-Woche 0 (nur
    // Steigerungen, kein Longrun). Der weggefallene Reiz wird durch Easy ersetzt (Frische geht vor Volumen).
    if (args.raceDate && inRaceTaper) {
      const maxHardQ = taperRatio >= 0.82 ? 2 : taperRatio >= 0.62 ? 1 : 0;
      let keptHard = 0;
      picks = picks.filter((p) => {
        const hardQ = p.role === "quality" && p.tpl.id !== "strides";
        if (!hardQ) return true;
        return keptHard++ < maxHardQ; // die erste(n) Qualität(en) = der Renn-spezifische Reiz, Rest raus
      });
      if (taperRatio < 0.6) picks = picks.filter((p) => p.role !== "long"); // Race-Woche: kein Longrun
    }

    // Quality-TSS schätzen → Easy/Long füllen die Restdifferenz zum Wochen-Ziel (Hybrid).
    let qTss = 0;
    for (const p of picks) if (p.role === "quality") qTss += renderWorkout(p.tpl, { zones: weekZones, fitness, progress, ctlProgress, vdot: args.curVdot ?? null, phaseLabel: phase, taperFactor, volumeFactor: volFor(p.tpl), goalDistanceM: args.goalDistanceM ?? null }).planned_tss;
    const remaining = Math.max(0, target - qTss);
    const longs = picks.filter((p) => p.role === "long");
    const easies = picks.filter((p) => p.role === "easy");
    const longShare = longs.length ? (remaining * 0.45) / longs.length : 0;
    const easyShare = easies.length ? (remaining * 0.55) / easies.length : 0;
    const units: PlannedUnit[] = picks.map((p) => {
      const tgt = p.role === "long" ? Math.round(longShare) : p.role === "easy" ? Math.round(easyShare) : 0;
      return { type: p.tpl.sessionType, targetTss: tgt, role: p.role, ref: { tpl: p.tpl, progress, ctlProgress, targetTss: tgt, emph: p.emph }, pair: p.pair };
    });

    // Auf Wochentage verteilen + je Einheit rendern.
    const scheduled = scheduleWeek(units, args.availability, w.dates);
    // T9a Taper-Guard: harte Qualität (effort ≥ 4) in den letzten RACE_HARD_CUTOFF_DAYS vor dem Rennen → locker
    // (downgrade). Schützt die Renn-Frische; Steigerungen (effort 2) bleiben. Greift phasenübergreifend (auch wenn
    // eine späte Race-Specific-Einheit datumsmäßig zu nah ans Rennen rutscht), nicht nur in der Race Week.
    let taperGuarded = false;
    if (args.raceDate) {
      for (const su of scheduled) {
        if (su.downgrade) continue;
        const tpl = (su.ref as { tpl?: WorkoutTemplate } | undefined)?.tpl;
        const hard = tpl ? (tpl.effort ?? 0) >= TAPER_HARD_EFFORT : /threshold|lt2|vo2|hill|race|renntempo/i.test(su.type);
        if (!hard) continue;
        const daysToRace = Math.round((Date.parse(args.raceDate + "T00:00:00Z") - Date.parse(su.date + "T00:00:00Z")) / 86_400_000);
        if (daysToRace >= 0 && daysToRace <= RACE_HARD_CUTOFF_DAYS) { su.downgrade = true; taperGuarded = true; }
      }
    }
    if (taperGuarded) rec.reasons.push({ code: "taper_guard", text: `Taper-Schutz: harte Einheit < ${RACE_HARD_CUTOFF_DAYS} Tage vor dem Rennen → locker umgewandelt (Renn-Frische geht vor, keine späte VO2/Schwelle)` });
    // T12: transparenter Hinweis auf den fallenden Volumen-Taper (einmal, in der Renn-Woche).
    if (inRaceTaper && raceWkIdx === wi) rec.reasons.push({ code: "taper_volume", text: "Volumen-Taper: Last im Renn-Anlauf fallend heruntergefahren (Intensität gehalten, Anzahl harter Einheiten reduziert) → Form-Peak auf den Renntag legen" });
    const days: BlockDay[] = [];
    let tssActual = 0, downgraded = false;

    // Render-Closure (eine Quelle für Erst-Render + km-Angleichung): Einheit → konkrete Session bei gegebener Ziel-TSS.
    // v3.1.0: `weekKm` steuert die Longrun-Anteilsregel (25–30 % des Wochenumfangs, strengste Grenze gewinnt).
    let weekKmForLong: number | null = w.target_km ?? null;
    const renderUnit = (su: typeof scheduled[number], tss: number): ConcreteSession => {
      const ref = su.ref as { tpl: WorkoutTemplate; progress: number; ctlProgress?: number; targetTss: number } | undefined;
      const maxMin = su.budgetMin > 0 ? su.budgetMin : undefined;
      const base = { zones: weekZones, fitness, targetTss: tss, maxMin, vdot: args.curVdot ?? null, phaseLabel: phase, taperFactor, goalDistanceM: args.goalDistanceM ?? null, weekKm: weekKmForLong };
      // Strikte Erholungsregel (v1.7.0): keine zwei harten Tage hintereinander → diese Qualität wird locker.
      if (su.downgrade && ref?.tpl) return renderWorkout(workoutById("easy_ga1") ?? ref.tpl, { ...base, progress: ref.progress, ctlProgress: ref.ctlProgress, volumeFactor: volFor(ref?.tpl) });
      if (ref?.tpl) return renderWorkout(ref.tpl, { ...base, progress: ref.progress, ctlProgress: ref.ctlProgress, volumeFactor: volFor(ref?.tpl) });
      return concretizeSession(su.type, tss, weekZones, su.budgetMin > 0 ? { maxMin: su.budgetMin } : undefined);
    };
    const kmOf = (c: ConcreteSession): number => c.planned_km ?? Object.values(c.zone_alloc?.byKm ?? {}).reduce((a, b) => a + (b || 0), 0);

    // Erst-Render je Einheit; Easy/Long-Familien markieren (Frage A: deren Volumen an target_km angleichen).
    type Rendered = { su: typeof scheduled[number]; c: ConcreteSession; baseTss: number; scalable: boolean };
    const renderAll = (): Rendered[] => scheduled.map((su) => {
      const ref = su.ref as { tpl: WorkoutTemplate; progress: number; targetTss: number } | undefined;
      const baseTss = su.downgrade ? (Math.round(easyShare) || 50) : (ref?.targetTss ?? su.targetTss);
      const fam = su.downgrade ? "Easy" : ref?.tpl.family;
      return { su, c: renderUnit(su, baseTss), baseTss, scalable: fam === "Easy" || fam === "Long" };
    });
    let rendered: Rendered[] = renderAll();
    // Ohne gepflegtes target_km ist der Wochenumfang erst NACH dem Rendern bekannt (Henne/Ei). Geschlossene Form:
    // Longrun ≤ share · Woche  ⟺  Longrun ≤ share/(1−share) · (Rest der Woche) — einmal nachrendern genügt,
    // die Regel wird im Renderer selbst (longRunLimit) durchgesetzt.
    if (weekKmForLong == null) {
      const isLong = (r: Rendered) => (r.su.ref as { tpl?: WorkoutTemplate } | undefined)?.tpl?.family === "Long" && !r.su.downgrade;
      const otherKm = rendered.filter((r) => !isLong(r)).reduce((a, r) => a + kmOf(r.c), 0);
      const longKm = rendered.filter(isLong).reduce((a, r) => a + kmOf(r.c), 0);
      if (otherKm > 0 && longKm > 0) {
        const share = longRunShare(phase);
        weekKmForLong = Math.round((otherKm / (1 - share)) * 10) / 10; // Woche, in der der Longrun genau `share` ausmacht
        rendered = renderAll();
      }
    }
    if (scheduled.some((su) => su.downgrade)) downgraded = true;

    // Frage A: Easy/Long-Dauer so skalieren, dass Wochen-km ≈ target_km (harte Einheiten unangetastet); gedeckelt
    // (×0.7..1.4) → PMC-Projektion bleibt selbstkonsistent, kein Runaway. Nur wenn target_km gepflegt ist.
    // Baustein A1: km-Ceiling (ACWR) — progressiv (~+7%/Blockwoche, chronisches Niveau darf mitwachsen). Health-first-Deckel.
    let targetKm = w.target_km ?? null;
    const kmCeil = args.kmCeilingBase != null && args.kmCeilingBase > 0 ? Math.round(args.kmCeilingBase * Math.pow(1.07, wi)) : null;
    if (kmCeil != null) {
      const renderedKm = rendered.reduce((a, r) => a + kmOf(r.c), 0);
      const wouldBe = targetKm != null ? targetKm : renderedKm;
      if (wouldBe > kmCeil) { targetKm = kmCeil; rec.reasons.push({ code: "km_ceiling", text: `km-Ceiling ${kmCeil} km (verletzungssicher, ACWR ≤ 1.45) — Wochen-Volumen gedeckelt` }); }
    }
    if (targetKm && targetKm > 0) {
      const elKm = rendered.filter((r) => r.scalable).reduce((a, r) => a + kmOf(r.c), 0);
      const otherKm = rendered.filter((r) => !r.scalable).reduce((a, r) => a + kmOf(r.c), 0);
      if (elKm > 0) {
        const desiredEl = Math.max(targetKm * 0.4, targetKm - otherKm); // Easy/Long tragen nie unter 40% des Ziels
        // v3.1.0: Das Wochen-km-Ziel ist die Steuergröße des Nutzers (Wizard/Saisonplan) — der Angleich darf
        // deshalb weiter greifen als bisher (±45 % statt −30/+40 %). Die Grenzen bleiben: Qualität wird nie
        // skaliert, Easy/Long tragen mindestens 40 % des Ziels, und die Plan-TSS wird konsistent mitgeführt.
        const factor = Math.max(KM_ALIGN_MIN, Math.min(KM_ALIGN_MAX, desiredEl / elKm));
        // Skaliert die TATSÄCHLICH gerenderte Dauer (über die gerenderte TSS) — nicht die Ziel-TSS-Shares,
        // die bei qualitäts-gesättigten Wochen 0 sind (dann rendern Easy/Long über ihre Default-Dauer).
        if (Math.abs(factor - 1) > 0.05) for (const r of rendered) if (r.scalable && r.c.planned_tss > 0) {
          r.baseTss = Math.max(20, Math.round(r.c.planned_tss * factor));
          r.c = renderUnit(r.su, r.baseTss);
        }
      }
      // Ehrlichkeit statt stiller Abweichung: Bleibt der Plan trotz Angleich deutlich neben dem km-Ziel, wird
      // gesagt WARUM — sonst wundert man sich im Wizard, warum aus „41 km" ein 54-km-Plan wird. Die untere Grenze
      // ist strukturell: Läufe haben sportwissenschaftliche Mindestdauern; unter das Ziel kommt man nur mit
      // WENIGER Einheiten, nicht mit noch kürzeren.
      const gotKm = rendered.reduce((a, r) => a + kmOf(r.c), 0);
      const gotTss = Math.round(rendered.reduce((a, r) => a + (r.c.planned_tss || 0), 0));
      const miss = (gotKm - targetKm) / targetKm;
      if (Math.abs(miss) > 0.12) {
        rec.reasons.push({
          code: "km_target_missed",
          text: miss > 0
            ? `Wochen-km-Ziel ${Math.round(targetKm)} km, geplant ${Math.round(gotKm)} km: Weniger Volumen ginge nur mit WENIGER Einheiten — die geplanten Läufe stehen bereits an ihrer sinnvollen Mindestdauer. Die Wochenlast landet dadurch bei ${gotTss} statt ${Math.round(target)} TSS (Phasenziel).`
            : `Wochen-km-Ziel ${Math.round(targetKm)} km, geplant ${Math.round(gotKm)} km: Mehr Volumen bräuchte zusätzliche Einheiten oder mehr Zeit je Tag — dein Zeitbudget deckelt hier.`,
        });
      }
    }

    // Tage materialisieren + Form vorwärts akkumulieren.
    // Evidenz→Einheit-Treue: „Warum diese Einheit" je Qualitäts-/Long-Tag (tpl.purpose); der schwerpunkt-getriebene
    // Slot (ref.emph) trägt zusätzlich das Schwerpunkt-Label aus dem Coaching-Verdikt. Easy/Strides/Core = keine Note.
    const EMPH_LABEL_DE: Record<string, string> = { lt1: "LT1", schwelle: "Schwelle (LT2)", vo2: "VO2max", berg: "Berg", norwegian: "Norwegian", fartlek: "Fartlek" };
    for (const r of rendered) {
      const { su, c } = r;
      const ref = su.ref as { tpl: WorkoutTemplate; progress: number; ctlProgress?: number; targetTss: number; emph?: boolean } | undefined;
      // v1.7.0/v2.8.0: Intention (Template + Progression + ctlProgress + tatsächliche Ziel-TSS nach Angleich) für
      // Live-Resolution speichern — ctlProgress muss hier persistiert werden, da resolvePlannedSession() später
      // keine Season-Baseline kennt (nur die aktuelle CTL), also nicht selbst neu herleiten kann.
      const prescription = ref?.tpl
        ? { templateId: su.downgrade ? "easy_ga1" : ref.tpl.id, progress: ref.progress, ctlProgress: ref.ctlProgress, targetTss: r.baseTss }
        : null;
      const eTpl = su.downgrade ? undefined : ref?.tpl;
      const emphasisNote = eTpl && eTpl.family !== "Easy" && eTpl.id !== "strides" && eTpl.id !== "core_strength"
        ? (ref?.emph && effEmphasis && effEmphasis !== "ausgewogen"
            ? `Schwerpunkt ${EMPH_LABEL_DE[effEmphasis] ?? effEmphasis}: ${eTpl.purpose}`
            : eTpl.purpose)
        : null;
      days.push({
        date: su.date, weekdayIdx: su.weekdayIdx, type: c.type, isSecond: su.isSecond,
        planned_min: c.planned_min, planned_tss: c.planned_tss, description: c.description,
        zone_alloc: c.zone_alloc, efforts: c.efforts, paceTarget: c.paceTarget, prescription,
        adaptNote: c.adaptNote ?? null, emphasisNote,
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

    // Banister-Tages-Taper: die Race Week trägt ihren Wochen-Taper; hier den Taper RENNTAG-GENAU in die Grenzwoche(n)
    // davor erweitern. Für Tage im Fenster (Renntag − taperDays, Renntag) dieser NICHT-Race-Week die Last rampen
    // (Fensteranfang ~voll, näher am Rennen leichter). Spiegelt den Tuneup-Mini-Taper; keine Wochen-Kopplung berührt.
    if (effTaperDays != null && effTaperDays > 0 && args.raceDate && !w.dates.includes(args.raceDate)) {
      const raceMs = Date.parse(args.raceDate + "T00:00:00Z");
      const TMIN = 0.4; // stärkste Reduktion direkt vor dem Rennen (in der Grenzwoche selten erreicht)
      const scaleZones = (z: { byKm?: Record<number, number>; byMin?: Record<number, number> } | null | undefined, f: number) => {
        if (!z) return z ?? null;
        const s = (r?: Record<number, number>) => (r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, (v || 0) * f])) : r);
        return { ...(z.byKm ? { byKm: s(z.byKm) as Record<number, number> } : {}), ...(z.byMin ? { byMin: s(z.byMin) as Record<number, number> } : {}) };
      };
      let touched = false;
      for (let di = 0; di < days.length; di++) {
        const d0 = days[di];
        const daysToRace = Math.round((raceMs - Date.parse(d0.date + "T00:00:00Z")) / 86_400_000);
        if (daysToRace <= 0 || daysToRace > effTaperDays) continue;
        const factor = Math.max(TMIN, Math.min(1, TMIN + (1 - TMIN) * (daysToRace / effTaperDays)));
        if (factor >= 0.98) continue; // vernachlässigbare Reduktion → Einheit unangetastet
        const soften = HARD_TYPES.has(d0.type) && factor < 0.7; // harte Einheit tief im Taper → locker
        const newTss = Math.max(10, Math.round(d0.planned_tss * factor));
        const newMin = Math.max(10, Math.round(d0.planned_min * factor));
        tssActual += newTss - d0.planned_tss;
        projected.set(d0.date, (projected.get(d0.date) ?? 0) + newTss - d0.planned_tss);
        days[di] = {
          ...d0, type: soften ? "Easy" : d0.type, planned_tss: newTss, planned_min: newMin,
          zone_alloc: soften ? { byKm: {} } : (scaleZones(d0.zone_alloc, factor) ?? d0.zone_alloc),
          efforts: soften ? null : d0.efforts, prescription: soften ? null : d0.prescription,
          description: soften ? "Locker — Taper (renntag-genau)" : `${d0.description} · Taper`,
        };
        touched = true;
      }
      if (touched) {
        const personal = args.taperDays != null && args.taperDays >= (effTaperDays ?? 0);
        rec.reasons.push({ code: "banister_taper", text: `Tages-Taper: Last renntag-genau ~${effTaperDays} Tage vor dem Rennen heruntergefahren${personal ? " (Banister-personalisiert)" : " (distanz-typisch)"} — nicht auf ganze Wochen gerundet` });
      }
    }

    if (rec.confidence === "niedrig") lowConf = true;
    if (cyc?.reason) rec.reasons.push({ code: "cycle", text: cyc.reason }); // 4. Steuer-Input transparent im Verdikt
    // v3.1.0: Verfügbarkeit ist eine OBERGRENZE, kein Soll — übrige Zeit bleibt bewusst übrig. Damit das nicht wie
    // ein Planungsfehler aussieht, wird die Reserve ehrlich ausgewiesen (statt sie mit Volumen aufzufüllen).
    const budgetMinWeek = (args.availability?.minutesByWeekday ?? []).reduce((a, b) => a + (b || 0), 0);
    if (budgetMinWeek > 0) {
      const plannedMinWeek = days.reduce((a, d) => a + (d.planned_min ?? 0), 0);
      const reserve = Math.round(budgetMinWeek - plannedMinWeek);
      if (reserve >= 60 && reserve / budgetMinWeek >= 0.2) {
        rec.reasons.push({ code: "time_reserve", text: `Zeit-Reserve ${reserve} min: dein Zeitbudget ist eine Obergrenze, kein Soll — die Woche braucht physiologisch nicht mehr Volumen (mehr Umfang gibt es über das Wochen-km-Ziel, nicht über freie Zeit).` });
      }
    }
    const pl = (rec.headline || "").toLowerCase();
    const isDeload = pl.includes("entlast") || pl.includes("deload") || pl.includes("taper") || pl.includes("race week");
    outWeeks.push({
      week_no: w.week_no, start_date: w.start_date, phase,
      headline: rec.headline, periodizationModel: rec.periodizationModel,
      tssTarget: Math.round(target), tssActual: Math.round(tssActual),
      ctlStart: round1(ctl), tsbStart: tsb != null ? round1(tsb) : null,
      isDeload, days, cyclePhase: cyc?.phase ?? null, projVdot: projVdot != null ? Math.round(projVdot * 10) / 10 : null,
      reasons: rec.reasons, confidence: rec.confidence,
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
        return { type: p.tpl.sessionType, targetTss: tgt, role: p.role, ref: { tpl: p.tpl, progress: 0.3, targetTss: tgt } };
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

/** Ergänzt geplante Lauf-km je Zone aus Minuten und Pace-Zonen, ohne vorhandene manuelle byKm zu überschreiben. */
export function enrichZoneAllocKm<T extends PlannedSession>(session: T, paceZones?: number[]): T {
  if (session.sport !== "Run") return session;
  const alloc = session.zone_alloc;
  const byMin = alloc?.byMin;
  if (!byMin || !Object.values(byMin).some((v) => (Number(v) || 0) > 0)) return session;
  if (alloc?.byKm && Object.values(alloc.byKm).some((v) => (Number(v) || 0) > 0)) return session;

  const raw: Record<number, number> = {};
  for (const [k, v] of Object.entries(byMin)) {
    const z = Number(k);
    const min = Number(v) || 0;
    if (z <= 0 || min <= 0) continue;
    const pace = paceZones?.[z - 1] || DEFAULT_ZONE_PACE[z - 1];
    if (pace > 0) raw[z] = (min * 60) / pace;
  }
  const rawSum = Object.values(raw).reduce((a, b) => a + b, 0);
  if (rawSum <= 0) return session;

  const targetKm = session.planned_km && session.planned_km > 0 ? session.planned_km : rawSum;
  const scale = targetKm > 0 ? targetKm / rawSum : 1;
  const byKm: Record<number, number> = {};
  for (const [k, v] of Object.entries(raw)) byKm[Number(k)] = Math.round(v * scale * 100) / 100;
  const kmSum = Object.values(byKm).reduce((a, b) => a + b, 0);
  return {
    ...session,
    planned_km: session.planned_km ?? (kmSum > 0 ? Math.round(kmSum * 100) / 100 : session.planned_km),
    zone_alloc: { ...alloc, byKm },
  };
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
// v3.1.0 (Block-Wizard): Wochen-km-Rampe von Start-km zum Block-Maximum — pur, damit sie runner-testbar bleibt.
// Prinzip: Aufbauwochen wachsen moderat (≤ +8 %/Woche, ACWR-verträglich), Entlastungswochen fallen auf ~75 %,
// Race-Specific hält das Niveau (die Intensität wird spezifischer, nicht das Volumen größer), Renn-Anlauf/Race-Week
// tapern. Das Maximum wird nie überschritten — es ist eine Obergrenze, kein Ziel.
export function rampWeeklyKm(o: { startKm: number; maxKm: number; phases: (string | null)[] }): number[] {
  const start = Math.max(1, o.startKm);
  const max = Math.max(start, o.maxKm || start);
  const out: number[] = [];
  let level = start; // aktuelles Aufbau-Niveau (Deloads/Taper senken die Woche, nicht das Niveau)
  o.phases.forEach((ph, i) => {
    const k = phaseKind(ph);
    if (k === "sick" || k === "recovery") { out.push(Math.round(level * 0.5)); return; }
    if (k === "raceweek") { out.push(Math.round(level * 0.5)); return; }
    if (k === "deload") { out.push(Math.round(level * 0.75)); return; }
    if (k === "specific") { out.push(Math.round(Math.min(level, max))); return; } // halten, nicht wachsen
    if (i > 0) level = Math.min(max, level * 1.06);                               // Base/Build: moderat wachsen (~6 %/Wo)
    out.push(Math.round(Math.min(level, max)));
  });
  return out;
}

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
  activities: { id: number; date: string; type: string | null; tss: number | null; moving_s: number | null; matched_session_id: number | null; sport: string; match_ignore?: number | boolean | null }[],
  sessions: { id: number; date: string; type: string; planned_tss: number | null; planned_min: number | null }[],
): Map<number, number> {
  const out = new Map<number, number>();
  const usedSessions = new Set<number>();
  const sessionIds = new Set(sessions.map((s) => s.id));
  // 1) manuelle Zuordnungen fixieren.
  for (const a of activities) if (!a.match_ignore && a.matched_session_id != null && sessionIds.has(a.matched_session_id)) { out.set(a.id, a.matched_session_id); usedSessions.add(a.matched_session_id); }
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
    if (out.has(a.id) || a.match_ignore || a.sport !== "Run") continue;
    for (const s of sessions) if (!usedSessions.has(s.id)) { const sc = score(a, s); if (sc > 0) pairs.push({ a: a.id, s: s.id, sc }); }
  }
  pairs.sort((x, y) => y.sc - x.sc);
  const usedAct = new Set<number>();
  for (const p of pairs) { if (usedAct.has(p.a) || usedSessions.has(p.s)) continue; out.set(p.a, p.s); usedAct.add(p.a); usedSessions.add(p.s); }
  return out;
}

export function sessionCompletion(
  planned: { planned_tss?: number | null; zone_alloc?: { byKm?: Record<number, number>; byMin?: Record<number, number> } | null },
  act: { tss?: number | null; pace_zone_min?: Record<number, number> | null },
  paceZones: number[] | undefined,
): { pct: number; tssScore: number; zoneScore: number | null; tssOnly: boolean } | null {
  const plannedTss = planned.planned_tss ?? 0;
  if (!(plannedTss > 0)) return null;
  const tssScore = Math.max(0, Math.min(1, (act.tss ?? 0) / plannedTss));

  let zoneScore: number | null = null;
  const byKm = planned.zone_alloc?.byKm || null;
  const byMin = planned.zone_alloc?.byMin || null;
  const aMin = act.pace_zone_min || null;
  if (((byKm && Object.keys(byKm).length) || (byMin && Object.keys(byMin).length)) && aMin && Object.keys(aMin).length) {
    const pTime: Record<number, number> = {}; // geplante Zeit je Zone = km_z · pace_z
    if (byKm && Object.keys(byKm).length) {
      for (const [z, km] of Object.entries(byKm)) {
        const zi = Number(z), kmv = Number(km) || 0;
        if (kmv <= 0) continue;
        pTime[zi] = kmv * (paceZones?.[zi - 1] || DEFAULT_ZONE_PACE[zi - 1] || 300);
      }
    } else if (byMin) {
      for (const [z, min] of Object.entries(byMin)) {
        const zi = Number(z), mv = Number(min) || 0;
        if (mv <= 0) continue;
        pTime[zi] = mv * 60;
      }
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
