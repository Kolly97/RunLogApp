// VO2max-Laborwerte (v1.5.0): einfache Tabelle über die Zeit → eicht die Effective-VO2max-Schätzung
// (Trend in „Langzeit"). Mehrere Tests möglich; Offset wird zwischen den Tests linear interpoliert.
import { useEffect, useState } from "react";
import { api, type Vo2maxLab } from "../lib/api.ts";
import { fmtDateY, todayIso } from "../lib/util.ts";
import T from "./T.tsx";

export default function Vo2maxLabCard() {
  const [rows, setRows] = useState<Vo2maxLab[]>([]);
  const [date, setDate] = useState(todayIso());
  const [value, setValue] = useState("");
  const [source, setSource] = useState("");

  const reload = () => api.vo2maxLabs().then(setRows).catch(() => setRows([]));
  useEffect(() => { reload(); }, []);

  const add = async () => {
    const v = Number(value);
    if (!(v > 0)) return;
    await api.addVo2maxLab({ date, value: v, source: source.trim() || undefined });
    setValue(""); setSource("");
    reload();
  };
  const del = async (id: number) => { await api.deleteVo2maxLab(id); reload(); };

  return (
    <div className="card">
      <h2><T k="vo2lab.title">VO2max-Laborwerte</T></h2>
      <p className="tiny muted">
        <T k="vo2lab.hint">Gemessene VO2max (Labor/Spiroergometrie) eichen die Pro-Lauf-Schätzung in „Langzeit". Mehrere Werte über die Zeit → wandernde Kalibrierung.</T>
      </p>

      {rows.length > 0 && (
        <table className="tbl" style={{ width: "100%", fontSize: 13, marginBottom: 8 }}>
          <thead><tr>
            <th style={{ textAlign: "left" }}><T k="vo2lab.col.date">Datum</T></th>
            <th><T k="vo2lab.col.value">VO2max</T></th>
            <th style={{ textAlign: "left" }}><T k="vo2lab.col.source">Quelle</T></th>
            <th />
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtDateY(r.date)}</td>
                <td style={{ textAlign: "center", fontWeight: 600 }}>{r.value}</td>
                <td className="muted">{r.source || "–"}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="sm ghost danger" style={{ padding: "2px 6px" }} onClick={() => del(r.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="row" style={{ gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="field" style={{ margin: 0, width: 140 }}>
          <span><T k="vo2lab.col.date">Datum</T></span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field" style={{ margin: 0, width: 110 }}>
          <span><T k="vo2lab.field.value">VO2max (ml/kg/min)</T></span>
          <input type="number" step="0.1" placeholder="56" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label className="field" style={{ margin: 0, width: 150 }}>
          <span><T k="vo2lab.col.source">Quelle</T></span>
          <input placeholder="Labor / Spiro" value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <button className="sm primary" onClick={add}><T k="vo2lab.btn.add">+ Hinzufügen</T></button>
      </div>
    </div>
  );
}
