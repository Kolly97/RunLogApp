// Coach-Modus (v1.10.0): die trainingsgestalterischen Werkzeuge an einem Ort — Wettkampf-Block bis Renntag,
// optimale Zonen, Verfügbarkeit & Einheiten-Vorlieben, eigene Einheiten. Der Wochen-Vorschlag bleibt in der
// Wochenplanung. Übernehmen schreibt additiv in die Wochenplanung/den Saisonplan.
import { useEffect, useState } from "react";
import { api, type BlockPlan, type BlockDay, type TuneupProgress, type DistanceConcept } from "../lib/api.ts";
import { useSeason } from "../lib/hooks.ts";
import { DAY_NAMES, typeColor, typeLabel } from "../lib/util.ts";
import WeekSelector from "../components/WeekSelector.tsx";
import AvailabilityCard from "../components/AvailabilityCard.tsx";
import CustomWorkoutsCard from "../components/CustomWorkoutsCard.tsx";
import OptimalZonesCard from "../charts/OptimalZonesCard.tsx";
import T from "../components/T.tsx";

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

export default function Coach() {
  const { season, weekNo, setWeekNo, loading, reload: reloadSeason } = useSeason();
  const [blockPlan, setBlockPlan] = useState<BlockPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function loadBlock() {
    if (weekNo == null || busy) return;
    setBusy(true); setMsg("");
    try { setBlockPlan(await api.blockSuggestion(weekNo)); }
    catch (e: any) { setMsg(String(e)); }
    finally { setBusy(false); }
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

  return (
    <div>
      <div className="spread no-print">
        <div>
          <h1>Coach</h1>
          <span className="tiny muted" style={{ display: "block", marginTop: -2 }}>Wettkampf-Block, optimale Zonen, Verfügbarkeit & Vorlieben — der Wochen-Vorschlag bleibt in der Wochenplanung.</span>
        </div>
        <WeekSelector season={season} weekNo={weekNo} setWeekNo={setWeekNo} />
      </div>

      <TuneupProgressCard />

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
            {blockPlan && blockPlan.weeks.length > 0 && (
              <button className="sm ghost" onClick={applyPhases} disabled={busy} title="Schreibt die abgeleiteten Phasen aller Wochen in den Saisonplan (manuelle Phasen bleiben).">Phasen übernehmen</button>
            )}
          </div>
          {msg && <span className="tiny" style={{ color: "var(--ok)" }}>{msg}</span>}
        </div>

        {blockPlan && blockPlan.weeks.length > 0 ? (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="tiny muted">{blockPlan.weeks.length} Wochen{blockPlan.raceDate ? ` → Renntag ${blockPlan.raceDate}` : ""}</div>
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
                      onClick={(e) => { e.preventDefault(); applyDays(bw.days, bw.week_no, bw.phase); }}>Übernehmen</button>
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
        ) : (
          <p className="tiny muted" style={{ marginTop: 6 }}><T k="coach.block.hint">Lädt den kompletten Mesozyklus bis zum Renntag (inkl. Taper + Erholung). Pro Woche selektiv in die Wochenplanung übernehmbar.</T></p>
        )}
      </div>

      {/* Optimale Zonen */}
      <div style={{ marginBottom: 12 }}><OptimalZonesCard /></div>

      {/* Verfügbarkeit & Einheiten-Vorlieben */}
      <div style={{ marginBottom: 12 }}><AvailabilityCard /></div>

      {/* Eigene Einheiten */}
      <CustomWorkoutsCard />
    </div>
  );
}
