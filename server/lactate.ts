// Laktat-/Feldtest-Diagnostik (G3, v1.3.0) — PURE Modul, keine DB-Abhängigkeit.
// Berechnet aus einem Stufentest die aeroben/anaeroben Schwellen:
//   LT1 (aerobe Schwelle): erste signifikante Laktat-Erhöhung über Baseline (Baseline + Δ, Δ≈0.4 mmol/L).
//   LT2 (anaerobe/Laktat-Schwelle): modifizierter Dmax (AIS) — Kurvenfit + max. senkrechte Distanz zur
//        Sekante vom ersten "echten Anstieg" (Δ>0.4) bis zur höchsten Stufe (robuster als klassischer Dmax).
// Ausgabe je Schwelle in Geschwindigkeit (km/h), Pace (s/km) und HF; plus Konfidenz + Warnungen.
// Quellen: AIS modified-Dmax (Bishop 1998); LT1 fixed-rise (Runner's Guide to LT1). Vgl. Plan G3/A4.

export interface LactatePoint {
  stage?: number | null;
  speed_kmh?: number | null; // Laufgeschwindigkeit; alternativ pace_s
  pace_s?: number | null;    // s/km (wird in km/h umgerechnet, wenn speed_kmh fehlt)
  power_w?: number | null;   // Stryd (optional, v1.4.0 — hier nur durchgereicht)
  hr?: number | null;        // bpm
  lactate: number;           // mmol/L (Pflicht)
  rpe?: number | null;
}

export interface ThresholdPoint {
  speed_kmh: number;
  pace_s: number;       // s/km
  hr: number | null;
  lactate: number;      // Laktatwert an der Schwelle (mmol/L)
}

export interface LactateThresholds {
  lt1: ThresholdPoint | null;
  lt2: ThresholdPoint | null;
  baseline: number;                       // angesetzte Ruhe-/Basis-Laktat (mmol/L)
  method: "modified-dmax" | "dmax";       // welche Sekante für LT2 genutzt wurde
  confidence: "hoch" | "mittel" | "niedrig";
  warnings: string[];
}

/** s/km ↔ km/h. */
const speedToPace = (kmh: number): number => 3600 / kmh; // s/km
const paceToSpeed = (paceS: number): number => 3600 / paceS; // km/h

/** Punkt auf km/h normalisieren (speed_kmh bevorzugt, sonst aus pace_s). null wenn beides fehlt. */
function pointSpeed(p: LactatePoint): number | null {
  if (p.speed_kmh != null && p.speed_kmh > 0) return p.speed_kmh;
  if (p.pace_s != null && p.pace_s > 0) return paceToSpeed(p.pace_s);
  return null;
}

/** Lineare Interpolation y bei x zwischen (x0,y0)-(x1,y1). */
function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/** HF bei Geschwindigkeit `sp` aus den (speed,hr)-Stützstellen linear interpolieren (null wenn keine HF da). */
function hrAtSpeed(xs: number[], hrs: (number | null)[], sp: number): number | null {
  const pts = xs.map((x, i) => [x, hrs[i]] as const).filter((q) => q[1] != null) as [number, number][];
  if (!pts.length) return null;
  if (sp <= pts[0][0]) return Math.round(pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    if (sp <= pts[i][0]) return Math.round(lerp(sp, pts[i - 1][0], pts[i][0], pts[i - 1][1], pts[i][1]));
  }
  return Math.round(pts[pts.length - 1][1]);
}

// ---- Polynom-Least-Squares (Grad d) via Normalengleichungen + Gauss-Elimination ----
function solveLinear(A: number[][], b: number[]): number[] {
  const m = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < m; col++) {
    let piv = col;
    for (let r = col + 1; r < m; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) continue; // singulär → überspringen (Fallback greift außen)
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < m; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= m; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => (Math.abs(M[i][i]) < 1e-12 ? 0 : row[m] / M[i][i]));
}

/** Least-Squares-Polynomfit; t sollte normalisiert [0,1] sein (Konditionierung). Liefert Koeffizienten c0..cd. */
function polyfit(t: number[], y: number[], deg: number): number[] {
  const n = t.length;
  const m = deg + 1;
  const A = Array.from({ length: m }, () => new Array(m).fill(0));
  const b = new Array(m).fill(0);
  for (let i = 0; i < n; i++) {
    const pw: number[] = new Array(m);
    pw[0] = 1;
    for (let j = 1; j < m; j++) pw[j] = pw[j - 1] * t[i];
    for (let j = 0; j < m; j++) {
      b[j] += pw[j] * y[i];
      for (let k = 0; k < m; k++) A[j][k] += pw[j] * pw[k];
    }
  }
  return solveLinear(A, b);
}

/** Horner: c0 + c1·t + c2·t² + … */
const polyval = (c: number[], t: number): number => c.reduceRight((s, cj) => s * t + cj, 0);

/**
 * Schwellen aus einem Stufentest. `deltaLt1` = fixe Laktat-Erhöhung für LT1 (Default 0.4 mmol/L, 0.3–0.5 üblich).
 * Erwartet ≥3 Stufen mit Laktat; ideal ≥5 mit ansteigendem Laktat und HF je Stufe.
 */
export function lactateThresholds(pointsIn: LactatePoint[], opts?: { deltaLt1?: number }): LactateThresholds {
  const delta = opts?.deltaLt1 ?? 0.4;
  const warnings: string[] = [];

  // Gültige Punkte (Laktat + Geschwindigkeit vorhanden), nach Geschwindigkeit aufsteigend sortiert.
  const pts = pointsIn
    .map((p) => ({ sp: pointSpeed(p), lac: p.lactate, hr: p.hr ?? null }))
    .filter((p): p is { sp: number; lac: number; hr: number | null } => p.sp != null && Number.isFinite(p.lac))
    .sort((a, b) => a.sp - b.sp);

  if (pts.length < 3) {
    return { lt1: null, lt2: null, baseline: pts[0]?.lac ?? 0, method: "dmax", confidence: "niedrig", warnings: ["Zu wenige gültige Stufen (<3) — keine Schwellenberechnung."] };
  }

  const xs = pts.map((p) => p.sp);
  const ys = pts.map((p) => p.lac);
  const hrs = pts.map((p) => p.hr);
  const n = pts.length;
  if (hrs.every((h) => h == null)) warnings.push("Keine HF je Stufe — Schwellen-HF nicht ableitbar.");
  if (ys[n - 1] - Math.min(...ys) < 2) warnings.push("Geringer Laktat-Anstieg (<2 mmol/L) — evtl. kein Ausbelastungstest.");

  // ---- LT1: Baseline + Δ, erste Überschreitung interpoliert ----
  const baseline = Math.min(ys[0], ys[1]);
  const lt1Target = baseline + delta;
  let lt1: ThresholdPoint | null = null;
  if (ys[0] >= lt1Target) {
    lt1 = mkPoint(xs[0], hrs[0] != null ? Math.round(hrs[0]!) : hrAtSpeed(xs, hrs, xs[0]), ys[0]);
    warnings.push("LT1 bereits an der ersten Stufe — Startintensität evtl. zu hoch.");
  } else {
    for (let i = 1; i < n; i++) {
      if (ys[i] >= lt1Target) {
        const sp = lerp(lt1Target, ys[i - 1], ys[i], xs[i - 1], xs[i]); // x bei y=lt1Target
        lt1 = mkPoint(sp, hrAtSpeed(xs, hrs, sp), lt1Target);
        break;
      }
    }
    if (!lt1) warnings.push("LT1 nicht erreicht (Laktat steigt nie um Δ über Baseline).");
  }

  // ---- LT2: modifizierter Dmax ----
  // Sekanten-Start P1 = erste Stufe mit Anstieg >0.4 ggü. Vorstufe; sonst klassischer Dmax (erste Stufe).
  let startIdx = -1;
  for (let i = 1; i < n; i++) if (ys[i] - ys[i - 1] > 0.4) { startIdx = i; break; }
  const method: LactateThresholds["method"] = startIdx >= 0 ? "modified-dmax" : "dmax";
  if (startIdx < 0) { startIdx = 0; warnings.push("Kein klarer Laktat-Sprung (>0.4) — klassischer Dmax statt modifiziert."); }

  // Kurvenfit (normalisiertes t), Grad min(3, n-1).
  const xmin = xs[0], xmax = xs[n - 1];
  const span = xmax - xmin || 1;
  const t = xs.map((x) => (x - xmin) / span);
  const deg = Math.min(3, n - 1);
  const coef = polyfit(t, ys, deg);
  const yhat = (x: number): number => polyval(coef, (x - xmin) / span);

  // Sekante P1→P2 (P2 = höchste Stufe); max. senkrechte Distanz der Kurve über [x1,x2].
  const x1 = xs[startIdx], y1 = ys[startIdx], x2 = xs[n - 1], y2 = ys[n - 1];
  const dx = x2 - x1, dy = y2 - y1;
  const denom = Math.hypot(dx, dy) || 1;
  let bestX = x1, bestDist = -1;
  const SAMPLES = 240;
  for (let s = 0; s <= SAMPLES; s++) {
    const x = x1 + ((x2 - x1) * s) / SAMPLES;
    const dist = Math.abs(dy * (x - x1) - dx * (yhat(x) - y1)) / denom; // |Kreuzprodukt|/|Sekante|
    if (dist > bestDist) { bestDist = dist; bestX = x; }
  }
  let lt2: ThresholdPoint | null = mkPoint(bestX, hrAtSpeed(xs, hrs, bestX), yhat(bestX));

  // Plausibilität: LT2 muss schneller als LT1 sein.
  if (lt1 && lt2 && lt2.speed_kmh <= lt1.speed_kmh) {
    warnings.push("LT2 ≤ LT1 berechnet — Testdaten prüfen; LT2 auf höchste Stufe gesetzt.");
    lt2 = mkPoint(x2, hrAtSpeed(xs, hrs, x2), y2);
  }

  // Konfidenz
  let confidence: LactateThresholds["confidence"] = "hoch";
  if (n < 4 || method === "dmax" || warnings.some((w) => w.startsWith("LT1 nicht") || w.startsWith("LT2 ≤"))) confidence = "niedrig";
  else if (n < 5 || hrs.some((h) => h == null) || warnings.length > 0) confidence = "mittel";

  return { lt1, lt2, baseline: r2(baseline), method, confidence, warnings };
}

function mkPoint(speed: number, hr: number | null, lac: number): ThresholdPoint {
  return { speed_kmh: r2(speed), pace_s: Math.round(speedToPace(speed)), hr: hr != null ? Math.round(hr) : null, lactate: r2(lac) };
}

const r2 = (x: number): number => Math.round(x * 100) / 100;

// ---- Zonen-Vorschlag aus LT1/LT2 (Sport-Wissenschaft; UI/DB-Persistenz = Plumbing-Schritt) ----

/**
 * 6 HF-Zonen-Obergrenzen (bpm) aus LT1/LT2-HF. Anker: Z2-Top = LT1 (aerobe Schwelle), Z4-Top = LT2 (≈ LTHR).
 * Restliche Grenzen proportional. Transparent & als VORSCHLAG gedacht (Nutzer bestätigt/justiert).
 */
export function proposedHrBounds(lt1Hr: number, lt2Hr: number, maxHr?: number | null): number[] {
  const gap = Math.max(1, lt2Hr - lt1Hr);
  const z5 = Math.round(lt2Hr + gap * 0.5);
  const z6 = maxHr && maxHr > z5 ? maxHr : Math.max(Math.round(lt2Hr * 1.06), z5 + 2); // Z6 stets > Z5
  return [
    Math.round(lt1Hr * 0.92),        // Z1
    Math.round(lt1Hr),               // Z2  = LT1
    Math.round(lt1Hr + gap * 0.6),   // Z3
    Math.round(lt2Hr),               // Z4  = LT2 (≈ LTHR)
    z5,                              // Z5
    z6,                              // Z6
  ];
}

/**
 * 6 Pace-Zonen-Obergrenzen (s/km, absteigend) aus LT1/LT2-Pace. Spiegelt die HF-Proportionen im
 * Geschwindigkeitsraum (km/h) und konvertiert nach s/km.
 */
export function proposedPaceBounds(lt1Pace: number, lt2Pace: number): number[] {
  const v1 = paceToSpeed(lt1Pace), v2 = paceToSpeed(lt2Pace); // km/h (v2 > v1)
  const gap = Math.max(0.1, v2 - v1);
  const vBounds = [v1 * 0.92, v1, v1 + gap * 0.6, v2, v2 + gap * 0.5, v2 * 1.12];
  return vBounds.map((v) => Math.round(speedToPace(v))); // s/km, absteigend (schneller → kleiner)
}
