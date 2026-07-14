// Runner v3.2.0 Teil 2: Die Woche folgt dem Umfang. Prüft Struktur (Anzahl/Länge der Läufe) + Reiz (ACWR/TSB).
import { blockPlan } from "./server/analysis.ts";
import { type Availability, type ZonesInput } from "./server/planbuilder.ts";

const zones: ZonesInput = {
  pace_zones: [360, 330, 300, 270, 245, 225], threshold_pace: 270, lt1_pace: 300,
  cs_pace: 245, rep_pace: 225, hr_zones: [], goal_distance_m: 21097.5, goal_pace: 265,
};
const av: Availability = { minutesByWeekday: [70, 90, 70, 95, 60, 45, 160], longRunDay: 6, hardDays: [1, 3] };

// Historie: CTL ~40 (≈ 280 TSS/Woche)
const hist = new Map<string, number>();
for (let i = 0; i < 120; i++) {
  const d = new Date(Date.parse("2026-03-16T00:00:00Z") + i * 86400000).toISOString().slice(0, 10);
  hist.set(d, i % 7 === 0 ? 0 : 47);
}
const today = "2026-07-14";
const mkWeeks = (targetKm: number | null, n = 6) => Array.from({ length: n }, (_, i) => {
  const start = new Date(Date.parse("2026-07-20T00:00:00Z") + i * 7 * 86400000).toISOString().slice(0, 10);
  return {
    week_no: 100 + i, phase: "Belastung", start_date: start,
    dates: Array.from({ length: 7 }, (_, k) => new Date(Date.parse(start + "T00:00:00Z") + k * 86400000).toISOString().slice(0, 10)),
    target_km: targetKm,
  };
});

console.log("=== 1) Struktur folgt dem Umfang ===");
console.log("Ziel   geplant  Läufe  kürzester  längster  Longrun-Anteil  TSS");
for (const km of [15, 25, 40, 60, 80, 95]) {
  const plan = blockPlan({
    weeks: mkWeeks(km), historicalDailyTss: hist, from: "2026-03-16", today, raceDate: null,
    zones, availability: av, readinessLevel: null, goalDistanceM: 21097.5, curVdot: 50, goalTimeS: 5400,
  });
  const w = plan.weeks[1];
  const runs = w.days.filter((d) => (d.planned_min ?? 0) > 0 && d.type !== "Strength");
  const kmOfDay = (d: typeof runs[number]) => Object.values(d.zone_alloc?.byKm ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const got = runs.reduce((a, d) => a + kmOfDay(d), 0);
  const mins = runs.map((d) => d.planned_min ?? 0).sort((a, b) => a - b);
  const longKm = Math.max(...runs.map(kmOfDay));
  console.log(
    `${String(km).padEnd(6)} ${got.toFixed(0).padEnd(8)} ${String(runs.length).padEnd(6)} ` +
    `${String(mins[0] ?? 0).padEnd(10)} ${String(mins[mins.length - 1] ?? 0).padEnd(9)} ` +
    `${(got > 0 ? (longKm / got) * 100 : 0).toFixed(0).padEnd(15)}% ${w.tssActual}`,
  );
}

console.log("\n=== 2) Der Reiz: ACWR + TSB in Aufbauwochen (ohne km-Vorgabe → Engine wählt) ===");
const plan2 = blockPlan({
  weeks: mkWeeks(null, 8), historicalDailyTss: hist, from: "2026-03-16", today, raceDate: null,
  zones, availability: av, readinessLevel: null, goalDistanceM: 21097.5, curVdot: 50, goalTimeS: 5400,
});
console.log("KW    km   TSS   CTL    ACWR   TSB-Mo  TSB-Ø   CTL-Ramp");
let prevCtl: number | null = null;
for (const w of plan2.weeks) {
  const ctl = w.ctlStart ?? 0;
  const km = Math.round(w.days.reduce((a, d) => a + Object.values(d.zone_alloc?.byKm ?? {}).reduce((x, y) => x + (Number(y) || 0), 0), 0));
  const ramp = prevCtl == null ? 0 : ctl - prevCtl;
  prevCtl = ctl;
  console.log(`${w.week_no}  ${String(km).padEnd(4)} ${String(w.tssActual).padEnd(5)} ${ctl.toFixed(1).padEnd(6)} ${(w.tssActual / (ctl * 7)).toFixed(2)}   ${String(w.tsbStart).padEnd(7)} ${String(w.tsbAvg).padEnd(7)} ${ramp.toFixed(1)}`);
}
const codes = [...new Set(plan2.weeks.flatMap((w) => w.reasons.map((r) => r.code)))];
console.log("reasons:", codes.join(", "));

// 3) Wie sieht die Form INNERHALB einer Aufbauwoche aus? (tsbStart ist nur der Montags-Stichtag)
import { computePmc } from "./server/load.ts";
{
  const merged = new Map(hist);
  for (const w of plan2.weeks) for (const d of w.days) merged.set(d.date, (merged.get(d.date) ?? 0) + d.planned_tss);
  const pmc = computePmc(merged, "2026-03-16", "2026-09-13", today);
  const wk = plan2.weeks[6]; // eine späte Aufbauwoche
  console.log(`\n=== 3) Form im Tagesverlauf — KW ${wk.week_no} (${wk.tssActual} TSS) ===`);
  console.log("Datum        TSS   CTL    ATL    TSB");
  for (const d of wk.days.map((x) => x.date).sort()) {
    const p = pmc.find((x) => x.date === d);
    const tss = merged.get(d) ?? 0;
    if (p) console.log(`${d}  ${String(Math.round(tss)).padEnd(5)} ${p.ctl.toFixed(1).padEnd(6)} ${p.atl.toFixed(1).padEnd(6)} ${p.tsb.toFixed(1)}`);
  }
  const tsbs = wk.days.map((x) => pmc.find((p) => p.date === x.date)?.tsb ?? 0);
  console.log(`Ø TSB in der Woche: ${(tsbs.reduce((a, b) => a + b, 0) / tsbs.length).toFixed(1)} · tiefster: ${Math.min(...tsbs).toFixed(1)}`);
}
