// Block-Wizard (v3.1.0): geführte Blockplan-Erstellung — Ziel → Zwischenziele → Umfang → Zeit → Zonen →
// Schwerpunkt → Zusammenfassung. Jeder Schritt zeigt den Engine-Vorschlag MIT Begründung; übernehmen oder
// überschreiben. Didaktisch: ein Satz erklärt, WARUM der Schritt zählt (der Nutzer soll den Plan verstehen,
// nicht nur bekommen). Geschrieben wird erst am Ende — und nur, was bestätigt wurde.
import { useEffect, useMemo, useState } from "react";
import { api, type Availability, type BlockDefaults, type BlockPreviewBody, type OptimalZones } from "../../lib/api.ts";
import { fmtDur, paceStr } from "../../lib/util.ts";
import { OverlayPortal } from "../OverlayPortal.tsx";
import BlockPreview from "./BlockPreview.tsx";

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const EMPHASIS = [
  { v: "ausgewogen", l: "Ausgewogen" }, { v: "lt1", l: "LT1 (aerobe Schwelle)" }, { v: "schwelle", l: "Schwelle (LT2)" },
  { v: "vo2", l: "VO2max" }, { v: "berg", l: "Berg" }, { v: "norwegian", l: "Norwegian (sub-T)" }, { v: "fartlek", l: "Fartlek" },
];
const STEPS = ["Ziel", "Zwischenziele", "Umfang", "Zeit", "Zonen", "Schwerpunkt", "Fertig"] as const;

const km = (d: number | null | undefined) => (d && d > 0 ? `${(d / 1000).toFixed(d >= 10000 ? 0 : 1)} km` : "—");
const dateDe = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });

/** Eine Wizard-Seite: Frage links, Engine-Vorschlag mit Begründung, dann die Bedienung. */
function Step({ n, title, why, children }: { n: number; title: string; why: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="tiny muted" style={{ letterSpacing: ".08em", textTransform: "uppercase" }}>Schritt {n} von {STEPS.length - 1}</div>
      <h2 style={{ margin: "4px 0 6px" }}>{title}</h2>
      <p className="tiny muted" style={{ margin: "0 0 14px", lineHeight: 1.55, maxWidth: "62ch" }}>{why}</p>
      {children}
    </div>
  );
}

function Suggestion({ children }: { children: React.ReactNode }) {
  return (
    <div className="flag info" style={{ alignItems: "flex-start", marginBottom: 12 }}>
      <span className="dot" style={{ background: "var(--accent)" }} />
      <span style={{ lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

export default function BlockWizard({ weekNo, onClose, onDone }: {
  weekNo: number | null;
  onClose: () => void;
  onDone: () => void;      // Setup geschrieben → Coach lädt den Block
}) {
  const [d, setD] = useState<BlockDefaults | null>(null);
  const [err, setErr] = useState("");
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // Wizard-Zustand (startet auf den Engine-Vorschlägen, überschreibbar)
  const [startKm, setStartKm] = useState<number>(0);
  const [maxKm, setMaxKm] = useState<number>(0);
  const [av, setAv] = useState<Availability>({ minutesByWeekday: [0, 0, 0, 0, 0, 0, 0] });
  const [emphasis, setEmphasis] = useState<string>("ausgewogen");
  const [emphasisMode, setEmphasisMode] = useState<"auto" | "manual">("auto");
  const [takeZones, setTakeZones] = useState(false);
  const [applyPhases, setApplyPhases] = useState(true);   // Phasen (3:1 + Taper) in den Saisonplan schreiben
  const [written, setWritten] = useState<string[] | null>(null);

  useEffect(() => {
    api.blockDefaults().then((r) => {
      setD(r);
      setStartKm(r.volume.startKm ?? 0);
      setMaxKm(r.volume.maxKm ?? r.volume.startKm ?? 0);
      setAv(r.availability ?? { minutesByWeekday: [0, 60, 0, 60, 0, 0, 90], longRunDay: 6, hardDays: [1, 3] });
      setEmphasis(r.emphasis.suggested ?? r.emphasis.current ?? "ausgewogen");
      setEmphasisMode(r.emphasis.suggested ? "auto" : "manual");
    }).catch(() => setErr("Konnte die Vorschläge nicht laden."));
  }, []);

  const finish = async () => {
    if (!d) return;
    setBusy(true);
    try {
      if (takeZones && d.zones.optimal) {
        const oz = d.zones.optimal as OptimalZones & { pace_zones?: unknown; hr_zones?: unknown; threshold_pace?: number | null };
        await api.addZoneset({
          valid_from: d.today,
          pace_zones: (oz.pace_zones ?? undefined) as never,
          hr_zones: (oz.hr_zones ?? undefined) as never,
          threshold_pace: (oz.threshold_pace ?? null) as never,
        });
      }
      const r = await api.blockSetup({
        availability: av, startKm, maxKm,
        emphasis: emphasisMode === "manual" ? emphasis : (d.emphasis.suggested ?? emphasis),
        emphasisMode, fromWeek: weekNo, applyPhases,
      });
      setWritten([...r.written, ...(takeZones ? ["Zonen-Set (ab heute)"] : [])]);
      setStep(STEPS.length - 1);
    } catch {
      setErr("Speichern fehlgeschlagen — bitte erneut versuchen.");
    } finally { setBusy(false); }
  };

  const totalMin = av.minutesByWeekday.reduce((a, b) => a + (b || 0), 0);
  const trainDays = av.minutesByWeekday.filter((m) => (m || 0) > 0).length;

  // Live-Vorschau: derselbe echte Blockplan, gerechnet mit den (noch ungespeicherten) Eingaben.
  // `useMemo` hält die Referenz stabil, solange sich nichts Relevantes ändert — sonst würde die
  // entprellte Anfrage bei jedem Render neu anlaufen.
  const previewBody: BlockPreviewBody = useMemo(() => ({
    week: weekNo,
    availability: av,
    startKm: startKm || null,
    maxKm: maxKm || null,
    emphasis: emphasisMode === "manual" ? emphasis : (d?.emphasis.suggested ?? null),
    emphasisMode,
    derivePhases: applyPhases,
  }), [weekNo, av, startKm, maxKm, emphasis, emphasisMode, applyPhases, d?.emphasis.suggested]);

  const body = () => {
    if (err && !d) return <p className="flag danger"><span className="dot" />{err}</p>;
    if (!d) return <p className="muted">Lade Vorschläge…</p>;

    switch (step) {
      case 0: return (
        <Step n={1} title="Dein Ziel" why="Alles hängt am Renntag. Die Distanz entscheidet, welche Einheiten überhaupt Pflicht sind (Marathon → Schwelle und langer Lauf, 10 km → VO2max), die Wunschzeit setzt die Paces, und der Abstand zum Rennen bestimmt Aufbau und Taper. Rechts siehst du ab sofort mit, was daraus wird.">
          {!d.race ? (
            <div className="flag warn"><span className="dot" />
              <span>Noch kein Ziel-Rennen angelegt. Leg es unter <strong>Races</strong> an (Datum, Distanz, Wunschzeit) — dann kann der Coach rückwärts vom Renntag planen.</span>
            </div>
          ) : (
            <>
              <Suggestion>
                <strong>{d.race.name || "Zielrennen"}</strong> · {dateDe(d.race.date)} · {km(d.race.distance_m)}
                {d.weeksToRace != null && <> · noch <strong>{d.weeksToRace} Wochen</strong></>}
                {d.race.goal_time_s ? <> · Wunschzeit <strong>{fmtDur(d.race.goal_time_s)}</strong></> : <> · <em>keine Wunschzeit gesetzt</em></>}
              </Suggestion>
              {d.forecast && (
                <p className="tiny" style={{ lineHeight: 1.6 }}>
                  Heute bist du bereit für ~<strong>{d.forecast.nowTimeS ? fmtDur(d.forecast.nowTimeS) : "—"}</strong>.
                  {d.forecast.projEndTimeS && <> Am Renntag realistisch: <strong>{fmtDur(d.forecast.projEndTimeS)}</strong> (projizierte VO2max {d.forecast.projEndVdot}).</>}
                  {d.forecast.goalTimeS != null && d.forecast.feasible != null && (
                    <> {d.forecast.feasible
                      ? <span style={{ color: "var(--ok)" }}>Dein Ziel liegt im erreichbaren Bereich.</span>
                      : <span style={{ color: "var(--warn)" }}>Dein Ziel ist sehr ambitioniert — die Prognose erreicht es im Blockzeitraum nicht. Der Plan zielt trotzdem so nah wie möglich heran.</span>}
                    </>
                  )}
                </p>
              )}
              {d.distanceConcept && (
                <div className="tiny muted" style={{ marginTop: 10, lineHeight: 1.6 }}>
                  <strong>{d.distanceConcept.label}:</strong> {d.distanceConcept.metabolic}<br />
                  Schlüssel-Einheiten: {d.distanceConcept.keySessions.join(" · ")}<br />
                  {d.distanceConcept.longRunNote}
                </div>
              )}
            </>
          )}
        </Step>
      );

      case 1: return (
        <Step n={2} title="Zwischenziele" why="Ein Test-Wettkampf ist die ehrlichste Standortbestimmung, die es gibt: Er füttert VDOT und Critical Speed mit echten Daten statt Schätzungen — und er sagt dir rechtzeitig, ob die Wunschzeit noch trägt. Ohne Test rechnet der Coach die Prognose aus Trainingsläufen; das geht, ist aber unschärfer.">
          {d.tuneups.length ? (
            <>
              <Suggestion>{d.tuneups.length} Test-Wettkampf{d.tuneups.length > 1 ? "e" : ""} im Plan — sie bekommen automatisch einen Mini-Taper und speisen den Fortschritts-Check.</Suggestion>
              <ul className="tiny" style={{ margin: 0, paddingLeft: 18 }}>
                {d.tuneups.map((t) => <li key={t.id}>{dateDe(t.date)} · {t.name || "Test"} · {km(t.distance_m)}</li>)}
              </ul>
            </>
          ) : (
            <div className="flag info"><span className="dot" />
              <span>Noch keine Zwischenziele. Empfehlung für einen {d.weeksToRace ?? 12}-Wochen-Block: <strong>1–2 Test-Wettkämpfe</strong> über eine kürzere Distanz (z. B. 5–10 km), der letzte ~3 Wochen vor dem Ziel. Anlegen unter <strong>Races</strong> mit Häkchen „Test-Wettkampf" — der Wizard läuft danach einfach weiter.</span>
            </div>
          )}
        </Step>
      );

      case 2: return (
        <Step n={3} title="Umfang" why="Der Wochenumfang ist der Motor — aber er darf nur so schnell wachsen, wie Sehnen und Knochen mitkommen, nicht wie die Lust es zulässt. „Start“ ist, wo du heute wirklich stehst; „Maximum“ ist die Obergrenze, die in der verbleibenden Zeit sicher aufzubauen ist (~6 % je Aufbauwoche, jede vierte Woche Entlastung). Setz das Maximum zu hoch, deckelt die Engine still — du siehst dann rechts Wochen, die dein Ziel nie erreichen.">
          <Suggestion>{d.volume.reason}</Suggestion>
          <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
            <label className="field" style={{ maxWidth: 180 }}><span>Start-km je Woche</span>
              <input type="number" min={0} value={startKm || ""} onChange={(e) => setStartKm(Number(e.target.value) || 0)} />
            </label>
            <label className="field" style={{ maxWidth: 180 }}><span>Maximum im Block</span>
              <input type="number" min={0} value={maxKm || ""} onChange={(e) => setMaxKm(Number(e.target.value) || 0)} />
            </label>
          </div>
          {maxKm > 0 && startKm > 0 && maxKm > startKm * 1.6 && (
            <p className="tiny" style={{ color: "var(--warn)" }}>
              Das Maximum liegt über dem 1,6-fachen deines Starts — über einen kurzen Block ist das sportlich ambitioniert.
              Die Engine deckelt die Rampe trotzdem hart (Verletzungsschutz), du erreichst das Maximum dann evtl. nicht.
            </p>
          )}
          {d.volume.kmByTime != null && maxKm > d.volume.kmByTime && (
            <p className="tiny" style={{ color: "var(--warn)" }}>Mehr als ~{d.volume.kmByTime} km passen nicht in dein Zeitbudget (nächster Schritt).</p>
          )}
        </Step>
      );

      case 3: return (
        <Step n={4} title="Deine Zeit" why="Trag ein, wie viel Zeit du hast — nicht, wie viel du trainieren willst. Das Budget ist eine Obergrenze: Der Coach plant, was dein Ziel verlangt, und kürzt nur, wenn die Zeit nicht reicht. Drei freie Stunden am Sonntag werden deshalb NICHT zu einem 30-km-Longrun, wenn du auf 10 km zielst — der lange Lauf bleibt ein Anteil deines Wochenumfangs. Harte Tage brauchen ≥ 48 h Abstand.">
          <Suggestion>{trainDays} Trainingstage · {totalMin} min/Woche{d.volume.kmByTime ? ` (≈ ${d.volume.kmByTime} km möglich)` : ""}</Suggestion>
          <table style={{ width: "100%", fontSize: 13 }}>
            <thead><tr><th style={{ textAlign: "left" }}>Tag</th><th style={{ textAlign: "left" }}>Minuten</th><th>Longrun</th><th>harter Tag</th></tr></thead>
            <tbody>
              {DAYS.map((day, i) => (
                <tr key={day}>
                  <td style={{ fontWeight: 600 }}>{day}</td>
                  <td>
                    <input type="number" min={0} step={15} style={{ width: 90 }} value={av.minutesByWeekday[i] || ""}
                      onChange={(e) => { const m = [...av.minutesByWeekday]; m[i] = Number(e.target.value) || 0; setAv({ ...av, minutesByWeekday: m }); }} />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <input type="radio" name="lrd" checked={av.longRunDay === i} onChange={() => setAv({ ...av, longRunDay: i })} />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <input type="checkbox" checked={!!av.hardDays?.includes(i)}
                      onChange={(e) => {
                        const set = new Set(av.hardDays ?? []);
                        if (e.target.checked) set.add(i); else set.delete(i);
                        setAv({ ...av, hardDays: [...set].sort() });
                      }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(av.hardDays?.length ?? 0) > 2 && (
            <p className="tiny" style={{ color: "var(--warn)" }}>Mehr als 2 harte Tage sind nur bei hoher Fitness sinnvoll — die Engine setzt trotzdem nie mehr, als deine Phase und Fitness vertragen.</p>
          )}
        </Step>
      );

      case 4: return (
        <Step n={5} title="Zonen für den Block" why="Jede Pace, jeder Puls-Korridor und jede TSS-Zahl im Plan hängt an deinen Zonen. Sind sie veraltet, rechnet die App sauber — nur am falschen Anker: Du läufst deine lockeren Läufe dann systematisch zu schnell und deine Schwelle zu langsam. Nach jedem Leistungssprung lohnt das Update.">
          {d.zones.optimal ? (
            <>
              <Suggestion>
                Aus deinen aktuellen Leistungsdaten (VDOT {d.zones.vdot ?? "—"}) berechnete <strong>optimale Zonen</strong> — Quelle je Achse: Pace aus VDOT/Critical Speed, Puls aus Laktat/LTHR.
              </Suggestion>
              <label className="row" style={{ gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={takeZones} onChange={(e) => setTakeZones(e.target.checked)} />
                <span>Als aktives Zonen-Set ab heute übernehmen (alte Wochen behalten ihre damaligen Zonen)</span>
              </label>
              {d.zones.current.threshold_pace && (
                <p className="tiny muted" style={{ marginTop: 8 }}>
                  Aktuell: Schwellen-Pace {paceStr(d.zones.current.threshold_pace)}/km{d.zones.current.lt1_pace ? ` · LT1 ${paceStr(d.zones.current.lt1_pace)}/km` : ""}
                </p>
              )}
            </>
          ) : (
            <div className="flag info"><span className="dot" /><span>Noch zu wenig Leistungsdaten für einen Zonen-Vorschlag — der Block nutzt deine aktuellen Zonen aus dem Profil.</span></div>
          )}
        </Step>
      );

      case 5: return (
        <Step n={6} title="Schwerpunkt" why="Letzte Frage: Welcher Reiz bekommt den freien Qualitäts-Slot? Die Pflicht-Einheiten deiner Distanz stehen ohnehin — beim Marathon der lange Lauf und die Schwelle, beim 10er VO2max. Was deine Daten sagen, darf den REST drehen: ein beobachtetes Muster sanft, ein kausal geprüftes Experiment stark. Nichts davon kippt die Pflicht — und Gesundheits-Signale kippen alles.">
          <Suggestion>
            {d.emphasis.suggested
              ? <>Vorschlag aus deinen Daten: <strong>{d.emphasis.label}</strong> ({d.emphasis.tier}{d.emphasis.confidence ? `, Konfidenz ${d.emphasis.confidence}` : ""}). {d.emphasis.rationale}</>
              : <>{d.emphasis.rationale}</>}
          </Suggestion>
          <div className="row" style={{ gap: 6, marginBottom: 10 }}>
            <button className={`sm ${emphasisMode === "auto" ? "" : "ghost"}`} onClick={() => { setEmphasisMode("auto"); if (d.emphasis.suggested) setEmphasis(d.emphasis.suggested); }}>Auto (Evidenz)</button>
            <button className={`sm ${emphasisMode === "manual" ? "" : "ghost"}`} onClick={() => setEmphasisMode("manual")}>Selbst wählen</button>
          </div>
          {emphasisMode === "manual" && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {EMPHASIS.map((o) => (
                <button key={o.v} className={`sm ${emphasis === o.v ? "" : "ghost"}`} style={{ padding: "6px 13px", fontWeight: 600 }}
                  onClick={() => setEmphasis(o.v)}>{o.l}</button>
              ))}
            </div>
          )}
          {d.healthCap?.reason && (
            <p className="tiny" style={{ color: "var(--warn)", marginTop: 10 }}>{d.healthCap.reason} — Gesundheit übersteuert jeden Schwerpunkt.</p>
          )}
        </Step>
      );

      default: return (
        <div>
          <h2 style={{ marginTop: 0 }}>Block startklar 🏁</h2>
          <p className="tiny" style={{ lineHeight: 1.6 }}>
            Gespeichert: {written?.length ? written.join(" · ") : "—"}.
          </p>
          <p className="tiny" style={{ lineHeight: 1.6 }}>
            Der Block ist eine Landkarte, kein Vertrag: Übernommen wird <strong>Woche für Woche</strong> in die
            Wochenplanung — so bleibt Raum, auf Form, Readiness und das echte Leben zu reagieren. Umfang und Zeit
            änderst du jederzeit im Coach, Phasen im Saisonplan, einzelne Einheiten in der Wochenplanung.
          </p>
        </div>
      );
    }
  };

  const last = step === STEPS.length - 2;      // Schwerpunkt = letzter Eingabeschritt
  const done = step === STEPS.length - 1;

  return (
    <OverlayPortal>
      <div style={overlay} onClick={onClose}>
        <div className="card" style={panel} onClick={(e) => e.stopPropagation()}>
          <div className="spread" style={{ alignItems: "center", marginBottom: 6 }}>
            <strong>Wettkampf-Block einrichten</strong>
            <button className="ghost sm" onClick={onClose}>✕</button>
          </div>
          {/* Fortschritts-Punkte */}
          <div className="row" style={{ gap: 6, marginBottom: 14 }}>
            {STEPS.slice(0, -1).map((s, i) => (
              <span key={s} title={s} style={{
                flex: 1, height: 3, borderRadius: 2,
                background: i < step ? "var(--accent)" : i === step ? "var(--accent)" : "var(--border)",
                opacity: i <= step ? 1 : 0.4,
              }} />
            ))}
          </div>

          {/* Zwei Spalten: links die Frage, rechts der Plan, den sie erzeugt. Auf schmalen Fenstern stapelt es. */}
          <div className="bw-grid">
            <div style={{ minWidth: 0 }}>
              <div style={{ minHeight: 300 }}>{body()}</div>

              {err && d && <p className="tiny" style={{ color: "var(--danger)" }}>{err}</p>}

              {/* Abschluss-Optionen: was wird geschrieben? */}
              {last && d && (
                <label className="row tiny" style={{ gap: 8, alignItems: "flex-start", marginTop: 14 }}>
                  <input type="checkbox" checked={applyPhases} onChange={(e) => setApplyPhases(e.target.checked)} style={{ marginTop: 2 }} />
                  <span style={{ lineHeight: 1.5 }}>
                    <strong>Phasen in den Saisonplan übernehmen</strong> — Aufbau, Entlastungswochen (3:1) und der
                    distanzgerechte Taper werden rückwärts vom Renntag gesetzt. Manuell gepinnte Phasen bleiben.
                    Ohne Haken bleibt dein Saisonplan unverändert; die Ziel-km werden trotzdem geschrieben.
                  </span>
                </label>
              )}

              <div className="spread" style={{ marginTop: 16 }}>
                <button className="ghost sm" disabled={step === 0 || done || busy} onClick={() => setStep((s) => Math.max(0, s - 1))}>Zurück</button>
                {done ? (
                  <button className="primary sm" onClick={onDone}>Blockplan laden →</button>
                ) : last ? (
                  <button className="primary sm" disabled={busy || !d} onClick={finish}>{busy ? "speichert…" : "Block erstellen"}</button>
                ) : (
                  <button className="primary sm" disabled={!d} onClick={() => setStep((s) => s + 1)}>Weiter</button>
                )}
              </div>
            </div>

            {/* Live-Vorschau: der echte Blockplan zu den aktuellen Eingaben (entprellt, schreibt nichts). */}
            {d && !done && <BlockPreview body={previewBody} goalTimeS={d.race?.goal_time_s ?? null} />}
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(20,28,44,0.5)", zIndex: 60,
  display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 16px",
};
const panel: React.CSSProperties = { width: 1120, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", marginBottom: 0 };
