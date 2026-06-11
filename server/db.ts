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

  migrate();
  seedDefaults();
}

// ---- additive migrations (Bestandsdaten bleiben erhalten) --------------
// NIE Tabellen neu anlegen/droppen — nur Spalten ergänzen, falls sie fehlen.

function hasColumn(table: string, col: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === col);
}

function addColumn(table: string, col: string, decl: string): void {
  if (!hasColumn(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

function migrate(): void {
  // ToDo 23: kcal je Aktivität · ToDo 1/20: strukturierte Efforts · ToDo 4: reale min je Zone
  addColumn("activities", "kcal", "REAL");
  addColumn("activities", "efforts", "TEXT");
  addColumn("activities", "zone_min", "TEXT");
  // ToDo 1/20: geplante Efforts (structured bleibt für Kompatibilität bestehen)
  addColumn("planned_sessions", "efforts", "TEXT");
  // ToDo 6: Speed-Zonen (km/h) fürs Rad neben den Pace-Zonen (Lauf)
  addColumn("zone_sets", "speed_zones", "TEXT");
  // ToDo 14: Sleep Performance bei den Tagesfaktoren
  addColumn("daily_log", "sleep_performance", "REAL");

  // ToDo 13/24: konfigurierbare Auswahllisten (Phasen, Sportarten, Einheitstypen, Aktivitätstypen)
  db.exec(`
    CREATE TABLE IF NOT EXISTS options (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      kind   TEXT NOT NULL,
      value  TEXT NOT NULL,
      label  TEXT NOT NULL,
      color  TEXT,
      sort   INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_options_kind_value ON options(kind, value);
  `);
  seedOptions();
}

// Default-Auswahllisten (einmalig geseedet; danach in der App editierbar).
const DEFAULT_OPTIONS: { kind: string; value: string; label: string; color: string | null }[] = [
  // Phasen — die 6 neuen (ToDo 13). Bestehende Wochen behalten ihre Alt-Werte.
  { kind: "phase", value: "Base", label: "Base", color: "#64748b" },
  { kind: "phase", value: "Belastung", label: "Belastung", color: "#3b82f6" },
  { kind: "phase", value: "Entlastung", label: "Entlastung", color: "#22c55e" },
  { kind: "phase", value: "Race Week", label: "Race Week", color: "#eab308" },
  { kind: "phase", value: "Krank", label: "Krank", color: "#ef4444" },
  { kind: "phase", value: "Race Specific", label: "Race Specific", color: "#a855f7" },
  // Sportarten (umfasst alle in Bestandsdaten genutzten + Allgemein/Commute, ToDo 22)
  { kind: "sport", value: "Run", label: "Lauf", color: "#3b82f6" },
  { kind: "sport", value: "BikeRoad", label: "Rennrad", color: "#06b6d4" },
  { kind: "sport", value: "BikeIndoor", label: "Rolle", color: "#0ea5e9" },
  { kind: "sport", value: "Strength", label: "Kraft", color: "#14b8a6" },
  { kind: "sport", value: "Physio", label: "KG / Physio", color: "#64748b" },
  { kind: "sport", value: "General", label: "Allgemein / Commute", color: "#94a3b8" },
  { kind: "sport", value: "Other", label: "Sonstiges", color: "#9ca3af" },
  // Einheitstypen (mit Farben wie im Frontend)
  { kind: "sessionType", value: "Easy", label: "Easy / GA1", color: "#3b82f6" },
  { kind: "sessionType", value: "Long", label: "Longrun", color: "#6366f1" },
  { kind: "sessionType", value: "Threshold", label: "Schwelle / Sub-T", color: "#eab308" },
  { kind: "sessionType", value: "VO2", label: "VO2 / Intervalle", color: "#f97316" },
  { kind: "sessionType", value: "Hill", label: "Berg", color: "#a855f7" },
  { kind: "sessionType", value: "Race", label: "Wettkampf", color: "#ef4444" },
  { kind: "sessionType", value: "Strength", label: "Stabi / Athletik", color: "#14b8a6" },
  { kind: "sessionType", value: "Physio", label: "KG / Physio", color: "#64748b" },
  { kind: "sessionType", value: "Rest", label: "Ruhetag", color: "#9ca3af" },
];

function seedOptions(): void {
  const n = db.prepare("SELECT COUNT(*) n FROM options").get() as { n: number };
  if (n.n > 0) return;
  const ins = db.prepare("INSERT INTO options(kind, value, label, color, sort, active) VALUES(?,?,?,?,?,1)");
  DEFAULT_OPTIONS.forEach((o, i) => ins.run(o.kind, o.value, o.label, o.color, i));
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
