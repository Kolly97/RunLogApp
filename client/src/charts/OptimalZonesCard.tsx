// Optimale Zonen (v1.9.0): berechnet Pace/HF/Watt-Zonen aus den Laufwerten (VDOT/CS · LT1/LT2 · CP) nach
// etablierten Modellen und schlägt sie als Zonen-Set vor (du bestätigst). Quelle: /api/optimal-zones.
import { useEffect, useState } from "react";
import { api, type OptimalZonesResult } from "../lib/api.ts";
import { paceStr } from "../lib/util.ts";

const Z_LABELS = ["Z1 Recovery", "Z2 Endurance", "Z3 Tempo", "Z4 Threshold", "Z5 VO2max", "Z6 Anaerob"];

export default function OptimalZonesCard() {
  const [oz, setOz] = useState<OptimalZonesResult | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { api.optimalZones().then(setOz).catch(() => setOz(null)); }, []);
  if (!oz) return null;
  const z = oz.zones;
  if (!z) {
    return (
      <div className="card">
        <h2>Optimale Zonen</h2>
        <p className="tiny muted">Noch zu wenig Laufdaten für eine Zonen-Berechnung — es braucht ein paar Bestleistungen (für VDOT/CS). Danach erscheinen hier vorgeschlagene Pace-, HF- und Watt-Zonen.</p>
      </div>
    );
  }
  const apply = async () => {
    await api.addZoneset({
      valid_from: oz.today, hr_zones: z.hr_zones, pace_zones: z.pace_zones,
      power_zones: z.power_zones ?? [], lthr: z.lthr || undefined, threshold_pace: z.threshold_pace || undefined,
      ftp: z.cp ?? undefined, source: "Berechnet (optimal)",
      note: `Auto-Zonen — Pace: ${z.sources.pace} · HF: ${z.sources.hr}${z.sources.power ? ` · Watt: ${z.sources.power}` : ""}`,
    }).catch(() => {});
    setMsg("Als aktives Zonen-Set übernommen ✓");
  };
  const Col = ({ title, sub, rows }: { title: string; sub: string; rows: (string | null)[] }) => (
    <div>
      <div className="tiny muted" style={{ fontWeight: 700 }}>{title}</div>
      <div className="tiny muted" style={{ marginBottom: 4 }}>{sub}</div>
      {Z_LABELS.map((l, i) => rows[i] != null && (
        <div key={i} className="tiny" style={{ display: "flex", justifyContent: "space-between", gap: 8, lineHeight: 1.7 }}>
          <span className="muted">{l.split(" ")[0]}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{rows[i]}</span>
        </div>
      ))}
    </div>
  );
  const paceRows = z.pace_zones.map((s, i) => `≤ ${paceStr(s)}/km${i === 0 ? "" : ""}`);
  const hrRows = z.hr_zones.map((h) => `${h.min}–${h.max}`);
  const wattRows = z.power_zones ? z.power_zones.map((w) => `≤ ${w} W`) : Z_LABELS.map(() => null);

  return (
    <div className="card" data-tour="optimal-zones">
      <div className="spread">
        <h2>Optimale Zonen</h2>
        <span className="tiny muted">aus deinen Laufwerten berechnet</span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16, marginTop: 4 }}>
        <Col title="Pace" sub={z.sources.pace} rows={paceRows} />
        <Col title="Herzfrequenz" sub={z.sources.hr} rows={hrRows} />
        <Col title="Watt" sub={z.sources.power ?? "kein CP"} rows={wattRows} />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10, alignItems: "center" }}>
        <button className="sm" onClick={apply}>Als aktives Zonen-Set übernehmen</button>
        <span className="tiny muted">Vorschlag — deine manuellen Zonen bleiben erhalten, bis du übernimmst.</span>
        {msg && <span className="tiny" style={{ color: "var(--ok)" }}>{msg}</span>}
      </div>
    </div>
  );
}
