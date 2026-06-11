import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.RUNLOG_DB || join(__dirname, "..", "training.db");

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS zone_sets (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      valid_from    TEXT NOT NULL,
      hr_zones      TEXT NOT NULL,
      pace_zones    TEXT,
      lthr          INTEGER,
      ftp           INTEGER,
      threshold_pace REAL,
      source        TEXT,
      note          TEXT,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS season_weeks (
      week_no    INTEGER PRIMARY KEY,
      label      TEXT,
      phase      TEXT,
      start_date TEXT NOT NULL,
      end_date   TEXT NOT NULL,
      target_km  REAL,
      goal_race  TEXT,
      notes      TEXT
    );

    CREATE TABLE IF NOT EXISTS planned_sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT NOT NULL,
      week_no     INTEGER,
      sport       TEXT NOT NULL DEFAULT 'Run',
      type        TEXT NOT NULL DEFAULT 'Easy',
      planned_km  REAL,
      planned_min REAL,
      zone_alloc  TEXT,
      description TEXT,
      structured  TEXT,
      planned_tss REAL,
      sort_order  INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS activities (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      strava_id     TEXT UNIQUE,
      date          TEXT NOT NULL,
      sport         TEXT NOT NULL DEFAULT 'Run',
      source        TEXT NOT NULL DEFAULT 'manual',
      name          TEXT,
      distance_m    REAL,
      moving_s      INTEGER,
      elapsed_s     INTEGER,
      avg_hr        REAL,
      max_hr        REAL,
      avg_power     REAL,
      elevation     REAL,
      avg_cadence   REAL,
      training_load REAL,
      tss           REAL,
      zones         TEXT,
      overrides     TEXT,
      matched_session_id INTEGER,
      notes         TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_log (
      date              TEXT PRIMARY KEY,
      weight            REAL,
      resting_hr        REAL,
      hrv               REAL,
      recovery          REAL,
      strain            REAL,
      sleep_h           REAL,
      bedtime           TEXT,
      wake_time         TEXT,
      sleep_efficiency  REAL,
      sleep_consistency REAL,
      rem_h             REAL,
      deep_h            REAL,
      resp_rate         REAL,
      spo2              REAL,
      energy            INTEGER,
      mood              INTEGER,
      stress            INTEGER,
      motivation        INTEGER,
      legs              TEXT,
      soreness          INTEGER,
      pain              INTEGER,
      pain_location     TEXT,
      rpe               INTEGER,
      alcohol           INTEGER,
      caffeine          INTEGER,
      hydration         INTEGER,
      fueling           INTEGER,
      travel            INTEGER,
      sick              INTEGER,
      notes             TEXT
    );

    CREATE TABLE IF NOT EXISTS week_log (
      week_no    INTEGER PRIMARY KEY,
      run_km     REAL,
      run_h      REAL,
      bike_km    REAL,
      bike_h     REAL,
      run_equiv  REAL,
      week_tss   REAL,
      ctl        REAL,
      atl        REAL,
      tsb        REAL,
      checks     TEXT,
      whoop      TEXT,
      refl_good   TEXT,
      refl_hard   TEXT,
      refl_change TEXT,
      refl_extra  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_planned_date ON planned_sessions(date);
    CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date);
  `);

  seedDefaults();
}

// ---- settings helpers --------------------------------------------------

export function getSetting<T = unknown>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, JSON.stringify(value));
}

// ---- defaults ----------------------------------------------------------

export const DEFAULT_HR_ZONES = [
  { z: 1, min: 0, max: 137, label: "Z1 Recovery", color: "#9aa7b4" },
  { z: 2, min: 138, max: 158, label: "Z2 Endurance", color: "#3b82f6" },
  { z: 3, min: 159, max: 169, label: "Z3 Tempo", color: "#22c55e" },
  { z: 4, min: 170, max: 180, label: "Z4 Threshold", color: "#eab308" },
  { z: 5, min: 181, max: 191, label: "Z5 VO2max", color: "#f97316" },
  { z: 6, min: 192, max: 999, label: "Z6 Anaerob", color: "#ef4444" },
];

function seedDefaults() {
  const zoneCount = db.prepare("SELECT COUNT(*) n FROM zone_sets").get() as { n: number };
  if (zoneCount.n === 0) {
    db.prepare(
      `INSERT INTO zone_sets(valid_from, hr_zones, pace_zones, lthr, ftp, threshold_pace, source, note, created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run(
      "2026-01-01",
      JSON.stringify(DEFAULT_HR_ZONES),
      JSON.stringify([]),
      172, // LTHR ~ T2-Bereich
      265, // FTP (Strava)
      230, // Schwellen-Pace s/km (~3:50/km), editierbar
      "Default",
      "Koljas 6-Zonen-HF-Modell (Startwert)",
      new Date().toISOString().slice(0, 10),
    );
  }

  if (getSetting("init", false) === false) {
    setSetting("thresholds", {
      volume_pct: 10, // +/- % vs Phasenziel
      ctl_ramp_max: 7, // CTL-Punkte/Woche
      acwr_high: 1.3,
      acwr_low: 0.8,
      hard_pct_max: 20, // % harter Anteil
      z3_pct_max: 15, // grey zone
      longrun_pct_max: 35,
      tsb_raceweek_min: -5, // Form sollte Richtung Race week nicht zu negativ sein
    });
    setSetting("run_equiv_bike_factor", 0.25); // 1 Rad-km = 0.25 Run-km (editierbar)
    setSetting("coros_to_tss", 0.6); // Kalibrierfaktor COROS TL -> TSS (grobe Startannahme)
    setSetting("athlete", { name: "Kolja", weight: 69, max_hr: 196 });
    setSetting("init", true);
  }
}
