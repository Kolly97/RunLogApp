// Gemeinsame Marker für PMC + Saison-Progression: Wettkämpfe (gold) & Krank-Wochen (rot).
import type { SeasonWeek, PlannedSession } from "./api.ts";
import { weekLabel } from "./util.ts";
import type { RaceMarker, DateRange2 } from "../charts/Pmc.tsx";
import type { RaceWeekMarker } from "../charts/SeasonProgress.tsx";

function shortRace(s?: string | null): string {
  if (!s) return "Race";
  const t = s.trim();
  return t.length > 22 ? t.slice(0, 20) + "…" : t;
}

/** Races als Datum (PMC): geplante Einheiten vom Typ „Race". */
export function raceMarkersByDate(sessions: PlannedSession[]): RaceMarker[] {
  return sessions.filter((s) => s.type === "Race").map((s) => ({ date: s.date, label: shortRace(s.description) }));
}

/** Races je Woche (Saison-Progression): aus Race-Einheiten + `goal_race`. */
export function raceMarkersByWeek(season: SeasonWeek[], sessions: PlannedSession[]): RaceWeekMarker[] {
  const out: RaceWeekMarker[] = [];
  const seen = new Set<string>();
  for (const s of sessions) {
    if (s.type !== "Race") continue;
    const w = season.find((x) => x.start_date <= s.date && s.date <= x.end_date);
    if (w && !seen.has(weekLabel(w))) { seen.add(weekLabel(w)); out.push({ label: weekLabel(w), text: shortRace(s.description) }); }
  }
  for (const w of season) {
    const lbl = weekLabel(w);
    if (w.goal_race && !seen.has(lbl)) { seen.add(lbl); out.push({ label: lbl, text: shortRace(w.goal_race) }); }
  }
  return out;
}

/** Krank-Wochen als Datumsbereich (PMC). */
export function sickRangesByDate(season: SeasonWeek[]): DateRange2[] {
  return season.filter((w) => w.phase === "Krank").map((w) => ({ from: w.start_date, to: w.end_date }));
}

/** Krank-Wochen als Wochen-Labels (Saison-Progression). */
export function sickWeekLabels(season: SeasonWeek[]): string[] {
  return season.filter((w) => w.phase === "Krank").map((w) => weekLabel(w));
}
