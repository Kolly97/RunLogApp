// Eigene Einheiten (v1.9.0, Z14): Coach-Formular → die App schätzt Familie/Anstrengung/TSS vor → anlegen.
// Angelegte Einheiten erscheinen im Lieblings/Vermeiden-Picker und (als Favorit) im Wochen-Vorschlag.
import { useEffect, useState } from "react";
import { api, type CustomInput, type CustomEstimate, type CustomWorkout, type CustomFamily } from "../lib/api.ts";

const FAMILIES: { v: CustomFamily; l: string }[] = [
  { v: "Easy", l: "Easy" }, { v: "Long", l: "Long" }, { v: "LT1", l: "LT1 · sub-Schwelle" },
  { v: "LT2", l: "LT2 · Schwelle" }, { v: "VO2", l: "VO2max" }, { v: "Hill", l: "Berg" }, { v: "Speed", l: "Schnelligkeit" },
];

export default function CustomWorkoutsCard() {
  const [list, setList] = useState<CustomWorkout[]>([]);
  const [form, setForm] = useState<CustomInput>({ name: "", family: "LT2", kind: "intervals", workZone: 4, reps: 5, repSec: 600, restSec: 90 });
  const [repUnit, setRepUnit] = useState<"sec" | "dist">("sec");
  const [est, setEst] = useState<CustomEstimate | null>(null);
  const [msg, setMsg] = useState("");
  const load = () => api.customWorkouts().then(setList).catch(() => setList([]));
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
        <label className="field" style={fld}><span>Intensitäts-Zone</span><select value={form.workZone} onChange={(e) => set({ workZone: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6].map((z) => <option key={z} value={z}>Z{z}</option>)}</select></label>
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

      {list.length > 0 && (
        <div style={{ marginTop: 12, borderTop: "1px solid #eef2f7", paddingTop: 8 }}>
          <div className="tiny muted" style={{ marginBottom: 4 }}>Angelegt ({list.length}):</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {list.map((w) => (
              <span key={w.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border, #e3e8ef)", borderRadius: 8, padding: "3px 8px", fontSize: 12 }}>
                <span style={{ fontWeight: 600 }}>{w.name}</span>
                <span className="muted tiny">{w.family} · Z{w.template?.workZone} · {w.template?.effort}/5</span>
                <button className="sm ghost" style={{ padding: "0 5px", color: "var(--danger)" }} onClick={() => del(w.id)} title="Löschen">✕</button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
