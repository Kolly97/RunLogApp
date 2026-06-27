// Eigene Einheiten (v1.9.0, Z14): Coach-Formular → die App schätzt Familie/Anstrengung/TSS vor → anlegen.
// Angelegte Einheiten erscheinen im Lieblings/Vermeiden-Picker und (als Favorit) im Wochen-Vorschlag.
import { Fragment, useEffect, useState } from "react";
import { api, type CustomInput, type CustomEstimate, type CustomWorkout, type CustomFamily, type WorkoutInfo } from "../lib/api.ts";

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
  const [est, setEst] = useState<CustomEstimate | null>(null);
  const [msg, setMsg] = useState("");
  const load = () => {
    api.customWorkouts().then(setList).catch(() => setList([]));
    api.workouts().then(setCatalog).catch(() => setCatalog([]));
  };
  useEffect(() => { load(); }, []);

  // Live-Schätzung (debounced), sobald ein Name steht.
  useEffect(() => {
    if (!form.name.trim()) { setEst(null); return; }
    const t = setTimeout(() => { api.estimateCustomWorkout(form).then(setEst).catch(() => setEst(null)); }, 350);
    return () => clearTimeout(t);
  }, [form]);

  const set = (p: Partial<CustomInput>) => setForm((f) => ({ ...f, ...p }));
  const save = async () => {
    if (!form.name.trim()) return;
    await api.addCustomWorkout(form).catch(() => {});
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

      {form.kind === "steady" ? (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginTop: 8 }}>
          <label className="field" style={fld}><span>Dauer min (min)</span><input type="number" min="10" value={form.minMin ?? 30} onChange={(e) => set({ minMin: Number(e.target.value) })} /></label>
          <label className="field" style={fld}><span>Dauer max (min)</span><input type="number" min="10" value={form.maxMin ?? 40} onChange={(e) => set({ maxMin: Number(e.target.value) })} /></label>
        </div>
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
          <div style={{ marginTop: 12, borderTop: "1px solid #eef2f7", paddingTop: 8 }}>
            <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 4 }}>Alle Einheiten ({catalog.length}, davon {custCount} eigene) — nach Familie &amp; Zone</div>
            <div style={{ maxHeight: 320, overflow: "auto" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead><tr style={{ color: "var(--muted)", textAlign: "left", position: "sticky", top: 0, background: "var(--bg, #fff)" }}>
                  <th style={{ padding: "2px 6px" }}>Name</th><th>Zone</th><th>Anstr.</th><th>Anker</th><th>Quelle</th><th />
                </tr></thead>
                <tbody>
                  {fams.map((fam) => {
                    const rows = catalog.filter((w) => w.family === fam).sort((a, b) => (a.workZone ?? 0) - (b.workZone ?? 0) || a.name.localeCompare(b.name));
                    return (
                      <Fragment key={fam}>
                        <tr><td colSpan={6} style={{ fontWeight: 700, padding: "6px 6px 2px", color: "var(--text)" }}>{fam}</td></tr>
                        {rows.map((w) => (
                          <tr key={w.id} style={{ borderTop: "1px solid var(--border-faint,#f0f2f5)", background: w.custom ? "rgba(16,185,129,0.06)" : undefined }}>
                            <td style={{ padding: "3px 6px" }} title={w.purpose}>{w.name}</td>
                            <td className="muted nowrap">{w.workZone ? `Z${w.workZone} · ${ZONE_NAMES[w.workZone - 1] ?? ""}` : "—"}</td>
                            <td className="muted">{w.effort}/5</td>
                            <td className="muted">{w.anchor ?? "—"}</td>
                            <td className="tiny">{w.custom ? <span style={{ color: "var(--ok)", fontWeight: 600 }}>eigen</span> : <span className="muted">Bibliothek</span>}</td>
                            <td>{w.custom && delId(w) != null && <button className="sm ghost" style={{ padding: "0 5px", color: "var(--danger)" }} onClick={() => del(delId(w)!)} title="Löschen">✕</button>}</td>
                          </tr>
                        ))}
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
