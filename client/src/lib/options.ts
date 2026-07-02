// Konfigurierbare Auswahllisten (Phasen, Sportarten, Einheitstypen, Aktivitätstypen).
// Werden vom Server (/api/options) geladen und in einem Modul-Cache gehalten, damit
// Label-/Farb-Helfer auch außerhalb von React (z.B. in Charts) synchron funktionieren.
import { useSyncExternalStore } from "react";

export interface Option {
  id?: number;
  kind: string;
  value: string;
  label: string;
  color?: string | null;
  sort?: number;
  active?: number;
  /** Nur sessionType: easy | moderate | hard — Grundlage für den TSS-Donut „nach Typ". */
  intensity?: string | null;
  /** 1 = kanonischer, hart verdrahteter Typ (nicht löschbar/umbenennbar). */
  locked?: number;
}

export type OptionKind = "phase" | "sport" | "sessionType" | "activityType" | "check" | "daily" | "dailyCat";

// Defaults = Fallback bis der Server antwortet (und für Offline-Robustheit).
export const DEFAULT_SPORTS: Option[] = [
  { kind: "sport", value: "Run", label: "Lauf", color: "#3b82f6" },
  { kind: "sport", value: "BikeRoad", label: "Rennrad", color: "#06b6d4" },
  { kind: "sport", value: "BikeIndoor", label: "Rolle", color: "#0ea5e9" },
  { kind: "sport", value: "Strength", label: "Kraft", color: "#14b8a6" },
  { kind: "sport", value: "Physio", label: "KG / Physio", color: "#64748b" },
  { kind: "sport", value: "General", label: "Allgemein / Commute", color: "#94a3b8" },
  { kind: "sport", value: "Other", label: "Sonstiges", color: "#9ca3af" },
];

export const DEFAULT_SESSION_TYPES: Option[] = [
  { kind: "sessionType", value: "Easy", label: "Easy / GA1", color: "#3b82f6", intensity: "easy" },
  { kind: "sessionType", value: "Long", label: "Longrun", color: "#6366f1", intensity: "easy" },
  { kind: "sessionType", value: "Steady", label: "Steady / Tempo", color: "#22c55e", intensity: "moderate" },
  { kind: "sessionType", value: "MarathonPace", label: "Marathon-Pace", color: "#0ea5e9", intensity: "moderate" },
  { kind: "sessionType", value: "LT1", label: "LT1 (Sub-Threshold)", color: "#84cc16", intensity: "moderate" },
  { kind: "sessionType", value: "LT2", label: "LT2 (Threshold)", color: "#eab308", intensity: "hard" },
  { kind: "sessionType", value: "Threshold", label: "Schwelle / Sub-T", color: "#eab308", intensity: "hard" },
  { kind: "sessionType", value: "VO2", label: "VO2max", color: "#f97316", intensity: "hard" },
  { kind: "sessionType", value: "Repetitions", label: "Repetitions", color: "#ef4444", intensity: "hard" },
  { kind: "sessionType", value: "Hill", label: "Berg", color: "#a855f7", intensity: "hard" },
  { kind: "sessionType", value: "Renntempo", label: "Renntempo", color: "#c2410c", intensity: "hard" },
  { kind: "sessionType", value: "Race", label: "Wettkampf", color: "#ef4444", intensity: "hard" },
  { kind: "sessionType", value: "Strength", label: "Stabi / Athletik", color: "#14b8a6" },
  { kind: "sessionType", value: "Physio", label: "KG / Physio", color: "#64748b" },
  { kind: "sessionType", value: "Rest", label: "Ruhetag", color: "#9ca3af" },
];

// Manuelle Wochen-Checks (Default-Fallback bis der Server antwortet) — in „Auswahllisten" editierbar.
export const DEFAULT_CHECKS: Option[] = [
  { kind: "check", value: "mileage", label: "Mileage erreicht", color: "#3b82f6" },
  { kind: "check", value: "threshold2x", label: "2× Schwelle", color: "#eab308" },
  { kind: "check", value: "longrun", label: "Longrun", color: "#6366f1" },
  { kind: "check", value: "plyo", label: "Plyo/Athletik", color: "#14b8a6" },
  { kind: "check", value: "physio", label: "Physio/KG", color: "#64748b" },
];

// Konfigurierbare Tagesfaktoren (Feldtyp in `intensity`; Kategorie-Zuordnung in `color`). Fallback.
const d = (value: string, label: string, intensity: string, cat: string): Option => ({ kind: "daily", value, label, intensity, color: cat });
export const DEFAULT_DAILY: Option[] = [
  d("weight", "Gewicht (kg)", "number", "morgens"), d("sleep_h", "Schlaf (h)", "number", "schlaf"),
  d("bedtime", "Bettzeit", "time", "schlaf"), d("wake_time", "Aufwachzeit", "time", "schlaf"),
  d("energy", "Energie 1-10", "scale", "subjektiv"), d("mood", "Stimmung 1-10", "scale", "subjektiv"),
  d("stress", "Stress 1-10", "scale", "subjektiv"), d("sick", "Krank", "checkbox", "sonstiges"), d("notes", "Notizen", "text", "sonstiges"),
  d("resting_hr", "Ruhepuls", "number", "morgens"), d("hrv", "HRV", "number", "morgens"), d("recovery", "Recovery %", "number", "morgens"),
  d("strain", "Strain", "number", "morgens"), d("sleep_performance", "Sleep-Performance %", "number", "schlaf"),
  d("rpe", "RPE 1-10", "scale", "subjektiv"), d("soreness", "Muskelkater 0-10", "scale", "subjektiv"), d("pain", "Schmerz 0-10", "scale", "subjektiv"),
];

// Tagesfaktor-Kategorien (in „Auswahllisten" editierbar). Fallback bis der Server antwortet.
export const DEFAULT_DAILY_CATS: Option[] = [
  { kind: "dailyCat", value: "morgens", label: "Morgens" },
  { kind: "dailyCat", value: "schlaf", label: "Schlaf" },
  { kind: "dailyCat", value: "subjektiv", label: "Subjektiv" },
  { kind: "dailyCat", value: "sonstiges", label: "Sonstiges" },
];

/** Fest eingebaute Basis-Tagesfaktoren (nicht löschbar, immer sichtbar). */
export const BASE_DAILY = new Set(["weight", "sleep_h", "bedtime", "wake_time", "energy", "mood", "stress", "sick", "notes"]);

export const DEFAULT_PHASES: Option[] = [
  { kind: "phase", value: "Base", label: "Base", color: "#64748b" },
  { kind: "phase", value: "Belastung", label: "Belastung", color: "#3b82f6" },
  { kind: "phase", value: "Entlastung", label: "Entlastung", color: "#22c55e" },
  { kind: "phase", value: "Race Week", label: "Race Week", color: "#eab308" },
  { kind: "phase", value: "Krank", label: "Krank", color: "#ef4444" },
  { kind: "phase", value: "Race Specific", label: "Race Specific", color: "#a855f7" },
];

let CACHE: Record<string, Option[]> = {
  sport: DEFAULT_SPORTS,
  sessionType: DEFAULT_SESSION_TYPES,
  phase: DEFAULT_PHASES,
  activityType: [],
  check: DEFAULT_CHECKS,
  daily: DEFAULT_DAILY,
  dailyCat: DEFAULT_DAILY_CATS,
};

const listeners = new Set<() => void>();
let version = 0;
function emit() {
  version++;
  listeners.forEach((l) => l());
}

/** Lädt die Optionen vom Server und aktualisiert den Cache (fällt sonst auf Defaults zurück). */
export async function loadOptions(): Promise<void> {
  try {
    const r = await fetch("/api/options");
    if (!r.ok) return;
    const rows = (await r.json()) as Option[];
    const next: Record<string, Option[]> = { sport: [], sessionType: [], phase: [], activityType: [], check: [], daily: [], dailyCat: [] };
    for (const o of rows) {
      if (o.active === 0) continue;
      (next[o.kind] ||= []).push(o);
    }
    CACHE = {
      sport: next.sport.length ? next.sport : DEFAULT_SPORTS,
      sessionType: next.sessionType.length ? next.sessionType : DEFAULT_SESSION_TYPES,
      phase: next.phase.length ? next.phase : DEFAULT_PHASES,
      activityType: next.activityType,
      check: next.check.length ? next.check : DEFAULT_CHECKS,
      daily: next.daily.length ? next.daily : DEFAULT_DAILY,
      dailyCat: next.dailyCat.length ? next.dailyCat : DEFAULT_DAILY_CATS,
    };
    emit();
  } catch {
    /* Defaults behalten */
  }
}

export function optionsOf(kind: OptionKind | string): Option[] {
  return CACHE[kind] || [];
}

// ---- synchrone Label-/Farb-Helfer (lesen den Live-Cache) ----
export function sportLabel(v: string): string {
  return CACHE.sport.find((o) => o.value === v)?.label ?? v;
}
export function typeLabel(v: string): string {
  return CACHE.sessionType.find((o) => o.value === v)?.label ?? v;
}
export function typeColor(v: string): string {
  return CACHE.sessionType.find((o) => o.value === v)?.color ?? "#9ca3af";
}
/** Intensitätsklasse eines Einheitstyps (easy|moderate|hard) für den TSS-Donut; Fallback moderate. */
export function typeIntensity(v: string): "easy" | "moderate" | "hard" {
  const i = CACHE.sessionType.find((o) => o.value === v)?.intensity;
  return i === "easy" || i === "moderate" || i === "hard" ? i : "moderate";
}
export function phaseLabel(v: string): string {
  return CACHE.phase.find((o) => o.value === v)?.label ?? v;
}
export function phaseColor(v: string): string {
  return CACHE.phase.find((o) => o.value === v)?.color ?? "#94a3b8";
}

// ---- React-Hook ----
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot() {
  return version;
}

/** Liefert die aktuellen Auswahllisten und re-rendert bei Änderungen. */
export function useOptions() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    sports: CACHE.sport,
    sessionTypes: CACHE.sessionType,
    phases: CACHE.phase,
    activityTypes: CACHE.activityType,
    checks: CACHE.check,
    dailyFields: CACHE.daily,
    dailyCats: CACHE.dailyCat,
    reload: loadOptions,
  };
}
