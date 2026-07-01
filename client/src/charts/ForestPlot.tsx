// Forest-Plot (L3): Reiz-Kanal-Effekte auf die latente Fitness — Punktschätzung + 95%-CI je Kanal,
// Null-Linie, MCID-Band (grau). Farbe: grün (CI > 0), rot (CI < 0), grau (CI überlappt Null = kein klarer
// Effekt). Bewusst schlicht/klinisch (kein Recharts nötig für horizontale CIs).
import type { MlEffect } from "../lib/api.ts";

const LABEL: Record<string, string> = {
  aerob: "Aerob (Long/Easy)", threshold: "Schwelle", vo2: "VO2max",
  E: "Easy", M: "Marathon", T: "Schwelle", I: "VO2/Intervall", R: "Repetition", V: "VO2max",
  Long: "Long Run", Easy: "Easy (kurz)", Schwelle: "Schwelle", VO2: "VO2max",
};

export default function ForestPlot({ effects, mcid = 0.4 }: { effects: MlEffect[]; mcid?: number }) {
  const valid = effects.filter((e) => e.gain_mean != null && e.ci_low != null && e.ci_high != null);
  if (!valid.length) return <p className="tiny muted">Noch keine Effekt-Schätzung.</p>;
  const lo = Math.min(0, ...valid.map((e) => e.ci_low as number));
  const hi = Math.max(0, ...valid.map((e) => e.ci_high as number));
  const pad = (hi - lo) * 0.08 || 0.1;
  const xMin = lo - pad, xMax = hi + pad;
  const pos = (v: number) => ((v - xMin) / (xMax - xMin)) * 100;
  const color = (e: MlEffect) => ((e.ci_low as number) > 0 ? "var(--ok)" : (e.ci_high as number) < 0 ? "var(--danger)" : "var(--muted)");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {valid.map((e) => {
        const c = color(e);
        return (
          <div key={e.channel + e.target} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 130, fontSize: 12, textAlign: "right", color: "var(--ink)" }}>{LABEL[e.channel] ?? e.channel}</div>
            <div style={{ position: "relative", flex: 1, height: 22 }}>
              <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pos(-mcid)}%`, width: `${pos(mcid) - pos(-mcid)}%`, background: "var(--border-faint)", opacity: 0.6 }} />
              <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pos(0)}%`, width: 1, background: "var(--border)" }} />
              <div style={{ position: "absolute", top: "50%", left: `${pos(e.ci_low as number)}%`, width: `${pos(e.ci_high as number) - pos(e.ci_low as number)}%`, height: 2, background: c, transform: "translateY(-50%)" }} />
              <div style={{ position: "absolute", top: "50%", left: `${pos(e.gain_mean as number)}%`, width: 9, height: 9, borderRadius: 999, background: c, transform: "translate(-50%,-50%)" }} title={`${(e.gain_mean as number).toFixed(2)} [${(e.ci_low as number).toFixed(2)}, ${(e.ci_high as number).toFixed(2)}] · ${e.confidence}`} />
            </div>
            <div style={{ width: 78, fontSize: 11, textAlign: "right", fontWeight: 700, color: c }} title={e.fdr_survive ? "FDR-bestätigt" : "übersteht die FDR-Korrektur nicht"}>
              {(e.gain_mean as number) > 0 ? "+" : ""}{(e.gain_mean as number).toFixed(2)}{e.fdr_survive ? " ✓" : ""}
            </div>
          </div>
        );
      })}
      <div className="tiny muted" style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <span>{xMin.toFixed(1)}</span>
        <span>Δ latente Fitness je +1 SD · graues Band = MCID (±{mcid}) · ✓ = FDR-bestätigt</span>
        <span>+{xMax.toFixed(1)}</span>
      </div>
    </div>
  );
}
