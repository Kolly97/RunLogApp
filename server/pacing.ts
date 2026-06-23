// Race-Pacing (v1.4.0, B1): Zielzeit → km-Splits, höhenkorrigiert (Grade-Adjusted Pace, Minetti) +
// optional leichter Negativ-Split. Pure Modul. Garantie: Σ(pace_i·dist_i) == Zielzeit (P_gap löst genau das).
// Höhenprofil ist optional — ohne Profil ergibt sich exaktes Even-Pacing (gradeFactor(0)=1).
import { gradeFactor } from "./load.ts";

/** Höhenprofil je km-Segment: Netto-Höhengewinn (m, kann negativ sein) über das Segment. */
export interface PacingProfileKm { dist_km: number; elev_gain_m: number | null }

export interface PacingSplit {
  km: number;          // laufende km-Nummer (1-basiert)
  dist_km: number;     // Segmentlänge (km; letztes evtl. Teilstück)
  gradient: number;    // Steigung als Dezimal (geclamped ±0.45)
  pace_s: number;      // Ziel-Pace dieses Segments (s/km, real am Boden)
  gap_s: number;       // Grade-Adjusted Pace (Flach-Äquivalent, s/km) — der "Effort"
  cum_s: number;       // kumulierte Sollzeit bis Segmentende (s)
  elev_gain_m: number | null;
}
export interface PacingResult {
  distance_m: number;
  target_time_s: number;
  even_pace_s: number;   // gleichmäßige Flach-Pace (Zielzeit / Distanz)
  gap_pace_s: number;    // Basis-Effort-Pace P_gap (s/km)
  negativeSplit: boolean;
  hasProfile: boolean;
  splits: PacingSplit[];
}

/** km-Segmente aus Distanz erzeugen (volle km + Teilstück), wenn kein Profil vorliegt. */
function evenSegments(distanceM: number): PacingProfileKm[] {
  const out: PacingProfileKm[] = [];
  const full = Math.floor(distanceM / 1000);
  for (let i = 0; i < full; i++) out.push({ dist_km: 1, elev_gain_m: null });
  const rest = (distanceM - full * 1000) / 1000;
  if (rest > 0.02) out.push({ dist_km: Math.round(rest * 1000) / 1000, elev_gain_m: null });
  return out;
}

/**
 * Pacing-Plan: verteilt die Zielzeit so auf die Segmente, dass der Aufwand (Grade-Adjusted Pace)
 * gleichmäßig ist — bergauf langsamer, bergab schneller — und die Summe exakt der Zielzeit entspricht.
 * negativeSplit: linearer Effort-Anstieg von (1+f) am Start auf (1−f) am Ende (2. Hälfte schneller).
 */
export function pacingPlan(args: {
  distanceM: number;
  targetTimeS: number;
  profile?: PacingProfileKm[] | null;
  negativeSplit?: boolean;
  splitPct?: number; // Stärke des Negativ-Splits (Default 2 %)
}): PacingResult {
  const distanceM = Math.max(1, args.distanceM);
  const targetTimeS = Math.max(1, args.targetTimeS);
  const hasProfile = !!(args.profile && args.profile.length);
  const segs = hasProfile ? args.profile! : evenSegments(distanceM);
  const totalKm = segs.reduce((s, x) => s + (x.dist_km || 0), 0) || distanceM / 1000;
  const f = args.negativeSplit ? Math.max(0, Math.min(0.06, (args.splitPct ?? 2) / 100)) : 0;

  // Effort-Faktor je Segment (linear 1+f → 1−f über die kumulierte Streckenmitte).
  let cumKmMid = 0;
  const factor = segs.map((sgm) => {
    const mid = cumKmMid + (sgm.dist_km || 0) / 2;
    cumKmMid += sgm.dist_km || 0;
    return f ? 1 + f - (2 * f * mid) / totalKm : 1;
  });
  // Steigung + Grade-Faktor je Segment.
  const grade = segs.map((sgm) => {
    const km = sgm.dist_km || 0;
    if (!km || sgm.elev_gain_m == null) return 0;
    return Math.max(-0.45, Math.min(0.45, sgm.elev_gain_m / (km * 1000)));
  });
  const gf = grade.map((g) => gradeFactor(g));

  // Basis-Effort-Pace P_gap (s/km) so wählen, dass Σ gf·factor·P_gap·dist == Zielzeit.
  const weighted = segs.reduce((s, sgm, i) => s + gf[i] * factor[i] * (sgm.dist_km || 0), 0) || totalKm;
  const pGap = targetTimeS / weighted;

  const splits: PacingSplit[] = [];
  let cum = 0;
  segs.forEach((sgm, i) => {
    const km = sgm.dist_km || 0;
    const pace = gf[i] * factor[i] * pGap; // reale Pace am Boden (s/km)
    cum += pace * km;
    splits.push({
      km: i + 1, dist_km: Math.round(km * 100) / 100, gradient: Math.round(grade[i] * 1000) / 1000,
      pace_s: Math.round(pace), gap_s: Math.round(factor[i] * pGap), cum_s: Math.round(cum),
      elev_gain_m: sgm.elev_gain_m ?? null,
    });
  });

  return {
    distance_m: Math.round(distanceM),
    target_time_s: Math.round(targetTimeS),
    even_pace_s: Math.round(targetTimeS / (distanceM / 1000)),
    gap_pace_s: Math.round(pGap),
    negativeSplit: !!args.negativeSplit,
    hasProfile,
    splits,
  };
}
