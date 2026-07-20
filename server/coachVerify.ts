// Coach v4 — Verify-Stufe (Inc 1b, E9 „verifizieren"; die 5. Pipeline-Stufe).
//
// Pure, DB-frei, runner-testbar: prüft einen generierten Block (blockPlan-Ausgabe) gegen den Invarianten-Katalog
// (Workplan Sektion 6.1). NOCH KEIN Produktions-Gate — das kommt mit dem Audit-Harness (V13/Inc 4). Hier liefert es
// eine Verstoß-Liste, die der Golden-Report druckt; „Abweichung ist erlaubt, Schweigen nicht" (6.2).
//
// Bewusst nur die aus der Block-Ausgabe DIREKT berechenbaren Invarianten (Struktur/Sicherheit). Die km-Anteils-
// Deckel (T/I/R ≤ x % der Wochen-km) brauchen die Zonen-km-Zerlegung und folgen mit dem Audit-Harness.

import type { BlockPlan, BlockWeek, BlockDay } from "./analysis.ts";
import { workoutById, phaseKind, type AthleteType } from "./workouts.ts";

export interface Violation { week: number; code: string; severity: "hard" | "soft"; text: string }

const HARD_EFFORT = 4;
const TSB_FLOOR = -30;
const isHardTpl = (id: string | null | undefined): boolean => {
  if (!id) return false;
  const tpl = workoutById(id);
  return !!tpl && (tpl.effort ?? 0) >= HARD_EFFORT;
};
const Q_MAX: Record<AthleteType, number> = { hobby: 1, ambitious: 2, semipro: 3 };

/** Harte Qualitäts-Sessions der Woche (Doppel-Hälften zählen einzeln — die norwegische 3. Session ist bewusst ein Reiz). */
export function hardSessions(w: BlockWeek): number {
  return w.days.filter((d) => isHardTpl(d.prescription?.templateId)).length;
}

/** Invarianten einer einzelnen Woche (Sektion 6.1). `productive` = Base/Belastung/Specific, nicht Deload/Recovery/Race Week. */
export function verifyWeek(w: BlockWeek, athleteType: AthleteType): Violation[] {
  const v: Violation[] = [];
  const kind = phaseKind(w.phase);
  const productive = !w.isDeload && kind !== "recovery" && kind !== "raceweek" && kind !== "sick" && kind !== "deload";

  // Sicherheit: TSB-Ø jeder TRAININGS-Woche ≥ −30 (Überlastungsband). Recovery/Deload sind bewusst tiefer erlaubt? Nein —
  // der Floor gilt für Aufbauwochen; Recovery ist locker (hoher TSB). Wir prüfen alle nicht-Recovery-Wochen.
  if (kind !== "recovery" && w.tsbAvg != null && w.tsbAvg < TSB_FLOOR) {
    v.push({ week: w.week_no, code: "tsb_below_floor", severity: "hard", text: `TSB-Ø ${w.tsbAvg} < ${TSB_FLOOR} (Überlastungsbereich)` });
  }

  // Verteilung/Struktur: Q-Anzahl je Typ (Hobby 1 · Ambitioniert 2 · Semi-Pro 3) in produktiven Wochen.
  if (productive) {
    const q = hardSessions(w);
    if (q > Q_MAX[athleteType]) v.push({ week: w.week_no, code: "q_over_type_max", severity: "soft", text: `${q} harte Einheiten > Typ-Max ${Q_MAX[athleteType]} (${athleteType})` });
  }

  // Struktur je Lauf: jeder Lauf ≥ 20 min · Easy-Lauf ≤ 100 min · Longrun ≤ 150 min. Kraft/Core ausgenommen.
  for (const d of w.days) {
    if (isStrength(d)) continue;
    if (d.planned_min > 0 && d.planned_min < 20) v.push({ week: w.week_no, code: "run_too_short", severity: "soft", text: `${d.type} ${d.planned_min}′ < 20′ (${d.date})` });
    if (isEasy(d) && d.planned_min > 100) v.push({ week: w.week_no, code: "easy_too_long", severity: "soft", text: `Easy ${d.planned_min}′ > 100′ (${d.date})` });
    if (isLong(d) && d.planned_min > 150) v.push({ week: w.week_no, code: "long_too_long", severity: "soft", text: `Longrun ${d.planned_min}′ > 150′ (${d.date})` });
  }
  return v;
}

/** Invarianten über den ganzen Block: Entlastung mindestens alle 4 Wochen (bzw. 3/2). */
export function verifyBlock(plan: BlockPlan, athleteType: AthleteType): Violation[] {
  const out: Violation[] = [];
  for (const w of plan.weeks) out.push(...verifyWeek(w, athleteType));

  // Deload-Kadenz: kein Lauf von > 4 aufeinanderfolgenden produktiven Wochen ohne Entlastung/Taper/Recovery.
  // Kadenz gilt für die BASE/BUILD-Spanne: Specific/Taper ist der eigene Erholungsmechanismus (Volumen fällt zum
  // Renntag), zählt hier also als „Ruhe" — sonst würde jeder gesunde Marathon-Taper fälschlich als Defekt gemeldet.
  let run = 0;
  for (const w of plan.weeks) {
    const kind = phaseKind(w.phase);
    const rest = w.isDeload || kind === "recovery" || kind === "raceweek" || kind === "deload" || kind === "specific";
    if (rest) { run = 0; continue; }
    run++;
    if (run > 4) { out.push({ week: w.week_no, code: "deload_overdue", severity: "hard", text: `${run} Aufbauwochen ohne Entlastung (> 4)` }); run = 0; }
  }
  return out;
}

function isStrength(d: BlockDay): boolean { return /strength|kraft|core/i.test(d.type) || (d.prescription?.templateId ?? "").includes("core"); }
function isEasy(d: BlockDay): boolean { const id = d.prescription?.templateId ?? ""; return id.startsWith("easy") || /easy|recovery|locker/i.test(d.type); }
function isLong(d: BlockDay): boolean { return d.type === "Long" || (d.prescription?.templateId ?? "").startsWith("long"); }
