// P6 — Zyklus-Steuerung (GERÜST, AUS). Consent-Hard-Gate: nichts läuft ohne Opt-in. Ehrliche Evidenzlage
// (trivialer Gruppeneffekt, hohe individuelle Variabilität → N-of-1). Verschlüsselung folgt; Daten sind local-only.
// Beschreibend/nicht-diagnostisch. Solange kein stabiler natürlicher Zyklus + Daten: Beobachtungsmodus, keine Vorschläge.
import { useEffect, useState } from "react";
import { api, type CycleStatus, type CycleMethod, type CycleEvidence } from "../lib/api.ts";
import { fmtDate } from "../lib/util.ts";
import ExpertDetails from "./ExpertDetails.tsx";

export const METHOD_LABEL: Record<CycleMethod, string> = {
  none: "Keine / natürlicher Zyklus", combined_pill: "Kombinierte Pille", progestin_pill: "Gestagen-Pille (POP)",
  hormonal_iud: "Hormonspirale", copper_iud: "Kupferspirale", implant: "Implantat", injection: "Dreimonatsspritze",
  ring: "Vaginalring", patch: "Verhütungspflaster", unknown: "Unbekannt",
};
const PHASE_LABEL: Record<string, string> = { menstrual: "Menstruation", follicular: "Follikelphase", ovulation: "Ovulation", early_luteal: "Frühe Lutealphase", late_luteal: "Späte Lutealphase" };
const PHASE_ORDER = ["menstrual", "follicular", "ovulation", "early_luteal", "late_luteal"];
const FAMILY_LABEL: Record<string, string> = { vo2: "VO2max", threshold: "Schwelle", long: "Lange Einheit", easy: "Locker", norwegian: "Norwegian", speed: "Speed", hill: "Berg" };
const famLabel = (s: string) => FAMILY_LABEL[s] ?? s;
const SYMPTOMS: { key: "cramps" | "energy" | "sleep" | "mood" | "flow"; label: string }[] = [
  { key: "cramps", label: "Krämpfe" }, { key: "energy", label: "Energie" }, { key: "sleep", label: "Schlaf" }, { key: "mood", label: "Stimmung" }, { key: "flow", label: "Blutung" },
];
const DISCLAIMER = "Nicht-diagnostisch, nicht-wertend. Zyklusdaten bleiben lokal auf diesem Gerät (noch unverschlüsselt). Im Zweifel mit einer Fachperson sprechen.";
type MethodImpact = { mode: string; changes: string[] };
const METHOD_IMPACT: Record<CycleMethod, MethodImpact> = {
  none: {
    mode: "Natürlicher Zyklus",
    changes: [
      "Phasen-Schätzung ist grundsätzlich möglich, aber erst nach mindestens 3 vollständigen, stabilen Zyklen.",
      "Bis das Gate offen ist, sammelt RunLog nur Periodenstarts, Symptome und Feedback; keine Trainingsvorschläge werden phasenbasiert geändert.",
      "Wenn später genug Daten vorliegen, werden Phase und Zyklustag nur beratend markiert und mit deinen eigenen Reiz-Feedbacks gegengeprüft.",
    ],
  },
  copper_iud: {
    mode: "Nicht-hormonell, natürlicher Zyklus wahrscheinlich",
    changes: [
      "RunLog behandelt die Auswahl wie natürlichen Zyklus, weil keine systemische Ovulationsunterdrückung angenommen wird.",
      "Blutung und Beschwerden können trotzdem durch die Spirale beeinflusst sein; Symptome zählen deshalb stärker als Kalenderannahmen.",
      "Phasenhinweise bleiben gesperrt, bis Periodenstarts stabil genug sind und keine Gesundheitsflags dagegen sprechen.",
    ],
  },
  combined_pill: {
    mode: "Ovulation unterdrückt",
    changes: [
      "Keine natürliche Follikel-/Luteal-Periodisierung; RunLog bleibt bei phasen-neutraler Trainingsplanung.",
      "Abbruchblutung oder Pillenpause wird nicht als belastbarer natürlicher Zyklus interpretiert.",
      "Symptome können zur Readiness-Einordnung beobachtet werden, erzeugen aber keine aktiven Phasenempfehlungen.",
    ],
  },
  ring: {
    mode: "Ovulation unterdrückt",
    changes: [
      "Der Vaginalring wird wie kombinierte hormonelle Verhütung behandelt: keine natürliche Phasensteuerung.",
      "Entzugsblutung oder ringfreie Woche öffnet das Gate nicht automatisch.",
      "RunLog nutzt erfasste Symptome nur beschreibend für Belastbarkeit, Schlaf, Energie und Feedback.",
    ],
  },
  patch: {
    mode: "Ovulation unterdrückt",
    changes: [
      "Das Pflaster wird wie kombinierte hormonelle Verhütung behandelt: keine natürliche Phasensteuerung.",
      "Pflasterpause oder Entzugsblutung wird nicht als stabiler natürlicher Zyklus gewertet.",
      "Symptomdaten bleiben hilfreich für Beobachtung und Readiness, aber nicht für automatische Trainingsphasen.",
    ],
  },
  implant: {
    mode: "Ovulation meist unterdrückt oder stark verändert",
    changes: [
      "RunLog hält das Phasen-Gate geschlossen und schlägt keine zyklusadaptiven Einheiten vor.",
      "Unregelmäßige Blutungen werden als Statussignal, nicht als zuverlässiger Zyklusanker behandelt.",
      "Tracking bleibt sinnvoll für individuelle Muster wie Energie, Krämpfe, Schlaf und Trainingsqualität.",
    ],
  },
  injection: {
    mode: "Ovulation meist unterdrückt",
    changes: [
      "Die Dreimonatsspritze schließt natürliche Phasensteuerung in RunLog aus.",
      "Blutungsfreiheit oder unregelmäßige Blutungen werden nicht als Follikel-/Lutealphase modelliert.",
      "Die App bleibt im Beobachtungsmodus und nutzt Symptome nur zur Einordnung, nicht zur Planänderung.",
    ],
  },
  progestin_pill: {
    mode: "Unsicher, je nach Präparat und Person",
    changes: [
      "RunLog kann nicht sicher annehmen, ob Ovulation stattfindet; deshalb bleibt das Gate konservativ.",
      "Periodenstarts und Symptome werden gesammelt, aber Phasenempfehlungen bleiben aus, bis Daten sehr stabil wirken.",
      "Bei unregelmäßigen Blutungen zählt die App eher Beobachtung und Readiness als Kalenderphase.",
    ],
  },
  hormonal_iud: {
    mode: "Unsicher, Zyklus kann weiterlaufen",
    changes: [
      "RunLog behandelt die Hormonspirale konservativ, weil Ovulation möglich ist, Blutungsmuster aber oft verändert sind.",
      "Phasenhinweise entstehen nur bei klaren, wiederholbaren Periodenstarts und bleiben sonst Beobachtung.",
      "Symptom- und Feedbackdaten sind hier wichtiger als reine Zyklustag-Schätzung.",
    ],
  },
  unknown: {
    mode: "Unklarer Status",
    changes: [
      "RunLog aktiviert keine Phasensteuerung, solange die Methode oder der Zyklusstatus unklar ist.",
      "Du kannst Symptome und Periodenstarts erfassen; die App liest sie nur beschreibend.",
      "Sobald der Status geklärt ist, entscheidet das Gate neu zwischen natürlichem Zyklus, unterdrückt oder unsicher.",
    ],
  },
};

function MethodImpactPanel({ method }: { method: CycleMethod }) {
  const impact = METHOD_IMPACT[method] ?? METHOD_IMPACT.unknown;
  return (
    <div style={{ marginTop: 8, padding: "8px 10px", border: "1px solid var(--border-faint)", borderRadius: 8 }}>
      <div className="tiny" style={{ fontWeight: 700 }}>Was ändert sich konkret? <span className="muted" style={{ fontWeight: 500 }}>{impact.mode}</span></div>
      <ul className="tiny muted" style={{ margin: "4px 0 0", paddingLeft: 16, lineHeight: 1.5 }}>
        {impact.changes.map((c, i) => <li key={i}>{c}</li>)}
      </ul>
    </div>
  );
}

export default function CycleScaffoldCard() {
  const [st, setSt] = useState<CycleStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<CycleMethod>("none");
  const [showEvidence, setShowEvidence] = useState(false);
  const [newPeriod, setNewPeriod] = useState("");
  const [evidence, setEvidence] = useState<CycleEvidence[] | null>(null);
  const [evalBusy, setEvalBusy] = useState(false);
  const emptySym = { date: "", cramps: "", energy: "", sleep: "", mood: "", flow: "" };
  const [sym, setSym] = useState<Record<string, string>>(emptySym);

  const load = async () => {
    try {
      const s = await api.cycleStatus();
      setSt(s);
      if (s.contraception?.method) setMethod(s.contraception.method);
      setEvidence(s.needsConsent ? null : await api.cycleEvidence().catch(() => []));
    } catch { setSt(null); }
  };
  useEffect(() => { load(); }, []);

  const optIn = async () => { setBusy(true); try { await api.cycleConsent(true, { method }); await load(); } finally { setBusy(false); } };
  const optOut = async () => { setBusy(true); try { await api.cycleConsent(false); await load(); } finally { setBusy(false); } };
  const saveMethod = async (m: CycleMethod) => { setMethod(m); setBusy(true); try { await api.cycleConsent(true, { method: m }); await load(); } finally { setBusy(false); } };
  const addPeriod = async () => { if (!newPeriod) return; setBusy(true); try { await api.cycleAddPeriod(newPeriod); setNewPeriod(""); await load(); } finally { setBusy(false); } };
  const delPeriod = async (id: number) => { setBusy(true); try { await api.cycleDeletePeriod(id); await load(); } finally { setBusy(false); } };
  const deleteAll = async () => {
    if (!window.confirm("Wirklich ALLE Zyklusdaten löschen und die Zyklus-Steuerung deaktivieren? Das lässt sich nicht rückgängig machen.")) return;
    setBusy(true); try { await api.cycleDeleteData(); await load(); } finally { setBusy(false); }
  };
  const nOrNull = (v: string) => (v === "" ? null : Number(v));
  const saveSymptom = async () => {
    if (!sym.date) return;
    setBusy(true);
    try { await api.cycleSaveSymptom({ date: sym.date, cramps: nOrNull(sym.cramps), energy: nOrNull(sym.energy), sleep: nOrNull(sym.sleep), mood: nOrNull(sym.mood), flow: nOrNull(sym.flow) }); setSym(emptySym); } finally { setBusy(false); }
  };
  const reEvaluate = async () => { setEvalBusy(true); try { const r = await api.cycleEvaluate(); setEvidence(r.evidence); } catch { /* gated */ } finally { setEvalBusy(false); } };

  const Evidence = (
    <ExpertDetails summary={showEvidence ? "Evidenzlage (ehrlich)" : "Warum N-of-1? — die ehrliche Evidenzlage"} defaultOpen={showEvidence}>
      <div className="tiny" style={{ lineHeight: 1.55 }}>
        <p style={{ marginTop: 0 }}>Der <strong>mittlere</strong> Zyklus-Effekt auf die Leistung ist <em>trivial</em> (McNulty 2020, gepoolt ES ≈ −0.06) — eine starre, für alle gleiche Phasen-Periodisierung ist <strong>nicht</strong> belegt. Gleichzeitig berichten viele Athletinnen reproduzierbare, deutliche Phasen-Unterschiede — die sich in Gruppenstudien nur wegmitteln (Responder/Non-Responder).</p>
        <p style={{ marginBottom: 0 }}>Deshalb testet diese Funktion — wenn du sie einschaltest — <strong>deine</strong> Hypothese an <strong>deinen</strong> Daten (N-of-1), statt ein Schema zu behaupten. Zeigt sich bei dir kein konsistenter Effekt, sagt die App das offen und schaltet die Steuerung ab. Das ist ein gültiges Ergebnis, kein Versagen.</p>
      </div>
    </ExpertDetails>
  );

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Zyklus-Steuerung <span className="tiny muted">— N-of-1, Gerüst (Default aus)</span></h3>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)", border: "1px solid var(--muted)", borderRadius: 999, padding: "0 7px" }}>{st?.needsConsent === false ? "aktiviert" : "aus"}</span>
      </div>

      {!st ? <p className="muted">Lädt…</p> : st.needsConsent ? (
        // ---- Zustand: kein Consent → Erklärung + Opt-in ----
        <>
          <p className="tiny muted" style={{ marginTop: 6, maxWidth: 780 }}>
            Optionale, zyklusadaptive Trainings-Beobachtung für Athletinnen mit natürlichem Zyklus. <strong>Standardmäßig aus.</strong> Nichts wird erfasst oder vorgeschlagen, bevor du hier ausdrücklich zustimmst. Daten bleiben lokal auf diesem Gerät.
          </p>
          {Evidence}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <label className="tiny muted">Verhütung/Status:
              <select value={method} onChange={(e) => setMethod(e.target.value as CycleMethod)} style={{ marginLeft: 6 }} disabled={busy}>
                {(Object.keys(METHOD_LABEL) as CycleMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
              </select>
            </label>
            <div style={{ flex: 1 }} />
            <button className="btn" disabled={busy} onClick={optIn}>Aktivieren (Opt-in)</button>
          </div>
          <MethodImpactPanel method={method} />
          <p className="tiny muted" style={{ marginTop: 8, fontStyle: "italic" }}>{DISCLAIMER}</p>
        </>
      ) : (
        // ---- Zustand: Consent erteilt → Gate/Beobachtung + Perioden + Löschen ----
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <label className="tiny muted">Verhütung/Status:
              <select value={method} onChange={(e) => saveMethod(e.target.value as CycleMethod)} style={{ marginLeft: 6 }} disabled={busy}>
                {(Object.keys(METHOD_LABEL) as CycleMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
              </select>
            </label>
          </div>
          <MethodImpactPanel method={method} />

          {/* Gate-Status */}
          {st.gate && (
            <div style={{ marginTop: 12, padding: "10px 12px", border: "1px solid var(--border-faint)", borderRadius: 8 }}>
              {st.gate.healthFlags.length > 0 ? (
                st.gate.healthFlags.map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--danger)", border: "1px solid var(--danger)", borderRadius: 999, padding: "0 7px", whiteSpace: "nowrap" }}>Gesundheit</span>
                    <span className="tiny">{f.message}</span>
                  </div>
                ))
              ) : st.gate.mode === "suppressed" ? (
                <div className="tiny"><strong>Verhütung unterdrückt den Zyklus</strong> — Phasen-Steuerung ist nicht anwendbar (keine natürliche Hormonfluktuation).</div>
              ) : st.gate.passed ? (
                <div className="tiny"><strong style={{ color: "var(--ok)" }}>Stabiler natürlicher Zyklus erkannt ✓</strong> — Phasen-Steuerung wäre technisch möglich (bleibt im Gerüst dennoch off, bis individuelle Daten vorliegen).</div>
              ) : (
                <div className="tiny"><strong>Beobachtungsmodus</strong> — {st.gate.nCycles}/3 vollständige Zyklen erfasst. Die App sammelt weiter, schlägt aber nichts vor.{st.gate.reasons.length ? ` (${st.gate.reasons[0]})` : ""}</div>
              )}
              {st.phase?.phase && (
                <div className="tiny muted" style={{ marginTop: 6 }}>Aktuell: <strong>{PHASE_LABEL[st.phase.phase] ?? st.phase.phase}</strong>{st.phase.cycleDay ? ` (Tag ${st.phase.cycleDay})` : ""} · Konfidenz {st.phase.confidence}</div>
              )}
            </div>
          )}

          {/* Empfehlung — GERÜST: immer off/insufficient */}
          {st.recommendation && (
            <div style={{ marginTop: 10 }}>
              <div className="tiny" style={{ fontWeight: 600 }}>Reiz-Empfehlung
                <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: "var(--muted)", border: "1px solid var(--muted)", borderRadius: 999, padding: "0 6px" }}>off · sammelt Daten</span>
              </div>
              <p className="tiny muted" style={{ marginTop: 3 }}>{st.recommendation.rationale}</p>
              {st.recommendation.preferredFamilies.length > 0 && (
                <p className="tiny muted" style={{ marginTop: -2 }}>Schwache Hypothese für diese Phase: {st.recommendation.preferredFamilies.map((f) => FAMILY_LABEL[f] ?? f).join(", ")} <span style={{ fontStyle: "italic" }}>— nicht aktiv, nur zur Einordnung.</span></p>
              )}
              {st.recommendation.cautions.map((c, i) => <p key={i} className="tiny" style={{ margin: "2px 0", color: "var(--warn)" }}>⚠ {c}</p>)}
            </div>
          )}

          {/* Perioden-Log (Beobachtung) */}
          <div style={{ marginTop: 12 }}>
            <div className="tiny" style={{ fontWeight: 600, marginBottom: 4 }}>Perioden-Log <span className="muted">(Start-Datum je Zyklus — treibt das Gate)</span></div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input type="date" value={newPeriod} onChange={(e) => setNewPeriod(e.target.value)} disabled={busy} />
              <button className="btn btn-ghost tiny" disabled={busy || !newPeriod} onClick={addPeriod}>+ Periodenstart</button>
            </div>
            {st.periods && st.periods.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {st.periods.map((p) => (
                  <span key={p.id} className="tiny" style={{ border: "1px solid var(--border-faint)", borderRadius: 999, padding: "1px 8px", display: "inline-flex", gap: 6, alignItems: "center" }}>
                    {fmtDate(p.start_date)}
                    <button className="btn-ghost" style={{ padding: 0, lineHeight: 1, color: "var(--muted)" }} title="löschen" disabled={busy} onClick={() => delPeriod(p.id)}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Symptom-Log (Beobachtung) */}
          <div style={{ marginTop: 12 }}>
            <div className="tiny" style={{ fontWeight: 600, marginBottom: 4 }}>Symptome erfassen <span className="muted">(1 = niedrig … 5 = hoch)</span></div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label className="tiny muted" style={{ display: "flex", flexDirection: "column", gap: 2 }}>Datum
                <input type="date" value={sym.date} onChange={(e) => setSym({ ...sym, date: e.target.value })} disabled={busy} />
              </label>
              {SYMPTOMS.map((s) => (
                <label key={s.key} className="tiny muted" style={{ display: "flex", flexDirection: "column", gap: 2 }}>{s.label}
                  <select value={sym[s.key]} onChange={(e) => setSym({ ...sym, [s.key]: e.target.value })} disabled={busy}>
                    <option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              ))}
              <button className="btn btn-ghost tiny" disabled={busy || !sym.date} onClick={saveSymptom}>Speichern</button>
            </div>
          </div>

          {/* Auswertung: Phase × Reiz-Heatmap (off · sammelt Daten) */}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div className="tiny" style={{ fontWeight: 600 }}>Phase × Reiz — was wirkt bei dir?
                <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: "var(--muted)", border: "1px solid var(--muted)", borderRadius: 999, padding: "0 6px" }}>off · sammelt Daten</span>
              </div>
              <button className="btn btn-ghost tiny" disabled={evalBusy} onClick={reEvaluate}>{evalBusy ? "wertet aus…" : "neu auswerten"}</button>
            </div>
            {!evidence || evidence.length === 0 ? (
              <p className="tiny muted" style={{ marginTop: 4 }}>Noch keine getaggten Einheiten — die Heatmap füllt sich, sobald du Schlüsseleinheiten (mit Zyklus-Tag) im Tracking bewertest. Belastbare Effektgrößen ab ~3 Sessions je Zelle.</p>
            ) : (
              <HeatmapGrid evidence={evidence} />
            )}
            <p className="tiny muted" style={{ marginTop: 6, fontStyle: "italic" }}>Zeigt sich kein konsistenter Effekt (alle CIs überlappen 0), ist phasen-neutrales Training bei dir optimal — ein gültiges Ergebnis, kein Versagen.</p>
          </div>

          <ExpertDetails summary="Datenschutz & Steuerung">
            <div className="tiny" style={{ lineHeight: 1.5 }}>
              <p style={{ marginTop: 0 }}>Alle Zyklusdaten liegen ausschließlich lokal auf diesem Gerät (noch unverschlüsselt — Verschlüsselung folgt). Du kannst sie jederzeit vollständig entfernen.</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-ghost tiny" disabled={busy} onClick={optOut}>Deaktivieren</button>
                <button className="btn btn-ghost tiny" style={{ color: "var(--danger)", borderColor: "var(--danger)" }} disabled={busy} onClick={deleteAll}>Alle Zyklusdaten löschen</button>
              </div>
            </div>
          </ExpertDetails>

          <p className="tiny muted" style={{ marginTop: 8, fontStyle: "italic" }}>{DISCLAIMER}</p>
        </>
      )}
    </div>
  );
}

// Zellen-Farbe: nur bei ≥exploratory färben (ehrlich — schwache Daten bleiben grau). Effektgröße divergierend um 0.
function cellStyle(e: CycleEvidence | undefined): { background: string; color: string } {
  if (!e || e.confidence === "insufficient" || e.effect_size == null) return { background: "var(--bg-soft, rgba(127,127,127,0.05))", color: "var(--muted)" };
  const es = Math.max(-1.5, Math.min(1.5, e.effect_size));
  const a = 0.12 + (Math.abs(es) / 1.5) * 0.42;
  return { background: es >= 0 ? `rgba(34,197,94,${a.toFixed(2)})` : `rgba(239,68,68,${a.toFixed(2)})`, color: "var(--text)" };
}

/** Phase × Reiz-Raster (CSS-Grid): Effektgröße je Zelle, insufficient/leer klar gemutet. */
function HeatmapGrid({ evidence }: { evidence: CycleEvidence[] }) {
  const stims = [...new Set(evidence.map((e) => e.stimulus))].sort();
  const map = new Map(evidence.map((e) => [`${e.phase}|${e.stimulus}`, e]));
  const cols = `minmax(96px, 1.2fr) ${stims.map(() => "minmax(52px, 1fr)").join(" ")}`;
  return (
    <div style={{ marginTop: 8, overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 3, minWidth: 320 }}>
        <div />
        {stims.map((s) => <div key={s} className="tiny muted" style={{ fontWeight: 600, textAlign: "center", padding: "2px 0" }}>{famLabel(s)}</div>)}
        {PHASE_ORDER.map((ph) => (
          <div key={ph} style={{ display: "contents" }}>
            <div className="tiny muted" style={{ display: "flex", alignItems: "center", fontWeight: 600 }}>{PHASE_LABEL[ph] ?? ph}</div>
            {stims.map((s) => {
              const e = map.get(`${ph}|${s}`);
              const st = cellStyle(e);
              const title = e ? `${famLabel(s)} · ${PHASE_LABEL[ph] ?? ph}\nEffekt ${e.effect_size?.toFixed(2)} (CI ${e.ci_low?.toFixed(2)}…${e.ci_high?.toFixed(2)})\nn=${e.n_sessions} · ${e.confidence}` : "keine Daten";
              return (
                <div key={s} title={title} style={{ ...st, borderRadius: 5, minHeight: 34, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 11 }}>
                  {e && e.confidence !== "insufficient" && e.effect_size != null ? (
                    <><span style={{ fontWeight: 700 }}>{e.effect_size > 0 ? "+" : ""}{e.effect_size.toFixed(1)}</span><span style={{ fontSize: 9, opacity: 0.75 }}>n={e.n_sessions}</span></>
                  ) : (
                    <span className="muted" style={{ fontSize: 9 }}>{e ? `n=${e.n_sessions}` : "–"}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="tiny muted" style={{ marginTop: 4 }}>Grün = in dieser Phase besser als dein Reiz-Schnitt · rot = schlechter · grau = noch zu wenig Daten (n&lt;3). Beschreibend, nicht steuernd.</p>
    </div>
  );
}
