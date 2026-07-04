// „Neu berechnen (Bayes)" für Passive Inferenz (Regime) und Methoden-Schwerpunkt — hierarchische Auswertung
// (Partial Pooling) über die komplexe Python-Engine (Sidecar), sonst analytischer EB-Fallback. Rein beratend.
// Als Hook + Ergebnis-Komponente + Header-Button (gleicher Stil wie „Was wirkt bei dir?"). Ersetzt beim
// Neuberechnen die Roh-Liste durch EIN geschrumpftes Bayes-Ergebnis (kein Doppel-Block).
import { useState } from "react";
import { api, type MethodBayesAxis } from "../lib/api.ts";

const DIR: Record<string, string> = { hilft: "var(--ok)", kostet: "var(--danger)", neutral: "var(--muted)" };
const engineLabel = (e?: string) => (e === "pymc-hier" ? "PyMC" : e === "eb" ? "analytisch" : e ?? "");

export function useMethodBayes(axis: "regime" | "emphasis") {
  const [data, setData] = useState<MethodBayesAxis | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const r = await api.mlMethodBayes(axis); setData(r[axis] ?? null); } catch { setData(null); } finally { setBusy(false); }
  };
  return { data, busy, run };
}

/** Header-Button (+Status-Pille) im gleichen Stil wie die „Was wirkt bei dir?"-Karte — oben rechts platzieren. */
export function BayesRecomputeButton({ busy, onClick, data }: { busy: boolean; onClick: () => void; data: MethodBayesAxis | null }) {
  const bayes = !!data; // vor Neuberechnung = TS-Basis, danach = Bayes
  const col = bayes ? "var(--ok)" : "var(--muted)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span title="mit welcher Engine gerechnet wurde" style={{ fontSize: 10.5, fontWeight: 600, color: col, border: `1px solid ${col}`, borderRadius: 999, padding: "0 8px", lineHeight: 1.7, whiteSpace: "nowrap" }}>
        ● Engine: {bayes ? `Bayes ${engineLabel(data!.engine)}` : "TS (Basis)"}
      </span>
      <button className="btn btn-ghost" disabled={busy} onClick={onClick}>{busy ? "rechnet…" : "neu berechnen"}</button>
    </div>
  );
}

/** Das (geschrumpfte) Bayes-Ergebnis — ersetzt beim Neuberechnen die Roh-Liste der jeweiligen Karte. */
export function MethodBayesResults({ data }: { data: MethodBayesAxis }) {
  return (
    <div style={{ marginTop: 8 }}>
      <p className="tiny muted" style={{ margin: "0 0 6px", lineHeight: 1.5 }}>
        Hierarchisch neu berechnet (Partial Pooling, Engine {engineLabel(data.engine)}). Kleine/verrauschte Gruppen werden zum
        Gesamtmittel <strong>geschrumpft</strong> → konservativer als die Roh-Mittelwerte, dafür mit ehrlichem 95%-Intervall + P(hilft). CS negativ = schneller = besser.
      </p>
      {data.findings.length === 0 ? (
        <p className="tiny muted">Noch zu wenig Blöcke für eine belastbare Aussage.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {data.findings.map((f) => (
            <div key={f.key} className="tiny" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontWeight: f.practical ? 700 : 500 }}>{f.label}{f.practical ? " ★" : ""}{f.causalProven ? " ✓kausal" : ""}</span>
              <span style={{ color: DIR[f.direction] }}>{f.effect} s/km CS [{f.ciLow}, {f.ciHigh}] · P(hilft) {((f.pBetter ?? 0) * 100).toFixed(0)} % · {f.nBlocks} Bl.</span>
            </div>
          ))}
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 4, fontStyle: "italic" }}>★ = belastbar (95%-CI ganz &lt; 0, ≥ 2 Blöcke). Korrelation, nicht Kausalität.</p>
    </div>
  );
}
