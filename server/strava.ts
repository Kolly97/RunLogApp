// Strava-Anbindung (ToDo #10/#11): OAuth, Token-Refresh, Aktivitäten-Sync + Jahres-Import.
// TSS wird geräteneutral berechnet (kein COROS/Hersteller-Bezug):
//   1. Lauf → rTSS aus NGP (Stream) bzw. Ø-Pace
//   2. Rad → Power-TSS aus NP (Stream) bzw. Ø-Power, sonst Dauer-Schätzung nach Sport
//   3. Zeit-/km-in-Zone aus den Streams (budgetiert je Sync)
// Credentials (Client-ID/Secret der eigenen Strava-API-App) liegen in settings; Tokens ebenso.
import type { Request, Response } from "express";
import { db, getSetting, setSetting, activeProfile } from "./db.ts";
import { runTss, computeNgp, computeNp, streamZoneSplit, paceZoneSplit, powerTss, bikeTssEstimate, computeKmSplits, aerobicDecoupling, powerDurationCurve } from "./load.ts";
import { effectiveZoneSet } from "./zones.ts";

const API = "https://www.strava.com/api/v3";
const DETAIL_BUDGET_PER_SYNC = 50; // Detail-Abrufe (description/kcal) pro Sync-Lauf

interface Tokens { access: string; refresh: string; expires_at: number; athlete?: string }

function creds(): { id: string; secret: string } | null {
  const id = getSetting<string>("strava_client_id", "");
  const secret = getSetting<string>("strava_client_secret", "");
  return id && secret ? { id, secret } : null;
}

function tokens(): Tokens | null {
  return getSetting<Tokens | null>("strava_tokens", null);
}

/** Gültigen Access-Token liefern; refresht automatisch. */
async function accessToken(): Promise<string> {
  const c = creds();
  const t = tokens();
  if (!c || !t) throw new Error("Strava nicht verbunden");
  if (t.expires_at > Date.now() / 1000 + 60) return t.access;
  const r = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: c.id, client_secret: c.secret, grant_type: "refresh_token", refresh_token: t.refresh }),
  });
  if (!r.ok) throw new Error(`Token-Refresh fehlgeschlagen (${r.status})`);
  const j = (await r.json()) as any;
  const next: Tokens = { access: j.access_token, refresh: j.refresh_token, expires_at: j.expires_at, athlete: t.athlete };
  setSetting("strava_tokens", next);
  return next.access;
}

// Strava-Rate-Limit-Verbrauch der letzten Antwort (Read-spezifisch). Format der Header: „15min,Tag".
// Strava hat ZWEI Limits: 100/15 min und ~1000/Tag (Reset 00:00 UTC). Wird für die ehrliche
// Fehlermeldung UND die Tages-Budget-Bremse genutzt.
let lastRate: { read15: number; read15Max: number; readDay: number; readDayMax: number } | null = null;
const DAY_BUDGET_HEADROOM = 50; // Puffer unter dem Tageslimit, ab dem Sync/Enrich freiwillig stoppen.

/** Tagesverbrauch nahe am Limit? → Sync/Enrich sollten stoppen (verteilt den Backfill über Tage). */
function dayBudgetExhausted(): boolean {
  return !!lastRate && lastRate.readDayMax > 0 && lastRate.readDay >= lastRate.readDayMax - DAY_BUDGET_HEADROOM;
}

/** Ehrliche Rate-Limit-Meldung: unterscheidet 15-min- vs. Tages-Limit aus den letzten Headern. */
function rateLimitMessage(): string {
  if (lastRate) {
    const { read15, read15Max, readDay, readDayMax } = lastRate;
    if (readDayMax > 0 && readDay >= readDayMax)
      return `Strava-Tages-Limit erreicht (${readDay}/${readDayMax} Read-Requests) — frei ab 00:00 UTC.`;
    if (read15Max > 0 && read15 >= read15Max)
      return `Strava-15-Minuten-Limit erreicht (${read15}/${read15Max}) — in ~15 min erneut versuchen.`;
    return `Strava-Rate-Limit erreicht (15 min ${read15}/${read15Max}, Tag ${readDay}/${readDayMax}).`;
  }
  return "Strava-Rate-Limit erreicht — bitte später erneut versuchen.";
}

async function api(path: string): Promise<any> {
  const token = await accessToken();
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  // Rate-Limit-Header jeder Antwort mitführen (auch bei Erfolg) — Read-spezifisch bevorzugt.
  const usage = r.headers.get("x-readratelimit-usage") || r.headers.get("x-ratelimit-usage");
  const limit = r.headers.get("x-readratelimit-limit") || r.headers.get("x-ratelimit-limit");
  if (usage && limit) {
    const u = usage.split(",").map((n) => parseInt(n.trim(), 10) || 0);
    const l = limit.split(",").map((n) => parseInt(n.trim(), 10) || 0);
    lastRate = { read15: u[0] ?? 0, read15Max: l[0] ?? 0, readDay: u[1] ?? 0, readDayMax: l[1] ?? 0 };
  }
  if (r.status === 429) throw new Error(rateLimitMessage());
  if (!r.ok) throw new Error(`Strava ${path} → ${r.status}`);
  return r.json();
}

// ---- Mapping -------------------------------------------------------------

function mapSport(t: string): string {
  if (t === "Run" || t === "TrailRun" || t === "VirtualRun") return "Run";
  if (t === "Ride" || t === "GravelRide" || t === "MountainBikeRide" || t === "EBikeRide") return "BikeRoad";
  if (t === "VirtualRide") return "BikeIndoor";
  if (t === "WeightTraining" || t === "Workout" || t === "Crossfit") return "Strength";
  return "Other";
}

function tssFromAvgHr(movingS: number, avgHr: number, lthr: number): number {
  const iF = avgHr / lthr;
  return Math.round((movingS / 3600) * iF * iF * 100 * 10) / 10;
}

function fallbackTss(sport: string, movingS: number): number {
  // grobe Dauer-Schätzung ohne HF: easy-Intensität je Sport
  const ifBySport: Record<string, number> = { Run: 0.7, BikeRoad: 0.55, BikeIndoor: 0.6, Strength: 0.4, Other: 0.35 };
  const iF = ifBySport[sport] ?? 0.4;
  return Math.round((movingS / 3600) * iF * iF * 100 * 10) / 10;
}

type HrZoneSimple = { z: number; min: number; max: number };

/** Höchste HF-Zone, deren Untergrenze vom (Spitzen-)Puls erreicht wird — für den Zonen-Vorschlag je Intervall. */
function zoneFromHrSimple(hr: number | null, zones: HrZoneSimple[]): number | null {
  if (!(hr && hr > 0) || !zones.length) return null;
  let z: number | null = null;
  for (const zn of zones) if (hr >= zn.min) z = zn.z;
  return z;
}

/**
 * Work-Intervalle aus Strava-Laps (v0.12.0, ToDo 3): „Work" = Lap schneller als die Z3-Obergrenze (Lauf)
 * ODER Ø-HF ≥ Z4-Untergrenze. Warmup/Cooldown/Erholungs-Laps fallen so raus. Liefert Effort[]-JSON oder null.
 *
 * Label nach Einheitstyp (statt rein HF-basiert):
 *  · VO2-Einheit  → Intervalle bis 400 m = „VO2short", länger = „VO2long".
 *  · Schwelle     → bis 6 min Dauer = „LT2", länger = „LT1".
 *  · sonst        → HF-zonenbasiert (Z5↑ VO2long, Z4 LT2, darunter LT1) wie bisher.
 * Zusätzlich: Zonen-Vorschlag je Intervall aus der Max-HF (in welcher HF-Zone liegt der Spitzenpuls).
 */
function extractWorkLaps(
  laps: any[], sport: string, type: string | null,
  zs: { pace_zones?: number[]; hr_zones: HrZoneSimple[]; hr_zones_bike?: HrZoneSimple[] | null },
): string | null {
  if (!Array.isArray(laps) || laps.length < 2) return null;
  const isRun = sport === "Run";
  const activeHrZones: HrZoneSimple[] = (!isRun && zs.hr_zones_bike?.length) ? zs.hr_zones_bike : zs.hr_zones;
  const z3Pace = zs.pace_zones?.[2]; // Z3-Obergrenze (s/km, schnellste erlaubte Z3-Pace)
  const z4HrMin = activeHrZones.find((z) => z.z === 4)?.min;
  const z5HrMin = activeHrZones.find((z) => z.z === 5)?.min;
  const isVO2 = /vo2/i.test(type ?? "");
  const isThreshold = /threshold|schwelle/i.test(type ?? "");
  // Eine Runde gilt als „Work", wenn schnell genug (Pace ≤ Z3-Grenze) ODER HF ≥ Z4-Untergrenze.
  const isWorkLap = (lap: any): boolean => {
    const dist = lap.distance ?? 0;
    const sec = lap.moving_time ?? lap.elapsed_time ?? 0;
    const hr = lap.average_heartrate ?? null;
    const pace = isRun && dist > 0 && sec > 0 ? sec / (dist / 1000) : null;
    const fastEnough = pace != null && z3Pace ? pace <= z3Pace : false;
    const hardHr = hr != null && z4HrMin ? hr >= z4HrMin : false;
    return fastEnough || hardHr;
  };
  const work: any[] = [];
  laps.forEach((lap, idx) => {
    if (!isWorkLap(lap)) return;
    const dist = lap.distance ?? 0;
    const sec = lap.moving_time ?? lap.elapsed_time ?? 0;
    const hr = lap.average_heartrate ?? null;
    const maxHr = lap.max_heartrate != null ? Math.round(lap.max_heartrate) : null;
    const pace = isRun && dist > 0 && sec > 0 ? sec / (dist / 1000) : null;
    const fastEnough = pace != null && z3Pace ? pace <= z3Pace : false;
    let label: string | undefined;
    if (isVO2) {
      label = dist && dist <= 400 ? "VO2short" : "VO2long";
    } else if (isThreshold) {
      label = sec && sec <= 360 ? "LT2" : "LT1";
    } else if (hr != null) {
      if (z5HrMin && hr >= z5HrMin) label = "VO2long";
      else if (z4HrMin && hr >= z4HrMin) label = "LT2";
      else label = "LT1";
    } else if (fastEnough) {
      label = "LT1";
    }
    // v1.6.0: Pause = folgende Recovery-Runde (nächste Runde, die keine Work-Runde ist).
    const next = laps[idx + 1];
    let rest_s: number | null = null, rest_type: "jog" | "stand" | null = null, hr_recovery: number | null = null;
    if (next && !isWorkLap(next)) {
      rest_s = Math.round(next.moving_time ?? next.elapsed_time ?? 0) || null;
      hr_recovery = next.average_heartrate != null ? Math.round(next.average_heartrate) : null;
      rest_type = (next.distance ?? 0) > 30 ? "jog" : "stand"; // bewegte Pause vs. Stehpause
    }
    work.push({
      reps: 1,
      dist_m: dist ? Math.round(dist) : null,
      sec: sec || null,
      pace_s: pace != null ? Math.round(pace) : null,
      avg_hr: hr != null ? Math.round(hr) : null,
      max_hr: maxHr,
      zone: zoneFromHrSimple(maxHr, activeHrZones),
      label,
      rest_s, rest_type, hr_recovery,
    });
  });
  return work.length ? JSON.stringify(work) : null;
}

// HF-/Power-Zonen + FTP aus Strava (v0.14.0, ToDo 10). Braucht Scope profile:read_all.
// Wirft die `api()`-Exception (inkl. 401/403) nach oben — der Aufrufer mappt sie auf eine Meldung.
export async function fetchAthleteZonesAndFtp(): Promise<{ hr: { min: number; max: number }[]; power: { min: number; max: number }[]; ftp: number | null }> {
  const z = (await api("/athlete/zones")) as any;
  const me = (await api("/athlete")) as any;
  const hr = Array.isArray(z?.heart_rate?.zones) ? z.heart_rate.zones.map((x: any) => ({ min: Number(x?.min) || 0, max: Number(x?.max) || 0 })) : [];
  const power = Array.isArray(z?.power?.zones) ? z.power.zones.map((x: any) => ({ min: Number(x?.min) || 0, max: Number(x?.max) || 0 })) : [];
  return { hr, power, ftp: me?.ftp != null ? Number(me.ftp) : null };
}

// ---- Routen-Handler --------------------------------------------------------

export function stravaStatus(_req: Request, res: Response): void {
  const t = tokens();
  res.json({ configured: !!creds(), connected: !!t, athlete: t?.athlete ?? null });
}

export function stravaLogin(req: Request, res: Response): void {
  const c = creds();
  if (!c) return void res.status(400).send("Erst Client-ID/Secret in den Einstellungen speichern.");
  // Callback über denselben Host, von dem der Klick kam (Dev 5173 via Vite-Proxy, Prod 3000).
  const redirect = `${req.protocol}://${req.get("host")}/api/strava/callback`;
  const url =
    `https://www.strava.com/oauth/authorize?client_id=${encodeURIComponent(c.id)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=activity:read_all,profile:read_all&approval_prompt=auto`;
  res.redirect(url);
}

export async function stravaCallback(req: Request, res: Response): Promise<void> {
  try {
    const c = creds();
    const code = String(req.query.code || "");
    if (!c || !code) return void res.status(400).send("Kein Code / keine Credentials.");
    const r = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: c.id, client_secret: c.secret, code, grant_type: "authorization_code" }),
    });
    if (!r.ok) return void res.status(500).send(`Token-Tausch fehlgeschlagen (${r.status})`);
    const j = (await r.json()) as any;
    const t: Tokens = {
      access: j.access_token, refresh: j.refresh_token, expires_at: j.expires_at,
      athlete: [j.athlete?.firstname, j.athlete?.lastname].filter(Boolean).join(" ") || undefined,
    };
    setSetting("strava_tokens", t);
    res.redirect("/settings");
  } catch (e) {
    res.status(500).send(String(e));
  }
}

/** Aktivitäten ab `after` (YYYY-MM-DD) importieren. Vorhandene strava_ids werden übersprungen
 *  (manuelle Änderungen bleiben erhalten). Schreibt ins aktive Profil. */
export async function stravaSync(req: Request, res: Response): Promise<void> {
  try {
    const after = String(req.body?.after || new Date().getFullYear() + "-01-01");
    const afterEpoch = Math.floor(new Date(after + "T00:00:00Z").getTime() / 1000);
    // Defensive: Strava liefert für ein ungültiges oder zukünftiges `after` einen 400. Lieber eine klare,
    // umsetzbare Meldung als die kryptische Roh-Fehlermeldung — und es gibt vor „jetzt" ohnehin nichts zu holen.
    if (!Number.isFinite(afterEpoch)) {
      return void res.status(400).json({ error: `Ungültiges „Daten ab"-Datum: ${after}` });
    }
    if (afterEpoch > Math.floor(Date.now() / 1000)) {
      return void res.status(400).json({ error: `„Daten ab" (${after}) liegt in der Zukunft — bitte ein früheres Datum wählen.` });
    }
    const profile = activeProfile();

    const exists = db.prepare("SELECT id FROM activities WHERE strava_id=?");
    const matchPlan = db.prepare(
      "SELECT id FROM planned_sessions WHERE date=? AND sport=? AND profile_id=? AND type != 'Rest' ORDER BY sort_order LIMIT 1",
    );
    const insert = db.prepare(
      `INSERT INTO activities(profile_id, strava_id, date, sport, source, name, distance_m, moving_s, elapsed_s,
        avg_hr, max_hr, avg_power, elevation, avg_cadence, training_load, tss, kcal, zones, zone_min, zone_km,
        efforts, overrides, matched_session_id, notes)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,'[]',?,?)`,
    );

    let imported = 0, skipped = 0, page = 1;
    const newIds: number[] = [];
    // paginiert listen (100/Seite, Sicherheitslimit 12 Seiten = 1200 Aktivitäten)
    for (; page <= 12; page++) {
      if (dayBudgetExhausted()) break; // Tages-Budget fast aufgebraucht → später weiter
      const list = (await api(`/athlete/activities?after=${afterEpoch}&per_page=100&page=${page}`)) as any[];
      if (!Array.isArray(list) || !list.length) break;
      for (const a of list) {
        const sid = String(a.id);
        if (exists.get(sid)) { skipped++; continue; }
        const date = String(a.start_date_local || a.start_date || "").slice(0, 10);
        if (!date) continue;
        const sport = mapSport(String(a.sport_type || a.type || ""));
        const movingS = a.moving_time ?? null;
        const zsA = effectiveZoneSet(date);
        // Lauf-TSS primär rTSS (Ø-Pace; NGP folgt bei der Stream-Anreicherung). Sonst hrTSS/Fallback.
        let tss: number | null = null;
        if (movingS) {
          if (sport === "Run" && a.distance) tss = runTss(a.distance, movingS, zsA.threshold_pace);
          else if (sport.startsWith("Bike") || sport === "General")
            tss = a.average_watts && zsA.ftp ? powerTss(movingS, a.average_watts, zsA.ftp) : bikeTssEstimate(movingS / 60, "Easy");
          else if (a.average_heartrate) tss = tssFromAvgHr(movingS, a.average_heartrate, zsA.lthr);
          else tss = fallbackTss(sport, movingS);
        }
        const matched = (matchPlan.get(date, sport, profile) as any)?.id ?? null;
        const r = insert.run(
          profile, sid, date, sport, "strava", a.name || "", a.distance ?? null, movingS, a.elapsed_time ?? null,
          a.average_heartrate ?? null, a.max_heartrate ?? null, a.average_watts ?? null,
          a.total_elevation_gain ?? null, a.average_cadence ?? null, null, tss,
          a.kilojoules ?? null, // Rad: kJ ≈ kcal-Näherung; Läufe liefern hier nichts
          matched, "",
        );
        newIds.push(Number(r.lastInsertRowid));
        imported++;
      }
      if (list.length < 100) break;
    }

    const enriched = await enrichBudgeted(profile, after);

    res.json({ imported, skipped, enriched, pages: page });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}

/** Strava-Detail `best_efforts` → { [distance_m]: moving_time_s } (defensiv; kleinste Zeit je Distanz). */
function parseBestEfforts(arr: any): Record<number, number> {
  const out: Record<number, number> = {};
  if (!Array.isArray(arr)) return out;
  for (const e of arr) {
    const d = Math.round(Number(e?.distance));
    const t = Number(e?.moving_time ?? e?.elapsed_time);
    if (d > 0 && t > 0 && (out[d] == null || t < out[d])) out[d] = t;
  }
  return out;
}

/**
 * Anreicherung (budgetiert, neueste zuerst) für bestehende Strava-Aktivitäten — OHNE neue zu importieren:
 *  1) Detail (Beschreibung → Notiz, kcal), 2) Streams (HF/Pace/Höhe → min/Zone, km/Zone, NGP, rTSS),
 *  3) Laps → automatische Work-Intervalle. Pro Aktivität bis zu 3 ratenlimitierte Abrufe (Request-Budget).
 */
async function enrichBudgeted(profile: number, after: string): Promise<number> {
  const candidates = db
    .prepare(
      `SELECT id, strava_id, sport, type, date, distance_m, moving_s, avg_power, desc_fetched, streams_fetched, laps_fetched, efforts, efforts_locked, best_efforts, decoupling, power_curve FROM activities
       WHERE source='strava' AND profile_id=? AND date >= ?
         AND (desc_fetched=0
              OR (sport='Run' AND best_efforts IS NULL)
              OR ((sport='Run' OR sport LIKE 'Bike%') AND streams_fetched=0)
              OR ((sport='Run' OR sport LIKE 'Bike%') AND laps_fetched=0 AND COALESCE(efforts_locked,0)=0
                  AND (efforts IS NULL OR efforts='' OR efforts='null' OR efforts='[]'))
              OR (sport='Run' AND streams_fetched=1 AND decoupling IS NULL AND avg_hr IS NOT NULL AND moving_s >= 1200
                  AND COALESCE(type,'') NOT IN ('VO2','VO2short','VO2long','Hill','Race','Threshold','LT2'))
              OR (sport='Run' AND streams_fetched=1 AND power_curve IS NULL AND moving_s >= 600))
       ORDER BY date DESC LIMIT ?`,
    )
    .all(profile, after, DETAIL_BUDGET_PER_SYNC) as
    { id: number; strava_id: string; sport: string; type: string | null; date: string; distance_m: number | null; moving_s: number | null; avg_power: number | null; desc_fetched: number; streams_fetched: number; laps_fetched: number; efforts: string | null; efforts_locked: number | null; best_efforts: string | null; decoupling: number | null; power_curve: string | null }[];

  const updDesc = db.prepare(
    "UPDATE activities SET kcal=COALESCE(?, kcal), " +
      "notes=CASE WHEN (notes IS NULL OR notes='') THEN ? ELSE notes END, desc_fetched=1 WHERE id=?",
  );
  const updStream = db.prepare(
    "UPDATE activities SET " +
      "zone_min=CASE WHEN (zone_min IS NULL OR zone_min='' OR zone_min='null') THEN ? ELSE zone_min END, " +
      "zone_km=CASE WHEN (zone_km IS NULL OR zone_km='' OR zone_km='null') THEN ? ELSE zone_km END, " +
      "pace_zone_min=CASE WHEN (pace_zone_min IS NULL OR pace_zone_min='' OR pace_zone_min='null') THEN ? ELSE pace_zone_min END, " +
      "ngp=?, np=?, tss=COALESCE(?, tss), decoupling=COALESCE(?, decoupling), run_np=COALESCE(?, run_np), power_curve=COALESCE(?, power_curve), streams_fetched=1 WHERE id=?",
  );
  const updLaps = db.prepare(
    "UPDATE activities SET efforts=CASE WHEN (efforts IS NULL OR efforts='' OR efforts='null' OR efforts='[]') THEN ? ELSE efforts END, laps_fetched=1 WHERE id=? AND COALESCE(efforts_locked,0)=0",
  );
  const updBests = db.prepare("UPDATE activities SET best_efforts=? WHERE id=?");

  let enriched = 0, reqs = 0;
  const MAX_REQ = 90; // 15-min-Schutz (≈100/15min)
  for (const c of candidates) {
    if (dayBudgetExhausted()) break; // Tages-Budget fast aufgebraucht → Rest beim nächsten Sync/Tag
    try {
      const isRun = c.sport === "Run", isBike = c.sport.startsWith("Bike");
      // v1.7.0: aerobe Entkopplung nur für gleichmäßige Läufe (Easy/Long/Steady) — bei Intervallen sinnlos.
      const isSteadyRun = isRun && !/vo2|hill|race|threshold|lt2/i.test(c.type || "");
      // Detail-Abruf für Beschreibung/kcal (einmalig) UND für Lauf-Bestzeiten (Strava best_efforts, ggf.
      // nachträglich für Altbestand). Ein Abruf deckt beides ab.
      const needBests = isRun && !c.best_efforts;
      if (!c.desc_fetched || needBests) {
        if (reqs >= MAX_REQ) break;
        const d = (await api(`/activities/${c.strava_id}`)) as any; reqs++;
        if (!c.desc_fetched) updDesc.run(d.calories ?? null, (d.description || "").slice(0, 500), c.id);
        if (isRun) updBests.run(JSON.stringify(parseBestEfforts(d.best_efforts)), c.id);
        enriched++;
      }
      // Streams holen, wenn noch nicht geholt ODER Lauf ohne Entkopplung/Power-Kurve nachfüllen (Backfill).
      const needDecoup = isSteadyRun && c.streams_fetched === 1 && c.decoupling == null && (c.moving_s ?? 0) >= 1200;
      const needPower = isRun && c.streams_fetched === 1 && c.power_curve == null && (c.moving_s ?? 0) >= 600; // v1.7.0 Lauf-Power
      if ((!c.streams_fetched || needDecoup || needPower) && (isRun || isBike)) {
        if (reqs >= MAX_REQ) break;
        const keys = isRun ? "time,heartrate,velocity_smooth,grade_smooth,distance,watts" : "time,heartrate,watts";
        const s = (await api(`/activities/${c.strava_id}/streams?keys=${keys}&key_by_type=true`)) as any; reqs++;
        const zsA = effectiveZoneSet(c.date);
        const time: number[] = s?.time?.data ?? [];
        const hr: number[] = s?.heartrate?.data ?? [];
        const dist: number[] = s?.distance?.data ?? [];
        let zoneMinJson: string | null = null, zoneKmJson: string | null = null;
        if (hr.length && time.length) {
          const sp = streamZoneSplit(hr, time, dist, zsA.hr_zones);
          const zMin: Record<number, number> = {}, zKm: Record<number, number> = {};
          for (const z of zsA.hr_zones) {
            if (sp.sec[z.z] > 0) zMin[z.z] = Math.round((sp.sec[z.z] / 60) * 10) / 10;
            if (sp.meters[z.z] > 0) zKm[z.z] = Math.round((sp.meters[z.z] / 1000) * 100) / 100;
          }
          zoneMinJson = Object.keys(zMin).length ? JSON.stringify(zMin) : null;
          zoneKmJson = Object.keys(zKm).length ? JSON.stringify(zKm) : null;
        }
        let ngp: number | null = null, np: number | null = null, tss: number | null = null;
        let paceZoneMinJson: string | null = null, decoupling: number | null = null;
        let runNp: number | null = null, powerCurveJson: string | null = null;
        if (isRun) {
          const vel: number[] = s?.velocity_smooth?.data ?? [];
          const grade: number[] = s?.grade_smooth?.data ?? [];
          ngp = vel.length && grade.length && time.length ? computeNgp(vel, grade, time) : null;
          tss = runTss(c.distance_m ?? 0, c.moving_s ?? 0, zsA.threshold_pace, ngp);
          // Aerobe Entkopplung (Pa:HR) aus Velocity+HF-Stream (v1.2.0).
          decoupling = isSteadyRun && vel.length && hr.length && time.length ? aerobicDecoupling(vel, hr, time, grade) : null;
          // Zeit je Pace-Zone (für Plan-Erfüllung, v0.14.0) — aus demselben Velocity-Stream.
          if (vel.length && time.length) {
            const pzSec = paceZoneSplit(vel, time, zsA.pace_zones);
            const pzMin: Record<number, number> = {};
            for (const [z, sec] of Object.entries(pzSec)) if (sec > 0) pzMin[Number(z)] = Math.round((sec / 60) * 10) / 10;
            paceZoneMinJson = Object.keys(pzMin).length ? JSON.stringify(pzMin) : null;
          }
          // v1.7.0: Lauf-Power (Coros-Watt). NP + Power-Duration-Kurve; '{}' wenn keine Watt → kein Re-Fetch.
          const watts: number[] = s?.watts?.data ?? [];
          if (watts.length && time.length) {
            runNp = computeNp(watts, time);
            const curve = powerDurationCurve(watts, time);
            powerCurveJson = JSON.stringify(curve);
          } else {
            powerCurveJson = "{}";
          }
        } else {
          const watts: number[] = s?.watts?.data ?? [];
          np = watts.length && time.length ? computeNp(watts, time) : null;
          const power = np ?? c.avg_power ?? null;
          tss = power && zsA.ftp ? powerTss(c.moving_s ?? 0, power, zsA.ftp) : bikeTssEstimate((c.moving_s ?? 0) / 60, "Easy");
        }
        updStream.run(zoneMinJson, zoneKmJson, paceZoneMinJson, ngp, np, tss || null, decoupling, runNp, powerCurveJson, c.id);
        // Race aus Tracking (v0.14.0): km-Splits aus den Streams berechnen und am verknüpften Race
        // ablegen — nur in leere Splits (manuelle Edits bleiben erhalten).
        if (c.type === "Race" && dist.length && time.length) {
          const splits = computeKmSplits(dist, time, hr);
          if (splits.length) {
            db.prepare(
              "UPDATE races SET splits=? WHERE activity_id=? AND profile_id=? AND (splits IS NULL OR splits='' OR splits='null' OR splits='[]')",
            ).run(JSON.stringify(splits), c.id, profile);
          }
        }
        enriched++;
      }
      // Laps → automatische Work-Intervalle (v0.12.0, ToDo 3), nur wenn noch keine Efforts vorhanden.
      const noEfforts = !c.efforts || c.efforts === "" || c.efforts === "null" || c.efforts === "[]";
      if (!c.laps_fetched && !c.efforts_locked && (isRun || isBike) && noEfforts) {
        if (reqs >= MAX_REQ) break;
        const laps = (await api(`/activities/${c.strava_id}/laps`)) as any[]; reqs++;
        const zsL = effectiveZoneSet(c.date);
        updLaps.run(extractWorkLaps(laps, c.sport, c.type, zsL), c.id);
        enriched++;
      }
    } catch (e) {
      // Rate-Limit (15-min/Tag) → stoppen, Rest später. Andere Fehler (z.B. gelöschte/private Aktivität,
      // 404/500) → nur diese Aktivität überspringen, damit der Backfill nicht an einer Einheit hängenbleibt.
      if (dayBudgetExhausted() || /limit|token|verbunden|401|403/i.test(String(e))) break; // systemisch → stoppen
      continue; // per-Aktivität (404/500/privat) → überspringen
    }
  }
  return enriched;
}

/** Endpoint: nur Details/Splits (Laps) + Streams für bestehende Aktivitäten nachziehen, ohne neue zu importieren. */
export async function stravaEnrich(req: Request, res: Response): Promise<void> {
  try {
    // v1.6.3: Default = Import-Startdatum (strava_sync_from), NICHT das aktuelle Jahr — sonst bleibt der
    // gesamte Altbestand (vor der laufenden Saison) un-angereichert.
    const after = String(req.body?.after || getSetting<string>("strava_sync_from", "") || "2000-01-01");
    const enriched = await enrichBudgeted(activeProfile(), after);
    res.json({ enriched });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}

/** Endpoint: Intervalle EINER Aktivität sofort aus den Strava-Laps neu erzeugen (hebt die manuelle Sperre auf).
 *  Holt die Laps direkt (1 Request) und labelt typabhängig + schlägt Zonen aus der Max-HF vor. */
export async function stravaRelinkEfforts(req: Request, res: Response): Promise<void> {
  try {
    const profile = activeProfile();
    const a = db.prepare(
      "SELECT id, strava_id, sport, type, date FROM activities WHERE id=? AND profile_id=? AND source='strava'",
    ).get(Number(req.params.id), profile) as
      { id: number; strava_id: string; sport: string; type: string | null; date: string } | undefined;
    if (!a || !a.strava_id) {
      // Keine Strava-Aktivität → nur Sperre/Flags zurücksetzen (alte Semantik), Re-Import beim nächsten Sync.
      db.prepare("UPDATE activities SET efforts=NULL, efforts_locked=0, laps_fetched=0 WHERE id=? AND profile_id=?")
        .run(Number(req.params.id), profile);
      return void res.json({ ok: true, efforts: 0 });
    }
    const laps = (await api(`/activities/${a.strava_id}/laps`)) as any[];
    const efforts = extractWorkLaps(laps, a.sport, a.type, effectiveZoneSet(a.date));
    db.prepare("UPDATE activities SET efforts=?, efforts_locked=0, laps_fetched=1 WHERE id=? AND profile_id=?")
      .run(efforts, a.id, profile);
    const n = efforts ? (JSON.parse(efforts) as any[]).length : 0;
    res.json({ ok: true, efforts: n });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
