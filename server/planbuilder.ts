// Plan-Builder (v1.4.0): macht abstrakte Empfehlungen konkret + tagesgebunden.
//  - concretizeSession: Einheitstyp + Ziel-TSS + Schwellen → Dauer/Pace/Intervalle (zone_alloc.byMin + efforts).
//  - scheduleWeek: konkrete Einheiten → Wochentage nach Verfügbarkeits-/Präferenz-Profil.
// Pure Modul (keine DB) → testbar per Runner. Spiegelt exakt die Server-TSS-Mathe in load.ts/analysis.ts:
// planned_tss wird beim Speichern aus zone_alloc.byMin via rTssFromZones(secPerZone, pace_zones, threshold_pace)
// neu berechnet → wir invertieren genau diese Formel, damit Plan-TSS ≈ Ziel-TSS.
import { DEFAULT_ZONE_PACE } from "./load.ts";

// Minimal-Schnittstelle der Zonen (nur was der Konkretisierer braucht) — hält das Modul DB-frei.
export interface ZonesInput {
  pace_zones: number[];        // Obergrenzen je Zone (s/km, absteigend; Index z-1)
  threshold_pace: number;      // LT2-Pace (s/km) — Bezug für IF
  lt1_pace?: number | null;    // aerobe Schwelle (s/km), optional
  hr_zones?: { z: number; min: number; max: number }[]; // v1.6.1: HF-Spanne je Zone (für Anzeige)
  cs_pace?: number | null;     // v1.6.1: Critical-Speed-Pace (s/km) — Anker für VO2/Renntempo
  rep_pace?: number | null;    // v1.6.1: R-Pace (s/km, schneller als CS) — Anker für 200–400er
  goal_distance_m?: number | null; // v1.6.2: Zieldistanz des angesteuerten Rennens
  goal_pace?: number | null;       // v1.6.2: individuelles Renntempo (s/km) via VDOT für die Zieldistanz
}

// Anzeige-Struktur einer Belastung (JSON; identisch zur Client-Effort-Form in lib/api.ts).
export interface Effort {
  reps?: number; sec?: number | null; dist_m?: number | null; pace_s?: number | null;
  zone?: number | null; label?: string;
  rest_s?: number | null; rest_type?: "jog" | "stand" | null; hr_recovery?: number | null; // v1.6.0: Intervall-Pause
}

export interface ConcreteSession {
  type: string;
  planned_min: number;                       // Gesamtdauer (min, gerundet)
  zone_alloc: { byMin: Record<number, number> }; // TSS-tragend (Server rechnet daraus planned_tss)
  efforts: Effort[] | null;                  // Intervall-Struktur (Anzeige); null bei Dauerläufen
  description: string;                        // kurze Klartext-Beschreibung (Pace/Struktur)
  planned_tss: number;                        // erwarteter Plan-TSS (≈ target) — zur Anzeige/Konfidenz
  paceTarget: number | null;                  // Ziel-Pace s/km (Dauerläufe), sonst null
}

/** Zonen-Pace (s/km) für Zone z, mit Default-Fallback — exakt wie rTssFromZones in load.ts. */
export function paceOf(z: number, zones: ZonesInput): number {
  return zones.pace_zones?.[z - 1] || DEFAULT_ZONE_PACE[z - 1] || 230;
}
/** Bezugs-Schwellenpace (LT2). */
export function thrOf(zones: ZonesInput): number {
  return zones.threshold_pace || paceOf(4, zones) || 230;
}
/** rTSS pro Minute in Zone z: (1/60)·IF²·100, IF = thr/zonePace. Linear → Basis der Invertierung. */
export function tssPerMin(z: number, zones: ZonesInput): number {
  const ifr = thrOf(zones) / paceOf(z, zones);
  return (ifr * ifr * 100) / 60;
}
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Pace s/km → "m:ss". */
export function paceStr(s: number): string {
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/**
 * Einen Einheitstyp + Ziel-TSS in eine konkrete Einheit übersetzen.
 * Dauerläufe (Easy/Long/LT1): Single-Zone, Dauer exakt aus Ziel-TSS invertiert.
 * Intervalle (Threshold/VO2/Hill): realistische Struktur, Wiederholungen ans Ziel skaliert;
 *   Intervall-Struktur exakt (efforts), Plan-TSS ≈ Ziel.
 * opts.maxMin: harte Obergrenze (Tagesbudget aus dem Scheduler) → skaliert Dauer/Reps herunter.
 */
export function concretizeSession(
  type: string,
  targetTss: number,
  zones: ZonesInput,
  opts?: { maxMin?: number },
): ConcreteSession {
  const t = (type || "Easy").toLowerCase();
  const target = Math.max(1, targetTss || 0);
  const maxMin = opts?.maxMin && opts.maxMin > 0 ? opts.maxMin : Infinity;

  // ---- Dauerläufe: eine Zone, Dauer = Ziel-TSS / TSS-pro-Minute ----
  const steady = (z: number, label: string): ConcreteSession => {
    const tpm = tssPerMin(z, zones);
    let min = tpm > 0 ? target / tpm : 0;
    if (min > maxMin) min = maxMin;
    min = Math.max(10, r0(min));
    const pace = z === 3 && zones.lt1_pace ? zones.lt1_pace : paceOf(z, zones);
    const tss = r1(min * tpm);
    return {
      type, planned_min: min, zone_alloc: { byMin: { [z]: min } },
      efforts: null, paceTarget: pace,
      description: `${min} min ${label} @ ~${paceStr(pace)}/km (Z${z})`,
      planned_tss: tss,
    };
  };

  // ---- Intervalle: WU/CD in Z1, Arbeitsblöcke in Arbeitszone, Trabpausen in Z1 ----
  const intervals = (workZ: number, repMin: number, recMin: number, repsRange: [number, number], label: string): ConcreteSession => {
    const wuCd = target < 50 ? 10 : 20; // kürzeres Ein-/Auslaufen bei kleinen Ziel-Einheiten
    const tpmWork = tssPerMin(workZ, zones);
    const tpmEasy = tssPerMin(1, zones);
    const tssWuCd = wuCd * tpmEasy;
    const tssPerRep = repMin * tpmWork + recMin * tpmEasy; // Arbeit + Trabpause
    let reps = Math.round((target - tssWuCd) / tssPerRep);
    reps = Math.max(repsRange[0], Math.min(repsRange[1], reps));
    // Budget-Cap: Gesamtdauer auf maxMin begrenzen → Reps reduzieren
    const totalMinAt = (n: number) => wuCd + n * repMin + Math.max(0, n - 1) * recMin;
    while (reps > repsRange[0] && totalMinAt(reps) > maxMin) reps--;
    const recTotal = Math.max(0, reps - 1) * recMin;
    const workMin = reps * repMin;
    const z1Min = wuCd + recTotal;
    const byMin: Record<number, number> = { 1: z1Min, [workZ]: workMin };
    const planned_min = r0(z1Min + workMin);
    const workPace = paceOf(workZ, zones);
    const tss = r1(z1Min * tpmEasy + workMin * tpmWork);
    const efforts: Effort[] = [
      { reps, sec: repMin * 60, zone: workZ, pace_s: workPace, label },
    ];
    const wu = r0(wuCd / 2);
    return {
      type, planned_min, zone_alloc: { byMin }, efforts, paceTarget: workPace,
      description: `${wu}' WU · ${reps}×${repMin}' @ ${label} (~${paceStr(workPace)}/km) / ${recMin}' Trab · ${wu}' CD`,
      planned_tss: tss,
    };
  };

  if (t === "long") return steady(2, "Longrun Z1/Z2");
  if (t === "easy" || t === "recovery" || t === "regeneration") return steady(2, "locker");
  if (t === "lt1" || t === "steady" || t === "tempo") return steady(3, "Steady/LT1");
  if (t === "threshold" || t === "lt2") return intervals(4, 12, 3, [2, 5], "LT2-Pace");
  if (t === "vo2" || t === "vo2max" || t === "vo2short" || t === "vo2long") return intervals(5, 4, 3, [4, 6], "VO2max-Pace");
  if (t === "hill") return intervals(4, 1, 2, [6, 10], "Berg/Z4");
  if (t === "race") return steady(4, "Renntempo");
  // Unbekannt/Strength/Physio/Rest → locker als Default
  return steady(2, "locker");
}

// ===================== A3 — Tages-Scheduler =====================
// Verfügbarkeits-/Präferenz-Profil (gespiegelt client-seitig in lib/api.ts).
// Wochentag-Index 0=Mo … 6=So — passend zu daysOfWeek(start) (Woche beginnt Montag).
export interface Availability {
  daysPerWeek?: number | null;
  minutesByWeekday: number[];   // 7 Einträge, Minuten-Budget; 0 = Ruhetag
  longRunDay?: number | null;   // 0..6
  hardDays?: number[];          // 0..6
  allowDoubles?: boolean;
  doubleDays?: number[];        // 0..6 (optional; sonst beliebiger Trainingstag mit Budget)
}

export interface PlannedUnit { type: string; targetTss: number; ref?: unknown; }
export interface ScheduledUnit {
  date: string; weekdayIdx: number; type: string; targetTss: number;
  budgetMin: number;  // Minuten-Budget je Einheit (bei Doppeleinheiten geteilt); 0 = unbegrenzt
  isSecond: boolean;  // zweite Einheit des Tages (Double)
  ref?: unknown;      // v1.6.1: opaque Referenz (Workout-Template + Progression) für den Renderer
}

const HARD_TYPES = new Set(["threshold", "lt2", "vo2", "vo2max", "vo2short", "vo2long", "hill", "race"]);
const isHardType = (t: string) => HARD_TYPES.has((t || "").toLowerCase());
const isLongType = (t: string) => (t || "").toLowerCase() === "long";

/**
 * Konkrete Einheiten auf Wochentage verteilen — nach Verfügbarkeits-/Präferenz-Profil.
 * Regeln: Longrun auf longRunDay · Qualität nur auf hardDays mit ≥48 h Abstand · Easy füllt
 * restliche Trainingstage · Doppeleinheiten nur wenn erlaubt und Einheiten > Trainingstage ·
 * Budget je Einheit aus Wochentags-Minuten (bei Doubles geteilt). Ohne Profil → Gleichverteilung (Status quo).
 */
export function scheduleWeek(units: PlannedUnit[], availability: Availability | null | undefined, weekDates: string[]): ScheduledUnit[] {
  const n = weekDates.length || 7;
  const mk = (idx: number, u: PlannedUnit, isSecond = false): ScheduledUnit =>
    ({ date: weekDates[idx], weekdayIdx: idx, type: u.type, targetTss: u.targetTss, budgetMin: 0, isSecond, ref: u.ref });

  // Fallback ohne (verwertbares) Profil: Round-Robin über alle Tage = heutiges Verhalten (keine Regression).
  if (!availability || !availability.minutesByWeekday?.some((m) => (m || 0) > 0)) {
    return units.map((u, i) => mk(i % n, u));
  }

  const budget = availability.minutesByWeekday;
  const trainingDays: number[] = [];
  for (let i = 0; i < n; i++) if ((budget[i] || 0) > 0) trainingDays.push(i);
  const used = new Set<number>();
  const out: ScheduledUnit[] = [];
  const pickFree = (): number | undefined => trainingDays.find((d) => !used.has(d));

  const longs = units.filter((u) => isLongType(u.type));
  const hards = units.filter((u) => isHardType(u.type));
  const easies = units.filter((u) => !isLongType(u.type) && !isHardType(u.type));

  // 1) Longrun: bevorzugt longRunDay, sonst erster freier Trainingstag.
  for (const u of longs) {
    let idx = availability.longRunDay != null && (budget[availability.longRunDay] || 0) > 0 && !used.has(availability.longRunDay)
      ? availability.longRunDay : pickFree();
    if (idx == null) idx = trainingDays[0];
    used.add(idx); out.push(mk(idx, u));
  }

  // 2) Qualität: auf hardDays (oder beliebige Trainingstage), ≥48 h Abstand (nicht an aufeinanderfolgenden Tagen).
  const hardDays = (availability.hardDays?.length ? availability.hardDays : trainingDays)
    .filter((d) => (budget[d] || 0) > 0).sort((a, b) => a - b);
  let lastHard = -10;
  for (const u of hards) {
    let idx = hardDays.find((d) => !used.has(d) && Math.abs(d - lastHard) >= 2);
    if (idx == null) idx = hardDays.find((d) => !used.has(d)); // Abstand notfalls aufweichen
    if (idx == null) idx = pickFree();
    if (idx == null) idx = trainingDays[0];
    used.add(idx); lastHard = idx; out.push(mk(idx, u));
  }

  // 3) Easy: restliche Trainingstage; Überhang als Doppeleinheit (wenn erlaubt), sonst auf vollsten freien Tag.
  for (const u of easies) {
    let idx = pickFree();
    if (idx != null) { used.add(idx); out.push(mk(idx, u)); continue; }
    // Kein freier Primärtag mehr → Double (bevorzugt lockere Tage: nicht Longrun, nicht hart)
    if (availability.allowDoubles) {
      const isEasyDay = (d: number) => d !== availability.longRunDay && !(availability.hardDays?.includes(d));
      const cand = (d: number) => (budget[d] || 0) >= 60 && out.filter((o) => o.weekdayIdx === d).length < 2;
      const pref = (availability.doubleDays?.length ? availability.doubleDays : trainingDays.filter(isEasyDay)).filter(cand);
      const any = trainingDays.filter(cand); // Notfall: irgendein Tag mit Budget
      const idx2 = [...(pref.length ? pref : any)].sort((a, b) => (budget[b] || 0) - (budget[a] || 0))[0] ?? trainingDays[0];
      out.push(mk(idx2, u, true));
    } else {
      // Doubles aus → auf den Trainingstag mit den wenigsten Einheiten legen.
      const idx3 = [...trainingDays].sort((a, b) =>
        out.filter((o) => o.weekdayIdx === a).length - out.filter((o) => o.weekdayIdx === b).length)[0];
      out.push(mk(idx3, u, true));
    }
  }

  // Budget je Einheit: Tagesbudget durch Anzahl Einheiten des Tages teilen (Doubles).
  for (const o of out) {
    const k = out.filter((x) => x.weekdayIdx === o.weekdayIdx).length;
    o.budgetMin = k > 0 ? Math.round((budget[o.weekdayIdx] || 0) / k) : (budget[o.weekdayIdx] || 0);
  }
  return out.sort((a, b) => a.weekdayIdx - b.weekdayIdx);
}
