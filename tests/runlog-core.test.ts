import test from "node:test";
import assert from "node:assert/strict";
import { computePmc, rTssFromZones, vdot } from "../server/load.ts";
import { enrichZoneAllocKm, matchActivities, sessionCompletion } from "../server/analysis.ts";
import { concretizeSession, scheduleWeek } from "../server/planbuilder.ts";
import { pacingPlan } from "../server/pacing.ts";
import { lactateThresholds } from "../server/lactate.ts";
import { dailyChannelLoads, type ActivityLite } from "../server/ml/featureBackbone.ts";
import { buildProposal } from "../server/mlJobs.ts";
import { reconstructPhases } from "../server/cycleTraining.ts";

test("computePmc marks future planned days and uses previous-day TSB", () => {
  const pmc = computePmc(new Map([["2026-01-01", 100]]), "2026-01-01", "2026-01-03", "2026-01-02");
  assert.equal(pmc.length, 3);
  assert.equal(pmc[0].tsb, 0);
  assert.equal(pmc[2].planned, true);
  assert.ok(pmc[0].ctl > 0);
});

test("VDOT and planned rTSS stay in plausible ranges", () => {
  assert.ok(vdot(5000, 1200) > 45);
  const tss = rTssFromZones({ 2: 3600 }, [420, 360, 320, 285, 255, 230], 285);
  assert.ok(tss > 60 && tss < 70);
});

test("matchActivities respects explicit non-match", () => {
  const sessions = [{ id: 10, date: "2026-01-10", type: "Easy", planned_tss: 50, planned_min: 60 }];
  const ignored = matchActivities([
    { id: 1, date: "2026-01-10", type: "Easy", tss: 50, moving_s: 3600, matched_session_id: 10, sport: "Run", match_ignore: 1 },
  ], sessions);
  assert.equal(ignored.size, 0);

  const matched = matchActivities([
    { id: 2, date: "2026-01-10", type: "Easy", tss: 50, moving_s: 3600, matched_session_id: null, sport: "Run" },
  ], sessions);
  assert.equal(matched.get(2), 10);
});

test("sessionCompletion combines TSS and pace-zone overlap", () => {
  const comp = sessionCompletion(
    { planned_tss: 80, zone_alloc: { byKm: { 2: 8, 4: 4 } } },
    { tss: 80, pace_zone_min: { 2: 48, 4: 20 } },
    [420, 360, 320, 285, 255, 230],
  );
  assert.ok(comp);
  assert.equal(comp!.tssOnly, false);
  assert.ok(comp!.pct > 75);
});

test("planned sessions derive zone kilometers from minute allocations", () => {
  const planned = enrichZoneAllocKm(
    { date: "2026-01-12", sport: "Run", type: "Threshold", planned_tss: 80, planned_min: 60, zone_alloc: { byMin: { 1: 20, 4: 40 } } },
    [420, 360, 320, 285, 255, 230],
  );
  assert.ok(planned.zone_alloc?.byKm?.[1]);
  assert.ok(planned.zone_alloc?.byKm?.[4]);
  assert.ok((planned.planned_km ?? 0) > 10);

  const comp = sessionCompletion(
    { planned_tss: 80, zone_alloc: { byMin: { 2: 45, 4: 20 } } },
    { tss: 80, pace_zone_min: { 2: 45, 4: 20 } },
    [420, 360, 320, 285, 255, 230],
  );
  assert.equal(comp?.tssOnly, false);
  assert.ok((comp?.zoneScore ?? 0) > 0.95);
});

test("concretizeSession creates bounded concrete workouts", () => {
  const zones = { pace_zones: [420, 360, 320, 285, 255, 230], threshold_pace: 285, lt1_pace: 330 };
  const easy = concretizeSession("Easy", 45, zones);
  assert.equal(easy.type, "Easy");
  assert.ok(easy.planned_min >= 10);
  assert.ok((easy.planned_km ?? 0) > 0);
  assert.ok((easy.zone_alloc.byKm?.[2] ?? 0) > 0);
  assert.ok(easy.planned_tss > 35 && easy.planned_tss < 55);

  const vo2 = concretizeSession("VO2", 80, zones, { maxMin: 75 });
  assert.ok(vo2.planned_min <= 75);
  assert.ok((vo2.planned_km ?? 0) > 0);
  assert.ok(vo2.efforts?.length);
});

test("pacingPlan sums split times to the requested target", () => {
  const plan = pacingPlan({ distanceM: 10000, targetTimeS: 2400 });
  assert.equal(plan.splits.at(-1)?.cum_s, 2400);
  assert.equal(plan.even_pace_s, 240);
});

test("lactateThresholds returns ordered thresholds for a clean step test", () => {
  const res = lactateThresholds([
    { speed_kmh: 10, hr: 140, lactate: 1.2 },
    { speed_kmh: 11, hr: 150, lactate: 1.3 },
    { speed_kmh: 12, hr: 160, lactate: 1.7 },
    { speed_kmh: 13, hr: 170, lactate: 2.5 },
    { speed_kmh: 14, hr: 180, lactate: 4.2 },
  ]);
  assert.ok(res.lt1);
  assert.ok(res.lt2);
  assert.ok(res.lt1!.speed_kmh <= res.lt2!.speed_kmh);
});

test("ML feature backbone maps MarathonPace and Repetitions channels", () => {
  const acts: ActivityLite[] = [
    { date: "2026-01-01", sport: "Run", type: "MarathonPace", tss: 50, eff_vo2max: null, distance_m: 10000, moving_s: 3000 },
    { date: "2026-01-02", sport: "Run", type: "Repetitions", tss: 40, eff_vo2max: null, distance_m: 6000, moving_s: 1800 },
  ];
  const ch5 = dailyChannelLoads(acts, 5);
  assert.equal(ch5.get("2026-01-01")?.M, 50);
  assert.equal(ch5.get("2026-01-02")?.R, 40);
  const ch3 = dailyChannelLoads(acts, 3);
  assert.equal(ch3.get("2026-01-01")?.aerob, 50);
  assert.equal(ch3.get("2026-01-02")?.vo2, 40);
});

test("trial scoring: Marathon-Pace is not a hard channel, effects-overlap drives benefit", () => {
  const arm = (value: string, label: string) => ({ kind: "channel" as const, value, label });
  // Regression: der frühere /I|T/-Regex zählte „Marathon" (enthält „t") fälschlich als hart.
  const mara = buildProposal(1, arm("Marathon", "Marathon-Pace"), arm("Schwelle", "Schwelle"),
    { source: "default", rationale: "", overlap: null, ordinal: 1 });
  assert.equal(mara.risk, "niedrig"); // nur 1 harter Arm (Schwelle) → niedrig, nicht mittel
  const hardHard = buildProposal(1, arm("Schwelle", "Schwelle"), arm("VO2", "VO2max"),
    { source: "default", rationale: "", overlap: null, ordinal: 1 });
  assert.equal(hardHard.risk, "mittel"); // zwei harte Arme
  // Value-of-Information: höhere CI-Überlappung → höherer Nutzen (nicht höhere „Datenlage").
  const lowOverlap = buildProposal(1, arm("Schwelle", "Schwelle"), arm("aerob", "Aerob"),
    { source: "effects", rationale: "", overlap: 0.1, ordinal: 0 });
  const highOverlap = buildProposal(1, arm("Schwelle", "Schwelle"), arm("aerob", "Aerob"),
    { source: "effects", rationale: "", overlap: 0.9, ordinal: 0 });
  assert.ok(highOverlap.scores.benefit > lowOverlap.scores.benefit);
  assert.equal(highOverlap.scores.data, lowOverlap.scores.data); // Datenlage hängt NICHT am Overlap
});

test("cycle backfill: reconstructs phase from full period history without future leakage (#14)", () => {
  const periods = [{ start_date: "2026-01-01" }, { start_date: "2026-01-29" }, { start_date: "2026-02-26" }];
  const rows = [
    { id: 1, date: "2026-01-03", cycle_phase: null, cycle_day: null }, // war ungestempelt → wird gefüllt
    { id: 2, date: "2026-02-10", cycle_phase: null, cycle_day: null },
  ];
  const natural = { method: "none" as const };
  const stamps = reconstructPhases(rows, periods, natural);
  const s1 = stamps.find((s) => s.id === 1)!;
  assert.equal(s1.phase, "menstrual"); // Tag 3 nach Periodenstart
  assert.ok(s1.changed);
  // Kein Leakage: die Phase am 03.01. nutzt NUR den Start am 01.01., nicht die späteren Perioden.
  const onlyFirst = reconstructPhases([rows[0]], [{ start_date: "2026-01-01" }], natural)[0];
  assert.equal(onlyFirst.phase, s1.phase);
  assert.equal(onlyFirst.cycleDay, s1.cycleDay);
  // Verhütung unterdrückt → keine Phase.
  const suppressed = reconstructPhases(rows, periods, { method: "combined_pill" as const });
  assert.equal(suppressed[0].phase, null);
});

test("scheduler: hill-preferred day doubles as a flexible quality day (#3)", () => {
  const budget = [0, 60, 0, 60, 0, 0, 90]; // Di(1), Do(3), So(6) trainierbar
  const avail = { minutesByWeekday: budget, hardDays: [3], hillDay: 1, longRunDay: 6, allowDoubles: false };
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11"];
  // Berg-Woche: Hügel-Einheit auf den bevorzugten Berg-Tag (Di=1).
  const hillWeek = scheduleWeek([{ type: "Hill", targetTss: 60 }, { type: "Easy", targetTss: 40 }], avail, dates);
  assert.equal(hillWeek.find((u) => u.type === "Hill")?.weekdayIdx, 1);
  // Tempo-Woche: Threshold darf jetzt auf DENSELBEN Tag (1) — früher nur auf hardDays (3).
  const tempoWeek = scheduleWeek([{ type: "Threshold", targetTss: 60 }, { type: "Easy", targetTss: 40 }], avail, dates);
  assert.equal(tempoWeek.find((u) => u.type === "Threshold")?.weekdayIdx, 1);
});

test("concretizeSession: MarathonPace is moderate (Z3), Repetitions are fast intervals — not Easy (#12)", () => {
  const zones = { pace_zones: [420, 360, 320, 285, 255, 230], threshold_pace: 285, lt1_pace: 330 };
  const mp = concretizeSession("MarathonPace", 60, zones);
  // Marathon-Pace darf NICHT als lockerer Z2-Lauf rendern.
  assert.ok((mp.zone_alloc.byMin?.[3] ?? 0) > 0, "MarathonPace liegt in Z3");
  assert.equal(mp.zone_alloc.byMin?.[2] ?? 0, 0);
  const rep = concretizeSession("Repetitions", 60, zones);
  assert.ok(rep.efforts?.length, "Repetitions sind Intervalle");
  assert.ok((rep.zone_alloc.byMin?.[6] ?? 0) > 0, "Repetitions in schnellster Zone (6)");
  assert.ok((rep.paceTarget ?? 999) <= 230, "Rep-Pace ist schnell (≤ Z6-Grenze)");
});
