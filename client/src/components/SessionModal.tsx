import { useEffect, useState, type CSSProperties } from "react";
import { api, type PlannedSession, type ZoneSet } from "../lib/api.ts";
import { num } from "../lib/util.ts";
import { useOptions } from "../lib/options.ts";
import EffortBuilder, { ZONE_COLORS, zoneRange } from "./EffortBuilder.tsx";

const ZONE_LABELS = ["Z1", "Z2", "Z3", "Z4", "Z5", "Z6"];

export default function SessionModal({
  session, onClose, onSave,
}: {
  session: PlannedSession; onClose: () => void; onSave: (s: PlannedSession) => void;
}) {
  const [s, setS] = useState<PlannedSession>({ ...session });
  const { sports, sessionTypes } = useOptions();
  const [zs, setZs] = useState<ZoneSet | null>(null);
  useEffect(() => { api.zoneset(session.date).then(setZs).catch(() => setZs(null)); }, [session.date]);

  const km = s.zone_alloc?.byKm || {};
  const set = (patch: Partial<PlannedSession>) => setS((p) => ({ ...p, ...patch }));
  const setZone = (z: number, v: number | null) => {
    const next = { ...km } as Record<number, number>;
    if (v == null || v === 0) delete next[z]; else next[z] = v;
    set({ zone_alloc: Object.keys(next).length ? { byKm: next } : null });
  };
  const zoneSum = Object.values(km).reduce((a, b) => a + (b || 0), 0);

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal} className="card">
        <div className="spread mb">
          <h2>{s.id ? "Einheit bearbeiten" : "Neue Einheit"}</h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>

        <div className="grid cols-2">
          <label className="field"><span>Sportart</span>
            <select value={s.sport} onChange={(e) => set({ sport: e.target.value })}>
              {sports.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Typ</span>
            <select value={s.type} onChange={(e) => set({ type: e.target.value })}>
              {sessionTypes.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Distanz (km)</span>
            <input type="number" step="0.1" value={s.planned_km ?? ""} onChange={(e) => set({ planned_km: num(e.target.value) })} />
          </label>
          <label className="field"><span>Dauer (min)</span>
            <input type="number" value={s.planned_min ?? ""} onChange={(e) => set({ planned_min: num(e.target.value) })} />
          </label>
        </div>

        <label className="field"><span>Beschreibung</span>
          <input value={s.description ?? ""} placeholder="z.B. 4x6' @ Z4 (90'' jog)" onChange={(e) => set({ description: e.target.value })} />
        </label>

        {/* Strukturierte Belastungen (geplante Intervalle) — ToDo 1/20 */}
        <EffortBuilder value={s.efforts ?? null} onChange={(ef) => set({ efforts: ef })}
          sport={s.sport} zones={zs?.hr_zones} planning />

        <div className="field">
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Geplante km je Zone <span className="tiny">(für exakte Zonenverteilung & TSS · Summe {Math.round(zoneSum * 10) / 10} km)</span>
          </span>
          <div className="row" style={{ gap: 6, alignItems: "flex-start" }}>
            {ZONE_LABELS.map((lab, i) => {
              const zr = zoneRange(i + 1, zs?.hr_zones, zs?.pace_zones);
              return (
                <div key={i} style={{ flex: 1, textAlign: "center" }} title={zr.title}>
                  <div className="tiny" style={{ color: ZONE_COLORS[i], fontWeight: 700 }}>{lab}</div>
                  <input type="number" step="0.1" style={{ padding: "5px 4px", textAlign: "center" }}
                    value={km[i + 1] ?? ""} onChange={(e) => setZone(i + 1, num(e.target.value))} />
                  {zr.hr && <div style={hint}>{zr.hr}</div>}
                  {zr.pace && <div style={hint}>{zr.pace}</div>}
                </div>
              );
            })}
          </div>
          <div className="tiny muted" style={{ marginTop: 4 }}>Leer lassen, wenn du keine Zonen-Vorgabe machst — dann schätzt die App nach Typ.</div>
        </div>

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="ghost" onClick={onClose}>Abbrechen</button>
          <button className="primary" onClick={() => onSave(s)}>Speichern</button>
        </div>
      </div>
    </div>
  );
}

const overlay: CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(20,28,44,0.45)", display: "flex",
  alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px", zIndex: 50,
};
const modal: CSSProperties = { width: 660, maxWidth: "100%", marginBottom: 0 };
const hint: CSSProperties = { fontSize: 10, lineHeight: 1.25, color: "var(--muted)", whiteSpace: "nowrap", marginTop: 2 };
