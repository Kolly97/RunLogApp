// Schlanke API-Schicht.
import type { Option } from "./options.ts";

export interface Profile { id: number; name: string; }
export interface RaceSplit { km?: number | null; time_s?: number | null; pace_s?: number | null; avg_hr?: number | null; max_hr?: number | null; elevation_m?: number | null; }
export interface Race {
  id?: number; date: string; name?: string; distance_m?: number | null; time_s?: number | null;
  placement?: string; notes?: string; splits?: RaceSplit[];
  max_hr?: number | null; avg_hr?: number | null; elevation_m?: number | null; source?: string;
}

export interface HrZone { z: number; min: number; max: number; label: string; color: string; }
export interface ZoneSet { id: number; valid_from?: string; hr_zones: HrZone[]; pace_zones: number[]; speed_zones?: number[]; power_zones?: number[]; lthr: number; ftp: number; threshold_pace: number; source?: string; note?: string; }
export interface SeasonWeek { week_no: number; label: string; phase: string; start_date: string; end_date: string; target_km: number | null; goal_race: string; notes: string; }
export interface ZoneAlloc { byKm?: Record<number, number>; byMin?: Record<number, number>; }
/** Strukturierte Belastung (Intervall/Schwelle): pro Wiederholung Zeit/Distanz/Pace/HF — ToDo 1/20. */
export interface Effort {
  reps?: number; sec?: number | null; dist_m?: number | null; pace_s?: number | null;
  avg_hr?: number | null; max_hr?: number | null; zone?: number | null; label?: string;
}
export interface PlannedSession {
  id?: number; date: string; week_no?: number | null; sport: string; type: string;
  planned_km?: number | null; planned_min?: number | null; zone_alloc?: ZoneAlloc | null;
  description?: string; structured?: unknown; efforts?: Effort[] | null; planned_tss?: number | null; sort_order?: number;
}
export interface Activity {
  id?: number; strava_id?: string | null; date: string; sport: string; source: string; name?: string;
  distance_m?: number | null; moving_s?: number | null; elapsed_s?: number | null; avg_hr?: number | null;
  max_hr?: number | null; avg_power?: number | null; elevation?: number | null; avg_cadence?: number | null;
  training_load?: number | null; tss?: number | null; kcal?: number | null;
  zones?: Record<number, number> | null; zone_min?: Record<number, number> | null;
  zone_km?: Record<number, number> | null; efforts?: Effort[] | null;
  overrides?: string[]; matched_session_id?: number | null; notes?: string;
}
export interface DailyLog { date: string; [k: string]: unknown; }
export interface PmcPoint { date: string; tss: number; ctl: number; atl: number; tsb: number; planned?: boolean; }
export interface Flag { level: "ok" | "info" | "warn" | "danger"; code: string; message: string; }
export interface WeekTotals {
  km: number; bike_km: number; min: number; tss: number; sessions: number; runSessions: number;
  hardSessions: number; longestKm: number; zoneMin: Record<number, number>;
  intensity: { easy: number; mod: number; hard: number };
  // ToDo 21 — Kategorie-Summen (Agent A füllt, Agent C zeigt): Lauf / Rad(indoor+outdoor) / Kraft+Mobility(nur Zeit)
  byCategory?: { run: { km: number; min: number }; bike: { km: number; min: number }; strength: { min: number } };
}
export interface IntensityShare { easy: number; mod: number; hard: number; }
export interface WeekRating { level: "easy" | "moderate" | "hard"; weekTss: number; avg4: number; }
export interface AnalyzeResult {
  totals: WeekTotals; flags: Flag[]; zones: HrZone[]; week: SeasonWeek | null;
  projectedCtlRamp: number | null; projectedTsb: number | null;
  // ToDo #7/#13 — TSS-basierte Intensität (optional, defensiv konsumieren)
  tssIntensity?: IntensityShare; zoneKmIntensity?: IntensityShare; weekRating?: WeekRating | null;
  // ToDo Z.7 — reale TSS-Intensität (hybrid) + reale Gesamt-TSS für den „Real"-Donut
  realTssIntensity?: IntensityShare; realTotalTss?: number;
  // reale + geplante Verteilung/Kategorien (vom Server geliefert)
  plannedZoneKm?: Record<number, number>;
  realZoneMin?: Record<number, number>; realZoneKm?: Record<number, number>;
  realByCategory?: { run: { km: number; min: number; h: number }; bike: { km: number; min: number; h: number }; strength: { min: number; h: number } };
}

// ToDo 2/13/20 — Intervall-/Effort-Trend (Agent A liefert via /api/intervals/trend, Agent C visualisiert).
export interface IntervalEffortStat {
  date: string;
  sessionType: string;
  category: "LT1" | "LT2" | "VO2short" | "VO2long" | "other";
  avg_pace_s?: number | null;   // Lauf: s/km
  avg_speed_kmh?: number | null; // Rad
  avg_hr?: number | null;
  reps?: number;
  label?: string;
}

async function j<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
}

export const api = {
  settings: () => j<any>("/api/settings"),
  saveSettings: (b: Record<string, unknown>) => j("/api/settings", { method: "PUT", body: JSON.stringify(b) }),

  zonesets: () => j<ZoneSet[]>("/api/zonesets"),
  zoneset: (date: string) => j<ZoneSet>(`/api/zoneset?date=${date}`),
  addZoneset: (b: Partial<ZoneSet>) => j<{ id: number }>("/api/zonesets", { method: "POST", body: JSON.stringify(b) }),
  updateZoneset: (id: number, b: Partial<ZoneSet>) => j(`/api/zonesets/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteZoneset: (id: number) => j(`/api/zonesets/${id}`, { method: "DELETE" }),

  season: () => j<SeasonWeek[]>("/api/season"),
  saveWeek: (no: number, b: Partial<SeasonWeek>) => j(`/api/season/week/${no}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteWeek: (no: number) => j(`/api/season/week/${no}`, { method: "DELETE" }),

  sessions: (q: { week?: number; from?: string; to?: string }) => {
    const p = new URLSearchParams(q as Record<string, string>).toString();
    return j<PlannedSession[]>(`/api/sessions?${p}`);
  },
  addSession: (b: PlannedSession) => j<{ id: number; planned_tss: number }>("/api/sessions", { method: "POST", body: JSON.stringify(b) }),
  updateSession: (id: number, b: PlannedSession) => j<{ planned_tss: number }>(`/api/sessions/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteSession: (id: number) => j(`/api/sessions/${id}`, { method: "DELETE" }),

  activities: (q: { from?: string; to?: string }) => {
    const p = new URLSearchParams(q as Record<string, string>).toString();
    return j<Activity[]>(`/api/activities?${p}`);
  },
  addActivity: (b: Activity) => j<{ id: number }>("/api/activities", { method: "POST", body: JSON.stringify(b) }),
  updateActivity: (id: number, b: Activity) => j(`/api/activities/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteActivity: (id: number) => j(`/api/activities/${id}`, { method: "DELETE" }),

  daily: (q: { from?: string; to?: string }) => {
    const p = new URLSearchParams(q as Record<string, string>).toString();
    return j<DailyLog[]>(`/api/daily?${p}`);
  },
  saveDaily: (date: string, b: Record<string, unknown>) => j(`/api/daily/${date}`, { method: "PUT", body: JSON.stringify(b) }),

  weeklog: (week: number) => j<any>(`/api/weeklog/${week}`),
  saveWeeklog: (week: number, b: Record<string, unknown>) => j(`/api/weeklog/${week}`, { method: "PUT", body: JSON.stringify(b) }),

  pmc: (from: string, to: string) => j<{ pmc: PmcPoint[]; ctlRamp7: number; ctlRamp28: number }>(`/api/pmc?from=${from}&to=${to}`),
  analyzeWeek: (no: number) => j<AnalyzeResult>(`/api/analyze/week/${no}`),
  intervalsTrend: (q: { from?: string; to?: string }) => {
    const p = new URLSearchParams(q as Record<string, string>).toString();
    return j<IntervalEffortStat[]>(`/api/intervals/trend?${p}`);
  },
  seed: () => j<{ weeks: number; sessions: number }>("/api/seed", { method: "POST" }),

  // Profile (leichter Account-Wechsel, ToDo #9)
  profiles: () => j<{ profiles: Profile[]; active: number }>("/api/profiles"),
  addProfile: (name: string) => j<{ id: number }>("/api/profiles", { method: "POST", body: JSON.stringify({ name }) }),
  renameProfile: (id: number, name: string) => j(`/api/profiles/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  setActiveProfile: (id: number) => j("/api/profile/active", { method: "PUT", body: JSON.stringify({ id }) }),
  deleteProfile: (id: number) => j(`/api/profiles/${id}`, { method: "DELETE" }),

  // Races / Wettkämpfe (ToDo #24)
  races: (q?: { from?: string; to?: string }) => {
    const p = q ? new URLSearchParams(q as Record<string, string>).toString() : "";
    return j<Race[]>(`/api/races${p ? `?${p}` : ""}`);
  },
  addRace: (b: Race) => j<{ id: number }>("/api/races", { method: "POST", body: JSON.stringify(b) }),
  updateRace: (id: number, b: Race) => j(`/api/races/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteRace: (id: number) => j(`/api/races/${id}`, { method: "DELETE" }),
  importRacesFromSeason: () => j<{ created: number }>("/api/races/import-from-season", { method: "POST" }),

  // konfigurierbare Auswahllisten (ToDo 13/24)
  options: (kind?: string) => j<Option[]>(`/api/options${kind ? `?kind=${kind}` : ""}`),
  addOption: (b: Partial<Option>) => j<{ id: number }>("/api/options", { method: "POST", body: JSON.stringify(b) }),
  updateOption: (id: number, b: Partial<Option>) => j(`/api/options/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteOption: (id: number) => j(`/api/options/${id}`, { method: "DELETE" }),
};
