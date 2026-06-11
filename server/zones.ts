// Zonen-Set-Helfer (gültiges Set je Datum) + Wiederverwendung für Seed/Strava-Auswertung.
import { db, DEFAULT_HR_ZONES } from "./db.ts";
import type { HrZone } from "./load.ts";

export interface EffectiveZones {
  id: number;
  hr_zones: HrZone[];
  pace_zones: number[];
  lthr: number;
  ftp: number;
  threshold_pace: number;
}

function parse<T>(s: unknown, fb: T): T {
  if (typeof s !== "string") return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

const FALLBACK: EffectiveZones = {
  id: 0, hr_zones: DEFAULT_HR_ZONES as HrZone[], pace_zones: [], lthr: 172, ftp: 265, threshold_pace: 230,
};

/** Gültiges Zonen-Set zum Datum (größtes valid_from <= date). */
export function effectiveZoneSet(date: string): EffectiveZones {
  const rows = db.prepare("SELECT * FROM zone_sets ORDER BY valid_from").all() as any[];
  if (!rows.length) return FALLBACK;
  let pick = rows[0];
  for (const r of rows) if (r.valid_from <= date) pick = r;
  return {
    id: pick.id,
    hr_zones: parse<HrZone[]>(pick.hr_zones, FALLBACK.hr_zones),
    pace_zones: parse<number[]>(pick.pace_zones, []),
    lthr: pick.lthr ?? 172,
    ftp: pick.ftp ?? 265,
    threshold_pace: pick.threshold_pace ?? 230,
  };
}

/** Neuestes Zonen-Set (für Seed ohne Datum). */
export function effectiveZoneSetForSeed(): EffectiveZones {
  const row = db.prepare("SELECT * FROM zone_sets ORDER BY valid_from DESC LIMIT 1").get() as any;
  if (!row) return FALLBACK;
  return {
    id: row.id,
    hr_zones: parse<HrZone[]>(row.hr_zones, FALLBACK.hr_zones),
    pace_zones: parse<number[]>(row.pace_zones, []),
    lthr: row.lthr ?? 172,
    ftp: row.ftp ?? 265,
    threshold_pace: row.threshold_pace ?? 230,
  };
}
