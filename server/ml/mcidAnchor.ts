// MCID-Verankerung (Reliable Change + Marker-Floor): leitet die Praxisschwelle („ab hier zählt ein Effekt als
// echt") aus der EIGENEN Messgenauigkeit ab, gefloort am physiologischen Marker. Pure, deterministisch, keine DB —
// der Aufrufer reicht die latente Trajektorie + die Marker-Floors herein (runner-testbar).
//
// Wissenschaft: die latente Fitness ist ein verrauschter Schätzer eines latenten Zustands (VO2-äquiv.); jeder Punkt
// trägt ein sd (Kalman/RTS-Posterior). Ein Fortschritt ist erst „praktisch bedeutsam", wenn er (a) das eigene
// Mess-/Schätzrauschen übersteigt UND (b) nicht unter dem klinisch sinnvollen Minimum (Marker-Test-Retest) liegt.
// → MCID_latent = clamp(z · median(sd), floor = Marker-MCID, ceil = ceilFactor · floor). z ~ 1.0 (pragmatisches
// Reliable-Change für ein STEUER-Gate — bewusst NICHT das strenge 1.96·√2 der Zwei-Messungen-RCI, das ein
// Trainings-Verdikt lahmlegen würde). CS bleibt am physiologischen Marker-Floor (s/km).

export interface AnchoredMcid {
  latent: number;          // absolute Δ latente Fitness (VO2-äquiv.) — Trials/Prospektiv-Gate
  cs: number;              // s/km — Regime/Schwerpunkt-EB-Achse (ersetzt das frühere MIN_CS-Literal)
  dosePerSd: number;       // per-SD-Slope-Gate der Dosis-/Latenz-Achsen — BEWUSST andere Einheit (Slope, kein
                           //   Marker-Analog) → fixe, dokumentierte Kalibrier-Konstante, NICHT athleten-verankert
  source: "anchored" | "default";
  basisSd: number | null;  // verwendetes latentes Messrauschen (Median sd) — für die UI-Erklärung; null = Default
}

/** Zentrale per-SD-Dosis-Schwelle (Δ latente Fitness je +1 SD Last). Eine Wahrheitsquelle für doseResponse + die
 *  Dosis-Achse des Verdikts. Slope-Größe ohne direkte Messgröße → fix (nicht verankerbar), hier dokumentiert. */
export const DOSE_PER_SD_MCID = 0.4;

/**
 * v3.1.0 — Floor der LATENTEN Achse (Kolja-Entscheid nach Befund).
 *
 * Vorher wurde die latente MCID am Test-Retest-Minimum EINER eff-VO2max-Einzelmessung (1,0 VO2-Äquiv.) gefloort.
 * Das war eine Einheiten-Verwechslung mit realer Konsequenz: Die latente Fitness ist kein Einzelmesswert, sondern
 * ein aus Dutzenden Quellen fusionierter, Kalman-geglätteter Zustand (typisches sd ≈ 0,15). Ihre Dynamik ist
 * bewusst träge (Prozessrauschen ~0,08/Woche) — ein 4-Wochen-Block KANN das Niveau gar nicht um ≥ 1,0 bewegen.
 * Folge: Kein N-of-1-Trial mit realistischen Blocklängen konnte je „praktisch relevant" werden; das Kausal-Gate
 * war faktisch tot (verifiziert an Isabels Demo-Trial: p = 0,031 signifikant, aber θ ≈ 0,35 < 1,0 → inconclusive).
 *
 * Jetzt: eigener, physiologisch begründeter Floor für die latente Achse — die kleinste Veränderung, die auf der
 * geglätteten Trajektorie überhaupt als echt gelten darf, ist ~2× das eigene Schätzrauschen, mindestens aber
 * dieser Wert. Die MARKER-Achsen (Critical Speed) bleiben unverändert an ihrer physiologischen Test-Retest-Grenze.
 */
export const LATENT_MCID_FLOOR = 0.3;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * Verankert die latente MCID an der eigenen Messgenauigkeit, gefloort am physiologischen Marker.
 * `latentPoints`: die (persistierte oder frisch gefittete) latente Trajektorie. `observed` ist optional — sind
 * Flags vorhanden, zählt nur das Rauschen der GEMESSENEN Punkte (echte Information); sonst die ganze Reihe.
 * Zu wenige verwertbare Punkte (< minObs) → ehrlicher Default (Floors), source = "default".
 */
export function computeAnchoredMcid(
  latentPoints: { sd: number; observed?: boolean }[],
  markerMcid: { effVo2max: number; csPace: number },
  opts: { z?: number; ceilFactor?: number; minObs?: number; latentFloor?: number } = {},
): AnchoredMcid {
  const z = opts.z ?? 1.0;
  const ceilFactor = opts.ceilFactor ?? 2.0;
  const minObs = opts.minObs ?? 8;
  // v3.1.0: Floor der latenten Achse ≠ Test-Retest einer Einzelmessung (siehe LATENT_MCID_FLOOR).
  // `markerMcid.effVo2max` bleibt die Obergrenzen-Referenz (ceil), damit verrauschte Daten die Schwelle
  // weiterhin anheben können — präzise Daten dürfen sie jetzt aber bis auf den latenten Floor senken.
  const floor = opts.latentFloor ?? LATENT_MCID_FLOOR;
  const ceil = ceilFactor * markerMcid.effVo2max;
  const cs = markerMcid.csPace;

  const hasObsFlag = latentPoints.some((p) => p.observed === true);
  const src = hasObsFlag ? latentPoints.filter((p) => p.observed) : latentPoints;
  const sds = src.filter((p) => Number.isFinite(p.sd) && p.sd > 0).map((p) => p.sd);

  if (sds.length < minObs) {
    return { latent: floor, cs, dosePerSd: DOSE_PER_SD_MCID, source: "default", basisSd: null };
  }
  const basisSd = median(sds);
  // 2× das eigene Schätzrauschen (Reliable Change auf der geglätteten Trajektorie), gefloort/gedeckelt.
  const latent = Math.min(ceil, Math.max(floor, 2 * z * basisSd));
  return {
    latent: Math.round(latent * 100) / 100,
    cs,
    dosePerSd: DOSE_PER_SD_MCID,
    source: "anchored",
    basisSd: Math.round(basisSd * 100) / 100,
  };
}
