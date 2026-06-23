// Schlanke API-Schicht.
import type { Option } from "./options.ts";

export interface Profile { id: number; name: string; }
export interface RaceSplit { km?: number | null; time_s?: number | null; pace_s?: number | null; avg_hr?: number | null; max_hr?: number | null; elevation_m?: number | null; }
export interface Race {
  id?: number; date: string; name?: string; distance_m?: number | null; time_s?: number | null;
  placement?: string; notes?: string; splits?: RaceSplit[];
  max_hr?: number | null; avg_hr?: number | null; elevation_m?: number | null; source?: string;
  activity_id?: number | null; // v0.14.0: verknüpfte getrackte Einheit (Race aus Tracking)
}

// Bestzeiten + VDOT-Prognose (v0.14.0, ToDo 8)
export interface Pb { distance_m: number; time_s: number; pace_s: number; date: string; name: string; manual?: boolean; }
export interface BestsResult { pbs: Pb[]; vdot: number | null; vdotLevel: string | null; age: number | null; predictions: { distance_m: number; time_s: number }[]; }
// VO2max/VDOT + Renn-Prognose-Verlauf (v0.15.0, O1/O2)
export interface FitnessTrendPoint { date: string; vdot: number | null; p5000: number | null; p10000: number | null; p21097: number | null; p42195: number | null; }
export interface FitnessTrend { points: FitnessTrendPoint[]; current: FitnessTrendPoint | null; age: number | null; level: string | null; }
export interface PlanAdherenceWeek { week_no: number; start: string; end: string; pct: number | null; n: number; }
// Seiten-Layout (T8): freies Raster (react-grid-layout-Koordinaten) je Chart-Block.
// x/y/w/h in Rastereinheiten (12 Spalten); fehlende Felder → Default des Blocks.
export interface BlockOverride { x?: number; y?: number; w?: number; h?: number; hidden?: boolean; page?: number; }
export type LayoutMap = Record<string, BlockOverride>;

export interface HrZone { z: number; min: number; max: number; label: string; color: string; }
export interface ZoneSet { id: number; valid_from?: string; hr_zones: HrZone[]; hr_zones_bike?: HrZone[] | null; pace_zones: number[]; speed_zones?: number[]; power_zones?: number[]; lthr: number; ftp: number; threshold_pace: number; source?: string; note?: string; }
export interface SeasonWeek { week_no: number; label: string; phase: string; start_date: string; end_date: string; target_km: number | null; goal_race: string; notes: string; }
export interface ZoneAlloc { byKm?: Record<number, number>; byMin?: Record<number, number>; }
/** Strukturierte Belastung (Intervall/Schwelle): pro Wiederholung Zeit/Distanz/Pace/HF — ToDo 1/20.
 *  v0.12.0 (ToDo 2): kann auch eine eine-Ebene-Gruppe sein (`group`, `reps`, `children`) für Coros-Sets
 *  wie 3×(1000+200). Gruppen-`children` sind immer Leaf-Efforts (keine weitere Verschachtelung). */
export interface Effort {
  reps?: number; sec?: number | null; dist_m?: number | null; pace_s?: number | null;
  avg_hr?: number | null; max_hr?: number | null; zone?: number | null; label?: string;
  group?: boolean; children?: Effort[];
}
export interface PlannedSession {
  id?: number; date: string; week_no?: number | null; sport: string; type: string;
  planned_km?: number | null; planned_min?: number | null; zone_alloc?: ZoneAlloc | null;
  description?: string; structured?: unknown; efforts?: Effort[] | null; planned_tss?: number | null; sort_order?: number;
}
// Einheiten-Vorlage = Inhalt einer PlannedSession ohne Datum/Woche (per Klick in einen Tag einsetzbar).
export interface SessionTemplate {
  id?: number; name: string; sport: string; type: string;
  planned_km?: number | null; planned_min?: number | null; zone_alloc?: ZoneAlloc | null;
  description?: string; efforts?: Effort[] | null; sort_order?: number;
}
export interface Activity {
  id?: number; strava_id?: string | null; date: string; sport: string; type?: string | null; source: string; name?: string;
  distance_m?: number | null; moving_s?: number | null; elapsed_s?: number | null; avg_hr?: number | null;
  max_hr?: number | null; avg_power?: number | null; elevation?: number | null; avg_cadence?: number | null;
  training_load?: number | null; tss?: number | null; kcal?: number | null;
  ngp?: number | null; np?: number | null; // grade-adjusted Pace (s/km, Lauf) / Normalized Power (W, Rad)
  decoupling?: number | null; // aerobe Entkopplung Pa:HR (%, Lauf) — v1.2.0
  zones?: Record<number, number> | null; zone_min?: Record<number, number> | null;
  zone_km?: Record<number, number> | null; efforts?: Effort[] | null;
  overrides?: string[]; matched_session_id?: number | null; notes?: string;
}
export interface DailyLog { date: string; [k: string]: unknown; }
export interface PmcPoint { date: string; tss: number; ctl: number; atl: number; tsb: number; planned?: boolean; }
export interface Flag { level: "ok" | "info" | "warn" | "danger"; code: string; message: string; params?: Record<string, string | number | null>; }
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
  // v0.11.0 (ToDo 2) — reale Schilder für den Wochenbericht (Planung nutzt `flags` = geplant).
  realLoadFlag?: Flag | null; realKmFlag?: Flag | null; realKmIntensity?: IntensityShare;
  // reale + geplante Verteilung/Kategorien (vom Server geliefert)
  plannedZoneKm?: Record<number, number>;
  realZoneMin?: Record<number, number>; realZoneKm?: Record<number, number>;
  realByCategory?: { run: { km: number; min: number; h: number }; bike: { km: number; min: number; h: number }; strength: { min: number; h: number } };
  // v0.14.0 (ToDo 12) — Plan-Erfüllung je gematchter Einheit + Wochenmittel
  adherence?: { perSession: { session_id: number; date: string; type: string; pct: number; tssOnly: boolean }[]; weekPct: number | null };
  // v0.15.0 (O4) — TSS-Wochenempfehlung (Korridor) aus CTL + Saisonplan-Phase, 3:1-Prinzip
  tssRec?: { min: number; max: number; target: number; level: "under" | "ok" | "over"; phaseLabel: string; basis: string } | null;
  // v1.2.0 — Trainings-Monotonie & -Strain (Foster) der realen Woche
  monotony?: number; strain?: number; monotonyFlag?: Flag | null;
  // v1.3.0 (G4) — echte Zeit-in-Zone-Verteilung (Z1<LT1 / Z2 LT1–LT2 / Z3>LT2) + Polarisierungs-Index + Phasen-Ziel
  physioDist?: { z1: number; z2: number; z3: number; z1Min: number; z2Min: number; z3Min: number };
  polarizationIndex?: number | null;
  phaseTarget?: { model: "pyramidal" | "polarized" | "regenerativ"; z1: number; z2: number; z3: number; label: string };
  realPolarizationFlag?: Flag | null;
}

// v1.2.0 — Coach „Heute": Readiness + regelbasierte Tages-Empfehlung (Vorschlag-Modus).
export interface TodayResult {
  date: string;
  form: { ctl: number; atl: number; tsb: number | null; ramp: number };
  phase: string | null;
  weekTssRec: { min: number; max: number; target: number; kind: string } | null;
  readiness: { score: number; level: "green" | "yellow" | "red"; drivers: { code: string; text: string }[] } | null;
  plannedTypes: string[];
  recommendation: { headline: string; sessionType: string; doseHint: string; reasons: { code: string; text: string }[]; confidence: "hoch" | "mittel" | "niedrig" };
}

// v1.3.0 (G3) — Laktat-/Feldtest-Diagnostik.
export interface LactateTestPoint {
  id?: number; stage?: number | null;
  speed_kmh?: number | null; pace_s?: number | null; power_w?: number | null;
  hr?: number | null; lactate: number; rpe?: number | null;
}
export interface LactateTest {
  id: number; profile_id: number; date: string; sport: string; kind?: string | null; notes?: string | null;
  lt1_hr?: number | null; lt1_pace?: number | null; lt2_hr?: number | null; lt2_pace?: number | null;
  confidence?: string | null; warnings: string[]; created_at: string;
  points?: LactateTestPoint[];
}
export interface LactateThresholdResult {
  lt1: { speed_kmh: number; pace_s: number; hr: number | null; lactate: number } | null;
  lt2: { speed_kmh: number; pace_s: number; hr: number | null; lactate: number } | null;
  confidence: string; warnings: string[];
}
export interface LactateZoneProposal {
  valid_from: string; lthr: number; threshold_pace: number | null;
  lt1_hr: number; lt1_pace: number | null;
  hr_zones: HrZone[]; pace_zones: number[];
  source: string; note: string;
}

// v1.3.0 (Engine) — Wochen-/Block-Empfehlungs-Engine.
export interface WeekSessionRec { type: string; count: number; tssShare: number; hint: string; }
export interface WeekStructureRec {
  headline: string;
  periodizationModel: "block" | "traditional";
  tssRange: { min: number; max: number; target: number; kind: string };
  sessions: WeekSessionRec[];
  distTarget: { model: string; z1: number; z2: number; z3: number; label: string };
  reasons: { code: string; text: string }[];
  confidence: "hoch" | "mittel" | "niedrig";
}
export interface WeekSuggestionResult {
  week: SeasonWeek | null;
  phase: string | null;
  form: { ctl: number; tsb: number | null; ramp: number };
  readiness: { score: number; level: "green" | "yellow" | "red"; drivers: { code: string; text: string }[] } | null;
  recommendation: WeekStructureRec;
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
  // HF-/Power-Zonen aus Strava importieren (v0.14.0, ToDo 10)
  importStravaZones: (valid_from: string) => j<{ ok: true }>("/api/strava/import-zones", { method: "POST", body: JSON.stringify({ valid_from }) }),

  // v1.3.0 (G3) — Laktat-/Feldtest-Diagnostik
  lactateTests: () => j<LactateTest[]>("/api/lactate-tests"),
  lactateTest: (id: number) => j<LactateTest>(`/api/lactate-tests/${id}`),
  addLactateTest: (b: { date: string; sport?: string; kind?: string; notes?: string; points: LactateTestPoint[] }) =>
    j<LactateThresholdResult & { id: number }>("/api/lactate-tests", { method: "POST", body: JSON.stringify(b) }),
  updateLactateTest: (id: number, b: { date?: string; sport?: string; kind?: string; notes?: string; points?: LactateTestPoint[] }) =>
    j<{ ok: true } & Partial<LactateThresholdResult>>(`/api/lactate-tests/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteLactateTest: (id: number) => j<{ ok: true }>(`/api/lactate-tests/${id}`, { method: "DELETE" }),
  proposeLactateZoneset: (id: number, maxHr?: number) =>
    j<LactateZoneProposal>(`/api/lactate-tests/${id}/propose-zoneset`, { method: "POST", body: JSON.stringify({ max_hr: maxHr ?? null }) }),

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
  relinkEfforts: (id: number) => j(`/api/activities/${id}/relink-efforts`, { method: "POST" }),

  daily: (q: { from?: string; to?: string }) => {
    const p = new URLSearchParams(q as Record<string, string>).toString();
    return j<DailyLog[]>(`/api/daily?${p}`);
  },
  saveDaily: (date: string, b: Record<string, unknown>) => j(`/api/daily/${date}`, { method: "PUT", body: JSON.stringify(b) }),

  weeklog: (week: number) => j<any>(`/api/weeklog/${week}`),
  saveWeeklog: (week: number, b: Record<string, unknown>) => j(`/api/weeklog/${week}`, { method: "PUT", body: JSON.stringify(b) }),
  weeklogs: () => j<{ week_no: number; checks: Record<string, boolean> }[]>("/api/weeklogs"),

  pmc: (from: string, to: string) => j<{ pmc: PmcPoint[]; ctlRamp7: number; ctlRamp28: number }>(`/api/pmc?from=${from}&to=${to}`),
  analyzeWeek: (no: number) => j<AnalyzeResult>(`/api/analyze/week/${no}`),
  today: (date?: string) => j<TodayResult>(`/api/today${date ? `?date=${date}` : ""}`),
  weekSuggestion: (weekNo?: number) => j<WeekSuggestionResult>(`/api/plan/week-suggestion${weekNo != null ? `?week=${weekNo}` : ""}`),
  intervalsTrend: (q: { from?: string; to?: string }) => {
    const p = new URLSearchParams(q as Record<string, string>).toString();
    return j<IntervalEffortStat[]>(`/api/intervals/trend?${p}`);
  },
  cleanupOrphans: () => j<{ removed: number }>("/api/season/cleanup-orphans", { method: "POST" }),

  // Profile (leichter Account-Wechsel, ToDo #9)
  profiles: () => j<{ profiles: Profile[]; active: number }>("/api/profiles"),
  addProfile: (name: string) => j<{ id: number }>("/api/profiles", { method: "POST", body: JSON.stringify({ name }) }),
  renameProfile: (id: number, name: string) => j(`/api/profiles/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  setActiveProfile: (id: number) => j("/api/profile/active", { method: "PUT", body: JSON.stringify({ id }) }),
  deleteProfile: (id: number) => j(`/api/profiles/${id}`, { method: "DELETE" }),
  resetProfile: (id: number, code: string) => j<{ activities: number; daily: number; weeklogs: number; sessions: number; weeks: number; races: number }>(`/api/profiles/${id}/reset`, { method: "POST", body: JSON.stringify({ code }) }),

  // Races / Wettkämpfe (ToDo #24)
  races: (q?: { from?: string; to?: string }) => {
    const p = q ? new URLSearchParams(q as Record<string, string>).toString() : "";
    return j<Race[]>(`/api/races${p ? `?${p}` : ""}`);
  },
  addRace: (b: Race) => j<{ id: number }>("/api/races", { method: "POST", body: JSON.stringify(b) }),
  updateRace: (id: number, b: Race) => j(`/api/races/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteRace: (id: number) => j(`/api/races/${id}`, { method: "DELETE" }),
  importRacesFromSeason: () => j<{ created: number }>("/api/races/import-from-season", { method: "POST" }),

  // Bestzeiten + Critical Speed (v0.14.0, ToDo 8)
  bests: () => j<BestsResult>("/api/bests"),
  setBestOverride: (distance_m: number, time_s: number, date: string) =>
    j<{ ok: boolean }>("/api/bests/override", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ distance_m, time_s, date }) }),
  deleteBestOverride: (distance_m: number) =>
    j<{ ok: boolean }>(`/api/bests/override/${distance_m}`, { method: "DELETE" }),
  fitnessTrend: (from?: string, to?: string) => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return j<FitnessTrend>(`/api/fitness-trend${p.toString() ? `?${p}` : ""}`);
  },
  // Plan-Erfüllung je Saisonwoche (v0.14.0, ToDo 12)
  planAdherence: () => j<PlanAdherenceWeek[]>("/api/plan-adherence"),

  // Seiten-Layout (T8): anpassbares Chart-Raster je Seite + Profil
  getLayout: (page: string) => j<LayoutMap>(`/api/layout/${page}`),
  setLayout: (page: string, map: LayoutMap) =>
    j<{ ok: boolean }>(`/api/layout/${page}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(map) }),

  // konfigurierbare Auswahllisten (ToDo 13/24)
  options: (kind?: string) => j<Option[]>(`/api/options${kind ? `?kind=${kind}` : ""}`),
  addOption: (b: Partial<Option>) => j<{ id: number }>("/api/options", { method: "POST", body: JSON.stringify(b) }),
  updateOption: (id: number, b: Partial<Option>) => j(`/api/options/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteOption: (id: number) => j(`/api/options/${id}`, { method: "DELETE" }),

  // wiederverwendbare Einheiten-Vorlagen (häufige Einheiten 1× speichern, per Klick einsetzen)
  templates: () => j<SessionTemplate[]>("/api/templates"),
  addTemplate: (b: SessionTemplate) => j<{ id: number }>("/api/templates", { method: "POST", body: JSON.stringify(b) }),
  updateTemplate: (id: number, b: SessionTemplate) => j(`/api/templates/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteTemplate: (id: number) => j(`/api/templates/${id}`, { method: "DELETE" }),
};
