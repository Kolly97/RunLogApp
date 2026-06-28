// Effort-/Intervall-Builder (ToDo 1/20; Sets v0.12.0/ToDo 2) — Strava/Coros-artiger Editor für
// strukturierte Belastungen. Wird in der Planung (SessionModal) und der Ist-Eingabe (WeekTrack) genutzt.
// Speichert als Effort[]; ein Eintrag ist entweder eine Leaf-Zeile ODER eine Wiederholungs-Gruppe
// (`group:true`, `reps`, `children:Effort[]`) für Sets wie 3×(1000+200).
import type { CSSProperties } from "react";
import type { Effort, HrZone } from "../lib/api.ts";
import { isBikeSport, num, paceStr, speedKmh } from "../lib/util.ts";

/** Session-Typen, für die der Builder angeboten wird. */
export const EFFORT_TYPES = ["Threshold", "VO2", "Race"];

export const ZONE_COLORS = ["#9aa7b4", "#3b82f6", "#22c55e", "#eab308", "#f97316", "#ef4444"];

/** Anzeige-Bereich einer Zone: HF-Spanne + (falls vorhanden) Pace-Obergrenze. */
export function zoneRange(z: number, zones?: HrZone[] | null, paceZones?: number[] | null): {
  hr: string | null; pace: string | null; title: string;
} {
  const zn = zones?.find((x) => x.z === z);
  const hr = zn ? `${zn.min}–${zn.max >= 990 ? "max" : zn.max} bpm` : null;
  const p = paceZones?.[z - 1];
  const pace = p && p > 0 ? `bis ${paceStr(p)}/km` : null;
  return { hr, pace, title: [`Z${z}`, hr, pace && `· ${pace}`].filter(Boolean).join(" ") };
}

/** Sekunden → "m:ss" (leer bei null/0). */
export function mmss(sec?: number | null): string {
  if (sec == null || !isFinite(sec) || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** "m:ss" oder reine Zahl (= Minuten) → Sekunden. */
export function parseMmSs(t: string): number | null {
  const s = t.trim();
  if (!s) return null;
  if (s.includes(":")) {
    const [m, ss] = s.split(":");
    const mi = Number(m), se = Number(ss);
    if (isNaN(mi) || isNaN(se)) return null;
    return mi * 60 + se;
  }
  const n = Number(s.replace(",", "."));
  return isNaN(n) ? null : Math.round(n * 60);
}

/** Gruppen zu flachen Leaf-Efforts expandieren (Gruppen-reps × children). Für Statistik/Trend/Anzeige. */
export function flattenEfforts(rows: Effort[] | null | undefined): Effort[] {
  const out: Effort[] = [];
  for (const e of rows ?? []) {
    if (e.group && e.children?.length) {
      const g = e.reps && e.reps > 0 ? e.reps : 1;
      for (let i = 0; i < g; i++) for (const c of e.children) out.push(c);
    } else if (!e.group) out.push(e);
  }
  return out;
}

function repSec(r: Effort): number | null {
  if (r.sec) return r.sec;
  if (r.dist_m && r.pace_s) return (r.dist_m / 1000) * r.pace_s;
  return null;
}
function repDist(r: Effort): number | null {
  if (r.dist_m) return r.dist_m;
  if (r.sec && r.pace_s) return (r.sec / r.pace_s) * 1000;
  return null;
}
function repPace(r: Effort): number | null {
  if (r.pace_s) return r.pace_s;
  if (r.sec && r.dist_m) return r.sec / (r.dist_m / 1000);
  return null;
}

/** Zeit-/Distanz-gewichtete Durchschnitte über alle Reps (Gruppen werden flach expandiert). */
export function effortStats(rows: Effort[]): { totalSec: number; totalM: number; avgHr: number | null } {
  let totalSec = 0, totalM = 0, hrW = 0, hrSum = 0;
  for (const r of flattenEfforts(rows)) {
    const reps = r.reps && r.reps > 0 ? r.reps : 1;
    const sec = repSec(r);
    const dist = repDist(r);
    if (sec) totalSec += reps * sec;
    if (dist) totalM += reps * dist;
    if (r.avg_hr) { const w = sec ? reps * sec : reps; hrW += w; hrSum += r.avg_hr * w; }
  }
  return { totalSec, totalM, avgHr: hrW ? Math.round(hrSum / hrW) : null };
}

const COLS = "40px 58px 64px 68px 48px 48px 82px 52px 60px minmax(56px,1fr) 24px";
const COLS_PLAN = "40px 58px 64px 68px 82px 52px 60px minmax(56px,1fr) 24px"; // Planung: ohne Ø-HF/Max-HF (ToDo v0.13.0)
const cell: CSSProperties = { padding: "4px 5px", textAlign: "center", width: "100%" };

export default function EffortBuilder({ value, onChange, sport, zones, planning }: {
  value: Effort[] | null | undefined;
  onChange: (efforts: Effort[] | null) => void;
  sport: string;
  zones?: HrZone[] | null;
  /** Planung: Ø-HF/Max-HF ausblenden (kennt man beim Planen noch nicht — Zone reicht). */
  planning?: boolean;
}) {
  const rows = value ?? [];
  const bike = isBikeSport(sport);
  const cols = planning ? COLS_PLAN : COLS;

  const update = (i: number, patch: Partial<Effort>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const replace = (i: number, next: Effort) => onChange(rows.map((r, j) => (j === i ? next : r)));
  const remove = (i: number) => { const next = rows.filter((_, j) => j !== i); onChange(next.length ? next : null); };
  const addLeaf = () => {
    const last = [...rows].reverse().find((r) => !r.group);
    onChange([...rows, last ? { ...last } : { reps: 1 }]);
  };
  const addGroup = () => onChange([...rows, { group: true, reps: 3, children: [{ reps: 1 }] }]);

  const st = effortStats(rows);
  const avgPace = st.totalSec && st.totalM ? st.totalSec / (st.totalM / 1000) : null;

  return (
    <div className="field" style={{ marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>
        Intervalle / Efforts <span className="tiny">(Zeit als m:ss oder Minuten · Pace leer = automatisch · Gruppe = Set wie 3×(1000+200))</span>
      </span>

      {rows.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 4, alignItems: "center", fontSize: 12 }}>
            <div className="tiny muted center">Wdh</div>
            <div className="tiny muted center">Zeit</div>
            <div className="tiny muted center">Dist. (m)</div>
            <div className="tiny muted center">{bike ? "km/h" : "Pace /km"}</div>
            {!planning && <div className="tiny muted center">Ø HF</div>}
            {!planning && <div className="tiny muted center">Max HF</div>}
            <div className="tiny muted center">Zone</div>
            <div className="tiny muted center" title="Pause/Trabzeit zwischen den Wiederholungen (Sekunden)">Pause s</div>
            <div className="tiny muted center">Art</div>
            <div className="tiny muted center">Label</div>
            <div />
          </div>
          {rows.map((r, i) =>
            r.group ? (
              <GroupBox key={i} g={r} bike={bike} zones={zones} cols={cols} planning={planning}
                onChange={(next) => replace(i, next)} onRemove={() => remove(i)} />
            ) : (
              <div key={i} style={{ display: "grid", gridTemplateColumns: cols, gap: 4, alignItems: "center", fontSize: 12 }}>
                <Row r={r} bike={bike} zones={zones} planning={planning} onChange={(patch) => update(i, patch)} onRemove={() => remove(i)} />
              </div>
            ),
          )}
        </>
      )}

      <div className="row" style={{ marginTop: 6, gap: 10 }}>
        <button type="button" className="sm ghost" onClick={addLeaf}>+ Intervall</button>
        <button type="button" className="sm ghost" onClick={addGroup}>+ Wiederholungs-Gruppe</button>
        {rows.length > 0 && (
          <span className="tiny muted">
            Σ {mmss(st.totalSec) || "–"}{st.totalM ? ` · ${(st.totalM / 1000).toFixed(1)} km` : ""}
            {" · Ø "}
            {bike
              ? speedKmh(st.totalM || null, st.totalSec || null)
              : avgPace ? `${paceStr(avgPace)} /km` : "–"}
            {st.avgHr != null && ` · Ø HF ${st.avgHr} bpm`}
          </span>
        )}
      </div>
    </div>
  );
}

/** Wiederholungs-Gruppe (eine Ebene): N× über mehrere Leaf-Zeilen. */
function GroupBox({ g, bike, zones, cols, planning, onChange, onRemove }: {
  g: Effort; bike: boolean; zones?: HrZone[] | null; cols: string; planning?: boolean;
  onChange: (next: Effort) => void; onRemove: () => void;
}) {
  const children = g.children ?? [];
  const updateChild = (j: number, patch: Partial<Effort>) =>
    onChange({ ...g, children: children.map((c, k) => (k === j ? { ...c, ...patch } : c)) });
  const removeChild = (j: number) => onChange({ ...g, children: children.filter((_, k) => k !== j) });
  const addChild = () => onChange({ ...g, children: [...children, { reps: 1 }] });

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "6px 8px", margin: "4px 0", background: "var(--surface2)" }}>
      <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 4 }}>
        <span className="tiny muted">Wiederholung</span>
        <input type="number" min={1} style={{ width: 56, textAlign: "center" }} value={g.reps ?? 1}
          onChange={(e) => onChange({ ...g, reps: num(e.target.value) ?? 1 })} />
        <span className="tiny muted">× über die folgenden Zeilen</span>
        <button type="button" className="sm ghost danger" style={{ marginLeft: "auto", padding: "2px 6px" }} onClick={onRemove}>Gruppe ✕</button>
      </div>
      {children.map((c, j) => (
        <div key={j} style={{ display: "grid", gridTemplateColumns: cols, gap: 4, alignItems: "center", fontSize: 12 }}>
          <Row r={c} bike={bike} zones={zones} planning={planning} onChange={(patch) => updateChild(j, patch)} onRemove={() => removeChild(j)} />
        </div>
      ))}
      <button type="button" className="sm ghost" style={{ marginTop: 4 }} onClick={addChild}>+ Zeile in Gruppe</button>
    </div>
  );
}

/** Höchste HF-Zone, deren Untergrenze vom Puls erreicht wird — für den Zonen-Vorschlag aus der Max-HF. */
function zoneFromHr(hr: number, zones?: HrZone[] | null): number | null {
  if (!(hr > 0) || !zones?.length) return null;
  let z: number | null = null;
  for (const zn of zones) if (hr >= zn.min) z = zn.z;
  return z;
}

function Row({ r, bike, zones, planning, onChange, onRemove }: {
  r: Effort; bike: boolean; zones?: HrZone[] | null; planning?: boolean;
  onChange: (patch: Partial<Effort>) => void; onRemove: () => void;
}) {
  const sec = repSec(r);
  const dist = repDist(r);
  const derivedPace = !r.pace_s && r.sec && r.dist_m ? repPace(r) : null;
  return (
    <>
      <input type="number" min={1} style={cell} value={r.reps ?? ""}
        onChange={(e) => onChange({ reps: num(e.target.value) ?? undefined })} />
      <input key={`t-${r.sec ?? ""}`} style={cell} placeholder="6:00" defaultValue={mmss(r.sec)}
        onBlur={(e) => onChange({ sec: parseMmSs(e.target.value) })} />
      <input type="number" style={cell} value={r.dist_m ?? ""} placeholder={dist ? `${Math.round(dist)}` : ""}
        onChange={(e) => onChange({ dist_m: num(e.target.value) })} />
      {bike ? (
        <div className="tiny muted center nowrap">{speedKmh(dist, sec)}</div>
      ) : (
        <input key={`p-${r.pace_s ?? ""}`} style={cell} placeholder={derivedPace ? paceStr(derivedPace) : "4:00"}
          defaultValue={mmss(r.pace_s)} onBlur={(e) => onChange({ pace_s: parseMmSs(e.target.value) })} />
      )}
      {!planning && (
        <input type="number" style={cell} value={r.avg_hr ?? ""}
          onChange={(e) => onChange({ avg_hr: num(e.target.value) })} />
      )}
      {!planning && (
        <input type="number" style={cell} value={r.max_hr ?? ""}
          onChange={(e) => onChange({ max_hr: num(e.target.value) })}
          onBlur={(e) => {
            // Zonen-Vorschlag erst beim Verlassen des Felds — sonst triggert schon die erste Ziffer (180 → „1").
            // Nur wenn noch keine Zone gesetzt ist (manuelle Wahl bleibt erhalten).
            const mh = num(e.target.value);
            if (mh != null && r.zone == null) {
              const z = zoneFromHr(mh, zones);
              if (z != null) onChange({ zone: z });
            }
          }} />
      )}
      <select style={{ padding: "4px 2px", width: "100%" }} value={r.zone ?? ""}
        onChange={(e) => onChange({ zone: num(e.target.value) })}>
        <option value="">–</option>
        {[1, 2, 3, 4, 5, 6].map((z) => {
          const zn = zones?.find((x) => x.z === z);
          return (
            <option key={z} value={z} style={{ color: ZONE_COLORS[z - 1] }}>
              Z{z}{zn ? ` (${zn.min}–${zn.max >= 990 ? "max" : zn.max})` : ""}
            </option>
          );
        })}
      </select>
      <input type="number" min={0} style={cell} value={r.rest_s ?? ""} placeholder="s"
        title={r.hr_recovery ? `HF-Erholung ${r.hr_recovery} bpm` : "Pause zwischen den Wiederholungen (Sekunden)"}
        onChange={(e) => onChange({ rest_s: num(e.target.value) })} />
      <select style={{ padding: "4px 2px", width: "100%" }} value={r.rest_type ?? ""}
        onChange={(e) => onChange({ rest_type: (e.target.value || null) as Effort["rest_type"] })}>
        <option value="">–</option>
        <option value="jog">Trab</option>
        <option value="stand">Stehen</option>
      </select>
      <select style={{ padding: "4px 2px", width: "100%" }} value={r.label ?? ""}
        onChange={(e) => onChange({ label: e.target.value || undefined })}>
        <option value="">–</option>
        <option value="LT1">LT1</option>
        <option value="LT2">LT2</option>
        <option value="VO2short">VO2 kurz</option>
        <option value="VO2long">VO2 lang</option>
      </select>
      <button type="button" className="sm ghost danger" style={{ padding: "2px 6px" }} onClick={onRemove}>✕</button>
    </>
  );
}
