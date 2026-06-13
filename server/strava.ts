// Strava-Anbindung (ToDo #10/#11): OAuth, Token-Refresh, Aktivitäten-Sync + Jahres-Import.
// Bewusst OHNE HR-Stream-Massenabfragen (Rate-Limit 200 Req/15 min) — Zeit-in-Zone bleibt
// manuell (zone_km) bzw. später nachrüstbar. TSS-Quelle je Aktivität:
//   1. COROS Training Load aus der Beschreibung (Detail-Abruf, Budget je Sync) × coros_to_tss
//   2. hrTSS-Näherung aus Ø-HF: (h × (HF/LTHR)² × 100)
//   3. Dauer-Schätzung nach Sport (ohne HF, z.B. Commute)
// Credentials (Client-ID/Secret der eigenen Strava-API-App) liegen in settings; Tokens ebenso.
import type { Request, Response } from "express";
import { db, getSetting, setSetting, activeProfile } from "./db.ts";
import { parseCorosLoad, runTss, computeNgp, computeNp, streamZoneSplit, powerTss, bikeTssEstimate } from "./load.ts";
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

async function api(path: string): Promise<any> {
  const token = await accessToken();
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 429) throw new Error("Strava-Rate-Limit erreicht — in 15 min erneut versuchen");
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
    `&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=activity:read_all&approval_prompt=auto`;
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

    // Anreicherung (budgetiert, neueste zuerst):
    //  1) Detail (Beschreibung → COROS-TL, kcal) — Marker desc_fetched=1 (ToDo Z.45).
    //  2) Lauf-Streams (HF/Pace/Höhe) → min/Zone, km/Zone, NGP, rTSS — Marker streams_fetched=1 (ToDo v0.9.0).
    // Pro Aktivität bis zu 2 ratenlimitierte Abrufe → Request-Budget statt fixem Aktivitäts-Limit.
    const candidates = db
      .prepare(
        `SELECT id, strava_id, sport, date, distance_m, moving_s, avg_power, desc_fetched, streams_fetched FROM activities
         WHERE source='strava' AND profile_id=? AND date >= ?
           AND (desc_fetched=0 OR ((sport='Run' OR sport LIKE 'Bike%') AND streams_fetched=0))
         ORDER BY date DESC LIMIT ?`,
      )
      .all(profile, after, DETAIL_BUDGET_PER_SYNC) as
      { id: number; strava_id: string; sport: string; date: string; distance_m: number | null; moving_s: number | null; avg_power: number | null; desc_fetched: number; streams_fetched: number }[];

    // Detail: COROS-TL (nur informativ) + kcal; Beschreibung nur in leere Notizen. tss wird NICHT mehr aus
    // COROS gesetzt — Lauf nutzt rTSS, Rad Power-TSS/Schätzung (ToDo v0.9.0/v0.10.0, geräteunabhängig).
    const updDesc = db.prepare(
      "UPDATE activities SET training_load=?, kcal=COALESCE(?, kcal), " +
        "notes=CASE WHEN (notes IS NULL OR notes='') THEN ? ELSE notes END, desc_fetched=1 WHERE id=?",
    );
    // Streams: zone_min/zone_km nur in leere Felder (manuelle Werte bleiben); ngp/np + TSS setzen.
    const updStream = db.prepare(
      "UPDATE activities SET " +
        "zone_min=CASE WHEN (zone_min IS NULL OR zone_min='' OR zone_min='null') THEN ? ELSE zone_min END, " +
        "zone_km=CASE WHEN (zone_km IS NULL OR zone_km='' OR zone_km='null') THEN ? ELSE zone_km END, " +
        "ngp=?, np=?, tss=COALESCE(?, tss), streams_fetched=1 WHERE id=?",
    );

    let enriched = 0, reqs = 0;
    const MAX_REQ = 90; // Strava-Rate-Limit-Schutz (≈100/15min)
    for (const c of candidates) {
      try {
        if (!c.desc_fetched) {
          if (reqs >= MAX_REQ) break;
          const d = (await api(`/activities/${c.strava_id}`)) as any; reqs++;
          const tl = parseCorosLoad(d.description);
          updDesc.run(tl, d.calories ?? null, (d.description || "").slice(0, 500), c.id);
          enriched++;
        }
        const isRun = c.sport === "Run", isBike = c.sport.startsWith("Bike");
        if (!c.streams_fetched && (isRun || isBike)) {
          if (reqs >= MAX_REQ) break;
          const keys = isRun ? "time,heartrate,velocity_smooth,grade_smooth,distance" : "time,heartrate,watts";
          const s = (await api(`/activities/${c.strava_id}/streams?keys=${keys}&key_by_type=true`)) as any; reqs++;
          const zsA = effectiveZoneSet(c.date);
          const time: number[] = s?.time?.data ?? [];
          const hr: number[] = s?.heartrate?.data ?? [];
          const dist: number[] = s?.distance?.data ?? [];
          // min/Zone (+ km/Zone bei Lauf) aus dem HF-Stream gegen die eigenen Zonen.
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
          if (isRun) {
            const vel: number[] = s?.velocity_smooth?.data ?? [];
            const grade: number[] = s?.grade_smooth?.data ?? [];
            ngp = vel.length && grade.length && time.length ? computeNgp(vel, grade, time) : null;
            tss = runTss(c.distance_m ?? 0, c.moving_s ?? 0, zsA.threshold_pace, ngp);
          } else {
            const watts: number[] = s?.watts?.data ?? [];
            np = watts.length && time.length ? computeNp(watts, time) : null;
            const power = np ?? c.avg_power ?? null;
            tss = power && zsA.ftp ? powerTss(c.moving_s ?? 0, power, zsA.ftp) : bikeTssEstimate((c.moving_s ?? 0) / 60, "Easy");
          }
          updStream.run(zoneMinJson, zoneKmJson, ngp, np, tss || null, c.id);
          enriched++;
        }
      } catch {
        break; // Rate-Limit o.ä. → Rest beim nächsten Sync
      }
    }

    res.json({ imported, skipped, enriched, pages: page });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
