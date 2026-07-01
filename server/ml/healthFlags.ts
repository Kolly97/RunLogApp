// P4 Gesundheits-Flags (pure, DETERMINISTISCH, NICHT-diagnostisch): erkennt Übertraining-/Erholungs-/RED-S-
// Warnsignale aus den vorhandenen Daten. Bewusst AUSSERHALB des Trainings-Optimizers (Frage 18): diese Signale
// ESKALIEREN ("erwäge Ruhe / Fachperson"), sie steuern NICHT das Training. Sport-wissenschaftlich begründete,
// transparente Schwellen — keine Black-Box. Greifen nur, wenn genug Daten da sind (sonst still).
export interface HealthDaily {
  date: string;
  hrv?: number | null;
  rhr?: number | null;
  sleep_h?: number | null;
  weight?: number | null;
  sick?: number | null;
}
export interface PmcLite {
  date: string;
  ctl: number;
  atl: number;
}
export interface LatentLite {
  date: string;
  value: number;
}
export interface HealthFlag {
  kind: string;
  severity: "info" | "warn" | "high";
  since: string;
  message: string;
}
export interface HealthResult {
  flags: HealthFlag[];
  disclaimer: string;
  bmi?: number | null;
}

const DISCLAIMER =
  "Nicht-diagnostisch. Gesundheitssignale, keine Trainingsempfehlung — im Zweifel mit einer Fachperson sprechen.";

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mad(a: number[], med: number): number {
  if (a.length < 2) return 0;
  return median(a.map((x) => Math.abs(x - med))) * 1.4826 || 0;
}
/** Werte eines Markers in [refDate-days, refDate]. */
function windowVals(daily: HealthDaily[], key: keyof HealthDaily, refT: number, days: number): { v: number; t: number }[] {
  const out: { v: number; t: number }[] = [];
  for (const d of daily) {
    const x = d[key] as number | null | undefined;
    if (x == null) continue;
    const t = Date.parse(d.date);
    const age = (refT - t) / 86_400_000;
    if (age >= 0 && age <= days) out.push({ v: x, t });
  }
  return out;
}

export function computeHealthFlags(
  daily: HealthDaily[], pmc: PmcLite[], latent: LatentLite[], todayIso: string,
  opts: { heightCm?: number | null; fallbackWeightKg?: number | null } = {},
): HealthResult {
  const flags: HealthFlag[] = [];
  const refT = Date.parse(todayIso);
  const rows = [...daily].sort((a, b) => (a.date < b.date ? -1 : 1));
  // BMI aus aktuellem Gewicht (Median letzte 14 Tage, sonst Profil-Gewicht) + Größe (cm)
  const wRecent = windowVals(rows, "weight", refT, 14).map((x) => x.v);
  const weightNow = wRecent.length ? median(wRecent) : (opts.fallbackWeightKg ?? null);
  const bmi = weightNow && opts.heightCm ? weightNow / Math.pow(opts.heightCm / 100, 2) : null;

  // --- HRV-Suppression: 7-Tage-Mittel deutlich unter 60-Tage-Baseline (braucht ≥14 HRV-Tage) ---
  const hrvBase = windowVals(rows, "hrv", refT, 60);
  const hrvRecent = windowVals(rows, "hrv", refT, 7);
  if (hrvBase.length >= 14 && hrvRecent.length >= 3) {
    const med = median(hrvBase.map((x) => x.v));
    const sd = mad(hrvBase.map((x) => x.v), med);
    const recentMean = hrvRecent.reduce((s, x) => s + x.v, 0) / hrvRecent.length;
    if (sd > 0 && recentMean < med - 1.0 * sd) {
      const sev = recentMean < med - 2.0 * sd ? "high" : "warn";
      flags.push({ kind: "hrv_suppressed", severity: sev, since: todayIso, message: "HRV mehrere Tage unter deiner Baseline — Zeichen für hohe Belastung/Erholungsdefizit. Erwäge zusätzliche Erholung." });
    }
  }

  // --- Ruhepuls erhöht: 7-Tage-Mittel über Baseline (möglicher Infekt/Übermüdung) ---
  const rhrBase = windowVals(rows, "rhr", refT, 60);
  const rhrRecent = windowVals(rows, "rhr", refT, 7);
  if (rhrBase.length >= 14 && rhrRecent.length >= 3) {
    const med = median(rhrBase.map((x) => x.v));
    const sd = mad(rhrBase.map((x) => x.v), med);
    const recentMean = rhrRecent.reduce((s, x) => s + x.v, 0) / rhrRecent.length;
    if (recentMean > med + Math.max(4, 1.0 * sd)) {
      flags.push({ kind: "rhr_elevated", severity: recentMean > med + Math.max(8, 2 * sd) ? "high" : "warn", since: todayIso, message: "Ruhepuls erhöht gegenüber deiner Baseline — möglicher Infekt oder Übermüdung. Beobachten, ggf. Pause." });
    }
  }

  // --- Schlaf niedrig: 5-Tage-Mittel < 6 h und deutlich unter Baseline ---
  const sleepBase = windowVals(rows, "sleep_h", refT, 60);
  const sleepRecent = windowVals(rows, "sleep_h", refT, 5);
  if (sleepBase.length >= 14 && sleepRecent.length >= 3) {
    const med = median(sleepBase.map((x) => x.v));
    const recentMean = sleepRecent.reduce((s, x) => s + x.v, 0) / sleepRecent.length;
    if (recentMean < 6.0 && recentMean < med - 1.0) {
      flags.push({ kind: "sleep_low", severity: recentMean < 5.0 ? "high" : "warn", since: todayIso, message: "Schlaf seit Tagen niedrig — Erholung leidet. Priorisiere Schlaf." });
    }
  }

  // --- Trainings-Überlast: ACWR (ATL/CTL) > 1.5 ---
  const lastPmc = pmc.length ? pmc[pmc.length - 1] : null;
  if (lastPmc && lastPmc.ctl > 5) {
    const acwr = lastPmc.atl / lastPmc.ctl;
    if (acwr > 1.5) flags.push({ kind: "acwr_high", severity: acwr > 1.8 ? "high" : "warn", since: lastPmc.date, message: `Akut-zu-chronisch-Last hoch (ACWR ${acwr.toFixed(2)}) — erhöhtes Überlastungsrisiko. Last vorsichtig steigern.` });
  }

  // --- Zu steiler Aufbau: CTL-Anstieg > 8 / Woche ---
  if (pmc.length >= 8) {
    const now = pmc[pmc.length - 1];
    const wk = pmc.find((p) => (Date.parse(now.date) - Date.parse(p.date)) / 86_400_000 <= 7) ?? pmc[Math.max(0, pmc.length - 8)];
    const ramp = now.ctl - wk.ctl;
    if (ramp > 8) flags.push({ kind: "ctl_ramp_steep", severity: ramp > 12 ? "high" : "warn", since: now.date, message: `Fitness-Aufbau sehr steil (+${ramp.toFixed(0)} CTL/Woche) — Verletzungsrisiko. Sanfter rampen.` });
  }

  // --- Unerklärter Fitness-Abfall trotz weiterlaufendem Training (Non-functional Overreaching) ---
  if (latent.length >= 8 && pmc.length >= 8) {
    const lnow = latent[latent.length - 1];
    const lpast = latent.find((p) => (Date.parse(lnow.date) - Date.parse(p.date)) / 86_400_000 >= 35) ?? latent[0];
    const ctlNow = lastPmc?.ctl ?? 0;
    const ctlPast = pmc.find((p) => (Date.parse(lnow.date) - Date.parse(p.date)) / 86_400_000 >= 35)?.ctl ?? ctlNow;
    if (lnow.value < lpast.value - 1.5 && ctlNow >= ctlPast - 3) {
      flags.push({ kind: "unexplained_decline", severity: "warn", since: lnow.date, message: "Fitness fällt, obwohl das Training weiterläuft — möglicher Non-functional Overreaching. Erwäge eine Entlastungsphase." });
    }
  }

  // --- RED-S-Proxy: Gewichtsverlust bei hoher Trainingslast (Energiemangel) ---
  const wNow = windowVals(rows, "weight", refT, 10);
  const wPast = windowVals(rows, "weight", refT, 40).filter((x) => (refT - x.t) / 86_400_000 >= 21);
  if (wNow.length >= 1 && wPast.length >= 1 && lastPmc && lastPmc.ctl > 30) {
    const now = median(wNow.map((x) => x.v));
    const past = median(wPast.map((x) => x.v));
    if (past > 0 && (past - now) / past > 0.025) {
      flags.push({ kind: "red_s_risk", severity: "high", since: todayIso, message: "Gewichtsverlust bei hoher Trainingslast — möglicher Energiemangel (RED-S). Nicht-diagnostisch: erwäge ein Gespräch mit einer Fachperson." });
    }
  }

  // --- Krankheit eingetragen ---
  const sickRecent = rows.filter((d) => d.sick && (refT - Date.parse(d.date)) / 86_400_000 <= 7);
  if (sickRecent.length) flags.push({ kind: "illness", severity: "warn", since: sickRecent[sickRecent.length - 1].date, message: "Krankheit eingetragen — Training entsprechend reduzieren." });

  // --- Niedriger BMI (Untergewicht) — bei hoher Trainingslast RED-S-Verstärkung ---
  if (bmi != null && bmi < 18.5) {
    const highLoad = !!lastPmc && lastPmc.ctl > 30;
    flags.push({
      kind: "low_bmi",
      severity: bmi < 17 ? "high" : highLoad ? "warn" : "info",
      since: todayIso,
      message: `BMI ${bmi.toFixed(1)} (Untergewicht)${highLoad ? " bei hoher Trainingslast — erhöhtes RED-S-Risiko" : ""}. Nicht-diagnostisch: erwäge ein Gespräch mit einer Fachperson.`,
    });
  }

  return { flags, disclaimer: DISCLAIMER, bmi };
}
