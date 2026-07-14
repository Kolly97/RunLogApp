// Baustein 2.1: Wettkampf-Block als visuelles Timeline-Dashboard (statt reiner Textliste).
// X = Wochen bis Renntag · gestapelter Load-Balken (umschaltbar Zonen ↔ Einheiten-Art) · Phasen-Band (Spannen) ·
// Renntag-Marker. Die Readiness/Peak-Kurve kommt in Increment 2.2 obendrauf.
import { useState } from "react";
import { Bar, ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, CartesianGrid } from "recharts";
import { TOOLTIP_STYLE } from "../lib/chartTheme.ts";
import type { BlockWeek } from "../lib/api.ts";
import { addDays } from "../lib/util.ts";
import { blockReadiness } from "../lib/blockReadiness.ts";

// Zonen-Palette Z1..Z6 (klinischer Verlauf ruhig→hart). zone_alloc nutzt Zonennummern als Keys.
const ZONE_PALETTE: Record<number, string> = { 1: "#60a5fa", 2: "#34d399", 3: "#a3e635", 4: "#facc15", 5: "#fb923c", 6: "#ef4444" };
const ZONE_LABEL: Record<number, string> = { 1: "Z1 Recovery", 2: "Z2 Endurance", 3: "Z3 Tempo", 4: "Z4 Threshold", 5: "Z5 VO2max", 6: "Z6 Anaerob" };

// Einheiten-Art-Familien (fixe Stack-Keys) — Tag-Typ → Familie über Substring.
type Fam = { key: string; label: string; color: string; match: (t: string) => boolean };
const TYPE_FAMILIES: Fam[] = [
  { key: "easy", label: "Easy", color: "#3b82f6", match: (t) => /easy|ga1|ga12|recovery/i.test(t) },
  { key: "long", label: "Long", color: "#6366f1", match: (t) => /long/i.test(t) },
  { key: "lt1", label: "LT1 (aerob)", color: "#84cc16", match: (t) => /lt1|steady|marathon/i.test(t) },
  { key: "race", label: "Race Specific", color: "#c2410c", match: (t) => /renntempo|race/i.test(t) },
  { key: "lt2", label: "LT2 (Schwelle)", color: "#eab308", match: (t) => /lt2|threshold|schwelle|tempo/i.test(t) },
  { key: "vo2", label: "VO2max", color: "#f97316", match: (t) => /vo2/i.test(t) },
  { key: "berg", label: "Berg", color: "#a855f7", match: (t) => /hill|berg/i.test(t) },
  { key: "other", label: "Sonstiges", color: "#94a3b8", match: () => true },
];
const famOf = (type: string) => (TYPE_FAMILIES.find((f) => f.match(type)) ?? TYPE_FAMILIES[TYPE_FAMILIES.length - 1]).key;

export function phaseColor(phase: string | null | undefined, isDeload: boolean): string {
  const p = (phase ?? "").toLowerCase();
  // Reihenfolge wichtig: Taper (Race Week) und Recovery sind technisch „deload", müssen aber ihre eigene Farbe
  // behalten — daher VOR dem generischen Deload-Fang prüfen (sonst wird das Renn-Taper grau statt lila).
  if (/taper|race ?week|raceweek/.test(p)) return "#a855f7"; // Taper = lila
  if (/recovery|erholung|regener/.test(p)) return "#64748b"; // Erholung (nach dem Rennen) = grau
  if (/spec|race/.test(p)) return "#f97316";                 // Race Specific = orange
  if (isDeload || /entlast|deload/.test(p)) return "#64748b"; // Deload = grau
  if (/belast|build|aufbau/.test(p)) return "#22c55e";       // Build = grün
  return "#3b82f6"; // Base = blau
}
// Zyklus-Phasen (Menstruationszyklus) — eigene Semantik/Farben, getrennt vom Periodisierungs-Band.
const CYCLE_PHASE_META: Record<string, { short: string; label: string; color: string }> = {
  menstrual: { short: "Men", label: "Menstruation", color: "#ef4444" },
  follicular: { short: "Fol", label: "Follikelphase", color: "#22c55e" },
  ovulation: { short: "Ovu", label: "Ovulation", color: "#eab308" },
  early_luteal: { short: "fLut", label: "Frühe Luteal", color: "#38bdf8" },
  late_luteal: { short: "sLut", label: "Späte Luteal", color: "#a78bfa" },
};

function shortPhase(phase: string | null | undefined, isDeload: boolean): string {
  const p = (phase ?? "").toLowerCase();
  // Reihenfolge wie phaseColor: Taper/Recovery vor dem generischen Deload-Fang (sonst Renn-Taper als „Deload").
  if (/taper|race ?week|raceweek/.test(p)) return "Taper";
  if (/recovery|erholung|regener/.test(p)) return "Recovery";
  if (/spec|race/.test(p)) return "Specific";
  if (isDeload || /entlast|deload/.test(p)) return "Deload";
  if (/belast|build|aufbau/.test(p)) return "Build";
  return "Base";
}

export default function BlockTimeline({ weeks, raceDate, tuneupDates, goalNote, onSelectWeek, selectedWeek }: { weeks: BlockWeek[]; raceDate: string | null; tuneupDates?: string[]; goalNote?: string | null; onSelectWeek?: (wk: number) => void; selectedWeek?: number | null }) {
  const [mode, setMode] = useState<"zonen" | "typ">("zonen");

  // byMin bevorzugen; die Block-Render füllt aber meist nur byKm → sauberer Fallback (Distribution bleibt korrekt).
  const hasMin = weeks.some((w) => w.days.some((d) => d.zone_alloc?.byMin && Object.keys(d.zone_alloc.byMin).length > 0));
  const zoneUnit = hasMin ? "min" : "km";

  const zonesSeen = new Set<number>();
  const famsSeen = new Set<string>();
  const rows = weeks.map((w) => {
    const row: Record<string, number | string> = { wk: `${w.week_no}` };
    for (const d of w.days) {
      const zsrc = hasMin ? (d.zone_alloc?.byMin ?? {}) : (d.zone_alloc?.byKm ?? {});
      for (const [z, v] of Object.entries(zsrc)) {
        const zn = Number(z); if (!v) continue;
        zonesSeen.add(zn); row[`z${zn}`] = ((row[`z${zn}`] as number) ?? 0) + v;
      }
      const tss = Math.round(d.planned_tss);
      if (tss > 0) { const fk = famOf(d.type); famsSeen.add(fk); row[`f_${fk}`] = ((row[`f_${fk}`] as number) ?? 0) + tss; }
    }
    return row;
  });
  const zoneKeys = [1, 2, 3, 4, 5, 6].filter((z) => zonesSeen.has(z));
  const famKeys = TYPE_FAMILIES.filter((f) => famsSeen.has(f.key));

  // Zyklus-Steuerung: je Woche Phase + Σ km + Σ TSS (km aus byKm, TSS aus planned_tss — beide schon vorhanden).
  const weekMeta = weeks.map((w) => {
    let km = 0, tss = 0;
    for (const d of w.days) { km += Object.values(d.zone_alloc?.byKm ?? {}).reduce((a, b) => a + (b || 0), 0); tss += d.planned_tss; }
    return { wk: `${w.week_no}`, km: Math.round(km * 10) / 10, tss: Math.round(tss), cyclePhase: w.cyclePhase ?? null };
  });
  const metaByWk = new Map(weekMeta.map((m) => [m.wk, m]));
  const hasCycle = weekMeta.some((m) => m.cyclePhase && CYCLE_PHASE_META[m.cyclePhase]);
  // Phasen-Aggregat: Ø km / TSS je Zyklusphase (nur wenn Phasen vorliegen).
  const cycleAgg = hasCycle
    ? Object.keys(CYCLE_PHASE_META).map((ph) => {
        const ws = weekMeta.filter((m) => m.cyclePhase === ph);
        if (!ws.length) return null;
        return { ph, n: ws.length, km: Math.round(ws.reduce((a, m) => a + m.km, 0) / ws.length), tss: Math.round(ws.reduce((a, m) => a + m.tss, 0) / ws.length) };
      }).filter((x): x is { ph: string; n: number; km: number; tss: number } => !!x)
    : [];

  // Phasen-Band als zusammenhängende Spannen (flex-gewichtet) → lange Labels clippen nicht.
  const spans: { label: string; color: string; count: number }[] = [];
  for (const w of weeks) {
    const color = phaseColor(w.phase, w.isDeload);
    const label = shortPhase(w.phase, w.isDeload);
    const last = spans[spans.length - 1];
    if (last && last.color === color && last.label === label) last.count++;
    else spans.push({ label, color, count: 1 });
  }

  // --- Form-Readiness (2.2/2.3) via geteilten Helper (auch vom Coach-Peak-Optimierer 2.4 genutzt). ---
  const { readiness, peakIdx, raceIdx, hasIr } = blockReadiness(weeks, raceDate);
  const raceWk = raceIdx >= 0 ? `${weeks[raceIdx].week_no}` : null;
  // Test-Wettkämpfe auf ihre Blockwoche mappen (Wochen sind Mo–So; das Rennen liegt in genau einer davon).
  const tuneupWks = Array.from(new Set((tuneupDates ?? [])
    .map((d) => weeks.find((w) => w.start_date <= d && d <= addDays(w.start_date, 6))?.week_no)
    .filter((w): w is number => w != null && `${w}` !== raceWk)
    .map((w) => `${w}`)));
  rows.forEach((r, i) => { r.readiness = readiness[i]; if (weeks[i].projVdot != null) r.projVdot = weeks[i].projVdot as number; });
  // T10: prognostizierte VO2max/VDOT-Kurve je Woche (nur wenn eine Fitness-Projektion vorliegt). Eigene rechte
  // Achse mit engem Wertebereich, damit der Anstieg sichtbar wird; gestrichelt = „prognostiziert", kein Messwert.
  const vdots = weeks.map((w) => w.projVdot).filter((v): v is number => v != null);
  const hasVdot = vdots.length > 1 && vdots.some((v, i) => i > 0 && v !== vdots[0]);
  const vdotDomain: [number, number] = hasVdot ? [Math.floor(Math.min(...vdots) - 1), Math.ceil(Math.max(...vdots) + 1)] : [0, 100];
  let flag: { text: string; color: string } | null = null;
  if (raceIdx >= 0) {
    const gap = raceIdx - peakIdx; // >1 = Peak liegt zu früh
    flag = gap <= 1
      ? { text: `✓ Form-Peak trifft den Renntag (Wo ${weeks[peakIdx].week_no})`, color: "var(--ok)" }
      : gap === 2
        ? { text: `⚠ Peak ~2 Wo zu früh (Wo ${weeks[peakIdx].week_no} · Renntag Wo ${weeks[raceIdx].week_no})`, color: "var(--warn)" }
        : { text: `⚠ Peak zu früh (Wo ${weeks[peakIdx].week_no} · Renntag Wo ${weeks[raceIdx].week_no}) — Block/Taper anpassen`, color: "var(--danger)" };
  }

  const stackKeys = mode === "zonen"
    ? zoneKeys.map((z) => ({ dk: `z${z}`, color: ZONE_PALETTE[z], label: ZONE_LABEL[z] }))
    : famKeys.map((f) => ({ dk: `f_${f.key}`, color: f.color, label: f.label }));
  const unit = mode === "zonen" ? zoneUnit : "TSS";
  const YAXIS_W = 38;

  // Custom-Tooltip: Wochen-Summe im Kopf, je Zeile Wert + Prozent, Text in der jeweiligen Serien-Farbe (= Balken).
  const renderTip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const all = payload as { name: string; value: number; color: string; dataKey: string }[];
    const items = all.filter((p) => p.dataKey !== "readiness" && p.dataKey !== "projVdot" && (p.value ?? 0) > 0);
    const rd = all.find((p) => p.dataKey === "readiness");
    const vd = all.find((p) => p.dataKey === "projVdot");
    const total = items.reduce((a, p) => a + (p.value || 0), 0);
    const wm = metaByWk.get(String(label));
    const cyc = wm?.cyclePhase ? CYCLE_PHASE_META[wm.cyclePhase] : null;
    return (
      <div style={{ ...TOOLTIP_STYLE, padding: "8px 10px" }}>
        <div style={{ fontWeight: 700, marginBottom: 2, color: "var(--ink)" }}>Woche {label} · Σ {Math.round(total)} {unit}{rd ? ` · Readiness ${Math.round(rd.value)}` : ""}</div>
        {wm && <div style={{ fontSize: 11, marginBottom: 4, color: "var(--muted)" }}>{wm.km} km · {wm.tss} TSS{vd?.value != null ? ` · VO₂max ~${Math.round(vd.value * 10) / 10} (prog.)` : ""}{cyc ? ` · Zyklus: ${cyc.label}` : ""}</div>}
        {items.map((p) => (
          <div key={p.dataKey} style={{ color: p.color, fontSize: 12, lineHeight: 1.55 }}>
            {p.name}: {Math.round(p.value)} {unit} <span style={{ opacity: 0.8 }}>({total > 0 ? Math.round((p.value / total) * 100) : 0}%)</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      <div className="row no-print" style={{ gap: 8, alignItems: "center", marginBottom: 6 }}>
        <span className="tiny muted">Aufteilung:</span>
        <span className="seg" title="Wochen-Load nach Zonen oder Einheiten-Art">
          <button className={mode === "zonen" ? "active" : ""} onClick={() => setMode("zonen")}>Zonen</button>
          <button className={mode === "typ" ? "active" : ""} onClick={() => setMode("typ")}>Einheiten-Art</button>
        </span>
        <span className="tiny muted" style={{ marginLeft: "auto" }}>{mode === "zonen" ? `${zoneUnit} je Zone` : "TSS je Einheiten-Art"}</span>
      </div>

      {/* Wettkampf-Prognose (Increment 2.2): Form-Peak vs. Renntag + Ziel-Kopplung. */}
      {flag && (
        <div className="tiny" style={{ margin: "0 0 6px", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ color: flag.color, fontWeight: 700 }}>{flag.text}</span>
          <span className="muted">· Readiness = {hasIr ? "individuelle Fitness-Prognose" : "PMC-Form"} × Frische</span>
          {!hasIr && <span className="muted" style={{ fontStyle: "italic" }}>· für die individuelle Prognose Dose-Response (Methodik) rechnen</span>}
          {goalNote && <span className="muted">· {goalNote}</span>}
        </div>
      )}

      {/* Phasen-Band: ein Segment je Phasen-Spanne, Label zentriert über der ganzen Spanne. */}
      <div style={{ display: "flex", gap: 2, marginBottom: 3, marginLeft: YAXIS_W, marginRight: 4 }}>
        {spans.map((s, i) => (
          <div key={i} style={{ flex: s.count, height: 18, background: s.color, opacity: 0.9, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 3, overflow: "hidden" }}>
            <span style={{ fontSize: 10, color: "#fff", fontWeight: 700, whiteSpace: "nowrap", textShadow: "0 1px 1px rgba(0,0,0,.35)" }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Zyklus-Band: eine Zelle je Woche (Phasen wechseln wöchentlich), Farbe/Kürzel je Zyklusphase (prognostiziert). */}
      {hasCycle && (
        <div style={{ display: "flex", gap: 2, marginBottom: 3, marginLeft: YAXIS_W, marginRight: 4 }} title="Zyklusphase je Woche (vorausberechnet)">
          {weekMeta.map((m, i) => {
            const meta = m.cyclePhase ? CYCLE_PHASE_META[m.cyclePhase] : null;
            return (
              <div key={i} style={{ flex: 1, height: 13, background: meta?.color ?? "transparent", opacity: meta ? 0.8 : 0.12, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 2, overflow: "hidden" }}>
                <span style={{ fontSize: 8.5, color: "#fff", fontWeight: 700, whiteSpace: "nowrap" }}>{meta?.short ?? ""}</span>
              </div>
            );
          })}
        </div>
      )}

      <ResponsiveContainer width="100%" height={210}>
        <ComposedChart data={rows} margin={{ top: 18, right: 4, left: 0, bottom: 2 }} barCategoryGap="12%"
          onClick={(s: { activeLabel?: string | number }) => { if (s?.activeLabel != null) onSelectWeek?.(Number(s.activeLabel)); }}
          style={{ cursor: onSelectWeek ? "pointer" : undefined }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="2 4" />
          <XAxis dataKey="wk" interval={0} tick={{ fontSize: 10, fill: "var(--chart-tick)" }} />
          <YAxis yAxisId="load" width={YAXIS_W} tick={{ fontSize: 9, fill: "var(--chart-tick)" }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="ready" hide domain={[0, 110]} />
          {hasVdot && <YAxis yAxisId="vdot" hide domain={vdotDomain} />}
          {selectedWeek != null && <ReferenceLine yAxisId="load" x={`${selectedWeek}`} stroke="var(--accent, #0ea5e9)" strokeOpacity={0.22} strokeWidth={22} ifOverflow="visible" />}
          <Tooltip content={renderTip} cursor={{ fill: "var(--chart-grid)", fillOpacity: 0.18 }} />
          {stackKeys.map((s) => (
            <Bar yAxisId="load" key={s.dk} dataKey={s.dk} stackId="a" name={s.label} fill={s.color} isAnimationActive={false} radius={s.dk === stackKeys[stackKeys.length - 1]?.dk ? [2, 2, 0, 0] : undefined} />
          ))}
          <Line yAxisId="ready" type="monotone" dataKey="readiness" name="Form-Readiness" stroke="var(--accent, #0ea5e9)" strokeWidth={2.4} dot={false} isAnimationActive={false} />
          {/* v3.2.0: Die Linie folgt jetzt der GEPLANTEN Last (Aufbau · Erhalt im Taper · Rückgang unter der
              Erhaltungsdosis) — der Name sagt das, statt „prognostiziert" zu behaupten, was vorher nur eine
              Interpolation auf die Wunschzeit war. */}
          {hasVdot && <Line yAxisId="vdot" type="monotone" dataKey="projVdot" name="VO₂max (aus deiner Plan-Last)" stroke="#a855f7" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />}
          {raceIdx >= 0 && <ReferenceDot yAxisId="ready" x={`${weeks[peakIdx].week_no}`} y={readiness[peakIdx]} r={4} fill="var(--accent, #0ea5e9)" stroke="var(--card)" strokeWidth={1.5} ifOverflow="visible" />}
          {raceWk && <ReferenceLine yAxisId="load" x={raceWk} stroke="#ef4444" strokeWidth={2} label={{ value: "🏁", position: "top", fontSize: 15 }} ifOverflow="visible" />}
          {/* v3.1.0: Test-Wettkämpfe — dezent gestrichelt, damit das Hauptrennen die einzige harte Linie bleibt. */}
          {tuneupWks.map((wk) => (
            <ReferenceLine key={`tu-${wk}`} yAxisId="load" x={wk} stroke="#ef4444" strokeOpacity={0.55} strokeWidth={1.4} strokeDasharray="4 3"
              label={{ value: "🚩", position: "top", fontSize: 11 }} ifOverflow="visible" />
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Lesbare Legende (explizite Farbe/Größe, nicht klassen-abhängig). */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
        {stackKeys.map((s) => (
          <span key={s.dk} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: "inline-block" }} />{s.label}
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 12, height: 2.5, background: "var(--accent, #0ea5e9)", display: "inline-block" }} />Form-Readiness
        </span>
        {tuneupWks.length > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>🚩 Test-Wettkampf (Mini-Taper)</span>
        )}
        {hasVdot && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }} title="VO₂max/VDOT-Äquivalent je Woche, gerechnet aus der GEPLANTEN Wochenlast: über der Erhaltungsdosis baust du auf, im Taper hältst du, darunter baust du ab. Gedeckelt auf den in der Zeit realistisch erreichbaren Zuwachs. Prognose, kein Messwert.">
            <span style={{ width: 12, height: 0, borderTop: "2px dashed #a855f7", display: "inline-block" }} />VO₂max (aus deiner Plan-Last)
          </span>
        )}
      </div>

      {/* Zyklus-Phasen-Aggregat: Ø km / TSS je Phase (macht km & TSS pro Zyklusphase sichtbar). */}
      {cycleAgg.length > 0 && (
        <div style={{ marginTop: 5, fontSize: 11, color: "var(--muted)", display: "flex", flexWrap: "wrap", gap: "2px 12px", alignItems: "center" }}>
          <span style={{ fontWeight: 700 }}>Zyklus Ø/Woche:</span>
          {cycleAgg.map((a) => (
            <span key={a.ph} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: CYCLE_PHASE_META[a.ph].color, display: "inline-block" }} />
              {CYCLE_PHASE_META[a.ph].label}: {a.km} km · {a.tss} TSS
            </span>
          ))}
          <span style={{ fontStyle: "italic" }}>· Phasen vorausberechnet</span>
        </div>
      )}
    </div>
  );
}
