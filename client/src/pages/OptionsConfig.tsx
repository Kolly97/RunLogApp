import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { loadOptions, useOptions, BASE_DAILY, type Option } from "../lib/options.ts";

const KINDS: { kind: string; title: string; hint: string }[] = [
  { kind: "phase", title: "Trainingsphasen", hint: "Wochen-Phasen (Base, Belastung, Entlastung …)" },
  { kind: "sport", title: "Sportarten", hint: "Lauf, Rennrad, Rolle, Kraft, Commute …" },
  { kind: "sessionType", title: "Einheitstypen", hint: "Easy, LT1, LT2, VO2max kurz/lang, Berg …" },
  { kind: "check", title: "Wochen-Checks", hint: "Manuelle Häkchen im Wochenbericht (z.B. Longrun, 2× Schwelle, Physio/KG)" },
  { kind: "dailyCat", title: "Tagesfaktor-Kategorien", hint: "Logische Gruppen der Tagesfaktoren (Morgens, Schlaf, Subjektiv …)" },
  { kind: "daily", title: "Tagesfaktoren", hint: "Tägliche Eingabefelder im Tracking (Kategorie + Typ: Zahl, Zeit, Text, Haken, Skala). Basis-Felder sind fest." },
];

const DAILY_TYPES = [["number", "Zahl"], ["time", "Zeit"], ["text", "Text"], ["checkbox", "Haken"], ["scale", "Skala 1-10"]];

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
    // Neue Tagesfaktoren bekommen als Default den Feldtyp „Zahl".
    await api.addOption({ kind, value: nv.trim(), label: nl.trim() || nv.trim(), sort: rows.length, intensity: kind === "daily" ? "number" : null });
    setNv(""); setNl(""); onChange();
  }
  return (
    <div className="card">
      <div className="spread"><h2>{title}</h2><span className="tiny muted">{hint}</span></div>
      {rows.length > 0 && (
        <table>
          <thead><tr><th>Label (Anzeige)</th><th>Wert (intern)</th><th>{kind === "daily" ? "Kategorie" : "Farbe"}</th><th>Sort</th>{kind === "sessionType" && <th>Intensität</th>}{kind === "daily" && <th>Typ</th>}<th></th></tr></thead>
          <tbody>{rows.map((o) => <OptRow key={o.id} o={o} onChange={onChange} />)}</tbody>
        </table>
      )}
      {/* Eingabe-Reihenfolge wie die Zeilen darüber: Label (Anzeige) → Wert (intern), v0.12.0 (ToDo 10) */}
      <div className="row mt">
        <input placeholder="Label (Anzeige)" value={nl} onChange={(e) => setNl(e.target.value)} style={{ maxWidth: 220 }} />
        <input placeholder="Wert (intern, z.B. Tempo)" value={nv} onChange={(e) => setNv(e.target.value)} style={{ maxWidth: 220 }} />
        <button className="primary" onClick={add}>+ Hinzufügen</button>
      </div>
    </div>
  );
}

function OptRow({ o, onChange }: { o: Option; onChange: () => void }) {
  const [e, setE] = useState(o);
  const { dailyCats } = useOptions();
  const save = (patch: Partial<Option>) => { const n = { ...e, ...patch }; setE(n); api.updateOption(o.id!, n).then(onChange); };
  return (
    <tr>
      <td><input value={e.label} onChange={(x) => setE({ ...e, label: x.target.value })} onBlur={() => save({ label: e.label })} /></td>
      <td className="tiny muted">{e.value}</td>
      {o.kind === "daily" ? (
        <td>
          <select value={e.color ?? ""} onChange={(x) => save({ color: x.target.value || null })} title="Kategorie">
            <option value="">—</option>
            {dailyCats.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </td>
      ) : (
        <td><input type="color" value={e.color || "#94a3b8"} onChange={(x) => save({ color: x.target.value })} style={{ width: 42, height: 28, padding: 0 }} /></td>
      )}
      <td style={{ width: 64 }}><input type="number" value={e.sort ?? 0} onChange={(x) => setE({ ...e, sort: Number(x.target.value) })} onBlur={() => save({ sort: e.sort })} /></td>
      {o.kind === "sessionType" && (
        <td>
          <select value={e.intensity ?? ""} onChange={(x) => save({ intensity: x.target.value || null })} title="Intensität für den TSS-Donut">
            <option value="">—</option>
            <option value="easy">easy</option>
            <option value="moderate">moderat</option>
            <option value="hard">hart</option>
          </select>
        </td>
      )}
      {o.kind === "daily" && (
        <td>
          <select value={e.intensity ?? "number"} onChange={(x) => save({ intensity: x.target.value })} title="Feldtyp">
            {DAILY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </td>
      )}
      <td>
        {o.kind === "daily" && BASE_DAILY.has(o.value)
          ? <span className="tiny muted" title="Basis-Feld (fest)">fest</span>
          : <button className="sm ghost danger" title="Entfernen" onClick={() => api.deleteOption(o.id!).then(onChange)}>✕</button>}
      </td>
    </tr>
  );
}
