// Regelbasierte Prüf-Engine: bewertet eine geplante Woche gegen Phase + Verlauf.
import { bikeTssEstimate, hrTssFromZones, powerZoneMidWatts, round1, DEFAULT_ZONE_PACE, type HrZone } from "./load.ts";

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
 * Lauf/sonst: aus Zonen-Allokation (pace_zones bevorzugt), sonst Typ+Dauer.
 */
export function plannedSessionTss(
  s: PlannedSession,
  zones: HrZone[],
  lthr: number,
  paceZones?: number[],
  powerZones?: number[],
  ftp?: number,
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

// ---- Intervall-/Effort-Trend (ToDo 2/13/20) -----------------------------

/** Eine Belastungs-Zeile einer Aktivität (Vertrag mit client/src/lib/api.ts: Effort). */
export interface EffortLine {
  reps?: number | null;
  sec?: number | null;
  dist_m?: number | null;
  pace_s?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  zone?: number | null;
  label?: string;
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
  let distM = 0, // Gesamt-Distanz (m) über alle Wiederholungen
    sec = 0, // Gesamt-Belastungszeit (s)
    hrWeighted = 0, // Summe avg_hr * Gewicht (Zeit)
    hrWeight = 0,
    reps = 0,
    blockSec = 0; // längster Einzel-Block (s) — bestimmt VO2short/-long
  for (const e of args.efforts) {
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
    for (const e of args.efforts) {
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
  if (sessionType === "Threshold") category = avg_hr != null && avg_hr < args.lthr - 4 ? "LT1" : "LT2";
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
    label: args.efforts.find((e) => e.label)?.label || args.name || undefined,
  };
}

export interface AnalyzeContext {
  phase?: string | null;
  targetKm?: number | null;
  recentWeeksKm?: number[]; // letzte Wochen (real), neueste zuletzt
  projectedCtlRamp?: number | null; // CTL-Punkte/Woche der geplanten Woche
  projectedTsb?: number | null; // Form am Wochenende
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
  };
}

export function analyzeWeek(totals: WeekTotals, ctx: AnalyzeContext): Flag[] {
  const flags: Flag[] = [];
  const t = ctx.thresholds;

  // 1. Volumen vs Phasenziel
  if (ctx.targetKm && ctx.targetKm > 0) {
    const diff = ((totals.km - ctx.targetKm) / ctx.targetKm) * 100;
    if (diff > t.volume_pct)
      flags.push({ level: "warn", code: "volume_high", message: `Volumen ${totals.km} km liegt ${r0(diff)}% über dem Phasenziel (${ctx.targetKm} km).` });
    else if (diff < -t.volume_pct)
      flags.push({ level: "info", code: "volume_low", message: `Volumen ${totals.km} km liegt ${r0(-diff)}% unter dem Phasenziel (${ctx.targetKm} km).` });
    else flags.push({ level: "ok", code: "volume_ok", message: `Volumen ${totals.km} km passt zum Phasenziel (${ctx.targetKm} km).` });
  }

  // 2. Ramp-Rate (km Woche-zu-Woche)
  if (ctx.recentWeeksKm && ctx.recentWeeksKm.length) {
    const recent = ctx.recentWeeksKm.slice(-3);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (avg > 0) {
      const jump = ((totals.km - avg) / avg) * 100;
      if (jump > 12)
        flags.push({ level: "warn", code: "ramp_fast", message: `Sprung +${r0(jump)}% ggü. Schnitt der Vorwochen (${r0(avg)} km) — Verletzungsrisiko, max. ~10%/Woche empfohlen.` });
    }
  }

  // 2b. CTL-Ramp
  if (ctx.projectedCtlRamp != null && ctx.projectedCtlRamp > t.ctl_ramp_max)
    flags.push({ level: "warn", code: "ctl_ramp", message: `CTL-Ramp +${ctx.projectedCtlRamp}/Woche über Limit (${t.ctl_ramp_max}). Fitness-Aufbau zu schnell.` });

  // 3. Form / Taper Richtung Race
  if (ctx.phase && /race/i.test(ctx.phase) && ctx.projectedTsb != null && ctx.projectedTsb < t.tsb_raceweek_min)
    flags.push({ level: "warn", code: "taper", message: `Race Week, aber projizierte Form (TSB ${ctx.projectedTsb}) zu negativ — mehr tapern.` });

  // 5. Polarisierung
  if (totals.intensity.hard > t.hard_pct_max)
    flags.push({ level: "warn", code: "hard_high", message: `Harter Anteil ${totals.intensity.hard}% (Z4-6) über ~${t.hard_pct_max}% — zu intensiv, mehr Z1/2.` });
  if (totals.intensity.mod > t.z3_pct_max)
    flags.push({ level: "info", code: "grey_zone", message: `Z3 „grey zone" ${totals.intensity.mod}% relativ hoch — polarisierter trainieren.` });
  if (totals.intensity.easy >= 75 && totals.intensity.hard <= t.hard_pct_max)
    flags.push({ level: "ok", code: "polarized", message: `Polarisierung ok: ${totals.intensity.easy}% easy / ${totals.intensity.hard}% hart.` });

  // 6. Quality-Spacing
  if (totals.hardSessions > 3)
    flags.push({ level: "warn", code: "too_many_quality", message: `${totals.hardSessions} harte Einheiten — meist max. 2–3/Woche tragbar.` });

  // 7. Longrun-Anteil
  if (totals.km > 0) {
    const lrShare = (totals.longestKm / totals.km) * 100;
    if (lrShare > t.longrun_pct_max)
      flags.push({ level: "info", code: "longrun_share", message: `Longrun ${totals.longestKm} km = ${r0(lrShare)}% der Wochen-km (> ${t.longrun_pct_max}%).` });
  }

  // 8. Readiness
  if (ctx.readiness) {
    const { recovery, legsHardDays, hrvTrend } = ctx.readiness;
    if ((recovery != null && recovery < 40) || (legsHardDays ?? 0) >= 3 || (hrvTrend != null && hrvTrend < -10))
      flags.push({ level: "warn", code: "readiness", message: `Letzte Tage Erholung niedrig (Recov/HRV/Beine) — geplante Last evtl. zu hoch, ggf. reduzieren.` });
  }

  // 9. Phasen-Stimmigkeit
  if (ctx.phase && /entlast|deload|gesund/i.test(ctx.phase) && ctx.targetKm && totals.km > ctx.targetKm * 1.05)
    flags.push({ level: "warn", code: "deload_mismatch", message: `Phase „${ctx.phase}" sollte entlasten, geplante km aber über Ziel.` });

  return flags;
}

function r1(n: number) {
  return Math.round(n * 10) / 10;
}
function r0(n: number) {
  return Math.round(n);
}
