import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("Tutorial: Isabel regenerates idempotently with raw ML-ready demo data", async () => {
  const oldDb = process.env.RUNLOG_DB;
  const dir = mkdtempSync(join(tmpdir(), "runlog-isabel-"));
  process.env.RUNLOG_DB = join(dir, "training.db");
  const today = new Date().toISOString().slice(0, 10);

  const { initSchema, db, getProfileSetting } = await import("../server/db.ts");
  const { regenerateTutorial, tutorialProfileId } = await import("../server/tutorial.ts");
  const { computeCyclePhase, gateCycleAdaptive } = await import("../server/cycleTraining.ts");

  try {
    initSchema();
    regenerateTutorial(today);
    const id = regenerateTutorial(today);
    assert.equal(tutorialProfileId(), id);

    const oneTutorial = db.prepare("SELECT COUNT(*) n FROM profiles WHERE name IN ('Tutorial: Isabel','Tutorial: Mara','Tutorial')").get() as { n: number };
    assert.equal(oneTutorial.n, 1);

    const profile = db.prepare("SELECT name FROM profiles WHERE id=?").get(id) as { name: string };
    assert.equal(profile.name, "Tutorial: Isabel");

    const count = (table: string) => (db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE profile_id=?`).get(id) as { n: number }).n;
    assert.ok(count("activities") >= 330);
    assert.ok(count("planned_sessions") >= 55);
    assert.ok(count("races") >= 4);
    assert.equal(count("vo2max_lab"), 2);
    assert.equal(count("lactate_tests"), 2);
    assert.ok(count("session_feedback_v2") >= 220);
    assert.ok(count("cycle_period_log_v2") >= 18);
    assert.ok(count("cycle_symptoms_v2") >= 80);
    assert.equal(count("ml_runs"), 0);
    assert.equal(count("ml_latent_fitness"), 0);
    assert.equal(count("ml_channel_effects"), 0);
    assert.equal(count("ml_readiness"), 0);
    assert.equal(count("ml_health_flags"), 0);

    const periods = db.prepare("SELECT start_date, end_date FROM cycle_period_log_v2 WHERE profile_id=? ORDER BY start_date").all(id) as { start_date: string; end_date: string | null }[];
    const contraception = getProfileSetting("cycle_contraception", { method: "none" }, id);
    const phase = computeCyclePhase(periods, contraception, today);
    assert.equal(phase.phase, "early_luteal");
    assert.ok((phase.cycleDay ?? 0) >= 17 && (phase.cycleDay ?? 0) <= 19);
    const gate = gateCycleAdaptive(periods, contraception, today);
    assert.equal(gate.passed, true);
    assert.equal(gate.mode, "natural");

    const usefulEvidence = db
      .prepare("SELECT COUNT(*) n FROM cycle_stimulus_evidence_v2 WHERE profile_id=? AND confidence!='insufficient'")
      .get(id) as { n: number };
    assert.ok(usefulEvidence.n >= 4);

    const activeTrial = db.prepare("SELECT * FROM method_experiments WHERE profile_id=? AND randomized=1").get(id) as {
      state: string; n_pairs_planned: number; washout: number; lag_weeks: number; config_json: string; arm_a: string; arm_b: string;
    };
    assert.equal(activeTrial.state, "active");
    assert.equal(activeTrial.n_pairs_planned, 3);
    assert.equal(activeTrial.washout, 1);
    assert.equal(activeTrial.lag_weeks, 3);
    assert.equal(activeTrial.arm_a, "aerob");
    assert.equal(activeTrial.arm_b, "threshold");
    const config = JSON.parse(activeTrial.config_json) as { block_weeks: number; washout_weeks: number };
    assert.equal(config.block_weeks, 3);
    assert.equal(config.washout_weeks, 1);
  } finally {
    try { db.close(); } catch { /* ignore */ }
    if (oldDb == null) delete process.env.RUNLOG_DB;
    else process.env.RUNLOG_DB = oldDb;
    rmSync(dir, { recursive: true, force: true });
  }
});
