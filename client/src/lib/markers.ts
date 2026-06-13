// Gemeinsame Marker für PMC + Saison-Progression: Wettkämpfe (gold) & Krank-Wochen (rot).
import type { SeasonWeek, PlannedSession } from "./api.ts";
import { weekLabel } from "./util.ts";
import type { RaceMarker, DateRange2 } from "../charts/Pmc.tsx";
import type { RaceWeekMarker } from "../charts/SeasonProgress.tsx";
import type { PhaseRun, YearMark } from "../charts/ChartDecor.tsx";

// ---- Phasen-Runs (zusammenhängende gleiche Phase) für das Farbband ----
function collapse(items: { key: string; phase: string }[]): PhaseRun[] {
  const runs: PhaseRun[] = [];
  for (const it of items) {
    if (!it.phase) continue;
    const last = runs[runs.length - 1];
    if (last && last.phase === it.phase) last.toKey = it.key;
    else runs.push({ fromKey: it.key, toKey: it.key, phase: it.phase });
  }
  return runs;
}
export function phaseRunsByDate(dates: string[], season: SeasonWeek[]): PhaseRun[] {
  return collapse(dates.map((d) => ({ key: d, phase: season.find((w) => w.start_date <= d && d <= w.end_date)?.phase || "" })));
}
export function phaseRunsByWeek(rows: { label: string; phase: string }[]): PhaseRun[] {
  return collapse(rows.map((r) => ({ key: r.label, phase: r.phase })));
}

// ---- Jahresmarken (erste Position eines neuen Jahres) ----
export function yearMarksByDate(dates: string[]): YearMark[] {
  const out: YearMark[] = []; let prev = "";
  for (const d of dates) { const y = d.slice(0, 4); if (prev && y !== prev) out.push({ key: d, year: y }); prev = y; }
  return out;
}
// Wochen-Charts: per Band-INDEX positioniert (immun gegen doppelte KW-Labels über Saisongrenzen).
// Marke sitzt am linken Rand der ERSTEN Woche des neuen Jahres → optisch „zwischen KW52 und KW1" (ToDo Z.9).
export function yearMarksByWeek(rows: { label: string; start?: string }[]): YearMark[] {
  const out: YearMark[] = []; let prev = "";
  rows.forEach((r, i) => {
    const y = r.start?.slice(0, 4); if (!y) return;
    if (prev && y !== prev) out.push({ index: i, year: y });
    prev = y;
  });
  return out;
}

function shortRace(s?: string | null): string {
  if (!s) return "Race";
  const t = s.trim();
  return t.length > 22 ? t.slice(0, 20) + "…" : t;
}

/** Races als Datum (PMC): NUR aus der races-Tabelle (Single Source of Truth, ToDo Z.12 — gelöschte Races
 *  verschwinden zuverlässig; Saisonplan-Races sind via Auto-Import ohnehin in der Tabelle). */
export function raceMarkersByDate(_sessions: PlannedSession[], races: { date: string; name?: string }[] = []): RaceMarker[] {
  const seen = new Set<string>();
  const out: RaceMarker[] = [];
  for (const r of races) { if (!seen.has(r.date)) { seen.add(r.date); out.push({ date: r.date, label: shortRace(r.name) }); } }
  return out;
}

/** Races je Woche (Saison-Progression): NUR aus der races-Tabelle (ToDo Z.12). */
export function raceMarkersByWeek(season: SeasonWeek[], _sessions: PlannedSession[], races: { date: string; name?: string }[] = []): RaceWeekMarker[] {
  const out: RaceWeekMarker[] = [];
  const seen = new Set<string>();
  for (const r of races) {
    const w = season.find((x) => x.start_date <= r.date && r.date <= x.end_date);
    if (w && !seen.has(weekLabel(w))) { seen.add(weekLabel(w)); out.push({ label: weekLabel(w), text: shortRace(r.name || "Race") }); }
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
