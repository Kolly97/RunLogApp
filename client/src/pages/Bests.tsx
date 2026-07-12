// Bestleistungen + VDOT-Prognose (v0.14.0, ToDo 8): PBs je Standarddistanz aus Stravas best_efforts,
// dazu eine VO2max/VDOT-Schätzung (Jack Daniels) + leistungs-äquivalente Renn-Prognosen.
import { useEffect, useState } from "react";
import {
  LineChart, Line, Legend, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { TOOLTIP_STYLE } from "../lib/chartTheme.ts";
import { api, type BestsResult, type FitnessTrend, type Pb } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import { paceStr, secToClock, clockToSec, fmtDate, fmtDateY, todayIso } from "../lib/util.ts";
import T from "../components/T.tsx";
import { useT } from "../lib/i18n.tsx";
import PowerCard from "../charts/PowerCard.tsx";
import EditableGrid, { EgItem } from "../components/EditableGrid.tsx";

const PRED_LINES = [
  { key: "p5000", label: "5 km", color: "#0ea5e9", dist: 5000 },
  { key: "p10000", label: "10 km", color: "#22c55e", dist: 10000 },
  { key: "p21097", label: "Halbmarathon", color: "#eab308", dist: 21097 },
  { key: "p42195", label: "Marathon", color: "#ef4444", dist: 42195 },
] as const;

const DIST_NAMES: Record<number, string> = {
  400: "400 m", 805: "½ Meile", 1000: "1 km", 1609: "1 Meile", 3219: "2 Meilen",
  5000: "5 km", 10000: "10 km", 15000: "15 km", 16093: "10 Meilen", 20000: "20 km",
  21097: "Halbmarathon", 42195: "Marathon",
};
function distLabel(m: number): string {
  return DIST_NAMES[m] || (m >= 1000 ? `${Math.round(m / 100) / 10} km` : `${m} m`);
}
// C1 (Q4): erwartete Zeit prominent + Bereich Bestfall–Realistisch als gedämpfte Unterzeile.
function PredCell({ time_s, best_s, realistic_s }: { time_s: number; best_s: number; realistic_s: number }) {
  return (
    <span>{secToClock(time_s)}
      <span className="tiny muted" style={{ display: "block" }}>{secToClock(best_s)}–{secToClock(realistic_s)}</span>
    </span>
  );
}

type EditState = { distance_m: number; timeStr: string; date: string } | null;
type NewState = { distance_m: string; timeStr: string; date: string } | null;

export default function Bests() {
  const { season } = useSeason();
  const [data, setData] = useState<BestsResult | null>(null);
  const [fit, setFit] = useState<FitnessTrend | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [ghost, setGhost] = useState(false); // M7 Easter Egg: Doppelklick → PB als Ghost-Benchmark im Prognose-Chart
  const [err, setErr] = useState(false);
  const [edit, setEdit] = useState<EditState>(null);
  const [newPb, setNewPb] = useState<NewState>(null);
  const [saving, setSaving] = useState(false);
  const t = useT();
  const reload = () => api.bests().then(setData).catch(() => setErr(true));
  useEffect(() => { reload(); }, []);
  useEffect(() => {
    const from = season.length ? season[0].start_date : undefined;
    api.fitnessTrend(from, todayIso()).then(setFit).catch(() => setFit(null));
  }, [season]);
  const toggleLine = (key: string) =>
    setHidden((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const saveEdit = async () => {
    if (!edit) return;
    const t = clockToSec(edit.timeStr);
    if (!t || t <= 0 || !edit.date) return;
    setSaving(true);
    await api.setBestOverride(edit.distance_m, t, edit.date).catch(() => null);
    setSaving(false);
    setEdit(null);
    reload();
  };
  const deleteOverride = async (p: Pb) => {
    await api.deleteBestOverride(p.distance_m).catch(() => null);
    reload();
  };
  const saveNew = async () => {
    if (!newPb) return;
    const dist = Number(newPb.distance_m);
    const t = clockToSec(newPb.timeStr);
    if (!(dist > 0) || !t || t <= 0 || !newPb.date) return;
    setSaving(true);
    await api.setBestOverride(dist, t, newPb.date).catch(() => null);
    setSaving(false);
    setNewPb(null);
    reload();
  };

  if (err) return <div className="empty"><T k="bests.err">Bestleistungen konnten nicht geladen werden.</T></div>;
  if (!data) return <p className="muted"><T k="bests.loading">Lädt…</T></p>;

  const { pbs, vdot, vdotLevel, age, predictions, effVo2, predictionsEff } = data;
  const predByDist = new Map(predictions.map((p) => [p.distance_m, p]));
  const predEffByDist = new Map((predictionsEff ?? []).map((p) => [p.distance_m, p]));

  return (
    <div>
      <h1><T k="bests.title">Bestleistungen</T></h1>
      <p className="tiny muted" style={{ marginTop: -4 }}>
        <T k="bests.hint">Persönliche Bestleistungen je Standarddistanz aus den Strava-Daten und eine VDOT-Prognose (Jack Daniels) daraus. Die Liste füllt sich über die Strava-Syncs („Details/Splits nachziehen").</T>
      </p>

      {!pbs.length && (
        <div className="empty">
          <T k="bests.empty">Noch keine Bestleistungen. In den Einstellungen Strava verbinden und „Details/Splits nachziehen" ausführen — die Bestleistungen werden dann (budgetiert über mehrere Durchläufe) ergänzt.</T>
        </div>
      )}

      <EditableGrid page="bests">
        {pbs.length > 0 && <EgItem id="pb-table" title="Persönliche Bestleistungen" defaultSpan={6}>{() => (
          <div className="card">
            <div className="spread">
              <h2><T k="bests.pb.title">Persönliche Bestleistungen</T></h2>
              <button className="tiny" onClick={() => setNewPb({ distance_m: "", timeStr: "", date: todayIso() })}><T k="bests.pb.addManual">+ Manuell</T></button>
            </div>
            <table>
              <thead><tr><th><T k="bests.col.dist">Distanz</T></th><th><T k="bests.col.time">Zeit</T></th><th><T k="bests.col.pace">Ø-Pace</T></th><th><T k="bests.col.date">Datum</T></th><th /></tr></thead>
              <tbody>
                {pbs.map((p) => (
                  <tr key={p.distance_m}>
                    {edit?.distance_m === p.distance_m ? (
                      <>
                        <td><strong>{distLabel(p.distance_m)}</strong></td>
                        <td><input value={edit.timeStr} onChange={(e) => setEdit({ ...edit, timeStr: e.target.value })}
                          placeholder="z.B. 28:30" style={{ width: 80 }} /></td>
                        <td />
                        <td><input type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })}
                          style={{ width: 130 }} /></td>
                        <td className="nowrap">
                          <button onClick={saveEdit} disabled={saving}>✓</button>{" "}
                          <button onClick={() => setEdit(null)}>✕</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td><strong>{distLabel(p.distance_m)}</strong>{p.manual && <span className="tiny muted"> {t("bests.manual", "manuell")}</span>}</td>
                        <td>{secToClock(p.time_s)}</td>
                        <td className="muted">{paceStr(p.pace_s)}/km</td>
                        <td className="tiny muted nowrap">{fmtDateY(p.date)}</td>
                        <td className="nowrap">
                          <button className="tiny" onClick={() => setEdit({ distance_m: p.distance_m, timeStr: secToClock(p.time_s), date: p.date })}>✎</button>
                          {p.manual && <>{" "}<button className="tiny" onClick={() => deleteOverride(p)}>✕</button></>}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {newPb && (
                  <tr>
                    <td><input value={newPb.distance_m} onChange={(e) => setNewPb({ ...newPb, distance_m: e.target.value })}
                      placeholder="m (z.B. 5000)" style={{ width: 90 }} /></td>
                    <td><input value={newPb.timeStr} onChange={(e) => setNewPb({ ...newPb, timeStr: e.target.value })}
                      placeholder="z.B. 28:30" style={{ width: 80 }} /></td>
                    <td />
                    <td><input type="date" value={newPb.date} onChange={(e) => setNewPb({ ...newPb, date: e.target.value })}
                      style={{ width: 130 }} /></td>
                    <td className="nowrap">
                      <button onClick={saveNew} disabled={saving}>✓</button>{" "}
                      <button onClick={() => setNewPb(null)}>✕</button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}</EgItem>}
        {pbs.length > 0 && <EgItem id="vdot" title="VO₂max & Prognose" defaultSpan={6}>{() => (
          <div className="card">
            <h2><T k="bests.vdot.title">VO₂max & Prognose</T></h2>
            {vdot == null && !effVo2 && <p className="tiny muted"><T k="bests.vdot.empty">Zu wenige Renndaten (≥1500 m, 3–30 min) für eine VDOT-Schätzung — kommt mit mehr Syncs.</T></p>}
            {(vdot != null || effVo2) && (
              <>
                {/* C1 (#9, Q1): zwei getrennte Quellen — Renn-VDOT (Goldstandard) und labor-kalibrierte eff. VO2max. */}
                <div className="grid cols-2" style={{ gap: 8 }}>
                  <div className="stat">
                    <div className="label"><T k="bests.vdot.label">VDOT · Rennen ≤90 T.</T></div>
                    <div className="value" style={{ fontSize: 22 }}>{vdot != null ? vdot.toFixed(1) : "–"}<span className="tiny muted"> ml/kg/min</span></div>
                    {vdot != null && <div className="sub tiny muted">{vdotLevel ?? "–"}{age ? ` · ${age} J.` : ""}</div>}
                  </div>
                  <div className="stat">
                    <div className="label"><T k="bests.effvo2.label">eff. VO₂max</T>{effVo2?.calibrated ? " · labor-kal." : ""}</div>
                    <div className="value" style={{ fontSize: 22 }}>{effVo2 ? effVo2.value.toFixed(1) : "–"}<span className="tiny muted"> ml/kg/min</span></div>
                    {effVo2 && <div className="sub tiny muted"><T k="bests.effvo2.conf">Konfidenz</T> {effVo2.confidence}{effVo2.level ? ` · ${effVo2.level}` : ""}</div>}
                  </div>
                </div>
                <div className="tiny muted" style={{ marginTop: 8, marginBottom: 4 }}><T k="bests.vdot.model">Renn-Prognose (Daniels) · Bereich Bestfall–Realistisch</T></div>
                <table>
                  <thead><tr>
                    <th><T k="bests.cs.col.dist">Distanz</T></th>
                    {vdot != null && <th><T k="bests.col.race">Rennen</T></th>}
                    {effVo2 && <th><T k="bests.col.eff">eff. VO₂max</T></th>}
                    <th><T k="bests.cs.col.pb">PB</T></th>
                  </tr></thead>
                  <tbody>
                    {[5000, 10000, 21097, 42195].map((d) => {
                      const pr = predByDist.get(d);
                      const pe = predEffByDist.get(d);
                      const pb = pbs.find((p) => p.distance_m === d);
                      return (
                        <tr key={d}>
                          <td><strong>{distLabel(d)}</strong></td>
                          {vdot != null && <td>{pr ? <PredCell time_s={pr.time_s} best_s={pr.best_s} realistic_s={pr.realistic_s} /> : "–"}</td>}
                          {effVo2 && <td>{pe ? <PredCell time_s={pe.time_s} best_s={pe.best_s} realistic_s={pe.realistic_s} /> : "–"}</td>}
                          <td className="muted">{pb ? secToClock(pb.time_s) : "–"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}</EgItem>}
        {pbs.length > 0 && <EgItem id="prediction" title="Renn-Prognose im Verlauf" defaultSpan={12} defaultHeight={300}>{() => {
        const predPoints = (fit?.points ?? []).filter((p) => p.p5000 != null || p.p10000 != null || p.p21097 != null || p.p42195 != null);
        if (predPoints.length < 2) return <div className="card"><div className="spread"><h2><T k="bests.pred.title">Renn-Prognose im Verlauf</T></h2></div><p className="tiny muted">Noch kein Verlauf — kommt mit mehr Renndaten.</p></div>;
        // Y-Achse = Prognose-Pace (s/km) je Distanz → über die Strecken vergleichbar; die Zielzeit erscheint im Tooltip.
        const paceData = predPoints.map((p) => {
          const row: Record<string, number | string | null> = { date: p.date };
          for (const l of PRED_LINES) {
            const tsec = p[l.key] as number | null;
            row[l.key] = tsec != null ? tsec / (l.dist / 1000) : null;
          }
          return row;
        });
        return (
          <div className="card">
            <div className="spread">
              <h2><T k="bests.pred.title">Renn-Prognose im Verlauf</T></h2>
              <span className="tiny muted"><T k="bests.pred.sub">VDOT/Daniels, 90-Tage-Fenster — Pace je Distanz, schneller = oben · Legende klicken zum Aus-/Einblenden</T>{ghost ? " · Ghost-PB an (Doppelklick aus)" : ""}</span>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={paceData} margin={{ top: 8, right: 16, left: 4, bottom: 8 }} onDoubleClick={() => setGhost((g) => !g)}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={28} tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
                <YAxis reversed domain={["dataMin", "dataMax"]} width={52} tickFormatter={(s: number) => paceStr(s)}
                  tick={{ fontSize: 11, fill: "var(--chart-tick)" }} />
                <Tooltip
                  labelFormatter={(d) => fmtDateY(String(d))}
                  formatter={(v: number, n: string) => {
                    const l = PRED_LINES.find((x) => x.label === n);
                    const time = l ? Math.round(v * (l.dist / 1000)) : v;
                    return [`${secToClock(time)} · ${paceStr(v)}/km`, n];
                  }}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Legend wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
                  onClick={(e) => { if (e?.dataKey) toggleLine(String(e.dataKey)); }} />
                {PRED_LINES.map((l) => (
                  <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={l.color}
                    strokeWidth={1.8} connectNulls dot={false} hide={hidden.has(l.key)} />
                ))}
                {/* Ghost-PB: PB-Pace je Distanz als gedämpfte Benchmark — die Prognose-Linie „überholt" sie irgendwann. */}
                {ghost && PRED_LINES.map((l) => {
                  const pb = pbs.find((p) => p.distance_m === l.dist);
                  if (!pb || hidden.has(l.key)) return null;
                  return (
                    <ReferenceLine key={`g${l.key}`} y={pb.pace_s} ifOverflow="extendDomain" stroke={l.color} strokeOpacity={0.5} strokeDasharray="2 5" strokeWidth={1.2}
                      label={{ value: `👻 PB ${l.label}`, position: "insideBottomRight", fontSize: 9, fill: l.color }} />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      }}</EgItem>}
        <EgItem id="power" title="Lauf-Power" defaultSpan={12}>{() => <PowerCard />}</EgItem>
      </EditableGrid>
    </div>
  );
}

