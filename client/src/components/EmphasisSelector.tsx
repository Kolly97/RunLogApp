// Schwerpunkt im Block (v1.9.0, extrahiert v2.7.0): Segmented-Control für availability.emphasis.
// Eigenständig ladend/speichernd — genutzt in AvailabilityCard und im Coach (bei Schwerpunkt-Modus „manuell").
import { useEffect, useState } from "react";
import { api, type Availability } from "../lib/api.ts";
import T from "./T.tsx";

const EMPHASIS = [
  { v: "ausgewogen", l: "Ausgewogen" }, { v: "lt1", l: "LT1 (aerobe Schwelle)" }, { v: "schwelle", l: "Schwelle (LT2)" }, { v: "vo2", l: "VO2max" },
  { v: "berg", l: "Berg" }, { v: "norwegian", l: "Norwegian (sub-T)" }, { v: "fartlek", l: "Fartlek" },
];

export default function EmphasisSelector() {
  const [av, setAv] = useState<Availability | null>(null);
  useEffect(() => { api.availability().then((r) => setAv(r ?? null)).catch(() => {}); }, []);
  if (!av) return null;
  const persist = (next: Availability) => {
    setAv(next);
    api.saveAvailability(next).catch(() => {});
  };
  return (
    <div>
      <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 4 }}><T k="availability.emphasis">Schwerpunkt im Block</T></div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {EMPHASIS.map((o) => (
          <button key={o.v} className={`sm ${(av.emphasis ?? "ausgewogen") === o.v ? "" : "ghost"}`}
            style={{ padding: "6px 13px", fontWeight: 600 }} onClick={() => persist({ ...av, emphasis: o.v })}>{o.l}</button>
        ))}
      </div>
    </div>
  );
}
