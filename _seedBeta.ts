// Runner: seedet die 8 Beta-Personas in data/training.db. Sicherheits-Gate:
//  - Voll-Backup der DB vor jedem Schreiben
//  - Integritäts-Snapshot von profile_id=1 (Kolja) VOR und NACH dem Seeding → muss identisch sein
// Aufruf:  npx tsx _seedBeta.ts   (danach Datei behalten — reproduzierbar)
import { copyFileSync } from "node:fs";
import { db, DB_PATH, initSchema } from "./server/db.ts";
import { seedAllBetaPersonas, BETA_PERSONAS } from "./server/betaPersonas.ts";

const SACRED = [
  "activities", "planned_sessions", "season_weeks_v2", "daily_log_v2", "week_log_v2", "races",
  "lactate_tests", "vo2max_lab", "zone_sets", "session_feedback_v2", "cycle_period_log_v2",
  "cycle_symptoms_v2", "cycle_stimulus_evidence_v2", "cycle_stability_v2", "cycle_training_settings",
  "ml_runs", "ml_latent_fitness", "ml_channel_effects", "ml_readiness", "ml_health_flags", "method_experiments",
];

function snapshot(pid: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of SACRED) {
    try { out[t] = (db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE profile_id=?`).get(pid) as { n: number }).n; }
    catch { out[t] = -1; }
  }
  // Settings für Profil 1 (z. B. athlete:1, thresholds:1, availability_1, layout:*:1)
  out["settings_p1"] = (db.prepare("SELECT COUNT(*) n FROM settings WHERE key LIKE '%:1' OR key='availability_1'").get() as { n: number }).n;
  return out;
}
const activeBefore = (db.prepare("SELECT value FROM settings WHERE key='active_profile'").get() as { value: string } | undefined)?.value ?? "1";

initSchema();

const today = new Date().toISOString().slice(0, 10);
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const bak = `${DB_PATH}.beta-backup-${ts}.db`;
copyFileSync(DB_PATH, bak);
console.log(`Backup: ${bak}`);

const before = snapshot(1);
const seeded = seedAllBetaPersonas(today);
const after = snapshot(1);

// Integritäts-Assertion
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
const activeAfter = (db.prepare("SELECT value FROM settings WHERE key='active_profile'").get() as { value: string } | undefined)?.value ?? "1";
if (changed.length) {
  console.error("❌ INTEGRITÄTSFEHLER: profile_id=1 hat sich verändert:", changed.map((k) => `${k}: ${before[k]}→${after[k]}`).join(", "));
  process.exit(1);
}
console.log(`✅ Profil 1 unverändert (${SACRED.length} Tabellen + Settings geprüft). active_profile: ${activeBefore}→${activeAfter}`);

// Kurzer Persona-Report
console.log("\nGeseedete Beta-Personas:");
for (const s of seeded) {
  const acts = (db.prepare("SELECT COUNT(*) n FROM activities WHERE profile_id=?").get(s.id) as { n: number }).n;
  const days = (db.prepare("SELECT COUNT(*) n FROM daily_log_v2 WHERE profile_id=?").get(s.id) as { n: number }).n;
  const fb = (db.prepare("SELECT COUNT(*) n FROM session_feedback_v2 WHERE profile_id=?").get(s.id) as { n: number }).n;
  const races = (db.prepare("SELECT COUNT(*) n FROM races WHERE profile_id=?").get(s.id) as { n: number }).n;
  const wk = (db.prepare("SELECT COUNT(*) n FROM season_weeks_v2 WHERE profile_id=?").get(s.id) as { n: number }).n;
  const cyc = (db.prepare("SELECT regularity FROM cycle_stability_v2 WHERE profile_id=?").get(s.id) as { regularity: string } | undefined)?.regularity ?? "—";
  console.log(`  #${s.id} ${s.name.padEnd(18)} acts=${String(acts).padStart(4)} days=${String(days).padStart(4)} feedback=${String(fb).padStart(3)} races=${races} weeks=${wk} cycle=${cyc}`);
}
console.log(`\n${BETA_PERSONAS.length} Personas fertig. Aktives Profil zum Anschauen per PUT /api/profile/active setzen.`);
