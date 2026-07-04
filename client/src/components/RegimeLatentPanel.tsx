// F3: primäre Auswertung von Passive Inferenz (Regime) & Methoden-Schwerpunkt auf der LATENTEN FITNESS.
// „Δ latente Fitness je +1 SD Zeit-im-Regime" (höher = baut mehr Fitness), Mediator (absolut) + Komposition
// (bei gleichem Umfang). Komplexe Python-Engine (gewichtete Ridge + Moving-Block-Bootstrap, L2-gewichtet), TS-Fallback.
import { useState } from "react";
import { api, type RegimeLatentResult, type RegimeLatentCell } from "../lib/api.ts";
import { useComputeStamp, stampLabel, type ComputeStamp } from "../lib/computeStamp.ts";

const engineLabel = (e?: string) => (e === "numpy-ridge-boot" ? "Python (Ridge + Block-Bootstrap)" : e === "ts" ? "TS (Punktschätzer, ohne CI)" : e === "insufficient" ? "zu wenig Daten" : e ?? "");

export function useRegimeLatent(axis: "regime" | "emphasis") {
  const [data, setData] = useState<RegimeLatentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const { stamp, runTimed } = useComputeStamp(`regime-latent:${axis}`);
  const run = async () => { setBusy(true); try { setData(await runTimed(() => api.mlRegimeLatent(axis))); } catch { setData(null); } finally { setBusy(false); } };
  return { data, busy, run, stamp };
}

/** Header-Button + Engine-Pille + „zuletzt berechnet"-Markierung — oben rechts platzieren. */
export function RegimeLatentButton({ busy, onClick, data, stamp }: { busy: boolean; onClick: () => void; data: RegimeLatentResult | null; stamp?: ComputeStamp | null }) {
  const computed = !!data?.models;
  const col = computed ? "var(--ok)" : "var(--muted)";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {data && (
          <span title="mit welcher Engine gerechnet wurde" style={{ fontSize: 10.5, fontWeight: 600, color: col, border: `1px solid ${col}`, borderRadius: 999, padding: "0 8px", lineHeight: 1.7, whiteSpace: "nowrap" }}>
            ● Engine: {engineLabel(data.engine)}
          </span>
        )}
        <button className="btn btn-ghost" disabled={busy} onClick={onClick}>{busy ? "rechnet… (bis ~15 s)" : "neu berechnen"}</button>
      </div>
      {stamp && <span className="tiny muted" style={{ whiteSpace: "nowrap" }}>{stampLabel(stamp)}</span>}
    </div>
  );
}

/** Ergebnis: Mediator/Komposition-Umschalter + Ranking (β = Δ latente Fitness/SD, höher = besser). */
export function RegimeLatentResults({ data, labelMap }: { data: RegimeLatentResult; labelMap: Record<string, string> }) {
  const [model, setModel] = useState<"composition" | "mediator">("composition");
  if (!data.models) {
    return <p className="tiny muted" style={{ marginTop: 8 }}>{data.engine === "insufficient" ? "Noch zu wenig Wochen/Regime für die Latenz-Auswertung." : "Latenz-Auswertung nicht verfügbar (Python-Engine inaktiv)."}</p>;
  }
  const cells = [...data.models[model]].sort((a, b) => b.beta - a.beta); // höher = besser zuerst
  const lbl = (k: string) => labelMap[k] ?? k;
  const practical = (c: RegimeLatentCell) => c.ci_low != null && c.ci_high != null && (c.ci_low > 0 || c.ci_high < 0);
  const dirColor = (c: RegimeLatentCell) => (!practical(c) ? "var(--muted)" : c.beta > 0 ? "var(--ok)" : "var(--danger)");
  const top = cells.find((c) => practical(c) && c.beta > 0);
  return (
    <div style={{ marginTop: 8 }}>
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        {(["composition", "mediator"] as const).map((m) => (
          <button key={m} className="btn btn-ghost" disabled={false} onClick={() => setModel(m)}
            style={{ fontSize: 12, padding: "2px 10px", borderColor: model === m ? "var(--accent, #0ea5e9)" : undefined, color: model === m ? "var(--ink)" : "var(--muted)", fontWeight: model === m ? 700 : 400 }}>
            {m === "composition" ? "Bei gleichem Umfang" : "Absolut"}
          </button>
        ))}
        <span className="tiny muted" style={{ alignSelf: "center" }}>{model === "composition" ? "Volumen-bereinigt" : "inkl. Umfang"}</span>
      </div>
      <p className="tiny" style={{ margin: "0 0 6px" }}>
        {top ? <>Am meisten baut <strong>{lbl(top.label)}</strong> deine Fitness (Δ {top.beta > 0 ? "+" : ""}{top.beta} je +1 SD{model === "composition" ? ", bei gleichem Umfang" : ""}).</>
          : <span className="muted">Kein Regime/Schwerpunkt hebt sich belastbar ab — eher neutral (ehrliches Ergebnis).</span>}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {cells.map((c) => (
          <div key={c.label} className="tiny" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontWeight: practical(c) ? 700 : 500 }}>{lbl(c.label)}{practical(c) && c.beta > 0 ? " ★" : ""}</span>
            <span style={{ color: dirColor(c) }}>{c.beta > 0 ? "+" : ""}{c.beta}{c.ci_low != null ? ` [${c.ci_low}, ${c.ci_high}]` : " (ohne CI)"}{c.p_positive != null ? ` · P>0 ${(c.p_positive * 100).toFixed(0)}%` : ""}</span>
          </div>
        ))}
      </div>
      <p className="tiny muted" style={{ marginTop: 4, fontStyle: "italic" }}>
        Δ latente Fitness je +1 SD Zeit-im-Regime (höher = baut mehr Fitness) · ★ = belastbar (95%-CI schließt 0 aus) ·
        {data.nWeeks ? ` ${data.nWeeks} Wo ·` : ""} autokorrelations-robuste Bootstrap-CIs, L2-gewichtet. Korrelation, nicht Kausalität.
      </p>
    </div>
  );
}
