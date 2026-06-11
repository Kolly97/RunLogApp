import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { loadOptions, type Option } from "../lib/options.ts";

const KINDS: { kind: string; title: string; hint: string }[] = [
  { kind: "phase", title: "Trainingsphasen", hint: "Wochen-Phasen (Base, Belastung, Entlastung …)" },
  { kind: "sport", title: "Sportarten", hint: "Lauf, Rennrad, Rolle, Kraft, Commute …" },
  { kind: "sessionType", title: "Einheitstypen", hint: "Easy, Schwelle, VO2, Berg …" },
];

export default function OptionsConfig() {
  const [opts, setOpts] = useState<Option[]>([]);

  async function reload() {
    setOpts(await api.options());
    await loadOptions(); // globalen Cache aktualisieren -> Dropdowns überall live
  }
  useEffect(() => { reload(); }, []);

  return (
    <div>
      <h1>Auswahlmöglichkeiten</h1>
      <p className="muted tiny">
        Hier kannst du Phasen, Sportarten und Einheitstypen hinzufügen, umbenennen, umfärben oder entfernen —
        ohne in den Code zu gehen. Bestehende Daten mit alten Werten bleiben gültig.
      </p>
      {KINDS.map((k) => (
        <OptionGroup key={k.kind} kind={k.kind} title={k.title} hint={k.hint}
          rows={opts.filter((o) => o.kind === k.kind)} onChange={reload} />
      ))}
    </div>
  );
}

function OptionGroup({ kind, title, hint, rows, onChange }: {
  kind: string; title: string; hint: string; rows: Option[]; onChange: () => void;
}) {
  const [nv, setNv] = useState("");
  const [nl, setNl] = useState("");
  async function add() {
    if (!nv.trim()) return;
    await api.addOption({ kind, value: nv.trim(), label: nl.trim() || nv.trim(), sort: rows.length });
    setNv(""); setNl(""); onChange();
  }
  return (
    <div className="card">
      <div className="spread"><h2>{title}</h2><span className="tiny muted">{hint}</span></div>
      {rows.length > 0 && (
        <table>
          <thead><tr><th>Label (Anzeige)</th><th>Wert (intern)</th><th>Farbe</th><th>Sort</th><th></th></tr></thead>
          <tbody>{rows.map((o) => <OptRow key={o.id} o={o} onChange={onChange} />)}</tbody>
        </table>
      )}
      <div className="row mt">
        <input placeholder="Wert (intern, z.B. Tempo)" value={nv} onChange={(e) => setNv(e.target.value)} style={{ maxWidth: 220 }} />
        <input placeholder="Label (Anzeige)" value={nl} onChange={(e) => setNl(e.target.value)} style={{ maxWidth: 220 }} />
        <button className="primary" onClick={add}>+ Hinzufügen</button>
      </div>
    </div>
  );
}

function OptRow({ o, onChange }: { o: Option; onChange: () => void }) {
  const [e, setE] = useState(o);
  const save = (patch: Partial<Option>) => { const n = { ...e, ...patch }; setE(n); api.updateOption(o.id!, n).then(onChange); };
  return (
    <tr>
      <td><input value={e.label} onChange={(x) => setE({ ...e, label: x.target.value })} onBlur={() => save({ label: e.label })} /></td>
      <td className="tiny muted">{e.value}</td>
      <td><input type="color" value={e.color || "#94a3b8"} onChange={(x) => save({ color: x.target.value })} style={{ width: 42, height: 28, padding: 0 }} /></td>
      <td style={{ width: 64 }}><input type="number" value={e.sort ?? 0} onChange={(x) => setE({ ...e, sort: Number(x.target.value) })} onBlur={() => save({ sort: e.sort })} /></td>
      <td><button className="sm ghost danger" title="Entfernen" onClick={() => api.deleteOption(o.id!).then(onChange)}>✕</button></td>
    </tr>
  );
}
