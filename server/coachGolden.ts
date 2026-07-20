// Coach v4 — Golden-File-Harness (Inc 1b, E9).
//
// Zweck: ein DB-freies Regressionsnetz für `blockPlan`. Drei physiologisch konsistente Referenz-Athleten
// (Hanna/Ben/Mara — Workplan Sektion 0) werden als REINE `blockPlan`-Args gebaut, der Block generiert und seine
// stabilen Strukturmerkmale (Q/Woche · Verteilung · Longrun-Verlauf · Taper · km · TSB · reasons-Codes) als
// Golden-JSON festgeschrieben. Vor/nach dem Pipeline-Refactor MUSS `golden:coach` byte-identisch bleiben —
// das ist das harte Gate, das den Umbau absichert (Sektion 6.2/6.3).
//
//   npm run golden:coach          → vergleicht gegen server/golden/*.json (Exit 1 bei Abweichung) + druckt 6.3-Tabelle
//   npm run golden:coach:update   → schreibt die Golden-Dateien neu (nur bei bewusst gewollter Änderung)
//
// Rein: importiert nur die Compute-Module (analysis/load/planbuilder/workouts) — kein db.ts, kein index.ts.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blockPlan, type BlockPlan, type BlockWeekInput } from "./analysis.ts";
import { danielsPaces, predictFromVdot, computeOptimalZones } from "./load.ts";
import { workoutById, schoolRecipe, recommendMethod, type AthleteType, type InjuryHistory, type CoachMethod } from "./workouts.ts";
import { verifyBlock } from "./coachVerify.ts";
import type { Availability, ZonesInput } from "./planbuilder.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, "golden");
const TODAY = "2026-01-05"; // fixer Montag → deterministisch

// ---------------- Datums-Helfer (deterministisch, kein Date.now) ----------------
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------------- Referenz-Athleten (Workplan Sektion 0) ----------------
interface RefAthlete {
  key: string; name: string;
  athleteType: AthleteType;
  ageYears: number; trainingYears: number;
  injury: InjuryHistory | null;
  chronicCtl: number; chronicKm: number; daysPerWeek: number; doubles: boolean;
  vdot: number; maxHr: number;
  goalDistanceM: number; goalTimeS: number; weeksToRace: number;
}

const ATHLETES: RefAthlete[] = [
  { key: "hanna", name: "Hanna (Hobby)", athleteType: "hobby", ageYears: 34, trainingYears: 3,
    injury: { bone: true }, chronicCtl: 24, chronicKm: 28, daysPerWeek: 4, doubles: false,
    vdot: 36, maxHr: 190, goalDistanceM: 10000, goalTimeS: 54 * 60, weeksToRace: 12 },
  { key: "ben", name: "Ben (Ambitioniert)", athleteType: "ambitious", ageYears: 29, trainingYears: 8,
    injury: null, chronicCtl: 46, chronicKm: 62, daysPerWeek: 6, doubles: false,
    vdot: 54, maxHr: 192, goalDistanceM: 21097, goalTimeS: 84 * 60, weeksToRace: 16 },
  { key: "mara", name: "Mara (Semi-Pro)", athleteType: "semipro", ageYears: 26, trainingYears: 12,
    injury: { tendon: true }, chronicCtl: 86, chronicKm: 118, daysPerWeek: 7, doubles: true,
    vdot: 64, maxHr: 194, goalDistanceM: 42195, goalTimeS: 152 * 60, weeksToRace: 18 },
];

// ---------------- Zonen aus VDOT (physiologisch konsistent, reuse computeOptimalZones/danielsPaces) ----------------
function zonesForVdot(vdot: number, maxHr: number, goalDistanceM: number): ZonesInput {
  const dp = danielsPaces(vdot);
  const oz = computeOptimalZones({ vdot, csPaceS: dp.interval, maxHr, lthr: null, lactate: null, cp: null, hrLabels: [] });
  const pred = predictFromVdot(vdot, [goalDistanceM]);
  const goalPace = pred.length && pred[0].time_s > 0 ? Math.round(pred[0].time_s / (goalDistanceM / 1000)) : null;
  return {
    pace_zones: oz?.pace_zones ?? [],
    threshold_pace: dp.threshold,
    lt1_pace: dp.marathon,
    hr_zones: (oz?.hr_zones ?? []).map((z) => ({ z: z.z, min: z.min, max: z.max })),
    cs_pace: dp.interval,
    rep_pace: dp.rep,
    goal_distance_m: goalDistanceM,
    goal_pace: goalPace,
    cp: null,
  };
}

// ---------------- Verfügbarkeit je Athlet (Mon..Son = Index 0..6) ----------------
function availabilityFor(a: RefAthlete): Availability {
  // Minuten großzügig, damit das Zeitbudget nicht unter das Volumen bindet — die km folgen dem Sicherheits-Ceiling.
  const min: number[] = a.daysPerWeek >= 7
    ? [90, 100, 90, 100, 75, 150, 110]
    : a.daysPerWeek >= 6
      ? [60, 90, 60, 90, 0, 140, 100]
      : [0, 75, 0, 75, 0, 120, 80];
  return {
    minutesByWeekday: min,
    longRunDay: 5, hardDays: a.doubles ? [1, 3, 5] : [1, 3], allowDoubles: a.doubles,
    hillDay: null, corePerWeek: 1, emphasis: "ausgewogen",
  };
}

// ---------------- blockPlan-Args bauen ----------------
// method = die simulierte Methodik-Schule. „standard" → emphasisPreference undefined (heutiges Verhalten); eine
// benannte Schule reicht ihre baselineEmphasis als emphasisPreference — genau das, was der Endpoint über
// deriveCoachingPrefs (emphasisEffective = Schul-Baseline) an blockPlan gibt (E2/E3), wenn keine Evidenz vorliegt.
function buildPlan(a: RefAthlete, method: CoachMethod = "standard"): BlockPlan {
  const from = addDays(TODAY, -140);
  // Flache Historie: tägliches TSS = chronische CTL → die 42-Tage-EWMA konvergiert genau dahin.
  const historicalDailyTss = new Map<string, number>();
  for (let d = 140; d >= 1; d--) historicalDailyTss.set(addDays(TODAY, -d), a.chronicCtl);
  const weeks: BlockWeekInput[] = [];
  for (let i = 0; i < a.weeksToRace; i++) {
    const start = addDays(TODAY, i * 7);
    weeks.push({ week_no: i + 1, phase: null, start_date: start, dates: Array.from({ length: 7 }, (_, k) => addDays(start, k)), target_km: null });
  }
  const raceDate = addDays(TODAY, (a.weeksToRace - 1) * 7 + 6); // Renntag am Ende der letzten Blockwoche
  return blockPlan({
    weeks, historicalDailyTss, from, today: TODAY, raceDate,
    zones: zonesForVdot(a.vdot, a.maxHr, a.goalDistanceM),
    availability: availabilityFor(a),
    readinessLevel: null,
    goalDistanceM: a.goalDistanceM, curVdot: a.vdot, goalTimeS: a.goalTimeS,
    kmCeilingBase: a.chronicKm,
    athleteType: a.athleteType, injuryHistory: a.injury, trainingYears: a.trainingYears,
    masters: a.ageYears >= 45,
    emphasisPreference: method === "standard" ? undefined : (schoolRecipe(method).baselineEmphasis ?? undefined),
    method,
  });
}

// ---------------- Feature-Extraktion (das Golden) ----------------
const HARD_EFFORT = 4;
const isHardTpl = (id: string | undefined | null): boolean => {
  if (!id) return false;
  const tpl = workoutById(id);
  return !!tpl && (tpl.effort ?? 0) >= HARD_EFFORT;
};
const r0 = (n: number | null | undefined): number | null => (n == null ? null : Math.round(n));
const r1 = (n: number | null | undefined): number | null => (n == null ? null : Math.round(n * 10) / 10);

interface GoldenWeek {
  week_no: number; phase: string | null; isDeload: boolean;
  tssTarget: number; tssActual: number | null; ctlStart: number | null; tsbAvg: number | null;
  q: number; longMin: number | null;
  reasons: string[];
  days: { type: string; min: number; tss: number | null; tpl: string | null; pace: number | null; second: boolean }[];
}
interface Golden { athlete: string; confidence: string; raceDate: string | null; weeks: GoldenWeek[] }

function extract(a: RefAthlete, plan: BlockPlan, name: string): Golden {
  return {
    athlete: name, confidence: plan.confidence, raceDate: plan.raceDate,
    weeks: plan.weeks.map((w) => {
      const days = w.days.map((d) => ({
        type: d.type, min: d.planned_min, tss: r0(d.planned_tss),
        tpl: d.prescription?.templateId ?? null, pace: r0(d.paceTarget), second: d.isSecond,
      }));
      const longMin = w.days.filter((d) => (d.prescription?.templateId ?? "").startsWith("long") || d.type === "Long").reduce((m, d) => Math.max(m, d.planned_min), 0) || null;
      return {
        week_no: w.week_no, phase: w.phase, isDeload: w.isDeload,
        tssTarget: w.tssTarget, tssActual: r0(w.tssActual), ctlStart: r0(w.ctlStart), tsbAvg: r1(w.tsbAvg),
        q: w.days.filter((d) => !d.isSecond && isHardTpl(d.prescription?.templateId)).length
          + w.days.filter((d) => d.isSecond && isHardTpl(d.prescription?.templateId)).length, // Doppel-Hälften zählen mit
        longMin,
        reasons: [...new Set(w.reasons.map((x) => x.code))].sort(),
        days,
      };
    }),
  };
}

// ---------------- Golden lesen/schreiben/vergleichen ----------------
const ser = (g: Golden): string => JSON.stringify(g, null, 2);
const goldenPath = (key: string): string => join(GOLDEN_DIR, `${key}.json`);

// ---------------- Lesbare 6.3-Tabelle (menschlicher Check je Athlet, eine Aufbauwoche) ----------------
function printSampleWeek(a: RefAthlete, g: Golden): void {
  const wk = g.weeks.find((w) => w.phase && /belast|build|aufbau/i.test(w.phase) && !w.isDeload) ?? g.weeks[Math.min(2, g.weeks.length - 1)];
  console.log(`\n  ${a.name} — Woche ${wk.week_no} (${wk.phase ?? "—"}) · Ziel ${wk.tssTarget} TSS · CTL ${wk.ctlStart} · TSB ${wk.tsbAvg} · ${wk.q} Q`);
  for (const d of wk.days) {
    const tag = isHardTpl(d.tpl) ? "★" : d.type === "Long" || (d.tpl ?? "").startsWith("long") ? "L" : " ";
    console.log(`    ${tag} ${d.type.padEnd(16)} ${String(d.min).padStart(3)}′  ${String(d.tss ?? "").padStart(3)} TSS  ${d.tpl ?? ""}`);
  }
}

// ---------------- Main ----------------
const update = process.argv.includes("--update");
if (update && !existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });

/** Schreibt (update) bzw. vergleicht ein Golden. Gibt 1 bei Abweichung/Fehlen zurück, sonst 0. */
function syncGolden(name: string, golden: Golden): number {
  const text = ser(golden);
  const path = goldenPath(name);
  if (update) {
    writeFileSync(path, text + "\n");
    console.log(`✓ geschrieben: golden/${name}.json (${golden.weeks.length} Wochen)`);
    return 0;
  }
  if (!existsSync(path)) {
    console.log(`✗ FEHLT: golden/${name}.json — erst "npm run golden:coach:update" ausführen`);
    return 1;
  }
  const prev = readFileSync(path, "utf8").trimEnd();
  if (prev === text) { console.log(`✓ ${name}: identisch (${golden.weeks.length} Wochen)`); return 0; }
  const pl = prev.split("\n"), cl = text.split("\n");
  const firstDiff = pl.findIndex((line, i) => line !== cl[i]);
  console.log(`✗ ${name}: ABWEICHUNG ab Zeile ${firstDiff + 1}`);
  console.log(`    golden: ${pl[firstDiff] ?? "(kürzer)"}`);
  console.log(`    jetzt : ${cl[firstDiff] ?? "(kürzer)"}`);
  return 1;
}

let mismatches = 0;
console.log(`Coach-Golden — ${update ? "UPDATE (schreibe Golden)" : "VERGLEICH gegen server/golden/*.json"} · today=${TODAY}\n`);
for (const a of ATHLETES) {
  // 1) Standard = das Regressionsnetz (byte-identisch über den ganzen Umbau).
  const planStd = buildPlan(a, "standard");
  const gStd = extract(a, planStd, a.key);
  mismatches += syncGolden(a.key, gStd);
  printSampleWeek(a, gStd);
  // Verify-Stufe (Sektion 6.1): Verstöße drucken — „Abweichung ist erlaubt, Schweigen nicht".
  const viol = verifyBlock(planStd, a.athleteType);
  if (viol.length) {
    console.log(`    ⚠ ${viol.length} Invarianten-Hinweis(e):`);
    for (const x of viol.slice(0, 8)) console.log(`      [${x.severity}] W${x.week} ${x.code}: ${x.text}`);
  } else {
    console.log(`    ✓ Invarianten (6.1) sauber`);
  }
  // 2) Empfohlene Schule (E2/E3) — belegt, dass die Schule die Woche MESSBAR verändert (V4-Abnahmekriterium).
  const method = recommendMethod(a.goalDistanceM);
  const planSch = buildPlan(a, method);
  const gSch = extract(a, planSch, `${a.key}-${method}`);
  mismatches += syncGolden(`${a.key}-${method}`, gSch);
  const differs = JSON.stringify(gStd.weeks) !== JSON.stringify(gSch.weeks);
  const vSch = verifyBlock(planSch, a.athleteType);
  console.log(`    ↳ Schule „${schoolRecipe(method).label}": ${differs ? "Woche messbar VERSCHIEDEN" : "⚠ GLEICH wie Standard (kein Effekt!)"} · Invarianten ${vSch.length ? vSch.length + " Hinweis(e)" : "sauber"}`);
}

console.log("");
if (update) {
  console.log("Golden aktualisiert. Vor dem Refactor committen, danach `npm run golden:coach` muss identisch sein.");
} else if (mismatches) {
  console.log(`!!! ${mismatches} Abweichung(en) — der Block hat sich geändert. Bei GEWOLLTER Änderung: "npm run golden:coach:update".`);
  process.exit(1);
} else {
  console.log("Alle Referenz-Blöcke identisch zum Golden. ✓");
}
