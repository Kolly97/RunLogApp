import { useEffect, useState } from "react";
import { api, type PlannedSession, type SessionTemplate, type AnalyzeResult, type Race } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import {
  DAY_NAMES, daysOfWeek, fmtDate, todayIso, typeColor, typeLabel, sportLabel, num,
} from "../lib/util.ts";
import { useOptions, phaseColor, phaseLabel } from "../lib/options.ts";
import ZoneDistribution from "../charts/ZoneDistribution.tsx";
import IntensityCard from "../charts/IntensityCard.tsx";
import WeekSelector from "../components/WeekSelector.tsx";
import SessionModal from "../components/SessionModal.tsx";
import TemplateManager from "../components/TemplateManager.tsx";

export default function WeekPlan() {
  const { season, week, weekNo, setWeekNo, loading, reload: reloadSeason } = useSeason();
  const { phases } = useOptions();
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [analyze, setAnalyze] = useState<AnalyzeResult | null>(null);
  const [editing, setEditing] = useState<PlannedSession | null>(null);
  const [editingPhase, setEditingPhase] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Vorlagen-Schnellauswahl je Tag + Verwalten-Modal.
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [openTplDay, setOpenTplDay] = useState<string | null>(null);
  const [showManager, setShowManager] = useState(false);

  async function reload() {
    if (weekNo == null) return;
    const s = await api.sessions({ week: weekNo });
    setSessions(s);
    setAnalyze(await api.analyzeWeek(weekNo));
  }
  const reloadTemplates = () => api.templates().then(setTemplates).catch(() => setTemplates([]));
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [weekNo]);
  useEffect(() => { reloadTemplates(); }, []);
  // Schnellauswahl-Dropdown bei Klick außerhalb schließen.
  useEffect(() => {
    if (!openTplDay) return;
    const close = () => setOpenTplDay(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openTplDay]);

  if (loading) return <p className="muted">Lädt…</p>;
  if (!season.length)
    return <div className="empty">Noch kein Saisonplan. Lege unter <a href="/settings">Einstellungen</a> einen an oder importiere den bestehenden Plan.</div>;
  if (!week) return <p className="muted">Keine Woche gewählt.</p>;

  const days = daysOfWeek(week.start_date);
  const byDate = (d: string) => sessions.filter((s) => s.date === d).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const today = todayIso();

  async function save(s: PlannedSession) {
    if (s.id) await api.updateSession(s.id, s);
    else await api.addSession({ ...s, week_no: weekNo });
    if (s.type === "Race") {
      const name = s.description || "Wettkampf";
      const existing = await api.races({ from: s.date, to: s.date });
      if (!existing.some((r) => r.date === s.date && r.name === name)) {
        await api.addRace({ date: s.date, name, source: "plan" } as Race);
      }
    }
    setEditing(null);
    reload();
  }
  async function remove(id?: number) {
    if (id) { await api.deleteSession(id); reload(); }
  }
  async function moveSession(id: number, toDate: string) {
    const s = sessions.find((x) => x.id === id);
    if (!s || s.date === toDate) return;
    await api.updateSession(id, { ...s, date: toDate });
    reload();
  }
  async function copySession(s: PlannedSession) {
    const { id: _id, ...rest } = s;
    await api.addSession({ ...rest, week_no: weekNo });
    reload();
  }
  // Vorlage per Klick direkt in einen Tag einsetzen (kein Dialog). TSS wird serverseitig neu berechnet.
  async function quickAdd(t: SessionTemplate, date: string) {
    setOpenTplDay(null);
    await api.addSession({
      date, week_no: weekNo, sport: t.sport, type: t.type,
      planned_km: t.planned_km ?? null, planned_min: t.planned_min ?? null,
      zone_alloc: t.zone_alloc ?? null, description: t.description ?? "", efforts: t.efforts ?? null,
    });
    if (t.type === "Race") {
      const name = t.description || "Wettkampf";
      const existing = await api.races({ from: date, to: date });
      if (!existing.some((r) => r.date === date && r.name === name)) {
        await api.addRace({ date, name, source: "plan" } as Race);
      }
    }
    reload();
  }
  // Ziel-km direkt in der Wochenplanung pflegen (v0.14.0, ToDo 3) — gleiche Quelle wie der Saisonplan.
  async function saveTargetKm(v: number | null) {
    if (!week) return;
    await api.saveWeek(week.week_no, { ...week, target_km: v });
    await reloadSeason();
    reload();
  }
  async function savePhase(v: string) {
    if (!week) return;
    setEditingPhase(false);
    await api.saveWeek(week.week_no, { ...week, phase: v });
    await reloadSeason();
    reload();
  }

  const t = analyze?.totals;
  const target = week.target_km ?? 0;
  const volPct = target ? Math.round(((t?.km ?? 0) - target) / target * 100) : 0;

  return (
    <div>
      <div className="spread no-print">
        <h1>Wochenplanung</h1>
        <WeekSelector season={season} weekNo={weekNo} setWeekNo={setWeekNo} />
      </div>

      <div className="card tight">
        <div className="spread">
          <div className="row">
            {editingPhase ? (
              <select autoFocus style={{ fontSize: 12, padding: "2px 6px", borderRadius: 999 }}
                value={week.phase ?? ""}
                onChange={(e) => savePhase(e.target.value)}
                onBlur={() => setEditingPhase(false)}>
                <option value="">— Kein Typ —</option>
                {phases.map((p) => <option key={p.value} value={p.value}>{phaseLabel(p.value)}</option>)}
              </select>
            ) : (
              <span className="pill" title="Klicken zum Bearbeiten" style={{ cursor: "pointer", background: week.phase ? phaseColor(week.phase) : "#eef2f7", color: week.phase ? "#fff" : "#3a475a" }}
                onClick={() => setEditingPhase(true)}>
                {week.phase ? phaseLabel(week.phase) : "—"}
              </span>
            )}
            <strong>Woche {week.week_no}</strong>
            <span className="muted">{fmtDate(week.start_date)}–{fmtDate(week.end_date)}</span>
            {week.goal_race && <span className="muted">· Ziel: {week.goal_race}</span>}
            {analyze?.tssRec && (() => {
              const r = analyze.tssRec;
              const col = r.level === "ok" ? "var(--ok)" : r.level === "over" ? "var(--warn)" : "#3b82f6";
              const hint = r.level === "ok" ? "im Zielkorridor" : r.level === "over" ? "über Empfehlung" : "unter Empfehlung";
              return (
                <span className="pill" style={{ background: col, color: "#fff" }}
                  title={`Empfohlener Wochen-TSS-Korridor (${r.basis}) — geplant: ${Math.round(t?.tss ?? 0)} TSS · ${hint}. 3:1-Prinzip über die Saisonplan-Phase.`}>
                  Empf. {r.min}–{r.max} TSS · {r.phaseLabel}
                </span>
              );
            })()}
          </div>
          <label className="row tiny muted" style={{ gap: 6, width: "auto", margin: 0 }}>
            <span>Ziel km</span>
            <input type="number" min="0" style={{ width: 72, padding: "4px 6px" }}
              key={`tgt-${week.week_no}-${week.target_km ?? ""}`} defaultValue={week.target_km ?? ""}
              onBlur={(e) => saveTargetKm(num(e.target.value))} title="Wochen-Ziel-km (wirkt auf den Volumen-Check; gleiche Quelle wie im Saisonplan)" />
          </label>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", alignItems: "start" }}>
        {/* Tage */}
        <div>
          {days.map((d, i) => {
            const list = byDate(d);
            const isDrop = dropTarget === d;
            return (
              <div key={d} className={"day" + (d === today ? " today" : "")}
                onDragOver={(e) => { e.preventDefault(); setDropTarget(d); }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => { e.preventDefault(); if (dragId != null) moveSession(dragId, d); setDragId(null); setDropTarget(null); }}
                style={isDrop ? { outline: "2px dashed var(--primary)", outlineOffset: -2 } : undefined}>
                <div className="day-head">
                  <span><span className="day-name">{DAY_NAMES[i]}</span> <span className="muted tiny">{fmtDate(d)}</span></span>
                  <div className="row" style={{ gap: 2, width: "auto", position: "relative" }}>
                    <button className="sm ghost" onClick={() => setEditing({ date: d, sport: "Run", type: "Easy" })}>+ Einheit</button>
                    <button className="sm ghost" title="Aus Vorlage einsetzen" style={{ padding: "2px 6px" }}
                      onClick={(e) => { e.stopPropagation(); setOpenTplDay(openTplDay === d ? null : d); }}>▾</button>
                    {openTplDay === d && (
                      <div className="tpl-menu" onClick={(e) => e.stopPropagation()}>
                        {!templates.length && <div className="tiny muted" style={{ padding: "6px 10px" }}>Noch keine Vorlagen.</div>}
                        {templates.map((t) => (
                          <button key={t.id} className="tpl-item" onClick={() => quickAdd(t, d)}>
                            <span style={{ width: 8, height: 8, borderRadius: 999, background: typeColor(t.type), flexShrink: 0 }} />
                            <span style={{ flex: 1, textAlign: "left" }}>{t.name}</span>
                            <span className="tiny muted">{t.planned_km ? `${t.planned_km} km` : t.planned_min ? `${t.planned_min} min` : typeLabel(t.type)}</span>
                          </button>
                        ))}
                        <div className="tpl-sep" />
                        <button className="tpl-item" onClick={() => { setOpenTplDay(null); setShowManager(true); }}>✎ Verwalten…</button>
                      </div>
                    )}
                  </div>
                </div>
                {list.length === 0 && <div className="tiny muted" style={{ padding: "2px 4px" }}>—</div>}
                {list.map((s) => (
                  <div key={s.id} className="sess" draggable
                    onDragStart={(e) => { e.stopPropagation(); setDragId(s.id ?? null); }}
                    onDragEnd={() => { setDragId(null); setDropTarget(null); }}
                    onClick={() => setEditing(s)} style={{ cursor: "grab" }}>
                    <span className="type-pill" style={{ background: typeColor(s.type) }}>{typeLabel(s.type)}</span>
                    <span style={{ flex: 1, minWidth: 120 }}>{s.description || sportLabel(s.sport)}</span>
                    <span className="tiny muted nowrap">
                      {s.sport !== "Run" && sportLabel(s.sport) + " · "}
                      {s.planned_km ? s.planned_km + " km" : s.planned_min ? s.planned_min + " min" : ""}
                      {s.planned_tss ? ` · ${Math.round(s.planned_tss)} TSS` : ""}
                    </span>
                    <button className="sm ghost" title="Kopieren" onClick={(e) => { e.stopPropagation(); copySession(s); }}>⊕</button>
                    <button className="sm ghost danger" onClick={(e) => { e.stopPropagation(); remove(s.id); }}>✕</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* Analyse-Panel */}
        <div style={{ position: "sticky", top: 16 }}>
          <div className="card tight">
            <h3>Geplante Woche</h3>
            <div className="grid cols-3" style={{ gap: 8 }}>
              <Stat label="km (Lauf)" value={t ? t.km : 0} sub={target ? `Ziel ${target} · ${volPct > 0 ? "+" : ""}${volPct}%` : ""} color={Math.abs(volPct) > 10 ? "var(--warn)" : "var(--ok)"} />
              <Stat label="TSS" value={t ? Math.round(t.tss) : 0} />
              <Stat label="Einheiten" value={t ? t.sessions : 0} sub={`${t?.hardSessions ?? 0} hart`} />
            </div>
            <div className="row tiny muted" style={{ marginTop: 6 }}>
              <span>Rad {t?.bike_km ?? 0} km</span>·<span>längster Lauf {t?.longestKm ?? 0} km</span>
              {analyze?.projectedTsb != null && <>·<span>Form Ende: {analyze.projectedTsb}</span></>}
            </div>
          </div>

          {analyze && t && (
            <div className="card tight">
              <h3>Intensität & Zonen (geplant)</h3>
              <IntensityCard tss={analyze.tssIntensity ?? t.intensity} height={120} />
              <div className="tiny muted" style={{ marginTop: 8, marginBottom: 2 }}>km-Anteil je Zone</div>
              <ZoneDistribution zones={analyze.zones} rows={[{ name: "Geplant", values: analyze.plannedZoneKm ?? t.zoneMin }]} />
            </div>
          )}

          <div className="card tight">
            <h3>Check: passt die Woche?</h3>
            {!analyze?.flags.length && <p className="tiny muted">Keine Hinweise.</p>}
            {analyze?.flags.map((f, i) => (
              <div key={i} className={"flag " + f.level}><span className="dot" /><span>{f.message}</span></div>
            ))}
          </div>
        </div>
      </div>

      {editing && (
        <SessionModal session={editing} onClose={() => setEditing(null)} onSave={save} />
      )}
      {showManager && (
        <TemplateManager templates={templates} onClose={() => setShowManager(false)} onChange={reloadTemplates} />
      )}
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 22, color }}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
