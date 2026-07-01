// ML-Job-Orchestrator: führt Engine-Läufe ausserhalb des Request-Threads aus (nicht-blockierend via
// setImmediate), schreibt den ml_runs-Lebenszyklus (running→done/failed/cancelled) + Fortschritt,
// persistiert Ergebnisse atomar und liefert Frische/Veraltet-Status. Zwei Läufe: latente Fitness (L2) und
// Dosis-Wirkung (L3). Leichte TS-Compute in-process; schwere Bayes-Läufe delegieren später an den Sidecar.
import { db, getProfileSetting, setProfileSetting } from "./db.ts";
import {
  buildTargetIndicators,
  weeklyChannelCtl,
  inputHash,
  type ActivityLite,
  type RaceLite,
  type LabLite,
  type ChannelCount,
} from "./ml/featureBackbone.ts";
import { fitLatentFitness, type LatentPoint } from "./ml/latentFitness.ts";
import { estimateDoseResponse, type DesignRow, type DoseModelResult } from "./ml/doseResponse.ts";
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
const MODEL_VERSION = "0.3.2"; // L4 + L6 + P4 (Readiness/Health/BMI) — Bump invalidiert ältere Läufe
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
export function cancelRun(runId: number): void {
  cancelled.add(runId);
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

export function startRun(kind: MlKind, profileId: number): { runId: number; reused?: boolean } {
  const hash = runHash(kind, profileId);
  const done = db
    .prepare("SELECT id FROM ml_runs WHERE profile_id=? AND kind=? AND status='done' AND input_hash=? AND model_version=? ORDER BY id DESC LIMIT 1")
    .get(profileId, kind, hash, MODEL_VERSION) as { id: number } | undefined;
  if (done) return { runId: done.id, reused: true }; // code-versions-bewusst: alte Läufe werden nicht wiederverwendet

  const info = db
    .prepare("INSERT INTO ml_runs(profile_id, kind, status, engine, model_version, seed, input_hash, progress, started_at, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(profileId, kind, "running", "ts", MODEL_VERSION, SEED, hash, 0, nowIso(), nowIso());
  const runId = Number(info.lastInsertRowid);
  setImmediate(() => runJob(runId, kind, profileId));
  return { runId };
}

function runJob(runId: number, kind: MlKind, profileId: number): void {
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
      setProgress(runId, 0.85);
      db.exec("BEGIN");
      try {
        persistEffects(runId, profileId, res.mediator);
        persistEffects(runId, profileId, res.composition);
        const meta = {
          activeCount: res.activeCount,
          ladder: res.ladder,
          channels: res.mediator.channels,
          auto,
          start,
          changepoints,
          exploratory,
          verdict: { mediator: res.mediator.verdict, composition: res.composition.verdict },
        };
        db.prepare("UPDATE ml_runs SET settings_json=? WHERE id=?").run(JSON.stringify(meta), runId);
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
  const running = db
    .prepare("SELECT id FROM ml_runs WHERE profile_id=? AND kind=? AND status='running' ORDER BY id DESC LIMIT 1")
    .get(profileId, kind) as { id: number } | undefined;
  if (running) return { state: "running", runId: running.id, lastRun: null };
  const last = latestRun(profileId, kind);
  if (!last || last.status !== "done") return { state: "none", runId: last?.id ?? null, lastRun: last?.finished_at ?? null };
  if (runHash(kind, profileId) !== last.input_hash) {
    return { state: "stale", runId: last.id, lastRun: last.finished_at, reason: "neue Daten seit letzter Berechnung" };
  }
  return { state: "fresh", runId: last.id, lastRun: last.finished_at };
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
}
export interface EffectsResult {
  runId: number | null;
  finishedAt: string | null;
  meta: unknown;
  mediator: EffectRow[];
  composition: EffectRow[];
}
export function getEffects(profileId: number): EffectsResult {
  const run = latestRun(profileId, "dose_response");
  if (!run || run.status !== "done") return { runId: run?.id ?? null, finishedAt: null, meta: null, mediator: [], composition: [] };
  const rows = db
    .prepare("SELECT channel, target, gain_mean, ci_low, ci_high, n_blocks, collinearity_flag, mcid_pass, confidence, p_boot, q_fdr, e_value, e_value_ci, fdr_survive FROM ml_channel_effects WHERE run_id=?")
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
  defaults: { nPairsPlanned: number; blockWeeks: number; washoutWeeks: number; lagWeeks: number; mcid: number; alpha: number; pairsForSignif: number };
}

/** Empfehler: aus den L3-Mediator-Effekten den unklarsten Kontrast; Fallback Default Schwelle vs VO2max. */
export function proposeProspectiveTrial(profileId: number): ProspectiveProposal {
  const run = latestRun(profileId, "dose_response");
  let contrast = null;
  if (run && run.status === "done") {
    const effects = db
      .prepare("SELECT channel, gain_mean, ci_low, ci_high FROM ml_channel_effects WHERE run_id=? AND target='mediator'")
      .all(run.id) as { channel: string; gain_mean: number | null; ci_low: number | null; ci_high: number | null }[];
    contrast = proposeChannelContrast(effects);
  }
  const armA: ProspectiveArm = contrast ? contrast.armA : { kind: "channel", value: "Schwelle", label: "Schwelle" };
  const armB: ProspectiveArm = contrast ? contrast.armB : { kind: "channel", value: "VO2", label: "VO2max" };
  const rationale = contrast
    ? contrast.rationale
    : "Default-Kontrast Schwelle vs VO2max — der klassische Steuerungs-Fork, solange noch keine belastbaren Kanal-Effekte vorliegen.";
  const defaults = { nPairsPlanned: PAIRS_FOR_SIGNIF, blockWeeks: 4, washoutWeeks: 1, lagWeeks: 3, mcid: DEFAULT_MCID, alpha: 0.05, pairsForSignif: PAIRS_FOR_SIGNIF };
  const proposalHash = "p" + fnv(`${profileId}|${armA.kind}:${armA.value}|${armB.value}|${defaults.mcid}|${defaults.alpha}`).toString(16);
  return { kind: armA.kind, armA, armB, rationale, overlap: contrast ? contrast.overlap : null, source: contrast ? "effects" : "default", proposalHash, defaults };
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

export interface ProspectiveState { trials: ProspectiveTrialRow[]; proposal: ProspectiveProposal | null }
/** Liefert Trials + (falls kein aktiver Trial & kein Cooldown) einen frischen Vorschlag. Tickt vorher Outcomes. */
export function getProspectiveState(profileId: number): ProspectiveState {
  tickProspectiveBlocks(profileId);
  const trials = getProspectiveTrials(profileId);
  const hasOpen = trials.some((t) => t.state === "active" || t.state === "accepted");
  const cooldownUntil = getProfileSetting<string | null>(COOLDOWN_KEY, null, profileId);
  const onCooldown = cooldownUntil != null && cooldownUntil >= nowIso().slice(0, 10);
  return { trials, proposal: hasOpen || onCooldown ? null : proposeProspectiveTrial(profileId) };
}
