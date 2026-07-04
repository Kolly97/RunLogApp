// Adaptives Coaching-Gerüst (ToDo 35): übersetzt die geschichtete „Was hilft dir?"-Synthese (trainingVerdict)
// + Gesundheit/Readiness in konkrete PLANER-Eingaben — pure, keine DB-Seiteneffekte (der Aufrufer reicht die
// Daten herein), damit es runner-testbar bleibt.
//
// Leitprinzip (co-decided): die Evidenz steuert AUTOMATISCH, wenn sie belastbar ist (sonst sportwissenschaftlicher
// Default), GESTUFT (kausal-geprüfte Trials stark · beobachtet sanft · Hypothese nur Anzeige); die Evidenz gewinnt
// beim Schwerpunkt, wenn belastbar (manuelle Wahl bleibt bewusster Override); Health-Flags kappen HART; Readiness
// moduliert (im Planer); Zyklus bleibt beratend. Nichts hiervon überschreibt das Gesundheits-Veto.
import type { TrainingVerdict, AxisVerdict, Conf } from "./ml/trainingVerdict.ts";
import { EMPHASIS_LABEL, REGIME_LABEL } from "./ml/trainingVerdict.ts";

// Das Planer-Schwerpunkt-Vokabular (workouts.ts pickWeekWorkouts / planbuilder Availability.emphasis) — identisch
// mit der EMPHASIS_LABEL-Achse der Synthese, „ausgewogen" ist KEIN steuernder Schwerpunkt (= Default).
const PLANNER_EMPHASIS = new Set(["lt1", "vo2", "schwelle", "berg", "norwegian", "fartlek"]);

export type CoachTier = "geprüft" | "beobachtet";
export interface CoachEmphasisPref { emphasis: string; label: string; confidence: Conf; tier: CoachTier; rationale: string }
export interface CoachRegimePref { regime: string; label: string; confidence: "hoch" | "mittel" | "niedrig"; tier: CoachTier; rationale: string }
export interface CoachHealthCap { loadFactor: number; dropTopIntensity: boolean; reason: string | null }
export interface CoachingPrefs {
  emphasis: CoachEmphasisPref | null;          // belastbare Evidenz (oder null → Default)
  emphasisEffective: string | null;            // der tatsächlich an den Planer gereichte Schwerpunkt (nach Auflösung)
  emphasisSource: "evidence" | "manual" | "default";
  regime: CoachRegimePref | null;
  healthCap: CoachHealthCap;
  headline: string;
  overallConfidence: Conf;
  layer: "observed" | "causal";
  notes: string[];                             // erklärende Zeilen (Health/Readiness/Zyklus/Frische)
}

export interface HealthFlagLite { kind: string; severity: string; message?: string }
export interface DeriveOpts {
  healthFlags?: HealthFlagLite[];
  readinessLevel?: string | null;               // "gruen" | "gelb" | "rot" o.ä. (nur für erklärende Note)
  availabilityEmphasis?: string | null;         // manueller Schwerpunkt aus den Availability-Settings
  emphasisMode?: "auto" | "manual";             // Default "auto": Evidenz gewinnt bei Belastbarkeit
  cycleNote?: string | null;                    // beratende Zyklus-Empfehlung (nur Anzeige)
}

const REGIME_CONF = (c: Conf): "hoch" | "mittel" | "niedrig" => (c === "hoch" ? "hoch" : c === "mittel" ? "mittel" : "niedrig");
const axisOf = (v: TrainingVerdict, a: "dose" | "regime" | "emphasis"): AxisVerdict | undefined => v.axes.find((x) => x.axis === a);

/** Health-Cap aus den Flags: high (RED-S/Übertraining) → Last runter + Spitzen-Intensität raus; warn → sanfter.
 *  Exportiert, damit auch der Wochen-Vorschlag (ohne die volle Verdikt-Synthese) das Gesundheits-Veto anwendet. */
export function coachHealthCap(flags: HealthFlagLite[]): CoachHealthCap {
  const high = flags.find((f) => f.severity === "high");
  if (high) return { loadFactor: 0.8, dropTopIntensity: true, reason: `Gesundheits-Flag (${high.kind}) — Health-first: Last und Spitzen-Intensität automatisch gekappt.${high.message ? " " + high.message : ""}` };
  const warn = flags.find((f) => f.severity === "warn");
  if (warn) return { loadFactor: 0.9, dropTopIntensity: false, reason: `Gesundheits-Hinweis (${warn.kind}) — Last leicht konservativer gehalten.` };
  return { loadFactor: 1, dropTopIntensity: false, reason: null };
}

/**
 * Kern: Synthese → Planer-Prefs. `best` einer Achse ist per Konstruktion nur gesetzt, wenn der Kandidat praktisch
 * belastbar & positiv („hilft") ist → genau die Belastbarkeits-Schwelle für das Steuern. Hypothesen (kein best)
 * steuern NICHT.
 */
export function deriveCoachingPrefs(verdict: TrainingVerdict, opts: DeriveOpts = {}): CoachingPrefs {
  const flags = opts.healthFlags ?? [];
  const healthCap = coachHealthCap(flags);
  const notes: string[] = [];
  if (healthCap.reason) notes.push(healthCap.reason);

  // --- Schwerpunkt-Achse (Qualitäts-Schwerpunkt → Planer-Emphasis) ---
  const emphAxis = axisOf(verdict, "emphasis");
  const eb = emphAxis?.best ?? null;
  let emphasis: CoachEmphasisPref | null = null;
  if (eb && PLANNER_EMPHASIS.has(eb.key)) {
    const tier: CoachTier = eb.causalProven ? "geprüft" : "beobachtet";
    emphasis = {
      emphasis: eb.key,
      label: EMPHASIS_LABEL[eb.key] ?? eb.key,
      confidence: eb.causalProven ? "hoch" : eb.confidence,
      tier,
      rationale: tier === "geprüft"
        ? `${EMPHASIS_LABEL[eb.key] ?? eb.key} ist bei dir kausal geprüft (N-of-1-Trial) → Schwerpunkt gesetzt.`
        : `${EMPHASIS_LABEL[eb.key] ?? eb.key} baut bei dir überdurchschnittlich Fitness (beobachtet, CI ohne 0) → Schwerpunkt sanft gesetzt.`,
    };
  }

  // --- Regime-Achse (Intensitäts-Verteilung → methodPreference) ---
  const regAxis = axisOf(verdict, "regime");
  const rb = regAxis?.best ?? null;
  let regime: CoachRegimePref | null = null;
  if (rb && REGIME_LABEL[rb.key]) {
    const tier: CoachTier = rb.causalProven ? "geprüft" : "beobachtet";
    regime = {
      regime: rb.key,
      label: REGIME_LABEL[rb.key] ?? rb.key,
      confidence: rb.causalProven ? "hoch" : REGIME_CONF(rb.confidence),
      tier,
      rationale: tier === "geprüft"
        ? `${REGIME_LABEL[rb.key] ?? rb.key} ist bei dir kausal geprüft → Verteilung angepasst.`
        : `${REGIME_LABEL[rb.key] ?? rb.key} korrelierte bei dir mit Fortschritt (beobachtet) → Verteilung sanft angepasst.`,
    };
  }

  // --- Auflösung Evidenz vs. manuell (Q3) ---
  const manual = opts.availabilityEmphasis && opts.availabilityEmphasis !== "ausgewogen" ? opts.availabilityEmphasis : null;
  const mode = opts.emphasisMode ?? "auto";
  let emphasisEffective: string | null;
  let emphasisSource: CoachingPrefs["emphasisSource"];
  if (mode === "manual") {
    // Bewusster Override: die manuelle Wahl gewinnt; Evidenz nur, wenn nichts gesetzt.
    if (manual) { emphasisEffective = manual; emphasisSource = "manual"; }
    else if (emphasis) { emphasisEffective = emphasis.emphasis; emphasisSource = "evidence"; }
    else { emphasisEffective = null; emphasisSource = "default"; }
  } else {
    // Auto (Default): Evidenz gewinnt bei Belastbarkeit, sonst manuell, sonst Default.
    if (emphasis) { emphasisEffective = emphasis.emphasis; emphasisSource = "evidence"; }
    else if (manual) { emphasisEffective = manual; emphasisSource = "manual"; }
    else { emphasisEffective = null; emphasisSource = "default"; }
  }

  if (opts.readinessLevel) notes.push(`Readiness heute (${opts.readinessLevel}) moduliert die Tages-/Wochenlast.`);
  if (opts.cycleNote) notes.push(`Zyklus (beratend): ${opts.cycleNote}`);
  if (!emphasis && !regime) notes.push("Noch keine belastbare individuelle Evidenz — der Plan folgt dem sportwissenschaftlichen Standard (Periodisierung + Zieldistanz).");

  return {
    emphasis, emphasisEffective, emphasisSource, regime, healthCap,
    headline: verdict.headline,
    overallConfidence: verdict.overallConfidence,
    layer: (emphasis?.tier === "geprüft" || regime?.tier === "geprüft") ? "causal" : "observed",
    notes,
  };
}
