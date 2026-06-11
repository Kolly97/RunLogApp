// TrainingPeaks-Last-Modell: TSS (rTSS/hrTSS/sRPE), Zeit-in-Zone, COROS-Parse, CTL/ATL/TSB.

export interface HrZone {
  z: number;
  min: number;
  max: number;
  label: string;
  color: string;
}

// Default-Pace je Zone (s/km) zur Umrechnung km<->min, falls keine Pace-Zonen gesetzt.
// Konvention pace_zones: Index z-1 = Obergrenze (schnellste Pace, s/km) der Zone z, absteigend.
export const DEFAULT_ZONE_PACE = [330, 285, 255, 230, 210, 195];

// Default-Speed je Zone (km/h, Obergrenze je Zone, aufsteigend) fürs Rad, falls keine speed_zones gesetzt.
export const DEFAULT_ZONE_SPEED = [22, 27, 31, 35, 39, 99];

/** Lauf-Zone aus Pace (s/km). paceZones = Obergrenzen je Zone (s/km, absteigend wie DEFAULT_ZONE_PACE). */
export function zoneFromPace(paceSecPerKm: number, paceZones?: number[]): number {
  if (!paceSecPerKm || paceSecPerKm <= 0) return 0;
  const bounds = paceZones?.length ? paceZones : DEFAULT_ZONE_PACE;
  for (let z = bounds.length; z >= 1; z--) if (paceSecPerKm <= bounds[z - 1]) return z;
  return 1;
}

/** Rad-Zone aus Geschwindigkeit (km/h). speedZones = Obergrenzen je Zone (km/h, aufsteigend). */
export function zoneFromSpeed(kmh: number, speedZones?: number[]): number {
  if (!kmh || kmh <= 0) return 0;
  const bounds = speedZones?.length ? speedZones : DEFAULT_ZONE_SPEED;
  for (let z = 1; z <= bounds.length; z++) if (kmh <= bounds[z - 1]) return z;
  return bounds.length;
}

// Intensitätsfaktor nach Einheitstyp fürs Rad. Die Lauf-HF-Zonen-Schätzung überschätzt
// Rad-Last massiv (HF/Last auf dem Rad deutlich niedriger) — daher IF-basiert.
const BIKE_IF: Record<string, number> = {
  Easy: 0.62,
  Long: 0.65,
  Threshold: 0.85,
  Hill: 0.85,
  VO2: 0.95,
  Race: 0.95,
};

/**
 * Geschätzter Rad-TSS ohne Powermeter: TSS = Stunden * IF^2 * 100 (IF nach Typ).
 * 90 min easy ergeben so ~58 TSS statt 150+ über die Lauf-HF-Schätzung.
 * ftp wird nur gebraucht, wenn künftig ein Power-Ziel hinterlegt ist (powerTss bevorzugen).
 */
export function bikeTssEstimate(min: number, type: string, ftp?: number): number {
  if (!min || min <= 0) return 0;
  void ftp; // bewusst ungenutzt: bei vorhandener avg_power stattdessen powerTss(min*60, power, ftp)
  const ifr = BIKE_IF[type] ?? 0.6;
  return round1((min / 60) * ifr * ifr * 100);
}

/** COROS Training Load aus Strava-Beschreibung parsen ("241 Training Load"). */
export function parseCorosLoad(description?: string | null): number | null {
  if (!description) return null;
  const m = description.match(/(\d+(?:[.,]\d+)?)\s*Training\s*Load/i);
  if (!m) return null;
  return parseFloat(m[1].replace(",", "."));
}

/** Zeit-in-Zone (Sekunden je Zone) aus HR- und Zeit-Stream. */
export function timeInZone(
  hr: number[],
  time: number[],
  zones: HrZone[],
): Record<number, number> {
  const out: Record<number, number> = {};
  zones.forEach((zn) => (out[zn.z] = 0));
  for (let i = 1; i < hr.length; i++) {
    const dt = (time[i] ?? i) - (time[i - 1] ?? i - 1);
    if (dt <= 0 || dt > 30) continue; // Lücken/Pausen überspringen
    const bpm = hr[i];
    const zn = zones.find((z) => bpm >= z.min && bpm <= z.max) ?? zones[0];
    out[zn.z] += dt;
  }
  return out;
}

/** hrTSS aus Zeit-in-Zone: pro Zone Intensität (HF_mid / LTHR)^2 * Stunden * 100. */
export function hrTssFromZones(
  secondsPerZone: Record<number, number>,
  zones: HrZone[],
  lthr: number,
): number {
  let tss = 0;
  for (const z of zones) {
    const sec = secondsPerZone[z.z] || 0;
    if (sec <= 0) continue;
    const mid = z.max >= 900 ? z.min + 8 : (z.min + z.max) / 2;
    const ifr = mid / (lthr || 172);
    tss += (sec / 3600) * ifr * ifr * 100;
  }
  return round1(tss);
}

/** rTSS aus Dauer und Pace: IF = Schwellen-Pace / Ø-Pace (als Speed). */
export function rTss(movingSec: number, avgPaceSecPerKm: number, thresholdPaceSecPerKm: number): number {
  if (!movingSec || !avgPaceSecPerKm) return 0;
  const ifr = thresholdPaceSecPerKm / avgPaceSecPerKm; // schneller = höheres IF
  return round1((movingSec / 3600) * ifr * ifr * 100);
}

/** Power-TSS fürs Rad: IF = NP/FTP. */
export function powerTss(movingSec: number, avgPower: number, ftp: number): number {
  if (!movingSec || !avgPower || !ftp) return 0;
  const ifr = avgPower / ftp;
  return round1((movingSec / 3600) * ifr * ifr * 100);
}

/** sRPE-Load (Foster): RPE × Minuten. Geräteunabhängiger Fallback. */
export function srpeLoad(rpe: number, minutes: number): number {
  if (!rpe || !minutes) return 0;
  return round1(rpe * minutes);
}

/** Geplanten TSS aus einer Zonen-Allokation (km bzw. min je Zone) schätzen. */
export function plannedTss(
  zoneAlloc: { byKm?: Record<number, number>; byMin?: Record<number, number> } | null,
  zones: HrZone[],
  lthr: number,
  paceZones?: number[],
): number {
  if (!zoneAlloc) return 0;
  const secondsPerZone: Record<number, number> = {};
  for (const z of zones) {
    let min = zoneAlloc.byMin?.[z.z];
    if (min == null && zoneAlloc.byKm?.[z.z] != null) {
      const pace = paceZones?.[z.z - 1] || DEFAULT_ZONE_PACE[z.z - 1];
      min = (zoneAlloc.byKm[z.z] * pace) / 60;
    }
    secondsPerZone[z.z] = (min || 0) * 60;
  }
  return hrTssFromZones(secondsPerZone, zones, lthr);
}

export interface PmcPoint {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
  planned?: boolean;
}

/**
 * Performance Management Chart: CTL (42d), ATL (7d), TSB = CTL-ATL.
 * dailyTss: Map "YYYY-MM-DD" -> TSS (real + geplant). Lücken = 0.
 */
export function computePmc(
  dailyTss: Map<string, number>,
  startDate: string,
  endDate: string,
  todayIso: string,
  seed = { ctl: 0, atl: 0 },
): PmcPoint[] {
  const out: PmcPoint[] = [];
  let ctl = seed.ctl;
  let atl = seed.atl;
  for (const date of eachDay(startDate, endDate)) {
    const tss = dailyTss.get(date) ?? 0;
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    out.push({
      date,
      tss: round1(tss),
      ctl: round1(ctl),
      atl: round1(atl),
      tsb: round1(ctl - atl),
      planned: date > todayIso,
    });
  }
  return out;
}

/** CTL-Ramp-Rate (Δ CTL über die letzten n Tage, normiert auf /Woche). */
export function ctlRamp(pmc: PmcPoint[], days = 7): number {
  if (pmc.length < 2) return 0;
  const last = pmc[pmc.length - 1];
  const ref = pmc[Math.max(0, pmc.length - 1 - days)];
  return round1(((last.ctl - ref.ctl) / days) * 7);
}

// ---- helpers -----------------------------------------------------------

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function* eachDay(start: string, end: string): Generator<string> {
  const d = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  while (d <= last) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

export function paceToSecPerKm(distanceM: number, movingS: number): number {
  if (!distanceM || !movingS) return 0;
  return movingS / (distanceM / 1000);
}
