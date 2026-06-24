// HF-Zonen & Schwellen je Profil (v0.12.0, ToDo 6/11): aus den Einstellungen in das Profil-Menü gezogen.
// Selbstständige Komponente — lädt die Zonen-Sets des aktiven Profils selbst.
import { useEffect, useState } from "react";
import { api, type ZoneSet } from "../lib/api.ts";
import { todayIso, num } from "../lib/util.ts";
import T from "./T.tsx";
import { useT } from "../lib/i18n.tsx";

export default function ZoneSets() {
  const [zonesets, setZonesets] = useState<ZoneSet[]>([]);
  const [importDate, setImportDate] = useState(todayIso()); // Gültig-ab für den Strava-Import (v0.14.0, ToDo 10)
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const t = useT();
  const reload = async () => setZonesets(await api.zonesets());
  useEffect(() => { reload(); }, []);

  async function importStrava() {
    setBusy(true); setMsg("Hole HF-/Power-Zonen aus Strava…");
    try {
      await api.importStravaZones(importDate);
      setMsg(`Zonensatz aus Strava angelegt (gültig ab ${importDate}) — unten ggf. feinjustieren.`);
      reload();
    } catch (e) {
      setMsg(String(e).includes("403")
        ? "Strava-Berechtigung fehlt — bitte in den Einstellungen neu verbinden (Zonen-Zugriff freigeben)."
        : `Import fehlgeschlagen: ${e}`);
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="spread"><h2><T k="zones.title">HF-Zonen & Schwellen</T></h2>
        <div className="row" style={{ width: "auto", gap: 8 }}>
          <label className="field" style={{ margin: 0, width: 140 }}><span><T k="zones.field.importFrom">Strava-Import ab</T></span>
            <input type="date" value={importDate} onChange={(e) => setImportDate(e.target.value)} /></label>
          <button disabled={busy} onClick={importStrava} title={t("zones.btn.fromStrava", "↧ Aus Strava holen")}><T k="zones.btn.fromStrava">↧ Aus Strava holen</T></button>
          <button onClick={() => newZoneset(zonesets, reload)}><T k="zones.btn.newSet">+ Neues Set (Leistungsdiagnostik)</T></button>
        </div>
      </div>
      <p className="tiny muted"><T k="zones.hint">Bei neuer Diagnostik ein neues Set mit Gültig-ab-Datum anlegen — ältere Wochen werden weiter mit dem damals gültigen Set ausgewertet. Der Strava-Import übernimmt nur die aktuellen Zonen (HF Z1–Z5, Z6 geschätzt) + FTP; ggf. einmal „neu verbinden", damit der Zonen-Zugriff greift.</T></p>
      {msg && <div className="flag info"><span className="dot" /><span>{msg}</span></div>}
      {zonesets.map((z) => <ZoneSetEditor key={z.id} z={z} onChange={reload} canDelete={zonesets.length > 1} />)}
    </div>
  );
}

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

/** Plausibilitäts-Check der Zonen-Reihenfolge (v1.6.0, F2): HF/Power steigen je Zone, Pace wird schneller (kleinere s/km). */
function zoneWarnings(e: ZoneSet): string[] {
  const w: string[] = [];
  const hrCheck = (zones: { z: number; max: number }[] | null | undefined, label: string) => {
    if (!zones) return;
    for (let i = 0; i < zones.length - 1; i++) {
      const a = zones[i].max, b = zones[i + 1].max;
      if (a >= 990 || b >= 990) continue; // Max-Sentinel (offene Oberzone)
      if (a > 0 && b > 0 && a >= b) w.push(`${label}: Z${zones[i].z} (${a}) ≥ Z${zones[i + 1].z} (${b}) — HF muss je Zone steigen.`);
    }
  };
  hrCheck(e.hr_zones, "HF Lauf");
  hrCheck(e.hr_zones_bike, "HF Rad");
  const pace = e.pace_zones || [];
  for (let i = 0; i < pace.length - 1; i++) {
    const a = pace[i], b = pace[i + 1];
    if ((a ?? 0) > 0 && (b ?? 0) > 0 && a <= b) w.push(`Pace: Z${i + 1} (${paceMmSs(a)}) ist nicht langsamer als Z${i + 2} (${paceMmSs(b)}) — höhere Zone muss schneller sein (kleinere s/km).`);
  }
  const pw = e.power_zones || [];
  for (let i = 0; i < pw.length - 1; i++) {
    const a = pw[i], b = pw[i + 1];
    if ((a ?? 0) > 0 && (b ?? 0) > 0 && a >= b) w.push(`Power: Z${i + 1} (${a} W) ≥ Z${i + 2} (${b} W) — Watt muss je Zone steigen.`);
  }
  return w;
}

function ZoneSetEditor({ z, onChange, canDelete }: { z: ZoneSet; onChange: () => void; canDelete: boolean }) {
  const [e, setE] = useState(z);
  const t = useT();
  const saveZ = (next: ZoneSet) => { setE(next); api.updateZoneset(z.id, next).then(onChange); };
  // v0.12.0 (ToDo 11): nur die Obergrenze je Zone eingeben — Untergrenzen automatisch = Vorzone + 1 (Z1 ab 0).
  const setHrMax = (i: number, v: number | null) => {
    const maxes = e.hr_zones.map((zn, j) => (j === i ? (v ?? 0) : zn.max));
    const hr = e.hr_zones.map((zn, j) => ({ ...zn, max: maxes[j], min: j === 0 ? 0 : (maxes[j - 1] || 0) + 1 }));
    saveZ({ ...e, hr_zones: hr });
  };
  const setHrBikeMax = (i: number, v: number | null) => {
    const base = e.hr_zones_bike ?? e.hr_zones;
    const maxes = base.map((zn, j) => (j === i ? (v ?? 0) : zn.max));
    const hr = base.map((zn, j) => ({ ...zn, max: maxes[j], min: j === 0 ? 0 : (maxes[j - 1] || 0) + 1 }));
    saveZ({ ...e, hr_zones_bike: hr });
  };
  const setPace = (i: number, v: number | null) => { const arr = [...(e.pace_zones || [])]; arr[i] = v ?? 0; saveZ({ ...e, pace_zones: arr }); };
  const setPower = (i: number, v: number | null) => { const arr = [...(e.power_zones || [])]; arr[i] = v ?? 0; saveZ({ ...e, power_zones: arr }); };
  const warnings = zoneWarnings(e);
  return (
    <div className="card tight" style={{ background: "#fafbfd" }}>
      <div className="row mb">
        <label className="field" style={{ margin: 0 }}><span><T k="zones.field.validFrom">Gültig ab</T></span><input type="date" value={e.valid_from} onChange={(x) => saveZ({ ...e, valid_from: x.target.value })} /></label>
        <label className="field" style={{ margin: 0, width: 80 }}><span><T k="zones.field.lthr">LTHR</T></span><input type="number" value={e.lthr} onChange={(x) => saveZ({ ...e, lthr: Number(x.target.value) })} /></label>
        <label className="field" style={{ margin: 0, width: 80 }}><span><T k="zones.field.ftp">FTP</T></span><input type="number" value={e.ftp} onChange={(x) => saveZ({ ...e, ftp: Number(x.target.value) })} /></label>
        <label className="field" style={{ margin: 0, width: 130 }}><span><T k="zones.field.threshPace">Schwellen-Pace (mm:ss /km)</T></span>
          <input key={`tp-${e.threshold_pace}`} placeholder="4:45" defaultValue={paceMmSs(e.threshold_pace)}
            onBlur={(x) => { const v = parsePaceInput(x.target.value); if (v != null && v !== e.threshold_pace) saveZ({ ...e, threshold_pace: v }); }} />
        </label>
        <label className="field" style={{ margin: 0, flex: 1 }}><span><T k="zones.field.note">Quelle/Notiz</T></span><input value={e.note ?? ""} onChange={(x) => saveZ({ ...e, note: x.target.value })} /></label>
        {canDelete && <button className="sm ghost danger" onClick={() => api.deleteZoneset(z.id).then(onChange)}><T k="zones.btn.deleteSet">Set löschen</T></button>}
      </div>
      <div className="tiny muted" style={{ marginBottom: 2 }}><T k="zones.hr.hint">HF-Zonen (Obergrenze bpm je Zone — Untergrenze automatisch = Vorzone + 1)</T></div>
      <div className="row" style={{ gap: 6 }}>
        {e.hr_zones.map((zn, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center" }}>
            <div className="tiny" style={{ color: zn.color, fontWeight: 700 }}>Z{zn.z}</div>
            <input type="number" style={{ padding: "4px", textAlign: "center", width: "100%" }} value={zn.max}
              onChange={(x) => setHrMax(i, num(x.target.value))} />
            <div className="tiny muted" style={{ marginTop: 2 }}>{zn.min}–{zn.max >= 990 ? "max" : zn.max}</div>
          </div>
        ))}
      </div>
      <div className="tiny muted" style={{ margin: "6px 0 2px" }}><T k="zones.pace.hint">Pace-Zonen Lauf (mm:ss /km, Obergrenze je Zone — aus Diagnostik)</T></div>
      <div className="row" style={{ gap: 6 }}>
        {e.hr_zones.map((_zn, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center" }}>
            <input key={`pz${i}-${e.pace_zones?.[i] ?? ""}`} placeholder="4:45" style={{ padding: "4px", textAlign: "center" }}
              defaultValue={paceMmSs(e.pace_zones?.[i])}
              onBlur={(x) => { const v = parsePaceInput(x.target.value); if ((v ?? 0) !== (e.pace_zones?.[i] ?? 0)) setPace(i, v); }} />
          </div>
        ))}
      </div>
      <div className="row" style={{ alignItems: "center", margin: "6px 0 2px", gap: 8 }}>
        <span className="tiny muted"><T k="zones.bikeHr.hint">HF-Zonen Fahrrad (Obergrenze bpm je Zone — optional, separat von Lauf)</T></span>
        {!e.hr_zones_bike && (
          <button className="sm ghost" style={{ fontSize: 11 }}
            onClick={() => saveZ({ ...e, hr_zones_bike: e.hr_zones.map((z) => ({ ...z })) })}>
            <T k="zones.btn.copyFromRun">+ Von Lauf übernehmen</T>
          </button>
        )}
        {e.hr_zones_bike && (
          <button className="sm ghost danger" style={{ fontSize: 11 }}
            onClick={() => saveZ({ ...e, hr_zones_bike: null })}>
            <T k="zones.btn.removeBike">Rad-Zonen entfernen</T>
          </button>
        )}
      </div>
      {e.hr_zones_bike && (
        <div className="row" style={{ gap: 6 }}>
          {(e.hr_zones_bike ?? e.hr_zones).map((zn, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center" }}>
              <div className="tiny" style={{ color: zn.color, fontWeight: 700 }}>Z{zn.z}</div>
              <input type="number" style={{ padding: "4px", textAlign: "center", width: "100%" }} value={zn.max}
                onChange={(x) => setHrBikeMax(i, num(x.target.value))} />
              <div className="tiny muted" style={{ marginTop: 2 }}>{zn.min}–{zn.max >= 990 ? "max" : zn.max}</div>
            </div>
          ))}
        </div>
      )}
      <div className="tiny muted" style={{ margin: "6px 0 2px" }}><T k="zones.power.hint">Power-Zonen Rad (Watt, Obergrenze je Zone — optional)</T></div>
      <div className="row" style={{ gap: 6 }}>
        {e.hr_zones.map((_zn, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center" }}>
            <input type="number" placeholder="Watt" style={{ padding: "4px", textAlign: "center" }} value={e.power_zones?.[i] ?? ""} onChange={(x) => setPower(i, num(x.target.value))} />
          </div>
        ))}
      </div>
      {warnings.length > 0 && (
        <div className="flag danger" style={{ marginTop: 8, flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
          <strong style={{ fontSize: 12 }}>⚠ Zonen-Plausibilität</strong>
          {warnings.map((wn, i) => <span key={i} className="tiny">{wn}</span>)}
        </div>
      )}
    </div>
  );
}

async function newZoneset(zonesets: ZoneSet[], reload: () => void) {
  const base = zonesets[0];
  await api.addZoneset({ valid_from: todayIso(), hr_zones: base?.hr_zones, pace_zones: base?.pace_zones, lthr: base?.lthr, ftp: base?.ftp, threshold_pace: base?.threshold_pace, source: "Diagnostik", note: "" });
  reload();
}
