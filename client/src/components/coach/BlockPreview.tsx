// Live-Vorschau des Block-Wizards (v3.1.0): zeigt den ECHTEN Blockplan zu den (noch ungespeicherten)
// Wizard-Eingaben — entprellt, mit Abbruch überholter Anfragen. Der letzte gültige Stand bleibt sichtbar,
// während neu gerechnet wird (kein Flackern, kein Sprung).
//
// Inhalt (Kolja-Entscheid): Renntag-Kennzahlen · Block-Timeline · die ersten Wochen als Tabelle ·
// die Warnungen der Engine. Damit sieht man sofort, was die eigene Zahl im Plan anrichtet.
import { useEffect, useRef, useState } from "react";
import { api, type BlockPlan, type BlockPreviewBody } from "../../lib/api.ts";
import { blockReadiness } from "../../lib/blockReadiness.ts";
import { fmtDur } from "../../lib/util.ts";
import BlockTimeline from "../../charts/BlockTimeline.tsx";

const DEBOUNCE_MS = 600;

/** Warnungen, die der Nutzer im Wizard sehen MUSS — hier deckelt die Sicherheitslogik seine Wunschzahlen. */
const WARN_CODES = new Set(["km_ceiling", "km_target_missed", "health_cap", "time_reserve", "taper_guard", "rpe_loop", "cycle"]);

// km je Tag stecken in der Zonen-Verteilung (byKm) — dieselbe Quelle, aus der auch die Wochenplanung rechnet.
const kmOfDay = (d: BlockPlan["weeks"][number]["days"][number]) =>
  Object.values(d.zone_alloc?.byKm ?? {}).reduce((a: number, b) => a + (Number(b) || 0), 0);
const kmOfWeek = (w: BlockPlan["weeks"][number]) => Math.round(w.days.reduce((a, d) => a + kmOfDay(d), 0));
const hardOfWeek = (w: BlockPlan["weeks"][number]) =>
  w.days.filter((d) => /threshold|lt2|vo2|hill|race|renntempo|repetition/i.test(d.type ?? "")).length;
const longOfWeek = (w: BlockPlan["weeks"][number]) => {
  const l = w.days.filter((d) => /long/i.test(d.type ?? "")).sort((a, b) => (b.planned_min ?? 0) - (a.planned_min ?? 0))[0];
  return l?.planned_min ?? null;
};

export default function BlockPreview({ body, goalTimeS }: { body: BlockPreviewBody; goalTimeS?: number | null }) {
  const [plan, setPlan] = useState<BlockPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const abort = useRef<AbortController | null>(null);
  const key = JSON.stringify(body);

  useEffect(() => {
    const t = setTimeout(() => {
      abort.current?.abort();           // überholte Anfrage abbrechen — nur der letzte Stand zählt
      const ac = new AbortController();
      abort.current = ac;
      setBusy(true); setErr("");
      api.blockPreview(body, ac.signal)
        .then((p) => { if (!ac.signal.aborted) { setPlan(p); setBusy(false); } })
        .catch((e) => {
          if (ac.signal.aborted || (e as Error).name === "AbortError") return;
          setBusy(false);
          setErr("Vorschau konnte nicht gerechnet werden.");
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => abort.current?.abort(), []);

  if (!plan) {
    return (
      <div style={panel}>
        <div className="tiny muted">{err || "Vorschau wird gerechnet…"}</div>
      </div>
    );
  }
  if (!plan.weeks.length) {
    return (
      <div style={panel}>
        <strong className="tiny">Vorschau</strong>
        <p className="tiny muted" style={{ marginTop: 6 }}>
          {plan.reasons?.[0]?.text ?? "Kein Saisonplan vorhanden — leg zuerst Wochen im Saisonplan an."}
        </p>
      </div>
    );
  }

  const rd = blockReadiness(plan.weeks, plan.raceDate);
  const raceWeek = rd.raceIdx >= 0 ? plan.weeks[rd.raceIdx] : null;
  const peakOff = rd.raceIdx >= 0 ? rd.peakIdx - rd.raceIdx : null;   // 0 = Peak am Renntag
  const warns = (plan.reasons ?? []).filter((r) => WARN_CODES.has(r.code));
  const first = plan.weeks.slice(0, 4);
  const peakTxt = peakOff == null ? "kein Renntag im Block"
    : peakOff === 0 ? "Peak trifft den Renntag ✓"
      : peakOff < 0 ? `Peak ${Math.abs(peakOff)} Wo. ZU FRÜH`
        : `Peak ${peakOff} Wo. nach dem Renntag`;

  return (
    <div style={{ ...panel, opacity: busy ? 0.55 : 1, transition: "opacity .18s" }}>
      <div className="spread" style={{ alignItems: "baseline", marginBottom: 8 }}>
        <strong className="tiny" style={{ letterSpacing: ".06em", textTransform: "uppercase" }}>Vorschau · echter Blockplan</strong>
        <span className="tiny muted">{busy ? "rechnet…" : `${plan.weeks.length} Wochen`}</span>
      </div>

      {/* Renntag-Kennzahlen: ändert meine Eingabe den Plan zum Guten? */}
      <div className="row" style={{ gap: 14, flexWrap: "wrap", marginBottom: 10 }}>
        <Kpi label="Form am Renntag" value={raceWeek?.tsbStart != null ? `TSB ${raceWeek.tsbStart > 0 ? "+" : ""}${Math.round(raceWeek.tsbStart)}` : "—"} />
        <Kpi label="Peak" value={peakTxt} tone={peakOff === 0 ? "ok" : peakOff != null ? "warn" : undefined} />
        {goalTimeS ? <Kpi label="Wunschzeit" value={fmtDur(goalTimeS)} /> : null}
      </div>

      <BlockTimeline weeks={plan.weeks} raceDate={plan.raceDate} />

      {/* Die ersten Wochen konkret — hier wird die Wirkung von Umfang/Zeit unmittelbar sichtbar. */}
      <table style={{ width: "100%", fontSize: 12, marginTop: 10 }}>
        <thead>
          <tr>
            <th style={th}>Woche</th><th style={th}>Phase</th><th style={thR}>km</th>
            <th style={thR}>harte Einh.</th><th style={thR}>Longrun</th>
          </tr>
        </thead>
        <tbody>
          {first.map((w) => (
            <tr key={w.week_no}>
              <td style={td}>KW {w.week_no}</td>
              <td style={{ ...td, color: "var(--muted)" }}>{w.phase ?? "—"}</td>
              <td style={tdR}>{kmOfWeek(w) || "—"}</td>
              <td style={tdR}>{hardOfWeek(w)}</td>
              <td style={tdR}>{longOfWeek(w) ? `${longOfWeek(w)} min` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {warns.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 4 }}>Die Engine greift ein:</div>
          <ul className="tiny" style={{ margin: 0, paddingLeft: 16, lineHeight: 1.5 }}>
            {warns.slice(0, 4).map((r, i) => <li key={i} style={{ color: r.code === "health_cap" ? "var(--danger)" : "var(--warn)" }}>{r.text}</li>)}
          </ul>
        </div>
      )}
      {err && <p className="tiny" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</p>}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div>
      <div className="tiny muted" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 13, color: tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : "var(--ink)" }}>{value}</div>
    </div>
  );
}

const panel: React.CSSProperties = {
  background: "var(--surface2, rgba(148,163,184,0.08))",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "12px 14px",
  minHeight: 320,
};
const th: React.CSSProperties = { textAlign: "left", fontWeight: 600, color: "var(--muted)", padding: "2px 4px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em" };
const thR: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "3px 4px" };
const tdR: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
