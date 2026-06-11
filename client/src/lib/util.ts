export const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export const SPORTS = [
  { value: "Run", label: "Lauf" },
  { value: "BikeRoad", label: "Rennrad" },
  { value: "BikeIndoor", label: "Rolle" },
  { value: "Other", label: "Sonstiges" },
];

export const SESSION_TYPES: { value: string; label: string; color: string }[] = [
  { value: "Easy", label: "Easy / GA1", color: "#3b82f6" },
  { value: "Long", label: "Longrun", color: "#6366f1" },
  { value: "Threshold", label: "Schwelle / Sub-T", color: "#eab308" },
  { value: "VO2", label: "VO2 / Intervalle", color: "#f97316" },
  { value: "Hill", label: "Berg", color: "#a855f7" },
  { value: "Race", label: "Wettkampf", color: "#ef4444" },
  { value: "Strength", label: "Stabi / Athletik", color: "#14b8a6" },
  { value: "Physio", label: "KG / Physio", color: "#64748b" },
  { value: "Rest", label: "Ruhetag", color: "#9ca3af" },
];

export const PHASES = [
  "Grundlage", "Belastung", "Belastung 1/2", "Belastung 2/2", "Entlastung",
  "Race Week", "Race", "Gesund werden",
];

export function typeColor(type: string): string {
  return SESSION_TYPES.find((t) => t.value === type)?.color ?? "#9ca3af";
}
export function typeLabel(type: string): string {
  return SESSION_TYPES.find((t) => t.value === type)?.label ?? type;
}
export function sportLabel(sport: string): string {
  return SPORTS.find((s) => s.value === sport)?.label ?? sport;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** YYYY-MM-DD um n Tage verschieben. */
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysOfWeek(startIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(startIso, i));
}

export function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

export function paceStr(secPerKm?: number | null): string {
  if (!secPerKm || !isFinite(secPerKm)) return "–";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function fmtDur(sec?: number | null): string {
  if (!sec) return "–";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}:${m.toString().padStart(2, "0")} h` : `${m} min`;
}

export function num(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
