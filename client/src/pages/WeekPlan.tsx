import { useEffect, useState } from "react";
import { api, type PlannedSession, type SessionTemplate, type AnalyzeResult, type Race, type WeekSuggestionResult, type BlockPlan, type BlockDay, type GoalGap } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import {
  DAY_NAMES, daysOfWeek, fmtDate, todayIso, typeColor, typeLabel, sportLabel, num, paceStr,
} from "../lib/util.ts";
import { useOptions, phaseColor, phaseLabel } from "../lib/options.ts";
import ZoneDistribution from "../charts/ZoneDistribution.tsx";
import IntensityCard from "../charts/IntensityCard.tsx";
import WeekSelector from "../components/WeekSelector.tsx";
import SessionModal from "../components/SessionModal.tsx";
import TemplateManager from "../components/TemplateManager.tsx";
import T from "../components/T.tsx";
import PageHelp from "../components/PageHelp.tsx";
import { useT, renderFlag } from "../lib/i18n.tsx";

export default function WeekPlan() {
  const { season, week, weekNo, setWeekNo, loading, reload: reloadSeason } = useSeason();
  const { phases } = useOptions();
  const tr = useT();
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
  // Engine: Wochen-Vorschlag + Block-Vorschau (v1.3.0 / v1.4.0)
  const [suggestion, setSuggestion] = useState<WeekSuggestionResult | null>(null);
  const [blockPlan, setBlockPlan] = useState<BlockPlan | null>(null);
  const [suggOpen, setSuggOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [suggBusy, setSuggBusy] = useState(false);
  const [suggMsg, setSuggMsg] = useState("");

  async function loadSuggestion() {
    if (weekNo == null || suggBusy) return;
    setSuggBusy(true); setSuggMsg(""); setBlockOpen(false);
    try {
      const [ws, bp] = await Promise.all([api.weekSuggestion(weekNo), api.blockSuggestion(weekNo)]);
      setSuggestion(ws);
      setBlockPlan(bp);
      setSuggOpen(true);
    }
    catch (e: any) { setSuggMsg(String(e)); }
    finally { setSuggBusy(false); }
  }

  async function applyDays(days: BlockDay[], wkNo: number, phase?: string | null) {
    for (const d of days) {
      await api.addSession({
        week_no: wkNo, date: d.date, sport: "Run", type: d.type,
        planned_min: d.planned_min, zone_alloc: d.zone_alloc,
        efforts: d.efforts ?? null, description: d.description,
        prescription: d.prescription ?? null, // v1.7.0: Intention für Live-Resolution mitschreiben
      });
    }
    if (phase) { await api.setWeekPhase(wkNo, phase).catch(() => {}); reloadSeason(); } // v1.7.0: Phase aus dem Block setzen
    reload();
    setSuggMsg(`${days.length} Einheiten angelegt.`);
  }

  // v1.7.0: alle abgeleiteten Phasen des Block-Vorschlags in den Saisonplan schreiben (ohne Einheiten anzulegen).
  async function applyPhases() {
    if (!blockPlan?.weeks.length) return;
    setSuggBusy(true);
    try {
      for (const bw of blockPlan.weeks) if (bw.phase) await api.setWeekPhase(bw.week_no, bw.phase);
      reloadSeason();
      setSuggMsg(`Phasen für ${blockPlan.weeks.length} Wochen übernommen.`);
    } finally { setSuggBusy(false); }
  }

  async function applySuggestion() {
    if (!week) return;
    const curWeek = blockPlan?.weeks.find((w) => w.week_no === week.week_no);
    if (curWeek?.days?.length) {
      setSuggOpen(false);
      await applyDays(curWeek.days, week.week_no, curWeek.phase);
      return;
    }
    // Fallback: abstrakte Verteilung (kein Block-Plan geladen)
    if (!suggestion) return;
    const rec = suggestion.recommendation;
    const ds = daysOfWeek(week.start_date);
    let di = 0;
    const toAdd: { date: string; type: string; tss: number }[] = [];
    for (const s of rec.sessions) {
      const tssEach = Math.round(rec.tssRange.target * (s.tssShare / 100) / s.count);
      for (let i = 0; i < s.count; i++) {
        toAdd.push({ date: ds[di % ds.length], type: s.type, tss: tssEach });
        di++;
      }
    }
    for (const item of toAdd)
      await api.addSession({ week_no: week.week_no, date: item.date, type: item.type, sport: "Run", planned_tss: item.tss });
    setSuggOpen(false); setSuggestion(null);
    reload();
    setSuggMsg(`${toAdd.length} Einheiten aus Vorschlag angelegt.`);
  }

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

  if (loading) return <p className="muted"><T k="plan.loading">Lädt…</T></p>;
  if (!season.length)
    return <div className="empty">Noch kein Saisonplan. Lege unter <a href="/settings">{tr("nav.settings", "Einstellungen")}</a> einen an oder importiere den bestehenden Plan.</div>;
  if (!week) return <p className="muted"><T k="plan.noWeek">Keine Woche gewählt.</T></p>;

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
        <h1><T k="plan.title">Wochenplanung</T></h1>
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
              const col = r.level === "ok" ? "var(--ok)" : r.level === "over" ? "var(--warn)" : "var(--info)";
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
            <span><T k="plan.targetKm">Ziel km</T></span>
            <input type="number" min="0" style={{ width: 72, padding: "4px 6px" }}
              key={`tgt-${week.week_no}-${week.target_km ?? ""}`} defaultValue={week.target_km ?? ""}
              onBlur={(e) => saveTargetKm(num(e.target.value))} title="Wochen-Ziel-km (wirkt auf den Volumen-Check; gleiche Quelle wie im Saisonplan)" />
          </label>
        </div>
      </div>

      {/* Soll/Ist-Abgleich zum Ziel-Rennen (v1.7.0) */}
      <GoalGapCard />

      {/* Engine: Wochen-Vorschlag + Block-Vorschau (v1.3.0/v1.4.0, Vorschlag-Modus) */}
      <div className="card tight no-print" style={{ marginBottom: 8 }}>
        <div className="spread">
          <div className="row" style={{ gap: 8 }}>
            <button className="sm ghost" onClick={loadSuggestion} disabled={suggBusy} title="Regelbasierter Wochen-Vorschlag mit konkreten Einheiten (Tag + Dauer + Pace)">
              {suggBusy ? "…" : "▶ Wochen-Vorschlag"}
            </button>
            {blockPlan && !blockOpen && (
              <button className="sm ghost" onClick={() => setBlockOpen(true)} title="Mesozyklus-Vorschau bis Renntag">
                Block-Vorschau ({blockPlan.weeks.length} Wo.)
              </button>
            )}
            {suggMsg && <span style={{ fontSize: 12, color: "var(--ok-color, #22c55e)" }}>{suggMsg}</span>}
          </div>
          {suggOpen && suggestion && <button className="sm ghost" onClick={() => setSuggOpen(false)}>▲ schließen</button>}
        </div>
        {suggOpen && suggestion && (() => {
          const rec = suggestion.recommendation;
          const confCol = rec.confidence === "hoch" ? "var(--ok)" : rec.confidence === "mittel" ? "var(--warn)" : "#888";
          const curWeekDays = blockPlan?.weeks.find((w) => w.week_no === weekNo)?.days ?? [];
          return (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14 }}>{rec.headline}</strong>
                <span style={{ fontSize: 11, color: confCol }}>Konfidenz: {rec.confidence}</span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{rec.periodizationModel === "block" ? "Block" : "Traditionell"} · {rec.distTarget.label}</span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>TSS-Ziel: {rec.tssRange.min}–{rec.tssRange.max} ({rec.tssRange.kind})</span>
              </div>

              {/* Konkrete Tageseinheiten (v1.4.0) */}
              {curWeekDays.length > 0 ? (
                <div style={{ marginTop: 8 }}>
                  <div className="tiny muted" style={{ marginBottom: 4 }}>Konkrete Einheiten (Tag · Dauer · Ziel-Pace / Struktur):</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {curWeekDays.map((d, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                        <span style={{ width: 22, color: "var(--muted)", flexShrink: 0 }}>{DAY_NAMES[d.weekdayIdx]}</span>
                        <span className="type-pill" style={{ background: typeColor(d.type), fontSize: 10, padding: "1px 6px" }}>{typeLabel(d.type)}</span>
                        <span style={{ flex: 1 }}>{d.description}</span>
                        <span className="tiny muted nowrap">{d.planned_min} min · {Math.round(d.planned_tss)} TSS{d.paceTarget ? ` · @${paceStr(d.paceTarget)}/km` : ""}</span>
                        {d.isSecond && <span className="tiny muted">(2.)</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {rec.sessions.map((s, i) => (
                    <span key={i} style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "var(--surface2, #f1f5f9)", border: "1px solid var(--border)" }}>
                      {s.count}× <strong>{s.type}</strong> ({s.tssShare}% TSS) — {s.hint}
                    </span>
                  ))}
                </div>
              )}

              <details style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                <summary style={{ cursor: "pointer" }}>Begründung ({rec.reasons.length})</summary>
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                  {rec.reasons.map((r, i) => <li key={i}>{r.text}</li>)}
                </ul>
              </details>
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={applySuggestion} title="Fügt die konkreten Einheiten (mit Dauer/Pace/Zonen) additiv in die Wochenplanung ein — nichts wird gelöscht.">
                  In Wochenplanung übernehmen
                </button>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>Additiv — bestehende Einheiten bleiben.</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Block-Vorschau (v1.4.0, A5) — Mesozyklus bis Renntag, selektive Übernahme je Woche */}
      {blockOpen && blockPlan && blockPlan.weeks.length > 0 && (
        <div className="card tight no-print" style={{ marginBottom: 8 }}>
          <div className="spread">
            <div className="row" style={{ gap: 8 }}>
              <strong style={{ fontSize: 13 }}>Block-Vorschau</strong>
              <span className="tiny muted">{blockPlan.weeks.length} Wochen{blockPlan.raceDate ? ` → Renntag ${blockPlan.raceDate}` : ""}</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="sm ghost" onClick={applyPhases} disabled={suggBusy} title="Schreibt die abgeleiteten Phasen aller Vorschau-Wochen in den Saisonplan (manuell gesetzte Phasen bleiben).">Phasen übernehmen</button>
              <button className="sm ghost" onClick={() => setBlockOpen(false)}>▲ schließen</button>
            </div>
          </div>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {blockPlan.weeks.map((bw) => {
              const confCol = bw.confidence === "hoch" ? "var(--ok)" : bw.confidence === "mittel" ? "var(--warn)" : "#888";
              const isCurrent = bw.week_no === weekNo;
              return (
                <details key={bw.week_no} open={isCurrent} style={{ borderLeft: `3px solid ${isCurrent ? "var(--primary, #3b82f6)" : "var(--border)"}`, paddingLeft: 8 }}>
                  <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 12, listStyle: "none" }}>
                    <strong>Wo. {bw.week_no}</strong>
                    <span className="muted">{bw.start_date}</span>
                    <span style={{ color: confCol }}>{bw.headline}</span>
                    <span className="tiny muted">{bw.tssActual} TSS · {bw.isDeload ? "Deload" : bw.phase ?? ""}</span>
                    <button className="sm ghost" style={{ marginLeft: "auto" }}
                      onClick={(e) => { e.preventDefault(); applyDays(bw.days, bw.week_no, bw.phase).then(() => setSuggMsg(`Woche ${bw.week_no}: ${bw.days.length} Einheiten angelegt.`)); }}>
                      Übernehmen
                    </button>
                  </summary>
                  <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                    {bw.days.map((d, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                        <span style={{ width: 22, color: "var(--muted)", flexShrink: 0 }}>{DAY_NAMES[d.weekdayIdx]}</span>
                        <span className="type-pill" style={{ background: typeColor(d.type), fontSize: 9, padding: "1px 5px" }}>{typeLabel(d.type)}</span>
                        <span style={{ flex: 1, color: "var(--text)" }}>{d.description}</span>
                        <span className="tiny muted nowrap">{d.planned_min}' · {Math.round(d.planned_tss)} TSS</span>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}

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
                    <button className="sm ghost" onClick={() => setEditing({ date: d, sport: "Run", type: "Easy" })}><T k="plan.btn.addSession">+ Einheit</T></button>
                    <button className="sm ghost" title="Aus Vorlage einsetzen" style={{ padding: "2px 6px" }}
                      onClick={(e) => { e.stopPropagation(); setOpenTplDay(openTplDay === d ? null : d); }}>▾</button>
                    {openTplDay === d && (
                      <div className="tpl-menu" onClick={(e) => e.stopPropagation()}>
                        {!templates.length && <div className="tiny muted" style={{ padding: "6px 10px" }}>{tr("plan.tplMenu.empty", "Noch keine Vorlagen.")}</div>}
                        {templates.map((t) => (
                          <button key={t.id} className="tpl-item" onClick={() => quickAdd(t, d)}>
                            <span style={{ width: 8, height: 8, borderRadius: 999, background: typeColor(t.type), flexShrink: 0 }} />
                            <span style={{ flex: 1, textAlign: "left" }}>{t.name}</span>
                            <span className="tiny muted">{t.planned_km ? `${t.planned_km} km` : t.planned_min ? `${t.planned_min} min` : typeLabel(t.type)}</span>
                          </button>
                        ))}
                        <div className="tpl-sep" />
                        <button className="tpl-item" onClick={() => { setOpenTplDay(null); setShowManager(true); }}><T k="plan.btn.manageTemplates">✎ Verwalten…</T></button>
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
            <h3><T k="plan.stat.planned">Geplante Woche</T></h3>
            <div className="grid cols-3" style={{ gap: 8 }}>
              <Stat label={tr("plan.stat.km", "km (Lauf)")} value={t ? t.km : 0} sub={target ? `Ziel ${target} · ${volPct > 0 ? "+" : ""}${volPct}%` : ""} color={Math.abs(volPct) > 10 ? "var(--warn)" : "var(--ok)"} />
              <Stat label={tr("plan.stat.tss", "TSS")} value={t ? Math.round(t.tss) : 0} />
              <Stat label={tr("plan.stat.sessions", "Einheiten")} value={t ? t.sessions : 0} sub={`${t?.hardSessions ?? 0} hart`} />
            </div>
            <div className="row tiny muted" style={{ marginTop: 6 }}>
              <span>{tr("plan.stat.bikeLabel", "Rad")} {t?.bike_km ?? 0} km</span>·<span>{tr("plan.stat.longestRun", "längster Lauf")} {t?.longestKm ?? 0} km</span>
              {analyze?.projectedTsb != null && <>·<span>Form Ende: {analyze.projectedTsb}</span></>}
            </div>
          </div>

          {analyze && t && (
            <div className="card tight">
              <h3><T k="plan.intensity.title">Intensität & Zonen (geplant)</T></h3>
              <IntensityCard tss={analyze.tssIntensity ?? t.intensity} height={120} />
              <div className="tiny muted" style={{ marginTop: 8, marginBottom: 2 }}><T k="plan.intensity.zoneKm">km-Anteil je Zone</T></div>
              <ZoneDistribution zones={analyze.zones} rows={[{ name: tr("report.tss.planned", "Geplant"), values: analyze.plannedZoneKm ?? t.zoneMin }]} />
            </div>
          )}

          <div className="card tight">
            <h3><T k="plan.check.title">Check: passt die Woche?</T></h3>
            {!analyze?.flags.length && <p className="tiny muted"><T k="plan.check.noflags">Keine Hinweise.</T></p>}
            {analyze?.flags.map((f, i) => (
              <div key={i} className={"flag " + f.level}><span className="dot" /><span>{renderFlag(f, tr)}</span></div>
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
      <PageHelp page="plan" />
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

/** Soll/Ist-Karte zum Ziel-Rennen (v1.7.0): Prognose vs. Wunsch-Zielzeit + nötige Progression + Machbarkeit. */
function GoalGapCard() {
  const [g, setG] = useState<GoalGap | null>(null);
  useEffect(() => { api.goalGap().then(setG).catch(() => setG(null)); }, []);
  if (!g || !g.race) return null;
  const fmtT = (s: number | null) => {
    if (s == null) return "—";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  };
  const km = Math.round((g.race.distance_m / 1000) * 10) / 10;
  const head = `🎯 Ziel: ${g.race.name || "Rennen"} · ${km} km · ${g.race.date} · noch ${g.weeks} Wochen`;
  if (!g.goalTimeS) return (
    <div className="card tight no-print" style={{ marginBottom: 8 }}>
      <div className="tiny muted">{head}</div>
      <div className="tiny">Prognose aktuell: <strong>{fmtT(g.predictedTimeS)}</strong> · keine Wunsch-Zielzeit gesetzt — in <a href="/races">Races</a> eintragen, dann passen sich die Paces der Progression an.</div>
    </div>
  );
  const gap = g.gapS ?? 0;
  const col = g.feasible ? "var(--ok)" : "var(--danger)";
  const gapTxt = gap <= 2 ? "im Ziel" : `${fmtT(gap)} über Ziel`;
  return (
    <div className="card tight no-print" style={{ marginBottom: 8, borderLeft: `4px solid ${col}` }}>
      <div className="tiny muted">{head}</div>
      <div className="row" style={{ gap: 14, flexWrap: "wrap", alignItems: "baseline", marginTop: 2 }}>
        <span>Prognose <strong>{fmtT(g.predictedTimeS)}</strong> → Wunsch <strong>{fmtT(g.goalTimeS)}</strong></span>
        <span className="tiny" style={{ color: col, fontWeight: 700 }}>{gapTxt}</span>
        {g.reqVdotPerWeek != null && g.reqVdotPerWeek > 0 && <span className="tiny muted">nötig: +{g.reqVdotPerWeek} VDOT/Woche</span>}
        <span className="pill" style={{ background: col, color: "#fff" }}>{g.feasible ? "machbar" : "sehr ambitioniert"}</span>
      </div>
      {!g.feasible && <div className="tiny muted" style={{ marginTop: 2 }}>Realistische Prognose-Endzeit bei gedeckelter Progression: <strong>{fmtT(g.projEndTimeS)}</strong>. Ziel ggf. anpassen oder Vorbereitungszeit verlängern.</div>}
    </div>
  );
}
