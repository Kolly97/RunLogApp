// Lauf-Power-Sektion (v1.7.0): Critical Power, Power-Duration-Kurve, %CP-Zonen, CP-Trend, RSS.
// Quelle: /api/power-curve (90-Tage-Hüllkurve + CP-Fit) und /api/cp-trend (rollendes CP).
// Hinweis: Coros-Laufwatt sind gerätespezifisch → CP/Zonen/RSS sind RELATIV zu deinen Coros-Watt zu lesen.
import { useEffect, useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type PowerCurve, type CpTrend, type RunEffectiveness, type WPrimeLatest } from "../lib/api.ts";
import { fmtDate } from "../lib/util.ts";

const durLabel = (s: number) => (s % 60 === 0 ? `${s / 60}'` : `${s}s`);

export default function PowerCard() {
  const [pc, setPc] = useState<PowerCurve | null>(null);
  const [trend, setTrend] = useState<CpTrend | null>(null);
  const [re, setRe] = useState<RunEffectiveness | null>(null);
  const [wb, setWb] = useState<WPrimeLatest | null>(null);

  useEffect(() => {
    api.powerCurve(90).then(setPc).catch(() => setPc(null));
    api.cpTrend(12).then(setTrend).catch(() => setTrend(null));
    api.runEffectiveness(90).then(setRe).catch(() => setRe(null));
    api.wprimeLatest().then(setWb).catch(() => setWb(null));
  }, []);

  if (!pc) return null;

  if (!pc.cp || pc.n === 0) {
    return (
      <div className="card">
        <div className="spread"><h2>Lauf-Power</h2><span className="pill" style={{ background: "#64748b", color: "#fff" }}>Coros-Watt</span></div>
        <p className="tiny muted">Noch keine Lauf-Watt erfasst. Coros liefert Laufleistung über Strava — beim nächsten Sync mit „Details/Splits nachziehen" werden die Power-Streams angereichert (Läufe ≥ 10 min). Danach erscheinen hier Critical Power, Power-Kurve und Zonen.</p>
      </div>
    );
  }

  const curveData = pc.durations.filter((d) => pc.curve[d] > 0).map((d) => ({ label: durLabel(d), w: pc.curve[d] }));
  const trendData = (trend?.points ?? []).map((p) => ({ date: p.date, cp: p.cp }));

  return (
    <div className="card" data-tour="power">
      <div className="spread">
        <h2>Lauf-Power (Critical Power)</h2>
        <span className="pill" style={{ background: "#64748b", color: "#fff" }} title="Coros-Laufwatt sind gerätespezifisch — Werte relativ zu deinen Coros-Watt interpretieren.">relativ zu deinen Coros-Watt</span>
      </div>

      <div className="row" style={{ gap: 24, flexWrap: "wrap", alignItems: "baseline", marginTop: 4 }}>
        <div><div className="tiny muted">Critical Power</div><div style={{ fontSize: 26, fontWeight: 700 }}>{pc.cp} W</div></div>
        <div><div className="tiny muted">W′ (anaerobe Kapazität)</div><div style={{ fontSize: 18 }}>{pc.wPrime != null ? `${(pc.wPrime / 1000).toFixed(1)} kJ` : "—"}</div></div>
        <div><div className="tiny muted">Fit-Güte r²</div><div style={{ fontSize: 18 }}>{pc.rSquared != null ? pc.rSquared.toFixed(3) : "—"}</div></div>
        <div><div className="tiny muted">Läufe (90 T.)</div><div style={{ fontSize: 18 }}>{pc.n}</div></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16, marginTop: 12 }}>
        {/* Power-Duration-Kurve */}
        <div>
          <div className="tiny muted" style={{ marginBottom: 4 }}>Power-Duration-Kurve (beste Watt je Dauer · 90 T.)</div>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={curveData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={["dataMin - 10", "dataMax + 10"]} width={38} unit=" W" />
              <Tooltip formatter={(v: number) => [`${v} W`, "best"]} contentStyle={{ borderRadius: 8, border: "1px solid #e3e8ef", fontSize: 11, padding: "4px 8px" }} />
              <Line type="monotone" dataKey="w" stroke="#7c3aed" strokeWidth={1.8} dot={{ r: 2.5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {/* CP-Trend */}
        <div>
          <div className="tiny muted" style={{ marginBottom: 4 }}>CP-Trend (rollendes 90-Tage-Fenster)</div>
          {trendData.length >= 2 ? (
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={trendData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => fmtDate(String(d)).slice(0, 6)} />
                <YAxis tick={{ fontSize: 10 }} domain={["dataMin - 5", "dataMax + 5"]} width={38} unit=" W" />
                <Tooltip labelFormatter={(d) => fmtDate(String(d))} formatter={(v: number) => [`${v} W`, "CP"]} contentStyle={{ borderRadius: 8, border: "1px solid #e3e8ef", fontSize: 11, padding: "4px 8px" }} />
                <Line type="monotone" dataKey="cp" stroke="#0ea5e9" strokeWidth={1.8} dot={{ r: 2 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <p className="tiny muted">Noch zu wenig Verlauf für einen CP-Trend.</p>}
        </div>
      </div>

      {/* Running Effectiveness (Ökonomie-Trend) + W′-bal (anaerobe Reserve im Intervall) — v1.8.0 */}
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16, marginTop: 12 }}>
        <div>
          <div className="spread">
            <div className="tiny muted">Running Effectiveness (Ökonomie · gleichmäßige Läufe)</div>
            {re?.deltaPct != null && <span className="tiny" style={{ color: re.deltaPct >= 0 ? "var(--ok)" : "var(--danger)", fontWeight: 700 }}>{re.deltaPct >= 0 ? "↗" : "↘"} {re.deltaPct > 0 ? "+" : ""}{re.deltaPct}%</span>}
          </div>
          {re && re.n >= 3 ? (
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={re.points} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => fmtDate(String(d)).slice(0, 6)} minTickGap={28} />
                <YAxis tick={{ fontSize: 10 }} domain={["dataMin - 0.02", "dataMax + 0.02"]} width={36} tickFormatter={(v: number) => v.toFixed(2)} />
                <Tooltip labelFormatter={(d) => fmtDate(String(d))} formatter={(v: number) => [v.toFixed(3), "RE"]} contentStyle={{ borderRadius: 8, border: "1px solid #e3e8ef", fontSize: 11, padding: "4px 8px" }} />
                <Line type="monotone" dataKey="re" stroke="#16a34a" strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <p className="tiny muted">Zu wenig gleichmäßige Läufe mit Watt für einen Ökonomie-Trend.</p>}
          <div className="tiny muted" style={{ marginTop: 2 }}>Höher = ökonomischer (gleiche Pace, weniger Watt). Trend masseunabhängig.</div>
        </div>
        <div>
          <div className="spread">
            <div className="tiny muted">W′-bal — anaerobe Reserve im Intervall{wb?.available && wb.activity ? ` (${wb.activity.type}, ${fmtDate(wb.activity.date)})` : ""}</div>
            {wb?.available && <span className="tiny" style={{ fontWeight: 700 }}>tiefster Stand {wb.minPct}%</span>}
          </div>
          {wb?.available && wb.curve && wb.curve.length ? (
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={wb.curve} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="t" tick={{ fontSize: 10 }} tickFormatter={(t: number) => `${Math.round(t)}′`} />
                <YAxis tick={{ fontSize: 10 }} width={40} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip labelFormatter={(t) => `${t} min`} formatter={(v: number) => [`${(v / 1000).toFixed(1)} kJ`, "W′-bal"]} contentStyle={{ borderRadius: 8, border: "1px solid #e3e8ef", fontSize: 11, padding: "4px 8px" }} />
                <ReferenceLine y={0} stroke="var(--danger)" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="bal" stroke="#7c3aed" strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <p className="tiny muted">Keine jüngste VO2-/Renntempo-Einheit mit Watt für die W′-bal-Analyse.</p>}
          {wb?.available && <div className="tiny muted" style={{ marginTop: 2 }}>{wb.verdict}</div>}
        </div>
      </div>

      {/* %CP-Zonen */}
      <div className="tiny muted" style={{ margin: "10px 0 4px" }}>Power-Zonen (%CP, Stryd-nah)</div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {pc.zones.map((z) => (
          <span key={z.z} className="pill" style={{ background: "#eef2f7", color: "var(--text)", fontSize: 11 }}>
            <strong>Z{z.z} {z.name}</strong> {z.lo}{z.hi != null ? `–${z.hi}` : "+"} W
          </span>
        ))}
      </div>

      {/* RSS jüngste Läufe */}
      {pc.recent.length > 0 && (
        <>
          <div className="tiny muted" style={{ margin: "12px 0 4px" }}>RSS jüngste Läufe (Power-Stress, NP/CP)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {pc.recent.slice(0, 6).map((r, i) => (
              <div key={i} className="row" style={{ gap: 8, fontSize: 11 }}>
                <span className="muted" style={{ width: 64 }}>{fmtDate(r.date)}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name ?? "Lauf"}</span>
                <span className="muted nowrap">NP {r.runNp ?? "—"} W</span>
                <span className="nowrap" style={{ fontWeight: 600 }}>RSS {r.rss ?? "—"}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
