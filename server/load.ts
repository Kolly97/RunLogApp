// TrainingPeaks-Last-Modell: TSS (rTSS/hrTSS/sRPE), Zeit-in-Zone, CTL/ATL/TSB.

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
  Easy: 0.6,
  Long: 0.6,
  Threshold: 0.83,
  Hill: 0.78,
  VO2: 0.88,
  Race: 0.92,
  Strength: 0,
  Physio: 0,
  Rest: 0,
};

/**
 * Geschätzter Rad-TSS ohne Powermeter: TSS = Stunden * IF^2 * 100 (IF nach Typ).
 * 60 min easy ergeben so 36 TSS statt 100+ über die Lauf-HF-Schätzung.
 * ftp wird nur gebraucht, wenn künftig ein Power-Ziel hinterlegt ist (powerTss bevorzugen).
 */
export function bikeTssEstimate(min: number, type: string, ftp?: number): number {
  if (!min || min <= 0) return 0;
  void ftp; // bewusst ungenutzt: bei vorhandener avg_power stattdessen powerTss(min*60, power, ftp)
  const ifr = BIKE_IF[type] ?? 0.6;
  if (ifr <= 0) return 0;
  return round1((min / 60) * ifr * ifr * 100);
}

/**
 * Watt-Mittel einer Power-Zone. powerZones = Watt-Obergrenzen je Zone 1–6 (aufsteigend).
 * Zone z: Mitte zwischen Obergrenze der Vorzone und eigener Obergrenze (Z1 ab 0 W).
 * Offene Top-Zone (Obergrenze unrealistisch hoch): knapp über der Untergrenze ansetzen.
 */
export function powerZoneMidWatts(z: number, powerZones: number[]): number | null {
  if (!powerZones?.length || z < 1 || z > powerZones.length) return null;
  const lower = z > 1 ? powerZones[z - 2] : 0;
  const upper = powerZones[z - 1];
  if (!upper || upper <= 0) return null;
  if (z === powerZones.length && upper > lower * 1.5 && lower > 0) return round1(lower * 1.1);
  return round1((lower + upper) / 2);
}

/** Per-km-Splits aus Distanz-/Zeit-/HF-Streams (v0.14.0, Race aus Tracking).
 *  km=1 je vollem Kilometer (Pace = Zeit/km); letzter Teil-km als Bruchteil. Ø/Max-HF je Segment. */
export function computeKmSplits(
  dist: number[],
  time: number[],
  hr: number[] = [],
): { km: number; time_s: number; pace_s: number; avg_hr: number | null; max_hr: number | null; elevation_m: number | null }[] {
  const out: { km: number; time_s: number; pace_s: number; avg_hr: number | null; max_hr: number | null; elevation_m: number | null }[] = [];
  const n = Math.min(dist.length, time.length);
  if (n < 2) return out;
  let kmIdx = 0; // abgeschlossene Kilometer
  let segStart = time[0];
  let hrSum = 0, hrCount = 0, hrMax = 0;
  const pushSeg = (km: number, endTime: number) => {
    const time_s = Math.max(0, Math.round(endTime - segStart));
    const avg = hrCount ? Math.round(hrSum / hrCount) : null;
    out.push({ km, time_s, pace_s: km > 0 ? Math.round(time_s / km) : time_s, avg_hr: avg, max_hr: hrMax || null, elevation_m: null });
    segStart = endTime; hrSum = 0; hrCount = 0; hrMax = 0;
  };
  for (let i = 0; i < n; i++) {
    const bucket = Math.floor(dist[i] / 1000);
    while (bucket > kmIdx) { kmIdx++; pushSeg(1, time[i]); }
    const h = hr[i];
    if (h != null && h > 0) { hrSum += h; hrCount++; if (h > hrMax) hrMax = h; }
  }
  const partial = (dist[n - 1] - kmIdx * 1000) / 1000;
  if (partial > 0.05) pushSeg(Math.round(partial * 100) / 100, time[n - 1]);
  return out;
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

/** rTSS per Zone (für geplante Läufe): Σ (sec_z/3600)·IF_z²·100, IF_z = Schwellen-Pace / Zonen-Pace. */
export function rTssFromZones(secondsPerZone: Record<number, number>, paceZones: number[] | undefined, thresholdPace: number): number {
  let tss = 0;
  for (const [z, secRaw] of Object.entries(secondsPerZone)) {
    const sec = secRaw || 0;
    if (sec <= 0) continue;
    const zi = Number(z);
    const zonePace = paceZones?.[zi - 1] || DEFAULT_ZONE_PACE[zi - 1] || thresholdPace;
    const ifr = thresholdPace / zonePace; // schneller (kleinere Pace) → höheres IF
    tss += (sec / 3600) * ifr * ifr * 100;
  }
  return round1(tss);
}

/** Lauf-TSS einer Aktivität: rTSS aus NGP (falls vorhanden), sonst aus Ø-Pace (Distanz/Zeit). */
export function runTss(distanceM: number, movingS: number, thresholdPace: number, ngp?: number | null): number {
  if (!movingS || movingS <= 0) return 0;
  const pace = ngp && ngp > 0 ? ngp : distanceM > 0 ? movingS / (distanceM / 1000) : 0;
  if (!pace) return 0;
  return rTss(movingS, pace, thresholdPace);
}

/**
 * Grade-Adjustment-Faktor (Stravas GAP zugrunde liegend): relative Lauf-Energiekosten nach Minetti
 * C(g)/C(0), g = Steigung als Dezimal (geclamped ±0.45). >1 bergauf, <1 leicht bergab.
 */
export function gradeFactor(g: number): number {
  const x = Math.max(-0.45, Math.min(0.45, g));
  const c = 155.4 * x ** 5 - 30.4 * x ** 4 - 43.3 * x ** 3 + 46.3 * x ** 2 + 19.5 * x + 3.6;
  return c / 3.6;
}

/**
 * NGP (Normalized Graded Pace) aus Strava-Streams: pro Sample grade-adjusted Speed (Minetti),
 * 30s zeitgewichtetes gleitendes Mittel, dann NGP = (Ø(roll⁴))^¼. Rückgabe als Pace (s/km).
 * velocity in m/s, grade in % (Strava grade_smooth), time kumulativ in s.
 */
export function computeNgp(velocity: number[], grade: number[], time: number[]): number {
  const n = Math.min(velocity.length, grade.length, time.length);
  if (n < 2) return 0;
  const gas = new Array<number>(n); // grade-adjusted speed (m/s)
  for (let i = 0; i < n; i++) {
    const v = velocity[i] ?? 0;
    gas[i] = v > 0 ? v * gradeFactor((grade[i] ?? 0) / 100) : 0;
  }
  // 30s gleitendes Mittel (zeitbasiert, O(n) über einen lo-Zeiger)
  const roll = new Array<number>(n);
  let lo = 0, sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    sum += gas[i]; cnt++;
    while (lo < i && (time[i] ?? i) - (time[lo] ?? lo) > 30) { sum -= gas[lo]; cnt--; lo++; }
    roll[i] = cnt > 0 ? sum / cnt : 0;
  }
  let p4 = 0, m = 0;
  for (let i = 0; i < n; i++) if (gas[i] > 0.3) { p4 += roll[i] ** 4; m++; } // >0.3 m/s ≈ in Bewegung
  if (m === 0) return 0;
  const ngpSpeed = Math.pow(p4 / m, 0.25);
  return ngpSpeed > 0 ? round1(1000 / ngpSpeed) : 0; // s/km
}

/**
 * Normalized Power (W) aus dem Watt-Stream: 30s gleitendes Mittel der Leistung, dann (Ø(roll⁴))^¼.
 * Nullen (Ausrollen) zählen mit — wie bei TrainingPeaks/NP. time kumulativ in s.
 */
export function computeNp(watts: number[], time: number[]): number {
  const n = Math.min(watts.length, time.length);
  if (n < 2) return 0;
  const roll = new Array<number>(n);
  let lo = 0, sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    sum += watts[i] ?? 0; cnt++;
    while (lo < i && (time[i] ?? i) - (time[lo] ?? lo) > 30) { sum -= watts[lo] ?? 0; cnt--; lo++; }
    roll[i] = cnt > 0 ? sum / cnt : 0;
  }
  let p4 = 0;
  for (let i = 0; i < n; i++) p4 += roll[i] ** 4;
  return round1(Math.pow(p4 / n, 0.25));
}

/** Aus HF-/Zeit-/Distanz-Streams Sekunden UND Meter je HF-Zone (für zone_min/zone_km beim Import). */
export function streamZoneSplit(
  hr: number[], time: number[], distance: number[] | undefined, zones: HrZone[],
): { sec: Record<number, number>; meters: Record<number, number> } {
  const sec: Record<number, number> = {};
  const meters: Record<number, number> = {};
  zones.forEach((z) => { sec[z.z] = 0; meters[z.z] = 0; });
  for (let i = 1; i < hr.length; i++) {
    const dt = (time[i] ?? i) - (time[i - 1] ?? i - 1);
    if (dt <= 0 || dt > 30) continue;
    const bpm = hr[i];
    const zn = zones.find((z) => bpm >= z.min && bpm <= z.max) ?? zones[0];
    if (!zn) continue;
    sec[zn.z] += dt;
    if (distance && distance[i] != null && distance[i - 1] != null) {
      const dd = distance[i] - distance[i - 1];
      if (dd > 0) meters[zn.z] += dd;
    }
  }
  return { sec, meters };
}

/** Sekunden je PACE-Zone aus Velocity-/Zeit-Stream (v0.14.0, Plan-Erfüllung). vel in m/s, time kumulativ.
 *  Nutzt zoneFromPace() (gleiche Pace-Zonen wie Planung). Stehen/Ausrollen (v≤0.3 m/s) zählt nicht. */
export function paceZoneSplit(vel: number[], time: number[], paceZones?: number[]): Record<number, number> {
  const sec: Record<number, number> = {};
  const n = Math.min(vel.length, time.length);
  for (let i = 1; i < n; i++) {
    const dt = (time[i] ?? i) - (time[i - 1] ?? i - 1);
    if (dt <= 0 || dt > 30) continue;
    const v = vel[i];
    if (!v || v <= 0.3) continue;
    const z = zoneFromPace(1000 / v, paceZones);
    if (z >= 1) sec[z] = (sec[z] || 0) + dt;
  }
  return sec;
}

/**
 * Aerobe Entkopplung (Pa:HR, Friel — v1.2.0): %-Abweichung der Effizienz (Speed/HF) zweite vs. erste
 * Lauf-Hälfte. <5 % = solide aerobe Haltbarkeit, 5–10 % mittel, >10 % schwach. Positiv = Pace fällt
 * relativ zur HF (Ermüdung). Nur für längere (≥ 20 min) gleichmäßige Läufe sinnvoll; sonst null.
 */
export function aerobicDecoupling(velocity: number[], hr: number[], time: number[]): number | null {
  const n = Math.min(velocity.length, hr.length, time.length);
  if (n < 60) return null;
  const total = (time[n - 1] ?? 0) - (time[0] ?? 0);
  if (total < 1200) return null; // < 20 min → wenig aussagekräftig
  const mid = (time[0] ?? 0) + total / 2;
  let s1 = 0, c1 = 0, h1 = 0, hc1 = 0, s2 = 0, c2 = 0, h2 = 0, hc2 = 0;
  for (let i = 1; i < n; i++) {
    const dt = (time[i] ?? i) - (time[i - 1] ?? i - 1);
    if (dt <= 0 || dt > 30) continue; // Lücken/Pausen überspringen
    const v = velocity[i] ?? 0, b = hr[i] ?? 0;
    if (v <= 0.3 || b <= 0) continue; // in Bewegung + gültige HF
    if ((time[i] ?? 0) < mid) { s1 += v * dt; c1 += dt; h1 += b * dt; hc1 += dt; }
    else { s2 += v * dt; c2 += dt; h2 += b * dt; hc2 += dt; }
  }
  if (c1 < 60 || c2 < 60 || hc1 < 60 || hc2 < 60) return null;
  const ef1 = (s1 / c1) / (h1 / hc1); // Speed/HF erste Hälfte
  const ef2 = (s2 / c2) / (h2 / hc2);
  if (!(ef1 > 0)) return null;
  return Math.round(((ef1 - ef2) / ef1) * 1000) / 10; // % auf 0.1 genau
}

/** Ergebnis einer Pro-Lauf-VO2max-Schätzung (Runalyze-Stil). */
export interface EffVo2max { value: number; confidence: "hoch" | "mittel" | "niedrig"; }

/**
 * Effective VO2max je Lauf (Runalyze-/Daniels-nah): submax HF↔Pace → extrapolierte VO2max.
 * Aggregat-basiert (aus gespeicherten Feldern, damit über die volle Historie backfillbar und
 * Trend-konsistent — Roh-Streams werden nicht persistiert):
 *  - Pace = NGP (grade-adjustiert) bevorzugt, sonst Ø-Pace → v[m/min].
 *  - Daniels-Laufkosten: VO2 = −4.60 + 0.182258·v + 0.000104·v² (m/min) — für Läufer genauer als ACSM.
 *  - Brücke %VO2R ≈ %HRR (Swain) aus Ø-HF: %HRR = (avgHr − hrRest)/(hrMax − hrRest).
 *  - VO2max = 3.5 + (VO2 − 3.5)/%HRR.
 * Der absolute Pegel ist lauf-ökonomie-abhängig → die Labor-Kalibrierung (Trend-Endpoint) eicht ihn;
 * der Rohwert dient als monotoner, kalibrierbarer Proxy. Gate auf stetig-aerobe Läufe: %HRR im
 * submax-Band (0.55–0.88) + (falls vorhanden) aerobe Entkopplung < 10 % → Intervalle/Rennen raus.
 */
export function effectiveVo2max(args: {
  ngpSec?: number | null;      // grade-adjusted Pace s/km (bevorzugt)
  avgPaceSec?: number | null;  // Fallback-Ø-Pace s/km (Distanz/Zeit)
  avgHr?: number | null;
  decoupling?: number | null;  // aerobe Entkopplung % (Stetigkeits-Gate), optional
  hrRest: number;
  hrMax: number;
}): EffVo2max | null {
  const { hrRest, hrMax } = args;
  if (!(hrMax > hrRest + 20)) return null; // unplausible HF-Reserve
  const pace = args.ngpSec && args.ngpSec > 0 ? args.ngpSec : args.avgPaceSec && args.avgPaceSec > 0 ? args.avgPaceSec : null;
  if (!pace || !args.avgHr || args.avgHr <= 0) return null;
  if (args.decoupling != null && args.decoupling > 10) return null; // nicht stetig → unbrauchbar
  const pHRR = (args.avgHr - hrRest) / (hrMax - hrRest);
  if (pHRR < 0.55 || pHRR > 0.88) return null; // außerhalb submax-aerobem Band
  const vMin = (1000 / pace) * 60; // m/min
  const vo2 = -4.60 + 0.182258 * vMin + 0.000104 * vMin * vMin; // Daniels-Laufkosten (ml/kg/min)
  const vo2max = 3.5 + (vo2 - 3.5) / pHRR; // %VO2R≈%HRR invertiert
  if (!(vo2max > 20 && vo2max < 90)) return null; // Plausibilitätsfenster
  // Konfidenz: stetiger Lauf im mittleren Band → hoch; Randbereich/höhere Drift → niedrig.
  let confidence: EffVo2max["confidence"] = "mittel";
  const drift = args.decoupling;
  if ((drift == null || drift < 5) && pHRR >= 0.62 && pHRR <= 0.84) confidence = "hoch";
  else if ((drift != null && drift > 8) || pHRR < 0.58 || pHRR > 0.86) confidence = "niedrig";
  return { value: round1(vo2max), confidence };
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
 * Performance Management Chart (TrainingPeaks): CTL (42d), ATL (7d).
 *  CTL_heute = CTL_gestern + (TSS_heute − CTL_gestern)/42, ATL analog mit /7.
 *  Form/TSB = GESTRIGE Fitness − GESTRIGE Fatigue (TrainingPeaks-Konvention), also CTL/ATL VOR dem
 *  heutigen Update — die Frische, mit der man in den heutigen Tag geht.
 * dailyTss: Map "YYYY-MM-DD" -> TSS (real + geplant). Lücken = 0. Für korrekte Werte ab der vollen
 * Historie rechnen und danach auf den Anzeige-Zeitraum zuschneiden (Seeding).
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
    const ctlPrev = ctl, atlPrev = atl;
    ctl = ctlPrev + (tss - ctlPrev) / 42;
    atl = atlPrev + (tss - atlPrev) / 7;
    out.push({
      date,
      tss: round1(tss),
      ctl: round1(ctl),
      atl: round1(atl),
      tsb: round1(ctlPrev - atlPrev), // TrainingPeaks: gestrige Fitness − gestrige Fatigue
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

// ---- VO2max (VDOT) + Critical Speed (v0.15.0) --------------------------

/** Jack-Daniels-/Gilbert-VDOT (≈ VO2max ml/kg/min) aus Distanz (m) + Zeit (s). */
export function vdot(distanceM: number, timeS: number): number {
  if (!(distanceM > 0 && timeS > 0)) return 0;
  const tmin = timeS / 60;
  const v = distanceM / tmin; // m/min
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * tmin) + 0.2989558 * Math.exp(-0.1932605 * tmin);
  return pct > 0 ? vo2 / pct : 0;
}

export interface CsFit { cs_mps: number; cs_pace_s: number; dPrime_m: number; rSquared: number | null; n: number; }

/** 2-Parameter-CS-Modell d = CS·t + D′ per linearer Regression über (bereits gefilterte) Punkte. */
export function fitCriticalSpeed(pts: { time_s: number; distance_m: number }[]): CsFit | null {
  if (pts.length < 2) return null;
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p.time_s, 0);
  const sy = pts.reduce((s, p) => s + p.distance_m, 0);
  const sxx = pts.reduce((s, p) => s + p.time_s * p.time_s, 0);
  const sxy = pts.reduce((s, p) => s + p.time_s * p.distance_m, 0);
  const denom = n * sxx - sx * sx;
  const csMps = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  if (!(csMps > 0)) return null;
  const dPrime = (sy - csMps * sx) / n;
  const meanY = sy / n;
  const ssTot = pts.reduce((s, p) => s + (p.distance_m - meanY) ** 2, 0);
  const ssRes = pts.reduce((s, p) => s + (p.distance_m - (csMps * p.time_s + dPrime)) ** 2, 0);
  return {
    cs_mps: Math.round(csMps * 1000) / 1000,
    cs_pace_s: Math.round(1000 / csMps),
    dPrime_m: Math.round(dPrime),
    rSquared: ssTot > 0 ? Math.round((1 - ssRes / ssTot) * 1000) / 1000 : null,
    n,
  };
}

/** Renn-Prognosen t = (d − D′)/CS für die gegebenen Distanzen (m). */
export function predictFromCs(csMps: number, dPrimeM: number, distances: number[]): { distance_m: number; time_s: number }[] {
  const out: { distance_m: number; time_s: number }[] = [];
  for (const D of distances) {
    const t = (D - dPrimeM) / csMps;
    if (t > 0) out.push({ distance_m: D, time_s: Math.round(t) });
  }
  return out;
}

/**
 * Zeit (s) bei Distanz D (m) für eine Ziel-VDOT — invertiert die Daniels-Kurve per Bisektion.
 * vdot(D,·) ist im realistischen Pace-Bereich streng monoton fallend (schneller ⇒ höhere VDOT),
 * daher konvergiert die Bisektion gegen die leistungs-äquivalente Zeit. Im Gegensatz zum CS-Modell
 * berücksichtigt der dauerabhängige %VO2max-Term, dass längere Distanzen korrekt langsamer werden.
 */
export function timeForVdot(distanceM: number, targetVdot: number): number | null {
  if (!(distanceM > 0 && targetVdot > 0)) return null;
  let lo = (distanceM / 1000) * 120; // 2:00/km (schnelle Schranke → hohe VDOT)
  let hi = (distanceM / 1000) * 900; // 15:00/km (langsame Schranke → niedrige VDOT)
  if (vdot(distanceM, lo) < targetVdot) return null; // selbst schnellste Schranke zu langsam → unerreichbar
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vdot(distanceM, mid) > targetVdot) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/** Renn-Prognosen (VDOT-äquivalent, Daniels) für die gegebenen Distanzen (m). */
export function predictFromVdot(targetVdot: number, distances: number[]): { distance_m: number; time_s: number }[] {
  const out: { distance_m: number; time_s: number }[] = [];
  for (const D of distances) {
    const t = timeForVdot(D, targetVdot);
    if (t && t > 0) out.push({ distance_m: D, time_s: t });
  }
  return out;
}
