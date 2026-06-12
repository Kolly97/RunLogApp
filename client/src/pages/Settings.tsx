import { useEffect, useState } from "react";
import { api, type ZoneSet, type SeasonWeek } from "../lib/api.ts";
import { todayIso, num, phaseLabel } from "../lib/util.ts";
import { useOptions } from "../lib/options.ts";

export default function Settings() {
  const [zonesets, setZonesets] = useState<ZoneSet[]>([]);
  const [season, setSeason] = useState<SeasonWeek[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [msg, setMsg] = useState("");

  async function reload() {
    setZonesets(await api.zonesets());
    setSeason(await api.season());
    setSettings(await api.settings());
  }
  useEffect(() => { reload(); }, []);

  async function seed() {
    const r = await api.seed();
    setMsg(`Importiert: ${r.weeks} Wochen, ${r.sessions} Einheiten.`);
    reload();
  }

  if (!settings) return <p className="muted">Lädt…</p>;

  return (
    <div>
      <h1>Einstellungen</h1>
      {msg && <div className="flag ok"><span className="dot" /><span>{msg}</span></div>}

      {/* Saison */}
      <div className="card">
        <div className="spread"><h2>Saisonplan</h2>
          <div className="row">
            <button onClick={seed}>Beispiel-Saison importieren (Word-Plan KW9–17)</button>
            {season.length > 0 && <button onClick={() => addWeekBefore(season)}>+ Woche davor</button>}
            <button className="primary" onClick={() => addWeek(season, setSeason)}>+ Woche</button>
          </div>
        </div>
        <p className="tiny muted" style={{ marginTop: 2 }}>
          „Beispiel-Saison importieren" lädt den fest eingebauten Seed aus <code>Trainingsplan_KW_10-17.docx</code> (Wochen 0–8) — kein allgemeiner Datei-Import.
        </p>
        {!season.length && <p className="muted">Noch keine Wochen. „Beispiel-Saison importieren" lädt die Saison (Wochen 0–8) aus dem alten Word-Trainingsplan.</p>}
        {season.length > 0 && (
          <table>
            <thead><tr><th>#</th><th>Phase</th><th>Start</th><th>Ende</th><th>Ziel km</th><th>Race</th><th></th></tr></thead>
            <tbody>
              {season.map((w) => <WeekRow key={w.week_no} w={w} onChange={reload} />)}
            </tbody>
          </table>
        )}
      </div>

      {/* Zonen-Sets */}
      <div className="card">
        <div className="spread"><h2>HF-Zonen & Schwellen</h2>
          <button onClick={() => newZoneset(zonesets, reload)}>+ Neues Set (Leistungsdiagnostik)</button>
        </div>
        <p className="tiny muted">Bei neuer Diagnostik ein neues Set mit Gültig-ab-Datum anlegen — ältere Wochen werden weiter mit dem damals gültigen Set ausgewertet.</p>
        {zonesets.map((z) => <ZoneSetEditor key={z.id} z={z} onChange={reload} canDelete={zonesets.length > 1} />)}
      </div>

      {/* Schwellen */}
      <div className="card">
        <h2>Analyse-Schwellen</h2>
        <div className="grid cols-4">
          <Num label="Volumen ± %" v={settings.thresholds.volume_pct} on={(x) => saveThr(settings, "volume_pct", x, setSettings)} />
          <Num label="CTL-Ramp max/Wo" v={settings.thresholds.ctl_ramp_max} on={(x) => saveThr(settings, "ctl_ramp_max", x, setSettings)} />
          <Num label="Hart-% max" v={settings.thresholds.hard_pct_max} on={(x) => saveThr(settings, "hard_pct_max", x, setSettings)} />
          <Num label="Z3-% max" v={settings.thresholds.z3_pct_max} on={(x) => saveThr(settings, "z3_pct_max", x, setSettings)} />
          <Num label="Longrun-% max" v={settings.thresholds.longrun_pct_max} on={(x) => saveThr(settings, "longrun_pct_max", x, setSettings)} />
          <Num label="TSB Race Week min" v={settings.thresholds.tsb_raceweek_min} on={(x) => saveThr(settings, "tsb_raceweek_min", x, setSettings)} />
          <Num label="Rad→Run Faktor" v={settings.run_equiv_bike_factor} step="0.05" on={(x) => save1("run_equiv_bike_factor", x, setSettings)} />
          <Num label="COROS→TSS Faktor" v={settings.coros_to_tss} step="0.05" on={(x) => save1("coros_to_tss", x, setSettings)} />
        </div>
      </div>

      {/* Strava (OAuth + Sync, ToDo #10/#11) */}
      <StravaCard settings={settings} season={season} />
    </div>
  );
}

// ---- Strava-Karte --------------------------------------------------------
function StravaCard({ settings, season }: { settings: any; season: SeasonWeek[] }) {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean; athlete: string | null } | null>(null);
  const [cid, setCid] = useState<string>(settings.strava_client_id || "");
  const [secret, setSecret] = useState<string>(settings.strava_client_secret || "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  const loadStatus = () => fetch("/api/strava/status").then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
  useEffect(() => { loadStatus(); }, []);

  async function saveCreds() {
    await api.saveSettings({ strava_client_id: cid.trim(), strava_client_secret: secret.trim() });
    loadStatus();
  }

  async function sync(after: string, label: string) {
    setBusy(true);
    setResult(`${label} läuft…`);
    try {
      const r = await fetch("/api/strava/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ after }) });
      const j = await r.json();
      setResult(r.ok
        ? `✓ ${label}: ${j.imported} importiert, ${j.skipped} schon vorhanden, ${j.enriched} mit Details angereichert.`
        : `Fehler: ${j.error || r.status}`);
    } catch (e) {
      setResult(`Fehler: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  const seasonStart = season[0]?.start_date || `${new Date().getFullYear()}-01-01`;
  const yearStart = `${new Date().getFullYear()}-01-01`;

  return (
    <div className="card">
      <div className="spread">
        <h2>Strava-Verbindung</h2>
        {status?.connected && <span className="pill phase">verbunden{status.athlete ? ` als ${status.athlete}` : ""}</span>}
      </div>
      <p className="tiny muted">
        Einmalig: auf <a href="https://www.strava.com/settings/api" target="_blank" rel="noreferrer">strava.com/settings/api</a> eine
        (kostenlose) API-App anlegen — „Autorisierungs-Callback-Domain": <code>localhost</code> — und Client-ID + Client-Secret hier eintragen.
        Der Import holt Aktivitäts-Daten (km, Zeit, Ø-HF, Watt) und liest die COROS-Training-Load aus der Beschreibung (TSS = TL × Faktor);
        Zeit-in-Zone bleibt manuell. Vorhandene/manuell bearbeitete Einheiten werden nie überschrieben.
      </p>
      <div className="row mb">
        <label className="field" style={{ margin: 0, width: 160 }}><span>Client-ID</span>
          <input value={cid} onChange={(e) => setCid(e.target.value)} onBlur={saveCreds} placeholder="z.B. 123456" /></label>
        <label className="field" style={{ margin: 0, flex: 1 }}><span>Client-Secret</span>
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} onBlur={saveCreds} placeholder="••••••••" /></label>
      </div>
      <div className="row">
        {!status?.connected && (
          <button className="primary" disabled={!status?.configured && !(cid && secret)}
            onClick={() => { saveCreds().then(() => { window.location.href = "/api/strava/login"; }); }}>
            Mit Strava verbinden
          </button>
        )}
        {status?.connected && (
          <>
            <button className="primary" disabled={busy} onClick={() => sync(seasonStart, "Sync seit Saisonstart")}>⟳ Sync seit Saisonstart</button>
            <button disabled={busy} onClick={() => sync(yearStart, "Jahres-Import")}>📅 Ganzes Jahr importieren</button>
            <button className="ghost" disabled={busy} onClick={() => { window.location.href = "/api/strava/login"; }}>neu verbinden</button>
          </>
        )}
      </div>
      {result && <p className="tiny" style={{ marginTop: 8 }}>{result}</p>}
      {status?.connected && (
        <p className="tiny muted" style={{ marginTop: 6 }}>
          Tipp: Jahres-Import ggf. 2–3× im Abstand von 15 min ausführen — die Detail-Anreicherung (COROS-TL/kcal)
          arbeitet wegen des Strava-Rate-Limits in Häppchen von 50 Aktivitäten.
        </p>
      )}
    </div>
  );
}

// ---- Saison-Zeile ------------------------------------------------------
function WeekRow({ w, onChange }: { w: SeasonWeek; onChange: () => void }) {
  const [e, setE] = useState(w);
  const { phases } = useOptions();
  const save = (patch: Partial<SeasonWeek>) => { const n = { ...e, ...patch }; setE(n); api.saveWeek(w.week_no, n).then(onChange); };
  // Alt-Phasenwerte bestehender Wochen bleiben wählbar, auch wenn nicht in der neuen Liste.
  const phaseVals = phases.map((p) => p.value);
  const phaseOpts = !e.phase || phaseVals.includes(e.phase) ? phaseVals : [e.phase, ...phaseVals];
  return (
    <tr>
      <td>{w.week_no}</td>
      <td><select value={e.phase} onChange={(x) => save({ phase: x.target.value })} style={{ minWidth: 130 }}>{phaseOpts.map((p) => <option key={p} value={p}>{phaseLabel(p)}</option>)}</select></td>
      <td><input type="date" value={e.start_date} onChange={(x) => save({ start_date: x.target.value })} /></td>
      <td><input type="date" value={e.end_date} onChange={(x) => save({ end_date: x.target.value })} /></td>
      <td style={{ width: 80 }}><input type="number" value={e.target_km ?? ""} onChange={(x) => save({ target_km: num(x.target.value) })} /></td>
      <td><input value={e.goal_race ?? ""} onChange={(x) => save({ goal_race: x.target.value })} /></td>
      <td><button className="sm ghost danger" onClick={() => api.deleteWeek(w.week_no).then(onChange)}>✕</button></td>
    </tr>
  );
}

// ---- Zonen-Set ---------------------------------------------------------

/** s/km → "m:ss" für Anzeige (#74). Leer bei 0/null. */
function paceMmSs(sec?: number | null): string {
  if (sec == null || !isFinite(sec) || sec <= 0) return "";
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
/** Tolerante Pace-Eingabe (#74): „4:45" → 285, „285" → 285 (Sekunden/km). Leer/ungültig → null. */
function parsePaceInput(t: string): number | null {
  const s = t.trim().replace(",", ".");
  if (!s) return null;
  if (s.includes(":")) {
    const [m, ss] = s.split(":");
    const mi = Number(m), se = Number(ss);
    if (!isFinite(mi) || !isFinite(se)) return null;
    return Math.round(mi * 60 + se);
  }
  const n = Number(s);
  return isFinite(n) && n > 0 ? Math.round(n) : null;
}

function ZoneSetEditor({ z, onChange, canDelete }: { z: ZoneSet; onChange: () => void; canDelete: boolean }) {
  const [e, setE] = useState(z);
  const saveZ = (next: ZoneSet) => { setE(next); api.updateZoneset(z.id, next).then(onChange); };
  const setHr = (i: number, field: "min" | "max", v: number | null) => {
    const hr = e.hr_zones.map((zn, j) => (j === i ? { ...zn, [field]: v ?? 0 } : zn));
    saveZ({ ...e, hr_zones: hr });
  };
  const setPace = (i: number, v: number | null) => { const arr = [...(e.pace_zones || [])]; arr[i] = v ?? 0; saveZ({ ...e, pace_zones: arr }); };
  // #73: Watt-Obergrenzen je Zone (ersetzt km/h-Eingabe; speed_zones bleibt im Objekt unangetastet)
  const setPower = (i: number, v: number | null) => { const arr = [...(e.power_zones || [])]; arr[i] = v ?? 0; saveZ({ ...e, power_zones: arr }); };
  return (
    <div className="card tight" style={{ background: "#fafbfd" }}>
      <div className="row mb">
        <label className="field" style={{ margin: 0 }}><span>Gültig ab</span><input type="date" value={e.valid_from} onChange={(x) => saveZ({ ...e, valid_from: x.target.value })} /></label>
        <label className="field" style={{ margin: 0, width: 80 }}><span>LTHR</span><input type="number" value={e.lthr} onChange={(x) => saveZ({ ...e, lthr: Number(x.target.value) })} /></label>
        <label className="field" style={{ margin: 0, width: 80 }}><span>FTP</span><input type="number" value={e.ftp} onChange={(x) => saveZ({ ...e, ftp: Number(x.target.value) })} /></label>
        <label className="field" style={{ margin: 0, width: 130 }}><span>Schwellen-Pace (mm:ss /km)</span>
          <input key={`tp-${e.threshold_pace}`} placeholder="4:45" defaultValue={paceMmSs(e.threshold_pace)}
            onBlur={(x) => { const v = parsePaceInput(x.target.value); if (v != null && v !== e.threshold_pace) saveZ({ ...e, threshold_pace: v }); }} />
        </label>
        <label className="field" style={{ margin: 0, flex: 1 }}><span>Quelle/Notiz</span><input value={e.note ?? ""} onChange={(x) => saveZ({ ...e, note: x.target.value })} /></label>
        {canDelete && <button className="sm ghost danger" onClick={() => api.deleteZoneset(z.id).then(onChange)}>Set löschen</button>}
      </div>
      <div className="tiny muted" style={{ marginBottom: 2 }}>HF-Zonen (min / max bpm)</div>
      <div className="row" style={{ gap: 6 }}>
        {e.hr_zones.map((zn, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center" }}>
            <div className="tiny" style={{ color: zn.color, fontWeight: 700 }}>Z{zn.z}</div>
            <div className="row" style={{ gap: 3 }}>
              <input type="number" style={{ padding: "4px", textAlign: "center" }} value={zn.min} onChange={(x) => setHr(i, "min", num(x.target.value))} />
              <input type="number" style={{ padding: "4px", textAlign: "center" }} value={zn.max} onChange={(x) => setHr(i, "max", num(x.target.value))} />
            </div>
          </div>
        ))}
      </div>
      <div className="tiny muted" style={{ margin: "6px 0 2px" }}>Pace-Zonen Lauf (mm:ss /km, Obergrenze je Zone — aus Diagnostik)</div>
      <div className="row" style={{ gap: 6 }}>
        {e.hr_zones.map((_zn, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center" }}>
            <input key={`pz${i}-${e.pace_zones?.[i] ?? ""}`} placeholder="4:45" style={{ padding: "4px", textAlign: "center" }}
              defaultValue={paceMmSs(e.pace_zones?.[i])}
              onBlur={(x) => { const v = parsePaceInput(x.target.value); if ((v ?? 0) !== (e.pace_zones?.[i] ?? 0)) setPace(i, v); }} />
          </div>
        ))}
      </div>
      <div className="tiny muted" style={{ margin: "6px 0 2px" }}>Power-Zonen Rad (Watt, Obergrenze je Zone — optional)</div>
      <div className="row" style={{ gap: 6 }}>
        {e.hr_zones.map((_zn, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center" }}>
            <input type="number" placeholder="Watt" style={{ padding: "4px", textAlign: "center" }} value={e.power_zones?.[i] ?? ""} onChange={(x) => setPower(i, num(x.target.value))} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- helpers -----------------------------------------------------------
function Num({ label, v, on, step }: { label: string; v: number; on: (x: number) => void; step?: string }) {
  return <label className="field"><span>{label}</span><input type="number" step={step || "1"} defaultValue={v} onBlur={(e) => on(Number(e.target.value))} /></label>;
}
function saveThr(settings: any, key: string, val: number, setSettings: (s: any) => void) {
  const thresholds = { ...settings.thresholds, [key]: val };
  setSettings({ ...settings, thresholds });
  api.saveSettings({ thresholds });
}
function save1(key: string, val: number, setSettings: (fn: any) => void) {
  setSettings((s: any) => ({ ...s, [key]: val }));
  api.saveSettings({ [key]: val });
}
async function addWeek(season: SeasonWeek[], _set: (s: SeasonWeek[]) => void) {
  const next = season.length ? Math.max(...season.map((w) => w.week_no)) + 1 : 1;
  const start = season.length ? addOneWeek(maxIso(season.map((w) => w.end_date))) : todayIso();
  await api.saveWeek(next, { phase: "Belastung", start_date: start, end_date: addDaysStr(start, 6), target_km: 70, goal_race: "", label: `Woche ${next}` });
  location.reload();
}
/** #71: Woche VOR der bisher frühesten anlegen — week_no darf negativ werden.
 *  Sortierung der Listen kommt vom Server (ORDER BY start_date), hier nichts umsortieren. */
async function addWeekBefore(season: SeasonWeek[]) {
  if (!season.length) return;
  const prev = Math.min(...season.map((w) => w.week_no)) - 1;
  const start = addDaysStr(minIso(season.map((w) => w.start_date)), -7);
  await api.saveWeek(prev, { phase: "Base", start_date: start, end_date: addDaysStr(start, 6), target_km: null, goal_race: "", label: `Woche ${prev}` });
  location.reload();
}
function minIso(dates: string[]) { return dates.reduce((a, b) => (b < a ? b : a)); }
function maxIso(dates: string[]) { return dates.reduce((a, b) => (b > a ? b : a)); }
function addOneWeek(iso: string) { return addDaysStr(iso, 1); }
function addDaysStr(iso: string, n: number) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
async function newZoneset(zonesets: ZoneSet[], reload: () => void) {
  const base = zonesets[0];
  await api.addZoneset({ valid_from: todayIso(), hr_zones: base?.hr_zones, pace_zones: base?.pace_zones, lthr: base?.lthr, ftp: base?.ftp, threshold_pace: base?.threshold_pace, source: "Diagnostik", note: "" });
  reload();
}
