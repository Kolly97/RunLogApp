import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { db, initSchema, getSetting, setSetting, renumberWeeks, activeProfile, DEFAULT_HR_ZONES, DB_PATH } from "./db.ts";
import {
  plannedTss,
  computePmc,
  ctlRamp,
  runTss,
  powerTss,
  bikeTssEstimate,
  hrTssFromZones,
  round1,
  vdot,
  predictFromVdot,
  fitCriticalSpeed,
  fitCriticalPower,
  powerZonesFromCp,
  runningStressScore,
  runningEffectiveness,
  wPrimeBalance,
  computeOptimalZones,
  danielsPaces,
  POWER_CURVE_DURATIONS,
  effectiveVo2max,
  paceToSecPerKm,
  type HrZone,
  type PmcPoint,
} from "./load.ts";
import { vo2maxLevel } from "./norms.ts";
import { lactateThresholds, proposedHrBounds, proposedPaceBounds, type LactatePoint as LacPoint } from "./lactate.ts";
import { pacingPlan, type PacingProfileKm } from "./pacing.ts";
import {
  weekTotals,
  analyzeWeek,
  plannedSessionTss,
  intervalEffortStat,
  typeIntensityShares,
  zoneKmIntensityOf,
  zoneKmOf,
  weekRatingLevel,
  weekLoadFlag,
  kmPolarizationFlag,
  physioTimeZones,
  polarizationIndex,
  phaseDistributionTarget,
  polarizationFlag,
  weekStructureRecommendation,
  trainingMonotonyStrain,
  readinessScore,
  dailyRecommendation,
  tssRecommendation,
  sessionCompletion,
  matchActivities,
  blockPlan,
  injuryRiskFlag,
  adjustTodaySession,
  markerSnapshot,
  compareMarkers,
  methodInference,
  resolvePlannedSession,
  type IntLevel,
  type PlannedSession,
  type CategoryTotals,
  type EffortLine,
  type IntervalEffortStat,
  type BlockWeekInput,
  type MarkerActivity,
  type MarkerLactateTest,
  type WeekRegimeInput,
} from "./analysis.ts";
import type { Availability } from "./planbuilder.ts";
import { WORKOUT_LIBRARY, setCustomWorkouts, customWorkoutList, estimateCustom, type CustomInput, type WorkoutTemplate } from "./workouts.ts";
import { ensureTutorialProfile, regenerateTutorial, deleteTutorial, tutorialProfileId } from "./tutorial.ts";
import { stravaStatus, stravaLogin, stravaCallback, stravaSync, stravaEnrich, stravaRelinkEfforts, fetchAthleteZonesAndFtp } from "./strava.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));
// v1.6.2: Jeder Schreibzugriff invalidiert den Methoden-Inferenz-Cache (advisory, langsam wechselnd) →
// der nächste Plan-Vorschlag rechnet frisch, alle GETs dazwischen nutzen das gecachte Ergebnis.
app.use((req, _res, next) => { if (req.method !== "GET" && req.method !== "HEAD") invalidateInference(); next(); });

initSchema();

const todayIso = () => new Date().toISOString().slice(0, 10);

// v1.8.0: Beim ersten Start ein „Tutorial"-Profil mit Beispieljahr anlegen (idempotent, eigenes profile_id).
try { ensureTutorialProfile(todayIso()); } catch (e) { console.warn("Tutorial-Profil konnte nicht angelegt werden:", String(e)); }
/** YYYY-MM-DD um n Tage verschieben (UTC). */
const addDaysIso = (iso: string, n: number): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// Aktives Profil (leichter Account-Wechsel, ToDo #9): alle Daten-Queries filtern darauf.
const pid = () => activeProfile();

// v1.9.0 (Z14): eigene Einheiten des aktiven Profils laden + in die Engine spiegeln (vor jeder Anfrage aktuell).
function loadCustomWorkouts(): WorkoutTemplate[] {
  const rows = db.prepare("SELECT template FROM custom_workouts WHERE profile_id=?").all(pid()) as { template: string }[];
  const out: WorkoutTemplate[] = [];
  for (const r of rows) { const t = parseJson<WorkoutTemplate | null>(r.template, null); if (t && t.id) out.push(t); }
  return out;
}
app.use((req, _res, next) => { if (req.path.startsWith("/api/")) { try { setCustomWorkouts(loadCustomWorkouts()); } catch { /* ignore */ } } next(); });

// ---- helpers -----------------------------------------------------------

function parseJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string") return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

interface ZoneSetRow {
  id: number;
  valid_from: string;
  hr_zones: string;
  hr_zones_bike: string | null;
  pace_zones: string;
  speed_zones: string;
  power_zones: string;
  lthr: number;
  ftp: number;
  threshold_pace: number;
  lt1_hr: number | null;
  lt1_pace: number | null;
  source: string;
  note: string;
}

function effectiveZoneSet(date: string) {
  const rows = db.prepare("SELECT * FROM zone_sets WHERE profile_id=? ORDER BY valid_from").all(pid()) as unknown as ZoneSetRow[];
  if (!rows.length) {
    const dh = DEFAULT_HR_ZONES as HrZone[];
    return { id: 0, hr_zones: dh, hr_zones_bike: null as HrZone[] | null, pace_zones: [] as number[], speed_zones: [] as number[], power_zones: [] as number[], lthr: 172, ftp: 265, threshold_pace: 230, lt1_hr: dh[1]?.max ?? 155, lt1_pace: null as number | null };
  }
  let pick = rows[0];
  for (const r of rows) if (r.valid_from <= date) pick = r;
  const hr = parseJson<HrZone[]>(pick.hr_zones, DEFAULT_HR_ZONES as HrZone[]);
  const pace = parseJson<number[]>(pick.pace_zones, []);
  const lthr = pick.lthr ?? 172;
  // LT1-Default (G4): Z2/Z3-Grenze ≈ aerobe Schwelle; G3 (Laktat) überschreibt mit Messwerten.
  const lt1_hr = pick.lt1_hr ?? (hr.length >= 2 && hr[1].max ? hr[1].max : Math.round(lthr * 0.9));
  const lt1_pace = pick.lt1_pace ?? (pace.length >= 2 ? pace[1] : null);
  return {
    id: pick.id,
    hr_zones: hr,
    hr_zones_bike: pick.hr_zones_bike ? parseJson<HrZone[]>(pick.hr_zones_bike, []) : null,
    pace_zones: pace,
    speed_zones: parseJson<number[]>(pick.speed_zones, []),
    power_zones: parseJson<number[]>(pick.power_zones, []),
    lthr,
    ftp: pick.ftp ?? 265,
    threshold_pace: pick.threshold_pace ?? 230,
    lt1_hr,
    lt1_pace,
  };
}

const THRESHOLD_DEFAULTS = {
  volume_pct: 10,
  ctl_ramp_max: 7,
  acwr_high: 1.3,
  acwr_low: 0.8,
  hard_pct_max: 20,
  z3_pct_max: 15,
  longrun_pct_max: 35,
  tsb_raceweek_min: -5,
  raceweek_tss_max_pct: 60, // 7-Tage-Last vor dem Rennen max. % vom Ø-Wochen-TSS (Taper, v0.14.0)
  easy_pct: 80, // Intensitäts-Klassifikation (ToDo #7)
  hard_pct: 105,
  intensity_window_weeks: 4,
};
// Defaults + gespeicherte Werte mischen → neue Keys gelten auch für ältere Bestände.
function thresholds() {
  return { ...THRESHOLD_DEFAULTS, ...getSetting("thresholds", {} as Record<string, number>) };
}

// Tages-TSS: real (<=heute) aus activities, geplant (>heute) aus planned_sessions.
function dailyTssMap(from: string, to: string): Map<string, number> {
  const map = new Map<string, number>();
  const acts = db
    .prepare("SELECT date, SUM(COALESCE(tss,0)) s FROM activities WHERE date BETWEEN ? AND ? AND profile_id=? GROUP BY date")
    .all(from, to, pid()) as { date: string; s: number }[];
  for (const a of acts) map.set(a.date, a.s);
  const today = todayIso();
  const plans = db
    .prepare("SELECT date, SUM(COALESCE(planned_tss,0)) s FROM planned_sessions WHERE date BETWEEN ? AND ? AND profile_id=? GROUP BY date")
    .all(from, to, pid()) as { date: string; s: number }[];
  for (const p of plans) {
    if (p.date > today && !map.has(p.date)) map.set(p.date, p.s);
  }
  return map;
}

/** Frühestes Datum mit Trainingsdaten (Aktivität oder geplante Einheit) im aktiven Profil — für PMC-Seeding. */
function earliestDataDate(): string | null {
  const r = db.prepare(
    "SELECT MIN(d) m FROM (SELECT MIN(date) d FROM activities WHERE profile_id=? UNION ALL SELECT MIN(date) d FROM planned_sessions WHERE profile_id=?)",
  ).get(pid(), pid()) as { m: string | null };
  return r?.m ?? null;
}

/** ISO-Minimum zweier Datumsstrings. */
function minIso(a: string, b: string): string { return a < b ? a : b; }

// ---- settings & zones --------------------------------------------------

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/settings", (_req, res) => {
  res.json({
    thresholds: thresholds(),
    run_equiv_bike_factor: getSetting("run_equiv_bike_factor", 0.25),
    athlete: getSetting("athlete", { name: "Kolja", weight: 69, max_hr: 196 }),
    strava_client_id: getSetting("strava_client_id", ""),
    strava_client_secret: getSetting("strava_client_secret", ""),
    strava_sync_from: getSetting("strava_sync_from", ""), // Extraktions-Startdatum (v0.14.0); leer → Saisonstart

  });
});

// ---- Strava (OAuth + Sync, ToDo #10/#11) --------------------------------

app.get("/api/strava/status", stravaStatus);
app.get("/api/strava/login", stravaLogin);
app.get("/api/strava/callback", stravaCallback);
app.post("/api/strava/sync", stravaSync);
app.post("/api/strava/enrich", stravaEnrich);

// HF-/Power-Zonen aus Strava importieren (v0.14.0, ToDo 10) → neues zone_set ab gewähltem Datum.
app.post("/api/strava/import-zones", async (req, res) => {
  const validFrom = String((req.body || {}).valid_from || todayIso());
  try {
    const z = await fetchAthleteZonesAndFtp();
    // HF-Mapping: Strava-5 → App-Z1–Z5-Obergrenzen, Z6 oben drauf (offenes letztes max → min+12 schätzen).
    const maxes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const s = z.hr[i];
      maxes[i] = s ? (s.max > 0 ? s.max : s.min + 12) : (i > 0 ? maxes[i - 1] + 12 : 150);
    }
    maxes[5] = 999; // Z6 = Anaerob bis max
    const hr_zones = DEFAULT_HR_ZONES.map((dz, i) => ({ ...dz, max: maxes[i], min: i === 0 ? 0 : maxes[i - 1] + 1 }));
    const power_zones = z.power.length ? z.power.map((p) => (p.max > 0 ? p.max : 0)) : null;

    const base = effectiveZoneSet(validFrom); // LTHR/Schwellen-Pace/Pace-Zonen übernehmen (Strava liefert sie nicht)
    db.prepare(
      `INSERT INTO zone_sets(profile_id, valid_from, hr_zones, pace_zones, speed_zones, power_zones, lthr, ftp, threshold_pace, source, note, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      pid(), validFrom,
      JSON.stringify(hr_zones),
      JSON.stringify(base.pace_zones || []),
      JSON.stringify([]),
      JSON.stringify(power_zones ?? base.power_zones ?? []),
      base.lthr ?? 172,
      z.ftp ?? base.ftp ?? 265,
      base.threshold_pace ?? 230,
      "Strava",
      "aus Strava importiert (HF Z1–Z5; Z6 geschätzt — ggf. justieren)",
      todayIso(),
    );
    res.json({ ok: true });
  } catch (e) {
    const msg = /\b40[13]\b/.test(String(e))
      ? "Strava-Berechtigung fehlt — bitte unter Einstellungen neu verbinden (Zonen-Zugriff)."
      : `Strava-Zonen-Import fehlgeschlagen: ${String(e)}`;
    res.status(/\b40[13]\b/.test(String(e)) ? 403 : 500).json({ error: msg });
  }
});

app.put("/api/settings", (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) setSetting(k, v);
  res.json({ ok: true });
});

// ---- Seiten-Layout (T8): anpassbares Chart-Raster je Seite + Profil ----
// Override-Map { [blockId]: { hidden?, span?, height?, order? } }; profil-scoped über Key-Namespace.
const layoutKey = (page: string) => `layout:${page.replace(/[^a-z0-9_-]/gi, "")}:${pid()}`;
app.get("/api/layout/:page", (req, res) => {
  res.json(getSetting<Record<string, unknown>>(layoutKey(req.params.page), {}));
});
app.put("/api/layout/:page", (req, res) => {
  setSetting(layoutKey(req.params.page), req.body && typeof req.body === "object" ? req.body : {});
  res.json({ ok: true });
});

app.get("/api/zonesets", (_req, res) => {
  const rows = db.prepare("SELECT * FROM zone_sets WHERE profile_id=? ORDER BY valid_from DESC").all(pid()) as unknown as ZoneSetRow[];
  res.json(rows.map((r) => ({ ...r, hr_zones: parseJson(r.hr_zones, []), hr_zones_bike: r.hr_zones_bike ? parseJson(r.hr_zones_bike, null) : null, pace_zones: parseJson(r.pace_zones, []), speed_zones: parseJson(r.speed_zones, []), power_zones: parseJson(r.power_zones, []) })));
});

app.get("/api/zoneset", (req, res) => {
  res.json(effectiveZoneSet(String(req.query.date || todayIso())));
});

app.post("/api/zonesets", (req, res) => {
  const b = req.body || {};
  const r = db
    .prepare(
      `INSERT INTO zone_sets(profile_id, valid_from, hr_zones, hr_zones_bike, pace_zones, speed_zones, power_zones, lthr, ftp, threshold_pace, source, note, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      pid(),
      b.valid_from || todayIso(),
      JSON.stringify(b.hr_zones || DEFAULT_HR_ZONES),
      b.hr_zones_bike ? JSON.stringify(b.hr_zones_bike) : null,
      JSON.stringify(b.pace_zones || []),
      JSON.stringify(b.speed_zones || []),
      JSON.stringify(b.power_zones || []),
      b.lthr ?? 172,
      b.ftp ?? 265,
      b.threshold_pace ?? 230,
      b.source || "manuell",
      b.note || "",
      todayIso(),
    );
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put("/api/zonesets/:id", (req, res) => {
  const b = req.body || {};
  db.prepare(
    `UPDATE zone_sets SET valid_from=?, hr_zones=?, hr_zones_bike=?, pace_zones=?, speed_zones=?, power_zones=?, lthr=?, ftp=?, threshold_pace=?, source=?, note=? WHERE id=?`,
  ).run(
    b.valid_from,
    JSON.stringify(b.hr_zones || []),
    b.hr_zones_bike ? JSON.stringify(b.hr_zones_bike) : null,
    JSON.stringify(b.pace_zones || []),
    JSON.stringify(b.speed_zones || []),
    JSON.stringify(b.power_zones || []),
    b.lthr,
    b.ftp,
    b.threshold_pace,
    b.source || "manuell",
    b.note || "",
    req.params.id,
  );
  res.json({ ok: true });
});

app.delete("/api/zonesets/:id", (req, res) => {
  db.prepare("DELETE FROM zone_sets WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ---- Profile (leichter Account-Wechsel ohne Passwort, ToDo #9) ----------

app.get("/api/profiles", (_req, res) => {
  res.json({
    profiles: db.prepare("SELECT * FROM profiles ORDER BY id").all(),
    active: pid(),
  });
});

app.post("/api/profiles", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name fehlt" });
  const r = db.prepare("INSERT INTO profiles(name) VALUES(?)").run(name);
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put("/api/profiles/:id", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name fehlt" });
  db.prepare("UPDATE profiles SET name=? WHERE id=?").run(name, req.params.id);
  res.json({ ok: true });
});

app.put("/api/profile/active", (req, res) => {
  const id = Number(req.body?.id);
  const exists = db.prepare("SELECT id FROM profiles WHERE id=?").get(id);
  if (!exists) return res.status(400).json({ error: "Profil unbekannt" });
  setSetting("active_profile", id);
  res.json({ ok: true });
});

app.delete("/api/profiles/:id", (req, res) => {
  const id = Number(req.params.id);
  // Profil 1 (Kolja, Bestandsdaten) und das aktive Profil sind geschützt.
  if (id === 1 || id === pid()) return res.status(400).json({ error: "Profil ist geschützt/aktiv" });
  db.prepare("DELETE FROM profiles WHERE id=?").run(id);
  res.json({ ok: true });
});

// Profil zurücksetzen (ToDo 6, v0.12.0): löscht ALLE Trainings-/Plandaten des Profils — Aktivitäten,
// Tagesfaktoren, Wochenlogs, geplante Einheiten, Saisonplan (geplante km) und Wettkämpfe. BEHÄLT nur die
// HF-Zonen/Schwellen (Diagnostik) und das Profil selbst. Mit DB-Backup (VACUUM INTO).
app.post("/api/profiles/:id/reset", (req, res) => {
  const id = Number(req.params.id);
  if ((req.body?.code ?? "") !== "4397") return res.status(403).json({ error: "Falscher Code" });
  try {
    const bak = `${DB_PATH}.${new Date().toISOString().replace(/[:.]/g, "-")}-reset.bak`;
    db.exec(`VACUUM INTO '${bak.replace(/'/g, "''")}'`);
    const activities = db.prepare("DELETE FROM activities WHERE profile_id=?").run(id).changes ?? 0;
    const daily = db.prepare("DELETE FROM daily_log_v2 WHERE profile_id=?").run(id).changes ?? 0;
    const weeklogs = db.prepare("DELETE FROM week_log_v2 WHERE profile_id=?").run(id).changes ?? 0;
    const sessions = db.prepare("DELETE FROM planned_sessions WHERE profile_id=?").run(id).changes ?? 0;
    const weeks = db.prepare("DELETE FROM season_weeks_v2 WHERE profile_id=?").run(id).changes ?? 0;
    const races = db.prepare("DELETE FROM races WHERE profile_id=?").run(id).changes ?? 0;
    // Ledger für den Saison-Race-Auto-Import zurücksetzen, damit ein neuer Saisonplan sauber importiert.
    db.prepare("DELETE FROM settings WHERE key=?").run(`season_races_imported_${id}`);
    res.json({ ok: true, backup: bak, activities, daily, weeklogs, sessions, weeks, races });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---- Verfügbarkeits-/Präferenz-Profil (v1.4.0, A1) ----------------------

app.get("/api/availability", (_req, res) => {
  res.json(getSetting<Availability | null>(`availability_${pid()}`, null) ?? null);
});
app.put("/api/availability", (req, res) => {
  const av: Availability = req.body;
  setSetting(`availability_${pid()}`, av);
  res.json({ ok: true });
});

// ---- Races (Wettkämpfe mit Splits, ToDo #24) ----------------------------

app.get("/api/races", (req, res) => {
  const { from, to } = req.query as Record<string, string>;
  const rows = (from && to
    ? db.prepare("SELECT * FROM races WHERE date BETWEEN ? AND ? AND profile_id=? ORDER BY date").all(from, to, pid())
    : db.prepare("SELECT * FROM races WHERE profile_id=? ORDER BY date DESC").all(pid())) as any[];
  res.json(rows.map((r) => ({ ...r, splits: parseJson(r.splits, []) })));
});

app.post("/api/races", (req, res) => {
  const b = req.body || {};
  const r = db.prepare(
    `INSERT INTO races(profile_id, date, name, distance_m, time_s, placement, notes, splits, max_hr, avg_hr, elevation_m, source, goal_time_s)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(pid(), b.date, b.name || "", b.distance_m ?? null, b.time_s ?? null, b.placement || "", b.notes || "",
    JSON.stringify(b.splits || []), b.max_hr ?? null, b.avg_hr ?? null, b.elevation_m ?? null, b.source || "manual", b.goal_time_s ?? null);
  // v0.14.0 (ToDo 3): neuer Wettkampf → fehlende Wochen bis zum Renntag herstellen (Wettkampf-Planung).
  ensureSeasonWeeks(pid());
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put("/api/races/:id", (req, res) => {
  const b = req.body || {};
  db.prepare(
    `UPDATE races SET date=?, name=?, distance_m=?, time_s=?, placement=?, notes=?, splits=?, max_hr=?, avg_hr=?, elevation_m=?, goal_time_s=? WHERE id=? AND profile_id=?`,
  ).run(b.date, b.name || "", b.distance_m ?? null, b.time_s ?? null, b.placement || "", b.notes || "",
    JSON.stringify(b.splits || []), b.max_hr ?? null, b.avg_hr ?? null, b.elevation_m ?? null, b.goal_time_s ?? null, req.params.id, pid());
  res.json({ ok: true });
});

app.delete("/api/races/:id", (req, res) => {
  db.prepare("DELETE FROM races WHERE id=? AND profile_id=?").run(req.params.id, pid());
  res.json({ ok: true });
});

// ToDo Z.44: Wettkämpfe aus dem Saisonplan (goal_race) automatisch als Race anlegen — Datum = Wochen-
// Enddatum. Idempotent über ein Profil-Ledger (gelöschte Auto-Races tauchen nicht wieder auf) + Dedup
// gegen vorhandene Races mit gleichem Datum+Name. Manuelle Races bleiben unberührt.
app.post("/api/races/import-from-season", (_req, res) => {
  const profile = pid();
  const weeks = db.prepare(
    "SELECT week_no, end_date, goal_race FROM season_weeks_v2 WHERE profile_id=? AND goal_race IS NOT NULL AND TRIM(goal_race) <> ''",
  ).all(profile) as { week_no: number; end_date: string; goal_race: string }[];
  const ledgerKey = `season_races_imported_${profile}`;
  const seen = new Set(getSetting<string[]>(ledgerKey, []));
  const ins = db.prepare(
    `INSERT INTO races(profile_id, date, name, distance_m, time_s, placement, notes, splits, max_hr, elevation_m, source)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const dupQ = db.prepare("SELECT id FROM races WHERE profile_id=? AND date=? AND name=?");
  let created = 0;
  for (const w of weeks) {
    const name = w.goal_race.trim();
    const key = `${w.week_no}|${name}`;
    if (seen.has(key)) continue;
    if (!dupQ.get(profile, w.end_date, name)) {
      ins.run(profile, w.end_date, name, null, null, "", "", "[]", null, null, "season");
      created++;
    }
    seen.add(key);
  }
  setSetting(ledgerKey, [...seen]);
  res.json({ created });
});

// ---- Laktat-/Feldtest-Diagnostik (G3, v1.3.0) ----------------------------

app.get("/api/lactate-tests", (_req, res) => {
  const rows = db.prepare("SELECT * FROM lactate_tests WHERE profile_id=? ORDER BY date DESC").all(pid()) as any[];
  res.json(rows.map((r) => ({ ...r, warnings: parseJson(r.warnings, []) })));
});

app.get("/api/lactate-tests/:id", (req, res) => {
  const test = db.prepare("SELECT * FROM lactate_tests WHERE id=? AND profile_id=?").get(req.params.id, pid()) as any;
  if (!test) return res.status(404).json({ error: "Test nicht gefunden" });
  const points = db.prepare("SELECT * FROM lactate_points WHERE test_id=? ORDER BY stage, speed_kmh").all(test.id) as any[];
  res.json({ ...test, warnings: parseJson(test.warnings, []), points });
});

app.post("/api/lactate-tests", (req, res) => {
  const b = req.body || {};
  const points: LacPoint[] = Array.isArray(b.points) ? b.points : [];
  // Schwellen berechnen
  const calc = lactateThresholds(points);
  const r = db.prepare(
    `INSERT INTO lactate_tests(profile_id, date, sport, kind, notes, lt1_hr, lt1_pace, lt2_hr, lt2_pace, confidence, warnings, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    pid(), b.date || todayIso(), b.sport || "Run", b.kind || null, b.notes || null,
    calc.lt1?.hr ?? null, calc.lt1?.pace_s ?? null,
    calc.lt2?.hr ?? null, calc.lt2?.pace_s ?? null,
    calc.confidence, JSON.stringify(calc.warnings), todayIso(),
  );
  const testId = Number(r.lastInsertRowid);
  if (points.length) {
    const ins = db.prepare("INSERT INTO lactate_points(test_id,stage,speed_kmh,pace_s,power_w,hr,lactate,rpe) VALUES(?,?,?,?,?,?,?,?)");
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const kmh = p.speed_kmh ?? (p.pace_s ? 3600 / p.pace_s : null);
      const pace = p.pace_s ?? (p.speed_kmh ? Math.round(3600 / p.speed_kmh) : null);
      ins.run(testId, p.stage ?? i + 1, kmh, pace, p.power_w ?? null, p.hr ?? null, p.lactate, p.rpe ?? null);
    }
  }
  res.json({ id: testId, lt1: calc.lt1, lt2: calc.lt2, confidence: calc.confidence, warnings: calc.warnings });
});

app.put("/api/lactate-tests/:id", (req, res) => {
  const b = req.body || {};
  const existing = db.prepare("SELECT id FROM lactate_tests WHERE id=? AND profile_id=?").get(req.params.id, pid());
  if (!existing) return res.status(404).json({ error: "Test nicht gefunden" });
  const points: LacPoint[] = Array.isArray(b.points) ? b.points : [];
  const calc = points.length ? lactateThresholds(points) : null;
  db.prepare(
    `UPDATE lactate_tests SET date=?, sport=?, kind=?, notes=?, lt1_hr=?, lt1_pace=?, lt2_hr=?, lt2_pace=?, confidence=?, warnings=? WHERE id=?`,
  ).run(
    b.date, b.sport || "Run", b.kind || null, b.notes || null,
    calc?.lt1?.hr ?? b.lt1_hr ?? null, calc?.lt1?.pace_s ?? b.lt1_pace ?? null,
    calc?.lt2?.hr ?? b.lt2_hr ?? null, calc?.lt2?.pace_s ?? b.lt2_pace ?? null,
    calc?.confidence ?? b.confidence ?? null, JSON.stringify(calc?.warnings ?? b.warnings ?? []),
    req.params.id,
  );
  if (points.length) {
    db.prepare("DELETE FROM lactate_points WHERE test_id=?").run(req.params.id);
    const ins = db.prepare("INSERT INTO lactate_points(test_id,stage,speed_kmh,pace_s,power_w,hr,lactate,rpe) VALUES(?,?,?,?,?,?,?,?)");
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const kmh = p.speed_kmh ?? (p.pace_s ? 3600 / p.pace_s : null);
      const pace = p.pace_s ?? (p.speed_kmh ? Math.round(3600 / p.speed_kmh) : null);
      ins.run(req.params.id, p.stage ?? i + 1, kmh, pace, p.power_w ?? null, p.hr ?? null, p.lactate, p.rpe ?? null);
    }
  }
  res.json({ ok: true, ...(calc ? { lt1: calc.lt1, lt2: calc.lt2, confidence: calc.confidence, warnings: calc.warnings } : {}) });
});

app.delete("/api/lactate-tests/:id", (req, res) => {
  db.prepare("DELETE FROM lactate_points WHERE test_id=?").run(req.params.id);
  db.prepare("DELETE FROM lactate_tests WHERE id=? AND profile_id=?").run(req.params.id, pid());
  res.json({ ok: true });
});

// ---- VO2max-Laborwerte (v1.5.0) → Eichung der Effective-VO2max-Schätzung -------------------
app.get("/api/vo2max-lab", (_req, res) => {
  res.json(db.prepare("SELECT * FROM vo2max_lab WHERE profile_id=? ORDER BY date DESC").all(pid()));
});

app.post("/api/vo2max-lab", (req, res) => {
  const b = req.body || {};
  if (!(Number(b.value) > 0)) return res.status(400).json({ error: "value (VO2max) erforderlich" });
  const r = db.prepare(
    "INSERT INTO vo2max_lab(profile_id, date, value, source, notes, created_at) VALUES(?,?,?,?,?,?)",
  ).run(pid(), b.date || todayIso(), Number(b.value), b.source || null, b.notes || null, todayIso());
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put("/api/vo2max-lab/:id", (req, res) => {
  const b = req.body || {};
  const ex = db.prepare("SELECT id FROM vo2max_lab WHERE id=? AND profile_id=?").get(req.params.id, pid());
  if (!ex) return res.status(404).json({ error: "Nicht gefunden" });
  db.prepare("UPDATE vo2max_lab SET date=?, value=?, source=?, notes=? WHERE id=? AND profile_id=?")
    .run(b.date, Number(b.value), b.source || null, b.notes || null, req.params.id, pid());
  res.json({ ok: true });
});

app.delete("/api/vo2max-lab/:id", (req, res) => {
  db.prepare("DELETE FROM vo2max_lab WHERE id=? AND profile_id=?").run(req.params.id, pid());
  res.json({ ok: true });
});

// Effective-VO2max-Trend: Pro-Lauf-Schätzungen + lineare Labor-Eichung (Offset zwischen Labortests interpoliert).
app.get("/api/effective-vo2max-trend", (req, res) => {
  const to = String(req.query.to || todayIso());
  const from = String(req.query.from || addDaysIso(to, -365));
  const runs = db.prepare(
    "SELECT date, eff_vo2max v FROM activities WHERE profile_id=? AND sport='Run' AND eff_vo2max IS NOT NULL AND date BETWEEN ? AND ? ORDER BY date",
  ).all(pid(), from, to) as { date: string; v: number }[];
  const labs = db.prepare("SELECT date, value FROM vo2max_lab WHERE profile_id=? ORDER BY date").all(pid()) as { date: string; value: number }[];
  const allRuns = db.prepare(
    "SELECT date, eff_vo2max v FROM activities WHERE profile_id=? AND sport='Run' AND eff_vo2max IS NOT NULL ORDER BY date",
  ).all(pid()) as { date: string; v: number }[];

  // Robuster Schätz-Anker um ein Datum (±21 Tage Median) → dämpft Einzel-Lauf-Rauschen für die Eichung.
  const estAround = (d: string): number | null => {
    const lo = addDaysIso(d, -21), hi = addDaysIso(d, 21);
    const vs = allRuns.filter((r) => r.date >= lo && r.date <= hi).map((r) => r.v).sort((a, b) => a - b);
    return vs.length ? vs[Math.floor(vs.length / 2)] : null;
  };
  // Offset je Labortest = lab − Schätz-Anker; dazwischen linear interpoliert, außen konstant.
  const anchors = labs.map((l) => { const e = estAround(l.date); return { date: l.date, off: e != null ? l.value - e : 0 }; });
  const offsetAt = (d: string): number => {
    if (!anchors.length) return 0;
    if (d <= anchors[0].date) return anchors[0].off;
    if (d >= anchors[anchors.length - 1].date) return anchors[anchors.length - 1].off;
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i], b = anchors[i + 1];
      if (d >= a.date && d <= b.date) {
        const span = (Date.parse(b.date) - Date.parse(a.date)) || 1;
        const f = (Date.parse(d) - Date.parse(a.date)) / span;
        return a.off + f * (b.off - a.off);
      }
    }
    return anchors[anchors.length - 1].off;
  };

  const points = runs.map((r) => ({ date: r.date, est: r.v, calibrated: round1(r.v + offsetAt(r.date)) }));
  res.json({ points, lab: labs, calibrated: labs.length > 0 });
});

/** Zonen-Set aus Laktat-Test vorschlagen (schreibt NICHT — Nutzer bestätigt via POST /api/zonesets). */
app.post("/api/lactate-tests/:id/propose-zoneset", (req, res) => {
  const test = db.prepare("SELECT * FROM lactate_tests WHERE id=? AND profile_id=?").get(req.params.id, pid()) as any;
  if (!test) return res.status(404).json({ error: "Test nicht gefunden" });
  const lt1Hr = test.lt1_hr, lt2Hr = test.lt2_hr, lt1Pace = test.lt1_pace, lt2Pace = test.lt2_pace;
  if (!lt1Hr || !lt2Hr) return res.status(422).json({ error: "Keine LT1/LT2-HF im Test — Neuberechnung nötig." });
  const maxHr = req.body?.max_hr ?? null;
  const hrBounds = proposedHrBounds(lt1Hr, lt2Hr, maxHr);
  const hrZones: HrZone[] = (DEFAULT_HR_ZONES as HrZone[]).map((z, i) => ({
    z: z.z, min: i === 0 ? 0 : hrBounds[i - 1] + 1, max: hrBounds[i], label: z.label, color: z.color,
  }));
  const paceBounds = lt1Pace && lt2Pace ? proposedPaceBounds(lt1Pace, lt2Pace) : [];
  res.json({
    valid_from: test.date,
    lthr: Math.round(lt2Hr),
    threshold_pace: lt2Pace ? Math.round(lt2Pace) : null,
    lt1_hr: Math.round(lt1Hr),
    lt1_pace: lt1Pace ? Math.round(lt1Pace) : null,
    hr_zones: hrZones,
    pace_zones: paceBounds,
    source: `laktat-test-${test.id}`,
    note: `Vorschlag aus Laktat-Test ${test.date} (${test.sport})`,
  });
});

// ---- Wochen-/Block-Empfehlung (Engine, v1.3.0) ---------------------------

app.get("/api/plan/week-suggestion", (req, res) => {
  const weekNo = req.query.week ? Number(req.query.week) : null;
  const wk = weekNo != null
    ? db.prepare("SELECT * FROM season_weeks_v2 WHERE profile_id=? AND week_no=?").get(pid(), weekNo) as any
    : null;
  const phase = wk?.phase ?? null;

  // Form: PMC bis heute (identisch mit /api/today-Pattern)
  const today = todayIso();
  const from = minIso(earliestDataDate() ?? today, today);
  const pmcAll = computePmc(dailyTssMap(from, today), from, today, today);
  const last = pmcAll.length ? pmcAll[pmcAll.length - 1] : null;
  const ctl = last?.ctl ?? 0;
  const tsb = last?.tsb ?? null;
  const ramp = ctlRamp(pmcAll, 7);

  // Readiness (heute) — identisch mit /api/today-Pattern
  const baseHrv = (db.prepare("SELECT hrv FROM daily_log_v2 WHERE profile_id=? AND date<? AND hrv IS NOT NULL ORDER BY date DESC LIMIT 7").all(pid(), today) as { hrv: number }[]).map(r => r.hrv);
  const hrvBaseline = baseHrv.length >= 3
    ? (() => { const mean = baseHrv.reduce((a, b) => a + b, 0) / baseHrv.length; const sd = Math.sqrt(baseHrv.reduce((a, b) => a + (b - mean) ** 2, 0) / baseHrv.length); return { mean, sd }; })()
    : null;
  const todayLog = db.prepare("SELECT hrv, recovery, soreness, sleep_h FROM daily_log_v2 WHERE profile_id=? AND date=?").get(pid(), today) as any;
  const readiness = readinessScore({ hrvToday: todayLog?.hrv ?? null, hrvBaseline, recovery: todayLog?.recovery ?? null, soreness: todayLog?.soreness ?? null, sleepH: todayLog?.sleep_h ?? null });

  const inf = buildMethodInference();
  const methodPreference = inf.best && inf.confidence !== "niedrig" ? { regime: inf.best, confidence: inf.confidence } : null;
  const rec = weekStructureRecommendation({ ctl, tsb, ctlRamp: ramp, phase, weekNo, readinessLevel: readiness?.level ?? null, methodPreference });
  res.json({ week: wk, phase, form: { ctl: round1(ctl), tsb: tsb != null ? round1(tsb) : null, ramp }, readiness, recommendation: rec, methodPreference });
});

// Mesozyklus-/Block-Vorschlag bis Renntag (v1.4.0, A4) — Vorschlag-Modus, schreibt nichts.
app.get("/api/plan/block-suggestion", (req, res) => {
  const today = todayIso();
  // Startwoche: ?week= oder die Woche, die heute enthält (erste mit end_date>=heute).
  const startWk = req.query.week != null
    ? db.prepare("SELECT * FROM season_weeks_v2 WHERE profile_id=? AND week_no=?").get(pid(), Number(req.query.week)) as any
    : db.prepare("SELECT * FROM season_weeks_v2 WHERE profile_id=? AND end_date>=? ORDER BY start_date LIMIT 1").get(pid(), today) as any;
  if (!startWk) return res.json({ weeks: [], raceDate: null, reasons: [{ code: "no_weeks", text: "Kein Saisonplan vorhanden." }], confidence: "niedrig" });

  // Nächster Renntag ab Startwoche (Races-Tabelle bevorzugt, sonst goal_race-Woche).
  const raceRow = db.prepare("SELECT date, distance_m, goal_time_s FROM races WHERE profile_id=? AND date>=? ORDER BY date LIMIT 1").get(pid(), startWk.start_date) as { date: string; distance_m: number | null; goal_time_s: number | null } | undefined;
  let raceDate = raceRow?.date ?? null;

  // Wochen ab Startwoche; bei Renntag bis zur Renn-Woche, sonst rollend 6 Wochen.
  const allWeeks = db.prepare("SELECT week_no, phase, start_date, end_date, goal_race FROM season_weeks_v2 WHERE profile_id=? AND start_date>=? ORDER BY start_date").all(pid(), startWk.start_date) as any[];
  if (!raceDate) {
    const goalWk = allWeeks.find((w) => w.goal_race && String(w.goal_race).trim());
    if (goalWk) raceDate = goalWk.end_date;
  }
  let weeksRaw = allWeeks;
  if (raceDate) weeksRaw = allWeeks.filter((w) => w.start_date <= raceDate!);
  else weeksRaw = allWeeks.slice(0, 6);
  if (!weeksRaw.length) weeksRaw = [startWk];

  const weeks: BlockWeekInput[] = weeksRaw.map((w) => ({
    week_no: w.week_no, phase: w.phase ?? null, start_date: w.start_date,
    dates: Array.from({ length: 7 }, (_, i) => addDaysIso(w.start_date, i)),
  }));

  const from = minIso(earliestDataDate() ?? today, today);
  const historicalDailyTss = dailyTssMap(from, today);
  const zs = effectiveZoneSet(today);
  const runs = loadProfileRuns();
  const cur = rollingCsVdot(runs, today, 90); // aktuelle CS + bestes VDOT (ein Daten-Load)
  const csPace = cur.csPace;
  // v1.6.2: Zieldistanz aus dem angesteuerten Renntag (nur Races-Tabelle) → individuelles Renntempo via Daniels-VDOT.
  const goalDistanceM = raceRow?.distance_m && raceRow.distance_m > 0 ? Number(raceRow.distance_m) : null;
  let goalPace: number | null = null;
  if (goalDistanceM && cur.vdot) {
    const pr = predictFromVdot(cur.vdot, [goalDistanceM]);
    if (pr.length && pr[0].time_s > 0) goalPace = Math.round(pr[0].time_s / (goalDistanceM / 1000));
  }
  const zones = {
    pace_zones: zs.pace_zones, threshold_pace: zs.threshold_pace, lt1_pace: zs.lt1_pace,
    hr_zones: zs.hr_zones, cs_pace: csPace, rep_pace: csPace ? csPace - 8 : null,
    goal_distance_m: goalDistanceM, goal_pace: goalPace, cp: currentCp(),
  };

  // Verfügbarkeits-/Präferenz-Profil (A1) — wenn (noch) nicht gepflegt → null → Gleichverteilung.
  const availability = getSetting<Availability | null>(`availability_${pid()}`, null);

  // Readiness (heute) — identisch mit week-suggestion.
  const baseHrv = (db.prepare("SELECT hrv FROM daily_log_v2 WHERE profile_id=? AND date<? AND hrv IS NOT NULL ORDER BY date DESC LIMIT 7").all(pid(), today) as { hrv: number }[]).map(r => r.hrv);
  const hrvBaseline = baseHrv.length >= 3
    ? (() => { const mean = baseHrv.reduce((a, b) => a + b, 0) / baseHrv.length; const sd = Math.sqrt(baseHrv.reduce((a, b) => a + (b - mean) ** 2, 0) / baseHrv.length); return { mean, sd }; })()
    : null;
  const todayLog = db.prepare("SELECT hrv, recovery, soreness, sleep_h FROM daily_log_v2 WHERE profile_id=? AND date=?").get(pid(), today) as any;
  const readiness = readinessScore({ hrvToday: todayLog?.hrv ?? null, hrvBaseline, recovery: todayLog?.recovery ?? null, soreness: todayLog?.soreness ?? null, sleepH: todayLog?.sleep_h ?? null });

  const inf = buildMethodInference();
  const methodPreference = inf.best && inf.confidence !== "niedrig" ? { regime: inf.best, confidence: inf.confidence } : null;
  const goalTimeS = raceRow?.goal_time_s && raceRow.goal_time_s > 0 ? Number(raceRow.goal_time_s) : null; // v1.7.0 Wunsch-Zielzeit
  const plan = blockPlan({ weeks, historicalDailyTss, from, today, raceDate, zones, availability, readinessLevel: readiness?.level ?? null, methodPreference, goalDistanceM, curVdot: cur.vdot, goalTimeS });
  res.json({ ...plan, methodPreference, goalDistanceM, goalPace, goalTimeS });
});

// v1.7.0: Soll/Ist-Abgleich zum Ziel-Rennen — Prognose vs. Wunsch-Zielzeit + nötige Progression + Machbarkeit.
app.get("/api/plan/goal-gap", (_req, res) => {
  const today = todayIso();
  const race = db.prepare("SELECT id, name, date, distance_m, goal_time_s FROM races WHERE profile_id=? AND date>=? AND distance_m IS NOT NULL ORDER BY date LIMIT 1").get(pid(), today) as any;
  if (!race) return res.json({ race: null });
  const cur = rollingCsVdot(loadProfileRuns(), today, 90);
  const predicted = cur.vdot ? predictFromVdot(cur.vdot, [race.distance_m]) : [];
  const predictedTimeS = predicted.length ? predicted[0].time_s : null;
  const goalTimeS = race.goal_time_s && race.goal_time_s > 0 ? Number(race.goal_time_s) : null;
  const weeks = Math.max(0, Math.round((Date.parse(race.date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / (7 * 86400000)));
  let goalVdot: number | null = null, gapS: number | null = null, reqVdotPerWeek: number | null = null, feasible: boolean | null = null, projEndTimeS: number | null = null;
  if (goalTimeS && cur.vdot) {
    goalVdot = vdot(race.distance_m, goalTimeS);
    gapS = predictedTimeS != null ? predictedTimeS - goalTimeS : null; // >0 = noch langsamer als Wunsch
    const need = goalVdot - cur.vdot;
    reqVdotPerWeek = weeks > 0 ? Math.round((need / weeks) * 100) / 100 : null;
    feasible = need <= 0.4 * weeks + 1e-9; // realistischer Cap 0.4 VDOT/Woche
    const projEndVdot = cur.vdot + Math.min(Math.max(0, need), 0.4 * weeks);
    const pe = predictFromVdot(projEndVdot, [race.distance_m]);
    projEndTimeS = pe.length ? pe[0].time_s : null;
  }
  res.json({
    race: { id: race.id, name: race.name, date: race.date, distance_m: race.distance_m },
    weeks, curVdot: cur.vdot ? Math.round(cur.vdot * 10) / 10 : null, goalVdot: goalVdot ? Math.round(goalVdot * 10) / 10 : null,
    predictedTimeS, goalTimeS, gapS, reqVdotPerWeek, feasible, projEndTimeS,
  });
});

// ===================== v1.7.0 — Lauf-Power (Coros via Strava, Stryd-Stil) =====================
/** Beste Watt je Dauer über mehrere power_curve-JSONs aggregieren (Power-Duration-Hüllkurve). */
function aggregatePowerCurve(rows: { power_curve: string | null }[]): Record<number, number> {
  const agg: Record<number, number> = {};
  for (const r of rows) {
    const c = parseJson<Record<string, number>>(r.power_curve, {});
    for (const [d, p] of Object.entries(c)) { const dd = Number(d); if ((p || 0) > (agg[dd] || 0)) agg[dd] = p; }
  }
  return agg;
}
/** CP-Fit aus aggregierter Kurve (Dauern 2–30 min, wie der CS-Fit). */
const cpFromAgg = (agg: Record<number, number>) => {
  const pts = [120, 300, 600, 1200, 1800].filter((d) => (agg[d] || 0) > 0).map((d) => ({ time_s: d, power_w: agg[d] }));
  return pts.length >= 2 ? fitCriticalPower(pts) : null;
};
/** Aktueller CP-Fit (cp, W′) aus den Power-Kurven der letzten `windowDays`. */
function currentCpFit(windowDays = 90) {
  const from = addDaysIso(todayIso(), -windowDays);
  const rows = db.prepare("SELECT power_curve FROM activities WHERE profile_id=? AND sport='Run' AND date>=? AND power_curve IS NOT NULL AND power_curve!='{}'").all(pid(), from) as { power_curve: string }[];
  return cpFromAgg(aggregatePowerCurve(rows));
}
/** Aktuelles Critical Power (W) — Watt-Zusatzanker für die Engine. */
function currentCp(windowDays = 90): number | null {
  return currentCpFit(windowDays)?.cp ?? null;
}

app.get("/api/power-curve", (req, res) => {
  const windowDays = Math.max(7, Math.min(365, Number((req.query as Record<string, string>).window) || 90));
  const from = addDaysIso(todayIso(), -windowDays);
  const rows = db.prepare("SELECT date, name, moving_s, run_np, power_curve FROM activities WHERE profile_id=? AND sport='Run' AND date>=? AND power_curve IS NOT NULL AND power_curve!='{}' ORDER BY date DESC").all(pid(), from) as { date: string; name: string | null; moving_s: number | null; run_np: number | null; power_curve: string }[];
  const agg = aggregatePowerCurve(rows);
  const fit = cpFromAgg(agg);
  const cp = fit?.cp ?? null;
  const zones = cp ? powerZonesFromCp(cp) : [];
  const recent = cp ? rows.filter((r) => r.run_np).slice(0, 12).map((r) => ({ date: r.date, name: r.name, runNp: r.run_np, rss: runningStressScore(r.run_np!, cp, r.moving_s || 0) })) : [];
  res.json({ window: windowDays, n: rows.length, curve: agg, durations: POWER_CURVE_DURATIONS, cp, wPrime: fit?.wPrime ?? null, rSquared: fit?.rSquared ?? null, zones, recent });
});

// v1.8.0: Workout-Bibliothek (für Block-Präferenzen — Lieblings/Vermeiden-Auswahl im Profil).
app.get("/api/workouts", (_req, res) => {
  const lib = WORKOUT_LIBRARY.filter((t) => t.kind !== "core").map((t) => ({ id: t.id, name: t.name, family: t.family, purpose: t.purpose, effort: t.effort, custom: false }));
  const cust = customWorkoutList().map((t) => ({ id: t.id, name: t.name, family: t.family, purpose: t.purpose, effort: t.effort, custom: true }));
  res.json([...lib, ...cust]);
});

// v1.9.0 (Z14): eigene Einheiten CRUD. Anlegen schätzt Familie/Anstrengung/TSS vor (estimateCustom).
app.get("/api/custom-workouts", (_req, res) => {
  const rows = db.prepare("SELECT id, name, family, template, created_at FROM custom_workouts WHERE profile_id=? ORDER BY id DESC").all(pid()) as { id: number; name: string; family: string; template: string; created_at: string }[];
  res.json(rows.map((r) => ({ id: r.id, name: r.name, family: r.family, template: parseJson(r.template, null), created_at: r.created_at })));
});
app.post("/api/custom-workouts/estimate", (req, res) => {
  res.json(estimateCustom(req.body as CustomInput));
});
app.post("/api/custom-workouts", (req, res) => {
  const { template, tssEstimate } = estimateCustom(req.body as CustomInput);
  const r = db.prepare("INSERT INTO custom_workouts(profile_id, name, family, template, created_at) VALUES(?,?,?,?,?)")
    .run(pid(), template.name, template.family, JSON.stringify(template), todayIso());
  res.json({ id: Number(r.lastInsertRowid), template, tssEstimate });
});
app.delete("/api/custom-workouts/:id", (req, res) => {
  db.prepare("DELETE FROM custom_workouts WHERE id=? AND profile_id=?").run(req.params.id, pid());
  res.json({ ok: true });
});

// v1.8.0: Tutorial-Profil verwalten (Beispieljahr neu erzeugen / löschen). Berührt nur das eigene profile_id.
app.get("/api/tutorial", (_req, res) => res.json({ id: tutorialProfileId() }));
app.post("/api/tutorial/regenerate", (_req, res) => { const id = regenerateTutorial(todayIso()); res.json({ ok: true, id }); });
app.delete("/api/tutorial", (_req, res) => { deleteTutorial(); res.json({ ok: true }); });

app.get("/api/cp-trend", (req, res) => {
  const months = Math.max(3, Math.min(36, Number((req.query as Record<string, string>).months) || 12));
  const today = todayIso();
  const rows = db.prepare("SELECT date, power_curve FROM activities WHERE profile_id=? AND sport='Run' AND power_curve IS NOT NULL AND power_curve!='{}' ORDER BY date").all(pid()) as { date: string; power_curve: string }[];
  const points: { date: string; cp: number }[] = [];
  for (let m = months - 1; m >= 0; m--) {
    const end = addDaysIso(today, -m * 30);
    const start = addDaysIso(end, -90); // rollendes 90-Tage-Fenster, monatlich gesteppt
    const fit = cpFromAgg(aggregatePowerCurve(rows.filter((r) => r.date > start && r.date <= end)));
    if (fit?.cp) points.push({ date: end, cp: fit.cp });
  }
  res.json({ points });
});

// v1.8.0: Running Effectiveness (Ökonomie-Trend) — Speed pro Watt je gleichmäßigem Lauf, masseunabhängiger Trend.
app.get("/api/run-effectiveness", (req, res) => {
  const windowDays = Math.max(14, Math.min(365, Number((req.query as Record<string, string>).window) || 90));
  const mass = Number((getSetting("athlete", { weight: 69 }) as { weight?: number }).weight) || 69;
  const from = addDaysIso(todayIso(), -windowDays);
  const rows = db.prepare("SELECT date, distance_m, moving_s, run_np FROM activities WHERE profile_id=? AND sport='Run' AND date>=? AND run_np IS NOT NULL AND distance_m>0 AND moving_s>0 AND COALESCE(type,'') IN ('Easy','Long','Steady','Recovery','') ORDER BY date").all(pid(), from) as { date: string; distance_m: number; moving_s: number; run_np: number }[];
  const points = rows.map((r) => ({ date: r.date, re: runningEffectiveness(r.distance_m, r.moving_s, r.run_np, mass) })).filter((p): p is { date: string; re: number } => p.re != null);
  // Trend: Mittel erstes vs. letztes Drittel.
  const third = Math.max(1, Math.floor(points.length / 3));
  const avg = (a: { re: number }[]) => a.length ? a.reduce((s, p) => s + p.re, 0) / a.length : null;
  const early = avg(points.slice(0, third)), late = avg(points.slice(-third));
  res.json({ window: windowDays, mass, n: points.length, points, early, late, deltaPct: early && late ? Math.round(((late - early) / early) * 1000) / 10 : null });
});

// v1.8.0: W′-bal der jüngsten Intervall-Einheit — aus der Intervall-Struktur (efforts) + CP rekonstruiert.
const ZONE_CP_PCT: Record<number, number> = { 1: 0.65, 2: 0.78, 3: 0.88, 4: 0.96, 5: 1.07, 6: 1.18 };
app.get("/api/wprime/latest", (_req, res) => {
  const fit = currentCpFit();
  if (!fit?.cp || !fit.wPrime || fit.wPrime <= 0) return res.json({ available: false });
  const row = db.prepare("SELECT id, date, name, type, efforts FROM activities WHERE profile_id=? AND sport='Run' AND efforts IS NOT NULL AND efforts NOT IN ('','[]','null') AND COALESCE(type,'') IN ('VO2','Race') ORDER BY date DESC LIMIT 1").get(pid()) as { id: number; date: string; name: string | null; type: string; efforts: string } | undefined;
  if (!row) return res.json({ available: false });
  const efforts = parseJson<{ reps?: number; sec?: number | null; dist_m?: number | null; pace_s?: number | null; zone?: number | null; rest_s?: number | null; rest_type?: string | null }[]>(row.efforts, []);
  const power: number[] = [], time: number[] = []; let t = 0;
  const push = (sec: number, p: number) => { const s = Math.max(1, Math.round(sec)); for (let i = 0; i < s; i++) { power.push(p); time.push(t++); } };
  push(180, Math.round(fit.cp * 0.65)); // kurzes Warm-up
  for (const e of efforts) {
    const reps = Math.max(1, e.reps ?? 1);
    const workPwr = Math.round(fit.cp * (ZONE_CP_PCT[e.zone ?? 4] ?? 0.96));
    const workSec = e.sec ?? (e.dist_m && e.pace_s ? (e.dist_m / 1000) * e.pace_s : 60);
    const restPwr = Math.round(fit.cp * (e.rest_type === "stand" ? 0.3 : 0.55));
    for (let r = 0; r < reps; r++) { push(workSec, workPwr); push(e.rest_s ?? 60, restPwr); }
  }
  const wb = wPrimeBalance(power, time, fit.cp, fit.wPrime);
  // Verlauf auf ~160 Punkte ausdünnen.
  const step = Math.max(1, Math.ceil(wb.curve.length / 160));
  const curve = wb.curve.filter((_, i) => i % step === 0).map((c) => ({ t: Math.round(c.t / 60 * 10) / 10, bal: c.bal }));
  const pct = Math.round((wb.minBal / fit.wPrime) * 100);
  const verdict = wb.minBal > fit.wPrime * 0.15 ? "Pausen ausreichend — die anaerobe Reserve bleibt komfortabel."
    : wb.minBal > 0 ? "Knapp — W′ wird tief angezapft, Pausen gerade noch ok."
      : "Sehr fordernd — W′ läuft ins Defizit; Pausen evtl. zu kurz oder Tempo zu hoch.";
  res.json({ available: true, activity: { id: row.id, date: row.date, name: row.name, type: row.type }, cp: fit.cp, wPrime: fit.wPrime, minBal: wb.minBal, minPct: pct, timeInDeficitS: wb.timeInDeficitS, tau: wb.tau, curve, verdict });
});

// ===================== N-of-1 Methoden-Findung (v1.6.0) =====================

/** HF-Zonen-Minuten einer Aktivität: Priorität zone_km > zone_min > zones (wie im /api/analyze). */
function activityZoneMin(a: any, paceZones: number[] | undefined): Record<number, number> {
  const zKm = parseJson<Record<string, number> | null>(a.zone_km, null);
  const zMin = parseJson<Record<string, number> | null>(a.zone_min, null);
  const zSec = parseJson<Record<string, number> | null>(a.zones, null);
  const out: Record<number, number> = {};
  const hasKm = !!zKm && Object.values(zKm).some((v) => (v || 0) > 0);
  if (hasKm) {
    const avgPace = a.distance_m && a.moving_s ? a.moving_s / (a.distance_m / 1000) : null;
    for (const [z, km] of Object.entries(zKm!)) { const zi = Number(z); if (!km) continue; const pace = paceZones?.[zi - 1] || avgPace || 300; out[zi] = (out[zi] || 0) + (km * pace) / 60; }
  } else if (zMin) { for (const [z, m] of Object.entries(zMin)) out[Number(z)] = (out[Number(z)] || 0) + (m || 0); }
  else if (zSec) { for (const [z, s] of Object.entries(zSec)) out[Number(z)] = (out[Number(z)] || 0) + (s || 0) / 60; }
  return out;
}

/** Baut einen Marker-Snapshot aus der DB (Fenster [endDate-windowDays, endDate]). */
function buildMarkerSnapshot(endDate: string, windowDays: number) {
  const startDate = addDaysIso(endDate, -windowDays);
  const zs = effectiveZoneSet(endDate);
  const rows = db.prepare(
    "SELECT date, sport, type, best_efforts, ngp, avg_hr, decoupling, eff_vo2max, zone_min, zone_km, zones, distance_m, moving_s FROM activities WHERE profile_id=? AND date>=? AND date<=? ORDER BY date",
  ).all(pid(), startDate, endDate) as any[];
  const activities: MarkerActivity[] = rows.map((a) => ({
    date: a.date, sport: a.sport, type: a.type,
    best_efforts: parseJson<Record<string, number> | null>(a.best_efforts, null),
    ngp: a.ngp ?? null, avg_hr: a.avg_hr ?? null, decoupling: a.decoupling ?? null, eff_vo2max: a.eff_vo2max ?? null,
    zoneMin: activityZoneMin(a, zs.pace_zones),
  }));
  const lacRows = db.prepare(
    "SELECT id, date FROM lactate_tests WHERE profile_id=? AND date BETWEEN ? AND ? ORDER BY date",
  ).all(pid(), addDaysIso(endDate, -120), addDaysIso(endDate, 30)) as { id: number; date: string }[];
  const lactateTests: MarkerLactateTest[] = lacRows.map((t) => ({
    date: t.date,
    points: (db.prepare("SELECT pace_s, speed_kmh, lactate FROM lactate_points WHERE test_id=?").all(t.id) as any[])
      .map((p) => ({ pace_s: p.pace_s ?? null, speed_kmh: p.speed_kmh ?? null, lactate: p.lactate })),
  }));
  return markerSnapshot({
    endDate, windowDays, activities,
    zones: { hr_zones: zs.hr_zones, threshold_pace: zs.threshold_pace, lthr: zs.lthr, lt1_hr: zs.lt1_hr },
    lactateTests,
  });
}

const SUB_THR_RE = /threshold|lt2|sub|tempo|schwelle/i;

interface RunLite { date: string; type: string | null; best_efforts: Record<string, number> | null; zone_km: any; zone_min: any; zones: any; distance_m: number; moving_s: number }

/** Alle Läufe des aktiven Profils einmal laden (best_efforts geparst) — Basis für die schnelle Inferenz. */
function loadProfileRuns(): RunLite[] {
  const rows = db.prepare(
    "SELECT date, type, best_efforts, zone_km, zone_min, zones, distance_m, moving_s FROM activities WHERE profile_id=? AND sport='Run' ORDER BY date",
  ).all(pid()) as any[];
  return rows.map((a) => ({
    date: a.date, type: a.type, best_efforts: parseJson<Record<string, number> | null>(a.best_efforts, null),
    zone_km: a.zone_km, zone_min: a.zone_min, zones: a.zones, distance_m: a.distance_m, moving_s: a.moving_s,
  }));
}

/** Leichte Rolling-CS + bestes VDOT aus dem In-Memory-Lauf-Set — identische Mathe zu markerSnapshot, ohne den Rest. */
function rollingCsVdot(runs: RunLite[], endDate: string, windowDays: number): { csPace: number | null; vdot: number | null } {
  const startDate = addDaysIso(endDate, -windowDays);
  const bestByDist = new Map<number, number>();
  for (const a of runs) {
    if (a.date < startDate || a.date > endDate || !a.best_efforts) continue;
    for (const [dStr, tRaw] of Object.entries(a.best_efforts)) {
      const d = Number(dStr), t = Number(tRaw);
      if (!(d > 0) || !(t > 0)) continue;
      const cur = bestByDist.get(d);
      if (cur == null || t < cur) bestByDist.set(d, t);
    }
  }
  const allPts = [...bestByDist.entries()].map(([d, t]) => ({ distance_m: d, time_s: t }));
  const cs = fitCriticalSpeed(allPts.filter((p) => p.time_s >= 120 && p.time_s <= 1800));
  let vd = 0;
  for (const p of allPts) if (p.distance_m >= 1500 && p.time_s >= 180 && p.time_s <= 2400) { const v = vdot(p.distance_m, p.time_s); if (v > vd) vd = v; }
  return { csPace: cs?.cs_pace_s ?? null, vdot: vd > 0 ? Math.round(vd * 10) / 10 : null };
}

// In-Memory-Cache der Methoden-Inferenz (advisory, langsam wechselnd). Globale Version, bei jedem Schreibzugriff
// hochgezählt (Middleware) → nächster Plan-Aufruf rechnet neu; alle GETs dazwischen nutzen den Cache.
let inferenceVersion = 0;
const inferenceCache = new Map<number, { version: number; result: ReturnType<typeof methodInference> }>();
function invalidateInference(): void { inferenceVersion++; }

/** Berechnet die passive Methoden-Inferenz — ein Daten-Load, In-Memory-Fenster, leichte Rolling-CS. */
function computeMethodInference() {
  const today = todayIso();
  const runs = loadProfileRuns();
  const weeksRows = db.prepare(
    "SELECT week_no, phase, start_date, end_date FROM season_weeks_v2 WHERE profile_id=? AND start_date<=? ORDER BY start_date",
  ).all(pid(), today) as any[];
  const recent = weeksRows.slice(-60); // letzte ~60 Wochen
  const from = minIso(earliestDataDate() ?? today, today);
  const pmc = computePmc(dailyTssMap(from, today), from, today, today);
  const ctlByDate = new Map<string, number>();
  for (const p of pmc) ctlByDate.set(p.date, p.ctl);
  const raceDatesArr = (db.prepare("SELECT date FROM races WHERE profile_id=?").all(pid()) as { date: string }[]).map((r) => r.date);

  const input: WeekRegimeInput[] = [];
  for (const w of recent) {
    const acts = runs.filter((a) => a.date >= w.start_date && a.date <= w.end_date);
    if (!acts.length) continue;
    const zs = effectiveZoneSet(w.end_date);
    const agg: Record<number, number> = {};
    for (const a of acts) { const zm = activityZoneMin(a, zs.pace_zones); for (const [z, m] of Object.entries(zm)) agg[Number(z)] = (agg[Number(z)] || 0) + m; }
    const dist = Object.keys(agg).length ? physioTimeZones(agg, zs.hr_zones, zs.lt1_hr, zs.lthr) : null;
    const pi = dist ? polarizationIndex(dist.z1, dist.z2, dist.z3) : null;
    const sessions = acts.map((a) => ({ type: a.type || "", subThreshold: SUB_THR_RE.test(a.type || "") }));
    const byDay = new Map<string, number>();
    for (const a of acts) if (SUB_THR_RE.test(a.type || "")) byDay.set(a.date, (byDay.get(a.date) || 0) + 1);
    const doubleThresholdDays = [...byDay.values()].filter((c) => c >= 2).length;
    const ph = String(w.phase || "").toLowerCase();
    const hasRace = raceDatesArr.some((d) => d >= w.start_date && d <= w.end_date);
    const excluded = ph.includes("krank") || ph.includes("race") || ph.includes("taper") || ph.includes("entlast") || ph.includes("deload") || hasRace;
    const { csPace, vdot: vd } = rollingCsVdot(runs, w.end_date, 42);
    input.push({
      week_no: w.week_no, start_date: w.start_date, phase: w.phase ?? null,
      dist, pi, ctl: ctlByDate.get(w.start_date) ?? null,
      sessions, doubleThresholdDays, excluded, csPace, vdot: vd,
    });
  }
  return methodInference(input, { lagWeeks: 3, ctlBand: 8 });
}

/** Gecachte Methoden-Inferenz (pro Profil; invalidiert bei jedem Schreibzugriff). */
function buildMethodInference() {
  const p = pid();
  const cached = inferenceCache.get(p);
  if (cached && cached.version === inferenceVersion) return cached.result;
  const result = computeMethodInference();
  inferenceCache.set(p, { version: inferenceVersion, result });
  return result;
}

// CRUD geführte Experimente
app.get("/api/method-experiments", (_req, res) => {
  res.json(db.prepare("SELECT * FROM method_experiments WHERE profile_id=? ORDER BY start_date DESC").all(pid()));
});
app.post("/api/method-experiments", (req, res) => {
  const b = req.body || {};
  if (!b.start_date || !b.method) return res.status(400).json({ error: "start_date + method erforderlich" });
  const r = db.prepare(
    "INSERT INTO method_experiments(profile_id, start_date, end_date, method, label, notes, created_at) VALUES(?,?,?,?,?,?,?)",
  ).run(pid(), b.start_date, b.end_date || null, b.method, b.label || null, b.notes || null, todayIso());
  res.json({ id: Number(r.lastInsertRowid) });
});
app.put("/api/method-experiments/:id", (req, res) => {
  const b = req.body || {};
  const ex = db.prepare("SELECT id FROM method_experiments WHERE id=? AND profile_id=?").get(req.params.id, pid());
  if (!ex) return res.status(404).json({ error: "Nicht gefunden" });
  db.prepare("UPDATE method_experiments SET start_date=?, end_date=?, method=?, label=?, notes=? WHERE id=? AND profile_id=?")
    .run(b.start_date, b.end_date || null, b.method, b.label || null, b.notes || null, req.params.id, pid());
  res.json({ ok: true });
});
app.delete("/api/method-experiments/:id", (req, res) => {
  db.prepare("DELETE FROM method_experiments WHERE id=? AND profile_id=?").run(req.params.id, pid());
  res.json({ ok: true });
});

// Aktueller Marker-Snapshot (für die Methodik-Seite)
app.get("/api/markers", (req, res) => {
  const date = String(req.query.date || todayIso());
  const window = req.query.window ? Number(req.query.window) : 14;
  res.json(buildMarkerSnapshot(date, Math.max(7, Math.min(60, window || 14))));
});

// Auswertung eines Experiments: Vorher/Nachher-Snapshots + Vergleich
app.get("/api/method-experiments/:id/evaluation", (req, res) => {
  const exp = db.prepare("SELECT * FROM method_experiments WHERE id=? AND profile_id=?").get(req.params.id, pid()) as any;
  if (!exp) return res.status(404).json({ error: "Experiment nicht gefunden" });
  const w = Math.max(7, Math.min(60, req.query.window ? Number(req.query.window) || 14 : 14));
  const endDate = exp.end_date || todayIso();
  const start = buildMarkerSnapshot(exp.start_date, w);
  const end = buildMarkerSnapshot(endDate, w);
  res.json({ experiment: exp, window: w, start, end, evaluation: compareMarkers(start, end) });
});

// Passive Methoden-Inferenz
app.get("/api/method-inference", (_req, res) => {
  res.json(buildMethodInference());
});

// ---- Bestzeiten + VDOT-Prognose (v0.14.0, ToDo 8) -----------------------
// PBs je Standarddistanz aus Stravas best_efforts; Renn-Prognosen über das Jack-Daniels-VDOT-Modell
// (leistungs-äquivalente Zeiten) für 5k/10k/HM/M — dauerabhängig, daher realistisch für lange Distanzen.
const CS_PRED_DISTANCES = [5000, 10000, 21097, 42195];
const FITNESS_WINDOW_DAYS = 90; // Rolling-Window für die aktuelle VDOT-/VO2max-Schätzung (Prognose-Quelle)
app.get("/api/bests", (_req, res) => {
  const today = todayIso();
  const rows = db.prepare(
    "SELECT date, name, best_efforts FROM activities WHERE profile_id=? AND sport='Run' AND best_efforts IS NOT NULL AND best_efforts<>'' AND best_efforts<>'{}'",
  ).all(pid()) as { date: string; name: string; best_efforts: string }[];
  const best = new Map<number, { distance_m: number; time_s: number; date: string; name: string; manual: boolean }>();
  for (const r of rows) {
    const be = parseJson<Record<string, number>>(r.best_efforts, {});
    for (const [d, t] of Object.entries(be)) {
      const dist = Number(d), time = Number(t);
      if (!(dist > 0 && time > 0)) continue;
      const cur = best.get(dist);
      if (!cur || time < cur.time_s) best.set(dist, { distance_m: dist, time_s: time, date: r.date, name: r.name, manual: false });
    }
  }
  // Manuelle Overrides überschreiben Strava-PBs für die jeweilige Distanz.
  const overrides = db.prepare("SELECT distance_m, time_s, date FROM pb_overrides WHERE profile_id=?").all(pid()) as { distance_m: number; time_s: number; date: string }[];
  for (const o of overrides) {
    best.set(o.distance_m, { distance_m: o.distance_m, time_s: o.time_s, date: o.date, name: "manuell", manual: true });
  }
  const pbs = [...best.values()]
    .map((p) => ({ ...p, pace_s: Math.round(p.time_s / (p.distance_m / 1000)) }))
    .sort((a, b) => a.distance_m - b.distance_m);

  // Prognose-Quelle = AKTUELLE Form, nicht der Allzeit-Bestwert: bestes VDOT im 90-Tage-Fenster (≥1500 m, 3–40 min).
  // Identisch zur Dashboard-VO2max (/api/fitness-trend, letzter Punkt) → Prognose folgt der Form, nicht der je besten Zeit.
  const winLo = addDaysIso(today, -FITNESS_WINDOW_DAYS);
  let curVdot = 0;
  for (const r of rows) {
    if (!(r.date > winLo && r.date <= today)) continue;
    const be = parseJson<Record<string, number>>(r.best_efforts, {});
    for (const [d, t] of Object.entries(be)) {
      const dist = Number(d), time = Number(t);
      if (dist >= 1500 && time >= 180 && time <= 2400) curVdot = Math.max(curVdot, vdot(dist, time));
    }
  }
  const predictions = curVdot > 0 ? predictFromVdot(curVdot, CS_PRED_DISTANCES) : [];

  const athlete = getSetting("athlete", { name: "Kolja", weight: 69, max_hr: 196 }) as { birth_year?: number; sex?: string };
  const birthYear = athlete?.birth_year ? Number(athlete.birth_year) : null;
  const sex: "m" | "f" = athlete?.sex === "f" ? "f" : "m";
  const age = birthYear ? Number(today.slice(0, 4)) - birthYear : null;
  const vdotVal = curVdot > 0 ? Math.round(curVdot * 10) / 10 : null;
  const vdotLevel = vdotVal != null && age ? vo2maxLevel(vdotVal, age, sex) : null;
  res.json({ pbs, vdot: vdotVal, vdotLevel, age, predictions });
});

app.put("/api/bests/override", (req, res) => {
  const { distance_m, time_s, date } = req.body as { distance_m: number; time_s: number; date: string };
  if (!(distance_m > 0 && time_s > 0 && date)) return res.status(400).json({ error: "invalid" });
  db.prepare("INSERT INTO pb_overrides (profile_id, distance_m, time_s, date) VALUES (?,?,?,?) ON CONFLICT(profile_id, distance_m) DO UPDATE SET time_s=excluded.time_s, date=excluded.date")
    .run(pid(), distance_m, time_s, date);
  res.json({ ok: true });
});

app.delete("/api/bests/override/:distance_m", (req, res) => {
  db.prepare("DELETE FROM pb_overrides WHERE profile_id=? AND distance_m=?").run(pid(), Number(req.params.distance_m));
  res.json({ ok: true });
});

// ---- Race-Pacing (v1.4.0, B1): Zielzeit → km-Splits (GAP-korrigiert, optional Negativ-Split) ----
// Default-Zielzeit: ?target= (s) > eigene Renn-Zeit > VDOT-Prognose (aktuelle Form). GAP nur bei ?gap=1
// und vorhandenem Höhenprofil (splits.elevation_m als Netto-Gewinn je km interpretiert).
app.get("/api/races/:id/pacing", (req, res) => {
  const race = db.prepare("SELECT id, name, distance_m, time_s, splits FROM races WHERE profile_id=? AND id=?")
    .get(pid(), Number(req.params.id)) as { id: number; name: string; distance_m: number; time_s: number | null; splits: string | null } | undefined;
  if (!race || !(race.distance_m > 0)) return res.status(404).json({ error: "race_not_found_or_no_distance" });

  // Default-Zielzeit aus aktueller Form (bestes VDOT im 90-Tage-Fenster) — wie /api/bests.
  const today = todayIso();
  let vdotTarget: number | null = null;
  if (!req.query.target && !race.time_s) {
    const winLo = addDaysIso(today, -FITNESS_WINDOW_DAYS);
    const rows = db.prepare("SELECT date, best_efforts FROM activities WHERE profile_id=? AND sport='Run' AND best_efforts IS NOT NULL AND best_efforts<>'' AND best_efforts<>'{}'").all(pid()) as { date: string; best_efforts: string }[];
    let curVdot = 0;
    for (const r of rows) {
      if (!(r.date > winLo && r.date <= today)) continue;
      const be = parseJson<Record<string, number>>(r.best_efforts, {});
      for (const [d, t] of Object.entries(be)) { const dist = Number(d), time = Number(t); if (dist >= 1500 && time >= 180 && time <= 2400) curVdot = Math.max(curVdot, vdot(dist, time)); }
    }
    if (curVdot > 0) { const pr = predictFromVdot(curVdot, [race.distance_m]); vdotTarget = pr.length ? pr[0].time_s : null; }
  }
  const targetTimeS = req.query.target ? Number(req.query.target) : (race.time_s || vdotTarget || 0);
  if (!(targetTimeS > 0)) return res.json({ error: "no_target", message: "Keine Zielzeit (weder Parameter noch Renn-Zeit noch VDOT-Prognose)." });

  // Höhenprofil aus Race-Splits (nur wenn ?gap=1 und Höhenwerte vorhanden).
  let profile: PacingProfileKm[] | null = null;
  if (req.query.gap) {
    const splits = parseJson<{ km: number; elevation_m: number | null }[]>(race.splits, []);
    if (splits.some((s) => s.elevation_m != null)) {
      profile = splits.map((s) => ({ dist_km: s.km > 0 ? s.km : 1, elev_gain_m: s.elevation_m ?? null }));
    }
  }

  const plan = pacingPlan({ distanceM: race.distance_m, targetTimeS, profile, negativeSplit: !!req.query.neg, splitPct: req.query.split ? Number(req.query.split) : undefined });
  res.json({ race: { id: race.id, name: race.name, distance_m: race.distance_m }, source: req.query.target ? "manual" : (race.time_s ? "race" : "vdot"), ...plan });
});

// ---- Fitness-Trend: VO2max (VDOT) + Renn-Prognose über die Zeit (v0.15.0, O1+O2) ----
// 90-Tage-Rolling-Window über die Strava-best_efforts: je Woche bestes VDOT + VDOT-Prognosen.
app.get("/api/fitness-trend", (req, res) => {
  const today = todayIso();
  const to = String(req.query.to || today);
  const from = String(req.query.from || addDaysIso(to, -365));

  const rows = db.prepare(
    "SELECT date, best_efforts FROM activities WHERE profile_id=? AND sport='Run' AND best_efforts IS NOT NULL AND best_efforts<>'' AND best_efforts<>'{}'",
  ).all(pid()) as { date: string; best_efforts: string }[];
  const efforts: { date: string; distance_m: number; time_s: number }[] = [];
  for (const r of rows) {
    const be = parseJson<Record<string, number>>(r.best_efforts, {});
    for (const [d, t] of Object.entries(be)) {
      const dist = Number(d), time = Number(t);
      if (dist > 0 && time > 0) efforts.push({ date: r.date, distance_m: dist, time_s: time });
    }
  }

  // Wochen-Stützstellen rückwärts ab `to` (letzter Punkt = heute), dann chronologisch.
  const weekEnds: string[] = [];
  for (let w = to; w >= from; w = addDaysIso(w, -7)) weekEnds.push(w);
  weekEnds.reverse();

  const points = weekEnds.map((w) => {
    const lo = addDaysIso(w, -FITNESS_WINDOW_DAYS);
    const inWin = efforts.filter((e) => e.date > lo && e.date <= w);
    const bestPerDist = new Map<number, number>();
    for (const e of inWin) {
      const cur = bestPerDist.get(e.distance_m);
      if (cur == null || e.time_s < cur) bestPerDist.set(e.distance_m, e.time_s);
    }
    const distPts = [...bestPerDist.entries()].map(([distance_m, time_s]) => ({ distance_m, time_s }));
    // VDOT nur aus überwiegend aeroben Leistungen (≥1500 m, 3–40 min) — kurze Sprints überschätzen VO2max; 40 min schließt den 10k ein.
    let bestVdot = 0;
    for (const p of distPts) if (p.distance_m >= 1500 && p.time_s >= 180 && p.time_s <= 2400) bestVdot = Math.max(bestVdot, vdot(p.distance_m, p.time_s));
    const pmap = new Map((bestVdot > 0 ? predictFromVdot(bestVdot, CS_PRED_DISTANCES) : []).map((x) => [x.distance_m, x.time_s]));
    return {
      date: w,
      vdot: bestVdot > 0 ? Math.round(bestVdot * 10) / 10 : null,
      p5000: pmap.get(5000) ?? null,
      p10000: pmap.get(10000) ?? null,
      p21097: pmap.get(21097) ?? null,
      p42195: pmap.get(42195) ?? null,
    };
  });

  const current = [...points].reverse().find((p) => p.vdot != null) ?? null;
  const athlete = getSetting("athlete", { name: "Kolja", weight: 69, max_hr: 196 }) as { birth_year?: number; sex?: string };
  const birthYear = athlete?.birth_year ? Number(athlete.birth_year) : null;
  const sex: "m" | "f" = athlete?.sex === "f" ? "f" : "m";
  const age = birthYear ? Number(today.slice(0, 4)) - birthYear : null;
  const level = current?.vdot != null && age ? vo2maxLevel(current.vdot, age, sex) : null;
  res.json({ points, current, age, level });
});

// Aerobe Entkopplung je Lauf (v1.4.0, C1) — Zeitreihe für Durability/Decoupling-Trend in LongTerm.
// Nur Läufe ≥30 min mit berechneter Entkopplungs-Kennzahl (aus Streams, backfill via Strava-Sync).
app.get("/api/decoupling-trend", (req, res) => {
  const today = todayIso();
  const to = String(req.query.to || today);
  const from = String(req.query.from || addDaysIso(to, -365));
  const rows = db.prepare(
    "SELECT date, decoupling, distance_m FROM activities WHERE profile_id=? AND sport='Run' AND decoupling IS NOT NULL AND moving_s >= 1800 AND date BETWEEN ? AND ? ORDER BY date",
  ).all(pid(), from, to) as { date: string; decoupling: number; distance_m: number | null }[];
  res.json(rows.map((r) => ({
    date: r.date,
    decoupling: Math.round(r.decoupling * 10) / 10,
    distance_km: r.distance_m ? Math.round(r.distance_m / 100) / 10 : null,
  })));
});

// Plan-Erfüllung je Saisonwoche (v0.14.0, ToDo 12) — Wochenmittel für den Langzeit-Trend.
app.get("/api/plan-adherence", (_req, res) => {
  const weeks = db.prepare("SELECT week_no, start_date, end_date FROM season_weeks_v2 WHERE profile_id=? ORDER BY start_date").all(pid()) as { week_no: number; start_date: string; end_date: string }[];
  const out = weeks.map((w) => {
    const sessions = db.prepare("SELECT id, planned_tss, zone_alloc FROM planned_sessions WHERE profile_id=? AND date BETWEEN ? AND ?").all(pid(), w.start_date, w.end_date) as any[];
    const acts = db.prepare("SELECT tss, pace_zone_min, matched_session_id FROM activities WHERE profile_id=? AND date BETWEEN ? AND ?").all(pid(), w.start_date, w.end_date) as any[];
    const paceZones = effectiveZoneSet(w.start_date).pace_zones;
    const pcts: number[] = [];
    for (const s of sessions) {
      const a = acts.find((x) => x.matched_session_id === s.id);
      if (!a) continue;
      const comp = sessionCompletion(
        { planned_tss: s.planned_tss, zone_alloc: parseJson(s.zone_alloc, null) },
        { tss: a.tss, pace_zone_min: parseJson<Record<number, number> | null>(a.pace_zone_min, null) },
        paceZones,
      );
      if (comp) pcts.push(comp.pct);
    }
    const pct = pcts.length ? Math.round(pcts.reduce((s, x) => s + x, 0) / pcts.length) : null;
    return { week_no: w.week_no, start: w.start_date, end: w.end_date, pct, n: pcts.length };
  });
  res.json(out);
});

// ---- options (konfigurierbare Auswahllisten: phase/sport/sessionType/...) ----

app.get("/api/options", (req, res) => {
  const kind = req.query.kind ? String(req.query.kind) : null;
  const rows = kind
    ? db.prepare("SELECT * FROM options WHERE kind=? ORDER BY sort, id").all(kind)
    : db.prepare("SELECT * FROM options ORDER BY kind, sort, id").all();
  res.json(rows);
});

app.post("/api/options", (req, res) => {
  const b = req.body || {};
  const r = db
    .prepare("INSERT INTO options(kind, value, label, color, sort, active, intensity) VALUES(?,?,?,?,?,?,?)")
    .run(b.kind, b.value, b.label || b.value, b.color ?? null, b.sort ?? 0, b.active ?? 1, b.intensity ?? null);
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put("/api/options/:id", (req, res) => {
  const b = req.body || {};
  db.prepare("UPDATE options SET label=?, color=?, sort=?, active=?, intensity=? WHERE id=?").run(
    b.label, b.color ?? null, b.sort ?? 0, b.active ?? 1, b.intensity ?? null, req.params.id,
  );
  res.json({ ok: true });
});

app.delete("/api/options/:id", (req, res) => {
  db.prepare("DELETE FROM options WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ---- session templates (wiederverwendbare Einheiten-Vorlagen, profil-scoped) ----------------

app.get("/api/templates", (_req, res) => {
  const rows = db.prepare("SELECT * FROM session_templates WHERE profile_id=? ORDER BY sort_order, name").all(pid());
  res.json((rows as any[]).map((r) => ({ ...r, zone_alloc: parseJson(r.zone_alloc, null), efforts: parseJson(r.efforts, null) })));
});

app.post("/api/templates", (req, res) => {
  const b = req.body || {};
  const r = db
    .prepare(
      `INSERT INTO session_templates(profile_id, name, sport, type, planned_km, planned_min, zone_alloc, description, efforts, sort_order)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      pid(),
      b.name || "Vorlage",
      b.sport || "Run",
      b.type || "Easy",
      b.planned_km ?? null,
      b.planned_min ?? null,
      JSON.stringify(b.zone_alloc || null),
      b.description || "",
      JSON.stringify(b.efforts || null),
      b.sort_order ?? 0,
    );
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put("/api/templates/:id", (req, res) => {
  const b = req.body || {};
  db.prepare(
    `UPDATE session_templates SET name=?, sport=?, type=?, planned_km=?, planned_min=?, zone_alloc=?, description=?, efforts=?, sort_order=? WHERE id=? AND profile_id=?`,
  ).run(
    b.name || "Vorlage",
    b.sport || "Run",
    b.type || "Easy",
    b.planned_km ?? null,
    b.planned_min ?? null,
    JSON.stringify(b.zone_alloc || null),
    b.description || "",
    JSON.stringify(b.efforts || null),
    b.sort_order ?? 0,
    req.params.id,
    pid(),
  );
  res.json({ ok: true });
});

app.delete("/api/templates/:id", (req, res) => {
  db.prepare("DELETE FROM session_templates WHERE id=? AND profile_id=?").run(req.params.id, pid());
  res.json({ ok: true });
});

// ---- season ------------------------------------------------------------

// v0.14.0 (ToDo 3): immer mind. 2 Wochen in die Zukunft vorhalten + bis zum spätesten Renntag auffüllen.
// Hängt nur leere Kalenderwochen (Mo–So) ans Ende an — löscht/ändert nie Bestehendes. Idempotent.
// Bootstrappt KEINE leere Saison (nur wenn schon ≥1 Woche existiert).
function ensureSeasonWeeks(profile: number): number {
  const weeks = db.prepare(
    "SELECT week_no, end_date FROM season_weeks_v2 WHERE profile_id=? ORDER BY start_date",
  ).all(profile) as { week_no: number; end_date: string }[];
  if (!weeks.length) return 0;
  let lastEnd = weeks[weeks.length - 1].end_date;
  let maxNo = Math.max(...weeks.map((w) => w.week_no));
  let targetEnd = addDaysIso(todayIso(), 14);
  const raceMax = (db.prepare("SELECT MAX(date) m FROM races WHERE profile_id=?").get(profile) as { m: string | null }).m;
  if (raceMax && raceMax > targetEnd) targetEnd = raceMax;
  const ins = db.prepare(
    `INSERT INTO season_weeks_v2(profile_id, week_no, label, phase, start_date, end_date, target_km, goal_race, notes)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  );
  let added = 0;
  while (lastEnd < targetEnd && added < 120) {
    const start = addDaysIso(lastEnd, 1);
    const end = addDaysIso(start, 6);
    ins.run(profile, ++maxNo, "", "", start, end, null, "", "");
    lastEnd = end;
    added++;
  }
  if (added) renumberWeeks();
  return added;
}

app.get("/api/season", (_req, res) => {
  ensureSeasonWeeks(pid()); // immer 2 Zukunftswochen + bis Renntag (v0.14.0)
  // Chronologisch, nicht nach week_no: Wochen können vorne angefügt werden (negative week_no, #71).
  res.json(db.prepare("SELECT * FROM season_weeks_v2 WHERE profile_id=? ORDER BY start_date").all(pid()));
});

app.put("/api/season/week/:no", (req, res) => {
  const b = req.body || {};
  db.prepare(
    `INSERT INTO season_weeks_v2(profile_id, week_no, label, phase, start_date, end_date, target_km, target_km_bike, goal_race, notes)
     VALUES(?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(profile_id, week_no) DO UPDATE SET label=excluded.label, phase=excluded.phase,
       start_date=excluded.start_date, end_date=excluded.end_date, target_km=excluded.target_km, target_km_bike=excluded.target_km_bike,
       goal_race=excluded.goal_race, notes=excluded.notes`,
  ).run(pid(), req.params.no, b.label || "", b.phase || "", b.start_date, b.end_date, b.target_km ?? null, b.target_km_bike ?? null, b.goal_race || "", b.notes || "");
  renumberWeeks();
  res.json({ ok: true });
});

// v1.7.0: nur die Phase einer Woche setzen (Teil-Update, übrige Felder bleiben) — für „Phasen übernehmen".
app.put("/api/season/week/:no/phase", (req, res) => {
  db.prepare("UPDATE season_weeks_v2 SET phase=? WHERE week_no=? AND profile_id=?").run(String(req.body?.phase || ""), req.params.no, pid());
  res.json({ ok: true });
});

app.delete("/api/season/week/:no", (req, res) => {
  // v0.12.0 (ToDo 1/5): mit der Woche auch deren geplante Einheiten löschen, damit keine verwaisten
  // Plan-km zurückbleiben. Sessions über den Datumsbereich der Woche (robust gegen week_no-Renumber).
  const wk = db.prepare("SELECT start_date, end_date FROM season_weeks_v2 WHERE week_no=? AND profile_id=?").get(req.params.no, pid()) as { start_date: string; end_date: string } | undefined;
  if (wk) db.prepare("DELETE FROM planned_sessions WHERE profile_id=? AND date BETWEEN ? AND ?").run(pid(), wk.start_date, wk.end_date);
  db.prepare("DELETE FROM season_weeks_v2 WHERE week_no=? AND profile_id=?").run(req.params.no, pid());
  renumberWeeks();
  res.json({ ok: true });
});

// Verwaiste geplante Einheiten bereinigen: alles, was in KEINER Saison-Woche liegt (ToDo 1, v0.12.0).
app.post("/api/season/cleanup-orphans", (_req, res) => {
  const r = db.prepare(
    `DELETE FROM planned_sessions WHERE profile_id=? AND NOT EXISTS (
       SELECT 1 FROM season_weeks_v2 w WHERE w.profile_id=planned_sessions.profile_id
       AND planned_sessions.date BETWEEN w.start_date AND w.end_date)`,
  ).run(pid());
  res.json({ removed: r.changes ?? 0 });
});

// ---- planned sessions --------------------------------------------------

function computeSessionTss(b: any): number {
  const zs = effectiveZoneSet(b.date || todayIso());
  return plannedSessionTss(b, zs.hr_zones, zs.lthr, zs.pace_zones, zs.power_zones, zs.ftp, zs.threshold_pace);
}

// Server-autoritative Lauf-TSS: rTSS (NGP falls vorhanden, sonst Ø-Pace), COROS-unabhängig (ToDo v0.9.0).
// Ausnahme: Nutzer hat tss explizit überschrieben (overrides enthält 'tss'). Bike/sonstige: Client-Wert.
/** Sekunden je HF-Zone aus den Aktivitäts-Zonenfeldern (zone_min Minuten, sonst zones Sek.).
 *  Verträgt sowohl geparste Objekte (POST/PUT) als auch JSON-Strings (Recompute über DB-Rows). */
function activityZoneSeconds(b: any): Record<number, number> | null {
  const parse = (v: any): Record<string, number> | null =>
    (typeof v === "string" ? parseJson<Record<string, number> | null>(v, null) : v) || null;
  const zMin = parse(b.zone_min);
  if (zMin && Object.values(zMin).some((x) => (Number(x) || 0) > 0)) {
    const out: Record<number, number> = {};
    for (const [z, m] of Object.entries(zMin)) out[Number(z)] = (Number(m) || 0) * 60;
    return out;
  }
  const zSec = parse(b.zones);
  if (zSec && Object.values(zSec).some((x) => (Number(x) || 0) > 0)) {
    const out: Record<number, number> = {};
    for (const [z, s] of Object.entries(zSec)) out[Number(z)] = Number(s) || 0;
    return out;
  }
  return null;
}

/** TSS für Allgemein/Sonstiges (Wandern, Spaziergang …) — HR-basiert, ToDo 11 (v0.11.0).
 *  Wandern wurde über die Rad-IF-Schätzung (0.6) massiv überschätzt. Stattdessen:
 *  1) HF-Zonen-TSS, 2) Einzel-Intensität aus Ø-HF, 3) niedriger Fixwert-IF (≈ 0.45). */
function otherTssEstimate(b: any, zones: HrZone[], lthr: number): number {
  const secByZone = activityZoneSeconds(b);
  if (secByZone) return hrTssFromZones(secByZone, zones?.length ? zones : DEFAULT_HR_ZONES, lthr);
  if (b.avg_hr && b.moving_s) {
    const ifr = b.avg_hr / (lthr || 172);
    return round1((b.moving_s / 3600) * ifr * ifr * 100);
  }
  if (b.moving_s) return round1((b.moving_s / 3600) * 0.45 * 0.45 * 100);
  return 0;
}

function activityTssToStore(b: any): number | null {
  if (Array.isArray(b.overrides) && b.overrides.includes("tss")) return b.tss ?? null;
  const zs = effectiveZoneSet(b.date || todayIso());
  // Lauf → rTSS (NGP→Ø-Pace).
  if (b.sport === "Run" && b.distance_m && b.moving_s) {
    const t = runTss(b.distance_m, b.moving_s, zs.threshold_pace, b.ngp ?? null);
    if (t > 0) return t;
  }
  // Rad/Rolle → Power-TSS (NP, sonst Ø-Power); ohne Leistung Dauer×IF-Schätzung (ToDo Z.10).
  if (b.sport?.startsWith("Bike") && b.moving_s) {
    const power = b.np ?? b.avg_power ?? null;
    if (power && zs.ftp) { const t = powerTss(b.moving_s, power, zs.ftp); if (t > 0) return t; }
    const est = bikeTssEstimate(b.moving_s / 60, b.type || "Easy");
    if (est > 0) return est;
  }
  // Allgemein/Commute/Sonstiges → Power-TSS falls Leistung (Bike-Commute), sonst HR-basiert gedämpft (Wandern ×0.6).
  if ((b.sport === "General" || b.sport === "Other") && b.moving_s) {
    const power = b.np ?? b.avg_power ?? null;
    if (power && zs.ftp) { const t = powerTss(b.moving_s, power, zs.ftp); if (t > 0) return t; }
    const t = otherTssEstimate(b, zs.hr_zones, zs.lthr);
    if (t > 0) return round1(t * 0.6);
  }
  return b.tss ?? null;
}

// v1.6.1: Effective VO2max nur für ausreichend lange, GLEICHMÄSSIGE aerobe Läufe — die submaximale
// HF↔Pace-Brücke gilt nicht für Intervalle/kurze Läufe. Dauerläufe immer; Tempo/Schwelle nur kontinuierlich
// (ohne Intervall-`efforts`); VO2/Berg/Race + alle Intervall-Einheiten raus.
const VO2MAX_STEADY_TYPES = new Set(["easy", "long", "steady", "recovery", "regeneration", "tempo", "dauerlauf", "lt1", "ga1", "ga2"]);
const VO2MAX_CONT_THR_TYPES = new Set(["threshold", "lt2", "schwelle", "sub-t", "sub-threshold"]);

/** Effective VO2max (v1.5.0) für eine Lauf-Aktivitäts-Row aus gespeicherten Aggregaten (NGP/Ø-HF/Entkopplung). */
function effVo2maxForRow(a: any): number | null {
  if (a.sport !== "Run" || !a.moving_s) return null;
  if (a.moving_s <= 1800) return null; // nur Läufe > 30 min (gleichmäßiger aerober Zustand)
  const t = (a.type || "").toLowerCase();
  const ef = a.efforts;
  const hasIntervals = !!ef && ef !== "" && ef !== "null" && ef !== "[]";
  const typeOk = VO2MAX_STEADY_TYPES.has(t) || ((VO2MAX_CONT_THR_TYPES.has(t) || t === "") && !hasIntervals);
  if (!typeOk) return null; // Intervalle/VO2/Berg/Race + kurze Läufe ausgeschlossen
  const ath = getSetting("athlete", { max_hr: 196 }) as { max_hr?: number; hr_rest?: number };
  const hrMax = Number(ath?.max_hr) || 196;
  const hrRest = Number(ath?.hr_rest) || 48;
  const avgPace = a.distance_m > 0 && a.moving_s > 0 ? paceToSecPerKm(a.distance_m, a.moving_s) : null;
  const e = effectiveVo2max({ ngpSec: a.ngp ?? null, avgPaceSec: avgPace, avgHr: a.avg_hr ?? null, decoupling: a.decoupling ?? null, hrRest, hrMax });
  return e ? e.value : null;
}

app.get("/api/sessions", (req, res) => {
  const { week, from, to } = req.query as Record<string, string>;
  let rows;
  if (week) {
    // v0.13.0: per Datumsbereich der Woche (konsistent mit dem Tag-Raster); Fallback auf week_no.
    const wk = db.prepare("SELECT start_date, end_date FROM season_weeks_v2 WHERE week_no=? AND profile_id=?").get(week, pid()) as { start_date: string; end_date: string } | undefined;
    rows = wk
      ? db.prepare("SELECT * FROM planned_sessions WHERE date BETWEEN ? AND ? AND profile_id=? ORDER BY date, sort_order").all(wk.start_date, wk.end_date, pid())
      : db.prepare("SELECT * FROM planned_sessions WHERE week_no=? AND profile_id=? ORDER BY date, sort_order").all(week, pid());
  }
  else if (from && to) rows = db.prepare("SELECT * FROM planned_sessions WHERE date BETWEEN ? AND ? AND profile_id=? ORDER BY date, sort_order").all(from, to, pid());
  else rows = db.prepare("SELECT * FROM planned_sessions WHERE profile_id=? ORDER BY date, sort_order").all(pid());
  // v1.7.0: zukünftige Einheiten mit Intention live aus aktueller+projizierter Fitness neu rendern (Pace passt sich an).
  const today = todayIso();
  const list = (rows as any[]).map((r) => ({ ...r, zone_alloc: parseJson(r.zone_alloc, null), structured: parseJson(r.structured, null), efforts: parseJson(r.efforts, null), prescription: parseJson(r.prescription, null) }));
  const ctx = list.some((r) => r.prescription && r.date >= today) ? buildResolveCtx() : null;
  res.json(ctx ? list.map((r) => {
    if (!r.prescription || r.date < today) return r;
    const res2 = resolvePlannedSession(r.prescription, r.date, ctx);
    return res2 ? { ...r, planned_min: res2.planned_min, zone_alloc: res2.zone_alloc, efforts: res2.efforts, description: res2.description, paceTarget: res2.paceTarget, resolved: true } : r;
  }) : list);
});

/** Kontext für die Live-Resolution geplanter Einheiten (einmal je Request). */
function buildResolveCtx() {
  const today = todayIso();
  const runs = loadProfileRuns();
  const cur = rollingCsVdot(runs, today, 90);
  const from = minIso(earliestDataDate() ?? today, today);
  const pmc = computePmc(dailyTssMap(from, today), from, today, today);
  const curCtl = pmc.length ? pmc[pmc.length - 1].ctl : 0;
  const zs = effectiveZoneSet(today);
  const baseZones = { pace_zones: zs.pace_zones, threshold_pace: zs.threshold_pace, lt1_pace: zs.lt1_pace, hr_zones: zs.hr_zones, cs_pace: cur.csPace, rep_pace: cur.csPace ? cur.csPace - 8 : null, cp: currentCp() };
  const race = db.prepare("SELECT distance_m, goal_time_s FROM races WHERE profile_id=? AND date>=? AND goal_time_s IS NOT NULL ORDER BY date LIMIT 1").get(pid(), today) as { distance_m: number | null; goal_time_s: number | null } | undefined;
  return { today, curVdot: cur.vdot, curCtl, baseZones, goalDistanceM: race?.distance_m ?? null, goalTimeS: race?.goal_time_s ?? null };
}

app.post("/api/sessions", (req, res) => {
  const b = req.body || {};
  const tss = computeSessionTss(b);
  const r = db
    .prepare(
      `INSERT INTO planned_sessions(profile_id, date, week_no, sport, type, planned_km, planned_min, zone_alloc, description, structured, efforts, planned_tss, sort_order, prescription)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      pid(),
      b.date,
      b.week_no ?? null,
      b.sport || "Run",
      b.type || "Easy",
      b.planned_km ?? null,
      b.planned_min ?? null,
      JSON.stringify(b.zone_alloc || null),
      b.description || "",
      JSON.stringify(b.structured || null),
      JSON.stringify(b.efforts || null),
      tss,
      b.sort_order ?? 0,
      b.prescription ? JSON.stringify(b.prescription) : null, // v1.7.0 Live-Resolution-Intention
    );
  res.json({ id: Number(r.lastInsertRowid), planned_tss: tss });
});

app.put("/api/sessions/:id", (req, res) => {
  const b = req.body || {};
  const tss = computeSessionTss(b);
  // v1.7.0: manuelle Bearbeitung „pinnt" die Einheit → Intention löschen, damit die Live-Resolution nicht überschreibt.
  db.prepare(
    `UPDATE planned_sessions SET date=?, week_no=?, sport=?, type=?, planned_km=?, planned_min=?, zone_alloc=?, description=?, structured=?, efforts=?, planned_tss=?, sort_order=?, prescription=NULL WHERE id=?`,
  ).run(
    b.date,
    b.week_no ?? null,
    b.sport || "Run",
    b.type || "Easy",
    b.planned_km ?? null,
    b.planned_min ?? null,
    JSON.stringify(b.zone_alloc || null),
    b.description || "",
    JSON.stringify(b.structured || null),
    JSON.stringify(b.efforts || null),
    tss,
    b.sort_order ?? 0,
    req.params.id,
  );
  res.json({ ok: true, planned_tss: tss });
});

// Adaptive Coach-Anpassung übernehmen (v1.5.0, S): überschreibt die heutige Einheit mit dem
// vorgeschlagenen, konkretisierten Vorschlag; Plan-TSS wird server-autoritativ neu gerechnet.
app.post("/api/sessions/:id/apply-adjustment", (req, res) => {
  const b = req.body || {}; // adjusted ConcreteSession
  const ex = db.prepare("SELECT * FROM planned_sessions WHERE id=? AND profile_id=?").get(req.params.id, pid()) as any;
  if (!ex) return res.status(404).json({ error: "Einheit nicht gefunden" });
  const merged = {
    ...ex, sport: ex.sport, date: ex.date,
    type: b.type ?? ex.type, planned_min: b.planned_min ?? ex.planned_min,
    zone_alloc: b.zone_alloc ?? null, efforts: b.efforts ?? null,
    description: b.description ?? ex.description,
  };
  const tss = computeSessionTss(merged);
  db.prepare(
    "UPDATE planned_sessions SET type=?, planned_min=?, planned_km=?, zone_alloc=?, efforts=?, description=?, planned_tss=? WHERE id=? AND profile_id=?",
  ).run(merged.type, merged.planned_min, null, JSON.stringify(b.zone_alloc ?? null), JSON.stringify(b.efforts ?? null), merged.description, tss, req.params.id, pid());
  res.json({ ok: true, planned_tss: tss });
});

app.delete("/api/sessions/:id", (req, res) => {
  db.prepare("DELETE FROM planned_sessions WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ---- activities (actuals) ---------------------------------------------

// v0.14.0 (ToDo 3): Lauf mit Typ „Wettkampf" → automatisch verknüpfter Race-Eintrag (source='tracking').
// Shell-Felder (Datum/Name/Distanz/Zeit/HF/Hm) folgen der Aktivität; Splits kommen aus dem Enrich
// (Strava-Streams). Wird der Typ wieder geändert, verschwindet der Auto-Race wieder.
function syncRaceFromActivity(activityId: number, b: any): void {
  const profile = pid();
  const isRace = (b.sport || "Run") === "Run" && b.type === "Race";
  const link = db.prepare("SELECT id FROM races WHERE profile_id=? AND activity_id=?").get(profile, activityId) as { id: number } | undefined;
  if (isRace) {
    const name = b.name || "Wettkampf";
    if (link) {
      db.prepare("UPDATE races SET date=?, name=?, distance_m=?, time_s=?, avg_hr=?, max_hr=?, elevation_m=? WHERE id=?")
        .run(b.date, name, b.distance_m ?? null, b.moving_s ?? null, b.avg_hr ?? null, b.max_hr ?? null, b.elevation ?? null, link.id);
    } else {
      db.prepare(
        `INSERT INTO races(profile_id, date, name, distance_m, time_s, placement, notes, splits, max_hr, avg_hr, elevation_m, source, activity_id)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(profile, b.date, name, b.distance_m ?? null, b.moving_s ?? null, "", "", "[]", b.max_hr ?? null, b.avg_hr ?? null, b.elevation ?? null, "tracking", activityId);
      ensureSeasonWeeks(profile); // Wochen bis zum Renntag herstellen
      // Strava-Streams erneut anfordern → nächster „Details nachziehen" füllt die km-Splits (auch nachträglich).
      db.prepare("UPDATE activities SET streams_fetched=0 WHERE id=? AND profile_id=? AND source='strava'").run(activityId, profile);
    }
  } else if (link) {
    db.prepare("DELETE FROM races WHERE id=? AND source='tracking'").run(link.id);
  }
}

// Zonen-Histogramm (v1.4.0, C3): aggregierte Zeit in HF- und Pace-Zonen über einen Zeitraum.
// Basis: zone_min (HF, aus Strava/manuell) + pace_zone_min (Pace, aus Strava-Streams).
app.get("/api/zone-histogram", (req, res) => {
  const today = todayIso();
  const to = String(req.query.to || today);
  const from = String(req.query.from || addDaysIso(to, -365));
  const sport = String(req.query.sport || "Run");
  const rows = db.prepare(
    "SELECT zones, zone_min, pace_zone_min, moving_s FROM activities WHERE profile_id=? AND sport=? AND date BETWEEN ? AND ?",
  ).all(pid(), sport, from, to) as { zones: string | null; zone_min: string | null; pace_zone_min: string | null; moving_s: number | null }[];

  const hrAgg: Record<number, number> = {};
  const paceAgg: Record<number, number> = {};
  let totalMin = 0;
  for (const r of rows) {
    totalMin += (r.moving_s ?? 0) / 60;
    const zm = parseJson<Record<string, number> | null>(r.zone_min, null);
    const zs = parseJson<Record<string, number> | null>(r.zones, null);
    const pzm = parseJson<Record<string, number> | null>(r.pace_zone_min, null);
    const hrSrc = zm || (zs ? Object.fromEntries(Object.entries(zs).map(([k, v]) => [k, v / 60])) : null);
    if (hrSrc) for (const [z, m] of Object.entries(hrSrc)) { const zn = Number(z); if (zn >= 1 && zn <= 5) hrAgg[zn] = (hrAgg[zn] ?? 0) + m; }
    if (pzm) for (const [z, m] of Object.entries(pzm)) { const zn = Number(z); if (zn >= 1 && zn <= 5) paceAgg[zn] = (paceAgg[zn] ?? 0) + m; }
  }
  const zs = effectiveZoneSet(today);
  const HR_LABELS = ["Z1 Locker", "Z2 GA1", "Z3 GA2", "Z4 Schwelle", "Z5 VO2max"];
  const PACE_LABELS = ["Z1 Locker", "Z2 Marathon", "Z3 LT1", "Z4 LT2/Schwelle", "Z5 VO2max"];
  const HR_COLORS = ["#22c55e", "#86efac", "#f59e0b", "#ef4444", "#7c3aed"];
  const hrBands = Array.from({ length: 5 }, (_, i) => ({
    zone: i + 1, label: HR_LABELS[i], min: Math.round(hrAgg[i + 1] ?? 0), color: HR_COLORS[i],
    pctOfMax: zs.hr_zones?.[i] ? `${zs.hr_zones[i].min}–${zs.hr_zones[i].max} bpm` : "",
  }));
  const paceBands = Array.from({ length: 5 }, (_, i) => ({
    zone: i + 1, label: PACE_LABELS[i], min: Math.round(paceAgg[i + 1] ?? 0), color: HR_COLORS[i],
  }));
  res.json({ hrBands, paceBands, totalMin: Math.round(totalMin) });
});

app.get("/api/activities", (req, res) => {
  const { from, to } = req.query as Record<string, string>;
  const rows = (from && to
    ? db.prepare("SELECT * FROM activities WHERE date BETWEEN ? AND ? AND profile_id=? ORDER BY date").all(from, to, pid())
    : db.prepare("SELECT * FROM activities WHERE profile_id=? ORDER BY date DESC LIMIT 200").all(pid())) as any[];
  res.json(rows.map((r) => ({ ...r, zones: parseJson(r.zones, null), zone_min: parseJson(r.zone_min, null), zone_km: parseJson(r.zone_km, null), efforts: parseJson(r.efforts, null), overrides: parseJson(r.overrides, []) })));
});

app.post("/api/activities", (req, res) => {
  const b = req.body || {};
  const r = db
    .prepare(
      `INSERT INTO activities(profile_id, strava_id, date, sport, type, source, name, distance_m, moving_s, elapsed_s, avg_hr, max_hr, avg_power, elevation, avg_cadence, training_load, tss, kcal, zones, zone_min, zone_km, efforts, overrides, matched_session_id, notes)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      pid(),
      b.strava_id ?? null,
      b.date,
      b.sport || "Run",
      b.type ?? null,
      b.source || "manual",
      b.name || "",
      b.distance_m ?? null,
      b.moving_s ?? null,
      b.elapsed_s ?? null,
      b.avg_hr ?? null,
      b.max_hr ?? null,
      b.avg_power ?? null,
      b.elevation ?? null,
      b.avg_cadence ?? null,
      b.training_load ?? null,
      activityTssToStore(b),
      b.kcal ?? null,
      JSON.stringify(b.zones || null),
      JSON.stringify(b.zone_min || null),
      JSON.stringify(b.zone_km || null),
      JSON.stringify(b.efforts || null),
      JSON.stringify(b.overrides || []),
      b.matched_session_id ?? null,
      b.notes || "",
    );
  const newId = Number(r.lastInsertRowid);
  syncRaceFromActivity(newId, b); // Race aus Tracking (v0.14.0)
  res.json({ id: newId });
});

app.put("/api/activities/:id", (req, res) => {
  const b = req.body || {};
  db.prepare(
    // Commute (sport=General): desc_fetched=1 setzen, damit der Strava-Sync die geleerte Notiz nicht neu füllt (ToDo Z.14).
    // efforts_locked=1 (v0.15.5 O6): manuell bearbeitete/gelöschte Intervalle werden vom Re-Sync nicht mehr angefasst.
    `UPDATE activities SET date=?, sport=?, type=?, source=?, name=?, distance_m=?, moving_s=?, elapsed_s=?, avg_hr=?, max_hr=?, avg_power=?, elevation=?, avg_cadence=?, training_load=?, tss=?, kcal=?, zones=?, zone_min=?, zone_km=?, efforts=?, overrides=?, matched_session_id=?, notes=?, desc_fetched=MAX(COALESCE(desc_fetched,0), ?), efforts_locked=1 WHERE id=?`,
  ).run(
    b.date,
    b.sport || "Run",
    b.type ?? null,
    b.source || "manual",
    b.name || "",
    b.distance_m ?? null,
    b.moving_s ?? null,
    b.elapsed_s ?? null,
    b.avg_hr ?? null,
    b.max_hr ?? null,
    b.avg_power ?? null,
    b.elevation ?? null,
    b.avg_cadence ?? null,
    b.training_load ?? null,
    activityTssToStore(b),
    b.kcal ?? null,
    JSON.stringify(b.zones || null),
    JSON.stringify(b.zone_min || null),
    JSON.stringify(b.zone_km || null),
    JSON.stringify(b.efforts || null),
    JSON.stringify(b.overrides || []),
    b.matched_session_id ?? null,
    b.notes || "",
    b.sport === "General" ? 1 : 0,
    req.params.id,
  );
  syncRaceFromActivity(Number(req.params.id), b); // Race aus Tracking (v0.14.0)
  res.json({ ok: true });
});

app.delete("/api/activities/:id", (req, res) => {
  db.prepare("DELETE FROM activities WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// v0.15.5 (O6): Intervalle einer Aktivität bewusst aus Strava neu laden — Sperre lösen, Laps neu ziehen.
// Intervalle EINER Aktivität sofort aus Strava neu erzeugen (holt die Laps direkt, regeneriert + labelt).
app.post("/api/activities/:id/relink-efforts", stravaRelinkEfforts);

// v1.9.0: Schwellen-Trend — Schwellen-Pace (aus VDOT/CS) + Critical Power über die Zeit (Langzeit-Verlauf).
app.get("/api/threshold-trend", (req, res) => {
  const months = Math.max(3, Math.min(36, Number((req.query as Record<string, string>).months) || 12));
  const today = todayIso();
  const runs = loadProfileRuns();
  const pcRows = db.prepare("SELECT date, power_curve FROM activities WHERE profile_id=? AND sport='Run' AND power_curve IS NOT NULL AND power_curve!='{}' ORDER BY date").all(pid()) as { date: string; power_curve: string }[];
  const points: { date: string; thrPace: number | null; cp: number | null }[] = [];
  for (let m = months - 1; m >= 0; m--) {
    const end = addDaysIso(today, -m * 30);
    const cs = rollingCsVdot(runs, end, 90);
    const thrPace = cs.vdot ? danielsPaces(cs.vdot).threshold : (cs.csPace ?? null);
    const start = addDaysIso(end, -90);
    const fit = cpFromAgg(aggregatePowerCurve(pcRows.filter((r) => r.date > start && r.date <= end)));
    points.push({ date: end, thrPace, cp: fit?.cp ?? null });
  }
  res.json({ points });
});

// v1.9.0: optimale Zonen (Pace/HF/Watt) aus den Laufwerten berechnen — Vorschlag, der per addZoneset übernommen wird.
app.get("/api/optimal-zones", (_req, res) => {
  const today = todayIso();
  const cur = rollingCsVdot(loadProfileRuns(), today, 90);
  const athlete = getSetting("athlete", { max_hr: 196 }) as { max_hr?: number | null };
  const zs = effectiveZoneSet(today);
  const lac = db.prepare("SELECT lt1_hr, lt2_hr, lt1_pace, lt2_pace FROM lactate_tests WHERE profile_id=? ORDER BY date DESC LIMIT 1").get(pid()) as { lt1_hr: number | null; lt2_hr: number | null; lt1_pace: number | null; lt2_pace: number | null } | undefined;
  const oz = computeOptimalZones({
    vdot: cur.vdot, csPaceS: cur.csPace,
    maxHr: athlete.max_hr ?? null, lthr: zs.lthr ?? null,
    lactate: lac ? { lt1Hr: lac.lt1_hr, lt2Hr: lac.lt2_hr, lt1Pace: lac.lt1_pace, lt2Pace: lac.lt2_pace } : null,
    cp: currentCp(),
    hrLabels: DEFAULT_HR_ZONES,
  });
  res.json({ zones: oz, vdot: cur.vdot ? Math.round(cur.vdot * 10) / 10 : null, today });
});

// v1.9.0: Aktivität manuell einer geplanten Einheit zuordnen (oder Zuordnung lösen). Überschreibt das Auto-Match.
app.post("/api/activities/:id/match", (req, res) => {
  const sid = req.body?.session_id;
  db.prepare("UPDATE activities SET matched_session_id=? WHERE id=? AND profile_id=?").run(sid != null ? Number(sid) : null, req.params.id, pid());
  res.json({ ok: true });
});

// ---- daily log ---------------------------------------------------------

const DAILY_COLS = [
  "weight", "resting_hr", "hrv", "recovery", "strain", "sleep_h", "bedtime", "wake_time",
  "sleep_efficiency", "sleep_consistency", "sleep_performance", "rem_h", "deep_h", "resp_rate", "spo2",
  "energy", "mood", "stress", "motivation", "legs", "soreness", "pain", "pain_location",
  "rpe", "alcohol", "caffeine", "hydration", "fueling", "travel", "sick", "notes",
];

app.get("/api/daily", (req, res) => {
  const { from, to } = req.query as Record<string, string>;
  const rows = from && to
    ? db.prepare("SELECT * FROM daily_log_v2 WHERE date BETWEEN ? AND ? AND profile_id=? ORDER BY date").all(from, to, pid())
    : db.prepare("SELECT * FROM daily_log_v2 WHERE profile_id=? ORDER BY date DESC LIMIT 120").all(pid());
  res.json(rows);
});

app.put("/api/daily/:date", (req, res) => {
  const b = req.body || {};
  const cols = DAILY_COLS.filter((c) => c in b);
  const values: any[] = cols.map((c) => b[c]);
  // v0.12.0 (ToDo 12): eigene Tagesfaktoren (custom JSON) in die custom-Spalte mergen.
  if (b.custom && typeof b.custom === "object") {
    const row = db.prepare("SELECT custom FROM daily_log_v2 WHERE date=? AND profile_id=?").get(req.params.date, pid()) as { custom?: string } | undefined;
    const merged = { ...parseJson<Record<string, unknown>>(row?.custom ?? null, {}), ...b.custom };
    cols.push("custom");
    values.push(JSON.stringify(merged));
  }
  const placeholders = cols.map(() => "?").join(",");
  const updates = cols.map((c) => `${c}=excluded.${c}`).join(",");
  db.prepare(
    `INSERT INTO daily_log_v2(date, profile_id${cols.length ? "," + cols.join(",") : ""}) VALUES(?,?${cols.length ? "," + placeholders : ""})
     ON CONFLICT(date, profile_id) DO UPDATE SET ${updates || "date=excluded.date"}`,
  ).run(req.params.date, pid(), ...values);
  res.json({ ok: true });
});

// ---- week log ----------------------------------------------------------

app.get("/api/weeklog/:week", (req, res) => {
  const row = db.prepare("SELECT * FROM week_log_v2 WHERE week_no=? AND profile_id=?").get(req.params.week, pid()) as any;
  if (!row) return res.json(null);
  res.json({ ...row, checks: parseJson(row.checks, {}), whoop: parseJson(row.whoop, {}), refl_extra: parseJson(row.refl_extra, {}) });
});

// Alle Wochen-Checks des aktiven Profils (für die Langzeit-Heatmap, ToDo 7 v0.11.0).
app.get("/api/weeklogs", (_req, res) => {
  const rows = db.prepare("SELECT week_no, checks FROM week_log_v2 WHERE profile_id=?").all(pid()) as any[];
  res.json(rows.map((r) => ({ week_no: r.week_no, checks: parseJson(r.checks, {}) })));
});

app.put("/api/weeklog/:week", (req, res) => {
  const b = req.body || {};
  db.prepare(
    `INSERT INTO week_log_v2(profile_id, week_no, run_km, run_h, bike_km, bike_h, run_equiv, week_tss, ctl, atl, tsb, checks, whoop, refl_good, refl_hard, refl_change, refl_extra)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(profile_id, week_no) DO UPDATE SET run_km=excluded.run_km, run_h=excluded.run_h, bike_km=excluded.bike_km,
       bike_h=excluded.bike_h, run_equiv=excluded.run_equiv, week_tss=excluded.week_tss, ctl=excluded.ctl,
       atl=excluded.atl, tsb=excluded.tsb, checks=excluded.checks, whoop=excluded.whoop,
       refl_good=excluded.refl_good, refl_hard=excluded.refl_hard, refl_change=excluded.refl_change, refl_extra=excluded.refl_extra`,
  ).run(
    pid(),
    req.params.week,
    b.run_km ?? null, b.run_h ?? null, b.bike_km ?? null, b.bike_h ?? null, b.run_equiv ?? null,
    b.week_tss ?? null, b.ctl ?? null, b.atl ?? null, b.tsb ?? null,
    JSON.stringify(b.checks || {}), JSON.stringify(b.whoop || {}),
    b.refl_good || "", b.refl_hard || "", b.refl_change || "", JSON.stringify(b.refl_extra || {}),
  );
  res.json({ ok: true });
});

// ---- PMC ---------------------------------------------------------------

app.get("/api/pmc", (req, res) => {
  const from = String(req.query.from || "2026-01-01");
  const to = String(req.query.to || todayIso());
  const today = todayIso();
  // Seeding: ab der vollen Historie rechnen (CTL/ATL korrekt am Zeitraum-Anfang), dann auf [from,to] zuschneiden.
  const calcFrom = minIso(earliestDataDate() ?? from, from);
  const full = computePmc(dailyTssMap(calcFrom, to), calcFrom, to, today);
  const pmc = full.filter((p) => p.date >= from);
  // CTL-Ramp am „heute"-Punkt (nicht am Ende des in die Zukunft reichenden Zeitraums).
  const upToToday = full.filter((p) => p.date <= today);
  res.json({ pmc, ctlRamp7: ctlRamp(upToToday, 7), ctlRamp28: ctlRamp(upToToday, 28) });
});

// ToDo v0.9.0/v0.10.0: alle Lauf- UND Rad-/Commute-TSS rückwirkend neu rechnen (Aktivitäten via
// activityTssToStore = rTSS/NGP bzw. Power-TSS/NP, Overrides respektiert; geplante per Zone).
// Vorher konsistenter DB-Snapshot (VACUUM INTO). Nach Syncs (mehr NGP/NP-Daten) erneut auslösbar.
// Anreicherungs-Fortschritt (v1.5.0, D1): wie viele Aktivitäten haben Details bzw. Streams/Splits.
app.get("/api/enrich-progress", (_req, res) => {
  const row = db.prepare(
    "SELECT COUNT(*) total, " +
      "SUM(CASE WHEN desc_fetched=1 THEN 1 ELSE 0 END) details, " +
      "SUM(CASE WHEN streams_fetched=1 THEN 1 ELSE 0 END) streams " +
      "FROM activities WHERE profile_id=?",
  ).get(pid()) as { total: number; details: number; streams: number };
  res.json({ total: row.total || 0, details: row.details || 0, streams: row.streams || 0 });
});

app.post("/api/recompute-tss", (_req, res) => {
  try {
    const profile = pid();
    const bak = `${DB_PATH}.${new Date().toISOString().replace(/[:.]/g, "-")}-recompute.bak`;
    db.exec(`VACUUM INTO '${bak.replace(/'/g, "''")}'`);

    const acts = db.prepare(
      "SELECT id, date, sport, type, efforts, distance_m, moving_s, avg_hr, avg_power, ngp, np, decoupling, tss, overrides FROM activities " +
        "WHERE profile_id=? AND (sport='Run' OR sport LIKE 'Bike%' OR sport='General') AND moving_s IS NOT NULL",
    ).all(profile) as any[];
    const updA = db.prepare("UPDATE activities SET tss=? WHERE id=?");
    const updEv = db.prepare("UPDATE activities SET eff_vo2max=? WHERE id=?");
    let activities = 0, effVo2 = 0;
    for (const a of acts) {
      const t = activityTssToStore({ ...a, overrides: parseJson(a.overrides, []) });
      if (t != null) { updA.run(t, a.id); activities++; }
      const ev = effVo2maxForRow(a);
      updEv.run(ev, a.id); // auch null setzen → entfernt veraltete Werte bei nicht mehr stetigen Läufen
      if (ev != null) effVo2++;
    }

    const sess = db.prepare(
      "SELECT * FROM planned_sessions WHERE profile_id=? AND (sport='Run' OR sport LIKE 'Bike%' OR sport='General')",
    ).all(profile) as any[];
    const updS = db.prepare("UPDATE planned_sessions SET planned_tss=? WHERE id=?");
    let sessions = 0;
    for (const s of sess) {
      const t = computeSessionTss({ ...s, zone_alloc: parseJson(s.zone_alloc, null) });
      updS.run(t, s.id); sessions++;
    }
    res.json({ ok: true, backup: bak, activities, sessions, effVo2 });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---- analyze week ------------------------------------------------------

function weekActualKm(start: string, end: string): number {
  const row = db
    .prepare("SELECT SUM(COALESCE(distance_m,0)) m FROM activities WHERE sport='Run' AND date BETWEEN ? AND ? AND profile_id=?")
    .get(start, end, pid()) as { m: number };
  return Math.round(((row?.m || 0) / 1000) * 10) / 10;
}


// Referenz für die Wochen-Last in der PLANUNG (ToDo A3): Ø der GEPLANTEN Wochen-TSS der letzten Wochen
// (Summe planned_tss je Vor-Saisonwoche) — geplant↔geplant, kein Geplant/Real-Bruch.
function avgPlannedWeeklyTss(beforeDate: string, weeks: number): number | null {
  const prev = db.prepare(
    "SELECT start_date, end_date FROM season_weeks_v2 WHERE profile_id=? AND start_date<? ORDER BY start_date DESC LIMIT ?",
  ).all(pid(), beforeDate, weeks) as { start_date: string; end_date: string }[];
  const vals = prev
    .map((p) => {
      const row = db.prepare("SELECT SUM(COALESCE(planned_tss,0)) s FROM planned_sessions WHERE profile_id=? AND date BETWEEN ? AND ?").get(pid(), p.start_date, p.end_date) as { s: number };
      return row.s || 0;
    })
    .filter((v) => v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function avgWeeklyTss(beforeDate: string, weeks: number): number | null {
  const prev = db.prepare(
    "SELECT start_date, end_date FROM season_weeks_v2 WHERE profile_id=? AND start_date<? ORDER BY start_date DESC LIMIT ?",
  ).all(pid(), beforeDate, weeks) as { start_date: string; end_date: string }[];
  const vals = prev
    .map((p) => {
      const row = db.prepare("SELECT SUM(COALESCE(tss,0)) s FROM activities WHERE profile_id=? AND date BETWEEN ? AND ?").get(pid(), p.start_date, p.end_date) as { s: number };
      return row.s || 0;
    })
    .filter((v) => v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

app.get("/api/analyze/week/:no", (req, res) => {
  const wk = db.prepare("SELECT * FROM season_weeks_v2 WHERE week_no=? AND profile_id=?").get(req.params.no, pid()) as any;
  // v0.13.0: Einheiten per DATUMSBEREICH der Woche laden (nicht week_no) → geplante km/Einheiten stimmen
  // mit dem Tag-Raster überein; fehlgeleitete Altlast-Einheiten (falsches week_no) verfälschen nichts mehr.
  const sessions = (wk
    ? db.prepare("SELECT * FROM planned_sessions WHERE date BETWEEN ? AND ? AND profile_id=? ORDER BY date").all(wk.start_date, wk.end_date, pid())
    : db.prepare("SELECT * FROM planned_sessions WHERE week_no=? AND profile_id=? ORDER BY date").all(req.params.no, pid())) as any[];
  const planned: PlannedSession[] = sessions.map((s) => ({ ...s, zone_alloc: parseJson(s.zone_alloc, null) }));
  const zs = effectiveZoneSet(wk?.start_date || todayIso());
  const totals = weekTotals(planned, zs.hr_zones, zs.pace_zones);

  // Verlauf: reale km der bis zu 3 Vorwochen
  const recentWeeksKm: number[] = [];
  if (wk) {
    // Vorwochen chronologisch über start_date (week_no kann negativ/umsortiert sein, #71).
    const prev = db.prepare("SELECT * FROM season_weeks_v2 WHERE start_date<? AND profile_id=? ORDER BY start_date DESC LIMIT 3").all(wk.start_date, pid()) as any[];
    for (const p of prev.reverse()) recentWeeksKm.push(weekActualKm(p.start_date, p.end_date));
  }

  // Projektion CTL-Ramp & Form über die Woche
  let projectedCtlRamp: number | null = null;
  let projectedTsb: number | null = null;
  let pmcHeader: { ctl: number; atl: number; tsb: number; ramp: number | null; spark: { d: string; ctl: number; tsb: number }[] } | null = null; // v1.9.0 Wochen-Header-PMC
  let vo2max: { now: number; prev: number | null } | null = null; // v1.9.0 Wochenbericht-Kopf: VO2max (VDOT) + Δ Vorwoche
  // TSS-Wochenempfehlung (v0.15.0, O4) — Korridor aus CTL am Wochenstart + Phase.
  let tssRec: { min: number; max: number; target: number; level: "under" | "ok" | "over"; phaseLabel: string; basis: string } | null = null;
  // Race-Taper (v0.14.0, ToDo 4): bezieht sich auf die 7 Tage VOR dem Renntag, nicht die Kalenderwoche.
  let raceDate: string | null = null;
  let raceTsb: number | null = null;
  let racePre7Tss: number | null = null;
  let raceAvgWeeklyTss: number | null = null;
  if (wk) {
    // Seeding aus der vollen Historie → korrekte CTL/ATL bis ins Wochenende (Projektion).
    const from = minIso(earliestDataDate() ?? "2026-01-01", "2026-01-01");
    const map = dailyTssMap(from, wk.end_date);
    const pmc = computePmc(map, from, wk.end_date, todayIso());
    projectedCtlRamp = ctlRamp(pmc, 7);
    projectedTsb = pmc.length ? pmc[pmc.length - 1].tsb : null;
    const lastPt = pmc.length ? pmc[pmc.length - 1] : null;
    if (lastPt) pmcHeader = { ctl: round1(lastPt.ctl), atl: round1(lastPt.atl), tsb: round1(lastPt.tsb), ramp: projectedCtlRamp, spark: pmc.slice(-42).map((p) => ({ d: p.date, ctl: round1(p.ctl), tsb: round1(p.tsb) })) };

    // VO2max (VDOT, 90-Tage-Fenster) zum Wochenstand + Vorwoche → Δ im Wochenbericht-Kopf.
    const vRuns = loadProfileRuns();
    const vNow = rollingCsVdot(vRuns, wk.end_date, 90).vdot;
    const vPrev = rollingCsVdot(vRuns, addDaysIso(wk.end_date, -7), 90).vdot;
    if (vNow) vo2max = { now: Math.round(vNow * 10) / 10, prev: vPrev ? Math.round(vPrev * 10) / 10 : null };

    // CTL am Wochenstart → TSS-Empfehlung (O4). level vergleicht den geplanten Wochen-TSS mit dem Korridor.
    const startPt = pmc.find((p) => p.date === wk.start_date) ?? (pmc.length ? pmc[0] : null);
    const ctlStart = startPt ? startPt.ctl : 0;
    const rec = tssRecommendation(ctlStart, wk.phase);
    const pTss = totals.tss;
    const level: "under" | "ok" | "over" = pTss < rec.min ? "under" : pTss > rec.max ? "over" : "ok";
    tssRec = {
      min: rec.min, max: rec.max, target: rec.target, level,
      phaseLabel: (wk.phase && String(wk.phase).trim()) ? String(wk.phase) : rec.kind,
      basis: `CTL ${Math.round(ctlStart)} · ${rec.kind}`,
    };

    // Renntag in der Wochen-Spanne (Races-Tabelle bevorzugt, sonst goal_race → Wochenende).
    const raceRow = db.prepare(
      "SELECT date FROM races WHERE profile_id=? AND date BETWEEN ? AND ? ORDER BY date LIMIT 1",
    ).get(pid(), wk.start_date, wk.end_date) as { date: string } | undefined;
    raceDate = raceRow?.date ?? (wk.goal_race && String(wk.goal_race).trim() ? wk.end_date : null);
    if (raceDate) {
      const pmcR = computePmc(dailyTssMap(from, raceDate), from, raceDate, todayIso());
      raceTsb = pmcR.length ? pmcR[pmcR.length - 1].tsb : null;
      const pre7 = db.prepare(
        "SELECT SUM(COALESCE(planned_tss,0)) s FROM planned_sessions WHERE profile_id=? AND date BETWEEN ? AND ?",
      ).get(pid(), addDaysIso(raceDate, -6), raceDate) as { s: number };
      racePre7Tss = Math.round(pre7.s || 0);
      raceAvgWeeklyTss = avgPlannedWeeklyTss(raceDate, thresholds().intensity_window_weeks);
    }
  }

  // Readiness aus letzten 7 Tagen daily_log
  const recent = db.prepare("SELECT recovery, legs, hrv FROM daily_log_v2 WHERE profile_id=? ORDER BY date DESC LIMIT 7").all(pid()) as any[];
  const recAvg = recent.filter((r) => r.recovery != null);
  const readiness = recent.length
    ? {
        recovery: recAvg.length ? recAvg.reduce((a, r) => a + r.recovery, 0) / recAvg.length : undefined,
        legsHardDays: recent.filter((r) => r.legs === "hard").length,
      }
    : null;

  const flags = analyzeWeek(totals, {
    phase: wk?.phase,
    targetKm: wk?.target_km,
    recentWeeksKm,
    projectedCtlRamp,
    projectedTsb,
    raceDate,
    raceTsb,
    racePre7Tss,
    raceAvgWeeklyTss,
    readiness,
    thresholds: thresholds(),
  });

  // Intensität je Einheitstyp (aus den Optionen) — Basis für den Donut „nach Typ" (geplant) und den
  // Typ-Fallback der realen Klassifikation. Vor dem Aktivitäts-Loop gebaut, da dort genutzt (ToDo Z.7).
  const typeRows = db.prepare("SELECT value, intensity FROM options WHERE kind='sessionType'").all() as { value: string; intensity: string | null }[];
  const intByType = new Map(typeRows.map((r) => [r.value, r.intensity]));
  const typeIntensity = (type: string): IntLevel => {
    const v = intByType.get(type);
    return v === "easy" || v === "moderate" || v === "hard" ? v : "moderate";
  };
  const typeBySession = new Map<number, string>(planned.filter((p) => p.id != null).map((p) => [p.id as number, p.type]));

  // Reale Zeit-in-Zone + Kategorie-Summen aus den activities der Woche (ToDo 4/21, #77).
  // Priorität je Aktivität: zone_km (km je Zone, manuell) > zone_min (Minuten, manuell) > zones (Strava-Sek./60).
  // zone_km -> Minuten: km × Pace der Zone (pace_zones[z-1] s/km, sonst Ø-Pace der Aktivität, sonst 300 s/km).
  // realZoneKm: km je Zone nur aus zone_km — wo nur zone_min/zones existiert, bleiben km weg.
  // realTssAcc (ToDo Z.7, hybrid): reale TSS je Intensität — zonen-anteilig wo Zonen da sind, sonst Plan-Typ.
  const realZoneMin: Record<number, number> = {};
  const realZoneKm: Record<number, number> = {};
  const realTssAcc = { easy: 0, mod: 0, hard: 0 };
  let realTotalTss = 0;
  zs.hr_zones.forEach((z) => {
    realZoneMin[z.z] = 0;
    realZoneKm[z.z] = 0;
  });
  // realByCategory: reale Summen je Kategorie. `min` bleibt aus Kompatibilität (Welle-1-Client),
  // `h` (Stunden) kommt zusätzlich dazu (Fix-Runde, Anzeige in km/h).
  const realByCategory: { run: { km: number; min: number; h: number }; bike: { km: number; min: number; h: number }; strength: { min: number; h: number } } =
    { run: { km: 0, min: 0, h: 0 }, bike: { km: 0, min: 0, h: 0 }, strength: { min: 0, h: 0 } };
  // Plan-Erfüllung je gematchter Einheit (v0.14.0, ToDo 12)
  let adherence: { perSession: { session_id: number; date: string; type: string; pct: number; tssOnly: boolean }[]; weekPct: number | null; matchByActivity: Record<number, number> } = { perSession: [], weekPct: null, matchByActivity: {} };
  if (wk) {
    const acts = db
      .prepare("SELECT id, date, sport, type, distance_m, moving_s, zones, zone_min, zone_km, pace_zone_min, tss, matched_session_id FROM activities WHERE date BETWEEN ? AND ? AND profile_id=?")
      .all(wk.start_date, wk.end_date, pid()) as any[];
    for (const a of acts) {
      const zKm = parseJson<Record<string, number> | null>(a.zone_km, null);
      const zMin = parseJson<Record<string, number> | null>(a.zone_min, null);
      const zSec = parseJson<Record<string, number> | null>(a.zones, null);
      const hasZoneKm = !!zKm && Object.values(zKm).some((v) => (v || 0) > 0);
      if (hasZoneKm) {
        const avgPace = a.distance_m && a.moving_s ? a.moving_s / (a.distance_m / 1000) : null;
        for (const [z, km] of Object.entries(zKm!)) {
          const zi = Number(z);
          if (!km) continue;
          const pace = zs.pace_zones?.[zi - 1] || avgPace || 300; // s/km
          realZoneMin[zi] = (realZoneMin[zi] || 0) + (km * pace) / 60;
          realZoneKm[zi] = (realZoneKm[zi] || 0) + km;
        }
      } else if (zMin) for (const [z, m] of Object.entries(zMin)) realZoneMin[Number(z)] = (realZoneMin[Number(z)] || 0) + (m || 0);
      else if (zSec) for (const [z, s] of Object.entries(zSec)) realZoneMin[Number(z)] = (realZoneMin[Number(z)] || 0) + (s || 0) / 60;
      const km = (a.distance_m || 0) / 1000;
      const min = (a.moving_s || 0) / 60;
      if (a.sport === "Run") {
        realByCategory.run.km += km;
        realByCategory.run.min += min;
      } else if (a.sport?.startsWith("Bike") || a.sport === "General") {
        realByCategory.bike.km += km;
        realByCategory.bike.min += min;
      } else if (a.sport === "Strength" || a.sport === "Physio") {
        realByCategory.strength.min += min;
      }
      // Hybrid: TSS dieser Aktivität auf easy/mod/hart verteilen.
      // v0.15.5 (O7): Harte Einheiten (Typ=hard) zählen KOMPLETT als hart (volle TSS rot), nicht nur der
      // Intervall-Anteil über Z3. Easy/Moderat bleiben zonen-anteilig (sonst Typ-Fallback).
      const t = a.tss || 0;
      realTotalTss += t;
      if (t > 0) {
        const type = a.type || (a.matched_session_id != null ? typeBySession.get(a.matched_session_id) : undefined);
        const typeCls = type ? typeIntensity(type) : null;
        if (typeCls === "hard") {
          realTssAcc.hard += t;
        } else {
          const zw = hasZoneKm ? zKm
            : (zMin && Object.values(zMin).some((v) => (v || 0) > 0)) ? zMin
            : (zSec && Object.values(zSec).some((v) => (v || 0) > 0)) ? zSec
            : null;
          let e = 0, m = 0, h = 0;
          if (zw) for (const [z, v] of Object.entries(zw)) { const zi = Number(z); const val = v || 0; if (zi <= 2) e += val; else if (zi === 3) m += val; else h += val; }
          const tot = e + m + h;
          if (tot > 0) {
            realTssAcc.easy += (t * e) / tot;
            realTssAcc.mod += (t * m) / tot;
            realTssAcc.hard += (t * h) / tot;
          } else {
            // v0.11.0 (ToDo 10): eigener Aktivitäts-Typ hat Vorrang vor dem gematchten Plan-Typ.
            const cls = typeCls ?? "easy";
            if (cls === "moderate") realTssAcc.mod += t; else realTssAcc.easy += t;
          }
        }
      }
    }
    for (const z of Object.keys(realZoneMin)) realZoneMin[Number(z)] = r1(realZoneMin[Number(z)]);
    for (const z of Object.keys(realZoneKm)) realZoneKm[Number(z)] = r1(realZoneKm[Number(z)]);
    realByCategory.run.km = r1(realByCategory.run.km);
    realByCategory.run.min = r1(realByCategory.run.min);
    realByCategory.run.h = r1(realByCategory.run.min / 60);
    realByCategory.bike.km = r1(realByCategory.bike.km);
    realByCategory.bike.min = r1(realByCategory.bike.min);
    realByCategory.bike.h = r1(realByCategory.bike.min / 60);
    realByCategory.strength.min = r1(realByCategory.strength.min);
    realByCategory.strength.h = r1(realByCategory.strength.min / 60);

    // Plan-Erfüllung je geplanter Einheit (v1.9.0): robustes Auto-Match (manuelle Zuordnung gewinnt).
    const matchMap = matchActivities(
      acts.map((a) => ({ id: a.id, date: a.date, type: a.type ?? null, tss: a.tss ?? null, moving_s: a.moving_s ?? null, matched_session_id: a.matched_session_id ?? null, sport: a.sport })),
      planned.filter((p) => p.id != null).map((p) => ({ id: p.id as number, date: p.date, type: p.type, planned_tss: p.planned_tss ?? null, planned_min: p.planned_min ?? null })),
    );
    const actBySession = new Map<number, typeof acts[number]>();
    for (const a of acts) { const sid = matchMap.get(a.id); if (sid != null) actBySession.set(sid, a); }
    const perSession = planned
      .filter((p) => p.id != null)
      .map((p) => {
        const a = actBySession.get(p.id as number);
        if (!a) return null;
        const comp = sessionCompletion(
          { planned_tss: p.planned_tss, zone_alloc: p.zone_alloc },
          { tss: a.tss, pace_zone_min: parseJson<Record<number, number> | null>(a.pace_zone_min, null) },
          zs.pace_zones,
        );
        return comp ? { session_id: p.id as number, date: p.date, type: p.type, pct: comp.pct, tssOnly: comp.tssOnly } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    const weekPct = perSession.length ? Math.round(perSession.reduce((s, x) => s + x.pct, 0) / perSession.length) : null;
    adherence = { perSession, weekPct, matchByActivity: Object.fromEntries(matchMap) };
  }

  // Intensität & Wochen-Last (ToDo v0.7.0): Donut nach Einheitstyp, Polarisierung über km-in-Zone.
  const thr = thresholds() as any;
  const win = Math.max(1, Math.round(thr.intensity_window_weeks ?? 4));
  const refDate = wk?.start_date || todayIso();

  // Geplanter Donut: Intensität je Einheitstyp (typeIntensity oben gebaut). Realer Donut: hybrid (s.o.).
  const tssIntensity = typeIntensityShares(planned, typeIntensity);
  const rtot = realTssAcc.easy + realTssAcc.mod + realTssAcc.hard;
  const realTssIntensity = rtot > 0
    ? { easy: r1((realTssAcc.easy / rtot) * 100), mod: r1((realTssAcc.mod / rtot) * 100), hard: r1((realTssAcc.hard / rtot) * 100) }
    : { easy: 0, mod: 0, hard: 0 };
  const zoneKmIntensity = zoneKmIntensityOf(planned, zs.hr_zones, zs.pace_zones);
  const plannedZoneKm = zoneKmOf(planned, zs.hr_zones, zs.pace_zones);

  // v0.11.0 (ToDo 2): geplant↔geplant und real↔real GETRENNT rechnen — die Wochenplanung zeigt die
  // geplanten Schilder (`flags`), der Wochenbericht die realen (`realLoadFlag`/`realKmFlag`).
  const isPast = !!wk && wk.end_date < todayIso();
  const refPlanned = avgPlannedWeeklyTss(refDate, win);
  const plannedRating = refPlanned != null ? weekRatingLevel(totals.tss, refPlanned, thr.easy_pct ?? 80, thr.hard_pct ?? 105) : null;
  const realWeekTss = wk
    ? ((db.prepare("SELECT SUM(COALESCE(tss,0)) s FROM activities WHERE profile_id=? AND date BETWEEN ? AND ?").get(pid(), wk.start_date, wk.end_date) as { s: number }).s || 0)
    : 0;
  const refWeekly = avgWeeklyTss(refDate, win);
  const realRating = refWeekly != null ? weekRatingLevel(realWeekTss, refWeekly, thr.easy_pct ?? 80, thr.hard_pct ?? 105) : null;
  // weekRating bleibt adaptiv (Rückwärtskompatibilität): real bei abgeschlossener Woche, sonst geplant.
  const weekRating = isPast ? realRating : plannedRating;

  // Reale km-Polarisierung aus den realen km-je-Zone (Z1-2 / Z3 / Z4-6).
  const realKmTot = Object.values(realZoneKm).reduce((a, b) => a + (b || 0), 0) || 1;
  const realKmIntensity = {
    easy: r1((((realZoneKm[1] || 0) + (realZoneKm[2] || 0)) / realKmTot) * 100),
    mod: r1(((realZoneKm[3] || 0) / realKmTot) * 100),
    hard: r1((((realZoneKm[4] || 0) + (realZoneKm[5] || 0) + (realZoneKm[6] || 0)) / realKmTot) * 100),
  };

  // Geplante Schilder → in `flags` (Wochenplanung). Reale Schilder separat (Wochenbericht).
  const loadFlag = weekLoadFlag(plannedRating);
  if (loadFlag) flags.push(loadFlag);
  const polFlag = kmPolarizationFlag(zoneKmIntensity);
  if (polFlag) flags.push(polFlag);
  const realLoadFlag = weekLoadFlag(realRating);
  const realKmFlag = kmPolarizationFlag(realKmIntensity);

  // Echte Zeit-in-Zone-Verteilung (G4, v1.3.0): 3 Zonen gegen LT1/LT2 + Polarisierungs-Index + Phasen-Ziel.
  const physioDist = physioTimeZones(realZoneMin, zs.hr_zones, zs.lt1_hr, zs.lthr);
  const polIndex = polarizationIndex(physioDist.z1, physioDist.z2, physioDist.z3);
  const phaseTarget = phaseDistributionTarget(wk?.phase);
  const realPolarizationFlag = polarizationFlag(physioDist, phaseTarget, polIndex);

  // Monotonie & Strain (Foster, v1.2.0): reale Tageslast der Woche inkl. Ruhetage (0).
  let monotony: ReturnType<typeof trainingMonotonyStrain> = { monotony: 0, strain: 0, weekTss: 0, flag: null };
  if (wk) {
    const dayMap = new Map<string, number>(
      (db.prepare("SELECT date, SUM(COALESCE(tss,0)) s FROM activities WHERE profile_id=? AND date BETWEEN ? AND ? GROUP BY date").all(pid(), wk.start_date, wk.end_date) as { date: string; s: number }[]).map((r) => [r.date, r.s]),
    );
    const days: number[] = [];
    for (let d = wk.start_date; d <= wk.end_date; d = addDaysIso(d, 1)) days.push(dayMap.get(d) || 0);
    monotony = trainingMonotonyStrain(days);
  }

  res.json({
    totals, flags, zones: zs.hr_zones, week: wk, projectedCtlRamp, projectedTsb, pmc: pmcHeader, vo2max,
    realZoneMin, realZoneKm, realByCategory,
    tssIntensity, realTssIntensity, realTotalTss, zoneKmIntensity, realKmIntensity, plannedZoneKm, weekRating,
    realLoadFlag, realKmFlag, adherence, tssRec,
    monotony: monotony.monotony, strain: monotony.strain, monotonyFlag: monotony.flag,
    physioDist, polarizationIndex: polIndex, phaseTarget, realPolarizationFlag,
  });
});

// ---- Coach „Heute" (v1.2.0): Readiness + regelbasierte Tages-Empfehlung (Vorschlag-Modus) ----
app.get("/api/today", (req, res) => {
  const date = String(req.query.date || todayIso());
  // Form via PMC bis `date` (aus voller Historie geseedet).
  const from = minIso(earliestDataDate() ?? date, date);
  const pmc = computePmc(dailyTssMap(from, date), from, date, todayIso());
  const lastPt = pmc.length ? pmc[pmc.length - 1] : null;
  const ramp = ctlRamp(pmc, 7);
  const ctl = lastPt?.ctl ?? 0, atl = lastPt?.atl ?? 0, tsb = lastPt?.tsb ?? null;

  // Saison-Phase der Woche, die `date` enthält.
  const wk = db.prepare("SELECT * FROM season_weeks_v2 WHERE profile_id=? AND start_date<=? AND end_date>=? LIMIT 1").get(pid(), date, date) as any;
  const phase = wk?.phase ?? null;
  const weekTssRec = tssRecommendation(ctl, phase);

  // HRV-Baseline (7 Tage vor `date`) + heutige Tagesfaktoren.
  const baseHrv = (db.prepare("SELECT hrv FROM daily_log_v2 WHERE profile_id=? AND date<? AND hrv IS NOT NULL ORDER BY date DESC LIMIT 7").all(pid(), date) as { hrv: number }[]).map((r) => r.hrv);
  const hrvBaseline = baseHrv.length >= 3
    ? (() => { const mean = baseHrv.reduce((a, b) => a + b, 0) / baseHrv.length; const sd = Math.sqrt(baseHrv.reduce((a, b) => a + (b - mean) ** 2, 0) / baseHrv.length); return { mean, sd }; })()
    : null;
  const todayRow = db.prepare("SELECT hrv, recovery, soreness, sleep_h FROM daily_log_v2 WHERE profile_id=? AND date=?").get(pid(), date) as any;
  const readiness = readinessScore({
    hrvToday: todayRow?.hrv ?? null, hrvBaseline,
    recovery: todayRow?.recovery ?? null, soreness: todayRow?.soreness ?? null, sleepH: todayRow?.sleep_h ?? null,
  });

  const plannedTypes = (db.prepare("SELECT type FROM planned_sessions WHERE profile_id=? AND date=? AND type!='Rest'").all(pid(), date) as { type: string }[]).map((r) => r.type);
  const recommendation = dailyRecommendation({ tsb, ctlRamp: ramp, phase, readinessLevel: readiness?.level ?? null, weekTssRec, plannedTypes });

  // Überlastungs-Frühwarnung (v1.4.0, C2): ACWR + 7-Tage-Monotonie + Ramp + Readiness → erklärter Risiko-Flag.
  const tssByDay = new Map<string, number>((db.prepare("SELECT date, SUM(COALESCE(tss,0)) s FROM activities WHERE profile_id=? AND date BETWEEN ? AND ? GROUP BY date").all(pid(), addDaysIso(date, -6), date) as { date: string; s: number }[]).map((r) => [r.date, r.s]));
  const days7: number[] = [];
  for (let i = 6; i >= 0; i--) days7.push(tssByDay.get(addDaysIso(date, -i)) || 0);
  const mono7 = trainingMonotonyStrain(days7).monotony;
  const acwr = ctl > 0 ? Math.round((atl / ctl) * 100) / 100 : null;
  const injuryRisk = injuryRiskFlag({ acwr, monotony: mono7, ctlRamp: ramp, readinessLevel: readiness?.level ?? null, ctl });

  // Adaptiver Coach (v1.5.0, S): heutige Haupt-Einheit an Form/Readiness/Risiko anpassen (Vorschlag-Modus).
  const todayMain = db.prepare(
    "SELECT id, type, planned_tss FROM planned_sessions WHERE profile_id=? AND date=? AND type!='Rest' AND sport='Run' ORDER BY planned_tss DESC LIMIT 1",
  ).get(pid(), date) as { id: number; type: string; planned_tss: number } | undefined;
  const weekStart = wk?.start_date ?? date;
  const weekRealized = (db.prepare("SELECT SUM(COALESCE(tss,0)) s FROM activities WHERE profile_id=? AND date BETWEEN ? AND ?").get(pid(), weekStart, date) as { s: number }).s || 0;
  const gateMode = (getSetting<string>("readiness_gate_mode", "advisory") === "gate" ? "gate" : "advisory") as "advisory" | "gate";
  const adjCtx = (zsX: ReturnType<typeof effectiveZoneSet>) => ({
    tsb, ctlRamp: ramp, readinessLevel: readiness?.level ?? null, injuryLevel: injuryRisk?.level ?? null,
    weekTssRecMin: weekTssRec?.min ?? null, weekRealizedTss: round1(weekRealized),
    zones: { pace_zones: zsX.pace_zones, threshold_pace: zsX.threshold_pace, lt1_pace: zsX.lt1_pace }, gateMode,
  });
  let adjustment: ReturnType<typeof adjustTodaySession> & { originalSessionId?: number } | null = null;
  if (todayMain) {
    const adj = adjustTodaySession({ type: todayMain.type, planned_tss: todayMain.planned_tss }, adjCtx(effectiveZoneSet(date)));
    if (adj) adjustment = { ...adj, originalSessionId: todayMain.id };
  }

  // v1.9.0: nächste harte Einheit (heute..+7 Tage) + Readiness-Bewertung — bei schwachen HRV/Schlaf-Werten
  // Entschärfen-/Recovery-Vorschlag, sonst „wie geplant". Immer geliefert, damit die Karte sichtbar ist.
  let nextHard: { date: string; type: string; adjustment: NonNullable<typeof adjustment> } | null = null;
  const hardRow = db.prepare(
    "SELECT id, type, planned_tss, date FROM planned_sessions WHERE profile_id=? AND date BETWEEN ? AND ? AND sport='Run' AND type IN ('Threshold','VO2','VO2short','VO2long','LT2','Hill','Race') ORDER BY date LIMIT 1",
  ).get(pid(), date, addDaysIso(date, 7)) as { id: number; type: string; planned_tss: number; date: string } | undefined;
  if (hardRow) {
    const adjH = adjustTodaySession({ type: hardRow.type, planned_tss: hardRow.planned_tss }, adjCtx(effectiveZoneSet(hardRow.date)));
    if (adjH) nextHard = { date: hardRow.date, type: hardRow.type, adjustment: { ...adjH, originalSessionId: hardRow.id } };
  }

  res.json({
    date,
    form: { ctl: round1(ctl), atl: round1(atl), tsb: tsb != null ? round1(tsb) : null, ramp, acwr },
    phase, weekTssRec, readiness, plannedTypes, recommendation, injuryRisk, adjustment, nextHard,
  });
});

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---- Intervall-/Effort-Trend (ToDo 2/13/20) -----------------------------

app.get("/api/intervals/trend", (req, res) => {
  const to = String(req.query.to || todayIso());
  const def = new Date(to + "T00:00:00Z");
  def.setUTCFullYear(def.getUTCFullYear() - 1); // Default: letzte 12 Monate
  const from = String(req.query.from || def.toISOString().slice(0, 10));

  const rows = db
    .prepare(
      `SELECT id, date, sport, type, name, efforts, matched_session_id FROM activities
       WHERE date BETWEEN ? AND ? AND profile_id=? AND efforts IS NOT NULL AND efforts != 'null' AND efforts != '[]'
       ORDER BY date`,
    )
    .all(from, to, pid()) as any[];

  const byId = db.prepare("SELECT type FROM planned_sessions WHERE id=?");
  // Abgeleitete Einheit: geplante Session am selben Tag mit gleichem Sport, harte Typen zuerst.
  const byDate = db.prepare(
    `SELECT type FROM planned_sessions WHERE date=? AND sport=? AND profile_id=? AND type != 'Rest'
     ORDER BY CASE WHEN type IN ('Threshold','VO2','Race','Hill','LT1','LT2','VO2short','VO2long') THEN 0 ELSE 1 END, sort_order LIMIT 1`,
  );

  const out: IntervalEffortStat[] = [];
  for (const a of rows) {
    const efforts = parseJson<EffortLine[] | null>(a.efforts, null);
    if (!Array.isArray(efforts) || !efforts.length) continue;
    // v0.11.0 (ToDo 10): eigener Aktivitäts-Typ hat Vorrang, sonst gematchte/abgeleitete Plan-Einheit.
    let sessionType: string | null = a.type ?? null;
    if (!sessionType && a.matched_session_id) sessionType = (byId.get(a.matched_session_id) as any)?.type ?? null;
    if (!sessionType) sessionType = (byDate.get(a.date, a.sport, pid()) as any)?.type ?? null;
    const lthr = effectiveZoneSet(a.date).lthr;
    out.push(intervalEffortStat({ date: a.date, sport: a.sport, name: a.name, sessionType, efforts, lthr }));
  }
  res.json(out);
});

// ---- Dev-only: Übersetzungen aus dem Web-UI bearbeiten (Alt+Klick) -----
// Schreibt einen Key in client/src/translations/{de,en}.json zurück. Nur im Dev-Modus aktiv
// (tsx watch setzt NODE_ENV nicht; `npm start`/Electron setzen production → Endpoint deaktiviert).
if (process.env.NODE_ENV !== "production") {
  const i18nDir = join(__dirname, "..", "client", "src", "translations");
  const readDict = (lang: string): Record<string, string> => {
    try {
      return JSON.parse(readFileSync(join(i18nDir, `${lang}.json`), "utf8"));
    } catch {
      return {};
    }
  };
  const writeDict = (lang: string, dict: Record<string, string>) => {
    const sorted = Object.fromEntries(Object.keys(dict).sort().map((k) => [k, dict[k]]));
    writeFileSync(join(i18nDir, `${lang}.json`), JSON.stringify(sorted, null, 2) + "\n");
  };
  app.post("/api/dev/i18n", (req, res) => {
    const { key, de, en } = (req.body || {}) as { key?: string; de?: string; en?: string };
    if (!key || typeof key !== "string") return res.status(400).json({ error: "key fehlt" });
    const dDe = readDict("de");
    const dEn = readDict("en");
    dDe[key] = String(de ?? "");
    dEn[key] = String(en ?? "");
    writeDict("de", dDe);
    writeDict("en", dEn);
    res.json({ ok: true });
  });
}

// ---- static (production) ----------------------------------------------
// Im Electron-Paket liegt das gebaute Frontend neben den Server-Bundles; sonst im Projekt-`dist/`.
// RUNLOG_DIST erlaubt dem Electron-Main, den Pfad explizit zu setzen.
const distDir = process.env.RUNLOG_DIST || join(__dirname, "..", "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(distDir, "index.html")));
}

/**
 * Startet den HTTP-Server. Mit port=0 vergibt das OS einen freien Port (für Electron) —
 * der tatsächlich genutzte Port wird zurückgeliefert. CLI-Start nutzt PORT bzw. 3000.
 */
export function startServer(port = Number(process.env.PORT || 3000)): Promise<{ port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const actual = (server.address() as { port: number }).port;
      console.log(`RunLog server läuft auf http://localhost:${actual}`);
      resolve({ port: actual });
    });
  });
}

// Direkter CLI-Start (`npm start` / `tsx server/index.ts`): sofort lauschen.
// Im Electron-Main wird startServer() stattdessen explizit aufgerufen (RUNLOG_EMBED=1 unterdrückt Auto-Start).
if (!process.env.RUNLOG_EMBED) {
  startServer();
}
