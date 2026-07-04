// ML-Job-Orchestrator: führt Engine-Läufe ausserhalb des Request-Threads aus (nicht-blockierend via
// setImmediate), schreibt den ml_runs-Lebenszyklus (running→done/failed/cancelled) + Fortschritt,
// persistiert Ergebnisse atomar und liefert Frische/Veraltet-Status. Zwei Läufe: latente Fitness (L2) und
// Dosis-Wirkung (L3). Leichte TS-Compute in-process; schwere Bayes-Läufe delegieren später an den Sidecar.
import { db, getProfileSetting, setProfileSetting } from "./db.ts";
import {
  buildTargetIndicators,
  weeklyChannelCtl,
  dailyChannelLoads,
  typeOverrideChannel,
  CHANNEL_SETS,
  inputHash,
  type ActivityLite,
  type RaceLite,
  type LabLite,
  type ChannelCount,
} from "./ml/featureBackbone.ts";
import { fitLatentFitness, type LatentPoint } from "./ml/latentFitness.ts";
import { estimateDoseResponse, type DesignRow, type DoseModelResult } from "./ml/doseResponse.ts";
import { runWithFallback } from "./ml/sidecar.ts";
import { detectChangepoints } from "./ml/causalObs.ts";
import { exploratoryScan } from "./ml/exploratory.ts";
import { computeReadiness } from "./ml/readinessFilter.ts";
import { computeHealthFlags, type HealthDaily, type PmcLite } from "./ml/healthFlags.ts";
import { computePmc } from "./load.ts";
import {
  randomizePairOrders,
  buildBlockSchedule,
  blockOutcome,
  evaluateTrial,
  proposeChannelContrast,
  type Block,
} from "./ml/prospective.ts";

export type MlKind = "latent_fitness" | "dose_response" | "readiness";
const MODEL_VERSION = "0.6.0"; // Composition-Bayes: eigener IR-Lauf auf volumen-bereinigten Lasten mit Σβ=0 (target='composition')
// — Bump nötig, da alte Läufe keine Composition-Posteriors haben. (VIF-Reserve autoVifThreshold=6 kam ohne eigenen Bump.)
const SEED = 42;
const HALF_LIFE_MS = 450 * 86_400_000; // Recency-Halbwertszeit (Frage 12)

const cancelled = new Set<number>();
const nowIso = () => new Date().toISOString();

export interface RunRow {
  id: number;
  profile_id: number;
  kind: string;
  status: string;
  engine: string | null;
  model_version: string | null;
  seed: number | null;
  input_hash: string | null;
  settings_json: string | null;
  progress: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export function getRun(runId: number): RunRow | null {
  return (db.prepare("SELECT * FROM ml_runs WHERE id=?").get(runId) as unknown as RunRow) ?? null;
}
export function latestRun(profileId: number, kind: MlKind): RunRow | null {
  return (db.prepare("SELECT * FROM ml_runs WHERE profile_id=? AND kind=? ORDER BY id DESC LIMIT 1").get(profileId, kind) as unknown as RunRow) ?? null;
}
/**
 * Der zum AKTUELLEN Input-Hash (Daten + Kanal-Einstellungen) + Code-Version passende, zuletzt abgeschlossene Lauf.
 * Wichtig gegen den „falschen Lauf"-Bug: `startRun` verwendet einen alten, hash-gleichen Lauf wieder (Idempotenz),
 * ohne einen neuen (höher-ID'ten) anzulegen. Anzeige/Frische dürfen deshalb NICHT blind `latestRun` (max. ID) nehmen,
 * sonst zeigt die Karte nach einem Kanal-Wechsel den falschen Lauf und bleibt fälschlich „veraltet".
 */
export function matchingDoneRun(profileId: number, kind: MlKind): RunRow | null {
  const hash = runHash(kind, profileId);
  return (db
    .prepare("SELECT * FROM ml_runs WHERE profile_id=? AND kind=? AND status='done' AND input_hash=? AND model_version=? ORDER BY id DESC LIMIT 1")
    .get(profileId, kind, hash, MODEL_VERSION) as unknown as RunRow) ?? null;
}
export function cancelRun(runId: number): void {
  cancelled.add(runId);
  // Sofort in der DB als abgebrochen markieren → die „rechnet…"-Pille wird umgehend frei (nicht erst, wenn der
  // Job das Flag beim nächsten setProgress prüft; bei einem im Sidecar hängenden Lauf könnte das lange dauern).
  db.prepare("UPDATE ml_runs SET status='cancelled', finished_at=? WHERE id=? AND status='running'").run(nowIso(), runId);
}
function setProgress(runId: number, p: number): void {
  if (cancelled.has(runId)) throw new Error("__cancelled__");
  db.prepare("UPDATE ml_runs SET progress=? WHERE id=?").run(p, runId);
}

function loadActs(profileId: number): ActivityLite[] {
  return db
    .prepare("SELECT date, sport, type, tss, eff_vo2max, distance_m, moving_s, pace_zone_min FROM activities WHERE profile_id=?")
    .all(profileId) as unknown as ActivityLite[];
}
function loadIndicators(profileId: number) {
  const acts = loadActs(profileId);
  const races = db.prepare("SELECT date, distance_m, time_s FROM races WHERE profile_id=?").all(profileId) as unknown as RaceLite[];
  const labs = db.prepare("SELECT date, value FROM vo2max_lab WHERE profile_id=?").all(profileId) as unknown as LabLite[];
  return { acts, inds: buildTargetIndicators(acts, races, labs) };
}

function channelCountFor(profileId: number): ChannelCount {
  const row = db.prepare("SELECT channel_count FROM ml_settings WHERE profile_id=?").get(profileId) as { channel_count?: number } | undefined;
  const c = row?.channel_count ?? 5;
  return c === 3 || c === 4 || c === 5 ? (c as ChannelCount) : 5;
}
function channelAutoFor(profileId: number): boolean {
  const row = db.prepare("SELECT channel_auto FROM ml_settings WHERE profile_id=?").get(profileId) as { channel_auto?: number } | undefined;
  return (row?.channel_auto ?? 1) !== 0;
}

/** Eingabe-Hash je Lauf-Art (Idempotenz/Frische). Readiness hängt an den Wellness-Daten, nicht an Indikatoren. */
function runHash(kind: MlKind, profileId: number): string {
  if (kind !== "readiness") {
    const { inds } = loadIndicators(profileId);
    return inputHash(inds) + (kind === "dose_response" ? `:c${channelCountFor(profileId)}:a${channelAutoFor(profileId) ? 1 : 0}` : "");
  }
  const dl = db.prepare("SELECT date, hrv, resting_hr, sleep_h, recovery, weight, sick FROM daily_log_v2 WHERE profile_id=? ORDER BY date").all(profileId) as Record<string, unknown>[];
  const a = db.prepare("SELECT COUNT(*) n, MAX(date) m FROM activities WHERE profile_id=?").get(profileId) as { n: number; m: string | null };
  const ath = getProfileSetting("athlete", {} as { height?: number | null; weight?: number | null }, profileId);
  const s = dl.map((d) => Object.values(d).join("|")).join(";") + `#${a.n}|${a.m}@${ath?.height ?? ""}|${ath?.weight ?? ""}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return "r" + (h >>> 0).toString(16);
}

function loadDailyWellness(profileId: number): (HealthDaily & { recovery?: number | null })[] {
  return db
    .prepare("SELECT date, hrv, resting_hr AS rhr, sleep_h, recovery, weight, sick FROM daily_log_v2 WHERE profile_id=? ORDER BY date")
    .all(profileId) as unknown as (HealthDaily & { recovery?: number | null })[];
}

function buildPmc(profileId: number): PmcLite[] {
  const acts = db.prepare("SELECT date, SUM(COALESCE(tss,0)) s FROM activities WHERE profile_id=? GROUP BY date").all(profileId) as { date: string; s: number }[];
  if (!acts.length) return [];
  const map = new Map<string, number>();
  for (const a of acts) map.set(a.date, a.s);
  const today = new Date().toISOString().slice(0, 10);
  return computePmc(map, acts[0].date, today, today).map((p) => ({ date: p.date, ctl: p.ctl, atl: p.atl }));
}

function persistLatent(profileId: number, runId: number, points: LatentPoint[]): void {
  const del = db.prepare("DELETE FROM ml_latent_fitness WHERE profile_id=?");
  const ins = db.prepare("INSERT INTO ml_latent_fitness(profile_id, date, value, sd, run_id) VALUES(?,?,?,?,?)");
  db.exec("BEGIN");
  try {
    del.run(profileId);
    for (const pt of points) ins.run(profileId, pt.date, pt.value, pt.sd, runId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Verbindet die wöchentliche Kanal-CTL mit der latenten Fitness (nächster Punkt ≤7 Tage) + Recency-Gewicht. */
function buildDoseDesign(acts: ActivityLite[], latent: LatentPoint[], count: ChannelCount): DesignRow[] {
  const lat = latent.map((p) => ({ t: Date.parse(p.date), v: p.value }));
  if (!lat.length) return [];
  const lastT = lat[lat.length - 1].t;
  const nearest = (d: string): number | null => {
    const t = Date.parse(d);
    let v: number | null = null, bd = Infinity;
    for (const p of lat) {
      const dd = Math.abs(p.t - t);
      if (dd < bd) { bd = dd; v = p.v; }
    }
    return bd <= 7 * 86_400_000 ? v : null;
  };
  const out: DesignRow[] = [];
  for (const r of weeklyChannelCtl(acts, count)) {
    const o = nearest(r.date);
    if (o == null) continue;
    out.push({ date: r.date, outcome: o, ctl: r.ctl, total: r.total, weight: Math.pow(0.5, (lastT - Date.parse(r.date)) / HALF_LIFE_MS) });
  }
  return out;
}

function persistEffects(runId: number, profileId: number, model: DoseModelResult): void {
  const ins = db.prepare(
    "INSERT INTO ml_channel_effects(run_id, profile_id, channel, target, lag_weeks, gain_mean, ci_low, ci_high, n_blocks, collinearity_flag, mcid_pass, confidence, p_boot, q_fdr, e_value, e_value_ci, fdr_survive, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  const num = (x: number) => (Number.isFinite(x) ? x : null);
  for (const e of model.effects) {
    ins.run(runId, profileId, e.channel, model.model, null, num(e.effectPerSd), num(e.ciLow), num(e.ciHigh), model.diagnostics.nWeeks, e.collinear ? 1 : 0, e.mcidPass ? 1 : 0, e.confidence, num(e.pBoot), num(e.qFdr), num(e.eValue), num(e.eValueCi), e.fdrSurvive ? 1 : 0, nowIso());
  }
}

export interface WhatIfPoint { w: number; mean: number; lo: number; hi: number }
export interface WhatIf { block_weeks: number; horizon_weeks: number; peak_week: number; peak_delta: number; peak_low: number; peak_high: number; trajectory: WhatIfPoint[] }
export interface BayesChannel { channel: string; mean: number; sd: number; hdi_low: number; hdi_high: number; p_positive: number; tau_weeks?: number | null; half_life_weeks?: number | null; whatif?: WhatIf | null }
export interface BayesDoseResult { method: string; n_weeks: number; channels: BayesChannel[] }
/** Residualisiert jede Kanal-Last-Spalte gegen die Gesamt-Wochenlast (OLS) → „Volumen-bereinigt" (Komposition):
 *  Schwerpunkt bei gleichem Umfang, analog zum TS-Composition-Pfad. Achtung: die Residuen summieren sich exakt zu 0
 *  → das Design ist rank-defizient; der Sidecar identifiziert es über den Sum-to-zero-Constraint (Σβ=0). */
function residualizeAgainstTotal(loads: number[][]): number[][] {
  const T = loads.length;
  if (!T) return loads;
  const C = loads[0].length;
  const total = loads.map((row) => row.reduce((s, x) => s + x, 0));
  const mt = total.reduce((s, x) => s + x, 0) / T;
  const out = loads.map((row) => row.slice());
  for (let c = 0; c < C; c++) {
    const col = loads.map((r) => r[c]);
    const mc = col.reduce((s, x) => s + x, 0) / T;
    let szz = 0, szv = 0;
    for (let i = 0; i < T; i++) { const dt = total[i] - mt; szz += dt * dt; szv += dt * (col[i] - mc); }
    const b = szz > 1e-9 ? szv / szz : 0;
    const a = mc - b * mt;
    for (let i = 0; i < T; i++) out[i][c] = col[i] - (a + b * total[i]);
  }
  return out;
}
/** B2a: rohe Wochen-Lasten je Kanal (aus den täglichen Kanal-Lasten aggregiert) + Wochen-Index — Input für die IR-Faltung.
 *  model="composition" residualisiert die Lasten gegen die Gesamt-Wochenlast und setzt sum_zero (Σβ=0 im Sidecar). */
function buildIrDesign(acts: ActivityLite[], design: DesignRow[], count: ChannelCount, model: "mediator" | "composition"): { channels: string[]; loads: number[][]; y: number[]; t_weeks: number[]; sum_zero: boolean } | null {
  const chs = CHANNEL_SETS[count];
  if (design.length < chs.length + 3) return null;
  const dailyArr = [...dailyChannelLoads(acts, count).entries()].map(([d, rec]) => ({ t: Date.parse(d), rec }));
  const t0 = Date.parse(design[0].date);
  let loads = design.map((row) => {
    const end = Date.parse(row.date), start = end - 7 * 86_400_000;
    const agg: Record<string, number> = {};
    for (const { t, rec } of dailyArr) if (t > start && t <= end) for (const c of chs) agg[c] = (agg[c] ?? 0) + (rec[c] ?? 0);
    return chs.map((c) => agg[c] ?? 0);
  });
  if (model === "composition") loads = residualizeAgainstTotal(loads);
  const t_weeks = design.map((row) => Math.round((Date.parse(row.date) - t0) / (7 * 86_400_000)));
  return { channels: chs, loads, y: design.map((r) => r.outcome), t_weeks, sum_zero: model === "composition" };
}
/** Phase B2a: Kanal-Achse als Bayes-IMPULSE-RESPONSE via Sidecar (PyMC gefittetes τ, sonst Conjugate feste τ).
 *  model="mediator" = absolute Lasten · "composition" = volumen-bereinigt + Σβ=0. */
async function runBayesDose(acts: ActivityLite[], count: ChannelCount, design: DesignRow[], model: "mediator" | "composition"): Promise<{ engine: "python" | "ts"; result: BayesDoseResult | null }> {
  // Kosten deckeln: die IR-MCMC hat O(T²)-Faltungsmatrizen je Kanal → auf die letzten 52 Wochen begrenzen.
  // (Fenster bewusst wie zuvor — die „genauer"-Wirkung kommt aus dem großzügigen Timeout unten: der Bayes-Lauf
  // rechnet durch, statt bei ~2 min auf die gröbere TS-Ridge zurückzufallen. Das Timeout ist nur ein Not-Riegel.)
  const ir = buildIrDesign(acts, design.slice(-52), count, model);
  if (!ir) return { engine: "ts", result: null };
  try {
    return await runWithFallback<BayesDoseResult | null>({ kind: "dose_ir", payload: ir }, () => null, { timeoutMs: 900_000 });
  } catch {
    return { engine: "ts", result: null };
  }
}

// Ein „running"-Lauf gilt erst als tot, wenn er ÜBER dem Sidecar-Hard-Timeout (15 min) liegt — so wird ein
// legitim langer, aber lebendiger Bayes-Lauf nie mitten in der Rechnung abgeräumt; abgeräumt werden nur echte
// Leichen (Crash/Server-Neustart während setImmediate), die sonst die „rechnet…"-Pille ewig blau lassen.
const STALE_RUN_MS = 20 * 60_000;
export function reapStaleRuns(profileId: number): void {
  const cutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
  db.prepare("UPDATE ml_runs SET status='failed', error='stale (timeout, aufgeräumt)', finished_at=? WHERE profile_id=? AND status='running' AND started_at < ?")
    .run(nowIso(), profileId, cutoff);
}

export function startRun(kind: MlKind, profileId: number): { runId: number; reused?: boolean } {
  reapStaleRuns(profileId);
  const hash = runHash(kind, profileId);
  const done = db
    .prepare("SELECT id FROM ml_runs WHERE profile_id=? AND kind=? AND status='done' AND input_hash=? AND model_version=? ORDER BY id DESC LIMIT 1")
    .get(profileId, kind, hash, MODEL_VERSION) as { id: number } | undefined;
  if (done) return { runId: done.id, reused: true }; // code-versions-bewusst: alte Läufe werden nicht wiederverwendet

  const info = db
    .prepare("INSERT INTO ml_runs(profile_id, kind, status, engine, model_version, seed, input_hash, progress, started_at, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(profileId, kind, "running", "ts", MODEL_VERSION, SEED, hash, 0, nowIso(), nowIso());
  const runId = Number(info.lastInsertRowid);
  setImmediate(() => { void runJob(runId, kind, profileId).catch(() => { /* runJob kapselt Fehler selbst */ }); });
  return { runId };
}

async function runJob(runId: number, kind: MlKind, profileId: number): Promise<void> {
  try {
    setProgress(runId, 0.1);
    const { acts, inds } = loadIndicators(profileId);
    setProgress(runId, 0.3);
    const fit = fitLatentFitness(inds);

    if (kind === "latent_fitness") {
      setProgress(runId, 0.7);
      persistLatent(profileId, runId, fit ? fit.points : []);
    } else if (kind === "dose_response") {
      if (fit) persistLatent(profileId, runId, fit.points); // Bonus: hält auch die latente Fitness frisch
      setProgress(runId, 0.5);
      const start = channelCountFor(profileId);
      const auto = channelAutoFor(profileId);
      const latent = fit ? fit.points : [];
      const designs: Partial<Record<ChannelCount, DesignRow[]>> = {
        5: buildDoseDesign(acts, latent, 5),
        4: buildDoseDesign(acts, latent, 4),
        3: buildDoseDesign(acts, latent, 3),
      };
      const res = estimateDoseResponse(designs, start, { seed: SEED, auto });
      const changepoints = detectChangepoints(latent.map((p) => p.value)).map((k) => latent[k]?.date).filter(Boolean);
      const exploratory = exploratoryScan(designs[res.activeCount as ChannelCount] ?? [], res.mediator.channels); // L6 (nur Hypothesen)

      // Phase B0 (Bayes-Durchstich): beide Achsen an den Sidecar delegieren (PyMC/Conjugate); TS bleibt Fallback.
      // Der Await liegt BEWUSST vor der Transaktion (keine offene SQLite-Transaktion über den async Spawn).
      const design = designs[res.activeCount as ChannelCount] ?? [];
      const bayesMed = await runBayesDose(acts, res.activeCount as ChannelCount, design, "mediator");   // absolute Lasten
      const bayesComp = await runBayesDose(acts, res.activeCount as ChannelCount, design, "composition"); // volumen-bereinigt + Σβ=0
      setProgress(runId, 0.85);
      db.exec("BEGIN");
      try {
        persistEffects(runId, profileId, res.mediator);
        persistEffects(runId, profileId, res.composition);
        // B1: Bayes-Posteriors je Achse in die passenden Zeilen (target). Fallback (null) → TS-Wert der Zeile gilt.
        const upd = db.prepare("UPDATE ml_channel_effects SET posterior_mean=?, hdi_low=?, hdi_high=?, p_positive=?, bayes_engine=?, tau_weeks=?, half_life_weeks=? WHERE run_id=? AND target=? AND channel=?");
        const applyBayes = (target: "mediator" | "composition", result: BayesDoseResult | null) => {
          if (!result?.channels?.length) return;
          for (const c of result.channels) upd.run(c.mean, c.hdi_low, c.hdi_high, c.p_positive, result.method, c.tau_weeks ?? null, c.half_life_weeks ?? null, runId, target, c.channel);
        };
        applyBayes("mediator", bayesMed.result);
        applyBayes("composition", bayesComp.result);
        const meta = {
          activeCount: res.activeCount,
          ladder: res.ladder,
          channels: res.mediator.channels,
          auto,
          start,
          changepoints,
          exploratory,
          verdict: { mediator: res.mediator.verdict, composition: res.composition.verdict },
          bayes: bayesMed.result,        // Mediator-Posteriors je Kanal (inkl. Was-wäre-wenn) — B1 macht Bayes primär
          bayesEngine: bayesMed.engine,  // "python" | "ts"
          bayesCompositionEngine: bayesComp.engine,
        };
        db.prepare("UPDATE ml_runs SET settings_json=?, engine=? WHERE id=?").run(JSON.stringify(meta), bayesMed.engine, runId);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    } else if (kind === "readiness") {
      setProgress(runId, 0.4);
      const daily = loadDailyWellness(profileId);
      const pmc = buildPmc(profileId);
      const latent = fit ? fit.points.map((p) => ({ date: p.date, value: p.value })) : [];
      const today = new Date().toISOString().slice(0, 10);
      const rd = computeReadiness(daily);
      const ath = getProfileSetting("athlete", {} as { height?: number | null; weight?: number | null }, profileId);
      const hf = computeHealthFlags(daily, pmc, latent, today, { heightCm: ath?.height ?? null, fallbackWeightKg: ath?.weight ?? null });
      setProgress(runId, 0.8);
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM ml_readiness WHERE profile_id=?").run(profileId);
        const insR = db.prepare("INSERT INTO ml_readiness(profile_id, date, value, sd) VALUES(?,?,?,?)");
        for (const p of rd.points) insR.run(profileId, p.date, p.value, p.sd);
        db.prepare("DELETE FROM ml_health_flags WHERE profile_id=?").run(profileId);
        const insF = db.prepare("INSERT INTO ml_health_flags(profile_id, date, kind, severity, message, created_at) VALUES(?,?,?,?,?,?)");
        for (const f of hf.flags) insF.run(profileId, f.since, f.kind, f.severity, f.message, nowIso());
        db.prepare("UPDATE ml_runs SET settings_json=? WHERE id=?").run(JSON.stringify({ insufficient: rd.insufficient, nDays: rd.nDays, drivers: rd.drivers, disclaimer: hf.disclaimer, bmi: hf.bmi }), runId);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }

    db.prepare("UPDATE ml_runs SET status='done', progress=1, finished_at=? WHERE id=?").run(nowIso(), runId);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (msg === "__cancelled__") {
      db.prepare("UPDATE ml_runs SET status='cancelled', finished_at=? WHERE id=?").run(nowIso(), runId);
    } else {
      db.prepare("UPDATE ml_runs SET status='failed', error=?, finished_at=? WHERE id=?").run(msg, nowIso(), runId);
    }
  } finally {
    cancelled.delete(runId);
  }
}

export interface Freshness {
  state: "fresh" | "stale" | "none" | "running";
  runId: number | null;
  lastRun: string | null;
  reason?: string;
}
export function freshness(profileId: number, kind: MlKind): Freshness {
  reapStaleRuns(profileId); // Selbstheilung: tote „running"-Läufe schon beim Status-Poll räumen (nicht erst beim nächsten Start)
  const running = db
    .prepare("SELECT id FROM ml_runs WHERE profile_id=? AND kind=? AND status='running' ORDER BY id DESC LIMIT 1")
    .get(profileId, kind) as { id: number } | undefined;
  if (running) return { state: "running", runId: running.id, lastRun: null };
  // „frisch" = es EXISTIERT ein passender abgeschlossener Lauf (Hash + Code-Version) — auch wenn ein neuerer Lauf
  // mit anderen Einstellungen eine höhere ID hat. Sonst nur „veraltet" (letzter Lauf, andere Daten/Einstellungen).
  const match = matchingDoneRun(profileId, kind);
  if (match) return { state: "fresh", runId: match.id, lastRun: match.finished_at };
  const last = latestRun(profileId, kind);
  if (!last || last.status !== "done") return { state: "none", runId: last?.id ?? null, lastRun: last?.finished_at ?? null };
  return { state: "stale", runId: last.id, lastRun: last.finished_at, reason: "neue Daten/Einstellungen seit letzter Berechnung" };
}

export interface LatentPointRow {
  date: string;
  value: number;
  sd: number;
}
export function getLatentFitness(profileId: number): LatentPointRow[] {
  return db.prepare("SELECT date, value, sd FROM ml_latent_fitness WHERE profile_id=? ORDER BY date").all(profileId) as unknown as LatentPointRow[];
}

export interface EffectRow {
  channel: string;
  target: string;
  gain_mean: number | null;
  ci_low: number | null;
  ci_high: number | null;
  n_blocks: number | null;
  collinearity_flag: number;
  mcid_pass: number;
  confidence: string;
  p_boot: number | null;
  q_fdr: number | null;
  e_value: number | null;
  e_value_ci: number | null;
  fdr_survive: number;
  // B1: Bayes-Posterior (null = kein Bayes-Lauf → TS-Effekt gilt)
  posterior_mean: number | null;
  hdi_low: number | null;
  hdi_high: number | null;
  p_positive: number | null;
  bayes_engine: string | null;
  tau_weeks: number | null;        // B2a: gefitteter Zerfall (Wochen)
  half_life_weeks: number | null;  // B2a: Retention/Halbwertszeit (τ·ln2)
}
export interface EffectsResult {
  runId: number | null;
  finishedAt: string | null;
  meta: unknown;
  mediator: EffectRow[];
  composition: EffectRow[];
}
export function getEffects(profileId: number): EffectsResult {
  // Den zum aktuellen Input-Hash passenden Lauf bevorzugen (sonst zeigt die Karte nach einem Kanal-Wechsel den
  // falschen, wiederverwendeten Lauf mit höherer ID). Kein Treffer → letzter Lauf (wird dann als „veraltet" markiert).
  const run = matchingDoneRun(profileId, "dose_response") ?? latestRun(profileId, "dose_response");
  if (!run || run.status !== "done") return { runId: run?.id ?? null, finishedAt: null, meta: null, mediator: [], composition: [] };
  const rows = db
    .prepare("SELECT channel, target, gain_mean, ci_low, ci_high, n_blocks, collinearity_flag, mcid_pass, confidence, p_boot, q_fdr, e_value, e_value_ci, fdr_survive, posterior_mean, hdi_low, hdi_high, p_positive, bayes_engine, tau_weeks, half_life_weeks FROM ml_channel_effects WHERE run_id=?")
    .all(run.id) as unknown as EffectRow[];
  let meta: unknown = null;
  try {
    meta = run.settings_json ? JSON.parse(run.settings_json) : null;
  } catch {
    meta = null;
  }
  return {
    runId: run.id,
    finishedAt: run.finished_at,
    meta,
    mediator: rows.filter((r) => r.target === "mediator"),
    composition: rows.filter((r) => r.target === "composition"),
  };
}

// Baustein 2.3: Wettkampf-Fitness-Prognose des GEPLANTEN Blocks per Impulse-Response-Faltung — die geplanten
// Wochen-Kanal-Lasten werden mit den bereits gefitteten Kernels gefaltet (β=posterior_mean/gain_mean, τ=tau_weeks):
//   irFitness(t) = Σ_c β_c · Σ_{w≤t} load_c(w)·exp(−(t−w)/τ_c).  Reine TS, kein Sidecar. [] wenn kein Signal.
export function blockIrFitness(
  weeks: { days: { type: string; planned_tss: number }[] }[],
  mediator: EffectRow[],
  count: number,
): number[] {
  const cc = (count === 3 || count === 4 || count === 5 ? count : 5) as ChannelCount;
  const beta: Record<string, number> = {};
  const tau: Record<string, number> = {};
  for (const e of mediator) {
    beta[e.channel] = e.posterior_mean ?? e.gain_mean ?? 0;
    tau[e.channel] = e.tau_weeks && e.tau_weeks > 0 ? e.tau_weeks : 6; // Default τ0 = 6 Wo (B2a-Fixskala)
  }
  const channels = Object.keys(beta);
  if (!channels.length) return [];
  // geplanter Tag-Typ → Kanal; Fallback für Long/Renntempo/Race, die bei 5-Kanal kein Typ-Override haben.
  const dayCh = (type: string): string | null => {
    const ov = typeOverrideChannel(type, cc);
    if (ov) return ov;
    const t = type.toLowerCase();
    if (/long/.test(t)) return cc === 5 ? "E" : cc === 3 ? "aerob" : "Long";
    if (/renntempo|race/.test(t)) return cc === 5 ? "T" : cc === 3 ? "threshold" : "Schwelle";
    return null; // Kraft/Ruhe → kein Ausdauer-Reiz
  };
  const loads = weeks.map((w) => {
    const rec: Record<string, number> = {};
    for (const d of w.days) {
      const ch = dayCh(d.type);
      if (!ch || !(ch in beta) || !d.planned_tss) continue;
      rec[ch] = (rec[ch] ?? 0) + d.planned_tss;
    }
    return rec;
  });
  const out: number[] = [];
  for (let t = 0; t < weeks.length; t++) {
    let f = 0;
    for (const ch of channels) {
      let acc = 0;
      for (let w = 0; w <= t; w++) { const l = loads[w][ch]; if (l) acc += l * Math.exp(-(t - w) / tau[ch]); }
      f += beta[ch] * acc;
    }
    out.push(f);
  }
  return out.some((v) => v !== 0) ? out : [];
}

export type AuditStatus = "pass" | "warn" | "fail" | "info";
export interface AuditCheck {
  key: string;
  label: string;
  status: AuditStatus;
  message: string;
  detail?: string;
  evidence?: Record<string, unknown>;
}
export interface AdversarialAuditResult {
  generatedAt: string;
  modelVersion: string;
  runId: number | null;
  activeCount: number | null;
  designWeeks: number;
  summary: { status: AuditStatus; pass: number; warn: number; fail: number; info: number };
  checks: AuditCheck[];
}

interface DoseMetaForAudit {
  activeCount?: number;
  ladder?: { count: number; identifiable: boolean; reason: string; maxVif: number; sparseChannels?: string[] }[];
  channels?: string[];
  changepoints?: string[];
}

function auditSummary(checks: AuditCheck[]): AdversarialAuditResult["summary"] {
  const count = (s: AuditStatus) => checks.filter((c) => c.status === s).length;
  const fail = count("fail"), warn = count("warn"), pass = count("pass"), info = count("info");
  return { status: fail ? "fail" : warn ? "warn" : "pass", pass, warn, fail, info };
}
function finiteSign(v: number | null | undefined): -1 | 0 | 1 {
  if (v == null || !Number.isFinite(v) || Math.abs(v) < 0.05) return 0;
  return v > 0 ? 1 : -1;
}

export function adversarialAudit(profileId: number): AdversarialAuditResult {
  const generatedAt = nowIso();
  const effects = getEffects(profileId);
  const meta = (effects.meta ?? {}) as DoseMetaForAudit;
  const fr = freshness(profileId, "dose_response");
  const checks: AuditCheck[] = [];
  const activeCount = (meta.activeCount === 3 || meta.activeCount === 4 || meta.activeCount === 5)
    ? (meta.activeCount as ChannelCount)
    : channelCountFor(profileId);

  let designWeeks = 0;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  try {
    const { acts, inds } = loadIndicators(profileId);
    const fit = fitLatentFitness(inds);
    const design = fit ? buildDoseDesign(acts, fit.points, activeCount) : [];
    designWeeks = design.length;
    firstDate = design[0]?.date ?? null;
    lastDate = design[design.length - 1]?.date ?? null;
    const dates = design.map((d) => d.date);
    const sorted = dates.every((d, i) => i === 0 || dates[i - 1] <= d);
    const unique = new Set(dates).size === dates.length;
    checks.push({
      key: "cv_leakage",
      label: "CV-Leakage und Zeitordnung",
      status: !sorted || !unique ? "fail" : designWeeks < 24 ? "warn" : "pass",
      message: !sorted || !unique
        ? "Design-Wochen sind nicht eindeutig zeitlich sortiert."
        : designWeeks < 24
          ? `Nur ${designWeeks} Design-Wochen. Die Engine nutzt rolling-origin CV, aber die Basis ist noch dünn.`
          : `Zeitlich sortiertes Weekly-Design mit ${designWeeks} Wochen; Lambda-CV läuft als expanding-window/rolling-origin.`,
      detail: firstDate && lastDate ? `${firstDate} bis ${lastDate}` : undefined,
      evidence: { designWeeks, firstDate, lastDate, sorted, unique },
    });
  } catch (e) {
    checks.push({ key: "cv_leakage", label: "CV-Leakage und Zeitordnung", status: "fail", message: "Design konnte nicht rekonstruiert werden.", detail: String((e as Error)?.message || e) });
  }

  if (!effects.runId || !effects.mediator.length) {
    checks.push({ key: "run_available", label: "Dosis-Wirkungs-Lauf", status: "fail", message: "Noch kein abgeschlossener Dosis-Wirkungs-Lauf vorhanden. Erst neu berechnen, dann auditieren." });
  } else {
    checks.push({
      key: "freshness",
      label: "Frische",
      status: fr.state === "fresh" ? "pass" : fr.state === "stale" ? "warn" : "info",
      message: fr.state === "fresh" ? "Der Audit prüft den aktuell frischen Lauf." : fr.reason ?? `Status: ${fr.state}`,
      evidence: { state: fr.state, runId: fr.runId, lastRun: fr.lastRun },
    });
  }

  const activeStep = meta.ladder?.find((s) => s.count === activeCount) ?? meta.ladder?.at(-1);
  checks.push({
    key: "identifiability",
    label: "Identifizierbarkeit",
    status: activeStep?.identifiable ? "pass" : "warn",
    message: activeStep?.identifiable
      ? `${activeCount} Kanäle sind trennbar (max. VIF ${activeStep.maxVif}).`
      : `Aktiver Kanal-Satz bleibt fragil: ${activeStep?.reason ?? "keine Leiterdiagnostik"}.`,
    evidence: { activeCount, maxVif: activeStep?.maxVif ?? null, sparseChannels: activeStep?.sparseChannels ?? [] },
  });

  const robustRows = [...effects.mediator, ...effects.composition].filter((r) => r.fdr_survive && r.mcid_pass);
  const anyFdr = [...effects.mediator, ...effects.composition].some((r) => r.fdr_survive);
  const nBlocks = Math.max(0, ...effects.mediator.map((r) => Number(r.n_blocks) || 0));
  checks.push({
    key: "priors_shrinkage",
    label: "Priors, Shrinkage und FDR",
    status: robustRows.length ? "pass" : anyFdr ? "warn" : "info",
    message: robustRows.length
      ? `${robustRows.length} Effekt(e) überstehen MCID und FDR.`
      : anyFdr
        ? "Mindestens ein Effekt übersteht FDR, aber nicht gleichzeitig das MCID-Gate."
        : "Kein Kanal übersteht aktuell FDR plus MCID. Als Hypothese lesen, nicht als Steuerregel.",
    evidence: { robustEffects: robustRows.length, anyFdr, nBlocks },
  });

  const medByChannel = new Map(effects.mediator.map((r) => [r.channel, r]));
  const comparable = effects.composition
    .map((r) => ({ channel: r.channel, mediator: medByChannel.get(r.channel), composition: r }))
    .filter((p) => p.mediator);
  const flips = comparable.filter((p) => {
    const a = finiteSign(p.mediator?.gain_mean);
    const b = finiteSign(p.composition.gain_mean);
    return a !== 0 && b !== 0 && a !== b;
  });
  checks.push({
    key: "sign_stability",
    label: "Vorzeichen-Stabilität",
    status: flips.length ? "warn" : comparable.length ? "pass" : "info",
    message: flips.length
      ? `${flips.length} Kanal/Kanäle kippen zwischen absoluter und volumen-bereinigter Sicht.`
      : comparable.length
        ? "Absolut und volumen-bereinigt widersprechen sich in der Richtung nicht."
        : "Keine vergleichbaren Effekte vorhanden.",
    evidence: { flips: flips.map((f) => f.channel), comparable: comparable.length },
  });

  const rangeFilter = firstDate && lastDate ? "AND date BETWEEN ? AND ?" : "";
  const params = firstDate && lastDate ? [profileId, firstDate, lastDate] : [profileId];
  const sick = db.prepare(`SELECT COUNT(*) n FROM daily_log_v2 WHERE profile_id=? AND COALESCE(sick,0)<>0 ${rangeFilter}`).get(...params) as { n: number };
  const highFlags = db.prepare(`SELECT COUNT(*) n FROM ml_health_flags WHERE profile_id=? AND severity='high' ${rangeFilter}`).get(...params) as { n: number };
  const warnFlags = db.prepare(`SELECT COUNT(*) n FROM ml_health_flags WHERE profile_id=? AND severity='warn' ${rangeFilter}`).get(...params) as { n: number };
  const changepoints = meta.changepoints ?? [];
  const confounderStatus: AuditStatus = highFlags.n > 0 || sick.n >= 5 ? "warn" : "pass";
  checks.push({
    key: "confounders",
    label: "Confounder-Sensitivität",
    status: confounderStatus,
    message: confounderStatus === "warn"
      ? `Gesundheits-/Krankheitsfenster liegen im Modellbereich (${sick.n} krank, ${highFlags.n} high flags).`
      : "Keine starken Gesundheits-Confounder im geprüften Modellfenster gefunden.",
    detail: changepoints.length ? `${changepoints.length} Strukturbruch/Strukturbrüche erkannt.` : undefined,
    evidence: { sickDays: sick.n, highFlags: highFlags.n, warnFlags: warnFlags.n, changepoints },
  });

  return {
    generatedAt,
    modelVersion: MODEL_VERSION,
    runId: effects.runId,
    activeCount,
    designWeeks,
    summary: auditSummary(checks),
    checks,
  };
}

export interface ReadinessPointRow { date: string; value: number; sd: number; }
export interface HealthFlagRow { date: string; kind: string; severity: string; message: string; }
export interface ReadinessResult2 {
  runId: number | null;
  finishedAt: string | null;
  meta: { insufficient?: boolean; nDays?: number; drivers?: string[]; disclaimer?: string } | null;
  points: ReadinessPointRow[];
  flags: HealthFlagRow[];
}
export function getReadinessResult(profileId: number): ReadinessResult2 {
  const run = latestRun(profileId, "readiness");
  let meta: ReadinessResult2["meta"] = null;
  try {
    meta = run?.settings_json ? JSON.parse(run.settings_json) : null;
  } catch {
    meta = null;
  }
  const points = db.prepare("SELECT date, value, sd FROM ml_readiness WHERE profile_id=? ORDER BY date").all(profileId) as unknown as ReadinessPointRow[];
  const flags = db
    .prepare("SELECT date, kind, severity, message FROM ml_health_flags WHERE profile_id=? ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, date DESC")
    .all(profileId) as unknown as HealthFlagRow[];
  return { runId: run?.id ?? null, finishedAt: run?.finished_at ?? null, meta, points, flags };
}

// ============================================================================
// P5 — Prospektiv randomisierte N-of-1-Blöcke (L5): der EINZIGE kausale Pfad.
// Empfehler (deterministisch, information-greedy) + counterbalanced AB/BA-Lebenszyklus.
// Outcome = Δ latente Fitness am Lag; Inferenz im Kern (prospective.ts).
// ============================================================================
const COOLDOWN_KEY = "prospective_cooldown"; // ISO-Datum, bis zu dem nach Ablehnung kein Vorschlag erscheint
const DEFAULT_MCID = 1.0; // VO2-äquivalente Einheit der latenten Fitness (bis MARKER-verankert: Default)
const PAIRS_FOR_SIGNIF = Math.ceil(Math.log2(2 / 0.05)); // kleinstes P mit 2/2^P ≤ 0.05 → 6

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export interface ProspectiveArm { kind: "channel" | "regime"; value: string; label: string }
export interface ProspectiveProposal {
  kind: "channel" | "regime";
  armA: ProspectiveArm;
  armB: ProspectiveArm;
  rationale: string;
  overlap: number | null;
  source: "effects" | "default";
  proposalHash: string;
  score: number;
  rankLabel: string;
  durationWeeks: number;
  risk: "niedrig" | "mittel" | "hoch";
  scores: { data: number; benefit: number; duration: number; risk: number; explainability: number };
  defaults: { nPairsPlanned: number; blockWeeks: number; washoutWeeks: number; lagWeeks: number; mcid: number; alpha: number; pairsForSignif: number };
}

const DEFAULT_PROPOSAL_DEFAULTS = { nPairsPlanned: PAIRS_FOR_SIGNIF, blockWeeks: 4, washoutWeeks: 1, lagWeeks: 3, mcid: DEFAULT_MCID, alpha: 0.05, pairsForSignif: PAIRS_FOR_SIGNIF };
// Kanal-Vokabular (siehe featureBackbone TYPE_CHANNEL_MAP / prospective CH_LABEL). HART = ≥ Schwellen-Intensität
// (Verletzungs-/Überlastungsrisiko); Marathon-Pace, aerob, Easy und Long zählen bewusst NICHT als hart.
const HARD_CHANNELS = new Set(["VO2", "I", "vo2", "Schwelle", "T", "threshold", "R"]);
const KNOWN_CHANNELS = new Set(["VO2", "I", "vo2", "Schwelle", "T", "threshold", "R", "aerob", "E", "Easy", "M", "Marathon", "Long"]);
const DEFAULT_ARMS: [ProspectiveArm, ProspectiveArm][] = [
  [{ kind: "channel", value: "Schwelle", label: "Schwelle" }, { kind: "channel", value: "VO2", label: "VO2max" }],
  [{ kind: "channel", value: "aerob", label: "Aerob" }, { kind: "channel", value: "Schwelle", label: "Schwelle" }],
  [{ kind: "channel", value: "VO2", label: "VO2max" }, { kind: "channel", value: "aerob", label: "Aerob" }],
  [{ kind: "channel", value: "Marathon", label: "Marathon-Pace" }, { kind: "channel", value: "Schwelle", label: "Schwelle" }],
];

export function buildProposal(
  profileId: number,
  armA: ProspectiveArm,
  armB: ProspectiveArm,
  input: { source: "effects" | "default"; rationale: string; overlap: number | null; ordinal: number },
): ProspectiveProposal {
  const defaults = DEFAULT_PROPOSAL_DEFAULTS;
  const durationWeeks = defaults.nPairsPlanned * 2 * (defaults.blockWeeks + defaults.washoutWeeks);
  // Anzahl physiologisch HARTER Arme (≥ Schwelle) — treibt Risiko. Explizites Set statt Substring-Match:
  // der frühere /VO2|Schwelle|threshold|I|T/i matchte über die Einzelbuchstaben „I"/„T" JEDES Wort mit i/t
  // (z.B. „Marathon" → „t") und zählte Marathon-Pace fälschlich als hartes Intervall (ist ~84% VO2max, moderat).
  const hard = [armA.value, armB.value].filter((v) => HARD_CHANNELS.has(v)).length;
  // Datenlage: wie stark ist der Kontrast in EIGENEN Daten verankert (dose-response-Effekte) vs. generischer Default.
  const data = input.source === "effects" ? 30 : Math.max(10, 20 - input.ordinal * 3);
  // Nutzen = Value-of-Information: am größten, wo die Beobachtungsdaten am unklarsten sind (CI-Überlappung).
  // Ohne Overlap-Signal (Defaults) ist der klassische Steuerungs-Fork (ordinal 0) am nützlichsten.
  const infoGain = input.overlap != null ? Math.round(16 * input.overlap) : (input.ordinal === 0 ? 8 : 4);
  const benefit = Math.min(28, 12 + infoGain);
  const duration = durationWeeks <= 40 ? 16 : durationWeeks <= 60 ? 12 : 8;
  const risk = hard >= 2 ? 11 : hard === 1 ? 14 : 16;
  const explainability = [armA.value, armB.value].every((v) => KNOWN_CHANNELS.has(v)) ? 16 : 12;
  const score = Math.max(0, Math.min(100, data + benefit + duration + risk + explainability));
  const proposalHash = "p" + fnv(`${profileId}|${armA.kind}:${armA.value}|${armB.value}|${defaults.mcid}|${defaults.alpha}|${input.ordinal}`).toString(16);
  const riskLabel: ProspectiveProposal["risk"] = hard >= 2 ? "mittel" : "niedrig";
  const rankLabel = score >= 80 ? "sehr guter Trial-Kandidat" : score >= 65 ? "guter Trial-Kandidat" : "beobachten";
  return {
    kind: armA.kind,
    armA,
    armB,
    rationale: input.rationale,
    overlap: input.overlap,
    source: input.source,
    proposalHash,
    score,
    rankLabel,
    durationWeeks,
    risk: riskLabel,
    scores: { data, benefit, duration, risk, explainability },
    defaults,
  };
}

/** Empfehler: sortiert mehrere Trial-Kandidaten nach Datenlage, Nutzen, Dauer, Risiko und Erklärbarkeit. */
export function proposeProspectiveTrials(profileId: number): ProspectiveProposal[] {
  const run = latestRun(profileId, "dose_response");
  let contrast = null;
  if (run && run.status === "done") {
    const effects = db
      .prepare("SELECT channel, gain_mean, ci_low, ci_high FROM ml_channel_effects WHERE run_id=? AND target='mediator'")
      .all(run.id) as { channel: string; gain_mean: number | null; ci_low: number | null; ci_high: number | null }[];
    contrast = proposeChannelContrast(effects);
  }
  const out: ProspectiveProposal[] = [];
  if (contrast) {
    out.push(buildProposal(profileId, contrast.armA, contrast.armB, { source: "effects", rationale: contrast.rationale, overlap: contrast.overlap, ordinal: 0 }));
  }
  DEFAULT_ARMS.forEach(([armA, armB], i) => {
    const rationale = i === 0
      ? "Default-Kontrast Schwelle vs VO2max — der klassische Steuerungs-Fork, solange noch keine belastbaren Kanal-Effekte vorliegen."
      : "Alternativer Forschungs-Kontrast für einen späteren Block: plausibel steuerbar, gut erklärbar und mit der vorhandenen Planung abbildbar.";
    out.push(buildProposal(profileId, armA, armB, { source: "default", rationale, overlap: null, ordinal: i + (contrast ? 1 : 0) }));
  });
  const seen = new Set<string>();
  return out
    .filter((p) => {
      const key = [p.armA.value, p.armB.value].sort().join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score);
}

/** Rückwärtskompatibler Einzelvorschlag: erster Kandidat der Ranking-Liste. */
export function proposeProspectiveTrial(profileId: number): ProspectiveProposal {
  return proposeProspectiveTrials(profileId)[0];
}

export interface ProspectiveTrialRow {
  id: number;
  profile_id: number;
  state: string | null;
  trial_kind: string | null;
  arm_a: string | null; arm_b: string | null; arm_a_label: string | null; arm_b_label: string | null;
  start_date: string; end_date: string | null;
  seed: number | null;
  n_pairs_planned: number | null; n_pairs_done: number | null;
  verdict: string | null; theta: number | null; p_exact: number | null;
  lag_weeks: number | null; washout: number | null;
  consented_at: string | null; proposal_hash: string | null;
  config_json: string | null; blocks_json: string | null;
  label: string | null; notes: string | null; created_at: string;
}
const TRIAL_COLS =
  "id, profile_id, state, trial_kind, arm_a, arm_b, arm_a_label, arm_b_label, start_date, end_date, seed, n_pairs_planned, n_pairs_done, verdict, theta, p_exact, lag_weeks, washout, consented_at, proposal_hash, config_json, blocks_json, label, notes, created_at";

export function getProspectiveTrials(profileId: number): ProspectiveTrialRow[] {
  return db
    .prepare(`SELECT ${TRIAL_COLS} FROM method_experiments WHERE profile_id=? AND randomized=1 AND state IS NOT NULL ORDER BY id DESC`)
    .all(profileId) as unknown as ProspectiveTrialRow[];
}
function getTrial(trialId: number): ProspectiveTrialRow | null {
  return (db.prepare(`SELECT ${TRIAL_COLS} FROM method_experiments WHERE id=? AND randomized=1`).get(trialId) as unknown as ProspectiveTrialRow) ?? null;
}
/** Öffentlicher Getter für die Auto-Plan-Generierung (Route lebt in index.ts mit dem Plan-Kontext). */
export function getProspectiveTrialById(trialId: number): ProspectiveTrialRow | null {
  return getTrial(trialId);
}

export interface CreateTrialInput {
  kind: "channel" | "regime";
  armA: { value: string; label: string };
  armB: { value: string; label: string };
  nPairsPlanned: number;
  blockWeeks?: number; washoutWeeks?: number; lagWeeks?: number;
  mcid?: number; alpha?: number; overrideMode?: string;
  startDate?: string;
  consentedAt: string; proposalHash: string;
}

/** Annahme: Seed fixieren + counterbalanced Schedule bauen + aktive Trial-Zeile schreiben. */
export function createProspectiveTrial(profileId: number, input: CreateTrialInput): { id: number } {
  const nPairs = Math.max(1, Math.min(12, Math.floor(input.nPairsPlanned || PAIRS_FOR_SIGNIF)));
  const blockWeeks = input.blockWeeks ?? 4;
  const washoutWeeks = input.washoutWeeks ?? 1;
  const lagWeeks = input.lagWeeks ?? 3;
  const mcid = input.mcid ?? DEFAULT_MCID;
  const alpha = input.alpha ?? 0.05;
  const overrideMode = input.overrideMode ?? "pause_substitute_extend";
  const startDate = input.startDate ?? nowIso().slice(0, 10);
  const seed = fnv(`${input.proposalHash}|${input.consentedAt}|${nPairs}`) & 0x7fffffff; // reproduzierbar, gespeichert
  const pairOrders = randomizePairOrders(nPairs, seed);
  const blocks = buildBlockSchedule(input.armA.value, input.armB.value, pairOrders, startDate, blockWeeks, washoutWeeks);
  const endDate = blocks.length ? blocks[blocks.length - 1].endDate : startDate;
  const label = `${input.armA.label} vs ${input.armB.label}`;
  const config = { alpha, mcid, mcid_source: "default", block_weeks: blockWeeks, washout_weeks: washoutWeeks, override_mode: overrideMode, primary_outcome: "latent_fitness" };
  const info = db
    .prepare(
      `INSERT INTO method_experiments(profile_id, start_date, end_date, method, label, emphasis_label, washout, primary_outcome, lag_weeks, randomized, state, trial_kind, arm_a, arm_b, arm_a_label, arm_b_label, seed, n_pairs_planned, n_pairs_done, consented_at, proposal_hash, config_json, blocks_json, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      profileId, startDate, endDate, "prospective", label, label, washoutWeeks, "latent_fitness", lagWeeks, 1,
      "active", input.kind, input.armA.value, input.armB.value, input.armA.label, input.armB.label,
      seed, nPairs, 0, input.consentedAt, input.proposalHash, JSON.stringify(config), JSON.stringify(blocks), nowIso(),
    );
  setProfileSetting(COOLDOWN_KEY, null, profileId); // Annahme hebt einen evtl. Cooldown auf
  const id = Number(info.lastInsertRowid);
  evaluateProspectiveTrial(id); // sofort (i.d.R. noch nichts fällig — setzt nur n_pairs_done=0/insufficient)
  return { id };
}

/** Outcomes je Block am Lag + Health-Override-Ausschluss → exakter Permutationstest → persistieren. */
export function evaluateProspectiveTrial(trialId: number): ProspectiveTrialRow | null {
  const row = getTrial(trialId);
  if (!row || !row.blocks_json || row.state === "archived" || row.state === "aborted_health") return row;
  let blocks: Block[];
  try { blocks = JSON.parse(row.blocks_json) as Block[]; } catch { return row; }
  let config: { alpha?: number; mcid?: number } = {};
  try { config = row.config_json ? JSON.parse(row.config_json) : {}; } catch { config = {}; }
  const lagWeeks = row.lag_weeks ?? 3;
  const latent = getLatentFitness(row.profile_id).map((p) => ({ date: p.date, value: p.value, sd: p.sd }));
  const highFlags = db.prepare("SELECT date FROM ml_health_flags WHERE profile_id=? AND severity='high'").all(row.profile_id) as { date: string }[];
  const todayMs = Date.parse(nowIso().slice(0, 10));
  for (const b of blocks) {
    const o = blockOutcome(b, latent, lagWeeks);
    b.outcome = o ? o.value : null;
    b.outcomeSd = o ? o.sd : null;
    if (highFlags.some((f) => f.date >= b.startDate && f.date <= b.endDate)) b.excluded = true; // korrumpiertes Block-Fenster
  }
  const result = evaluateTrial(blocks, row.arm_a ?? "", { mcid: config.mcid ?? DEFAULT_MCID, alpha: config.alpha ?? 0.05 });
  const allDue = blocks.every((b) => Date.parse(b.endDate) + lagWeeks * 7 * 86_400_000 <= todayMs);
  const state = allDue ? "evaluated" : (row.state ?? "active");
  db.prepare("UPDATE method_experiments SET blocks_json=?, verdict=?, theta=?, p_exact=?, n_pairs_done=?, state=? WHERE id=?")
    .run(JSON.stringify(blocks), result.verdict, result.theta, result.pExact, result.nPairs, state, trialId);
  return getTrial(trialId);
}

/** Datum-getrieben (kein Cron): re-evaluiert aktive Trials, sobald ein fälliges Block-Outcome noch fehlt. */
export function tickProspectiveBlocks(profileId: number): void {
  const active = db
    .prepare("SELECT id, blocks_json, lag_weeks FROM method_experiments WHERE profile_id=? AND randomized=1 AND state='active'")
    .all(profileId) as { id: number; blocks_json: string | null; lag_weeks: number | null }[];
  const todayMs = Date.parse(nowIso().slice(0, 10));
  for (const t of active) {
    if (!t.blocks_json) continue;
    let blocks: Block[];
    try { blocks = JSON.parse(t.blocks_json); } catch { continue; }
    const lagMs = (t.lag_weeks ?? 3) * 7 * 86_400_000;
    const due = blocks.some((b) => b.outcome == null && !b.excluded && Date.parse(b.endDate) + lagMs <= todayMs);
    if (due) evaluateProspectiveTrial(t.id);
  }
}

export function abortProspectiveTrial(profileId: number, trialId: number, reason: "user" | "health"): { ok: boolean; removedSessions: number } {
  db.prepare("UPDATE method_experiments SET state=? WHERE id=? AND profile_id=? AND randomized=1")
    .run(reason === "health" ? "aborted_health" : "archived", trialId, profileId);
  // DB-sicher: NUR die getaggten Auto-Plan-Zeilen dieses Trials löschen — manuelle Einheiten bleiben unberührt.
  const removed = db.prepare("DELETE FROM planned_sessions WHERE experiment_id=? AND profile_id=?").run(trialId, profileId).changes ?? 0;
  return { ok: true, removedSessions: Number(removed) };
}

export function declineProspectiveTrial(profileId: number, weeks = 4): { ok: boolean } {
  const until = new Date(Date.now() + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
  setProfileSetting(COOLDOWN_KEY, until, profileId);
  return { ok: true };
}
/** Hebt einen (evtl. versehentlichen) Ablehnungs-Cooldown wieder auf → Vorschläge erscheinen sofort wieder. */
export function clearProspectiveCooldown(profileId: number): { ok: boolean } {
  setProfileSetting(COOLDOWN_KEY, null, profileId);
  return { ok: true };
}

export interface ProspectiveState { trials: ProspectiveTrialRow[]; proposal: ProspectiveProposal | null; proposals: ProspectiveProposal[] }
/** Liefert Trials + (falls kein aktiver Trial & kein Cooldown) einen frischen Vorschlag. Tickt vorher Outcomes. */
export function getProspectiveState(profileId: number): ProspectiveState {
  tickProspectiveBlocks(profileId);
  const trials = getProspectiveTrials(profileId);
  const hasOpen = trials.some((t) => t.state === "active" || t.state === "accepted");
  const cooldownUntil = getProfileSetting<string | null>(COOLDOWN_KEY, null, profileId);
  const onCooldown = cooldownUntil != null && cooldownUntil >= nowIso().slice(0, 10);
  const proposals = hasOpen || onCooldown ? [] : proposeProspectiveTrials(profileId);
  return { trials, proposal: proposals[0] ?? null, proposals };
}
