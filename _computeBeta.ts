// Compute-Pipeline für die Beta-Personas: je Persona TSS neu rechnen, ML-Läufe (latent/dose/readiness/banister)
// triggern + abwarten, Zyklus-Phasen backfillen, Verdikt-Cache wärmen. Läuft gegen den lokalen Dev-Server (:3000).
// Aufruf: npx tsx _computeBeta.ts   (Dev-Server muss laufen). Setzt am Ende active_profile zurück auf 1.
const BASE = "http://localhost:3000";
const RICH = new Set([101, 103, 107]); // Clara, Petra, Elite → research_mode-Flag AN (Gate testbar)
const CYCLE = new Set([104, 105]);     // Mira, Sina
const PERSONAS = [
  { id: 101, name: "Clara" }, { id: 102, name: "Jonas" }, { id: 103, name: "Petra" }, { id: 104, name: "Mira" },
  { id: 105, name: "Sina" }, { id: 106, name: "Tom" }, { id: 107, name: "Noah/Elite" }, { id: 108, name: "Yara/Ultra" },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jget = async (p: string) => (await fetch(BASE + p)).json();
const jput = async (p: string, body: unknown) => (await fetch(BASE + p, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const jpost = async (p: string, body?: unknown) => (await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();

async function runKind(kind: string): Promise<string> {
  const start = await jpost(`/api/ml/recompute?kind=${kind}`) as { id?: number; runId?: number; error?: string };
  const runId = start.id ?? start.runId;
  if (start.error || runId == null) return `${kind}:start-fail(${start.error ?? "no-id"})`;
  const t0 = Date.now();
  while (Date.now() - t0 < 180_000) {
    const pr = await jget(`/api/ml/progress?runId=${runId}`) as { status?: string; error?: string };
    if (pr.status === "done" || pr.status === "complete" || pr.status === "ok") return `${kind}:done`;
    if (pr.status === "error" || pr.status === "failed" || pr.status === "cancelled" || pr.error) return `${kind}:${pr.status}(${pr.error ?? ""})`;
    await sleep(1500);
  }
  return `${kind}:timeout`;
}

async function main() {
  for (const p of PERSONAS) {
    await jput("/api/profile/active", { id: p.id });
    await jput("/api/ml/settings", { enabled: 1, research_mode_enabled: RICH.has(p.id) ? 1 : 0, channel_auto: 1, sensitivity: 0.5 });
    const tss = await jpost("/api/recompute-tss") as { activities?: number; sessions?: number; effVo2?: number; error?: string };
    const res: string[] = [];
    for (const kind of ["latent_fitness", "dose_response", "readiness", "banister"]) res.push(await runKind(kind));
    if (RICH.has(p.id)) res.push(await runKind("research_shap")); // LightGBM+SHAP nur wo research_mode an
    // Passive Inferenz + Methoden-Schwerpunkt (Regime/Emphasis → latente Fitness) berechnen/cachen
    for (const axis of ["regime", "emphasis"]) {
      const mb = await jpost(`/api/ml/method-bayes?axis=${axis}`) as Record<string, unknown> & { error?: string };
      res.push(`method-bayes:${axis}:${mb.error ? "err" : "ok"}`);
    }
    if (CYCLE.has(p.id)) {
      const bf = await jpost("/api/cycle-training/backfill-phases") as { updated?: number; error?: string };
      res.push(`cycle-backfill:${bf.updated ?? bf.error ?? "?"}`);
    }
    const verdict = await jget("/api/ml/training-verdict") as { overview?: { headline?: string }; error?: string };
    res.push(`verdict:${verdict.error ? "err" : "ok"}`);
    console.log(`#${p.id} ${p.name.padEnd(11)} tss(acts=${tss.activities ?? "?"},eff=${tss.effVo2 ?? "?"}) | ${res.join(" · ")}`);
  }
  await jput("/api/profile/active", { id: 1 });
  console.log("\nFertig. active_profile zurück auf 1.");
}
main().catch((e) => { console.error(e); process.exit(1); });
