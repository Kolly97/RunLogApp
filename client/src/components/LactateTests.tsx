// G3 (v1.3.0): Laktat-/Feldtest-Diagnostik — Eingabe, LT1/LT2-Ergebnis, Trend, Zonen-Vorschlag.
import { useEffect, useRef, useState } from "react";
import { api, type LactateTest, type LactateTestPoint, type LactateZoneProposal, type LactateAnalysis, type LactateThresholdPoint } from "../lib/api.ts";
import { todayIso } from "../lib/util.ts";
import T from "./T.tsx";
import { ResponsiveContainer, LineChart, ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";

function fmtPace(sec?: number | null): string {
  if (!sec) return "—";
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}/km`;
}

function mkRow(): LactateTestPoint {
  return { speed_kmh: null, pace_s: null, hr: null, lactate: 0 };
}

// Pace-Eingabe als mm:ss (z. B. „3:45") parsen; reine Sekunden bleiben erlaubt.
function parsePaceInput(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  if (s.includes(":")) { const [m, sec] = s.split(":"); const mm = Number(m), ss = Number(sec); return isFinite(mm) && isFinite(ss) ? mm * 60 + ss : null; }
  const n = Number(s); return isFinite(n) && n > 0 ? n : null;
}
function paceInputStr(sec?: number | null): string {
  if (!sec) return "";
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

const NUM_IN = { width: 84, padding: "7px 9px", fontSize: 14, textAlign: "right" as const };

function PointsTable({
  points, onChange,
}: {
  points: LactateTestPoint[];
  onChange: (pts: LactateTestPoint[]) => void;
}) {
  const upd = (i: number, key: keyof LactateTestPoint, val: string) => {
    const n = [...points];
    const num = val === "" ? null : Number(val);
    (n[i] as any)[key] = num;
    if (key === "speed_kmh" && num) n[i].pace_s = Math.round(3600 / num);
    onChange(n);
  };
  const updPace = (i: number, val: string) => {
    const n = [...points];
    const sec = parsePaceInput(val);
    n[i].pace_s = sec;
    if (sec) n[i].speed_kmh = Math.round(3600 / sec * 100) / 100;
    onChange(n);
  };
  const th = { textAlign: "right" as const, padding: "0 9px 4px", fontWeight: 600 };
  return (
    <table style={{ fontSize: 13, borderCollapse: "separate", borderSpacing: "0 6px", width: "100%", marginTop: 8 }}>
      <thead>
        <tr style={{ color: "var(--muted)", fontSize: 11 }}>
          <th style={{ textAlign: "left", paddingBottom: 4 }}>Stufe</th>
          <th style={th}>km/h</th><th style={th}>Pace (min:s/km)</th><th style={th}>HF (bpm)</th>
          <th style={th}>Laktat (mmol/l)</th><th style={th}>RPE (1–10)</th><th />
        </tr>
      </thead>
      <tbody>
        {points.map((p, i) => (
          <tr key={i}>
            <td style={{ color: "var(--muted)", paddingRight: 8, fontWeight: 600 }}>{i + 1}</td>
            <td style={{ padding: "0 4px" }}><input type="number" step="0.1" placeholder="km/h" style={NUM_IN}
              value={p.speed_kmh ?? ""} onChange={(e) => upd(i, "speed_kmh", e.target.value)} /></td>
            <td style={{ padding: "0 4px" }}><input type="text" inputMode="numeric" placeholder="mm:ss" style={NUM_IN}
              key={`pace-${i}-${p.pace_s ?? ""}`} defaultValue={paceInputStr(p.pace_s)} onBlur={(e) => updPace(i, e.target.value)} title="Pace als mm:ss, z. B. 3:45" /></td>
            <td style={{ padding: "0 4px" }}><input type="number" step="1" placeholder="bpm" style={NUM_IN}
              value={p.hr ?? ""} onChange={(e) => upd(i, "hr", e.target.value)} /></td>
            <td style={{ padding: "0 4px" }}><input type="number" step="0.1" placeholder="mmol" style={NUM_IN}
              value={p.lactate || ""} onChange={(e) => upd(i, "lactate", e.target.value)} /></td>
            <td style={{ padding: "0 4px" }}><input type="number" step="1" min="1" max="10" placeholder="1–10" style={{ ...NUM_IN, width: 64 }}
              value={p.rpe ?? ""} onChange={(e) => upd(i, "rpe", e.target.value)} /></td>
            <td>
              <button className="sm ghost danger" style={{ padding: "4px 8px", fontSize: 12 }}
                onClick={() => onChange(points.filter((_, j) => j !== i))}>✕</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TestEditor({
  test, onSaved, onCancel,
}: {
  test?: Partial<LactateTest & { points: LactateTestPoint[] }>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(test?.date || todayIso());
  const [sport, setSport] = useState(test?.sport || "Run");
  const [kind, setKind] = useState(test?.kind || "Labor");
  const [notes, setNotes] = useState(test?.notes || "");
  const [points, setPoints] = useState<LactateTestPoint[]>(test?.points?.length ? test.points : [mkRow(), mkRow(), mkRow()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    const valid = points.filter(p => p.lactate > 0 && (p.speed_kmh || p.pace_s));
    if (valid.length < 3) { setErr("Mindestens 3 Stufen mit Laktat + Geschwindigkeit."); return; }
    setBusy(true); setErr("");
    try {
      if (test?.id) await api.updateLactateTest(test.id, { date, sport, kind, notes, points: valid });
      else await api.addLactateTest({ date, sport, kind, notes, points: valid });
      onSaved();
    } catch (e: any) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="card tight" style={{ background: "#fafbfd", marginTop: 8 }}>
      <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
        <label className="field" style={{ margin: 0, width: 150 }}><span><T k="lactate.field.date">Datum</T></span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className="field" style={{ margin: 0, width: 90 }}><span><T k="lactate.field.sport">Sport</T></span>
          <select value={sport} onChange={e => setSport(e.target.value)}>
            <option value="Run">Lauf</option><option value="Bike">Rad</option>
          </select></label>
        <label className="field" style={{ margin: 0, width: 120 }}><span><T k="lactate.field.kind">Art</T></span>
          <select value={kind} onChange={e => setKind(e.target.value)}>
            <option value="Labor">Labor</option><option value="Feldtest">Feldtest</option><option value="Stufentest">Stufentest</option>
          </select></label>
        <label className="field" style={{ margin: 0, flex: 1, minWidth: 140 }}><span><T k="lactate.field.notes">Notizen</T></span>
          <input value={notes} onChange={e => setNotes(e.target.value)} /></label>
      </div>
      <PointsTable points={points} onChange={setPoints} />
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <button className="sm" onClick={() => setPoints([...points, mkRow()])}><T k="lactate.btn.addRow">+ Stufe</T></button>
        <button onClick={save} disabled={busy}><T k="lactate.btn.save">Speichern & berechnen</T></button>
        <button className="sm ghost" onClick={onCancel}><T k="btn.cancel">Abbrechen</T></button>
        {err && <span style={{ color: "var(--danger)", fontSize: 12 }}>{err}</span>}
      </div>
    </div>
  );
}

function ZoneProposalPanel({ testId, onApply }: { testId: number; onApply: () => void }) {
  const [proposal, setProposal] = useState<LactateZoneProposal | null>(null);
  const [maxHr, setMaxHr] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    setBusy(true); setMsg("");
    try { setProposal(await api.proposeLactateZoneset(testId, maxHr ? Number(maxHr) : undefined)); }
    catch (e: any) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!proposal) return;
    setBusy(true); setMsg("");
    try {
      await api.addZoneset({
        valid_from: proposal.valid_from, lthr: proposal.lthr,
        threshold_pace: proposal.threshold_pace ?? undefined,
        lt1_hr: proposal.lt1_hr, lt1_pace: proposal.lt1_pace ?? undefined,
        hr_zones: proposal.hr_zones, pace_zones: proposal.pace_zones,
        source: proposal.source, note: proposal.note,
      } as any);
      setMsg("Zonen-Set übernommen.");
      onApply();
    } catch (e: any) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: "2px solid var(--border)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label className="field" style={{ margin: 0, width: 100 }}><span style={{ fontSize: 11 }}>Max-HF (opt.)</span>
          <input type="number" step="1" value={maxHr} onChange={e => setMaxHr(e.target.value)} style={{ width: 60 }} /></label>
        <button className="sm" onClick={load} disabled={busy}><T k="lactate.btn.propose">Zonen-Set vorschlagen</T></button>
      </div>
      {proposal && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div className="flag info" style={{ padding: "4px 8px", marginBottom: 6 }}>
            <span>Vorschlag: LTHR {proposal.lthr} bpm · Schwellen-Pace {fmtPace(proposal.threshold_pace)} · LT1 {proposal.lt1_hr} bpm / {fmtPace(proposal.lt1_pace)}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={apply} disabled={busy}><T k="lactate.btn.applyZones">Als Zonen-Set übernehmen</T></button>
            <span style={{ color: "var(--muted)", fontSize: 11 }}>Gültig ab {proposal.valid_from} — danach unter „HF-Zonen & Schwellen" feinjustieren.</span>
          </div>
        </div>
      )}
      {msg && <p style={{ fontSize: 12, color: msg.startsWith("Zonen") ? "var(--ok)" : "var(--danger)", marginTop: 4 }}>{msg}</p>}
    </div>
  );
}

function TrendChart({ tests }: { tests: LactateTest[] }) {
  if (tests.length < 2) return null;
  const data = [...tests].reverse().map(t => ({
    date: t.date.slice(5),
    lt1_hr: t.lt1_hr ?? null, lt2_hr: t.lt2_hr ?? null,
    lt1_pace: t.lt1_pace ? Math.round(t.lt1_pace) : null,
    lt2_pace: t.lt2_pace ? Math.round(t.lt2_pace) : null,
  }));
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 4 }}>Schwellen-Trend (HF)</div>
      <ResponsiveContainer width="100%" height={110}>
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} width={28} />
          <Tooltip formatter={(v: any, name: string) => [`${v} bpm`, name === "lt1_hr" ? "LT1" : "LT2"]} />
          <Line dataKey="lt1_hr" stroke="var(--ok-color, #22c55e)" dot strokeWidth={2} name="LT1" />
          <Line dataKey="lt2_hr" stroke="var(--warn-color, #eab308)" dot strokeWidth={2} name="LT2" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function fmtPaceShort(sec?: number | null): string {
  if (!sec) return "—";
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

// Volle Laktat-Auswertung (v1.10.0): Kurve + Schwellen (LT1/LT2/2/4 mmol/FatMax) + Fit-Güte + Trainingsempfehlungen.
function LactateAnalysisPanel({ a, points }: { a: LactateAnalysis; points: LactateTestPoint[] }) {
  const raw = points.filter((p) => p.speed_kmh != null && p.lactate != null).map((p) => ({ speed_kmh: p.speed_kmh!, lactate: p.lactate }));
  const rows = ([
    a.fatmax && { k: "FatMax", p: a.fatmax, sub: "geschätzt" },
    a.lt1 && { k: "LT1 · aerob", p: a.lt1 },
    a.fixed2 && { k: "2 mmol/l", p: a.fixed2 },
    a.lt2 && { k: "LT2 · Schwelle", p: a.lt2 },
    a.fixed4 && { k: "4 mmol/l · OBLA", p: a.fixed4 },
  ].filter(Boolean) as { k: string; p: LactateThresholdPoint; sub?: string }[]).sort((x, y) => x.p.speed_kmh - y.p.speed_kmh);
  const confCol = a.confidence === "hoch" ? "var(--ok)" : a.confidence === "mittel" ? "var(--warn)" : "var(--danger)";
  const recs: { zone: string; pace: string; hr: string }[] = [];
  if (a.lt1) recs.push({ zone: "Easy / Grundlage", pace: `langsamer als ${fmtPaceShort(a.lt1.pace_s)}`, hr: a.lt1.hr ? `< ${a.lt1.hr} bpm` : "—" });
  if (a.lt1 && a.lt2) recs.push({ zone: "Tempo (LT1–LT2)", pace: `${fmtPaceShort(a.lt2.pace_s)}–${fmtPaceShort(a.lt1.pace_s)}`, hr: a.lt1.hr && a.lt2.hr ? `${a.lt1.hr}–${a.lt2.hr} bpm` : "—" });
  if (a.lt2) recs.push({ zone: "Schwelle (LT2)", pace: `~ ${fmtPaceShort(a.lt2.pace_s)}`, hr: a.lt2.hr ? `~ ${a.lt2.hr} bpm` : "—" });
  if (a.lt2) recs.push({ zone: "VO2max", pace: `schneller als ${fmtPaceShort(a.lt2.pace_s - 15)}`, hr: a.lt2.hr ? `> ${a.lt2.hr} bpm` : "—" });

  return (
    <div style={{ marginTop: 8 }}>
      <ResponsiveContainer width="100%" height={210}>
        <ComposedChart margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
          <XAxis type="number" dataKey="speed_kmh" domain={["dataMin - 0.3", "dataMax + 0.3"]} unit=" km/h" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={30} />
          <Tooltip formatter={(v: number, n: string) => [n === "Laktat" ? `${v} mmol/l` : v, n]} labelFormatter={(v) => `${v} km/h`} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Line data={a.curve} dataKey="lactate" name="Fit" stroke="#2b6cb0" strokeWidth={1.8} dot={false} isAnimationActive={false} />
          <Scatter data={raw} dataKey="lactate" name="Laktat" fill="#2b6cb0" />
          {a.lt1 && <ReferenceLine x={a.lt1.speed_kmh} stroke="#22c55e" strokeWidth={1.5} label={{ value: "LT1", fontSize: 10, fill: "#22c55e", position: "top" }} />}
          {a.lt2 && <ReferenceLine x={a.lt2.speed_kmh} stroke="#eab308" strokeWidth={1.5} label={{ value: "LT2", fontSize: 10, fill: "#eab308", position: "top" }} />}
          {a.fatmax && <ReferenceLine x={a.fatmax.speed_kmh} stroke="#0891b2" strokeDasharray="3 3" label={{ value: "FatMax", fontSize: 9, fill: "#0891b2", position: "insideTopLeft" }} />}
        </ComposedChart>
      </ResponsiveContainer>

      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 6 }}>
        <thead><tr style={{ color: "var(--muted)", textAlign: "right" }}>
          <th style={{ textAlign: "left" }}>Marker</th><th>km/h</th><th>Pace</th><th>HF</th><th>Laktat</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} style={{ borderTop: "1px solid var(--border-faint,#eee)" }}>
              <td style={{ fontWeight: 600 }}>{r.k} {r.sub && <span className="tiny muted" style={{ fontWeight: 400 }}>({r.sub})</span>}</td>
              <td style={{ textAlign: "right" }}>{r.p.speed_kmh.toFixed(1)}</td>
              <td style={{ textAlign: "right" }}>{fmtPaceShort(r.p.pace_s)}/km</td>
              <td style={{ textAlign: "right" }}>{r.p.hr ?? "—"}</td>
              <td style={{ textAlign: "right" }}>{r.p.lactate.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tiny muted" style={{ marginTop: 4 }}>Fit-Güte R² {a.r2 != null ? a.r2.toFixed(3) : "—"} · Konfidenz <span style={{ color: confCol, fontWeight: 600 }}>{a.confidence}</span> · Methode {a.method}</div>

      {recs.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 3 }}>Trainingsempfehlungen aus dem Test</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 6 }}>
            {recs.map((r) => (
              <div key={r.zone} style={{ border: "1px solid var(--border,#e3e8ef)", borderRadius: 8, padding: "5px 8px" }}>
                <div style={{ fontWeight: 600, fontSize: 12 }}>{r.zone}</div>
                <div className="tiny">{r.pace}/km · {r.hr}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LactateTests() {
  const [tests, setTests] = useState<LactateTest[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [fullTest, setFullTest] = useState<(LactateTest & { points: LactateTestPoint[] }) | null>(null);
  const [proposing, setProposing] = useState<number | null>(null);
  const loadedRef = useRef(false);

  async function load() {
    const ts = await api.lactateTests();
    setTests(ts);
    loadedRef.current = true;
  }

  useEffect(() => { load(); }, []);

  async function expand(id: number) {
    if (expanded === id) { setExpanded(null); setFullTest(null); return; }
    const t = await api.lactateTest(id);
    setFullTest(t as any);
    setExpanded(id);
  }

  async function del(id: number, date: string) {
    if (!window.confirm(`Test vom ${date} löschen?`)) return;
    await api.deleteLactateTest(id);
    setExpanded(null); setFullTest(null);
    load();
  }

  return (
    <div className="card">
      <div className="spread">
        <h2><T k="lactate.title">Laktat-/Feldtest-Diagnostik</T></h2>
        {editing !== "new" && (
          <button className="sm" onClick={() => { setEditing("new"); setExpanded(null); }}>
            <T k="lactate.btn.new">+ Neuer Test</T>
          </button>
        )}
      </div>
      <p className="tiny muted"><T k="lactate.hint">LT1 (aerobe Schwelle) &amp; LT2 (modifizierter Dmax) aus Stufentest — Zonen-Vorschlag als Vorschlag-Modus, du bestätigst.</T></p>

      {editing === "new" && (
        <TestEditor onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
      )}

      {tests.length === 0 && !editing && (
        <p className="tiny muted" style={{ marginTop: 8 }}>Noch kein Test. Füge deinen Stufentest ein.</p>
      )}

      <TrendChart tests={tests} />

      {tests.map(t => (
        <div key={t.id} style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <div className="spread">
            <div style={{ cursor: "pointer" }} onClick={() => expand(t.id)}>
              <span style={{ fontWeight: 500 }}>{t.date}</span>
              <span style={{ marginLeft: 8, color: "var(--muted)", fontSize: 12 }}>{t.sport} · {t.kind || "—"}</span>
              {t.lt1_hr && <span style={{ marginLeft: 10, fontSize: 12, color: "var(--ok-color, #22c55e)" }}>LT1 {t.lt1_hr} bpm / {fmtPace(t.lt1_pace)}</span>}
              {t.lt2_hr && <span style={{ marginLeft: 8, fontSize: 12, color: "var(--warn-color, #eab308)" }}>LT2 {t.lt2_hr} bpm / {fmtPace(t.lt2_pace)}</span>}
              {t.confidence && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--muted)" }}>{t.confidence}</span>}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button className="sm ghost" onClick={() => expand(t.id)}>{expanded === t.id ? "▲" : "▼"}</button>
              <button className="sm ghost" onClick={() => { setEditing(t.id); setExpanded(null); }}>✎</button>
              <button className="sm ghost danger" onClick={() => del(t.id, t.date)}>✕</button>
            </div>
          </div>

          {editing === t.id && (
            <TestEditor
              test={{ ...t, points: fullTest?.id === t.id ? fullTest.points : [] }}
              onSaved={() => { setEditing(null); load(); }}
              onCancel={() => setEditing(null)}
            />
          )}

          {expanded === t.id && fullTest && editing !== t.id && (
            <div style={{ marginTop: 6, fontSize: 12 }}>
              {t.warnings?.length > 0 && (
                <div className="flag warn" style={{ padding: "4px 8px", marginBottom: 6 }}>
                  {t.warnings.join(" · ")}
                </div>
              )}
              {fullTest.analysis && <LactateAnalysisPanel a={fullTest.analysis} points={fullTest.points} />}
              <div className="tiny muted" style={{ fontWeight: 600, margin: "10px 0 2px" }}>Gemessene Stufen</div>
              <table style={{ borderCollapse: "collapse", width: "100%", color: "var(--muted)" }}>
                <thead>
                  <tr><th style={{ textAlign: "left" }}>#</th><th>km/h</th><th>Pace</th><th>HF</th><th>Laktat</th><th>RPE</th></tr>
                </thead>
                <tbody>
                  {fullTest.points.map((p, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border-faint, #eee)" }}>
                      <td>{p.stage ?? i + 1}</td>
                      <td style={{ textAlign: "right" }}>{p.speed_kmh?.toFixed(1) ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{fmtPace(p.pace_s)}</td>
                      <td style={{ textAlign: "right" }}>{p.hr ?? "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 500 }}>{p.lactate}</td>
                      <td style={{ textAlign: "right" }}>{p.rpe ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 8 }}>
                <button className="sm ghost" onClick={() => setProposing(proposing === t.id ? null : t.id)}>
                  <T k="lactate.btn.proposeToggle">{proposing === t.id ? "▲ Zonen-Vorschlag schließen" : "▼ Als Zonen-Set vorschlagen"}</T>
                </button>
              </div>
              {proposing === t.id && <ZoneProposalPanel testId={t.id} onApply={load} />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
