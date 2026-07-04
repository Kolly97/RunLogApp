// Forest-Plot (L3): Reiz-Kanal-Effekte auf die latente Fitness — Punktschätzung + 95%-CI je Kanal,
// Null-Linie, MCID-Band (grau). Farbe: grün (CI > 0), rot (CI < 0), grau (CI überlappt Null = kein klarer
// Effekt). Bewusst schlicht/klinisch (kein Recharts nötig für horizontale CIs).
import type { MlEffect } from "../lib/api.ts";

const LABEL: Record<string, string> = {
  aerob: "Aerob (Long/Easy)", threshold: "Schwelle", vo2: "VO2max",
  E: "Easy", M: "LT1 · Marathon", T: "LT2 · Schwelle", I: "VO2/Intervall", R: "Repetition", V: "VO2max",
  Long: "Long Run", Easy: "Easy (kurz)", Schwelle: "Schwelle", VO2: "VO2max",
};

export default function ForestPlot({ effects, mcid = 0.4 }: { effects: MlEffect[]; mcid?: number }) {
  // Bayes-Posterior anzeigen, wenn vorhanden (deckt sich mit dem Engine-Label „Effekt = Posterior-Mittel" und dem
  // Detail-Panel); sonst die TS-Punktschätzung + Block-Bootstrap-CI. So zeigen Balken, Label und Panel dasselbe.
  const isBayes = (e: MlEffect) => e.bayes_engine != null && e.posterior_mean != null;
  const val = (e: MlEffect) => (isBayes(e) ? e.posterior_mean : e.gain_mean) as number | null;
  const clo = (e: MlEffect) => (isBayes(e) ? e.hdi_low : e.ci_low) as number | null;
  const chi = (e: MlEffect) => (isBayes(e) ? e.hdi_high : e.ci_high) as number | null;
  const valid = effects.filter((e) => val(e) != null && clo(e) != null && chi(e) != null);
  if (!valid.length) return <p className="tiny muted">Noch keine Effekt-Schätzung.</p>;
  const bayesShown = valid.some(isBayes);
  const lo = Math.min(0, ...valid.map((e) => clo(e) as number));
  const hi = Math.max(0, ...valid.map((e) => chi(e) as number));
  const pad = (hi - lo) * 0.08 || 0.1;
  const xMin = lo - pad, xMax = hi + pad;
  const pos = (v: number) => ((v - xMin) / (xMax - xMin)) * 100;
  const color = (e: MlEffect) => ((clo(e) as number) > 0 ? "var(--ok)" : (chi(e) as number) < 0 ? "var(--danger)" : "var(--muted)");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {valid.map((e) => {
        const c = color(e);
        const v = val(e) as number, cl = clo(e) as number, ch = chi(e) as number;
        return (
          <div key={e.channel + e.target} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 130, fontSize: 12, textAlign: "right", color: "var(--ink)" }}>{LABEL[e.channel] ?? e.channel}</div>
            <div style={{ position: "relative", flex: 1, height: 22 }}>
              <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pos(-mcid)}%`, width: `${pos(mcid) - pos(-mcid)}%`, background: "var(--border-faint)", opacity: 0.6 }} />
              <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pos(0)}%`, width: 1, background: "var(--border)" }} />
              <div style={{ position: "absolute", top: "50%", left: `${pos(cl)}%`, width: `${pos(ch) - pos(cl)}%`, height: 2, background: c, transform: "translateY(-50%)" }} />
              <div style={{ position: "absolute", top: "50%", left: `${pos(v)}%`, width: 9, height: 9, borderRadius: 999, background: c, transform: "translate(-50%,-50%)" }} title={`${v.toFixed(2)} [${cl.toFixed(2)}, ${ch.toFixed(2)}] · ${e.confidence}`} />
            </div>
            <div style={{ width: 78, fontSize: 11, textAlign: "right", fontWeight: 700, color: c }} title={e.fdr_survive ? "FDR-bestätigt" : "übersteht die FDR-Korrektur nicht"}>
              {v > 0 ? "+" : ""}{v.toFixed(2)}{e.fdr_survive ? " ✓" : ""}
            </div>
          </div>
        );
      })}
      <div className="tiny muted" style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <span>{xMin.toFixed(1)}</span>
        <span>Δ latente Fitness je +1 SD · {bayesShown ? "Balken = Posterior-Mittel, Linie = 94%-HDI" : "Linie = 95%-Block-Bootstrap-CI"} · graues Band = MCID (±{mcid}) · ✓ = FDR-bestätigt</span>
        <span>+{xMax.toFixed(1)}</span>
      </div>
    </div>
  );
}
