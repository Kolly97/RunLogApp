// Regelbasierte Prüf-Engine: bewertet eine geplante Woche gegen Phase + Verlauf.
import { hrTssFromZones, type HrZone } from "./load.ts";

const DEFAULT_ZONE_PACE = [330, 285, 255, 230, 210, 195];

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
}

const HARD_TYPES = new Set(["Threshold", "VO2", "Race", "Hill"]);

export function sessionZoneMinutes(s: PlannedSession, zones: HrZone[], paceZones?: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  zones.forEach((z) => (out[z.z] = 0));
  const alloc = s.zone_alloc;
  if (alloc) {
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
  // Keine Allokation -> grobe Defaults nach Typ
  const min = s.planned_min ?? (s.planned_km ? s.planned_km * 5 : 0);
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

/** Geplanter TSS einer Einheit: aus Zonen-Allokation, sonst aus Typ+Dauer geschätzt. */
export function plannedSessionTss(s: PlannedSession, zones: HrZone[], lthr: number, paceZones?: number[]): number {
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
  for (const s of sessions) {
    const isRun = s.sport === "Run";
    const isBike = s.sport?.startsWith("Bike");
    if (isRun) {
      km += s.planned_km || 0;
      runSessions++;
      longestKm = Math.max(longestKm, s.planned_km || 0);
    }
    if (isBike) bike_km += s.planned_km || 0;
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
