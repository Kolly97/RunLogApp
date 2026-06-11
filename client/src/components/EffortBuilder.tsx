// Effort-/Intervall-Builder (ToDo 1/20) — Strava/Coros-artiger Editor für strukturierte
// Belastungen (Threshold/VO2/Race). Wird in der Planung (SessionModal) und in der
// Ist-Aktivitäts-Eingabe (WeekTrack) verwendet. Speichert als Effort[].
import type { Effort, HrZone } from "../lib/api.ts";
import { isBikeSport, num, paceStr, speedKmh } from "../lib/util.ts";

/** Session-Typen, für die der Builder angeboten wird. */
export const EFFORT_TYPES = ["Threshold", "VO2", "Race"];

const ZONE_COLORS = ["#9aa7b4", "#3b82f6", "#22c55e", "#eab308", "#f97316", "#ef4444"];

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

/** Abgeleitete Zeit eines Reps (falls nicht gesetzt: aus Distanz × Pace). */
function repSec(r: Effort): number | null {
  if (r.sec) return r.sec;
  if (r.dist_m && r.pace_s) return (r.dist_m / 1000) * r.pace_s;
  return null;
}
/** Abgeleitete Distanz eines Reps (falls nicht gesetzt: aus Zeit ÷ Pace). */
function repDist(r: Effort): number | null {
  if (r.dist_m) return r.dist_m;
  if (r.sec && r.pace_s) return (r.sec / r.pace_s) * 1000;
  return null;
}
/** Abgeleitete Pace eines Reps in s/km. */
function repPace(r: Effort): number | null {
  if (r.pace_s) return r.pace_s;
  if (r.sec && r.dist_m) return r.sec / (r.dist_m / 1000);
  return null;
}

/** Zeit-/Distanz-gewichtete Durchschnitte über alle Reps. */
export function effortStats(rows: Effort[]): { totalSec: number; totalM: number; avgHr: number | null } {
  let totalSec = 0, totalM = 0, hrW = 0, hrSum = 0;
  for (const r of rows) {
    const reps = r.reps && r.reps > 0 ? r.reps : 1;
    const sec = repSec(r);
    const dist = repDist(r);
    if (sec) totalSec += reps * sec;
    if (dist) totalM += reps * dist;
    if (r.avg_hr) { const w = sec ? reps * sec : reps; hrW += w; hrSum += r.avg_hr * w; }
  }
  return { totalSec, totalM, avgHr: hrW ? Math.round(hrSum / hrW) : null };
}

const COLS = "44px 64px 70px 76px 56px 56px 1fr 26px";
const cell: React.CSSProperties = { padding: "4px 5px", textAlign: "center", width: "100%" };

export default function EffortBuilder({ efforts, onChange, sport, zones }: {
  efforts: Effort[] | null | undefined;
  onChange: (efforts: Effort[] | null) => void;
  sport: string;
  zones?: HrZone[] | null;
}) {
  const rows = efforts ?? [];
  const bike = isBikeSport(sport);

  const update = (i: number, patch: Partial<Effort>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    onChange(next);
  };
  const remove = (i: number) => {
    const next = rows.filter((_, j) => j !== i);
    onChange(next.length ? next : null);
  };
  const add = () => {
    const last = rows[rows.length - 1];
    onChange([...rows, last ? { ...last } : { reps: 1 }]);
  };

  const st = effortStats(rows);
  const avgPace = st.totalSec && st.totalM ? st.totalSec / (st.totalM / 1000) : null;

  return (
    <div className="field" style={{ marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>
        Intervalle / Efforts <span className="tiny">(Zeit als m:ss oder Minuten · Pace leer = automatisch)</span>
      </span>

      {rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 4, alignItems: "center", fontSize: 12 }}>
          <div className="tiny muted center">Wdh</div>
          <div className="tiny muted center">Zeit</div>
          <div className="tiny muted center">Dist. (m)</div>
          <div className="tiny muted center">{bike ? "km/h" : "Pace /km"}</div>
          <div className="tiny muted center">Ø HF</div>
          <div className="tiny muted center">Max HF</div>
          <div className="tiny muted center">Zone</div>
          <div />

          {rows.map((r, i) => {
            const derivedPace = !r.pace_s && r.sec && r.dist_m ? repPace(r) : null;
            return (
              <Row key={i} r={r} i={i} bike={bike} zones={zones} derivedPace={derivedPace}
                update={update} remove={remove} />
            );
          })}
        </div>
      )}

      <div className="row" style={{ marginTop: 6, gap: 10 }}>
        <button type="button" className="sm ghost" onClick={add}>+ Intervall</button>
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

function Row({ r, i, bike, zones, derivedPace, update, remove }: {
  r: Effort; i: number; bike: boolean; zones?: HrZone[] | null; derivedPace: number | null;
  update: (i: number, patch: Partial<Effort>) => void; remove: (i: number) => void;
}) {
  const sec = repSec(r);
  const dist = repDist(r);
  return (
    <>
      <input type="number" min={1} style={cell} value={r.reps ?? ""}
        onChange={(e) => update(i, { reps: num(e.target.value) ?? undefined })} />
      <input key={`t${i}-${r.sec ?? ""}`} style={cell} placeholder="6:00" defaultValue={mmss(r.sec)}
        onBlur={(e) => update(i, { sec: parseMmSs(e.target.value) })} />
      <input type="number" style={cell} value={r.dist_m ?? ""} placeholder={dist ? `${Math.round(dist)}` : ""}
        onChange={(e) => update(i, { dist_m: num(e.target.value) })} />
      {bike ? (
        <div className="tiny muted center nowrap">{speedKmh(dist, sec)}</div>
      ) : (
        <input key={`p${i}-${r.pace_s ?? ""}`} style={cell} placeholder={derivedPace ? paceStr(derivedPace) : "4:00"}
          defaultValue={mmss(r.pace_s)} onBlur={(e) => update(i, { pace_s: parseMmSs(e.target.value) })} />
      )}
      <input type="number" style={cell} value={r.avg_hr ?? ""}
        onChange={(e) => update(i, { avg_hr: num(e.target.value) })} />
      <input type="number" style={cell} value={r.max_hr ?? ""}
        onChange={(e) => update(i, { max_hr: num(e.target.value) })} />
      <select style={{ padding: "4px 2px", width: "100%" }} value={r.zone ?? ""}
        onChange={(e) => update(i, { zone: num(e.target.value) })}>
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
      <button type="button" className="sm ghost danger" style={{ padding: "2px 6px" }} onClick={() => remove(i)}>✕</button>
    </>
  );
}
