import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { db, initSchema, getSetting, setSetting, renumberWeeks, activeProfile, DEFAULT_HR_ZONES } from "./db.ts";
import {
  plannedTss,
  computePmc,
  ctlRamp,
  type HrZone,
  type PmcPoint,
} from "./load.ts";
import {
  weekTotals,
  analyzeWeek,
  plannedSessionTss,
  intervalEffortStat,
  type PlannedSession,
  type CategoryTotals,
  type EffortLine,
  type IntervalEffortStat,
} from "./analysis.ts";
import { seedSeason } from "./import-docx.ts";
import { stravaStatus, stravaLogin, stravaCallback, stravaSync } from "./strava.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));

initSchema();

const todayIso = () => new Date().toISOString().slice(0, 10);
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
    return { id: 0, hr_zones: DEFAULT_HR_ZONES as HrZone[], pace_zones: [] as number[], speed_zones: [] as number[], power_zones: [] as number[], lthr: 172, ftp: 265, threshold_pace: 230 };
  }
  let pick = rows[0];
  for (const r of rows) if (r.valid_from <= date) pick = r;
  return {
    id: pick.id,
    hr_zones: parseJson<HrZone[]>(pick.hr_zones, DEFAULT_HR_ZONES as HrZone[]),
    pace_zones: parseJson<number[]>(pick.pace_zones, []),
    speed_zones: parseJson<number[]>(pick.speed_zones, []),
    power_zones: parseJson<number[]>(pick.power_zones, []),
    lthr: pick.lthr ?? 172,
    ftp: pick.ftp ?? 265,
    threshold_pace: pick.threshold_pace ?? 230,
  };
}

function thresholds() {
  return getSetting("thresholds", {
    volume_pct: 10,
    ctl_ramp_max: 7,
    acwr_high: 1.3,
    acwr_low: 0.8,
    hard_pct_max: 20,
    z3_pct_max: 15,
    longrun_pct_max: 35,
    tsb_raceweek_min: -5,
  });
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

// ---- settings & zones --------------------------------------------------

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/settings", (_req, res) => {
  res.json({
    thresholds: thresholds(),
    run_equiv_bike_factor: getSetting("run_equiv_bike_factor", 0.25),
    coros_to_tss: getSetting("coros_to_tss", 0.6),
    athlete: getSetting("athlete", { name: "Kolja", weight: 69, max_hr: 196 }),
    strava_client_id: getSetting("strava_client_id", ""),
    strava_client_secret: getSetting("strava_client_secret", ""),
  });
});

// ---- Strava (OAuth + Sync, ToDo #10/#11) --------------------------------

app.get("/api/strava/status", stravaStatus);
app.get("/api/strava/login", stravaLogin);
app.get("/api/strava/callback", stravaCallback);
app.post("/api/strava/sync", stravaSync);

app.put("/api/settings", (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) setSetting(k, v);
  res.json({ ok: true });
});

app.get("/api/zonesets", (_req, res) => {
  const rows = db.prepare("SELECT * FROM zone_sets WHERE profile_id=? ORDER BY valid_from DESC").all(pid()) as unknown as ZoneSetRow[];
  res.json(rows.map((r) => ({ ...r, hr_zones: parseJson(r.hr_zones, []), pace_zones: parseJson(r.pace_zones, []), speed_zones: parseJson(r.speed_zones, []), power_zones: parseJson(r.power_zones, []) })));
});

app.get("/api/zoneset", (req, res) => {
  res.json(effectiveZoneSet(String(req.query.date || todayIso())));
});

app.post("/api/zonesets", (req, res) => {
  const b = req.body || {};
  const r = db
    .prepare(
      `INSERT INTO zone_sets(profile_id, valid_from, hr_zones, pace_zones, speed_zones, power_zones, lthr, ftp, threshold_pace, source, note, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      pid(),
      b.valid_from || todayIso(),
      JSON.stringify(b.hr_zones || DEFAULT_HR_ZONES),
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
    `UPDATE zone_sets SET valid_from=?, hr_zones=?, pace_zones=?, speed_zones=?, power_zones=?, lthr=?, ftp=?, threshold_pace=?, source=?, note=? WHERE id=?`,
  ).run(
    b.valid_from,
    JSON.stringify(b.hr_zones || []),
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
    .prepare("INSERT INTO options(kind, value, label, color, sort, active) VALUES(?,?,?,?,?,?)")
    .run(b.kind, b.value, b.label || b.value, b.color ?? null, b.sort ?? 0, b.active ?? 1);
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put("/api/options/:id", (req, res) => {
  const b = req.body || {};
  db.prepare("UPDATE options SET label=?, color=?, sort=?, active=? WHERE id=?").run(
    b.label, b.color ?? null, b.sort ?? 0, b.active ?? 1, req.params.id,
  );
  res.json({ ok: true });
});

app.delete("/api/options/:id", (req, res) => {
  db.prepare("DELETE FROM options WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ---- season ------------------------------------------------------------

app.get("/api/season", (_req, res) => {
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
  db.prepare("DELETE FROM season_weeks_v2 WHERE week_no=? AND profile_id=?").run(req.params.no, pid());
  renumberWeeks();
  res.json({ ok: true });
});

app.post("/api/seed", (_req, res) => {
  const r = seedSeason();
  renumberWeeks();
  res.json(r);
});

// ---- planned sessions --------------------------------------------------

function computeSessionTss(b: any): number {
  const zs = effectiveZoneSet(b.date || todayIso());
  return plannedSessionTss(b, zs.hr_zones, zs.lthr, zs.pace_zones, zs.power_zones, zs.ftp);
}

app.get("/api/sessions", (req, res) => {
  const { week, from, to } = req.query as Record<string, string>;
  let rows;
  if (week) rows = db.prepare("SELECT * FROM planned_sessions WHERE week_no=? AND profile_id=? ORDER BY date, sort_order").all(week, pid());
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
      `INSERT INTO activities(profile_id, strava_id, date, sport, source, name, distance_m, moving_s, elapsed_s, avg_hr, max_hr, avg_power, elevation, avg_cadence, training_load, tss, kcal, zones, zone_min, zone_km, efforts, overrides, matched_session_id, notes)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      pid(),
      b.strava_id ?? null,
      b.date,
      b.sport || "Run",
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
      b.tss ?? null,
      b.kcal ?? null,
      JSON.stringify(b.zones || null),
      JSON.stringify(b.zone_min || null),
      JSON.stringify(b.zone_km || null),
      JSON.stringify(b.efforts || null),
      JSON.stringify(b.overrides || []),
      b.matched_session_id ?? null,
      b.notes || "",
    );
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put("/api/activities/:id", (req, res) => {
  const b = req.body || {};
  db.prepare(
    `UPDATE activities SET date=?, sport=?, source=?, name=?, distance_m=?, moving_s=?, elapsed_s=?, avg_hr=?, max_hr=?, avg_power=?, elevation=?, avg_cadence=?, training_load=?, tss=?, kcal=?, zones=?, zone_min=?, zone_km=?, efforts=?, overrides=?, matched_session_id=?, notes=? WHERE id=?`,
  ).run(
    b.date,
    b.sport || "Run",
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
    b.tss ?? null,
    b.kcal ?? null,
    JSON.stringify(b.zones || null),
    JSON.stringify(b.zone_min || null),
    JSON.stringify(b.zone_km || null),
    JSON.stringify(b.efforts || null),
    JSON.stringify(b.overrides || []),
    b.matched_session_id ?? null,
    b.notes || "",
    req.params.id,
  );
  res.json({ ok: true });
});

app.delete("/api/activities/:id", (req, res) => {
  db.prepare("DELETE FROM activities WHERE id=?").run(req.params.id);
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
  const placeholders = cols.map(() => "?").join(",");
  const updates = cols.map((c) => `${c}=excluded.${c}`).join(",");
  db.prepare(
    `INSERT INTO daily_log_v2(date, profile_id${cols.length ? "," + cols.join(",") : ""}) VALUES(?,?${cols.length ? "," + placeholders : ""})
     ON CONFLICT(date, profile_id) DO UPDATE SET ${updates || "date=excluded.date"}`,
  ).run(req.params.date, pid(), ...cols.map((c) => b[c]));
  res.json({ ok: true });
});

// ---- week log ----------------------------------------------------------

app.get("/api/weeklog/:week", (req, res) => {
  const row = db.prepare("SELECT * FROM week_log_v2 WHERE week_no=? AND profile_id=?").get(req.params.week, pid()) as any;
  if (!row) return res.json(null);
  res.json({ ...row, checks: parseJson(row.checks, {}), whoop: parseJson(row.whoop, {}), refl_extra: parseJson(row.refl_extra, {}) });
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
  const map = dailyTssMap(from, to);
  const pmc = computePmc(map, from, to, todayIso());
  res.json({ pmc, ctlRamp7: ctlRamp(pmc, 7), ctlRamp28: ctlRamp(pmc, 28) });
});

// ---- analyze week ------------------------------------------------------

function weekActualKm(start: string, end: string): number {
  const row = db
    .prepare("SELECT SUM(COALESCE(distance_m,0)) m FROM activities WHERE sport='Run' AND date BETWEEN ? AND ? AND profile_id=?")
    .get(start, end, pid()) as { m: number };
  return Math.round(((row?.m || 0) / 1000) * 10) / 10;
}

app.get("/api/analyze/week/:no", (req, res) => {
  const wk = db.prepare("SELECT * FROM season_weeks_v2 WHERE week_no=? AND profile_id=?").get(req.params.no, pid()) as any;
  const sessions = db.prepare("SELECT * FROM planned_sessions WHERE week_no=? AND profile_id=? ORDER BY date").all(req.params.no, pid()) as any[];
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
  if (wk) {
    const from = "2026-01-01";
    const map = dailyTssMap(from, wk.end_date);
    const pmc = computePmc(map, from, wk.end_date, todayIso());
    projectedCtlRamp = ctlRamp(pmc, 7);
    projectedTsb = pmc.length ? pmc[pmc.length - 1].tsb : null;
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
    readiness,
    thresholds: thresholds(),
  });

  // Reale Zeit-in-Zone + Kategorie-Summen aus den activities der Woche (ToDo 4/21, #77).
  // Priorität je Aktivität: zone_km (km je Zone, manuell) > zone_min (Minuten, manuell) > zones (Strava-Sek./60).
  // zone_km -> Minuten: km × Pace der Zone (pace_zones[z-1] s/km, sonst Ø-Pace der Aktivität, sonst 300 s/km).
  // realZoneKm: km je Zone nur aus zone_km — wo nur zone_min/zones existiert, bleiben km weg.
  const realZoneMin: Record<number, number> = {};
  const realZoneKm: Record<number, number> = {};
  zs.hr_zones.forEach((z) => {
    realZoneMin[z.z] = 0;
    realZoneKm[z.z] = 0;
  });
  // realByCategory: reale Summen je Kategorie. `min` bleibt aus Kompatibilität (Welle-1-Client),
  // `h` (Stunden) kommt zusätzlich dazu (Fix-Runde, Anzeige in km/h).
  const realByCategory: { run: { km: number; min: number; h: number }; bike: { km: number; min: number; h: number }; strength: { min: number; h: number } } =
    { run: { km: 0, min: 0, h: 0 }, bike: { km: 0, min: 0, h: 0 }, strength: { min: 0, h: 0 } };
  if (wk) {
    const acts = db
      .prepare("SELECT sport, distance_m, moving_s, zones, zone_min, zone_km FROM activities WHERE date BETWEEN ? AND ? AND profile_id=?")
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
  }

  res.json({ totals, flags, zones: zs.hr_zones, week: wk, projectedCtlRamp, projectedTsb, realZoneMin, realZoneKm, realByCategory });
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
      `SELECT id, date, sport, name, efforts, matched_session_id FROM activities
       WHERE date BETWEEN ? AND ? AND profile_id=? AND efforts IS NOT NULL AND efforts != 'null' AND efforts != '[]'
       ORDER BY date`,
    )
    .all(from, to, pid()) as any[];

  const byId = db.prepare("SELECT type FROM planned_sessions WHERE id=?");
  // Abgeleitete Einheit: geplante Session am selben Tag mit gleichem Sport, harte Typen zuerst.
  const byDate = db.prepare(
    `SELECT type FROM planned_sessions WHERE date=? AND sport=? AND profile_id=? AND type != 'Rest'
     ORDER BY CASE WHEN type IN ('Threshold','VO2','Race','Hill') THEN 0 ELSE 1 END, sort_order LIMIT 1`,
  );

  const out: IntervalEffortStat[] = [];
  for (const a of rows) {
    const efforts = parseJson<EffortLine[] | null>(a.efforts, null);
    if (!Array.isArray(efforts) || !efforts.length) continue;
    let sessionType: string | null = null;
    if (a.matched_session_id) sessionType = (byId.get(a.matched_session_id) as any)?.type ?? null;
    if (!sessionType) sessionType = (byDate.get(a.date, a.sport, pid()) as any)?.type ?? null;
    const lthr = effectiveZoneSet(a.date).lthr;
    out.push(intervalEffortStat({ date: a.date, sport: a.sport, name: a.name, sessionType, efforts, lthr }));
  }
  res.json(out);
});

// ---- static (production) ----------------------------------------------

const distDir = join(__dirname, "..", "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(distDir, "index.html")));
}

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`RunLog server läuft auf http://localhost:${PORT}`);
});
