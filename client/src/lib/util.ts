export const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// Auswahllisten + Label-/Farb-Helfer kommen aus options.ts (server-konfigurierbar,
// mit Live-Cache). Alt-Importe von SPORTS/SESSION_TYPES bleiben über die Defaults gültig;
// für dynamische Listen in Komponenten useOptions() verwenden.
export {
  DEFAULT_SPORTS as SPORTS,
  DEFAULT_SESSION_TYPES as SESSION_TYPES,
  typeColor,
  typeLabel,
  sportLabel,
  phaseLabel,
  phaseColor,
} from "./options.ts";
import { DEFAULT_PHASES } from "./options.ts";

/** Alt-kompatibel: Phasen-Werte als String-Liste. Für Live-Listen useOptions().phases nutzen. */
export const PHASES: string[] = DEFAULT_PHASES.map((p) => p.value);

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

/** Datum mit Jahr („1.6.2026") — für Wochen-Anzeigen, da die App mehrjährig genutzt wird. */
export function fmtDateY(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
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

// ---- Einheiten: Lauf = Pace (min/km), Rad/Commute = Geschwindigkeit (km/h) — ToDo 18/19 ----

export function isBikeSport(sport?: string | null): boolean {
  return !!sport && (sport.startsWith("Bike") || sport === "General");
}

/** Geschwindigkeit in km/h (für Rad/Rolle/Commute). */
export function speedKmh(distanceM?: number | null, movingS?: number | null): string {
  if (!distanceM || !movingS) return "–";
  const kmh = distanceM / 1000 / (movingS / 3600);
  return isFinite(kmh) ? `${kmh.toFixed(1)} km/h` : "–";
}

/** Pace (min/km) für Lauf, sonst km/h — je nach Sportart. */
export function paceOrSpeed(sport: string, distanceM?: number | null, movingS?: number | null): string {
  if (isBikeSport(sport)) return speedKmh(distanceM, movingS);
  if (!distanceM || !movingS) return "–";
  return `${paceStr(movingS / (distanceM / 1000))} /km`;
}

// ---- Kalenderwochen (ToDo 9) ----

/** ISO-8601-Kalenderwoche aus YYYY-MM-DD. */
export function isoWeek(iso: string): number {
  const d = new Date(iso + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Mo=0 … So=6
  d.setUTCDate(d.getUTCDate() - day + 3); // nächster Donnerstag
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDay = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDay + 3);
  return 1 + Math.round((d.getTime() - firstThu.getTime()) / (7 * 86400000));
}

/** Anzeige-Label „KW9" aus dem Wochen-Start; Fallback auf „Woche N". */
export function weekLabel(w: { start_date?: string; week_no?: number } | null | undefined): string {
  if (w?.start_date) return `KW${isoWeek(w.start_date)}`;
  return `Woche ${w?.week_no ?? ""}`.trim();
}
