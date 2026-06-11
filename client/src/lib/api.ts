// Schlanke API-Schicht.

export interface HrZone { z: number; min: number; max: number; label: string; color: string; }
export interface ZoneSet { id: number; valid_from?: string; hr_zones: HrZone[]; pace_zones: number[]; lthr: number; ftp: number; threshold_pace: number; source?: string; note?: string; }
export interface SeasonWeek { week_no: number; label: string; phase: string; start_date: string; end_date: string; target_km: number | null; goal_race: string; notes: string; }
export interface ZoneAlloc { byKm?: Record<number, number>; byMin?: Record<number, number>; }
export interface PlannedSession {
  id?: number; date: string; week_no?: number | null; sport: string; type: string;
  planned_km?: number | null; planned_min?: number | null; zone_alloc?: ZoneAlloc | null;
  description?: string; structured?: unknown; planned_tss?: number | null; sort_order?: number;
}
export interface Activity {
  id?: number; strava_id?: string | null; date: string; sport: string; source: string; name?: string;
  distance_m?: number | null; moving_s?: number | null; elapsed_s?: number | null; avg_hr?: number | null;
  max_hr?: number | null; avg_power?: number | null; elevation?: number | null; avg_cadence?: number | null;
  training_load?: number | null; tss?: number | null; zones?: Record<number, number> | null;
  overrides?: string[]; matched_session_id?: number | null; notes?: string;
}
export interface DailyLog { date: string; [k: string]: unknown; }
export interface PmcPoint { date: string; tss: number; ctl: number; atl: number; tsb: number; planned?: boolean; }
export interface Flag { level: "ok" | "info" | "warn" | "danger"; code: string; message: string; }
export interface WeekTotals {
  km: number; bike_km: number; min: number; tss: number; sessions: number; runSessions: number;
  hardSessions: number; longestKm: number; zoneMin: Record<number, number>;
  intensity: { easy: number; mod: number; hard: number };
}
export interface AnalyzeResult { totals: WeekTotals; flags: Flag[]; zones: HrZone[]; week: SeasonWeek | null; projectedCtlRamp: number | null; projectedTsb: number | null; }

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
  seed: () => j<{ weeks: number; sessions: number }>("/api/seed", { method: "POST" }),
};
