// Bestzeiten + Critical Speed (v0.14.0, ToDo 8): PBs je Standarddistanz aus Stravas best_efforts,
// dazu ein 2-Parameter-CS-Modell (d = CS·t + D') mit Vorhersagen und Distanz-Zeit-Diagramm.
import { useEffect, useState } from "react";
import {
  ScatterChart, Scatter, LineChart, Line, Legend, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { api, type BestsResult, type FitnessTrend } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import { paceStr, secToClock, fmtDate, fmtDateY, todayIso } from "../lib/util.ts";

const PRED_LINES = [
  { key: "p5000", label: "5 km", color: "#0ea5e9" },
  { key: "p10000", label: "10 km", color: "#22c55e" },
  { key: "p21097", label: "Halbmarathon", color: "#eab308" },
  { key: "p42195", label: "Marathon", color: "#ef4444" },
] as const;

const DIST_NAMES: Record<number, string> = {
  400: "400 m", 805: "½ Meile", 1000: "1 km", 1609: "1 Meile", 3219: "2 Meilen",
  5000: "5 km", 10000: "10 km", 15000: "15 km", 16093: "10 Meilen", 20000: "20 km",
  21097: "Halbmarathon", 42195: "Marathon",
};
function distLabel(m: number): string {
  return DIST_NAMES[m] || (m >= 1000 ? `${Math.round(m / 100) / 10} km` : `${m} m`);
}

export default function Bests() {
  const { season } = useSeason();
  const [data, setData] = useState<BestsResult | null>(null);
  const [fit, setFit] = useState<FitnessTrend | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [err, setErr] = useState(false);
  useEffect(() => { api.bests().then(setData).catch(() => setErr(true)); }, []);
  useEffect(() => {
    const from = season.length ? season[0].start_date : undefined;
    api.fitnessTrend(from, todayIso()).then(setFit).catch(() => setFit(null));
  }, [season]);
  const toggleLine = (key: string) =>
    setHidden((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  if (err) return <div className="empty">Bestzeiten konnten nicht geladen werden.</div>;
  if (!data) return <p className="muted">Lädt…</p>;

  const { pbs, cs, predictions } = data;
  const predByDist = new Map(predictions.map((p) => [p.distance_m, p.time_s]));

  // Diagramm: Datenpunkte (Zeit s / Distanz m) + CS-Gerade als Segment über den genutzten Bereich.
  const pts = pbs.map((p) => ({ t: p.time_s, d: p.distance_m, label: distLabel(p.distance_m) }));
  const fitPts = pbs.filter((p) => p.time_s >= 120 && p.time_s <= 1800 && p.distance_m >= 1000);
  const seg = cs && fitPts.length >= 2
    ? (() => {
        const x0 = Math.min(...fitPts.map((p) => p.time_s));
        const x1 = Math.max(...fitPts.map((p) => p.time_s));
        return [
          { x: x0, y: cs.cs_mps * x0 + cs.dPrime_m },
          { x: x1, y: cs.cs_mps * x1 + cs.dPrime_m },
        ];
      })()
    : null;

  return (
    <div>
      <h1>Bestzeiten</h1>
      <p className="tiny muted" style={{ marginTop: -4 }}>
        Persönliche Bestzeiten je Standarddistanz aus den Strava-Daten und ein Critical-Speed-Modell daraus.
        Die Liste füllt sich über die Strava-Syncs („Details/Splits nachziehen").
      </p>

      {!pbs.length && (
        <div className="empty">
          Noch keine Bestzeiten. In den Einstellungen Strava verbinden und „Details/Splits nachziehen"
          ausführen — die Bestzeiten werden dann (budgetiert über mehrere Durchläufe) ergänzt.
        </div>
      )}

      {pbs.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", alignItems: "start" }}>
          {/* PB-Tabelle */}
          <div className="card">
            <h2>Persönliche Bestzeiten</h2>
            <table>
              <thead><tr><th>Distanz</th><th>Zeit</th><th>Ø-Pace</th><th>Datum</th></tr></thead>
              <tbody>
                {pbs.map((p) => (
                  <tr key={p.distance_m}>
                    <td><strong>{distLabel(p.distance_m)}</strong></td>
                    <td>{secToClock(p.time_s)}</td>
                    <td className="muted">{paceStr(p.pace_s)}/km</td>
                    <td className="tiny muted nowrap">{fmtDateY(p.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Critical-Speed-Modell */}
          <div className="card">
            <h2>Critical Speed</h2>
            {!cs && <p className="tiny muted">Zu wenige Bestzeiten im aeroben Bereich (2–30 min) für ein Modell — kommt mit mehr Syncs.</p>}
            {cs && (
              <>
                <div className="grid cols-3" style={{ gap: 8 }}>
                  <div className="stat"><div className="label">Critical Speed</div><div className="value" style={{ fontSize: 22 }}>{paceStr(cs.cs_pace_s)}<span className="tiny muted"> /km</span></div></div>
                  <div className="stat"><div className="label">D′ (anaerob)</div><div className="value" style={{ fontSize: 22 }}>{cs.dPrime_m}<span className="tiny muted"> m</span></div></div>
                  <div className="stat"><div className="label">Fit-Güte R²</div><div className="value" style={{ fontSize: 22 }}>{cs.rSquared ?? "–"}<span className="tiny muted"> · n={cs.n}</span></div></div>
                </div>
                <div className="tiny muted" style={{ marginTop: 8, marginBottom: 4 }}>Modell-Vorhersage</div>
                <table>
                  <thead><tr><th>Distanz</th><th>Prognose</th><th>PB</th></tr></thead>
                  <tbody>
                    {[5000, 10000, 21097, 42195].map((d) => {
                      const pred = predByDist.get(d);
                      const pb = pbs.find((p) => p.distance_m === d);
                      return (
                        <tr key={d}>
                          <td><strong>{distLabel(d)}</strong></td>
                          <td>{pred ? secToClock(pred) : "–"}</td>
                          <td className="muted">{pb ? secToClock(pb.time_s) : "–"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>

          {/* Distanz-Zeit-Diagramm + CS-Gerade */}
          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <h3>Distanz vs. Zeit (Critical-Speed-Gerade)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 12, right: 16, left: 4, bottom: 16 }}>
                <CartesianGrid stroke="#eef1f5" />
                <XAxis type="number" dataKey="t" name="Zeit" tick={{ fontSize: 11, fill: "#8a96a6" }}
                  domain={["dataMin", "dataMax"]} tickFormatter={(s) => secToClock(s)} />
                <YAxis type="number" dataKey="d" name="Distanz" tick={{ fontSize: 11, fill: "#8a96a6" }}
                  tickFormatter={(m) => `${Math.round(m / 100) / 10}k`} width={42} />
                <Tooltip content={<BestTooltip />} />
                {seg && <ReferenceLine ifOverflow="extendDomain" stroke="var(--form)" strokeWidth={2} strokeDasharray="5 4"
                  segment={seg as { x: number; y: number }[]} />}
                <Scatter data={pts} fill="var(--accent)" />
              </ScatterChart>
            </ResponsiveContainer>
            <p className="tiny muted" style={{ marginTop: 4 }}>
              Punkte = Bestzeiten; gestrichelte Linie = CS-Modell (Steigung = Critical Speed, y-Achsenabschnitt = D′).
            </p>
          </div>
        </div>
      )}

      {(() => {
        const predPoints = (fit?.points ?? []).filter((p) => p.p5000 != null || p.p10000 != null || p.p21097 != null || p.p42195 != null);
        if (predPoints.length < 2) return null;
        return (
          <div className="card">
            <div className="spread">
              <h2>Renn-Prognose im Verlauf</h2>
              <span className="tiny muted">CS-Modell, 90-Tage-Fenster — schneller = oben · Legende klicken zum Aus-/Einblenden</span>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={predPoints} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
                <CartesianGrid stroke="#eef1f5" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={28} tick={{ fontSize: 11, fill: "#8a96a6" }} />
                <YAxis reversed domain={["dataMin", "dataMax"]} width={52} tickFormatter={(s: number) => secToClock(s)}
                  tick={{ fontSize: 11, fill: "#8a96a6" }} />
                <Tooltip
                  labelFormatter={(d) => fmtDate(String(d))}
                  formatter={(v: number, n: string) => [secToClock(v), n]}
                  contentStyle={{ borderRadius: 10, border: "1px solid #e3e8ef", fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
                  onClick={(e) => { if (e?.dataKey) toggleLine(String(e.dataKey)); }} />
                {PRED_LINES.map((l) => (
                  <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={l.color}
                    strokeWidth={1.8} connectNulls dot={false} hide={hidden.has(l.key)} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })()}
    </div>
  );
}

function BestTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as { t: number; d: number; label: string };
  return (
    <div style={{ background: "#fff", border: "1px solid #e3e8ef", borderRadius: 10, padding: "8px 10px", fontSize: 12 }}>
      <div style={{ fontWeight: 700 }}>{p.label}</div>
      <div>{secToClock(p.t)} · {paceStr(Math.round(p.t / (p.d / 1000)))}/km</div>
    </div>
  );
}
