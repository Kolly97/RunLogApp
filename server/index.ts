import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { db, initSchema, getSetting, setSetting, DEFAULT_HR_ZONES } from "./db.ts";
import {
  plannedTss,
  computePmc,
  ctlRamp,
  type HrZone,
  type PmcPoint,
} from "./load.ts";
import { weekTotals, analyzeWeek, plannedSessionTss, type PlannedSession } from "./analysis.ts";
import { seedSeason } from "./import-docx.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));

initSchema();

const todayIso = () => new Date().toISOString().slice(0, 10);

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
  lthr: number;
  ftp: number;
  threshold_pace: number;
  source: string;
  note: string;
}

function effectiveZoneSet(date: string) {
  const rows = db.prepare("SELECT * FROM zone_sets ORDER BY valid_from").all() as unknown as ZoneSetRow[];
  if (!rows.length) {
    return { id: 0, hr_zones: DEFAULT_HR_ZONES as HrZone[], pace_zones: [] as number[], lthr: 172, ftp: 265, threshold_pace: 230 };
  }
  let pick = rows[0];
  for (const r of rows) if (r.valid_from <= date) pick = r;
  return {
    id: pick.id,
    hr_zones: parseJson<HrZone[]>(pick.hr_zones, DEFAULT_HR_ZONES as HrZone[]),
    pace_zones: parseJson<number[]>(pick.pace_zones, []),
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
    .prepare("SELECT date, SUM(COALESCE(tss,0)) s FROM activities WHERE date BETWEEN ? AND ? GROUP BY date")
    .all(from, to) as { date: string; s: number }[];
  for (const a of acts) map.set(a.date, a.s);
  const today = todayIso();
  const plans = db
    .prepare("SELECT date, SUM(COALESCE(planned_tss,0)) s FROM planned_sessions WHERE date BETWEEN ? AND ? GROUP BY date")
    .all(from, to) as { date: string; s: number }[];
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
  });
});

app.put("/api/settings", (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) setSetting(k, v);
  res.json({ ok: true });
});

app.get("/api/zonesets", (_req, res) => {
  const rows = db.prepare("SELECT * FROM zone_sets ORDER BY valid_from DESC").all() as unknown as ZoneSetRow[];
  res.json(rows.map((r) => ({ ...r, hr_zones: parseJson(r.hr_zones, []), pace_zones: parseJson(r.pace_zones, []) })));
});

app.get("/api/zoneset", (req, res) => {
  res.json(effectiveZoneSet(String(req.query.date || todayIso())));
});

app.post("/api/zonesets", (req, res) => {
  const b = req.body || {};
  const r = db
    .prepare(
      `INSERT INTO zone_sets(valid_from, hr_zones, pace_zones, lthr, ftp, threshold_pace, source, note, created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      b.valid_from || todayIso(),
      JSON.stringify(b.hr_zones || DEFAULT_HR_ZONES),
      JSON.stringify(b.pace_zones || []),
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
    `UPDATE zone_sets SET valid_from=?, hr_zones=?, pace_zones=?, lthr=?, ftp=?, threshold_pace=?, source=?, note=? WHERE id=?`,
  ).run(
    b.valid_from,
    JSON.stringify(b.hr_zones || []),
    JSON.stringify(b.pace_zones || []),
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

// ---- season ------------------------------------------------------------

app.get("/api/season", (_req, res) => {
  res.json(db.prepare("SELECT * FROM season_weeks ORDER BY week_no").all());
});

app.put("/api/season/week/:no", (req, res) => {
  const b = req.body || {};
  db.prepare(
    `INSERT INTO season_weeks(week_no, label, phase, start_date, end_date, target_km, goal_race, notes)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(week_no) DO UPDATE SET label=excluded.label, phase=excluded.phase,
       start_date=excluded.start_date, end_date=excluded.end_date, target_km=excluded.target_km,
       goal_race=excluded.goal_race, notes=excluded.notes`,
  ).run(req.params.no, b.label || "", b.phase || "", b.start_date, b.end_date, b.target_km ?? null, b.goal_race || "", b.notes || "");
  res.json({ ok: true });
});

app.delete("/api/season/week/:no", (req, res) => {
  db.prepare("DELETE FROM season_weeks WHERE week_no=?").run(req.params.no);
  res.json({ ok: true });
});

app.post("/api/seed", (_req, res) => {
  res.json(seedSeason());
});

// ---- planned sessions --------------------------------------------------

function computeSessionTss(b: any): number {
  const zs = effectiveZoneSet(b.date || todayIso());
  return plannedSessionTss(b, zs.hr_zones, zs.lthr, zs.pace_zones);
}

app.get("/api/sessions", (req, res) => {
  const { week, from, to } = req.query as Record<string, string>;
  let rows;
  if (week) rows = db.prepare("SELECT * FROM planned_sessions WHERE week_no=? ORDER BY date, sort_order").all(week);
  else if (from && to) rows = db.prepare("SELECT * FROM planned_sessions WHERE date BETWEEN ? AND ? ORDER BY date, sort_order").all(from, to);
  else rows = db.prepare("SELECT * FROM planned_sessions ORDER BY date, sort_order").all();
  res.json((rows as any[]).map((r) => ({ ...r, zone_alloc: parseJson(r.zone_alloc, null), structured: parseJson(r.structured, null) })));
});

app.post("/api/sessions", (req, res) => {
  const b = req.body || {};
  const tss = computeSessionTss(b);
  const r = db
    .prepare(
      `INSERT INTO planned_sessions(date, week_no, sport, type, planned_km, planned_min, zone_alloc, description, structured, planned_tss, sort_order)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      b.date,
      b.week_no ?? null,
      b.sport || "Run",
      b.type || "Easy",
      b.planned_km ?? null,
      b.planned_min ?? null,
      JSON.stringify(b.zone_alloc || null),
      b.description || "",
      JSON.stringify(b.structured || null),
      tss,
      b.sort_order ?? 0,
    );
  res.json({ id: Number(r.lastInsertRowid), planned_tss: tss });
});

app.put("/api/sessions/:id", (req, res) => {
  const b = req.body || {};
  const tss = computeSessionTss(b);
  db.prepare(
    `UPDATE planned_sessions SET date=?, week_no=?, sport=?, type=?, planned_km=?, planned_min=?, zone_alloc=?, description=?, structured=?, planned_tss=?, sort_order=? WHERE id=?`,
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
    ? db.prepare("SELECT * FROM activities WHERE date BETWEEN ? AND ? ORDER BY date").all(from, to)
    : db.prepare("SELECT * FROM activities ORDER BY date DESC LIMIT 200").all()) as any[];
  res.json(rows.map((r) => ({ ...r, zones: parseJson(r.zones, null), overrides: parseJson(r.overrides, []) })));
});

app.post("/api/activities", (req, res) => {
  const b = req.body || {};
  const r = db
    .prepare(
      `INSERT INTO activities(strava_id, date, sport, source, name, distance_m, moving_s, elapsed_s, avg_hr, max_hr, avg_power, elevation, avg_cadence, training_load, tss, zones, overrides, matched_session_id, notes)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
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
      JSON.stringify(b.zones || null),
      JSON.stringify(b.overrides || []),
      b.matched_session_id ?? null,
      b.notes || "",
    );
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put("/api/activities/:id", (req, res) => {
  const b = req.body || {};
  db.prepare(
    `UPDATE activities SET date=?, sport=?, source=?, name=?, distance_m=?, moving_s=?, elapsed_s=?, avg_hr=?, max_hr=?, avg_power=?, elevation=?, avg_cadence=?, training_load=?, tss=?, zones=?, overrides=?, matched_session_id=?, notes=? WHERE id=?`,
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
    JSON.stringify(b.zones || null),
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
  "sleep_efficiency", "sleep_consistency", "rem_h", "deep_h", "resp_rate", "spo2",
  "energy", "mood", "stress", "motivation", "legs", "soreness", "pain", "pain_location",
  "rpe", "alcohol", "caffeine", "hydration", "fueling", "travel", "sick", "notes",
];

app.get("/api/daily", (req, res) => {
  const { from, to } = req.query as Record<string, string>;
  const rows = from && to
    ? db.prepare("SELECT * FROM daily_log WHERE date BETWEEN ? AND ? ORDER BY date").all(from, to)
    : db.prepare("SELECT * FROM daily_log ORDER BY date DESC LIMIT 120").all();
  res.json(rows);
});

app.put("/api/daily/:date", (req, res) => {
  const b = req.body || {};
  const cols = DAILY_COLS.filter((c) => c in b);
  const placeholders = cols.map(() => "?").join(",");
  const updates = cols.map((c) => `${c}=excluded.${c}`).join(",");
  db.prepare(
    `INSERT INTO daily_log(date${cols.length ? "," + cols.join(",") : ""}) VALUES(?${cols.length ? "," + placeholders : ""})
     ON CONFLICT(date) DO UPDATE SET ${updates || "date=excluded.date"}`,
  ).run(req.params.date, ...cols.map((c) => b[c]));
  res.json({ ok: true });
});

// ---- week log ----------------------------------------------------------

app.get("/api/weeklog/:week", (req, res) => {
  const row = db.prepare("SELECT * FROM week_log WHERE week_no=?").get(req.params.week) as any;
  if (!row) return res.json(null);
  res.json({ ...row, checks: parseJson(row.checks, {}), whoop: parseJson(row.whoop, {}), refl_extra: parseJson(row.refl_extra, {}) });
});

app.put("/api/weeklog/:week", (req, res) => {
  const b = req.body || {};
  db.prepare(
    `INSERT INTO week_log(week_no, run_km, run_h, bike_km, bike_h, run_equiv, week_tss, ctl, atl, tsb, checks, whoop, refl_good, refl_hard, refl_change, refl_extra)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(week_no) DO UPDATE SET run_km=excluded.run_km, run_h=excluded.run_h, bike_km=excluded.bike_km,
       bike_h=excluded.bike_h, run_equiv=excluded.run_equiv, week_tss=excluded.week_tss, ctl=excluded.ctl,
       atl=excluded.atl, tsb=excluded.tsb, checks=excluded.checks, whoop=excluded.whoop,
       refl_good=excluded.refl_good, refl_hard=excluded.refl_hard, refl_change=excluded.refl_change, refl_extra=excluded.refl_extra`,
  ).run(
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
    .prepare("SELECT SUM(COALESCE(distance_m,0)) m FROM activities WHERE sport='Run' AND date BETWEEN ? AND ?")
    .get(start, end) as { m: number };
  return Math.round(((row?.m || 0) / 1000) * 10) / 10;
}

app.get("/api/analyze/week/:no", (req, res) => {
  const wk = db.prepare("SELECT * FROM season_weeks WHERE week_no=?").get(req.params.no) as any;
  const sessions = db.prepare("SELECT * FROM planned_sessions WHERE week_no=? ORDER BY date").all(req.params.no) as any[];
  const planned: PlannedSession[] = sessions.map((s) => ({ ...s, zone_alloc: parseJson(s.zone_alloc, null) }));
  const zs = effectiveZoneSet(wk?.start_date || todayIso());
  const totals = weekTotals(planned, zs.hr_zones, zs.pace_zones);

  // Verlauf: reale km der bis zu 3 Vorwochen
  const recentWeeksKm: number[] = [];
  if (wk) {
    const prev = db.prepare("SELECT * FROM season_weeks WHERE week_no<? ORDER BY week_no DESC LIMIT 3").all(req.params.no) as any[];
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
  const recent = db.prepare("SELECT recovery, legs, hrv FROM daily_log ORDER BY date DESC LIMIT 7").all() as any[];
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

  res.json({ totals, flags, zones: zs.hr_zones, week: wk, projectedCtlRamp, projectedTsb });
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
