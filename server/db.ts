import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, copyFileSync, renameSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Persönliche Daten liegen in data/ (gitignored) — beim Update nur diesen Ordner kopieren (ToDo Z.25).
export const DB_PATH = process.env.RUNLOG_DB || join(__dirname, "..", "data", "training.db");
mkdirSync(dirname(DB_PATH), { recursive: true });
// Einmalige, sichere Migration: bestehende training.db aus dem alten Wurzel-Pfad nach data/ übernehmen.
// Kopieren (inkl. WAL/SHM) statt verschieben; danach das Original als .bak sichern (Bestand ist heilig).
if (!process.env.RUNLOG_DB) {
  const OLD = join(__dirname, "..", "training.db");
  if (!existsSync(DB_PATH) && existsSync(OLD)) {
    for (const sfx of ["", "-wal", "-shm"]) if (existsSync(OLD + sfx)) copyFileSync(OLD + sfx, DB_PATH + sfx);
    renameSync(OLD, OLD + ".bak");
  }
}

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

    -- Wiederverwendbare Einheiten-Vorlagen (häufige Einheiten 1× speichern, per Klick einsetzen).
    -- Rein additiv, profil-scoped; Inhalt entspricht den Inhalts-Feldern einer planned_session ohne Datum.
    CREATE TABLE IF NOT EXISTS session_templates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  INTEGER NOT NULL DEFAULT 1,
      name        TEXT NOT NULL,
      sport       TEXT NOT NULL DEFAULT 'Run',
      type        TEXT NOT NULL DEFAULT 'Easy',
      planned_km  REAL,
      planned_min REAL,
      zone_alloc  TEXT,
      description TEXT,
      efforts     TEXT,
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

// v3.0.0 (Beta-Befund): die idempotenten Options-Seeds unten liefen bislang per `INSERT OR IGNORE` bei
// JEDEM Start — das kann eine bewusste Nutzer-Löschung (✕ in „Auswahllisten", z. B. „REM (h)"/„Tief (h)"
// bei den Tagesfaktoren) nicht von „taucht zum ersten Mal auf" unterscheiden und hat sie nach einem
// Neustart (z. B. frischer Electron-Build) klammheimlich wiederhergestellt. Der Ledger (settings-Key
// `options_seed_ledger`) merkt sich JE (kind,value), ob es diesem Profil-Ordner schon einmal angeboten
// wurde; nur ein wirklich NEUER Wert aus einem künftigen Update wird noch automatisch angelegt.
// Bootstrap-Regel beim allerersten Lauf mit Ledger: War die `options`-Tabelle vorher schon befüllt
// (Bestandsinstallation), wird NICHTS nachträglich erzwungen — nur der aktuelle Soll-Bestand vermerkt,
// sonst kämen mit diesem Fix alle früher gelöschten Standardwerte einmalig zurück. Eine brandneue,
// leere Installation bootstrapped stattdessen normal (seedOptions() befüllt sie ohnehin zuerst).
let seedLedger: Set<string> = new Set();
let seedLedgerIsBootstrap = false;
let seedLedgerDirty = false;
function initSeedLedger(hadOptionsBefore: boolean): void {
  const exists = db.prepare("SELECT 1 FROM settings WHERE key='options_seed_ledger'").get();
  seedLedgerIsBootstrap = !exists && hadOptionsBefore;
  seedLedger = new Set(getSetting<string[]>("options_seed_ledger", []));
  seedLedgerDirty = false;
}
function seedOnce(kind: string, value: string, run: () => void): void {
  const token = `${kind}:${value}`;
  if (seedLedger.has(token)) return;
  seedLedger.add(token);
  seedLedgerDirty = true;
  if (!seedLedgerIsBootstrap) run();
}
function flushSeedLedger(): void {
  if (seedLedgerDirty) { setSetting("options_seed_ledger", [...seedLedger]); seedLedgerDirty = false; }
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
  // v0.15.0: separate HF-Zonen fürs Fahrrad (Lauf-Zonen bleiben in hr_zones)
  addColumn("zone_sets", "hr_zones_bike", "TEXT");
  // v1.3.0 (G4): aerober Schwellen-Anker LT1 (HF + Pace). LT2 = bestehendes lthr/threshold_pace.
  // Default (NULL) wird in zones.ts aus der Z2/Z3-Grenze abgeleitet; G3 (Laktat) überschreibt mit Messwerten.
  addColumn("zone_sets", "lt1_hr", "REAL");
  addColumn("zone_sets", "lt1_pace", "REAL");
  // Feedback 12.6.: einheitlich km je Zone auch beim Tracking (zone_min bleibt als Legacy lesbar)
  addColumn("activities", "zone_km", "TEXT");
  // ToDo 14: Sleep Performance bei den Tagesfaktoren
  addColumn("daily_log", "sleep_performance", "REAL");
  // v0.15.5 (O6): Dirty-Bit — manuell bearbeitete/gelöschte Intervalle werden beim Re-Sync NICHT mehr
  // aus Strava-Laps überschrieben/wieder hinzugefügt. Reset-Endpoint setzt es zurück.
  addColumn("activities", "efforts_locked", "INTEGER DEFAULT 0");

  // ToDo Z.45: Marker „Strava-Beschreibung bereits abgerufen" — trennt das Detail-Fetch von den Notizen,
  // damit vom Nutzer geänderte/gelöschte Notizen beim Re-Sync NICHT mehr überschrieben werden.
  if (!hasColumn("activities", "desc_fetched")) {
    db.exec("ALTER TABLE activities ADD COLUMN desc_fetched INTEGER DEFAULT 0");
    // Backfill: bereits angereicherte Strava-Aktivitäten (Notiz vorhanden) gelten als abgerufen → keine
    // Massen-Neuabrufe. Leere bleiben 0 und werden wie bisher schrittweise angereichert.
    db.prepare("UPDATE activities SET desc_fetched=1 WHERE source='strava' AND notes IS NOT NULL AND TRIM(notes) <> ''").run();
  }

  // ToDo v0.9.0: NGP (grade-adjusted normalisierte Pace, s/km) + Marker, dass die Strava-Streams (HF/Pace/
  // Höhe) schon geholt wurden → Basis für rTSS, min/Zone, km/Zone. Wird je Lauf einmalig (budgetiert) befüllt.
  addColumn("activities", "ngp", "REAL");
  addColumn("activities", "streams_fetched", "INTEGER DEFAULT 0");
  // ToDo v0.10.0: Normalized Power (W) aus dem Rad-Power-Stream → Power-TSS nach TrainingPeaks.
  addColumn("activities", "np", "REAL");
  // v0.11.0 (ToDo 10): Einheitstyp je Aktivität (LT1/LT2/VO2max …) — steuert den Real-Donut + Intervall-Trend.
  addColumn("activities", "type", "TEXT");
  // v0.12.0 (ToDo 3): Marker, dass die Strava-Laps (→ automatische Intervall-Efforts) schon geholt wurden.
  addColumn("activities", "laps_fetched", "INTEGER DEFAULT 0");
  // v0.14.0 (ToDo 8): Strava-Best-Efforts je Lauf (JSON {distance_m: time_s}) → Bestzeiten + Critical Speed.
  addColumn("activities", "best_efforts", "TEXT");
  // v0.14.0 (ToDo 12): Zeit je PACE-Zone (JSON {zone: Minuten}) → Plan-Erfüllung (Pace, nicht Puls).
  addColumn("activities", "pace_zone_min", "TEXT");
  // v1.2.0: aerobe Entkopplung (Pa:HR, %) — aus den Streams bei der Anreicherung berechnet.
  addColumn("activities", "decoupling", "REAL");

  // v1.5.0: Effective VO2max je Lauf (Runalyze-Stil, aus NGP + Ø-HF + Entkopplung), backfillbar via Recompute.
  addColumn("activities", "eff_vo2max", "REAL");

  // v1.7.0: Lauf-Power (Coros-Watt via Strava, Stryd-Stil). run_np = Normalized Power des Laufs;
  // power_curve = JSON {dauer_s: beste_mittlere_Watt}. '{}' = Streams geholt, aber keine Watt (kein Re-Fetch).
  addColumn("activities", "run_np", "REAL");
  addColumn("activities", "power_curve", "TEXT");
  // v2.2.x: Aktivität bewusst NICHT einer geplanten Einheit zuordnen (Einlaufen, Zusatzlauf, Commute).
  // Zählt weiter zur realen Last, aber nicht zur Plan-Erfüllung / Auto-Match.
  addColumn("activities", "match_ignore", "INTEGER DEFAULT 0");

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
  const hadOptionsBefore = (db.prepare("SELECT COUNT(*) n FROM options").get() as { n: number }).n > 0;
  seedOptions();
  initSeedLedger(hadOptionsBefore);

  // ToDo Z.41/v0.7.0: Intensität (easy/moderat/hart) je Einheitstyp — Grundlage für den TSS-Donut „nach Typ".
  // In „Auswahllisten" pro Typ einstellbar. Defaults idempotent setzen + neuen Typ „Steady/Tempo" (moderat).
  addColumn("options", "intensity", "TEXT");
  const setIntensity = db.prepare("UPDATE options SET intensity=? WHERE kind='sessionType' AND value=? AND intensity IS NULL");
  for (const [value, intensity] of [
    ["Easy", "easy"], ["Long", "easy"], ["Threshold", "hard"], ["VO2", "hard"], ["Hill", "hard"], ["Race", "hard"],
  ] as const) setIntensity.run(intensity, value);
  seedOnce("sessionType", "Steady", () => db.prepare(
    "INSERT OR IGNORE INTO options(kind, value, label, color, sort, active, intensity) " +
      "VALUES('sessionType','Steady','Steady / Tempo','#22c55e',(SELECT COALESCE(MAX(sort),0)+1 FROM options WHERE kind='sessionType'),1,'moderate')",
  ).run());

  // v0.11.0 (ToDo 10): granulare Lauf-Typen fürs Tracking — LT1/LT2 + VO2max kurz/lang (idempotent).
  const insType = db.prepare(
    "INSERT OR IGNORE INTO options(kind, value, label, color, sort, active, intensity) " +
      "VALUES('sessionType', ?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM options WHERE kind='sessionType'), 1, ?)",
  );
  for (const [value, label, color, intensity] of [
    ["LT1", "LT1 (Sub-Threshold)", "#84cc16", "moderate"],
    ["LT2", "LT2 (Threshold)", "#eab308", "hard"],
    ["VO2short", "VO2max kurz", "#f97316", "hard"],
    ["VO2long", "VO2max lang", "#fb7185", "hard"],
  ] as const) seedOnce("sessionType", value, () => insType.run(value, label, color, intensity));

  // v0.11.0 (ToDo 7): manuelle Wochen-Checks als konfigurierbare Auswahlliste (kind='check', idempotent).
  const insCheck = db.prepare(
    "INSERT OR IGNORE INTO options(kind, value, label, color, sort, active) " +
      "VALUES('check', ?, ?, ?, ?, 1)",
  );
  [
    ["mileage", "Mileage erreicht", "#3b82f6"],
    ["threshold2x", "2× Schwelle", "#eab308"],
    ["longrun", "Longrun", "#6366f1"],
    ["plyo", "Plyo/Athletik", "#14b8a6"],
    ["physio", "Physio/KG", "#64748b"],
  ].forEach(([value, label, color], i) => seedOnce("check", value, () => insCheck.run(value, label, color, i)));

  // v0.12.0 (ToDo 12): konfigurierbare Tagesfaktoren (kind='daily'); Feldtyp in der intensity-Spalte
  // (number|time|text|checkbox|scale). Basis-Felder zuerst (niedrige sort), Rest danach.
  const insDaily = db.prepare(
    "INSERT OR IGNORE INTO options(kind, value, label, color, sort, active, intensity) VALUES('daily', ?, ?, NULL, ?, 1, ?)",
  );
  [
    // Basis (immer vorhanden): value, label, type
    ["weight", "Gewicht (kg)", "number"], ["sleep_h", "Schlaf (h)", "number"],
    ["bedtime", "Bettzeit", "time"], ["wake_time", "Aufwachzeit", "time"],
    ["energy", "Energie 1-10", "scale"], ["mood", "Stimmung 1-10", "scale"],
    ["stress", "Stress 1-10", "scale"], ["sick", "Krank", "checkbox"], ["notes", "Notizen", "text"],
    // Weitere (Whoop/Subjektiv/Sonstiges)
    ["resting_hr", "Ruhepuls", "number"], ["hrv", "HRV", "number"], ["recovery", "Recovery %", "number"],
    ["strain", "Strain", "number"], ["sleep_efficiency", "Schlaf-Effizienz %", "number"],
    ["sleep_consistency", "Schlaf-Konsistenz %", "number"], ["sleep_performance", "Sleep-Performance %", "number"],
    ["rem_h", "REM (h)", "number"], ["deep_h", "Tief (h)", "number"], ["resp_rate", "Atemfreq.", "number"],
    ["spo2", "SpO2 %", "number"], ["motivation", "Motivation 1-10", "scale"], ["soreness", "Muskelkater 0-10", "scale"],
    ["pain", "Schmerz 0-10", "scale"], ["pain_location", "Schmerz-Ort", "text"], ["rpe", "RPE 1-10", "scale"],
    ["alcohol", "Alkohol (Einh.)", "number"], ["caffeine", "Koffein (mg)", "number"],
    ["hydration", "Hydration", "number"], ["fueling", "Fueling", "text"], ["travel", "Reise", "text"],
  ].forEach(([value, label, type], i) => seedOnce("daily", value, () => insDaily.run(value, label, i, type)));

  // v0.13.0: Tagesfaktoren in logische, in „Auswahllisten" editierbare Kategorien gruppieren.
  // Kategorie-Liste = kind='dailyCat'; die Zuordnung eines Felds steht in dessen color-Spalte (Kategorie-Wert).
  const insDailyCat = db.prepare("INSERT OR IGNORE INTO options(kind, value, label, color, sort, active) VALUES('dailyCat', ?, ?, NULL, ?, 1)");
  [["morgens", "Morgens"], ["schlaf", "Schlaf"], ["subjektiv", "Subjektiv"], ["sonstiges", "Sonstiges"]]
    .forEach(([value, label], i) => seedOnce("dailyCat", value, () => insDailyCat.run(value, label, i)));
  // Kategorie je Tagesfaktor setzen (nur wo noch keine gesetzt ist → Nutzer-Zuordnungen bleiben).
  const setCat = db.prepare("UPDATE options SET color=? WHERE kind='daily' AND value=? AND (color IS NULL OR color='')");
  const DAILY_CAT: Record<string, string[]> = {
    morgens: ["weight", "resting_hr", "hrv", "recovery", "strain"],
    schlaf: ["sleep_h", "bedtime", "wake_time", "sleep_efficiency", "sleep_consistency", "sleep_performance", "rem_h", "deep_h"],
    subjektiv: ["energy", "mood", "stress", "motivation", "soreness", "pain", "pain_location", "rpe"],
    sonstiges: ["resp_rate", "spo2", "alcohol", "caffeine", "hydration", "fueling", "travel", "sick", "notes"],
  };
  for (const [cat, fields] of Object.entries(DAILY_CAT)) for (const f of fields) setCat.run(cat, f);

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
  // v0.12.0 (ToDo 12): eigene Tagesfaktoren (über die festen Spalten hinaus) als JSON.
  addColumn("daily_log_v2", "custom", "TEXT");

  // v1.9.0 (Z6): optionales Wochen-km-Ziel fürs Rad (additiv, neben dem Lauf-Ziel target_km).
  addColumn("season_weeks_v2", "target_km_bike", "REAL");

  // v1.9.0 (Z14): eigene Einheiten je Profil — Struktur-JSON kompatibel zu WorkoutTemplate (workouts.ts).
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_workouts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  INTEGER NOT NULL DEFAULT 1,
      name        TEXT NOT NULL,
      family      TEXT NOT NULL,
      template    TEXT NOT NULL,
      created_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_custom_workouts_profile ON custom_workouts(profile_id);
  `);

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
  // ToDo Z.43: Max-HF + Höhenmeter je Wettkampf. ToDo Z.44: Herkunft (Auto-Import aus Saisonplan, Dedup).
  // ToDo Z.23: Ø-HF je Wettkampf.
  addColumn("races", "max_hr", "INTEGER");
  addColumn("races", "elevation_m", "REAL");
  addColumn("races", "source", "TEXT");
  addColumn("races", "avg_hr", "INTEGER");
  // v0.14.0 (ToDo 3): Verknüpfung Race ↔ getrackte Aktivität (Race aus Tracking).
  addColumn("races", "activity_id", "INTEGER");
  // v1.7.0: Wunsch-Zielzeit (s) für ein Ziel-Rennen → treibt die Pace-Progression der Block-Einheiten.
  addColumn("races", "goal_time_s", "INTEGER");
  // v1.10.0: Test-/Aufbauwettkampf-Flag — der Block plant mit Mini-Taper (kein voller Taper) drumherum.
  addColumn("races", "is_tuneup", "INTEGER DEFAULT 0");
  // v3.1.0: „Für die Planung ignorieren" — Volkslauf/Spaßrennen, das im Kalender steht, aber den Block nicht
  // steuern soll. Ohne dieses Flag würde ein solches Rennen (erstes künftiges Nicht-Tuneup) zum Hauptrennen
  // und der ganze Block dorthin tapern. Rein additiv, Default 0 = bisheriges Verhalten.
  addColumn("races", "excluded_from_plan", "INTEGER NOT NULL DEFAULT 0");
  // v1.7.0: Live-Resolution — gespeicherte Einheit hält ihre Intention (Workout-Template + Progression),
  // damit Pace/HF bei Fitness-Änderung neu berechnet werden können. JSON {templateId, progress, raceId}.
  addColumn("planned_sessions", "prescription", "TEXT");
  // v1.0.1: Manuelle PB-Overrides (eigene Bestzeiten editierbar).
  db.exec(`CREATE TABLE IF NOT EXISTS pb_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    distance_m INTEGER NOT NULL,
    time_s INTEGER NOT NULL,
    date TEXT NOT NULL,
    UNIQUE(profile_id, distance_m)
  )`);

  // v1.3.0 (G3): Laktat-/Feldtest-Diagnostik — Tests + Stufen-Punkte (additiv).
  // lt1_*/lt2_* sind berechneter Cache (aus lactateThresholds), für Trend-Chart ohne Neu-Berechnung.
  db.exec(`
    CREATE TABLE IF NOT EXISTS lactate_tests (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  INTEGER NOT NULL DEFAULT 1,
      date        TEXT NOT NULL,
      sport       TEXT NOT NULL DEFAULT 'Run',
      kind        TEXT,
      notes       TEXT,
      lt1_hr      REAL,
      lt1_pace    REAL,
      lt2_hr      REAL,
      lt2_pace    REAL,
      confidence  TEXT,
      warnings    TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lactate_tests_date ON lactate_tests(profile_id, date);
    CREATE TABLE IF NOT EXISTS lactate_points (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id     INTEGER NOT NULL,
      stage       INTEGER,
      speed_kmh   REAL,
      pace_s      REAL,
      power_w     REAL,
      hr          REAL,
      lactate     REAL NOT NULL,
      rpe         INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_lactate_points_test ON lactate_points(test_id);
  `);

  // v1.5.0: Labor-VO2max-Werte über Zeit → Eichung der Effective-VO2max-Schätzung (mehrere Tests möglich).
  db.exec(`
    CREATE TABLE IF NOT EXISTS vo2max_lab (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  INTEGER NOT NULL DEFAULT 1,
      date        TEXT NOT NULL,
      value       REAL NOT NULL,
      source      TEXT,
      notes       TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vo2max_lab_date ON vo2max_lab(profile_id, date);
  `);

  // v1.6.0 (N-of-1): Geführte Methoden-Experimente. Vorher/Nachher-Marker-Snapshots werden on-the-fly
  // berechnet (kein Speicherzwang) — die Tabelle hält nur Zeitraum + gewählte Methode + Notizen.
  // method ∈ {polarized, pyramidal, threshold, norwegian_double_threshold, custom}.
  db.exec(`
    CREATE TABLE IF NOT EXISTS method_experiments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  INTEGER NOT NULL DEFAULT 1,
      start_date  TEXT NOT NULL,
      end_date    TEXT,
      method      TEXT NOT NULL,
      label       TEXT,
      notes       TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_method_experiments ON method_experiments(profile_id, start_date);
  `);

  // ===== ML-Engine (Plan: ML-Trainingssteuerung, P0) — additiv, profil-scoped, Bestand unangetastet =====
  // Run-Manifest: ein Eintrag je Engine-Lauf (Reproduzierbarkeit: seed + input_hash + model_version).
  db.exec(`
    CREATE TABLE IF NOT EXISTS ml_runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id    INTEGER NOT NULL DEFAULT 1,
      kind          TEXT NOT NULL,
      status        TEXT NOT NULL,
      engine        TEXT,
      model_version TEXT,
      seed          INTEGER,
      input_hash    TEXT,
      settings_json TEXT,
      progress      REAL DEFAULT 0,
      error         TEXT,
      started_at    TEXT,
      finished_at   TEXT,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ml_runs ON ml_runs(profile_id, kind, created_at);
    -- „Was hilft dir?"-Verdikt gecacht je Profil (Fingerprint aus Run-Ids + bewerteten Trials + verankerter MCID):
    -- spart die doppelten Sidecar-exposure_dose-Läufe beim Coach-/Verdikt-Laden; invalidiert automatisch bei Input-Änderung.
    CREATE TABLE IF NOT EXISTS ml_verdict_cache (
      profile_id   INTEGER PRIMARY KEY,
      fingerprint  TEXT NOT NULL,
      verdict_json TEXT NOT NULL,
      built_at     TEXT NOT NULL
    );
    -- v3.1.0: dieselbe Idee für die teuren Methodik-Karten (Passive Inferenz + Methoden-Schwerpunkt).
    -- Vorher lebte das Sidecar-Ergebnis NUR im React-State → beim Seitenwechsel war es weg und die Karte fiel
    -- auf die billige TS-Basis zurück. Jetzt persistiert je (Profil, Karte); der Fingerprint beschreibt die Inputs,
    -- damit ein veraltetes Ergebnis ehrlich als „veraltet" angezeigt (aber nicht stillschweigend neu gerechnet) wird.
    CREATE TABLE IF NOT EXISTS ml_method_cache (
      profile_id   INTEGER NOT NULL,
      key          TEXT NOT NULL,   -- z.B. "method_bayes:regime" | "regime_latent:emphasis"
      fingerprint  TEXT NOT NULL,
      result_json  TEXT NOT NULL,
      built_at     TEXT NOT NULL,
      PRIMARY KEY (profile_id, key)
    );
  `);
  // Kanal-Effekte je Lauf (Forest-Plot-Daten): Reiz-Kanal × Zielgröße mit CI + Konfidenz.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ml_channel_effects (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id            INTEGER NOT NULL,
      profile_id        INTEGER NOT NULL DEFAULT 1,
      channel           TEXT NOT NULL,
      target            TEXT NOT NULL,
      lag_weeks         INTEGER,
      gain_mean         REAL,
      ci_low            REAL,
      ci_high           REAL,
      n_blocks          INTEGER,
      collinearity_flag INTEGER DEFAULT 0,
      mcid_pass         INTEGER DEFAULT 0,
      confidence        TEXT,
      created_at        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ml_channel_effects ON ml_channel_effects(run_id, profile_id);
  `);
  // v2.8.0 (Item 3, Research-Mode): globale SHAP-Feature-Wichtigkeit je Lauf (mittleres |SHAP| über alle Wochen) —
  // spiegelt ml_channel_effects (per-Lauf-Zeilen, Forest-Plot-fähig). Die lokalen (Wochen-genauen) SHAP-Werte +
  // Fit-Güte-Diagnostik liegen im JSON von ml_runs.settings_json (wie bei dose_response/banister), nicht hier —
  // eine zweite Tabelle nur für einen Matrix-Blob wäre Overkill.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ml_research_shap (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id            INTEGER NOT NULL,
      profile_id        INTEGER NOT NULL DEFAULT 1,
      feature           TEXT NOT NULL,
      importance_global REAL,
      created_at        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ml_research_shap ON ml_research_shap(run_id, profile_id);
  `);
  // Geglättete latente Fitness-Trajektorie (L2) + Online-Readiness (Kalman-Filter): Cache je Datum.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ml_latent_fitness (
      profile_id  INTEGER NOT NULL DEFAULT 1,
      date        TEXT NOT NULL,
      value       REAL,
      sd          REAL,
      run_id      INTEGER,
      PRIMARY KEY (profile_id, date)
    );
    CREATE TABLE IF NOT EXISTS ml_readiness (
      profile_id  INTEGER NOT NULL DEFAULT 1,
      date        TEXT NOT NULL,
      value       REAL,
      sd          REAL,
      PRIMARY KEY (profile_id, date)
    );
  `);
  // Deterministische Gesundheits-Flags (RED-S/Übertraining) — außerhalb des Optimizers, nicht-diagnostisch.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ml_health_flags (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  INTEGER NOT NULL DEFAULT 1,
      date        TEXT NOT NULL,
      kind        TEXT NOT NULL,
      severity    TEXT,
      message     TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ml_health_flags ON ml_health_flags(profile_id, date);
  `);
  // Engine-Einstellungen je Profil (Default AUS; channel_count 5 mit Auto-Kollaps; research_mode = Python-Sidecar).
  db.exec(`
    CREATE TABLE IF NOT EXISTS ml_settings (
      profile_id               INTEGER PRIMARY KEY,
      enabled                  INTEGER NOT NULL DEFAULT 0,
      channel_count            INTEGER NOT NULL DEFAULT 5,
      mcid_json                TEXT,
      forgetting_halflife_days INTEGER NOT NULL DEFAULT 450,
      sensitivity              REAL NOT NULL DEFAULT 0.5,
      research_mode_enabled    INTEGER NOT NULL DEFAULT 0,
      schedule_mode            TEXT NOT NULL DEFAULT 'monthly',
      updated_at               TEXT
    );
  `);
  // Minimal-EMA Session-Feedback (Herzstück des Loops): wenige Tap-Felder + Auto-Kontext (Engine-gesetzt).
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_feedback_v2 (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id       INTEGER NOT NULL DEFAULT 1,
      activity_id      INTEGER,
      date             TEXT NOT NULL,
      session_family   TEXT,
      rpe              INTEGER,
      felt_vs_expected INTEGER,
      life_stress      INTEGER,
      notes            TEXT,
      cycle_phase      TEXT,
      cycle_day        INTEGER,
      confounder_flag  TEXT,
      created_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_feedback_v2 ON session_feedback_v2(profile_id, date);
  `);

  // ===== P6 — Zyklus-Gerüst (AUS, Consent-Hard-Gate) — additiv, profil-scoped, Default aus =====
  // Nichts läuft ohne Opt-in (cycle_consent-Setting). Verschlüsselung bewusst als spätere Folge.
  db.exec(`
    CREATE TABLE IF NOT EXISTS cycle_training_settings (
      profile_id               INTEGER NOT NULL PRIMARY KEY,
      cycle_adaptive_enabled   INTEGER NOT NULL DEFAULT 0,
      method_emphasis          TEXT    NOT NULL DEFAULT 'balanced',
      method_emphasis_weight   REAL    NOT NULL DEFAULT 0.5,
      phase_stimulus_map       TEXT,
      feedback_sensitivity     REAL    NOT NULL DEFAULT 0.5,
      symptom_override_enabled INTEGER NOT NULL DEFAULT 1,
      observation_mode_only    INTEGER NOT NULL DEFAULT 0,
      updated_at               TEXT
    );
    CREATE TABLE IF NOT EXISTS cycle_period_log_v2 (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  INTEGER NOT NULL,
      start_date  TEXT NOT NULL,
      end_date    TEXT,
      notes       TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cycle_period_log_v2 ON cycle_period_log_v2(profile_id, start_date);
    CREATE TABLE IF NOT EXISTS cycle_symptoms_v2 (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  INTEGER NOT NULL,
      date        TEXT NOT NULL,
      cramps      INTEGER,
      energy      INTEGER,
      sleep       INTEGER,
      mood        INTEGER,
      flow        INTEGER,
      notes       TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cycle_symptoms_v2 ON cycle_symptoms_v2(profile_id, date);
    CREATE TABLE IF NOT EXISTS cycle_stimulus_evidence_v2 (
      profile_id       INTEGER NOT NULL,
      phase            TEXT NOT NULL,
      stimulus         TEXT NOT NULL,
      n_sessions       INTEGER NOT NULL DEFAULT 0,
      mean_quality     REAL,
      effect_size      REAL,
      ci_low           REAL,
      ci_high          REAL,
      confidence       TEXT,
      prior_weight     REAL,
      posterior_weight REAL,
      last_updated     TEXT,
      PRIMARY KEY (profile_id, phase, stimulus)
    );
    CREATE TABLE IF NOT EXISTS cycle_stability_v2 (
      profile_id     INTEGER PRIMARY KEY,
      n_cycles       INTEGER,
      median_length  REAL,
      length_sd      REAL,
      regularity     TEXT,
      gate_passed    INTEGER,
      last_evaluated TEXT
    );
    -- Komponente B (v2.4.0): deklarierter Block-Schwerpunkt als Schrittfunktion (jüngste effective_date ≤ Woche gilt).
    CREATE TABLE IF NOT EXISTS method_emphasis_history_v2 (
      id             INTEGER PRIMARY KEY,
      profile_id     INTEGER NOT NULL,
      effective_date TEXT NOT NULL,
      emphasis       TEXT NOT NULL,
      created_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_method_emphasis_history_v2 ON method_emphasis_history_v2(profile_id, effective_date);
  `);

  // Prospektive randomisierte N-of-1-Blöcke (L5): erweitert method_experiments (additiv).
  addColumn("method_experiments", "emphasis_label", "TEXT");
  addColumn("method_experiments", "washout", "INTEGER DEFAULT 0");
  addColumn("method_experiments", "primary_outcome", "TEXT");
  addColumn("method_experiments", "lag_weeks", "INTEGER");
  addColumn("method_experiments", "randomized", "INTEGER DEFAULT 0");
  // P5 prospektiver Trial-Lebenszyklus + counterbalanced AB/BA-Design (alle additiv, nullable/default).
  addColumn("method_experiments", "state", "TEXT");                  // proposed|accepted|declined|active|evaluated|archived|aborted_health
  addColumn("method_experiments", "trial_kind", "TEXT");             // channel|regime
  addColumn("method_experiments", "arm_a", "TEXT");
  addColumn("method_experiments", "arm_b", "TEXT");
  addColumn("method_experiments", "arm_a_label", "TEXT");
  addColumn("method_experiments", "arm_b_label", "TEXT");
  addColumn("method_experiments", "seed", "INTEGER");
  addColumn("method_experiments", "n_pairs_planned", "INTEGER");
  addColumn("method_experiments", "n_pairs_done", "INTEGER");
  addColumn("method_experiments", "verdict", "TEXT");                // geprueft|hypothese|inconclusive|insufficient
  addColumn("method_experiments", "theta", "REAL");
  addColumn("method_experiments", "p_exact", "REAL");
  addColumn("method_experiments", "consented_at", "TEXT");
  addColumn("method_experiments", "proposal_hash", "TEXT");
  addColumn("method_experiments", "config_json", "TEXT");            // {alpha, mcid, mcid_source, block_weeks, washout_weeks, override_mode, primary_outcome}
  addColumn("method_experiments", "blocks_json", "TEXT");            // Block[] mit outcomes/excluded
  // P5-Folge: getaggte Auto-Plan-Sessions eines Trials (nur diese Zeilen gehören dem Experiment; manuelle unberührt).
  addColumn("planned_sessions", "experiment_id", "INTEGER");
  // Modell-Leiter (5→4→3): channel_auto=1 → Leiter (Default), 0 → feste Stufe (Pin)
  addColumn("ml_settings", "channel_auto", "INTEGER NOT NULL DEFAULT 1");
  // L4 Robustheit auf den Kanal-Effekten (FDR/E-Value)
  addColumn("ml_channel_effects", "p_boot", "REAL");
  addColumn("ml_channel_effects", "q_fdr", "REAL");
  addColumn("ml_channel_effects", "e_value", "REAL");
  addColumn("ml_channel_effects", "e_value_ci", "REAL");
  addColumn("ml_channel_effects", "fdr_survive", "INTEGER DEFAULT 0");
  // B1: Bayes-Posterior je Kanal (Sidecar PyMC/Conjugate) — additiv, primär wenn gesetzt, sonst TS-Effekt.
  addColumn("ml_channel_effects", "posterior_mean", "REAL");
  addColumn("ml_channel_effects", "hdi_low", "REAL");
  addColumn("ml_channel_effects", "hdi_high", "REAL");
  addColumn("ml_channel_effects", "p_positive", "REAL");
  addColumn("ml_channel_effects", "bayes_engine", "TEXT");
  // B2a: Impulse-Response — gefitteter Zerfall τ (Wochen) + Halbwertszeit je Kanal (Retention).
  addColumn("ml_channel_effects", "tau_weeks", "REAL");
  addColumn("ml_channel_effects", "half_life_weeks", "REAL");
  // Kanonische Einheitstypen: wichtig für die ML-Reiz-Klassifizierung → gesperrt (nicht löschbar/umbenennbar).
  addColumn("options", "locked", "INTEGER NOT NULL DEFAULT 0");
  seedCanonicalSessionTypes();

  // v3.0.0 (Beta-Befund „nur eine VO2max/LT1/LT2 Tag, nix redundantes"): historisch redundante
  // sessionType-Werte aus der Nutzer-Dropdown nehmen — „Rep" war ein Duplikat von „Repetitions" (0 echte
  // Nutzungen), „VO2short"/„VO2long" redundant zum kanonischen „VO2" fürs manuelle Tracking (die
  // Granularität lebt intern in Strava-Auto-Klassifizierung/Intervall-Trend-Analyse unverändert weiter).
  // Rein additiv: deaktiviert (active=0), NICHT gelöscht — bestehende Aktivitäten/geplante Einheiten mit
  // diesen Werten zeigen weiter korrekt (typeLabel() fällt auf DEFAULT_SESSION_TYPES zurück, genau wie es
  // „Threshold" als planerinterner Wert schon lange unauffällig tut). Einmalig, per settings-Marke; „Rep"
  // war zudem `locked` und für den Nutzer in der UI gar nicht löschbar — ging nur serverseitig.
  if (!getSetting("migrated_dedupe_sessiontypes_v3", false)) {
    db.prepare("UPDATE options SET active=0 WHERE kind='sessionType' AND value IN ('Rep','VO2short','VO2long')").run();
    setSetting("migrated_dedupe_sessiontypes_v3", true);
  }

  // v3.1.0: Coach-übernommene Einheiten wurden ohne `planned_km` gespeichert (der Coach schickt die
  // Zonen-km in `zone_alloc.byKm`, aber kein Gesamt-km) → sie fehlten in allen km-Auswertungen, bis man sie
  // manuell öffnete und speicherte. Die Ursache ist gefixt (enrichZoneAllocKm leitet planned_km ab); dieser
  // einmalige Backfill repariert den Bestand. Rein additiv: schreibt NUR dort, wo planned_km fehlt/0 ist und
  // belastbare byKm existieren — keine bestehenden km werden überschrieben.
  if (!getSetting("migrated_planned_km_from_zonealloc_v31", false)) {
    const rows = db.prepare(
      "SELECT id, zone_alloc FROM planned_sessions WHERE (planned_km IS NULL OR planned_km <= 0) AND zone_alloc IS NOT NULL AND sport='Run'",
    ).all() as { id: number; zone_alloc: string }[];
    const upd = db.prepare("UPDATE planned_sessions SET planned_km=? WHERE id=?");
    let fixed = 0;
    for (const r of rows) {
      let alloc: { byKm?: Record<string, number> } | null = null;
      try { alloc = JSON.parse(r.zone_alloc); } catch { continue; }
      const km = Object.values(alloc?.byKm || {}).reduce((a, b) => a + (Number(b) || 0), 0);
      if (km > 0) { upd.run(Math.round(km * 100) / 100, r.id); fixed++; }
    }
    if (fixed > 0) console.log(`[migrate] planned_km aus zone_alloc.byKm nachgetragen: ${fixed} Einheiten`);
    setSetting("migrated_planned_km_from_zonealloc_v31", true);
  }

  flushSeedLedger();
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

// Kanonische Einheitstypen (gesperrt): hart verdrahtet, da sie die ML-Reiz-Klassifizierung (TYPE_CHANNEL_MAP)
// tragen — value+label sind nicht änderbar/löschbar; zusätzliche Typen kann der Nutzer frei anlegen.
// Idempotent (läuft bei jedem Start): legt fehlende an, setzt Label/Intensität/locked der kanonischen.
const CANONICAL_SESSION_TYPES: { value: string; label: string; intensity: string; color: string }[] = [
  { value: "Easy", label: "GA1-2 Dauerlauf", intensity: "easy", color: "#3b82f6" },
  { value: "Long", label: "Longrun", intensity: "easy", color: "#6366f1" },
  { value: "LongQ", label: "Longrun mit Qualität", intensity: "moderate", color: "#8b5cf6" },
  { value: "Trail", label: "Trail Run", intensity: "moderate", color: "#16a34a" },
  { value: "MarathonPace", label: "Marathon-Pace", intensity: "moderate", color: "#0ea5e9" },
  { value: "LT1", label: "LT1 (aerobe Schwelle)", intensity: "moderate", color: "#84cc16" },
  { value: "LT2", label: "LT2 / Schwelle", intensity: "hard", color: "#eab308" },
  { value: "VO2", label: "VO2max", intensity: "hard", color: "#f97316" },
  // "Rep" (v3.0.0 entfernt): war ein reines Duplikat von „Repetitions" — dieselbe Bedeutung, zwei Zeilen
  // in der Dropdown (Beta-Befund „nix redundantes"). „Repetitions" ist der tatsächlich genutzte Wert.
  { value: "Repetitions", label: "Repetitions", intensity: "hard", color: "#ef4444" },
];
function seedCanonicalSessionTypes(): void {
  const ins = db.prepare(
    "INSERT OR IGNORE INTO options(kind, value, label, color, sort, active, intensity, locked) " +
      "VALUES('sessionType', ?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM options WHERE kind='sessionType'), 1, ?, 1)",
  );
  const upd = db.prepare("UPDATE options SET label=?, intensity=?, locked=1 WHERE kind='sessionType' AND value=?");
  for (const c of CANONICAL_SESSION_TYPES) {
    seedOnce("sessionType", c.value, () => ins.run(c.value, c.label, c.color, c.intensity));
    upd.run(c.label, c.intensity, c.value);
  }
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

// Profil-gebundene Settings: persönliche Daten (athlete/thresholds/phase_dist_overrides) je Profil,
// via Key-Suffix `key:<pid>` (gleiches Muster wie availability_N / layout:*:N). profileId explizit übergeben,
// wo der aktive Profil-Kontext nicht garantiert ist (z.B. asynchrone ML-Jobs).
export function getProfileSetting<T = unknown>(key: string, fallback: T, profileId: number = activeProfile()): T {
  return getSetting(`${key}:${profileId}`, fallback);
}
export function setProfileSetting(key: string, value: unknown, profileId: number = activeProfile()): void {
  setSetting(`${key}:${profileId}`, value);
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
    setProfileSetting("thresholds", {
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
    setProfileSetting("athlete", { name: "Kolja", weight: 69, max_hr: 196 });
    setSetting("init", true);
  }
  // Personen-gebundene Settings einmalig vom globalen Alt-Key nach `key:1` (Profil Kolja) migrieren,
  // damit Mehr-Profil-Nutzung korrekte Per-Person-Daten hat. Idempotent (nur wenn `key:1` noch fehlt).
  for (const k of ["athlete", "thresholds", "phase_dist_overrides"]) {
    const legacy = db.prepare("SELECT value FROM settings WHERE key=?").get(k) as { value: string } | undefined;
    const scoped = db.prepare("SELECT value FROM settings WHERE key=?").get(`${k}:1`) as { value: string } | undefined;
    if (legacy && !scoped) db.prepare("INSERT INTO settings(key, value) VALUES(?, ?)").run(`${k}:1`, legacy.value);
  }
}
