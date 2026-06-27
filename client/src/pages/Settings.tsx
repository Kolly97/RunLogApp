import { useEffect, useState } from "react";
import { api, type SeasonWeek } from "../lib/api.ts";
import { useLang, useT } from "../lib/i18n.tsx";
import T from "../components/T.tsx";

export default function Settings() {
  const [season, setSeason] = useState<SeasonWeek[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [msg] = useState("");
  const t = useT();
  const { lang, setLang } = useLang();

  async function reload() {
    setSeason(await api.season());
    setSettings(await api.settings());
  }
  useEffect(() => { reload(); }, []);

  if (!settings) return <p className="muted"><T k="settings.loading">Lädt…</T></p>;

  return (
    <div>
      <h1><T k="settings.title">Einstellungen</T></h1>
      {msg && <div className="flag ok"><span className="dot" /><span>{msg}</span></div>}
      <p className="tiny muted" style={{ marginTop: -4 }}><T k="settings.profileHint.pre">Profile und HF-Zonen/Schwellen findest du jetzt unter </T><a href="/profile"><T k="settings.profileHint.link">Profil</T></a>.</p>

      {/* Sprache / Language */}
      <div className="card">
        <h2><T k="settings.lang.label">Sprache / Language</T></h2>
        <div className="lang-switch" role="group" aria-label="Sprache">
          {(["de", "en"] as const).map((l) => (
            <button key={l} type="button" className={lang === l ? "active" : ""} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
          ))}
        </div>
      </div>

      {/* Schwellen */}
      <div className="card">
        <h2><T k="settings.thresholds.title">Analyse-Schwellen</T></h2>
        <div className="grid cols-4">
          <Num label={t("settings.thr.volume_pct", "Volumen ± %")} v={settings.thresholds.volume_pct} on={(x) => saveThr(settings, "volume_pct", x, setSettings)} />
          <Num label={t("settings.thr.ctl_ramp_max", "CTL-Ramp max/Wo")} v={settings.thresholds.ctl_ramp_max} on={(x) => saveThr(settings, "ctl_ramp_max", x, setSettings)} />
          <Num label={t("settings.thr.hard_pct_max", "Hart-% max")} v={settings.thresholds.hard_pct_max} on={(x) => saveThr(settings, "hard_pct_max", x, setSettings)} />
          <Num label={t("settings.thr.z3_pct_max", "Z3-% max")} v={settings.thresholds.z3_pct_max} on={(x) => saveThr(settings, "z3_pct_max", x, setSettings)} />
          <Num label={t("settings.thr.longrun_pct_max", "Longrun-% max")} v={settings.thresholds.longrun_pct_max} on={(x) => saveThr(settings, "longrun_pct_max", x, setSettings)} />
          <Num label={t("settings.thr.tsb_raceweek_min", "TSB Race Week min")} v={settings.thresholds.tsb_raceweek_min} on={(x) => saveThr(settings, "tsb_raceweek_min", x, setSettings)} />
          <Num label={t("settings.thr.raceweek_tss_max_pct", "Race 7d-Last max % (Taper)")} v={settings.thresholds.raceweek_tss_max_pct ?? 60} on={(x) => saveThr(settings, "raceweek_tss_max_pct", x, setSettings)} />
          <Num label={t("settings.thr.run_equiv_bike_factor", "Rad→Run Faktor")} v={settings.run_equiv_bike_factor} step="0.05" on={(x) => save1("run_equiv_bike_factor", x, setSettings)} />
        </div>
        <h3 style={{ marginTop: 12 }}><T k="settings.intensity.title">Intensitäts-Einstufung (Donut & Wochen-Bewertung)</T></h3>
        <p className="tiny muted" style={{ marginTop: 0 }}><T k="settings.intensity.hint">Vergleich mit dem Ø-TSS der letzten Wochen: ≤ Easy-% = easy, bis Hart-% = moderat, darüber = hart.</T></p>
        <div className="grid cols-4">
          <Num label={t("settings.thr.easy_pct", "Easy ≤ % vom Ø-TSS")} v={settings.thresholds.easy_pct ?? 80} on={(x) => saveThr(settings, "easy_pct", x, setSettings)} />
          <Num label={t("settings.thr.hard_pct", "Hart ≥ % vom Ø-TSS")} v={settings.thresholds.hard_pct ?? 105} on={(x) => saveThr(settings, "hard_pct", x, setSettings)} />
          <Num label={t("settings.thr.intensity_window_weeks", "Referenz-Fenster (Wochen)")} v={settings.thresholds.intensity_window_weeks ?? 4} on={(x) => saveThr(settings, "intensity_window_weeks", x, setSettings)} />
        </div>
      </div>

      {/* Adaptiver Coach (v1.5.0, S) — Readiness-Gate-Modus */}
      <div className="card">
        <h2><T k="settings.coach.title">Adaptiver Coach (Readiness-Gate)</T></h2>
        <p className="tiny muted" style={{ marginTop: 0 }}>
          <T k="settings.coach.hint">Bei niedriger Readiness passt der Coach „Heute" die geplante Einheit an. „Beratend" = nur Vorschlag; „Gate" = die Reduktion wird betont (du bestätigst weiterhin selbst).</T>
        </p>
        <div className="lang-switch" role="group" aria-label="Gate-Modus">
          {(["advisory", "gate"] as const).map((m) => (
            <button key={m} type="button" className={(settings.readiness_gate_mode ?? "advisory") === m ? "active" : ""}
              onClick={() => save1("readiness_gate_mode", m, setSettings)}>
              {m === "advisory" ? t("settings.coach.advisory", "Beratend") : t("settings.coach.gate", "Gate")}
            </button>
          ))}
        </div>
      </div>

      {/* Strava (OAuth + Sync, ToDo #10/#11) */}
      <StravaCard settings={settings} season={season} />
    </div>
  );
}

// ---- Strava-Karte --------------------------------------------------------
function StravaCard({ settings, season }: { settings: any; season: SeasonWeek[] }) {
  const t = useT();
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean; athlete: string | null } | null>(null);
  const [cid, setCid] = useState<string>(settings.strava_client_id || "");
  const [secret, setSecret] = useState<string>(settings.strava_client_secret || "");
  const [syncFrom, setSyncFrom] = useState<string>(settings.strava_sync_from || ""); // Extraktions-Startdatum (v0.14.0)
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [progress, setProgress] = useState<{ total: number; details: number; streams: number } | null>(null);
  const loadProgress = () => api.enrichProgress().then(setProgress).catch(() => setProgress(null));
  useEffect(() => { loadProgress(); }, []);

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
      // v1.6.3: ab dem Import-Startdatum anreichern (nicht ab Saisonstart) → erfasst den ganzen Altbestand.
      const r = await fetch("/api/strava/enrich", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ after: syncFrom || seasonStart }) });
      const j = await r.json();
      setResult(r.ok ? `✓ ${j.enriched} Aktivitäten angereichert (Details, Streams, Intervalle aus Laps).` : `Fehler: ${j.error || r.status}`);
      loadProgress();
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
        <h2><T k="settings.strava.title">Strava-Verbindung</T></h2>
        {status?.connected && (
          <span className="pill phase">
            <T k="settings.strava.connected">verbunden</T>{status.athlete ? <> <T k="settings.strava.connectedAs">als</T> {status.athlete}</> : ""}
          </span>
        )}
      </div>
      <p className="tiny muted">
        <T k="settings.strava.help.pre">Einmalig: auf </T>
        <a href="https://www.strava.com/settings/api" target="_blank" rel="noreferrer">strava.com/settings/api</a>
        <T k="settings.strava.help.mid"> eine (kostenlose) API-App anlegen — „Autorisierungs-Callback-Domain": </T>
        <code>localhost</code>
        <T k="settings.strava.help.post"> — und Client-ID + Client-Secret hier eintragen. Der Import holt Aktivitäts-Daten (km, Zeit, Ø-HF, Watt) und Streams (NGP/NP, Zeit-in-Zone) — die Last (TSS) rechnet die App geräteneutral aus NGP/NP bzw. einer Schätzung (optional manuell überschreibbar). Vorhandene/manuell bearbeitete Einheiten werden nie überschrieben.</T>
      </p>
      <div className="row mb">
        <label className="field" style={{ margin: 0, width: 160 }}><span><T k="settings.strava.clientId">Client-ID</T></span>
          <input value={cid} onChange={(e) => setCid(e.target.value)} onBlur={saveCreds} placeholder={t("settings.strava.cidPlaceholder", "z.B. 123456")} /></label>
        <label className="field" style={{ margin: 0, flex: 1 }}><span><T k="settings.strava.clientSecret">Client-Secret</T></span>
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} onBlur={saveCreds} placeholder="••••••••" /></label>
      </div>
      <div className="row">
        {!status?.connected && (
          <button className="primary" disabled={!status?.configured && !(cid && secret)}
            onClick={() => { saveCreds().then(() => { window.location.href = "/api/strava/login"; }); }}>
            <T k="settings.strava.connect">Mit Strava verbinden</T>
          </button>
        )}
        {status?.connected && (
          <>
            <label className="field" style={{ margin: 0, width: 150 }}><span><T k="settings.strava.dataFrom">Daten ab</T></span>
              <input type="date" value={syncFrom || seasonStart} onChange={(e) => saveSyncFrom(e.target.value)} title={t("settings.strava.dataFromTitle", "Startdatum, ab dem Strava-Aktivitäten importiert werden")} /></label>
            <button className="primary" disabled={busy} onClick={() => sync(syncFrom || seasonStart, `Sync ab ${syncFrom || seasonStart}`)}>⟳ <T k="settings.strava.syncFromDate">Sync ab Datum</T></button>
            <button disabled={busy} onClick={() => sync(yearStart, "Jahres-Import")}>📅 <T k="settings.strava.importYear">Ganzes Jahr importieren</T></button>
            <button className="ghost" disabled={busy} onClick={() => { window.location.href = "/api/strava/login"; }}><T k="settings.strava.reconnect">neu verbinden</T></button>
          </>
        )}
      </div>
      <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
        {status?.connected && (
          <button className="ghost" disabled={busy} onClick={enrich}
            title={t("settings.strava.enrichTitle", "Nur Details, Streams (Zonen/NGP) und Intervalle (aus den Laps) für bestehende Aktivitäten nachziehen — ohne neue zu importieren. Budgetiert, ggf. mehrfach.")}>
            📥 <T k="settings.strava.enrichBtn">Details/Splits nachziehen</T>
          </button>
        )}
        <button className="ghost" disabled={busy} onClick={recompute}
          title={t("settings.strava.recomputeTitle", "TSS aller Lauf- (rTSS/NGP) und Rad-/Commute-Aktivitäten (Power-TSS/NP) + geplanten Einheiten nach TrainingPeaks neu berechnen — mit DB-Backup")}>
          🧮 <T k="settings.strava.recomputeBtn">TSS neu berechnen (Lauf + Rad)</T>
        </button>
      </div>
      {progress && progress.total > 0 && (
        <div className="row" style={{ marginTop: 12, gap: 24, alignItems: "center" }}>
          <DonutStat label={t("settings.enrich.details", "Details")} value={progress.details} total={progress.total} color="#0ea5e9" />
          <DonutStat label={t("settings.enrich.streams", "Streams / Splits")} value={progress.streams} total={progress.total} color="#16a34a" />
          <span className="tiny muted" style={{ maxWidth: 240 }}>
            <T k="settings.enrich.hint">Anteil der Aktivitäten mit nachgezogenen Details bzw. Streams (NGP/NP, Zonen, Splits, Effective VO2max). „Details/Splits nachziehen" füllt den Rest budgetiert auf.</T>
          </span>
        </div>
      )}
      {result && <p className="tiny" style={{ marginTop: 8 }}>{result}</p>}
      {status?.connected && (
        <p className="tiny muted" style={{ marginTop: 6 }}>
          <T k="settings.strava.tip">Tipp: Jahres-Import ggf. 2–3× im Abstand von 15 min ausführen — die Detail-/Stream-Anreicherung (Zonen, NGP/NP, kcal) arbeitet wegen des Strava-Rate-Limits in Häppchen.</T>
        </p>
      )}
    </div>
  );
}

// ---- helpers -----------------------------------------------------------
/** Kompakter SVG-Doughnut mit Anteil + „x / Σ" (v1.5.0, D1). */
function DonutStat({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? value / total : 0;
  const r = 26, c = 2 * Math.PI * r;
  return (
    <div style={{ textAlign: "center", width: 96 }}>
      <svg width="72" height="72" viewBox="0 0 72 72" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="36" cy="36" r={r} fill="none" stroke="#eef1f5" strokeWidth="9" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`} />
      </svg>
      <div style={{ marginTop: -50, marginBottom: 28, fontSize: 13, fontWeight: 700 }}>{Math.round(pct * 100)}%</div>
      <div className="tiny" style={{ fontWeight: 600 }}>{label}</div>
      <div className="tiny muted">{value} / {total}</div>
    </div>
  );
}
function Num({ label, v, on, step }: { label: string; v: number; on: (x: number) => void; step?: string }) {
  return <label className="field"><span>{label}</span><input type="number" step={step || "1"} defaultValue={v} onBlur={(e) => on(Number(e.target.value))} /></label>;
}
function saveThr(settings: any, key: string, val: number, setSettings: (s: any) => void) {
  const thresholds = { ...settings.thresholds, [key]: val };
  setSettings({ ...settings, thresholds });
  api.saveSettings({ thresholds });
}
function save1(key: string, val: unknown, setSettings: (fn: any) => void) {
  setSettings((s: any) => ({ ...s, [key]: val }));
  api.saveSettings({ [key]: val });
}
