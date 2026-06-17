import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
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
  fitCriticalSpeed,
  predictFromCs,
  type HrZone,
  type PmcPoint,
} from "./load.ts";
import { vo2maxLevel } from "./norms.ts";
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
  tssRecommendation,
  sessionCompletion,
  type IntLevel,
  type PlannedSession,
  type CategoryTotals,
  type EffortLine,
  type IntervalEffortStat,
} from "./analysis.ts";
import { stravaStatus, stravaLogin, stravaCallback, stravaSync, stravaEnrich, fetchAthleteZonesAndFtp } from "./strava.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));

initSchema();

const todayIso = () => new Date().toISOString().slice(0, 10);
/** YYYY-MM-DD um n Tage verschieben (UTC). */
const addDaysIso = (iso: string, n: number): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// Aktives Profil (leichter Account-Wechsel, ToDo #9): alle Daten-Queries filtern darauf.
const pid = () => activeProfile();

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
  source: string;
  note: string;
}

function effectiveZoneSet(date: string) {
  const rows = db.prepare("SELECT * FROM zone_sets WHERE profile_id=? ORDER BY valid_from").all(pid()) as unknown as ZoneSetRow[];
  if (!rows.length) {
    return { id: 0, hr_zones: DEFAULT_HR_ZONES as HrZone[], hr_zones_bike: null as HrZone[] | null, pace_zones: [] as number[], speed_zones: [] as number[], power_zones: [] as number[], lthr: 172, ftp: 265, threshold_pace: 230 };
  }
  let pick = rows[0];
  for (const r of rows) if (r.valid_from <= date) pick = r;
  return {
    id: pick.id,
    hr_zones: parseJson<HrZone[]>(pick.hr_zones, DEFAULT_HR_ZONES as HrZone[]),
    hr_zones_bike: pick.hr_zones_bike ? parseJson<HrZone[]>(pick.hr_zones_bike, []) : null,
    pace_zones: parseJson<number[]>(pick.pace_zones, []),
    speed_zones: parseJson<number[]>(pick.speed_zones, []),
    power_zones: parseJson<number[]>(pick.power_zones, []),
    lthr: pick.lthr ?? 172,
    ftp: pick.ftp ?? 265,
    threshold_pace: pick.threshold_pace ?? 230,
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
    `INSERT INTO races(profile_id, date, name, distance_m, time_s, placement, notes, splits, max_hr, avg_hr, elevation_m, source)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(pid(), b.date, b.name || "", b.distance_m ?? null, b.time_s ?? null, b.placement || "", b.notes || "",
    JSON.stringify(b.splits || []), b.max_hr ?? null, b.avg_hr ?? null, b.elevation_m ?? null, b.source || "manual");
  // v0.14.0 (ToDo 3): neuer Wettkampf → fehlende Wochen bis zum Renntag herstellen (Wettkampf-Planung).
  ensureSeasonWeeks(pid());
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put("/api/races/:id", (req, res) => {
  const b = req.body || {};
  db.prepare(
    `UPDATE races SET date=?, name=?, distance_m=?, time_s=?, placement=?, notes=?, splits=?, max_hr=?, avg_hr=?, elevation_m=? WHERE id=? AND profile_id=?`,
  ).run(b.date, b.name || "", b.distance_m ?? null, b.time_s ?? null, b.placement || "", b.notes || "",
    JSON.stringify(b.splits || []), b.max_hr ?? null, b.avg_hr ?? null, b.elevation_m ?? null, req.params.id, pid());
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

// ---- Bestzeiten + Critical Speed (v0.14.0, ToDo 8) ----------------------
// PBs je Standarddistanz aus Stravas best_efforts; 2-Parameter-CS-Modell d = CS·t + D' (lineare
// Regression über aerobe PBs 2–30 min, ≥1000 m) + Vorhersagen für 5k/10k/HM/M.
const CS_PRED_DISTANCES = [5000, 10000, 21097, 42195];
app.get("/api/bests", (_req, res) => {
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

  const fit = pbs.filter((p) => p.time_s >= 120 && p.time_s <= 1800 && p.distance_m >= 1000);
  const cs = fitCriticalSpeed(fit);
  const predictions = cs ? predictFromCs(cs.cs_mps, cs.dPrime_m, CS_PRED_DISTANCES) : [];
  res.json({ pbs, cs, predictions });
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

// ---- Fitness-Trend: VO2max (VDOT) + Renn-Prognose über die Zeit (v0.15.0, O1+O2) ----
// 90-Tage-Rolling-Window über die Strava-best_efforts: je Woche bestes VDOT + CS-Fit-Prognosen.
const FITNESS_WINDOW_DAYS = 90;
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
    // VDOT nur aus überwiegend aeroben Leistungen (≥1500 m, 3–30 min) — kurze Sprints überschätzen VO2max.
    let bestVdot = 0;
    for (const p of distPts) if (p.distance_m >= 1500 && p.time_s >= 180 && p.time_s <= 1800) bestVdot = Math.max(bestVdot, vdot(p.distance_m, p.time_s));
    const csFit = fitCriticalSpeed(distPts.filter((p) => p.time_s >= 120 && p.time_s <= 1800 && p.distance_m >= 1000));
    const pmap = new Map((csFit ? predictFromCs(csFit.cs_mps, csFit.dPrime_m, CS_PRED_DISTANCES) : []).map((x) => [x.distance_m, x.time_s]));
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
    `INSERT INTO season_weeks_v2(profile_id, week_no, label, phase, start_date, end_date, target_km, goal_race, notes)
     VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(profile_id, week_no) DO UPDATE SET label=excluded.label, phase=excluded.phase,
       start_date=excluded.start_date, end_date=excluded.end_date, target_km=excluded.target_km,
       goal_race=excluded.goal_race, notes=excluded.notes`,
  ).run(pid(), req.params.no, b.label || "", b.phase || "", b.start_date, b.end_date, b.target_km ?? null, b.goal_race || "", b.notes || "");
  renumberWeeks();
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
  res.json((rows as any[]).map((r) => ({ ...r, zone_alloc: parseJson(r.zone_alloc, null), structured: parseJson(r.structured, null), efforts: parseJson(r.efforts, null) })));
});

app.post("/api/sessions", (req, res) => {
  const b = req.body || {};
  const tss = computeSessionTss(b);
  const r = db
    .prepare(
      `INSERT INTO planned_sessions(profile_id, date, week_no, sport, type, planned_km, planned_min, zone_alloc, description, structured, efforts, planned_tss, sort_order)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
    );
  res.json({ id: Number(r.lastInsertRowid), planned_tss: tss });
});

app.put("/api/sessions/:id", (req, res) => {
  const b = req.body || {};
  const tss = computeSessionTss(b);
  db.prepare(
    `UPDATE planned_sessions SET date=?, week_no=?, sport=?, type=?, planned_km=?, planned_min=?, zone_alloc=?, description=?, structured=?, efforts=?, planned_tss=?, sort_order=? WHERE id=?`,
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
app.post("/api/activities/:id/relink-efforts", (req, res) => {
  db.prepare(
    "UPDATE activities SET efforts=NULL, efforts_locked=0, laps_fetched=0 WHERE id=? AND profile_id=? AND source='strava'",
  ).run(req.params.id, pid());
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
app.post("/api/recompute-tss", (_req, res) => {
  try {
    const profile = pid();
    const bak = `${DB_PATH}.${new Date().toISOString().replace(/[:.]/g, "-")}-recompute.bak`;
    db.exec(`VACUUM INTO '${bak.replace(/'/g, "''")}'`);

    const acts = db.prepare(
      "SELECT id, date, sport, distance_m, moving_s, avg_power, ngp, np, tss, overrides FROM activities " +
        "WHERE profile_id=? AND (sport='Run' OR sport LIKE 'Bike%' OR sport='General') AND moving_s IS NOT NULL",
    ).all(profile) as any[];
    const updA = db.prepare("UPDATE activities SET tss=? WHERE id=?");
    let activities = 0;
    for (const a of acts) {
      const t = activityTssToStore({ ...a, overrides: parseJson(a.overrides, []) });
      if (t != null) { updA.run(t, a.id); activities++; }
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
    res.json({ ok: true, backup: bak, activities, sessions });
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
  let adherence: { perSession: { session_id: number; date: string; type: string; pct: number; tssOnly: boolean }[]; weekPct: number | null } = { perSession: [], weekPct: null };
  if (wk) {
    const acts = db
      .prepare("SELECT sport, type, distance_m, moving_s, zones, zone_min, zone_km, pace_zone_min, tss, matched_session_id FROM activities WHERE date BETWEEN ? AND ? AND profile_id=?")
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

    // Plan-Erfüllung je geplanter Einheit mit gematchter Aktivität (v0.14.0, ToDo 12).
    const perSession = planned
      .filter((p) => p.id != null)
      .map((p) => {
        const a = acts.find((x) => x.matched_session_id === p.id);
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
    adherence = { perSession, weekPct };
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

  res.json({
    totals, flags, zones: zs.hr_zones, week: wk, projectedCtlRamp, projectedTsb,
    realZoneMin, realZoneKm, realByCategory,
    tssIntensity, realTssIntensity, realTotalTss, zoneKmIntensity, realKmIntensity, plannedZoneKm, weekRating,
    realLoadFlag, realKmFlag, adherence, tssRec,
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
