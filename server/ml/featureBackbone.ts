// L0 Feature-Backbone (pure, keine DB-Seiteneffekte): baut die "ehrliche" Datengrundlage für die ML-Engine
// aus bereits berechneten, gespeicherten Metriken. Der Aufrufer (mlJobs) reicht die Daten herein.
// In P1 liefert es die Komposit-Indikatoren (CS/VDOT/VO2max-Familie) + Abdeckung + Input-Hash für L2.
// Wochen-Feature-Matrix + Confounder-Flags folgen in P2 (L3), wenn das Dosis-Wirkungs-Modell sie braucht.
import { vdot } from "../load.ts";

export interface ActivityLite {
  date: string;
  sport: string | null;
  type: string | null;
  tss: number | null;
  eff_vo2max: number | null;
  distance_m: number | null;
  moving_s: number | null;
  pace_zone_min?: string | Record<string, number> | null; // JSON {zone:min} — für L3 Kanal-Attribution
}
export interface RaceLite {
  date: string;
  distance_m: number | null;
  time_s: number | null;
}
export interface LabLite {
  date: string;
  value: number | null;
}

export type IndicatorKind = "eff_vo2max" | "race_vdot" | "lab_vo2max";

/** Ein Beobachtungspunkt der Komposit-Zielgröße. `value` in Original-Einheit (VO2-äquivalent), `weight`
 * relatives Vertrauen (Labor > Rennen > Einzel-Lauf), das L2 in Beobachtungsrauschen übersetzt. */
export interface Indicator {
  date: string;
  value: number;
  kind: IndicatorKind;
  weight: number;
}

// Relatives Vertrauen je Indikator-Quelle (höher = zuverlässiger). Labor = Goldstandard.
const KIND_WEIGHT: Record<IndicatorKind, number> = { lab_vo2max: 1.0, race_vdot: 0.6, eff_vo2max: 0.25 };

/**
 * Komposit-Indikatoren (CS/VDOT/VO2max-Familie) für die latente Fitness (Frage 3: Komposit).
 * Alle Quellen sind "höher = fitter" und liegen in der gleichen VO2-äquivalenten Größenordnung
 * (VDOT ≈ VO2max). Critical Speed kommt in P2 als weitere Quelle hinzu (vorzeichen-orientiert).
 */
export function buildTargetIndicators(acts: ActivityLite[], races: RaceLite[], labs: LabLite[]): Indicator[] {
  const out: Indicator[] = [];
  for (const a of acts) {
    if (a.sport === "Run" && a.eff_vo2max != null && a.eff_vo2max > 0) {
      out.push({ date: a.date, value: a.eff_vo2max, kind: "eff_vo2max", weight: KIND_WEIGHT.eff_vo2max });
    }
  }
  for (const r of races) {
    if (r.distance_m && r.time_s && r.distance_m >= 1500 && r.time_s > 0) {
      const v = vdot(r.distance_m, r.time_s);
      if (Number.isFinite(v) && v > 0) out.push({ date: r.date, value: v, kind: "race_vdot", weight: KIND_WEIGHT.race_vdot });
    }
  }
  for (const l of labs) {
    if (l.value != null && l.value > 0) out.push({ date: l.date, value: l.value, kind: "lab_vo2max", weight: KIND_WEIGHT.lab_vo2max });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

export interface Coverage {
  nActivities: number;
  nRuns: number;
  nEffVo2max: number;
  nRaceVdot: number;
  nLab: number;
  firstDate: string | null;
  lastDate: string | null;
  spanDays: number;
}

export function coverageStats(acts: ActivityLite[], inds: Indicator[]): Coverage {
  const runs = acts.filter((a) => a.sport === "Run");
  const dates = inds.map((i) => i.date);
  const first = dates.length ? dates[0] : null;
  const last = dates.length ? dates[dates.length - 1] : null;
  return {
    nActivities: acts.length,
    nRuns: runs.length,
    nEffVo2max: inds.filter((i) => i.kind === "eff_vo2max").length,
    nRaceVdot: inds.filter((i) => i.kind === "race_vdot").length,
    nLab: inds.filter((i) => i.kind === "lab_vo2max").length,
    firstDate: first,
    lastDate: last,
    spanDays: first && last ? Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) : 0,
  };
}

/** Stabiler FNV-1a-Hash der Indikator-Reihe (für Reproduzierbarkeit/Frische — gleiche Daten → gleicher Hash). */
export function inputHash(inds: Indicator[]): string {
  let h = 0x811c9dc5;
  const s = inds.map((i) => `${i.date}|${i.kind}|${i.value.toFixed(3)}`).join(";");
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ===== Reiz-Kanäle (L3 Dosis-Wirkung): Pace-Zonen → Daniels-Kanäle, konfigurierbar 5/4/3 (Frage 9) =====
export type ChannelCount = 3 | 4 | 5;
export const CHANNEL_SETS: Record<ChannelCount, string[]> = {
  5: ["E", "M", "T", "I", "R"],
  4: ["Long", "Easy", "Schwelle", "VO2"], // session-basiert (Dauer×Qualität), NICHT zone-minute
  3: ["aerob", "threshold", "vo2"], // E+M → aerob, T → threshold, I+R → vo2 (= deine Kernfrage long/aerob vs Schwelle vs VO2max)
};
// Zone 1..6 → Kanal für die INTENSITÄTS-Modelle (5 & 3, zone-minute split). 4 ist session-basiert (s.u.).
const ZONE_TO_CHANNEL: Record<number, Record<number, string>> = {
  5: { 1: "E", 2: "E", 3: "M", 4: "T", 5: "I", 6: "R" },
  3: { 1: "aerob", 2: "aerob", 3: "aerob", 4: "threshold", 5: "vo2", 6: "vo2" },
};
const QUALITY_FRAC = 0.1; // Qualitäts-Gate: Z3+ ≥ 10 % der Dauer (Frage 4)

// Kanonisches Typ→Kanal-Mapping (HART verdrahtet): ein explizit gesetzter Typ überschreibt die Zonen-Schätzung —
// die GANZE Einheit zählt in den Kanal (z.B. als „VO2max" getaggte Einheit, die nur im Schwellenbereich lief,
// zählt trotzdem als VO2). Untypisiert / Trail / Race → kein Override (Zonen/Dauer entscheiden).
const TYPE_CHANNEL_MAP: Record<string, Partial<Record<ChannelCount, string>>> = {
  Easy: { 5: "E", 4: "Easy", 3: "aerob" }, GA1: { 5: "E", 4: "Easy", 3: "aerob" }, GA12: { 5: "E", 4: "Easy", 3: "aerob" },
  Long: { 4: "Long" }, LongQ: { 4: "Long" }, // Intensität in 5/3 aus Zonen; 4 = Long (egal ob Qualität)
  LT1: { 5: "M", 4: "Schwelle", 3: "aerob" }, Steady: { 5: "M", 4: "Schwelle", 3: "aerob" },
  LT2: { 5: "T", 4: "Schwelle", 3: "threshold" }, Threshold: { 5: "T", 4: "Schwelle", 3: "threshold" },
  VO2: { 5: "I", 4: "VO2", 3: "vo2" }, VO2long: { 5: "I", 4: "VO2", 3: "vo2" }, VO2short: { 5: "I", 4: "VO2", 3: "vo2" }, Hill: { 5: "I", 4: "VO2", 3: "vo2" },
  Rep: { 5: "R", 4: "VO2", 3: "vo2" }, Repetitions: { 5: "R", 4: "VO2", 3: "vo2" },
};
/** Typ-Override: kanonischer Typ → Kanal für die Auflösung; null = kein Override (Zonen/Dauer). */
export function typeOverrideChannel(type: string | null | undefined, channels: ChannelCount): string | null {
  if (!type) return null;
  return TYPE_CHANNEL_MAP[type]?.[channels] ?? null;
}
// Fallback ohne Pace-Zonen-Minuten: Einheitstyp → repräsentative Zone.
const TYPE_TO_ZONE: Record<string, number> = {
  Easy: 1, Long: 1, LT1: 2, Threshold: 4, LT2: 4, VO2: 5, VO2short: 5, VO2long: 5, Hill: 5, Race: 4,
};

function parseZoneMin(v: unknown): Record<string, number> | null {
  if (!v) return null;
  if (typeof v === "object") return v as Record<string, number>;
  try {
    return JSON.parse(String(v)) as Record<string, number>;
  } catch {
    return null;
  }
}

/** Long-Run-Schwelle: 75. Perzentil der Lauf-Dauer des Athleten (relativ/adaptiv, Frage 3). */
export function longRunThreshold(acts: ActivityLite[]): number {
  const durs = acts
    .filter((a) => a.sport === "Run" && (a.moving_s ?? 0) > 0)
    .map((a) => a.moving_s as number)
    .sort((x, y) => x - y);
  if (durs.length < 4) return Infinity; // zu wenig Daten → niemand ist "long"
  return durs[Math.floor(0.75 * (durs.length - 1))];
}

/** Session-Klassifizierung fürs 4-Kanal-Modell: ganze Einheit → ein Kanal (Frage 2/3/4/5). */
function classify4(a: ActivityLite, longThr: number): string | null {
  if (a.sport !== "Run" || !a.tss || a.tss <= 0) return null;
  const ov = typeOverrideChannel(a.type, 4);
  if (ov) return ov; // gesetzter Typ schlägt Dauer/Zonen
  const dur = a.moving_s ?? 0;
  if ((dur > 0 && dur >= longThr) || a.type === "Long") return "Long"; // egal ob mit Qualität
  const zm = parseZoneMin(a.pace_zone_min);
  const total = zm ? Object.values(zm).reduce((s, m) => s + (m || 0), 0) : 0;
  if (zm && total > 0) {
    const z34 = (zm["3"] ?? 0) + (zm["4"] ?? 0);
    const z5p = (zm["5"] ?? 0) + (zm["6"] ?? 0);
    if (z34 + z5p >= QUALITY_FRAC * total) return z5p > z34 ? "VO2" : "Schwelle"; // dominante Hochzone
    return "Easy";
  }
  if (a.type && /VO2|Hill/i.test(a.type)) return "VO2";
  if (a.type && /(Threshold|LT2|Sub)/i.test(a.type)) return "Schwelle";
  return "Easy";
}

/** Tägliche Kanal-Last fürs 4-Kanal-Modell (session-basiert, volle TSS je Einheit). */
function dailyChannelLoads4(acts: ActivityLite[]): Map<string, Record<string, number>> {
  const longThr = longRunThreshold(acts);
  const out = new Map<string, Record<string, number>>();
  for (const a of acts) {
    const ch = classify4(a, longThr);
    if (!ch) continue;
    let rec = out.get(a.date);
    if (!rec) { rec = {}; out.set(a.date, rec); }
    rec[ch] = (rec[ch] ?? 0) + (a.tss as number);
  }
  return out;
}

/** Tägliche Kanal-Last (nur Läufe): 5/3 = Pace-Zonen-Minuten-Split; 4 = session-basiert (s.o.). */
export function dailyChannelLoads(acts: ActivityLite[], channels: ChannelCount): Map<string, Record<string, number>> {
  if (channels === 4) return dailyChannelLoads4(acts);
  const zmap = ZONE_TO_CHANNEL[channels];
  const out = new Map<string, Record<string, number>>();
  const add = (date: string, ch: string, v: number) => {
    let rec = out.get(date);
    if (!rec) {
      rec = {};
      out.set(date, rec);
    }
    rec[ch] = (rec[ch] ?? 0) + v;
  };
  for (const a of acts) {
    if (a.sport !== "Run" || !a.tss || a.tss <= 0) continue;
    const ov = typeOverrideChannel(a.type, channels);
    if (ov) { add(a.date, ov, a.tss as number); continue; } // Typ-Override: ganze Einheit in den Kanal
    const zm = parseZoneMin(a.pace_zone_min);
    const total = zm ? Object.values(zm).reduce((s, m) => s + (m || 0), 0) : 0;
    if (zm && total > 0) {
      for (const [z, m] of Object.entries(zm)) {
        const ch = zmap[Number(z)];
        if (!ch || !m) continue;
        add(a.date, ch, a.tss * (m / total));
      }
    } else {
      const z = a.type ? TYPE_TO_ZONE[a.type] : undefined;
      if (z) add(a.date, zmap[z], a.tss);
    }
  }
  return out;
}

export interface ChannelCtlRow {
  date: string;
  ctl: Record<string, number>;
  total: number;
}
/** Wöchentliche kanal-spezifische CTL (EWMA-42 je Kanal, τ fix = Frage 10) auf Wochenraster — die L3-Regressoren. */
export function weeklyChannelCtl(acts: ActivityLite[], channels: ChannelCount, stepDays = 7): ChannelCtlRow[] {
  const chs = CHANNEL_SETS[channels];
  const daily = dailyChannelLoads(acts, channels);
  const dates = [...daily.keys()].sort();
  if (!dates.length) return [];
  const t0 = Date.parse(dates[0]);
  const tN = Date.parse(dates[dates.length - 1]);
  const ctl: Record<string, number> = Object.fromEntries(chs.map((c) => [c, 0]));
  const rows: ChannelCtlRow[] = [];
  const stepMs = stepDays * 86_400_000;
  let nextSample = t0 + stepMs;
  for (let t = t0; t <= tN; t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const load = daily.get(d) ?? {};
    for (const c of chs) ctl[c] = ctl[c] + ((load[c] ?? 0) - ctl[c]) / 42;
    if (t >= nextSample || t === tN) {
      rows.push({ date: d, ctl: { ...ctl }, total: chs.reduce((s, c) => s + ctl[c], 0) });
      nextSample = t + stepMs;
    }
  }
  return rows;
}
