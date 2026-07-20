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

// v3.2.0 — Das „heute" der App kommt vom Server (siehe /api/app-time): Im Demo-Profil „Tutorial: Isabel" ist es
// EINGEFROREN, damit die Demo nie veraltet. Würde der Browser hier weiter die Systemuhr lesen, zeigte die
// Wochenauswahl das echte Jahr, während der Server in Isabels Zeit plant — jede Seite wäre in sich widersprüchlich.
// Beim Start einmal gesetzt (vor dem ersten Render); ein Profilwechsel lädt die App neu, also bleibt es stimmig.
let appToday: string | null = null;
export function setAppToday(iso: string | null): void {
  appToday = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}
function localTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
/** „Heute" aus Sicht der App (Demo-Profil: eingefroren) — Fallback ist die Systemuhr. */
export function todayIso(): string {
  return appToday ?? localTodayIso();
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

/** Dauer-Eingabe → Sekunden. Akzeptiert „h:mm:ss" / „mm:ss"; eine reine Zahl ohne „:" gilt als
 *  Minuten (rückwärtskompatibel zur alten Minuten-Eingabe). Leer/ungültig → null. */
export function clockToSec(str?: string | null): number | null {
  const t = (str ?? "").trim();
  if (!t) return null;
  if (!t.includes(":")) {
    const min = Number(t);
    return isNaN(min) ? null : Math.round(min * 60);
  }
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}

/** Sekunden → „h:mm:ss" (mit führender Null bei m/s), sonst „m:ss". Leer/0 → "". */
export function secToClock(sec?: number | null): string {
  if (!sec || sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h
    ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    : `${m}:${s.toString().padStart(2, "0")}`;
}

// M5: kompakte Distanz-Namen für PB-Marker (knapper als Bestleistungen-Seite, da Annotation).
const PB_DIST_NAMES: Record<number, string> = {
  1000: "1 km", 1609: "1 Meile", 3219: "2 Meilen", 5000: "5 km", 10000: "10 km",
  15000: "15 km", 16093: "10 Meilen", 20000: "20 km", 21097: "HM", 42195: "Marathon",
};
function pbDistLabel(m: number): string {
  return PB_DIST_NAMES[m] || (m >= 1000 ? `${Math.round(m / 100) / 10} km` : `${m} m`);
}

/** PMC-Annotation (M5): Bestleistungen je Distanz → dezente Marker { date, label } auf der Zeitachse. */
export function pbMarkers(pbs?: { distance_m: number; time_s: number; date: string }[] | null): { date: string; label: string }[] {
  return (pbs ?? [])
    .filter((p) => p.date)
    .map((p) => ({ date: p.date, label: `PB ${pbDistLabel(p.distance_m)} · ${secToClock(p.time_s)}` }));
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

/** Inverse zu `isoWeek`: Montag (YYYY-MM-DD) der ISO-Kalenderwoche `week` im Jahr `year`.
 *  ISO: der 4. Januar liegt immer in KW1. (v0.12.0, ToDo 1) */
export function mondayOfIsoWeek(year: number, week: number): string {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7; // Mo=0 … So=6
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dow + (week - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

/** Anzeige-Label „KW9" aus dem Wochen-Start; Fallback auf „Woche N". */
export function weekLabel(w: { start_date?: string; week_no?: number } | null | undefined): string {
  if (w?.start_date) return `KW${isoWeek(w.start_date)}`;
  return `Woche ${w?.week_no ?? ""}`.trim();
}

/** Gruppiert Elemente nach Jahr (aus start_date), Jahre aufsteigend; Reihenfolge innerhalb gewahrt. */
export function groupByYear<T extends { start_date?: string }>(items: T[]): { year: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const y = it.start_date?.slice(0, 4) || "—";
    if (!map.has(y)) map.set(y, []);
    map.get(y)!.push(it);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, list]) => ({ year, items: list }));
}

// M-4 (Trail-Modul): Vert-Load-UI (Höhenmeter-Tile/-Trend) nur zeigen, wenn Klettern ein relevanter Trainings-
// anteil ist — gemessen als Ø Höhenmeter/Woche (Lauf), NICHT als absolute Summe (die klettert jeder über Monate voll).
// Schwelle: ~450 hm/Woche trennt Trail/Berg (Yara ~492, Petra ~473) von rollend/flach (Clara ~371, Noah ~398). Tunable.
export const VERT_WEEK_HM = 450;
