import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { loadOptions, useOptions, BASE_DAILY, type Option } from "../lib/options.ts";
import T from "../components/T.tsx";
import { useT } from "../lib/i18n.tsx";

const DAILY_TYPES = [["number", "Zahl"], ["time", "Zeit"], ["text", "Text"], ["checkbox", "Haken"], ["scale", "Skala 1-10"]];

export default function OptionsConfig() {
  const [opts, setOpts] = useState<Option[]>([]);
  const [active, setActive] = useState("phase");
  const t = useT();

  const KINDS = [
    { kind: "phase", title: t("opts.kind.phase.title", "Trainingsphasen"), hint: t("opts.kind.phase.hint", "Wochen-Phasen (Base, Belastung, Entlastung …)") },
    { kind: "sport", title: t("opts.kind.sport.title", "Sportarten"), hint: t("opts.kind.sport.hint", "Lauf, Rennrad, Rolle, Kraft, Commute …") },
    { kind: "sessionType", title: t("opts.kind.sessionType.title", "Einheitstypen"), hint: t("opts.kind.sessionType.hint", "Easy, LT1, LT2, VO2max kurz/lang, Berg …") },
    { kind: "check", title: t("opts.kind.check.title", "Wochen-Checks"), hint: t("opts.kind.check.hint", "Manuelle Häkchen im Wochenbericht (z.B. Longrun, 2× Schwelle, Physio/KG)") },
    { kind: "dailyCat", title: t("opts.kind.dailyCat.title", "Tagesfaktor-Kategorien"), hint: t("opts.kind.dailyCat.hint", "Logische Gruppen der Tagesfaktoren (Morgens, Schlaf, Subjektiv …)") },
    { kind: "daily", title: t("opts.kind.daily.title", "Tagesfaktoren"), hint: t("opts.kind.daily.hint", "Tägliche Eingabefelder im Tracking (Kategorie + Typ: Zahl, Zeit, Text, Haken, Skala). Basis-Felder sind fest.") },
  ];

  async function reload() {
    setOpts(await api.options());
    await loadOptions(); // globalen Cache aktualisieren -> Dropdowns überall live
  }
  useEffect(() => { reload(); }, []);

  const cur = KINDS.find((k) => k.kind === active) ?? KINDS[0];
  return (
    <div>
      <h1><T k="opts.title">Auswahlmöglichkeiten</T></h1>
      <p className="muted tiny" style={{ marginTop: -4 }}>
        <T k="opts.hint">Phasen, Sportarten, Einheitstypen &amp; Co. hinzufügen, umbenennen, umfärben, sortieren (ziehen am ⠿) oder entfernen — ohne Code. Bestehende Daten mit alten Werten bleiben gültig.</T>
      </p>
      <div className="opt-layout">
        <nav className="opt-nav">
          {KINDS.map((k) => (
            <button key={k.kind} className={active === k.kind ? "active" : ""} onClick={() => setActive(k.kind)}>
              <span>{k.title}</span>
              <span className="badge">{opts.filter((o) => o.kind === k.kind).length}</span>
            </button>
          ))}
        </nav>
        <div className="opt-panel" key={active}>
          <OptionGroup kind={cur.kind} title={cur.title} hint={cur.hint}
            rows={opts.filter((o) => o.kind === cur.kind)} onChange={reload} />
        </div>
      </div>
    </div>
  );
}

function OptionGroup({ kind, title, hint, rows, onChange }: {
  kind: string; title: string; hint: string; rows: Option[]; onChange: () => void;
}) {
  const [nv, setNv] = useState("");
  const [nl, setNl] = useState("");
  const [filter, setFilter] = useState("");
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const t = useT();

  const sorted = [...rows].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const q = filter.trim().toLowerCase();
  const shown = q ? sorted.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : sorted;
  const canDrag = !q; // Reorder nur auf der vollständigen, ungefilterten Liste

  async function add() {
    if (!nv.trim()) return;
    await api.addOption({ kind, value: nv.trim(), label: nl.trim() || nv.trim(), sort: rows.length, intensity: kind === "daily" ? "number" : null });
    setNv(""); setNl(""); onChange();
  }

  async function drop(targetId: number) {
    if (dragId == null || dragId === targetId) { setDragId(null); setOverId(null); return; }
    const order = sorted.map((r) => r.id!);
    order.splice(order.indexOf(dragId), 1);
    const at = order.indexOf(targetId);
    order.splice(at < 0 ? order.length : at, 0, dragId);
    setDragId(null); setOverId(null);
    // Sortwerte fortlaufend neu vergeben (nur geänderte speichern), dann einmal neu laden.
    await Promise.all(order.map((id, i) => {
      const row = rows.find((r) => r.id === id)!;
      return row.sort === i ? null : api.updateOption(id, { ...row, sort: i });
    }).filter(Boolean));
    onChange();
  }

  return (
    <div className="card">
      <div className="spread"><h2>{title}</h2><span className="tiny muted">{hint}</span></div>
      {rows.length > 4 && (
        <input className="mt" placeholder={t("opts.filter", "Filtern …")} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 260 }} />
      )}
      {shown.length > 0 && (
        <table className="mt">
          <thead><tr>
            <th style={{ width: 24 }}></th>
            <th><T k="opts.col.label">Label (Anzeige)</T></th>
            <th><T k="opts.col.value">Wert (intern)</T></th>
            <th>{kind === "daily" ? <T k="opts.col.cat">Kategorie</T> : <T k="opts.col.color">Farbe</T>}</th>
            {kind === "sessionType" && <th><T k="opts.col.intensity">Intensität</T></th>}
            {kind === "daily" && <th><T k="opts.col.type">Typ</T></th>}
            <th></th>
          </tr></thead>
          <tbody>
            {shown.map((o) => (
              <OptRow key={o.id} o={o} onChange={onChange}
                canDrag={canDrag} dragging={dragId === o.id} over={overId === o.id}
                onDragStart={() => setDragId(o.id!)}
                onDragOver={() => setOverId(o.id!)}
                onDrop={() => drop(o.id!)} onDragEnd={() => { setDragId(null); setOverId(null); }} />
            ))}
          </tbody>
        </table>
      )}
      {q && !shown.length && <p className="tiny muted mt">Kein Treffer für „{filter}".</p>}
      {/* Eingabe-Reihenfolge wie die Zeilen: Label (Anzeige) → Wert (intern) */}
      <div className="row mt">
        <input placeholder={t("opts.input.label", "Label (Anzeige)")} value={nl} onChange={(e) => setNl(e.target.value)} style={{ maxWidth: 220 }} />
        <input placeholder={t("opts.input.value", "Wert (intern, z.B. Tempo)")} value={nv} onChange={(e) => setNv(e.target.value)} style={{ maxWidth: 220 }} />
        <button className="primary" onClick={add}><T k="opts.btn.add">+ Hinzufügen</T></button>
      </div>
    </div>
  );
}

function OptRow({ o, onChange, canDrag, dragging, over, onDragStart, onDragOver, onDrop, onDragEnd }: {
  o: Option; onChange: () => void; canDrag: boolean; dragging: boolean; over: boolean;
  onDragStart: () => void; onDragOver: () => void; onDrop: () => void; onDragEnd: () => void;
}) {
  const [e, setE] = useState(o);
  const { dailyCats } = useOptions();
  const t = useT();
  const save = (patch: Partial<Option>) => { const n = { ...e, ...patch }; setE(n); api.updateOption(o.id!, n).then(onChange); };
  return (
    <tr className={"opt-row" + (dragging ? " dragging" : "") + (over ? " drag-over" : "")}
      onDragOver={canDrag ? (ev) => { ev.preventDefault(); onDragOver(); } : undefined}
      onDrop={canDrag ? onDrop : undefined}>
      <td>
        <span className="opt-handle" draggable={canDrag} title={canDrag ? "Ziehen zum Sortieren" : "Filter leeren zum Sortieren"}
          onDragStart={(ev) => { ev.dataTransfer.effectAllowed = "move"; onDragStart(); }} onDragEnd={onDragEnd}>⠿</span>
      </td>
      <td>{o.locked ? <span className="tiny" title="Kanonischer Typ — Name gesperrt">{e.label}</span> : <input value={e.label} onChange={(x) => setE({ ...e, label: x.target.value })} onBlur={() => save({ label: e.label })} />}</td>
      <td className="tiny muted">{e.value}</td>
      {o.kind === "daily" ? (
        <td>
          <select value={e.color ?? ""} onChange={(x) => save({ color: x.target.value || null })} title={t("opts.col.cat", "Kategorie")}>
            <option value="">—</option>
            {dailyCats.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </td>
      ) : (
        <td><input type="color" value={e.color || "#94a3b8"} onChange={(x) => save({ color: x.target.value })} style={{ width: 42, height: 28, padding: 0 }} /></td>
      )}
      {o.kind === "sessionType" && (
        <td>
          <select value={e.intensity ?? ""} onChange={(x) => save({ intensity: x.target.value || null })} title={t("opts.col.intensity", "Intensität")}>
            <option value="">—</option>
            <option value="easy">easy</option>
            <option value="moderate">moderat</option>
            <option value="hard">hart</option>
          </select>
        </td>
      )}
      {o.kind === "daily" && (
        <td>
          <select value={e.intensity ?? "number"} onChange={(x) => save({ intensity: x.target.value })} title={t("opts.col.type", "Typ")}>
            {DAILY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </td>
      )}
      <td>
        {(o.kind === "daily" && BASE_DAILY.has(o.value)) || o.locked
          ? <span className="tiny muted" title={o.locked ? "Kanonischer Typ — gesperrt" : t("opts.fixed", "fest")}>🔒 {t("opts.fixed", "fest")}</span>
          : <button className="sm ghost danger" title="Entfernen" onClick={() => api.deleteOption(o.id!).then(onChange)}>✕</button>}
      </td>
    </tr>
  );
}
