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
  cp?: number | null;              // v1.7.0: Critical Power (W) — optionaler Watt-Zusatzanker (Coros/Stryd)
}

// Anzeige-Struktur einer Belastung (JSON; identisch zur Client-Effort-Form in lib/api.ts).
export interface Effort {
  reps?: number; sec?: number | null; dist_m?: number | null; pace_s?: number | null;
  zone?: number | null; label?: string;
  rest_s?: number | null; rest_type?: "jog" | "stand" | null; hr_recovery?: number | null; // v1.6.0: Intervall-Pause
  // T7 (v1.11.0): von-bis-Bänder für rohe Einheiten. reps = empfohlener Zielwert (heute), reps_lo/hi = Band.
  reps_lo?: number | null; reps_hi?: number | null; pace_lo?: number | null; pace_hi?: number | null;
  // v1.12.0: verschachtelte Gruppen (group:true ⇒ reps × children) für frei strukturierte Einheiten.
  group?: boolean; children?: Effort[];
}

export interface ConcreteSession {
  type: string;
  planned_min: number;                       // Gesamtdauer (min, gerundet)
  zone_alloc: { byKm?: Record<number, number>; byMin?: Record<number, number> }; // TSS-tragend (v1.7: byKm für die Modal-Felder)
  efforts: Effort[] | null;                  // Intervall-Struktur (Anzeige); null bei Dauerläufen
  description: string;                        // kurze Klartext-Beschreibung (Pace/Struktur)
  planned_tss: number;                        // erwarteter Plan-TSS (≈ target) — zur Anzeige/Konfidenz
  paceTarget: number | null;                  // Ziel-Pace s/km (Dauerläufe), sonst null
  planned_km?: number | null;                 // Item 4: Gesamt-km (Σ zone_alloc.byKm) → Wochen-km/Kategorie-Summen
  adaptNote?: string | null;                  // T7: „angepasst an: Phase · TSB · Fitness · VDOT" (Live-Kontext)
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
const r2 = (n: number) => Math.round(n * 100) / 100;
function byMinToByKm(byMin: Record<number, number>, zones: ZonesInput): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [k, min] of Object.entries(byMin)) {
    const z = Number(k), m = Number(min) || 0;
    const pace = paceOf(z, zones);
    if (z > 0 && m > 0 && pace > 0) out[z] = r2((m * 60) / pace);
  }
  return out;
}
function kmSum(byKm: Record<number, number>): number {
  return r2(Object.values(byKm).reduce((a, b) => a + (b || 0), 0));
}
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
    const byMin = { [z]: min };
    const byKm = byMinToByKm(byMin, zones);
    return {
      type, planned_min: min, planned_km: kmSum(byKm), zone_alloc: { byMin, byKm },
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
    const byKm = byMinToByKm(byMin, zones);
    const planned_min = r0(z1Min + workMin);
    const workPace = paceOf(workZ, zones);
    const tss = r1(z1Min * tpmEasy + workMin * tpmWork);
    const efforts: Effort[] = [
      { reps, sec: repMin * 60, zone: workZ, pace_s: workPace, label },
    ];
    const wu = r0(wuCd / 2);
    return {
      type, planned_min, planned_km: kmSum(byKm), zone_alloc: { byMin, byKm }, efforts, paceTarget: workPace,
      description: `${wu}' WU · ${reps}×${repMin}' @ ${label} (~${paceStr(workPace)}/km) / ${recMin}' Trab · ${wu}' CD`,
      planned_tss: tss,
    };
  };

  if (t === "long") return steady(2, "Longrun Z1/Z2");
  if (t === "easy" || t === "recovery" || t === "regeneration") return steady(2, "locker");
  if (t === "lt1" || t === "steady" || t === "tempo") return steady(3, "Steady/LT1");
  if (t === "marathonpace" || t === "marathon") return steady(3, "Marathon-Pace"); // ~84 % VO2max (Daniels M), moderater Dauerlauf Z3 — NICHT Easy
  if (t === "threshold" || t === "lt2") return intervals(4, 12, 3, [2, 5], "LT2-Pace");
  if (t === "vo2" || t === "vo2max" || t === "vo2short" || t === "vo2long") return intervals(5, 4, 3, [4, 6], "VO2max-Pace");
  if (t === "rep" || t === "repetitions") return intervals(6, 1, 2, [6, 10], "Rep-Pace"); // ~107 % VO2max (Daniels R), kurz & schnell, volle Erholung
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
  hillDay?: number | null;      // v1.7.0: bevorzugter Berglauf-Tag (0..6)
  corePerWeek?: number | null;  // v1.7.0: Anzahl Stabi/Core-Einheiten pro Woche (0..3)
  coreDays?: number[];          // v1.7.0: bevorzugte Core-Tage; sonst an Easy-Tage angehängt
  // v1.8.0 Block-Präferenzen (advisory; Periodisierung + Erholungsregeln bleiben verbindlich):
  emphasis?: string | null;     // "ausgewogen"|"schwelle"|"vo2"|"berg"|"norwegian"|"fartlek" — Schwerpunkt
  favoriteWorkouts?: string[];  // Template-IDs, die häufiger vorkommen sollen
  avoidWorkouts?: string[];     // Template-IDs, die vermieden werden sollen
}

export interface PlannedUnit { type: string; targetTss: number; ref?: unknown; pair?: string; role?: "quality" | "long" | "easy" | "core"; }
export interface ScheduledUnit {
  date: string; weekdayIdx: number; type: string; targetTss: number;
  budgetMin: number;  // Minuten-Budget je Einheit (bei Doppeleinheiten geteilt); 0 = unbegrenzt
  isSecond: boolean;  // zweite Einheit des Tages (Double)
  ref?: unknown;      // v1.6.1: opaque Referenz (Workout-Template + Progression) für den Renderer
  downgrade?: boolean; // v1.7.0: keine spacing-konforme Platzierung → als Easy rendern (Erholung schützen)
  pair?: string;       // v1.7.0: Doppel-Schwellen-Tag (AM+PM teilen denselben Tag)
}

const HARD_TYPES = new Set(["threshold", "lt2", "vo2", "vo2max", "vo2short", "vo2long", "hill", "race"]);
const isHardType = (t: string) => HARD_TYPES.has((t || "").toLowerCase());
const isLongType = (t: string) => (t || "").toLowerCase() === "long";
const isCoreType = (t: string) => /strength|stabi|core/i.test(t || "");
const isHillUnit = (t: string) => (t || "").toLowerCase() === "hill";

/**
 * Konkrete Einheiten auf Wochentage verteilen — nach Verfügbarkeits-/Präferenz-Profil.
 * Regeln: Longrun auf longRunDay · Qualität nur auf hardDays mit ≥48 h Abstand · Easy füllt
 * restliche Trainingstage · Doppeleinheiten nur wenn erlaubt und Einheiten > Trainingstage ·
 * Budget je Einheit aus Wochentags-Minuten (bei Doubles geteilt). Ohne Profil → Gleichverteilung (Status quo).
 */
export function scheduleWeek(units: PlannedUnit[], availability: Availability | null | undefined, weekDates: string[]): ScheduledUnit[] {
  const n = weekDates.length || 7;
  const mk = (idx: number, u: PlannedUnit, isSecond = false, downgrade = false): ScheduledUnit =>
    ({ date: weekDates[idx], weekdayIdx: idx, type: u.type, targetTss: u.targetTss, budgetMin: 0, isSecond, ref: u.ref, downgrade, pair: u.pair });

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

  // v2.7.0: Klassifikation über die authoritative Rolle aus pickWeekWorkouts (quality|long|easy|core), sonst
  // Fallback auf die Typ-Heuristik. WICHTIG für Quality-Tage: „Steady/LT1"/„Renntempo" tragen role="quality",
  // stehen aber nicht in HARD_TYPES — ohne Rolle landeten sie fälschlich als Easy und wurden nicht auf Harttage gelegt.
  const roleOf = (u: PlannedUnit): "quality" | "long" | "easy" | "core" =>
    u.role ?? (isLongType(u.type) ? "long" : isHardType(u.type) ? "quality" : isCoreType(u.type) ? "core" : "easy");
  const longs = units.filter((u) => roleOf(u) === "long");
  const hards = units.filter((u) => roleOf(u) === "quality");
  const cores = units.filter((u) => roleOf(u) === "core");
  const easies = units.filter((u) => roleOf(u) === "easy");

  // 1) Longrun: bevorzugt longRunDay, sonst erster freier Trainingstag.
  for (const u of longs) {
    let idx = availability.longRunDay != null && (budget[availability.longRunDay] || 0) > 0 && !used.has(availability.longRunDay)
      ? availability.longRunDay : pickFree();
    if (idx == null) idx = trainingDays[0];
    used.add(idx); out.push(mk(idx, u));
  }

  // 2) Qualität: STRIKT kein harter Tag an einem Folgetag (v1.7.0). Hügel bevorzugt hillDay.
  //    Findet kein spacing-konformer Tag → Einheit wird abgestuft (downgrade → rendert als Easy).
  // #3: Der bevorzugte Berg-Tag ist zugleich ein flexibler Qualitätstag — an ihm darf auch ein Tempo-/Schwellenlauf
  // liegen (Berg-Units behalten via `wish` unten die Erst-Präferenz). So ist „ein Tag, mal Berg, mal Tempo" möglich,
  // statt den Tag starr auf Berg festzunageln. Welcher Typ konkret kommt, entscheidet die Phasen-Rotation upstream.
  const qualityDaySet = new Set<number>(availability.hardDays?.length ? availability.hardDays : trainingDays);
  if (availability.hillDay != null) qualityDaySet.add(availability.hillDay);
  const hardDayPref = [...qualityDaySet].filter((d) => (budget[d] || 0) > 0).sort((a, b) => a - b);
  const placedHard = new Set<number>();
  const spacingOk = (d: number) => !used.has(d) && (budget[d] || 0) > 0 && !placedHard.has(d - 1) && !placedHard.has(d + 1);
  // v3.1.0 (Zeitmangel-Priorisierung): Intensität schützen, Volumen kürzen — aber eine Qualität braucht ein Minimum
  // an Zeit (Ein-/Auslaufen + Kern-Reps). Deshalb zuerst einen Qualitätstag MIT Luft suchen und erst danach einen
  // engen Tag nehmen (dort greift dann die Reps-Kürzung im Renderer, die Pace bleibt).
  const QUALITY_MIN_MIN = 50;
  const roomy = (d: number) => (budget[d] || 0) >= QUALITY_MIN_MIN;
  const pickHardDay = (wish: number | null): number | undefined => {
    if (wish != null && spacingOk(wish) && roomy(wish)) return wish;
    if (wish != null && spacingOk(wish)) return wish;
    return hardDayPref.filter(roomy).find(spacingOk)
      ?? hardDayPref.find(spacingOk)
      ?? trainingDays.filter(roomy).find(spacingOk)
      ?? trainingDays.find(spacingOk);
  };

  // 2a) Doppel-Schwellen-Tage (v1.7.0): gepaarte Einheiten teilen EINEN harten Tag (AM + PM); zählt als ein harter Tag.
  const pairGroups = new Map<string, PlannedUnit[]>();
  const soloHards: PlannedUnit[] = [];
  for (const u of hards) { if (u.pair) { const g = pairGroups.get(u.pair) ?? []; g.push(u); pairGroups.set(u.pair, g); } else soloHards.push(u); }
  for (const group of pairGroups.values()) {
    const idx = pickHardDay(null);
    if (idx != null) {
      used.add(idx); placedHard.add(idx);
      group.forEach((u, i) => out.push(mk(idx, u, i > 0)));        // 2. Hälfte = isSecond (PM)
    } else {
      const d = pickFree() ?? trainingDays.find((x) => !used.has(x)) ?? trainingDays[0];
      used.add(d); group.forEach((u, i) => out.push(mk(d, u, i > 0, true))); // kein spacing-konformer Tag → abstufen
    }
  }

  // 2b) Einzel-Qualität: STRIKT kein harter Tag an einem Folgetag. Hügel bevorzugt hillDay.
  //     Berg-Units zuerst, damit sie ihren Wunschtag vor konkurrierenden Tempo-Units belegen.
  soloHards.sort((a, b) => Number(isHillUnit(b.type)) - Number(isHillUnit(a.type)));
  for (const u of soloHards) {
    const wish = isHillUnit(u.type) && availability.hillDay != null ? availability.hillDay : null;
    const idx = pickHardDay(wish);
    if (idx != null) { used.add(idx); placedHard.add(idx); out.push(mk(idx, u)); }
    else {
      // Kein Tag ohne harten Nachbarn frei → Erholung schützen: als Easy abstufen.
      const d = pickFree() ?? trainingDays.find((x) => !used.has(x)) ?? trainingDays[0];
      used.add(d); out.push(mk(d, u, false, true));
    }
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

  // 4) Stabi/Core (v1.7.0): leichte Zusatz-Einheit — bevorzugt coreDays, sonst an einen Easy-Tag angehängt
  //    (nicht an harte/Long-Tage, um die Qualität nicht zu belasten).
  for (const u of cores) {
    const coreDays = (availability.coreDays?.length ? availability.coreDays : []).filter((d) => (budget[d] || 0) > 0);
    const dayUnits = (d: number) => out.filter((o) => o.weekdayIdx === d).length;
    const easyOccupied = trainingDays.filter((d) => out.some((o) => o.weekdayIdx === d && !isHardType(o.type) && !isLongType(o.type)));
    const d = coreDays.find((x) => dayUnits(x) < 2)
      ?? easyOccupied.find((x) => dayUnits(x) < 2)
      ?? trainingDays.find((x) => !placedHard.has(x))
      ?? trainingDays[0];
    out.push(mk(d, u, true)); // isSecond = leichte Zusatz-Einheit
  }

  // Budget je Einheit: Tagesbudget durch Anzahl Einheiten des Tages teilen (Doubles/Core).
  for (const o of out) {
    const k = out.filter((x) => x.weekdayIdx === o.weekdayIdx).length;
    o.budgetMin = k > 0 ? Math.round((budget[o.weekdayIdx] || 0) / k) : (budget[o.weekdayIdx] || 0);
  }
  return out.sort((a, b) => a.weekdayIdx - b.weekdayIdx);
}
