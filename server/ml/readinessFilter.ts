// P4 Online-Readiness (pure, deterministisch): fusioniert die täglichen Wellness-Messungen (HRV, RHR, Schlaf,
// Recovery) zu EINER geglätteten latenten Readiness-Trajektorie (0–100) mit Unsicherheitsband — lokaler
// Kalman-Filter + RTS-Smoother. Jede Messung wird gegen eine ROLLENDE Baseline (Median/MAD der letzten ~60
// Tage) z-standardisiert → adaptiv über Jahre (HRV/RHR driften mit der Fitness). Glättung statt Tagesrauschen
// (Frage 19); solange zu wenig Daten da sind, ehrlich `insufficient`.

export interface DailyWellness {
  date: string;
  hrv?: number | null;
  rhr?: number | null;
  sleep_h?: number | null;
  recovery?: number | null;
}
export interface ReadinessPoint {
  date: string;
  value: number; // 0–100
  sd: number;
  observed: boolean;
}
export interface ReadinessResult {
  points: ReadinessPoint[];
  nDays: number; // Tage mit ≥1 Messung
  insufficient: boolean; // < MIN_DAYS verwertbare Tage
  drivers: string[]; // welche Marker beitragen
}

// Orientierung (higher=better) + Gewicht je Marker. RHR wird invertiert (niedriger = besser).
const METRICS: { key: keyof DailyWellness; invert: boolean; weight: number }[] = [
  { key: "hrv", invert: false, weight: 1.0 },
  { key: "recovery", invert: false, weight: 1.0 },
  { key: "rhr", invert: true, weight: 0.8 },
  { key: "sleep_h", invert: false, weight: 0.5 },
];
const BASELINE_WINDOW = 60; // Tage rollende Baseline
const MIN_BASELINE = 8; // Mindest-Messpunkte im Fenster für ein z
const MIN_DAYS = 10; // darunter: insufficient

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mad(a: number[], med: number): number {
  if (a.length < 2) return 0;
  const d = a.map((x) => Math.abs(x - med));
  return median(d) * 1.4826 || 0;
}

export function computeReadiness(daily: DailyWellness[]): ReadinessResult {
  const rows = [...daily].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!rows.length) return { points: [], nDays: 0, insufficient: true, drivers: [] };

  // pro Marker: Werte + Datums-Index für rollende Baseline (Median/MAD über die letzten BASELINE_WINDOW Tage)
  const driversSet = new Set<string>();
  const obs: { idx: number; z: number; r: number; observed: boolean }[] = [];
  for (let i = 0; i < rows.length; i++) {
    let zSum = 0, wSum = 0, present = 0;
    const ti = Date.parse(rows[i].date);
    for (const m of METRICS) {
      const xi = rows[i][m.key] as number | null | undefined;
      if (xi == null) continue;
      // Baseline aus vorhandenen Werten dieses Markers in [date-WINDOW, date]
      const hist: number[] = [];
      for (let j = 0; j <= i; j++) {
        const v = rows[j][m.key] as number | null | undefined;
        if (v == null) continue;
        if ((ti - Date.parse(rows[j].date)) / 86_400_000 <= BASELINE_WINDOW) hist.push(v);
      }
      if (hist.length < MIN_BASELINE) continue;
      const med = median(hist);
      const sd = mad(hist, med);
      if (sd < 1e-6) continue;
      let z = (xi - med) / sd;
      if (m.invert) z = -z;
      z = Math.max(-3, Math.min(3, z));
      zSum += m.weight * z;
      wSum += m.weight;
      present++;
      driversSet.add(m.key as string);
    }
    if (wSum > 0) obs.push({ idx: i, z: zSum / wSum, r: 0.6 / wSum, observed: true });
  }

  const nDays = obs.length;
  if (nDays < MIN_DAYS) {
    return { points: [], nDays, insufficient: true, drivers: [...driversSet] };
  }

  // --- Kalman local-level über das TAGES-Raster (erste..letzte Beobachtung) + RTS-Smoother ---
  const t0 = Date.parse(rows[obs[0].idx].date);
  const tN = Date.parse(rows[obs[obs.length - 1].idx].date);
  const nSteps = Math.round((tN - t0) / 86_400_000) + 1;
  const obsByStep = new Map<number, { z: number; r: number }>();
  for (const o of obs) obsByStep.set(Math.round((Date.parse(rows[o.idx].date) - t0) / 86_400_000), { z: o.z, r: o.r });

  const sigmaLevel = 0.15;
  const xPred: number[] = [], PPred: number[] = [], xFilt: number[] = [], PFilt: number[] = [];
  let x = 0, P = 2;
  for (let k = 0; k < nSteps; k++) {
    const xp = x, Pp = P + sigmaLevel * sigmaLevel;
    xPred.push(xp); PPred.push(Pp);
    const o = obsByStep.get(k);
    if (o) {
      const K = Pp / (Pp + o.r);
      x = xp + K * (o.z - xp);
      P = (1 - K) * Pp;
    } else { x = xp; P = Pp; }
    xFilt.push(x); PFilt.push(P);
  }
  const xS = [...xFilt], PS = [...PFilt];
  for (let k = nSteps - 2; k >= 0; k--) {
    const C = PFilt[k] / PPred[k + 1];
    xS[k] = xFilt[k] + C * (xS[k + 1] - xPred[k + 1]);
    PS[k] = PFilt[k] + C * C * (PS[k + 1] - PPred[k + 1]);
  }

  const points: ReadinessPoint[] = [];
  for (let k = 0; k < nSteps; k++) {
    const d = new Date(t0 + k * 86_400_000).toISOString().slice(0, 10);
    points.push({
      date: d,
      value: Math.max(1, Math.min(99, 50 + 14 * xS[k])),
      sd: 14 * Math.sqrt(Math.max(0, PS[k])),
      observed: obsByStep.has(k),
    });
  }
  return { points, nDays, insufficient: false, drivers: [...driversSet] };
}
