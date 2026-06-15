import { useEffect, useState } from "react";
import { api, type SeasonWeek } from "../lib/api.ts";

export default function Settings() {
  const [season, setSeason] = useState<SeasonWeek[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [msg] = useState("");

  async function reload() {
    setSeason(await api.season());
    setSettings(await api.settings());
  }
  useEffect(() => { reload(); }, []);

  if (!settings) return <p className="muted">Lädt…</p>;

  return (
    <div>
      <h1>Einstellungen</h1>
      {msg && <div className="flag ok"><span className="dot" /><span>{msg}</span></div>}
      <p className="tiny muted" style={{ marginTop: -4 }}>Profile und HF-Zonen/Schwellen findest du jetzt unter <a href="/profile">Profil</a>.</p>

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
          <Num label="Race 7d-Last max % (Taper)" v={settings.thresholds.raceweek_tss_max_pct ?? 60} on={(x) => saveThr(settings, "raceweek_tss_max_pct", x, setSettings)} />
          <Num label="Rad→Run Faktor" v={settings.run_equiv_bike_factor} step="0.05" on={(x) => save1("run_equiv_bike_factor", x, setSettings)} />
        </div>
        <h3 style={{ marginTop: 12 }}>Intensitäts-Einstufung (Donut & Wochen-Bewertung)</h3>
        <p className="tiny muted" style={{ marginTop: 0 }}>Vergleich mit dem Ø-TSS der letzten Wochen: ≤ Easy-% = easy, bis Hart-% = moderat, darüber = hart.</p>
        <div className="grid cols-4">
          <Num label="Easy ≤ % vom Ø-TSS" v={settings.thresholds.easy_pct ?? 80} on={(x) => saveThr(settings, "easy_pct", x, setSettings)} />
          <Num label="Hart ≥ % vom Ø-TSS" v={settings.thresholds.hard_pct ?? 105} on={(x) => saveThr(settings, "hard_pct", x, setSettings)} />
          <Num label="Referenz-Fenster (Wochen)" v={settings.thresholds.intensity_window_weeks ?? 4} on={(x) => saveThr(settings, "intensity_window_weeks", x, setSettings)} />
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
  const [syncFrom, setSyncFrom] = useState<string>(settings.strava_sync_from || ""); // Extraktions-Startdatum (v0.14.0)
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  const saveSyncFrom = (v: string) => { setSyncFrom(v); api.saveSettings({ strava_sync_from: v }); };

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

  async function enrich() {
    setBusy(true);
    setResult("Details/Splits werden nachgezogen…");
    try {
      const r = await fetch("/api/strava/enrich", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ after: seasonStart }) });
      const j = await r.json();
      setResult(r.ok ? `✓ ${j.enriched} Aktivitäten angereichert (Details, Streams, Intervalle aus Laps).` : `Fehler: ${j.error || r.status}`);
    } catch (e) {
      setResult(`Fehler: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function recompute() {
    setBusy(true);
    setResult("rTSS-Neuberechnung läuft…");
    try {
      const r = await fetch("/api/recompute-tss", { method: "POST" });
      const j = await r.json();
      setResult(r.ok
        ? `✓ TSS neu berechnet: ${j.activities} Aktivitäten (Lauf + Rad), ${j.sessions} geplante Einheiten. Backup angelegt.`
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
        Der Import holt Aktivitäts-Daten (km, Zeit, Ø-HF, Watt) und Streams (NGP/NP, Zeit-in-Zone) — die Last (TSS)
        rechnet die App geräteneutral aus NGP/NP bzw. einer Schätzung (optional manuell überschreibbar).
        Vorhandene/manuell bearbeitete Einheiten werden nie überschrieben.
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
            <label className="field" style={{ margin: 0, width: 150 }}><span>Daten ab</span>
              <input type="date" value={syncFrom || seasonStart} onChange={(e) => saveSyncFrom(e.target.value)} title="Startdatum, ab dem Strava-Aktivitäten importiert werden" /></label>
            <button className="primary" disabled={busy} onClick={() => sync(syncFrom || seasonStart, `Sync ab ${syncFrom || seasonStart}`)}>⟳ Sync ab Datum</button>
            <button disabled={busy} onClick={() => sync(yearStart, "Jahres-Import")}>📅 Ganzes Jahr importieren</button>
            <button className="ghost" disabled={busy} onClick={() => { window.location.href = "/api/strava/login"; }}>neu verbinden</button>
          </>
        )}
      </div>
      <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
        {status?.connected && (
          <button className="ghost" disabled={busy} onClick={enrich}
            title="Nur Details, Streams (Zonen/NGP) und Intervalle (aus den Laps) für bestehende Aktivitäten nachziehen — ohne neue zu importieren. Budgetiert, ggf. mehrfach.">
            📥 Details/Splits nachziehen
          </button>
        )}
        <button className="ghost" disabled={busy} onClick={recompute}
          title="TSS aller Lauf- (rTSS/NGP) und Rad-/Commute-Aktivitäten (Power-TSS/NP) + geplanten Einheiten nach TrainingPeaks neu berechnen — mit DB-Backup">
          🧮 TSS neu berechnen (Lauf + Rad)
        </button>
      </div>
      {result && <p className="tiny" style={{ marginTop: 8 }}>{result}</p>}
      {status?.connected && (
        <p className="tiny muted" style={{ marginTop: 6 }}>
          Tipp: Jahres-Import ggf. 2–3× im Abstand von 15 min ausführen — die Detail-/Stream-Anreicherung (Zonen, NGP/NP, kcal)
          arbeitet wegen des Strava-Rate-Limits in Häppchen.
        </p>
      )}
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
