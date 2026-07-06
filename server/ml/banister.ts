// L4 Banister Fitness−Fatigue (pur, kein DB-Seiteneffekt, runner-testbar): fittet ein athleten-kalibriertes
// Zweikomponenten-Modell an die GEMESSENEN Leistungs-Indikatoren und leitet daraus das optimale Taper/Peaking ab.
//
//   perf(t) = p0 + k1·Fit(t) − k2·Fat(t) + ε
//   Fit(t) = Fit(t−1)·e^(−1/τ1) + w(t)   (langsame Fitness, τ1≈6 Wo)
//   Fat(t) = Fat(t−1)·e^(−1/τ2) + w(t)   (schnelle Fatigue,  τ2≈1.5 Wo)   w(t) = WÖCHENTLICHE TSS
//
// WOCHENRASTER (wie dose_ir): hält die Faltungsmatrix klein → schnell auch über Jahre Historie. Weil Fatigue
// schneller abklingt als Fitness, steigt die modellierte Leistung nach Lastreduktion → das Argmax über den
// Prognose-Horizont ist das optimale Taper (in Wochen). PyMC macht den vollen Bayes-Fit (inkl. τ, wenn belastbar);
// dieses Modul baut die Eingabe, entscheidet das adaptive τ-Gate und trägt den TS-Fallback (feste τ, fixes ρ,
// gewichteter Fit) + die reine Taper-Simulation. Rein beobachtend — k1/k2/τ sind Prognose-Parameter, nicht gemessen.
import type { ActivityLite, Indicator, IndicatorKind } from "./featureBackbone.ts";
import { coverageStats } from "./featureBackbone.ts";
import { KIND_R } from "./latentFitness.ts";

export const TAU1_0 = 6; // Fitness-Zeitkonstante (Wochen), Physiologie-Prior (≈ CTL 42 d)
export const TAU2_0 = 1.5; // Fatigue-Zeitkonstante (Wochen), Prior (≈ ATL 10 d)
export const HORIZON_DAYS = 21; // Taper-Prognose-Horizont in TAGEN (die Sim läuft täglich für Renntag-genaue
//                                 Taper-Längen wie „9 Tage"; der FIT bleibt wöchentlich = schnell + entrauscht).
export const TAPER_FRAC = 0.55; // Taper-Last relativ zur jüngsten Ø-Wochenlast
export const MAX_WEEKS = 104; // Fit-Fenster deckeln (Performance + Recency): letzte ~2 Jahre
export const MIN_OBS = 8; // unter so wenig Wochen-Leistungspunkten kein Fit (zu dünn)
export const RHO_0 = 1.5; // Standard-Fatigue:Fitness-Verhältnis k2/k1 (Banister-typisch >1, klassisch ~2): der Taper-
//                          Effekt existiert nur bei k2>k1 (Fatigue stärker gewichtet, klingt aber schneller ab).
//                          Fit/Fat kollinear → aus Daten allein schwer trennbar; TS-Fallback fixiert ρ, PyMC schätzt mit.
// Adaptiv-τ-Gate (eine Wahrheitsquelle): τ nur mitfitten, wenn belastbar viele „harte" Marker UND genug Historie.
export const TAU_GATE = { minReliable: 5, minSpanDays: 112 }; // (nRaceVdot+nLab) ≥ 5  UND  ≥ 16 Wochen

export interface BanisterPayload {
  load: number[]; // wöchentliche TSS, Index = Wochen-Offset (0..W−1, W−1 = aktuelle Woche)
  t_obs: number[]; // Wochen-Offsets der (wochen-aggregierten) Leistungs-Beobachtungen
  y: number[]; // z-standardisierte Leistung je Beobachtung
  r: number[]; // Beobachtungsrauschen (z-SD) je Beobachtung (aus KIND_R, kombiniert)
  fit_tau: boolean;
  tau1_0: number;
  tau2_0: number;
  horizon_days: number;
  taper_frac: number;
  recent_load: number; // jüngste Ø-Wochenlast (Taper-Basis)
  scale_perf: number; // z → VO2-äquivalente Rück-Skalierung (nur Anzeige)
  n_obs: number;
}

export interface BanisterResult {
  method: string; // 'pymc-banister' | 'ridge-banister'
  fit_tau: boolean;
  coverage_ok: boolean;
  n_obs: number;
  k1: number;
  k2: number;
  k1_low: number;
  k1_high: number;
  k2_low: number;
  k2_high: number;
  tau1: number; // Tage
  tau2: number; // Tage
  ratio: number; // k2/k1 = Fatigue-Gewicht relativ zum Fitness-Gewinn
  taper_days: number; // = peak_day (optimale Taper-Länge in Tagen)
  peak_day: number;
  peak_gain: number; // Δ Leistung am Peak vs. chronischem Steady-State (z-Einheiten)
  peak_low: number;
  peak_high: number;
  peak_gain_disp: number; // Δ am Peak in VO2-äquivalenten Einheiten (Anzeige)
  scale_perf: number;
  trajectory: { d: number; mean: number; lo: number; hi: number }[]; // Δperf(+d Tage Taper) in z-Einheiten
  reasons: string[];
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function sd(xs: number[], m = mean(xs)): number {
  if (xs.length < 2) return 1;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(v) || 1;
}

/** Diskrete Banister-Faltung (EWMA-Rekursion) über die Wochen-Last → Fit/Fat-Trajektorie je Woche. */
function convolveFF(load: number[], tau1: number, tau2: number): { fit: number[]; fat: number[] } {
  const d1 = Math.exp(-1 / tau1);
  const d2 = Math.exp(-1 / tau2);
  const fit = new Array<number>(load.length);
  const fat = new Array<number>(load.length);
  let f = 0;
  let g = 0;
  for (let t = 0; t < load.length; t++) {
    f = f * d1 + load[t];
    g = g * d2 + load[t];
    fit[t] = f;
    fat[t] = g;
  }
  return { fit, fat };
}

/**
 * Baut die Modell-Eingabe auf Wochenraster: Wochen-TSS-Serie (gedeckelt auf MAX_WEEKS) + wochen-aggregierte,
 * z-standardisierte Leistungs-Beobachtungen mit Rausch-Gewicht (KIND_R). Adaptiv-τ-Gate aus der Abdeckung.
 * Null, wenn zu wenige Wochen-Beobachtungen.
 */
export function buildBanisterPayload(
  acts: ActivityLite[],
  indicators: Indicator[],
  todayIso: string,
): BanisterPayload | null {
  if (indicators.length < MIN_OBS) return null;
  const DAY = 86_400_000;
  const WEEK = 7 * DAY;
  const todayMs = Date.parse(todayIso);

  // 1) Fenster: letzte MAX_WEEKS Wochen (ab frühestem relevanten Datum, aber nicht weiter zurück).
  const firstAct = acts.reduce<string | null>((m, a) => (m == null || a.date < m ? a.date : m), null);
  const earliestIso = [firstAct, indicators[0].date].filter(Boolean).sort()[0]!;
  const startMs = Math.max(Date.parse(earliestIso), todayMs - MAX_WEEKS * WEEK);
  const W = Math.round((todayMs - startMs) / WEEK) + 1;
  if (W < 12) return null; // zu kurze Historie für ein F−F-Fit
  const wkOf = (dateMs: number) => Math.floor((dateMs - startMs) / WEEK);

  // 2) Wochen-TSS-Serie.
  const load = new Array<number>(W).fill(0);
  for (const a of acts) {
    if (a.tss == null || a.tss <= 0) continue;
    const k = wkOf(Date.parse(a.date));
    if (k >= 0 && k < W) load[k] += a.tss;
  }

  // 3) Leistungs-Beobachtungen: je Quelle z-standardisieren (entfernt Quellen-Offset), dann PRO WOCHE
  //    inverse-varianz-gewichtet zu EINER Beobachtung kombinieren (n_obs ≈ Wochen → kleine, schnelle Matrix).
  const byKind = new Map<IndicatorKind, number[]>();
  for (const i of indicators) (byKind.get(i.kind) ?? byKind.set(i.kind, []).get(i.kind)!).push(i.value);
  const kStat = new Map<IndicatorKind, { m: number; s: number }>();
  for (const [k, vs] of byKind) kStat.set(k, { m: mean(vs), s: sd(vs) });
  const scaleVals = byKind.get("eff_vo2max") ?? indicators.map((i) => i.value);
  const scalePerf = sd(scaleVals);

  const perWeek = new Map<number, { sz: number; sw: number }>(); // Σ z/r² , Σ 1/r²
  for (const ind of indicators) {
    const k = wkOf(Date.parse(ind.date));
    if (k < 0 || k >= W) continue;
    const st = kStat.get(ind.kind)!;
    const z = (ind.value - st.m) / st.s;
    const rr = KIND_R[ind.kind] ?? 0.8;
    const iv = 1 / (rr * rr);
    const cur = perWeek.get(k) ?? { sz: 0, sw: 0 };
    cur.sz += z * iv;
    cur.sw += iv;
    perWeek.set(k, cur);
  }
  const t_obs: number[] = [];
  const y: number[] = [];
  const r: number[] = [];
  for (const [k, agg] of [...perWeek.entries()].sort((a, b) => a[0] - b[0])) {
    t_obs.push(k);
    y.push(agg.sz / agg.sw); // inverse-varianz-gewichtetes Wochen-Mittel
    r.push(Math.sqrt(1 / agg.sw)); // kombiniertes Rauschen
  }
  if (t_obs.length < MIN_OBS) return null;

  // 4) Taper-Basis = chronische Wochenlast (letzte ~6 volle Wochen, OHNE die aktuelle Teilwoche W−1, die je nach
  //    Wochentag unvollständig ist). Das Taper wird aus dem Steady-State DIESER Last simuliert (charakteristisch,
  //    nicht abhängig von der zufälligen Tagesform heute).
  const recentLoad = mean(load.slice(Math.max(0, W - 7), Math.max(1, W - 1)));

  // 5) Adaptiv-τ-Gate (an der VOLLEN Historie/Abdeckung, nicht am Fenster).
  const cov = coverageStats(acts, indicators);
  const fitTau = cov.nRaceVdot + cov.nLab >= TAU_GATE.minReliable && cov.spanDays >= TAU_GATE.minSpanDays;

  return {
    load,
    t_obs,
    y,
    r,
    fit_tau: fitTau,
    tau1_0: TAU1_0,
    tau2_0: TAU2_0,
    horizon_days: HORIZON_DAYS,
    taper_frac: TAPER_FRAC,
    recent_load: recentLoad,
    scale_perf: scalePerf,
    n_obs: t_obs.length,
  };
}

/**
 * Charakteristische Taper-Simulation in TAGESRASTER (für renntag-genaue Taper-Längen). Der Fit liefert τ in Wochen;
 * hier auf Tage umgerechnet (τ_d = 7·τ_w) und mit Tageslast (chronisch/7) simuliert — die Steady-State-Niveaus von
 * Tages- und Wochen-EWMA stimmen überein, also bleibt die Skala s (aus dem Wochen-Fit) konsistent. Vom Steady-State
 * bei chronischer Last D Tage reduzierte Last (taper_frac × chronic) fortschreiben, Δperf(d) = (k1·ΔFit − k2·ΔFat)/s.
 * Peak = argmax → optimale Taper-Länge (Tage). Weil Fatigue schneller abklingt und k2>k1 → interiorer Peak.
 */
function simulateTaper(
  k: { k1: number; k2: number; k1sd: number; k2sd: number },
  tau1Weeks: number,
  tau2Weeks: number,
  scale: number,
  chronicWeekly: number,
  horizonDays: number,
  taperFrac: number,
): { trajectory: { d: number; mean: number; lo: number; hi: number }[]; peak: { day: number; gain: number; lo: number; hi: number } } {
  const d1 = Math.exp(-1 / (tau1Weeks * 7)); // tägliche Zerfallsfaktoren
  const d2 = Math.exp(-1 / (tau2Weeks * 7));
  const dailyLoad = chronicWeekly / 7;
  const fit0 = dailyLoad / (1 - d1); // Tages-Steady-State ≈ Wochen-Steady-State (Niveaus stimmen)
  const fat0 = dailyLoad / (1 - d2);
  const taperLoad = dailyLoad * taperFrac;
  const kdraws = [
    { k1: Math.max(0, k.k1 - 1.88 * k.k1sd), k2: Math.max(0, k.k2 + 1.88 * k.k2sd) }, // pessimistisch
    { k1: k.k1, k2: k.k2 },
    { k1: Math.max(0, k.k1 + 1.88 * k.k1sd), k2: Math.max(0, k.k2 - 1.88 * k.k2sd) }, // optimistisch
  ];
  const traj: { d: number; mean: number; lo: number; hi: number }[] = [];
  let f = fit0;
  let g = fat0;
  for (let day = 1; day <= horizonDays; day++) {
    f = f * d1 + taperLoad;
    g = g * d2 + taperLoad;
    // GEMEINSAME Skala für Fit & Fat → der Taper-Effekt hängt nur an ρ=k2/k1 (>1 = Taper hilft).
    const vals = kdraws.map((kd) => (kd.k1 * (f - fit0) - kd.k2 * (g - fat0)) / scale);
    traj.push({ d: day, mean: vals[1], lo: Math.min(...vals), hi: Math.max(...vals) });
  }
  let pk = 0;
  for (let i = 1; i < traj.length; i++) if (traj[i].mean > traj[pk].mean) pk = i;
  return { trajectory: traj, peak: { day: traj[pk].d, gain: traj[pk].mean, lo: traj[pk].lo, hi: traj[pk].hi } };
}

/**
 * TS-Fallback-Fit (wenn kein Python-Sidecar): feste τ, festes Fatigue-Verhältnis ρ0 (Fit/Fat kollinear →
 * aus den Daten allein nicht trennbar). Gewichteter 2-Parameter-WLS für die Gesamt-Sensitivität k1 auf der
 * Freshness-Kombination C = Fit/s1 − ρ0·Fat/s2 ; k2 = ρ0·k1. Danach die Taper-Simulation. Ehrlich gelabelt.
 */
export function runBanisterTs(p: BanisterPayload): BanisterResult | null {
  const tau1 = p.tau1_0;
  const tau2 = p.tau2_0;
  const { fit, fat } = convolveFF(p.load, tau1, tau2);
  const fitObs = p.t_obs.map((t) => fit[t]);
  const fatObs = p.t_obs.map((t) => fat[t]);
  const s = sd(fitObs) || 1; // EINE gemeinsame Skala (bewahrt die Banister-Taper-Bedingung ρ>1)
  const rho = RHO_0;
  const C = p.t_obs.map((_, i) => (fitObs[i] - rho * fatObs[i]) / s); // Freshness-Kombination

  // Gewichteter 2-Parameter-WLS: perf = p0 + k1·C, Gewicht 1/r², schwache Ridge auf k1.
  const w = p.r.map((ri) => 1 / (ri * ri));
  let sw = 0, swc = 0, swy = 0, swcc = 0, swcy = 0;
  for (let i = 0; i < C.length; i++) {
    sw += w[i];
    swc += w[i] * C[i];
    swy += w[i] * p.y[i];
    swcc += w[i] * C[i] * C[i];
    swcy += w[i] * C[i] * p.y[i];
  }
  const ridge = 1.0;
  const det = sw * (swcc + ridge) - swc * swc || 1e-9; // Normalgleichungen [[sw,swc],[swc,swcc+ridge]]
  const p0 = ((swcc + ridge) * swy - swc * swcy) / det;
  const k1raw = (sw * swcy - swc * swy) / det;
  const k1 = Math.max(0, k1raw);
  const k2 = rho * k1;

  let ss = 0;
  for (let i = 0; i < C.length; i++) {
    const yh = p0 + k1raw * C[i];
    ss += w[i] * (p.y[i] - yh) * (p.y[i] - yh);
  }
  const sigma2 = Math.max(ss / Math.max(1, C.length - 2), 1e-6);
  const k1sd = Math.sqrt(Math.max((sw / det) * sigma2, 1e-8)); // Var(k1) = σ²·[inv]_22 = σ²·sw/det
  const k2sd = rho * k1sd;

  const sim = simulateTaper({ k1, k2, k1sd, k2sd }, tau1, tau2, s, p.recent_load, p.horizon_days, p.taper_frac);

  const reasons = ["Fatigue-Verhältnis Standard (ρ=1.5) — ohne Python kein persönlicher τ/ρ-Fit"];
  return {
    method: "ridge-banister",
    fit_tau: false,
    coverage_ok: p.fit_tau,
    n_obs: p.n_obs,
    k1,
    k2,
    k1_low: Math.max(0, k1 - 1.88 * k1sd),
    k1_high: k1 + 1.88 * k1sd,
    k2_low: Math.max(0, k2 - 1.88 * k2sd),
    k2_high: k2 + 1.88 * k2sd,
    tau1: tau1 * 7, // Anzeige in Tagen
    tau2: tau2 * 7,
    ratio: rho,
    taper_days: sim.peak.day,
    peak_day: sim.peak.day,
    peak_gain: sim.peak.gain,
    peak_low: sim.peak.lo,
    peak_high: sim.peak.hi,
    peak_gain_disp: sim.peak.gain * p.scale_perf,
    scale_perf: p.scale_perf,
    trajectory: sim.trajectory,
    reasons,
  };
}
