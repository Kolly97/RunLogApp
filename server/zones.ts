// Zonen-Set-Helfer (gültiges Set je Datum) + Wiederverwendung für Seed/Strava-Auswertung.
// Zonen sind personenspezifisch → immer auf das aktive Profil gefiltert.
import { db, DEFAULT_HR_ZONES, activeProfile } from "./db.ts";
import type { HrZone } from "./load.ts";

export interface EffectiveZones {
  id: number;
  hr_zones: HrZone[];
  hr_zones_bike: HrZone[] | null; // separate HF-Zonen fürs Rad; null = Lauf-Zonen als Fallback
  pace_zones: number[];
  speed_zones: number[]; // km/h-Obergrenzen je Zone (Rad, Legacy-Fallback)
  power_zones: number[]; // Watt-Obergrenzen je Zone 1–6 (Rad, bevorzugt für Plan-TSS)
  lthr: number;
  ftp: number;
  threshold_pace: number;
}

function parse<T>(s: unknown, fb: T): T {
  if (typeof s !== "string") return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

const FALLBACK: EffectiveZones = {
  id: 0, hr_zones: DEFAULT_HR_ZONES as HrZone[], hr_zones_bike: null, pace_zones: [], speed_zones: [], power_zones: [], lthr: 172, ftp: 265, threshold_pace: 230,
};

/** Gültiges Zonen-Set zum Datum (größtes valid_from <= date). */
export function effectiveZoneSet(date: string): EffectiveZones {
  const rows = db.prepare("SELECT * FROM zone_sets WHERE profile_id=? ORDER BY valid_from").all(activeProfile()) as any[];
  if (!rows.length) return FALLBACK;
  let pick = rows[0];
  for (const r of rows) if (r.valid_from <= date) pick = r;
  return {
    id: pick.id,
    hr_zones: parse<HrZone[]>(pick.hr_zones, FALLBACK.hr_zones),
    hr_zones_bike: (pick as any).hr_zones_bike ? parse<HrZone[]>((pick as any).hr_zones_bike, []) : null,
    pace_zones: parse<number[]>(pick.pace_zones, []),
    speed_zones: parse<number[]>(pick.speed_zones, []),
    power_zones: parse<number[]>(pick.power_zones, []),
    lthr: pick.lthr ?? 172,
    ftp: pick.ftp ?? 265,
    threshold_pace: pick.threshold_pace ?? 230,
  };
}

/** Neuestes Zonen-Set (für Seed ohne Datum). */
export function effectiveZoneSetForSeed(): EffectiveZones {
  const row = db.prepare("SELECT * FROM zone_sets WHERE profile_id=? ORDER BY valid_from DESC LIMIT 1").get(activeProfile()) as any;
  if (!row) return FALLBACK;
  return {
    id: row.id,
    hr_zones: parse<HrZone[]>(row.hr_zones, FALLBACK.hr_zones),
    hr_zones_bike: row.hr_zones_bike ? parse<HrZone[]>(row.hr_zones_bike, []) : null,
    pace_zones: parse<number[]>(row.pace_zones, []),
    speed_zones: parse<number[]>(row.speed_zones, []),
    power_zones: parse<number[]>(row.power_zones, []),
    lthr: row.lthr ?? 172,
    ftp: row.ftp ?? 265,
    threshold_pace: row.threshold_pace ?? 230,
  };
}
