import type { SegNode } from "../lib/api.ts";

type Path = number[];

type Cbs = {
  upd: (path: Path, patch: Partial<SegNode>) => void;
  del: (path: Path) => void;
  add: (path: Path, node: SegNode) => void;
  move: (path: Path, dir: number) => void;
};

function mapTree(nodes: SegNode[], path: Path, fn: (n: SegNode) => SegNode | null): SegNode[] {
  const [i, ...rest] = path;
  return nodes.flatMap((n, idx) => {
    if (idx !== i) return [n];
    if (rest.length === 0) { const r = fn(n); return r ? [r] : []; }
    return [{ ...n, children: mapTree(n.children ?? [], rest, fn) }];
  });
}
function addChild(nodes: SegNode[], path: Path, node: SegNode): SegNode[] {
  if (path.length === 0) return [...nodes, node];
  return mapTree(nodes, path, (n) => ({ ...n, children: [...(n.children ?? []), node] }));
}
function swapAt(nodes: SegNode[], path: Path, dir: number): SegNode[] {
  if (path.length === 1) {
    const i = path[0], j = i + dir;
    if (j < 0 || j >= nodes.length) return nodes;
    const c = [...nodes]; [c[i], c[j]] = [c[j], c[i]]; return c;
  }
  const [i, ...rest] = path;
  return nodes.map((n, idx) => (idx === i ? { ...n, children: swapAt(n.children ?? [], rest, dir) } : n));
}
const newRep = (): SegNode => ({ kind: "rep", reps: 1, dist_m: 400, restSec: 60 });
const newGroup = (): SegNode => ({ kind: "group", reps: 1, restSec: 0, children: [newRep()] });

const numIn = { width: 60, padding: "3px 5px", fontSize: 12 } as const;

function CountField({ node, path, upd }: { node: SegNode; path: Path; upd: Cbs["upd"] }) {
  const range = node.reps_lo != null && node.reps_hi != null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {range ? (
        <>
          <input type="number" min="1" style={numIn} value={node.reps_lo ?? 1}
            onChange={(e) => upd(path, { reps_lo: Number(e.target.value) })} title="min Anzahl" />
          <span className="muted">–</span>
          <input type="number" min="1" style={numIn} value={node.reps_hi ?? 1}
            onChange={(e) => upd(path, { reps_hi: Number(e.target.value) })} title="max Anzahl" />
        </>
      ) : (
        <input type="number" min="1" style={numIn} value={node.reps ?? 1}
          onChange={(e) => upd(path, { reps: Number(e.target.value) })} title="Anzahl" />
      )}
      <span className="tiny">×</span>
      <button type="button" className="sm ghost" style={{ padding: "0 5px", fontSize: 11 }}
        title={range ? "fester Wert" : "Spielraum (von–bis) — Engine wählt nach Form"}
        onClick={() => range
          ? upd(path, { reps: node.reps_lo ?? 1, reps_lo: null, reps_hi: null })
          : upd(path, { reps_lo: node.reps ?? 1, reps_hi: (node.reps ?? 1) + 1 })}>
        {range ? "±" : "±?"}
      </button>
    </span>
  );
}

function Row({ node, path, depth, siblings, cbs }: {
  node: SegNode; path: Path; depth: number; siblings: number; cbs: Cbs;
}) {
  const { upd, del, add, move } = cbs;
  const i = path[path.length - 1];
  const ctrls = (
    <span style={{ display: "inline-flex", gap: 2, marginLeft: "auto" }}>
      <button type="button" className="sm ghost" style={{ padding: "0 5px" }} disabled={i === 0}
        onClick={() => move(path, -1)} title="hoch">▲</button>
      <button type="button" className="sm ghost" style={{ padding: "0 5px" }} disabled={i === siblings - 1}
        onClick={() => move(path, 1)} title="runter">▼</button>
      <button type="button" className="sm ghost danger" style={{ padding: "0 5px" }}
        onClick={() => del(path)} title="löschen">✕</button>
    </span>
  );
  if (node.kind === "group") {
    return (
      <div style={{ marginLeft: depth * 14, marginTop: 4, borderLeft: "2px solid var(--accent)", paddingLeft: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span className="tiny" style={{ fontWeight: 700 }}>Gruppe</span>
          <CountField node={node} path={path} upd={upd} />
          <span className="tiny muted">Pause/Satz</span>
          <input type="number" min="0" style={numIn} value={node.restSec ?? 0}
            onChange={(e) => upd(path, { restSec: Number(e.target.value) })} title="Pause nach jedem Satz (s)" />
          <span className="tiny muted">s</span>
          {ctrls}
        </div>
        {(node.children ?? []).map((c, ci) => (
          <Row key={ci} node={c} path={[...path, ci]} depth={depth + 1}
            siblings={(node.children ?? []).length} cbs={cbs} />
        ))}
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button type="button" className="sm" style={{ fontSize: 11 }} onClick={() => add(path, newRep())}>+ Segment</button>
          <button type="button" className="sm" style={{ fontSize: 11 }} onClick={() => add(path, newGroup())}>+ Untergruppe</button>
        </div>
      </div>
    );
  }
  const isDist = node.dist_m != null;
  return (
    <div style={{ marginLeft: depth * 14, marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <CountField node={node} path={path} upd={upd} />
      <select style={{ width: "auto", padding: "3px 5px", fontSize: 12 }}
        value={isDist ? "dist" : "sec"}
        onChange={(e) => e.target.value === "dist"
          ? upd(path, { dist_m: node.dist_m ?? 400, sec: null })
          : upd(path, { sec: node.sec ?? 60, dist_m: null })}>
        <option value="dist">Distanz (m)</option>
        <option value="sec">Dauer (s)</option>
      </select>
      {isDist
        ? <input type="number" min="50" step="50" style={{ ...numIn, width: 74 }} value={node.dist_m ?? 400}
            onChange={(e) => upd(path, { dist_m: Number(e.target.value) })} />
        : <input type="number" min="10" style={{ ...numIn, width: 74 }} value={node.sec ?? 60}
            onChange={(e) => upd(path, { sec: Number(e.target.value) })} />}
      <span className="tiny muted">Pace ±</span>
      <input type="number" style={{ ...numIn, width: 52 }} value={node.paceOffset ?? 0}
        onChange={(e) => upd(path, { paceOffset: Number(e.target.value) })}
        title="Pace-Offset zum Anker (s/km, − = schneller)" />
      <span className="tiny muted">Pause</span>
      <input type="number" min="0" style={numIn} value={node.restSec ?? 0}
        onChange={(e) => upd(path, { restSec: Number(e.target.value) })} />
      <span className="tiny muted">s</span>
      {ctrls}
    </div>
  );
}

export default function StructureEditor({ value, onChange }: { value: SegNode[]; onChange: (s: SegNode[]) => void }) {
  const cbs: Cbs = {
    upd: (path, patch) => onChange(mapTree(value, path, (n) => ({ ...n, ...patch }))),
    del: (path) => onChange(mapTree(value, path, () => null)),
    add: (path, node) => onChange(addChild(value, path, node)),
    move: (path, dir) => onChange(swapAt(value, path, dir)),
  };

  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: "8px 10px", marginTop: 8 }}>
      <div className="tiny muted" style={{ marginBottom: 2 }}>
        Struktur — Segmente &amp; Gruppen (Spielraum „±" pro Anzahl; die Engine wählt nach Form)
      </div>
      {value.length === 0 && <div className="tiny muted">Noch leer — füge ein Segment oder eine Gruppe hinzu.</div>}
      {value.map((n, i) => (
        <Row key={i} node={n} path={[i]} depth={0} siblings={value.length} cbs={cbs} />
      ))}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button type="button" className="sm" onClick={() => cbs.add([], newRep())}>+ Segment</button>
        <button type="button" className="sm" onClick={() => cbs.add([], newGroup())}>+ Gruppe</button>
      </div>
    </div>
  );
}
