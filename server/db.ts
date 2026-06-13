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
  // Feedback 12.6.: Rad-Zonen in WATT statt km/h (speed_zones bleibt als Legacy bestehen)
  addColumn("zone_sets", "power_zones", "TEXT");
  // Feedback 12.6.: einheitlich km je Zone auch beim Tracking (zone_min bleibt als Legacy lesbar)
  addColumn("activities", "zone_km", "TEXT");
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

  // ToDo #9 (12.6.): leichte Profile/Accounts (ohne Passwort). Bestandsdaten = Profil 1 „Kolja".
  db.exec(`CREATE TABLE IF NOT EXISTS profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`);
  if ((db.prepare("SELECT COUNT(*) n FROM profiles").get() as { n: number }).n === 0) {
    db.prepare("INSERT INTO profiles(id, name) VALUES(1, 'Kolja')").run();
  }
  // SQLite füllt bei ADD COLUMN ... DEFAULT 1 auch Bestandszeilen mit 1 → Altdaten gehören Kolja.
  addColumn("activities", "profile_id", "INTEGER NOT NULL DEFAULT 1");
  addColumn("planned_sessions", "profile_id", "INTEGER NOT NULL DEFAULT 1");
  addColumn("zone_sets", "profile_id", "INTEGER NOT NULL DEFAULT 1");
  // Tabellen mit week_no/date als PK brauchen einen zusammengesetzten Schlüssel mit profile_id →
  // verlustfreie v2-Kopien; die Originale bleiben unangetastet als Backup liegen.
  ensureV2("daily_log", "daily_log_v2", "date, profile_id");
  ensureV2("season_weeks", "season_weeks_v2", "profile_id, week_no");
  ensureV2("week_log", "week_log_v2", "profile_id, week_no");

  // ToDo #24 (v0.5.0): Wettkämpfe mit Detail-Splits (eigene Seite + Bericht).
  db.exec(`
    CREATE TABLE IF NOT EXISTS races (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  INTEGER NOT NULL DEFAULT 1,
      date        TEXT NOT NULL,
      name        TEXT,
      distance_m  REAL,
      time_s      INTEGER,
      placement   TEXT,
      notes       TEXT,
      splits      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_races_date ON races(date);
  `);
}

// v2-Kopie einer Tabelle mit zusammengesetztem PK inkl. profile_id; Altbestand wird einmalig
// (nur wenn v2 noch leer ist) als Profil 1 hineinkopiert. Spalten dynamisch aus PRAGMA → kein Drift.
function ensureV2(src: string, dst: string, pk: string): void {
  const cols = db.prepare(`PRAGMA table_info(${src})`).all() as { name: string; type: string }[];
  const defs = cols.map((c) => `${c.name} ${c.type || "TEXT"}`).join(", ");
  db.exec(`CREATE TABLE IF NOT EXISTS ${dst} (${defs}, profile_id INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (${pk}))`);
  const have = (db.prepare(`SELECT COUNT(*) n FROM ${dst}`).get() as { n: number }).n;
  const src_n = (db.prepare(`SELECT COUNT(*) n FROM ${src}`).get() as { n: number }).n;
  if (have === 0 && src_n > 0) {
    const names = cols.map((c) => c.name).join(",");
    db.exec(`INSERT INTO ${dst}(${names}, profile_id) SELECT ${names}, 1 FROM ${src}`);
  }
}

/** Aktives Profil (settings-Key `active_profile`, Default 1 = Kolja). */
export function activeProfile(): number {
  return getSetting("active_profile", 1);
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

// ---- Wochen-Renummerierung ----------------------------------------------
// Wochen automatisch nach Datum einsortieren: week_no lückenlos 0..N-1 entlang start_date
// (erste eingetragene Woche = 0), PRO PROFIL. Remappt planned_sessions.week_no + week_log_v2.week_no mit.
// Zwischen-Offset vermeidet PK-Kollisionen; verwaiste Referenzen (gelöschte Wochen) bleiben unberührt.
export function renumberWeeks(): void {
  const profiles = db.prepare("SELECT id FROM profiles").all() as { id: number }[];
  for (const p of profiles) {
    const weeks = db
      .prepare("SELECT week_no FROM season_weeks_v2 WHERE profile_id=? ORDER BY start_date, week_no")
      .all(p.id) as { week_no: number }[];
    const map = weeks.map((w, i) => [w.week_no, i] as [number, number]);
    if (map.every(([o, n]) => o === n)) continue;
    const OFF = 100000;
    db.exec("BEGIN");
    try {
      for (const t of ["season_weeks_v2", "planned_sessions", "week_log_v2"]) {
        const shift = db.prepare(`UPDATE ${t} SET week_no = ? WHERE week_no = ? AND profile_id = ?`);
        for (const [o] of map) shift.run(o + OFF, o, p.id);
      }
      for (const t of ["season_weeks_v2", "planned_sessions", "week_log_v2"]) {
        const set = db.prepare(`UPDATE ${t} SET week_no = ? WHERE week_no = ? AND profile_id = ?`);
        for (const [o, n] of map) set.run(n, o + OFF, p.id);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
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
      easy_pct: 80, // Intensitäts-Klassifikation (ToDo #7): <= easy_pct% des Referenz-TSS -> easy
      hard_pct: 105, // >= hard_pct% -> hart; dazwischen moderat
      intensity_window_weeks: 4, // Referenz-Fenster (Wochen) für Ø-TSS
    });
    setSetting("run_equiv_bike_factor", 0.25); // 1 Rad-km = 0.25 Run-km (editierbar)
    setSetting("coros_to_tss", 0.6); // Kalibrierfaktor COROS TL -> TSS (grobe Startannahme)
    setSetting("athlete", { name: "Kolja", weight: 69, max_hr: 196 });
    setSetting("init", true);
  }
}
