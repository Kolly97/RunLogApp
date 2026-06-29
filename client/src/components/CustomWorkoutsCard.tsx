// Eigene Einheiten (v1.9.0, Z14): Coach-Formular → die App schätzt Familie/Anstrengung/TSS vor → anlegen.
// Angelegte Einheiten erscheinen im Lieblings/Vermeiden-Picker und (als Favorit) im Wochen-Vorschlag.
import { Fragment, useEffect, useState } from "react";
import { api, type CustomInput, type CustomEstimate, type CustomWorkout, type CustomFamily, type WorkoutInfo, type SegNode, type Effort } from "../lib/api.ts";
import { paceStr } from "../lib/util.ts";
import StructureEditor from "./StructureEditor.tsx";

// v1.12.0: Sekunden → kompaktes Label.
function effDur(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return sec % 60 === 0 ? `${sec / 60}'` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
// Kompakte von-bis-Kurzfassung aus dem (gerenderten) Effort-Baum — für die Struktur-Spalte.
function effShort(efforts?: Effort[] | null): string {
  if (!efforts?.length) return "—";
  const one = (e: Effort): string => {
    const lo = e.reps_lo, hi = e.reps_hi;
    const cnt = lo != null && hi != null && hi !== lo ? `${lo}–${hi}` : `${e.reps ?? 1}`;
    if (e.group) return `${cnt}×(${(e.children ?? []).map(one).join("·")})`;
    const unit = e.dist_m ? `${e.dist_m}m` : e.sec ? effDur(e.sec) : "";
    return `${cnt !== "1" ? `${cnt}×` : ""}${unit}`;
  };
  return efforts.map(one).join(" · ");
}
// Rekursive Detail-Anzeige des Effort-Baums (von-bis + „heute" + Pace-Band + Pausen).
function EffortTree({ efforts, depth = 0 }: { efforts?: Effort[] | null; depth?: number }) {
  if (!efforts?.length) return null;
  return (
    <>
      {efforts.map((e, i) => {
        const lo = e.reps_lo, hi = e.reps_hi, tgt = e.reps;
        const hasBand = lo != null && hi != null && hi !== lo;
        const cnt = hasBand ? `${lo}–${hi}` : `${tgt ?? 1}`;
        const today = hasBand && tgt != null ? ` (heute: ${tgt})` : "";
        const rest = e.rest_s ? ` · ${effDur(e.rest_s)} ${e.rest_type === "stand" ? "Stehen" : "Trab"}` : "";
        if (e.group) {
          return (
            <div key={i} style={{ marginLeft: depth * 12 }}>
              <div><strong>{cnt}×</strong>{today} <span className="muted">Satz{rest}</span></div>
              <EffortTree efforts={e.children} depth={depth + 1} />
            </div>
          );
        }
        const unit = e.dist_m ? `${e.dist_m} m` : e.sec ? effDur(e.sec) : "";
        const pace = e.pace_lo != null && e.pace_hi != null && e.pace_hi !== e.pace_lo
          ? `${paceStr(e.pace_lo)}–${paceStr(e.pace_hi)}/km` : e.pace_s != null ? `${paceStr(e.pace_s)}/km` : "";
        return (
          <div key={i} style={{ marginLeft: depth * 12 }}>
            {cnt !== "1" ? `${cnt} × ` : ""}{unit}{today}{pace ? ` @ ${pace}` : ""}{rest}
          </div>
        );
      })}
    </>
  );
}

const ZONE_NAMES = ["Recovery", "Endurance", "Tempo", "Threshold", "VO2max", "Anaerob"]; // Z1..Z6
const FAMILY_ORDER = ["Easy", "Long", "LT1", "LT2", "VO2", "Hill", "Speed", "Race"]; // Sortierung der Katalog-Tabelle
const FAMILIES: { v: CustomFamily; l: string }[] = [
  { v: "Easy", l: "Easy" }, { v: "Long", l: "Long" }, { v: "LT1", l: "LT1 · sub-Schwelle" },
  { v: "LT2", l: "LT2 · Schwelle" }, { v: "VO2", l: "VO2max" }, { v: "Hill", l: "Berg" }, { v: "Speed", l: "Schnelligkeit" },
];

export default function CustomWorkoutsCard() {
  const [list, setList] = useState<CustomWorkout[]>([]);
  const [catalog, setCatalog] = useState<WorkoutInfo[]>([]); // v1.10.0: ganzer Katalog (Bibliothek + eigene)
  const [form, setForm] = useState<CustomInput>({ name: "", family: "LT2", kind: "intervals", workZone: 4, reps: 5, repSec: 600, restSec: 90 });
  const [repUnit, setRepUnit] = useState<"sec" | "dist">("sec");
  const [structMode, setStructMode] = useState(false); // v1.12.0: verschachtelter Builder
  const [openRow, setOpenRow] = useState<string | null>(null); // aufgeklappte Detailzeile in der Tabelle
  const [est, setEst] = useState<CustomEstimate | null>(null);
  const [msg, setMsg] = useState("");
  // Sende-Payload: im Struktur-Modus die Struktur (Vorrang), sonst die Flach-Felder.
  const payload = (): CustomInput => structMode
    ? { ...form, kind: "intervals", structure: form.structure?.length ? form.structure : [] }
    : { ...form, structure: undefined };
  const load = () => {
    api.customWorkouts().then(setList).catch(() => setList([]));
    api.workouts().then(setCatalog).catch(() => setCatalog([]));
  };
  useEffect(() => { load(); }, []);

  // Live-Schätzung (debounced), sobald ein Name steht.
  useEffect(() => {
    if (!form.name.trim()) { setEst(null); return; }
    const t = setTimeout(() => { api.estimateCustomWorkout(payload()).then(setEst).catch(() => setEst(null)); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, structMode]);

  const set = (p: Partial<CustomInput>) => setForm((f) => ({ ...f, ...p }));
  const save = async () => {
    if (!form.name.trim()) return;
    await api.addCustomWorkout(payload()).catch(() => {});
    setMsg("Angelegt ✓ — im Lieblings-Picker mit ♥ markieren, damit sie vorgeschlagen wird.");
    setForm((f) => ({ ...f, name: "" })); setEst(null); load();
  };
  const del = async (id: number) => { await api.deleteCustomWorkout(id).catch(() => {}); load(); };

  const fld = { margin: 0 } as const;
  return (
    <div className="card">
      <div className="spread"><h2 style={{ margin: 0 }}>Eigene Einheiten</h2><span className="tiny muted">Struktur eingeben — TSS/Anstrengung werden geschätzt</span></div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginTop: 10 }}>
        <label className="field" style={fld}><span>Name</span><input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="z. B. Mein 8×400 Berg" /></label>
        <label className="field" style={fld}><span>Familie</span><select value={form.family} onChange={(e) => set({ family: e.target.value as CustomFamily })}>{FAMILIES.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}</select></label>
        <label className="field" style={fld}><span>Art</span><select value={form.kind} onChange={(e) => set({ kind: e.target.value as "steady" | "intervals" })}><option value="intervals">Intervalle</option><option value="steady">Dauerlauf</option></select></label>
        <label className="field" style={fld}><span>Intensitäts-Zone</span><select value={form.workZone} onChange={(e) => set({ workZone: Number(e.target.value) })}>{ZONE_NAMES.map((nm, i) => <option key={i + 1} value={i + 1}>Z{i + 1} · {nm}</option>)}</select></label>
      </div>

      {form.kind === "intervals" && (
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <span className="seg" title="Einfach = N × Rep · Strukturiert = verschachtelte Gruppen wie 3×(1000-1000-600-200-200) mit Spielraum">
            <button type="button" className={structMode ? "" : "active"} onClick={() => setStructMode(false)}>Einfach</button>
            <button type="button" className={structMode ? "active" : ""} onClick={() => setStructMode(true)}>Strukturiert (verschachtelt)</button>
          </span>
        </div>
      )}

      {form.kind === "steady" ? (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginTop: 8 }}>
          <label className="field" style={fld}><span>Dauer min (min)</span><input type="number" min="10" value={form.minMin ?? 30} onChange={(e) => set({ minMin: Number(e.target.value) })} /></label>
          <label className="field" style={fld}><span>Dauer max (min)</span><input type="number" min="10" value={form.maxMin ?? 40} onChange={(e) => set({ maxMin: Number(e.target.value) })} /></label>
        </div>
      ) : structMode ? (
        <StructureEditor value={form.structure ?? []} onChange={(s) => set({ structure: s })} />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginTop: 8 }}>
          <label className="field" style={fld}><span>Wiederholungen</span><input type="number" min="1" value={form.reps ?? 5} onChange={(e) => set({ reps: Number(e.target.value) })} /></label>
          <label className="field" style={fld}><span>je Rep</span><select value={repUnit} onChange={(e) => { const u = e.target.value as "sec" | "dist"; setRepUnit(u); set(u === "sec" ? { repDist_m: undefined, repSec: form.repSec ?? 400 } : { repSec: undefined, repDist_m: form.repDist_m ?? 1000 }); }}><option value="sec">Dauer (s)</option><option value="dist">Distanz (m)</option></select></label>
          {repUnit === "sec"
            ? <label className="field" style={fld}><span>Dauer je Rep (s)</span><input type="number" min="20" value={form.repSec ?? 400} onChange={(e) => set({ repSec: Number(e.target.value) })} /></label>
            : <label className="field" style={fld}><span>Distanz je Rep (m)</span><input type="number" min="100" step="100" value={form.repDist_m ?? 1000} onChange={(e) => set({ repDist_m: Number(e.target.value) })} /></label>}
          <label className="field" style={fld}><span>Pause (s)</span><input type="number" min="0" value={form.restSec ?? 90} onChange={(e) => set({ restSec: Number(e.target.value) })} /></label>
        </div>
      )}

      <div className="row" style={{ gap: 10, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="sm" onClick={save} disabled={!form.name.trim()}>Einheit anlegen</button>
        {est && (
          <span className="tiny" style={{ display: "inline-flex", gap: 10 }}>
            <span>≈ <strong>{est.tssEstimate} TSS</strong></span>
            <span className="muted">{est.durationMin} min</span>
            <span className="muted">Anstrengung {est.template.effort}/5</span>
            <span className="muted">Anker {est.template.anchor ?? "—"}</span>
          </span>
        )}
        {msg && <span className="tiny" style={{ color: "var(--ok)" }}>{msg}</span>}
      </div>

      {/* Ganzer Katalog (Bibliothek + eigene), nach Familie/Zone — Doppelte vermeiden, Lücken sehen (v1.10.0). */}
      {catalog.length > 0 && (() => {
        const famRank = (f: string) => { const i = FAMILY_ORDER.indexOf(f); return i < 0 ? 99 : i; };
        const fams = Array.from(new Set(catalog.map((w) => w.family))).sort((a, b) => famRank(a) - famRank(b) || a.localeCompare(b));
        const custCount = catalog.filter((w) => w.custom).length;
        const delId = (info: WorkoutInfo) => list.find((c) => c.template?.id === info.id)?.id ?? null;
        return (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--border-faint)", paddingTop: 8 }}>
            <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 4 }}>Alle Einheiten ({catalog.length}, davon {custCount} eigene) — nach Familie &amp; Zone</div>
            <div style={{ maxHeight: 320, overflow: "auto" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead><tr style={{ color: "var(--muted)", textAlign: "left", position: "sticky", top: 0, background: "var(--bg, #fff)" }}>
                  <th style={{ padding: "2px 6px" }}>Name</th><th>Zone</th><th>Struktur</th><th>Anstr.</th><th>Anker</th><th>Quelle</th><th />
                </tr></thead>
                <tbody>
                  {fams.map((fam) => {
                    const rows = catalog.filter((w) => w.family === fam).sort((a, b) => (a.workZone ?? 0) - (b.workZone ?? 0) || a.name.localeCompare(b.name));
                    return (
                      <Fragment key={fam}>
                        <tr><td colSpan={7} style={{ fontWeight: 700, padding: "6px 6px 2px", color: "var(--text)" }}>{fam}</td></tr>
                        {rows.map((w) => {
                          const open = openRow === w.id;
                          return (
                          <Fragment key={w.id}>
                          <tr style={{ borderTop: "1px solid var(--border-faint,#f0f2f5)", background: w.custom ? "rgba(16,185,129,0.06)" : undefined, cursor: "pointer" }}
                            onClick={() => setOpenRow(open ? null : w.id)}>
                            <td style={{ padding: "3px 6px" }} title={w.purpose}><span className="muted" style={{ marginRight: 4 }}>{open ? "▾" : "▸"}</span>{w.name}</td>
                            <td className="muted nowrap">{w.workZone ? `Z${w.workZone} · ${ZONE_NAMES[w.workZone - 1] ?? ""}` : "—"}</td>
                            <td className="muted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={effShort(w.efforts)}>{effShort(w.efforts)}</td>
                            <td className="muted">{w.effort}/5</td>
                            <td className="muted">{w.anchor ?? "—"}</td>
                            <td className="tiny">{w.custom ? <span style={{ color: "var(--ok)", fontWeight: 600 }}>eigen</span> : <span className="muted">Bibliothek</span>}</td>
                            <td>{w.custom && delId(w) != null && <button className="sm ghost" style={{ padding: "0 5px", color: "var(--danger)" }} onClick={(e) => { e.stopPropagation(); del(delId(w)!); }} title="Löschen">✕</button>}</td>
                          </tr>
                          {open && (
                            <tr style={{ background: "var(--surface2)" }}>
                              <td colSpan={7} style={{ padding: "6px 10px" }}>
                                <div className="tiny muted" style={{ marginBottom: 3 }}>{w.purpose}{w.planned_min ? ` · ${w.planned_min} min · ${Math.round(w.planned_tss ?? 0)} TSS` : ""}</div>
                                {w.efforts?.length
                                  ? <div className="tiny" style={{ lineHeight: 1.5 }}><EffortTree efforts={w.efforts} /></div>
                                  : <div className="tiny muted">{w.description ?? "Dauerlauf — keine Intervallstruktur."}</div>}
                                {w.adaptNote && <div className="tiny muted" style={{ marginTop: 4, fontStyle: "italic" }}>↳ so passt die Engine es an deine Form an ({w.adaptNote.replace(/^angepasst: /, "")})</div>}
                              </td>
                            </tr>
                          )}
                          </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
