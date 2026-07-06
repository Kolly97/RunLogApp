// Coach-Modus (v1.10.0): die trainingsgestalterischen Werkzeuge an einem Ort — Wettkampf-Block bis Renntag,
// optimale Zonen, Verfügbarkeit & Einheiten-Vorlieben, eigene Einheiten. Der Wochen-Vorschlag bleibt in der
// Wochenplanung. Übernehmen schreibt additiv in die Wochenplanung/den Saisonplan.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type BlockPlan, type BlockDay, type TuneupProgress, type DistanceConcept } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import { DAY_NAMES, typeColor, typeLabel } from "../lib/util.ts";
import WeekSelector from "../components/WeekSelector.tsx";
import AvailabilityCard from "../components/AvailabilityCard.tsx";
import CustomWorkoutsCard from "../components/CustomWorkoutsCard.tsx";
import OptimalZonesCard from "../charts/OptimalZonesCard.tsx";
import BlockTimeline, { phaseColor } from "../charts/BlockTimeline.tsx";
import BanisterTaperCard from "../components/BanisterTaperCard.tsx";
import EmphasisSelector from "../components/EmphasisSelector.tsx";
import { blockReadiness } from "../lib/blockReadiness.ts";
import T from "../components/T.tsx";

// Baustein 2.1: KM & Kern-Einheit je Woche für die kompakte Wochen-Zeile (Timeline zeigt die Verteilung).
const weekKm = (days: BlockDay[]): number =>
  Math.round(days.reduce((a, d) => a + Object.values(d.zone_alloc?.byKm ?? {}).reduce((x, y) => x + (y || 0), 0), 0));
const keySession = (days: BlockDay[]): string | null => {
  const hard = days.filter((d) => !/easy|ga1|ga12|recovery|long|strength|core/i.test(d.type) && !d.isSecond);
  const pick = (hard.length ? hard : days).slice().sort((a, b) => b.planned_tss - a.planned_tss)[0];
  return pick ? typeLabel(pick.type) : null;
};

// Baustein 2.1: Wochenplan-Detail — clean & scannbar (farbige Typ-Kante · Pill · Beschreibung · min·TSS rechtsbündig).
function WeekPlanDetail({ days, reasons }: { days: BlockDay[]; reasons?: { code: string; text: string }[] }) {
  // Baustein A1/C1: transparente adaptive Anpassungen dieser Woche (Load-Ziel, km-Ceiling, Health-Cap).
  const notable = (reasons ?? []).filter((r) => ["load_target", "km_ceiling", "health_cap", "health_intensity", "ramp_high"].includes(r.code));
  return (
    <div style={{ marginTop: 6, borderTop: "1px solid var(--border-faint)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
      {notable.length > 0 && (
        <div className="tiny muted" style={{ marginBottom: 4, lineHeight: 1.45 }}>⚙ {notable.map((r) => r.text).join(" · ")}</div>
      )}
      {days.map((d, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "26px auto 1fr auto", alignItems: "center", columnGap: 10, padding: "4px 6px", borderLeft: `3px solid ${d.planned_tss > 0 ? typeColor(d.type) : "var(--border)"}`, borderRadius: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>{DAY_NAMES[d.weekdayIdx]}{d.isSecond ? "·2" : ""}</span>
          <span className="type-pill" style={{ background: typeColor(d.type), fontSize: 9, padding: "2px 7px", whiteSpace: "nowrap" }}>{typeLabel(d.type)}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.35 }}>{d.description}</div>
            {d.emphasisNote && <div className="tiny muted" style={{ fontSize: 10, lineHeight: 1.3, marginTop: 1 }}>{d.emphasisNote}</div>}
          </div>
          <span className="tiny muted nowrap" style={{ textAlign: "right" }}>{d.planned_min}' · {Math.round(d.planned_tss)} TSS</span>
        </div>
      ))}
    </div>
  );
}

const fmtT = (s?: number | null): string => {
  if (s == null) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
const fmtSigned = (s?: number | null): string => (s == null ? "—" : `${s < 0 ? "−" : "+"}${fmtT(Math.abs(s))}`);

/** Fortschritts-Check (v1.10.0): aus dem letzten Test-Wettkampf — Ergebnis vs. Erwartung + Hauptrennen-Prognose. */
function TuneupProgressCard() {
  const [tp, setTp] = useState<TuneupProgress | null>(null);
  useEffect(() => { api.tuneupProgress().then(setTp).catch(() => setTp(null)); }, []);
  if (!tp?.tuneup) return null;
  const tu = tp.tuneup, g = tp.goal;
  const km = Math.round(tu.distanceM / 100) / 10;
  const statusCol = g?.status === "ahead" ? "var(--ok)" : g?.status === "on_track" ? "var(--ok, #16a34a)" : g?.status === "behind" ? "var(--danger)" : "var(--muted)";
  const statusLabel: Record<string, string> = { ahead: "vor Plan ✓", on_track: "auf Kurs ✓", behind: "hinter Plan", unknown: "—" };
  return (
    <div className="card" style={{ marginBottom: 12, borderLeft: `4px solid ${statusCol}` }}>
      <div className="spread"><h2 style={{ margin: 0 }}>Fortschritts-Check</h2><span className="tiny muted">aus deinem Test-Wettkampf</span></div>
      <div className="tiny" style={{ marginTop: 6 }}>
        <strong>{tu.name || "Test-Wettkampf"}</strong> ({tu.date}) · {km} km in <strong>{fmtT(tu.timeS)}</strong> · VDOT {tu.vdot}
        {tu.vsExpectedS != null && <> · <span style={{ color: tu.vsExpectedS <= 0 ? "var(--ok)" : "var(--danger)", fontWeight: 600 }}>{fmtSigned(tu.vsExpectedS)} vs. Erwartung</span></>}
      </div>
      {g ? (
        <div className="tiny" style={{ marginTop: 4 }}>
          Hauptrennen-Prognose ({g.weeksTo} Wo. bis dahin): <strong>{fmtT(g.predictedTimeS)}</strong> vs. Ziel {fmtT(g.goalTimeS)} →{" "}
          <strong style={{ color: statusCol }}>{statusLabel[g.status]}</strong>
          {g.deltaS != null && g.deltaS !== 0 && <span className="muted"> ({fmtSigned(g.deltaS)})</span>}
        </div>
      ) : (
        <div className="tiny muted" style={{ marginTop: 4 }}>Kein Hauptrennen mit Wunsch-Zielzeit gesetzt — Prognose-Abgleich nicht möglich.</div>
      )}
    </div>
  );
}

// Item 3 (#7): „So trainierst du {Distanz}" — Stoffwechselwege + Schlüssel-Einheiten, klinisch & einklappbar.
function DistanceConceptBox({ c }: { c: DistanceConcept }) {
  return (
    <details className="card tight" style={{ marginBottom: 12 }} open>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>So trainierst du {c.label}</summary>
      <div className="tiny" style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
        <div><strong>Stoffwechsel:</strong> {c.metabolic}</div>
        <div><strong>Schlüssel-Einheiten:</strong> {c.keySessions.join(" · ")}</div>
        <div className="muted">{c.longRunNote}</div>
      </div>
    </details>
  );
}

// Coach ToDo 35: adaptives, faktenbasiertes Verdikt, das den Block-Plan steuert — was steuert + warum, ehrlich
// geschichtet (beobachtet vs. kausal geprüft), Health-Cap sichtbar, Auto/manuell-Schwerpunkt-Umschalter.
function CoachingBanner({ c, freshness, mode, onMode, busy }: { c: NonNullable<BlockPlan["coaching"]>; freshness?: string; mode: "auto" | "manual"; onMode: (m: "auto" | "manual") => void; busy: boolean }) {
  const navigate = useNavigate();
  const tierCol = (t: string) => (t === "geprüft" ? "var(--ok)" : "var(--accent, #0ea5e9)");
  const accent = c.healthCap.loadFactor < 1 ? "var(--danger)" : c.layer === "causal" ? "var(--ok)" : "var(--accent, #0ea5e9)";
  return (
    <div className="card" style={{ marginBottom: 12, borderLeft: `4px solid ${accent}` }}>
      <div className="spread">
        <h2 style={{ margin: 0 }}>Adaptives Coaching-Verdikt</h2>
        <span className="tiny muted">{c.layer === "causal" ? "kausal geprüft" : "beobachtet (Korrelation)"} · Konfidenz {c.overallConfidence}</span>
      </div>
      <p style={{ margin: "6px 0 4px", fontWeight: 600, lineHeight: 1.35 }}>{c.headline}</p>
      {c.healthCap.reason && <p className="tiny" style={{ color: "var(--danger)", margin: "2px 0", fontWeight: 600 }}>⚠ {c.healthCap.reason}</p>}
      <div className="tiny" style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
        {c.emphasis
          ? <div><span style={{ color: tierCol(c.emphasis.tier), fontWeight: 700 }}>Schwerpunkt: {c.emphasis.label}</span> <span className="muted">({c.emphasis.tier}) — {c.emphasis.rationale}</span></div>
          : <div className="muted">Schwerpunkt: sportwissenschaftlicher Standard — noch keine belastbare Evidenz{c.emphasisEffective ? ` (deine Wahl: ${c.emphasisEffective})` : ""}.</div>}
        {c.regime && <div><span style={{ color: tierCol(c.regime.tier), fontWeight: 700 }}>Verteilung: {c.regime.label}</span> <span className="muted">({c.regime.tier}) — {c.regime.rationale}</span></div>}
        {c.notes.map((n, i) => <div key={i} className="muted">· {n}</div>)}
      </div>
      <div className="row" style={{ gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="tiny muted">Schwerpunkt-Modus:</span>
        <button className={`sm ${mode === "auto" ? "" : "ghost"}`} disabled={busy} onClick={() => onMode("auto")} title="Evidenz gewinnt, wenn belastbar">Auto (Evidenz)</button>
        <button className={`sm ${mode === "manual" ? "" : "ghost"}`} disabled={busy} onClick={() => onMode("manual")} title="Deine Availability-Emphasis pinnen">manuell</button>
        {freshness === "stale" && <span className="tiny" style={{ color: "var(--warn)" }}>· Evidenz veraltet — in „Was hilft dir?" neu berechnen</span>}
        {freshness === "none" && <span className="tiny muted">· Evidenz noch nicht berechnet</span>}
        <button className="sm ghost" style={{ marginLeft: "auto" }} onClick={() => navigate("/methodik?tab=effects")} title="Die volle Beweislage über alle Modelle in der Methodik-Werkbank">→ Belege in Methodik</button>
      </div>
    </div>
  );
}

export default function Coach() {
  const { season, weekNo, setWeekNo, loading, reload: reloadSeason } = useSeason();
  const [blockPlan, setBlockPlan] = useState<BlockPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [emphasisMode, setEmphasisMode] = useState<"auto" | "manual">("auto");
  useEffect(() => { api.settings().then((s) => setEmphasisMode(s?.coach_emphasis_mode === "manual" ? "manual" : "auto")).catch(() => {}); }, []);
  const [tp, setTp] = useState<TuneupProgress | null>(null); // Ziel-Prognose für die Readiness-Kopplung (Baustein 2.2)
  useEffect(() => { api.tuneupProgress().then(setTp).catch(() => setTp(null)); }, []);
  const [selWeek, setSelWeek] = useState<number | null>(null); // vom Balkendiagramm gesteuertes Wochen-Akkordeon
  const selectWeek = (w: number) => {
    setSelWeek((cur) => (cur === w ? null : w));
    requestAnimationFrame(() => document.getElementById(`bw-${w}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  // Baustein 2.4 + Banister: Peak auf Renntag ausrichten. WENN das athleten-kalibrierte Banister-Modell eine
  // Taper-Länge liefert (peak_gain>0), TREIBT diese die Wahl — die renntag-genaue Tageszahl wird auf die nächste
  // Race-Specific-Wochenzahl gerundet (der Block ist wochen-granular), Tageszahl + Taper-Start-Datum werden
  // präzise gemeldet. Sonst Fallback auf die Heuristik (1–3 Wo, Form-Peak dem Renntag am nächsten). Nur Vorschau —
  // „Phasen übernehmen" schreibt es fest.
  const [aligning, setAligning] = useState(false);
  async function alignPeak() {
    if (weekNo == null || aligning) return;
    setAligning(true); setMsg("");
    try {
      // 1) Banister-getrieben, wenn belastbar. Distanz-typischer Taper-Floor (Server ist maßgeblich, hier nur fürs
      // Wording konsistent): ein Marathon tapert min. ~14 Tage, auch wenn die persönliche Analyse kürzer sagt.
      const dist = blockPlan?.goalDistanceM ?? 0;
      const floorDays = dist >= 30000 ? 14 : dist >= 15000 ? 10 : dist >= 7000 ? 7 : 5;
      const bt = (await api.mlBanister().catch(() => null))?.result ?? null;
      if (bt && bt.peak_gain > 0) {
        const taperDaysEff = Math.max(bt.taper_days, floorDays);
        const floored = taperDaysEff > bt.taper_days;
        const taperWk = Math.max(1, Math.min(3, Math.round(taperDaysEff / 7)));
        const p = await api.blockSuggestion(weekNo, taperWk, taperDaysEff).catch(() => null);
        if (p?.weeks?.length) {
          const { peakIdx, raceIdx } = blockReadiness(p.weeks, p.raceDate);
          const gap = raceIdx >= 0 ? Math.abs(raceIdx - peakIdx) : -1;
          const start = p.raceDate ? new Date(Date.parse(p.raceDate) - taperDaysEff * 86_400_000).toISOString().slice(0, 10) : null;
          const unsure = bt.peak_low <= 0 ? " (unsicher — mehr Rennen/Labor schärfen es)" : "";
          const floorNote = floored ? ` (distanz-typisches Minimum statt persönlicher ${bt.taper_days} Tage — sicherer bei wenig Renn-Erfahrung)` : "";
          setBlockPlan(p);
          setMsg(`🎯 Taper: ${taperDaysEff} Tage${floorNote}${unsure}${start ? ` · Last tages-genau ab ~${start}` : ""} heruntergefahren (Struktur: ${taperWk} Race-Specific-Woche(n))${gap >= 0 ? ` · Form-Peak ${gap === 0 ? "auf dem Renntag" : `${gap} Wo entfernt`}` : ""}. „Phasen übernehmen" schreibt es fest.`);
          return;
        }
      }
      // 2) Fallback-Heuristik (kein/kein belastbares Banister-Ergebnis).
      const cands = await Promise.all([1, 2, 3].map((t) => api.blockSuggestion(weekNo, t).catch(() => null)));
      let best: BlockPlan | null = null, bestGap = Infinity, bestTaper = 2;
      cands.forEach((p, i) => {
        const t = [1, 2, 3][i];
        if (!p?.weeks?.length) return;
        const { peakIdx, raceIdx } = blockReadiness(p.weeks, p.raceDate);
        if (raceIdx < 0) return;
        const gap = Math.abs(raceIdx - peakIdx);
        if (gap < bestGap || (gap === bestGap && Math.abs(t - 2) < Math.abs(bestTaper - 2))) { best = p; bestGap = gap; bestTaper = t; }
      });
      if (best) { setBlockPlan(best); setMsg(`🎯 Ausgerichtet (Heuristik): Taper ${bestTaper} Wo · Form-Peak ${bestGap === 0 ? "auf dem Renntag" : `${bestGap} Wo vom Renntag`}. Für datengetriebenes Taper das Banister-Modell berechnen. „Phasen übernehmen" schreibt es fest.`); }
      else setMsg("Keine Ausrichtung möglich (kein Renntag im Block).");
    } finally { setAligning(false); }
  }

  async function loadBlock() {
    if (weekNo == null || busy) return;
    setBusy(true); setMsg("");
    try { setBlockPlan(await api.blockSuggestion(weekNo)); }
    catch (e: any) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  async function changeEmphasisMode(m: "auto" | "manual") {
    setEmphasisMode(m);
    setBusy(true);
    try { await api.saveSettings({ coach_emphasis_mode: m }); }
    finally { setBusy(false); }
    await loadBlock(); // Plan mit neuem Modus neu ableiten
  }

  async function applyDays(days: BlockDay[], wkNo: number, phase?: string | null) {
    setBusy(true);
    try {
      for (const d of days) {
        await api.addSession({
          week_no: wkNo, date: d.date, sport: "Run", type: d.type,
          planned_min: d.planned_min, zone_alloc: d.zone_alloc,
          efforts: d.efforts ?? null, description: d.description, prescription: d.prescription ?? null,
        });
      }
      if (phase) { await api.setWeekPhase(wkNo, phase).catch(() => {}); reloadSeason(); }
      setMsg(`Woche ${wkNo}: ${days.length} Einheiten in die Wochenplanung übernommen.`);
    } finally { setBusy(false); }
  }

  async function applyPhases() {
    if (!blockPlan?.weeks.length) return;
    setBusy(true);
    try {
      for (const bw of blockPlan.weeks) if (bw.phase) await api.setWeekPhase(bw.week_no, bw.phase);
      reloadSeason();
      setMsg(`Phasen für ${blockPlan.weeks.length} Wochen in den Saisonplan übernommen.`);
    } finally { setBusy(false); }
  }

  if (loading) return <p className="muted">Lädt…</p>;
  if (!season.length) return <div className="empty">Noch kein Saisonplan. Lege unter <a href="/settings">Einstellungen</a> einen an.</div>;

  const goalNote = tp?.goal ? `am Renntag bereit für ~${fmtT(tp.goal.predictedTimeS)}${tp.goal.goalTimeS ? ` vs. Ziel ${fmtT(tp.goal.goalTimeS)}` : ""}` : null;

  return (
    <div>
      <div className="spread no-print">
        <div>
          <h1>Coach</h1>
          <span className="tiny muted" style={{ display: "block", marginTop: -2 }}>Cockpit — was jetzt zu tun ist: Wettkampf-Block, optimale Zonen, Verfügbarkeit & Vorlieben. Der Wochen-Vorschlag bleibt in der Wochenplanung.</span>
        </div>
        <WeekSelector season={season} weekNo={weekNo} setWeekNo={setWeekNo} />
      </div>

      <TuneupProgressCard />

      {/* Coach ToDo 35: adaptives, faktenbasiertes Verdikt (steuert den Block-Plan, ehrlich geschichtet). */}
      {blockPlan?.coaching && <CoachingBanner c={blockPlan.coaching} freshness={blockPlan.freshness} mode={emphasisMode} onMode={changeEmphasisMode} busy={busy} />}
      {blockPlan?.coaching && emphasisMode === "manual" && (
        <div className="card tight" style={{ marginBottom: 12, marginTop: -6 }}><EmphasisSelector /></div>
      )}

      {/* Item 3 (#7): distanzspezifisches Konzept — Sportwissenschaft sichtbar (Stoffwechsel + Schlüssel-Einheiten). */}
      {blockPlan?.distanceConcept && <DistanceConceptBox c={blockPlan.distanceConcept} />}

      {/* Wettkampf-Block bis Renntag */}
      <div className="card tight" style={{ marginBottom: 12 }}>
        <div className="spread">
          <div className="row" style={{ gap: 8 }}>
            <h2 style={{ margin: 0 }}>Wettkampf-Block</h2>
            <button className="sm ghost" onClick={loadBlock} disabled={busy} title="Mesozyklus-Vorschau ab der gewählten Woche bis zum Renntag">
              {busy ? "…" : blockPlan ? "↻ neu laden" : "▶ Block-Vorschlag laden"}
            </button>
            {blockPlan && blockPlan.weeks.length > 0 && blockPlan.raceDate && (
              <button className="sm ghost" onClick={alignPeak} disabled={aligning || busy} title="Nutzt — wenn belastbar — die Banister-Taperzeit aus deinen Markern und fährt die Last renntag-genau herunter (tages-präzise ab dem Taper-Start, nicht auf ganze Wochen gerundet); sonst eine sportwiss. Heuristik (1–3 Wochen). Legt den Form-Peak auf den Renntag. Nur Vorschau; „Phasen übernehmen“ schreibt es fest.">{aligning ? "…" : "🎯 Peak ausrichten"}</button>
            )}
            {blockPlan && blockPlan.weeks.length > 0 && (
              <button className="sm ghost" onClick={applyPhases} disabled={busy} title="Schreibt die abgeleiteten Phasen aller Wochen in den Saisonplan (manuelle Phasen bleiben).">Phasen übernehmen</button>
            )}
          </div>
          {msg && <span className="tiny" style={{ color: "var(--ok)" }}>{msg}</span>}
        </div>

        {blockPlan && blockPlan.weeks.length > 0 ? (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="tiny muted">{blockPlan.weeks.length} Wochen{blockPlan.raceDate ? ` → Renntag ${blockPlan.raceDate}` : ""}</div>
            <BlockTimeline weeks={blockPlan.weeks} raceDate={blockPlan.raceDate} goalNote={goalNote} onSelectWeek={selectWeek} selectedWeek={selWeek} />
            {blockPlan.reasons?.some((r) => r.code === "rpe_loop") && (
              <div className="tiny muted" style={{ marginTop: 2, lineHeight: 1.45 }}>⚙ Adaptiv (RPE-Loop): {blockPlan.reasons.filter((r) => r.code === "rpe_loop").map((r) => r.text).join(" · ")}</div>
            )}
            <div className="tiny muted" style={{ marginTop: 4 }}>Details je Woche — im Diagramm auf eine Woche klicken oder hier aufklappen:</div>
            {blockPlan.weeks.map((bw) => {
              const confCol = bw.confidence === "hoch" ? "var(--ok)" : bw.confidence === "mittel" ? "var(--warn)" : "#888";
              const open = selWeek != null ? selWeek === bw.week_no : bw.week_no === weekNo;
              return (
                <div key={bw.week_no} id={`bw-${bw.week_no}`} style={{ borderLeft: `3px solid ${open ? "var(--accent, #0ea5e9)" : "var(--border)"}`, paddingLeft: 8, transition: "border-color .15s" }}>
                  <div onClick={() => selectWeek(bw.week_no)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0" }}>
                    <span style={{ width: 12, color: "var(--muted)", flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
                    <strong>Wo. {bw.week_no}</strong>
                    <span className="muted">{bw.start_date}</span>
                    <span style={{ color: confCol }}>{bw.headline}</span>
                    <span className="tiny muted">{bw.tssActual} TSS · {weekKm(bw.days)} km{keySession(bw.days) ? ` · Kern: ${keySession(bw.days)}` : ""}</span>
                    {(bw.isDeload || bw.phase) && (
                      <span className="tiny" style={{ color: phaseColor(bw.phase, bw.isDeload), fontWeight: 600 }}>{bw.isDeload ? "Deload" : bw.phase}</span>
                    )}
                    <button className="sm ghost" style={{ marginLeft: "auto" }} onClick={(e) => { e.stopPropagation(); applyDays(bw.days, bw.week_no, bw.phase); }}>Übernehmen</button>
                  </div>
                  {open && <WeekPlanDetail days={bw.days} reasons={bw.reasons} />}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="tiny muted" style={{ marginTop: 6 }}><T k="coach.block.hint">Lädt den kompletten Mesozyklus bis zum Renntag (inkl. Taper + Erholung). Pro Woche selektiv in die Wochenplanung übernehmbar.</T></p>
        )}
      </div>

      {/* Datengetriebenes Taper (Banister Fitness−Fatigue) — persönliche Ergänzung zu „Peak ausrichten" */}
      <BanisterTaperCard />

      {/* Optimale Zonen */}
      <div style={{ marginBottom: 12 }}><OptimalZonesCard /></div>

      {/* Verfügbarkeit & Einheiten-Vorlieben */}
      <div style={{ marginBottom: 12 }}><AvailabilityCard /></div>

      {/* Eigene Einheiten */}
      <CustomWorkoutsCard />
    </div>
  );
}
