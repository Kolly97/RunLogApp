// Block-Wizard (v3.1.0): die EINE Einrichtungs-Stelle des Coaches — Ziel → Wettkämpfe → Umfang → Zeit → Zonen →
// Schwerpunkt → Zusammenfassung. Jeder Schritt zeigt den Engine-Vorschlag MIT Begründung; übernehmen oder
// überschreiben. Didaktisch: ein Satz erklärt, WARUM der Schritt zählt (der Nutzer soll den Plan verstehen,
// nicht nur bekommen). Geschrieben wird nur auf Klick — „Speichern & schließen" (nur Einstellungen) oder
// „Block erstellen" (Einstellungen + Ziel-km + Phasen).
import { useEffect, useMemo, useState } from "react";
import { api, type Availability, type BlockDefaults, type BlockPreviewBody, type CoachMethod, type OptimalZones, type RaceRole, type WeeklyCapacity } from "../../lib/api.ts";
import { fmtDur, paceStr } from "../../lib/util.ts";
import { OverlayPortal } from "../OverlayPortal.tsx";
import BlockPreview from "./BlockPreview.tsx";

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const EMPHASIS = [
  { v: "ausgewogen", l: "Ausgewogen" }, { v: "lt1", l: "LT1 (aerobe Schwelle)" }, { v: "schwelle", l: "Schwelle (LT2)" },
  { v: "vo2", l: "VO2max" }, { v: "berg", l: "Berg" }, { v: "norwegian", l: "Norwegian (sub-T)" }, { v: "fartlek", l: "Fartlek" },
];
const STEPS = ["Ziel", "Wettkämpfe", "Umfang", "Zeit", "Zonen", "Methodik", "Fertig"] as const;
// v3.3.0 (V20): Evidenz-Etikett je Schule (kleine Chip-Darstellung; das volle Token-Set kommt mit V12/Inc 6).
const EV_LABEL: Record<string, string> = { standard: "Standard", lehrbuch: "Lehrbuch", beobachtung: "Beobachtung", rct: "RCT/Meta", praxis: "Trainer-Praxis" };
const EV_COLOR: Record<string, string> = { standard: "var(--muted)", lehrbuch: "#3b82f6", beobachtung: "#d97706", rct: "#16a34a", praxis: "#8b5cf6" };
function EvChip({ e }: { e: string }) {
  return <span className="tiny" style={{ display: "inline-block", padding: "1px 7px", borderRadius: 999, border: `1px solid ${EV_COLOR[e] ?? "var(--line)"}`, color: EV_COLOR[e] ?? "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{EV_LABEL[e] ?? e}</span>;
}
export const STEP_TIME = 3;         // Direkteinstieg aus der Coach-Setup-Zeile („✎ Ändern")
const ROLES: { v: RaceRole; l: string; hint: string }[] = [
  { v: "main", l: "Hauptrennen", hint: "Voller Taper, der Block plant rückwärts von hier." },
  { v: "tuneup", l: "Test-Wettkampf", hint: "Mini-Taper; das Ergebnis füttert den Fortschritts-Check." },
  { v: "ignore", l: "ignorieren", hint: "Steht im Kalender, steuert aber nichts (z. B. Volkslauf)." },
];

const km = (d: number | null | undefined) => (d && d > 0 ? `${(d / 1000).toFixed(d >= 10000 ? 0 : 1)} km` : "—");
const dateDe = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });

/** Eine Wizard-Seite: Frage links, Engine-Vorschlag mit Begründung, dann die Bedienung. */
function Step({ n, title, why, children }: { n: number; title: string; why: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="tiny muted" style={{ letterSpacing: ".08em", textTransform: "uppercase" }}>Schritt {n} von {STEPS.length - 1}</div>
      <h2 style={{ margin: "4px 0 6px" }}>{title}</h2>
      <details style={{ margin: "0 0 14px" }}>
        <summary className="tiny muted" style={{ cursor: "pointer", userSelect: "none", letterSpacing: ".04em" }}>Wozu dieser Schritt?</summary>
        <p className="tiny muted" style={{ margin: "6px 0 0", lineHeight: 1.55, maxWidth: "62ch" }}>{why}</p>
      </details>
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

/** Tages-Auswahl (Feinheiten): nur Tage mit Zeitbudget sind wählbar — sonst plant man ins Leere. */
function DayPicker({ label, days, selected, onToggle }: { label: string; days: number[]; selected: number[]; onToggle: (i: number) => void }) {
  return (
    <div>
      <div className="tiny muted" style={{ marginBottom: 4 }}>{label}</div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {days.map((i) => (
          <button key={i} className={`sm ${selected.includes(i) ? "" : "ghost"}`} onClick={() => onToggle(i)}>{DAYS[i]}</button>
        ))}
      </div>
    </div>
  );
}
const toggle = (arr: number[], i: number): number[] =>
  arr.includes(i) ? arr.filter((x) => x !== i) : [...arr, i].sort((a, b) => a - b);

// Zonen-Tabelle (übernommen aus der früheren „Optimale Zonen"-Karte, die im Coach entfällt): Pace/HF/Watt mit
// QUELLE je Achse — der Nutzer soll sehen, worauf seine Paces beruhen, bevor er sie verbindlich macht.
const Z_LABELS = ["Z1", "Z2", "Z3", "Z4", "Z5", "Z6"];
function ZoneTable({ z }: { z: OptimalZones }) {
  const Col = ({ title, sub, rows }: { title: string; sub: string; rows: (string | null)[] }) => (
    <div>
      <div className="tiny muted" style={{ fontWeight: 700 }}>{title}</div>
      <div className="tiny muted" style={{ marginBottom: 4 }}>{sub}</div>
      {Z_LABELS.map((l, i) => rows[i] != null && (
        <div key={i} className="tiny" style={{ display: "flex", justifyContent: "space-between", gap: 8, lineHeight: 1.7 }}>
          <span className="muted">{l}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{rows[i]}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16, margin: "8px 0 10px" }}>
      <Col title="Pace" sub={z.sources.pace} rows={z.pace_zones.map((s) => `≤ ${paceStr(s)}/km`)} />
      <Col title="Herzfrequenz" sub={z.sources.hr} rows={z.hr_zones.map((h) => `${h.min}–${h.max}`)} />
      <Col title="Watt" sub={z.sources.power ?? "kein CP"} rows={z.power_zones ? z.power_zones.map((w) => `≤ ${w} W`) : Z_LABELS.map(() => null)} />
    </div>
  );
}

export default function BlockWizard({ weekNo, startStep = 0, onClose, onDone, onSaved }: {
  weekNo: number | null;
  startStep?: number;      // Direkteinstieg (Coach-Setup-Zeile springt in den Zeit-Schritt)
  onClose: () => void;
  onDone: () => void;      // Block erstellt → Coach lädt den Block
  onSaved?: () => void;    // nur Einstellungen gespeichert → Coach aktualisiert die Setup-Zeile
}) {
  const [d, setD] = useState<BlockDefaults | null>(null);
  const [err, setErr] = useState("");
  const [step, setStep] = useState(Math.max(0, Math.min(startStep, STEPS.length - 2)));
  const [busy, setBusy] = useState(false);

  // Wizard-Zustand (startet auf den Engine-Vorschlägen, überschreibbar)
  const [startKm, setStartKm] = useState<number>(0);
  const [maxKm, setMaxKm] = useState<number>(0);
  const [av, setAv] = useState<Availability>({ minutesByWeekday: [0, 0, 0, 0, 0, 0, 0] });
  const [emphasis, setEmphasis] = useState<string>("ausgewogen");
  const [emphasisMode, setEmphasisMode] = useState<"auto" | "manual">("auto");
  const [method, setMethod] = useState<CoachMethod>("standard");   // v3.3.0 (V20): Methodik-Schule
  const [takeZones, setTakeZones] = useState(false);
  const [applyPhases, setApplyPhases] = useState(true);   // Phasen (3:1 + Taper) in den Saisonplan schreiben
  const [roles, setRoles] = useState<Record<number, RaceRole>>({});       // aktuelle Rollen-Auswahl
  const [roles0, setRoles0] = useState<Record<number, RaceRole>>({});     // Ausgangszustand → nur Diffs schreiben
  const [dirty, setDirty] = useState(false);             // Muster wie SessionModal: Schließen fragt nach
  const [written, setWritten] = useState<string[] | null>(null);
  // v3.2.0: Was das Zeitbudget hergibt — kommt aus der Vorschau, also aus DEMSELBEN Plan, der rechts steht.
  // Vorher zeigte der Schritt „Zeit" eine Zahl aus der GESPEICHERTEN Verfügbarkeit (deshalb „≈ 158 km möglich"
  // bei 70 min/Woche): sie wurde nie neu gerechnet, während man die Minuten tippte.
  const [cap, setCap] = useState<WeeklyCapacity | null>(null);

  useEffect(() => {
    api.blockDefaults().then((r) => {
      setD(r);
      setStartKm(r.volume.startKm ?? 0);
      setMaxKm(r.volume.maxKm ?? r.volume.startKm ?? 0);
      setAv(r.availability ?? { minutesByWeekday: [0, 60, 0, 60, 0, 0, 90], longRunDay: 6, hardDays: [1, 3] });
      setEmphasis(r.emphasis.suggested ?? r.emphasis.current ?? "ausgewogen");
      setEmphasisMode(r.emphasis.suggested ? "auto" : "manual");
      setMethod(r.method?.current ?? "standard");
      const rr = Object.fromEntries((r.upcomingRaces ?? []).map((x) => [x.id, x.role])) as Record<number, RaceRole>;
      setRoles(rr); setRoles0(rr);
    }).catch(() => setErr("Konnte die Vorschläge nicht laden."));
  }, []);

  // Verfügbarkeit ändern = ungespeicherte Änderung (der Wizard schreibt nichts still).
  const editAv = (next: Availability) => { setAv(next); setDirty(true); };

  // Rollen: genau EIN Hauptrennen (Radio-Semantik) — wer main wird, degradiert das bisherige main zu „ignore".
  const setRole = (id: number, role: RaceRole) => {
    setRoles((cur) => {
      const next = { ...cur, [id]: role };
      if (role === "main") for (const k of Object.keys(next)) if (Number(k) !== id && next[Number(k)] === "main") next[Number(k)] = "ignore";
      return next;
    });
    setDirty(true);
  };
  const changedRoles = () => Object.entries(roles)
    .filter(([id, r]) => roles0[Number(id)] !== r)
    .map(([id, role]) => ({ id: Number(id), role }));

  /** Gemeinsamer Schreibweg: `settingsOnly` unterscheidet „Speichern & schließen" von „Block erstellen". */
  const save = async (settingsOnly: boolean) => {
    if (!d) return;
    setBusy(true);
    try {
      if (!settingsOnly && takeZones && d.zones.optimal) {
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
        raceRoles: changedRoles(),
        method,
        settingsOnly,
      });
      setDirty(false);
      if (settingsOnly) { onSaved?.(); onClose(); return; }
      setWritten([...r.written, ...(takeZones ? ["Zonen-Set (ab heute)"] : [])]);
      setStep(STEPS.length - 1);
    } catch {
      setErr("Speichern fehlgeschlagen — bitte erneut versuchen.");
    } finally { setBusy(false); }
  };

  const tryClose = () => {
    if (dirty && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
    onClose();
  };

  const totalMin = av.minutesByWeekday.reduce((a, b) => a + (b || 0), 0);
  const trainingDayIdx = av.minutesByWeekday.map((m, i) => ({ m, i })).filter((x) => (x.m || 0) > 0).map((x) => x.i);
  const trainDays = trainingDayIdx.length;

  // Live-Vorschau: derselbe echte Blockplan, gerechnet mit den (noch ungespeicherten) Eingaben.
  // `useMemo` hält die Referenz stabil, solange sich nichts Relevantes ändert — sonst würde die
  // entprellte Anfrage bei jedem Render neu anlaufen.
  // v3.2.0: Die Renn-Rollen fahren mit — sonst plant die Vorschau weiter auf das ALTE Hauptrennen, bis gespeichert
  // wurde (Kolja-Befund). `rolesKey` hält die Referenz stabil, ohne bei jedem Render ein neues Array zu bauen.
  const rolesKey = JSON.stringify(roles);
  const previewBody: BlockPreviewBody = useMemo(() => ({
    week: weekNo,
    availability: av,
    startKm: startKm || null,
    maxKm: maxKm || null,
    emphasis: emphasisMode === "manual" ? emphasis : (d?.emphasis.suggested ?? null),
    emphasisMode,
    method,
    derivePhases: applyPhases,
    raceRoles: Object.entries(roles).map(([id, role]) => ({ id: Number(id), role })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [weekNo, av, startKm, maxKm, emphasis, emphasisMode, method, applyPhases, d?.emphasis.suggested, rolesKey]);

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
        <Step n={2} title="Deine Wettkämpfe" why="Ein Rennen ist nicht wie das andere: Auf das Hauptrennen tapert der Block voll und plant rückwärts von seinem Datum. Ein Test-Wettkampf bekommt nur einen Mini-Taper — er ist die ehrlichste Standortbestimmung, die es gibt, und füttert VDOT und Prognose mit echten Daten statt Schätzungen. Ein Volkslauf, der dir egal ist, darf beides nicht: Sag hier, was er ist, sonst plant der Coach still auf ihn hin.">
          {d.upcomingRaces?.length ? (
            <>
              <Suggestion>Genau <strong>ein Hauptrennen</strong>; alles andere ist Test oder wird ignoriert. Für einen {d.weeksToRace ?? 12}-Wochen-Block sind <strong>1–2 Tests</strong> ideal (kürzere Distanz, der letzte ~3 Wochen vor dem Ziel).</Suggestion>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {d.upcomingRaces.map((r) => (
                  <div key={r.id} className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center", padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 8 }}>
                    <span style={{ minWidth: 190, fontSize: 12 }}>
                      <strong>{r.name || "Rennen"}</strong><br />
                      <span className="muted">{dateDe(r.date)} · {km(r.distance_m)}</span>
                    </span>
                    <span className="row" style={{ gap: 4, marginLeft: "auto", flexWrap: "nowrap" }}>
                      {ROLES.map((o) => (
                        <button key={o.v} className={`sm ${roles[r.id] === o.v ? "" : "ghost"}`} title={o.hint}
                          style={{ padding: "4px 10px" }} onClick={() => setRole(r.id, o.v)}>{o.l}</button>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
              {!Object.values(roles).includes("main") && (
                <p className="tiny" style={{ color: "var(--warn)", marginTop: 8 }}>Kein Hauptrennen gewählt — ohne Ziel plant der Coach rollend statt rückwärts vom Renntag.</p>
              )}
              <p className="tiny muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
                Rennen <em>hinter</em> deinem Hauptrennen stehen auf „ignorieren", weil dieser Block dort nicht hinplant —
                das ist keine Wertung. Machst du eines davon zum Hauptrennen, plant der Coach ab sofort dorthin.
              </p>
            </>
          ) : (
            <div className="flag info"><span className="dot" />
              <span>Noch keine kommenden Rennen. Leg sie unter <strong>Races</strong> an (Datum, Distanz, Wunschzeit) — danach vergibst du hier die Rollen.</span>
            </div>
          )}
        </Step>
      );

      case 2: return (
        <Step n={3} title="Umfang" why="Der Wochenumfang ist der Motor — aber er darf nur so schnell wachsen, wie Sehnen und Knochen mitkommen, nicht wie die Lust es zulässt. „Start“ ist, wo du heute wirklich stehst; „Maximum“ ist die Obergrenze, die in der verbleibenden Zeit sicher aufzubauen ist (~6 % je Aufbauwoche, jede vierte Woche Entlastung). Setz das Maximum zu hoch, deckelt die Engine still — du siehst dann rechts Wochen, die dein Ziel nie erreichen.">
          <Suggestion>{d.volume.reason}</Suggestion>
          <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
            <label className="field" style={{ maxWidth: 180 }}><span>Start-km je Woche</span>
              <input type="number" min={0} value={startKm || ""} onChange={(e) => { setStartKm(Number(e.target.value) || 0); setDirty(true); }} />
            </label>
            <label className="field" style={{ maxWidth: 180 }}><span>Maximum im Block</span>
              <input type="number" min={0} value={maxKm || ""} onChange={(e) => { setMaxKm(Number(e.target.value) || 0); setDirty(true); }} />
            </label>
          </div>
          {maxKm > 0 && startKm > 0 && maxKm > startKm * 1.6 && (
            <p className="tiny" style={{ color: "var(--warn)" }}>
              Das Maximum liegt über dem 1,6-fachen deines Starts — über einen kurzen Block ist das sportlich ambitioniert.
              Die Engine deckelt die Rampe trotzdem hart (Verletzungsschutz), du erreichst das Maximum dann evtl. nicht.
            </p>
          )}
          {/* v3.2.0: die LIVE-Kapazität (aus der Vorschau) gewinnt über den gespeicherten Stand — sonst warnt der
              Schritt gegen ein Zeitbudget, das der Nutzer im nächsten Schritt längst geändert hat. */}
          {(cap?.kmCap ?? d.volume.kmByTime) != null && maxKm > (cap?.kmCap ?? d.volume.kmByTime)! && (
            <p className="tiny" style={{ color: "var(--warn)" }}>
              Mehr als ~{cap?.kmCap ?? d.volume.kmByTime} km passen nicht in dein Zeitbudget (nächster Schritt).
            </p>
          )}
        </Step>
      );

      case 3: return (
        <Step n={4} title="Deine Zeit" why="Trag ein, wie viel Zeit du hast — nicht, wie viel du trainieren willst. Das Budget ist eine Obergrenze: Der Coach plant, was dein Ziel verlangt, und kürzt nur, wenn die Zeit nicht reicht. Drei freie Stunden am Sonntag werden deshalb NICHT zu einem 30-km-Longrun, wenn du auf 10 km zielst — der lange Lauf bleibt ein Anteil deines Wochenumfangs. Harte Tage brauchen ≥ 48 h Abstand.">
          <Suggestion>
            {trainDays} Trainingstage · {totalMin} min/Woche
            {cap?.kmCap != null && <> · daraus <strong>höchstens ~{cap.kmCap} km</strong> und ~{cap.tssCap} TSS je Woche</>}
          </Suggestion>
          {cap?.kmCap != null && maxKm > cap.kmCap && (
            <p className="tiny" style={{ color: "var(--warn)", marginTop: -4 }}>
              Dein Maximum ({maxKm} km) passt nicht in dieses Zeitbudget — der Coach plant die machbaren {cap.kmCap} km
              und sagt dir rechts, wie viel Zeit für dein Ziel fehlt.
            </p>
          )}
          <table style={{ width: "100%", fontSize: 13 }}>
            <thead><tr><th style={{ textAlign: "left" }}>Tag</th><th style={{ textAlign: "left" }}>Minuten</th><th>Longrun</th><th>harter Tag</th></tr></thead>
            <tbody>
              {DAYS.map((day, i) => (
                <tr key={day}>
                  <td style={{ fontWeight: 600 }}>{day}</td>
                  <td>
                    <input type="number" min={0} step={15} style={{ width: 90 }} value={av.minutesByWeekday[i] || ""}
                      onChange={(e) => { const m = [...av.minutesByWeekday]; m[i] = Number(e.target.value) || 0; editAv({ ...av, minutesByWeekday: m }); }} />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <input type="radio" name="lrd" checked={av.longRunDay === i} onChange={() => editAv({ ...av, longRunDay: i })} />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <input type="checkbox" checked={!!av.hardDays?.includes(i)}
                      onChange={(e) => {
                        const set = new Set(av.hardDays ?? []);
                        if (e.target.checked) set.add(i); else set.delete(i);
                        editAv({ ...av, hardDays: [...set].sort() });
                      }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(av.hardDays?.length ?? 0) > 2 && (
            <p className="tiny" style={{ color: "var(--warn)" }}>Mehr als 2 harte Tage sind nur bei hoher Fitness sinnvoll — die Engine setzt trotzdem nie mehr, als deine Phase und Fitness vertragen.</p>
          )}

          {/* Feinheiten: seltener gebraucht, deshalb eingeklappt — aber hier, nicht in einer zweiten Karte. */}
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Feinheiten (Berg, Stabi/Core, Doppeleinheiten)</summary>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="row" style={{ gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
                <label className="field" style={{ margin: 0, width: 150 }}><span>Berglauf-Tag</span>
                  <select value={av.hillDay ?? ""} onChange={(e) => editAv({ ...av, hillDay: e.target.value !== "" ? Number(e.target.value) : null })}>
                    <option value="">—</option>
                    {DAYS.map((day, i) => <option key={i} value={i}>{day}</option>)}
                  </select>
                </label>
                <label className="field" style={{ margin: 0, width: 150 }}><span>Stabi/Core pro Woche</span>
                  <select value={av.corePerWeek ?? 0} onChange={(e) => editAv({ ...av, corePerWeek: Number(e.target.value) })}>
                    {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label className="field" style={{ margin: 0, width: 150 }}><span>Doppeleinheiten</span>
                  <select value={av.allowDoubles ? "yes" : "no"} onChange={(e) => editAv({ ...av, allowDoubles: e.target.value === "yes" })}>
                    <option value="no">Nein</option>
                    <option value="yes">Ja</option>
                  </select>
                </label>
              </div>
              {(av.corePerWeek ?? 0) > 0 && trainingDayIdx.length > 0 && (
                <DayPicker label="Bevorzugte Stabi/Core-Tage (sonst an Easy-Tage angehängt)" days={trainingDayIdx}
                  selected={av.coreDays ?? []} onToggle={(i) => editAv({ ...av, coreDays: toggle(av.coreDays ?? [], i) })} />
              )}
              {av.allowDoubles && trainingDayIdx.length > 0 && (
                <DayPicker label="Bevorzugte Tage für eine 2. lockere Einheit" days={trainingDayIdx}
                  selected={av.doubleDays ?? []} onToggle={(i) => editAv({ ...av, doubleDays: toggle(av.doubleDays ?? [], i) })} />
              )}
            </div>
          </details>
        </Step>
      );

      case 4: return (
        <Step n={5} title="Zonen für den Block" why="Jede Pace, jeder Puls-Korridor und jede TSS-Zahl im Plan hängt an deinen Zonen. Sind sie veraltet, rechnet die App sauber — nur am falschen Anker: Du läufst deine lockeren Läufe dann systematisch zu schnell und deine Schwelle zu langsam. Nach jedem Leistungssprung lohnt das Update.">
          {d.zones.optimal ? (
            <>
              <Suggestion>
                Aus deinen aktuellen Leistungsdaten (VDOT {d.zones.vdot ?? "—"}) berechnete <strong>optimale Zonen</strong> — Quelle je Achse steht über der Spalte.
              </Suggestion>
              <div data-tour="optimal-zones"><ZoneTable z={d.zones.optimal} /></div>
              <label className="row" style={{ gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={takeZones} onChange={(e) => { setTakeZones(e.target.checked); setDirty(true); }} />
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
        <Step n={6} title="Methodik & Schwerpunkt" why="Zwei Ebenen: Erst die SCHULE — die Denkweise, nach der deine Woche gebaut wird (Daniels-Präzision, Norwegian-Schwellenvolumen, Polarized hart/locker, Canova-Renntempo). Keine ist für jeden überlegen; darum empfiehlt der Coach eine aus deiner Distanz, du entscheidest — „Standard“ bleibt die bewährte Mischung. Dann der SCHWERPUNKT — der Feinregler INNERHALB der Schule für den freien Qualitäts-Slot; deine Daten drehen ihn sanft (beobachtet) oder stark (kausal geprüft), Pflicht-Einheiten und Gesundheits-Signale übersteuern alles.">
          {/* v3.3.0 (V20): Methodik-Schule — kompakt; Erklärungen einklappbar (ruhiger). */}
          <div className="tiny" style={{ marginBottom: 6 }}>
            Empfohlen für <strong>deine Distanz</strong>: <strong>{d.method.recommendedLabel}</strong> <EvChip e={d.method.recommendedEvidence} />
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            {d.method.options.map((o) => (
              <button key={o.key} className={`sm ${method === o.key ? "" : "ghost"}`} style={{ padding: "6px 12px", fontWeight: 600 }}
                onClick={() => { setMethod(o.key); setDirty(true); }} title={o.blurb}>
                {o.label}{o.key === d.method.recommended ? " ★" : ""}
              </button>
            ))}
          </div>
          {(() => { const sel = d.method.options.find((o) => o.key === method); return sel ? (
            <details style={{ marginBottom: 12 }}>
              <summary className="tiny muted" style={{ cursor: "pointer", userSelect: "none" }}>Was bedeutet „{sel.label}“?</summary>
              <p className="tiny muted" style={{ margin: "6px 0 0", lineHeight: 1.5 }}>
                <EvChip e={sel.evidence} /> {sel.blurb}
                <br /><span style={{ opacity: .75 }}>Aufbau-Verteilung ~{sel.distBuild.easy}/{sel.distBuild.threshold}/{sel.distBuild.vo2} (easy/Schwelle/VO2){sel.doubles === "active" ? " · Doppeleinheiten aktiv" : ""}.</span>{" "}
                Keine Schule ist für jeden überlegen — die Wahl und deine eigene Evidenz entscheiden. „Standard“ = die bewährte Mischung.
              </p>
            </details>
          ) : null; })()}
          <div className="tiny muted" style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginBottom: 6, fontWeight: 600 }}>Schwerpunkt — Feinregler innerhalb der Schule</div>
          <div className="row" style={{ gap: 6, marginBottom: 8 }}>
            <button className={`sm ${emphasisMode === "auto" ? "" : "ghost"}`} onClick={() => { setEmphasisMode("auto"); if (d.emphasis.suggested) setEmphasis(d.emphasis.suggested); setDirty(true); }}>Auto (Evidenz)</button>
            <button className={`sm ${emphasisMode === "manual" ? "" : "ghost"}`} onClick={() => { setEmphasisMode("manual"); setDirty(true); }}>Selbst wählen</button>
          </div>
          {emphasisMode === "manual" && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {EMPHASIS.map((o) => (
                <button key={o.v} className={`sm ${emphasis === o.v ? "" : "ghost"}`} style={{ padding: "6px 13px", fontWeight: 600 }}
                  onClick={() => { setEmphasis(o.v); setDirty(true); }}>{o.l}</button>
              ))}
            </div>
          )}
          <details style={{ marginBottom: 4 }}>
            <summary className="tiny muted" style={{ cursor: "pointer", userSelect: "none" }}>Warum dieser Schwerpunkt?</summary>
            <p className="tiny muted" style={{ margin: "6px 0 0", lineHeight: 1.5 }}>
              {d.emphasis.suggested
                ? <>Vorschlag aus deinen Daten: <strong>{d.emphasis.label}</strong> ({d.emphasis.tier}{d.emphasis.confidence ? `, Konfidenz ${d.emphasis.confidence}` : ""}). {d.emphasis.rationale}</>
                : <>{d.emphasis.rationale}</>}
            </p>
          </details>
          {d.healthCap?.reason && (
            <p className="tiny" style={{ color: "var(--warn)", marginTop: 8 }}>{d.healthCap.reason} — Gesundheit übersteuert jeden Schwerpunkt.</p>
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
      <div style={overlay} onClick={tryClose}>
        <div className="card" style={panel} onClick={(e) => e.stopPropagation()}>
          <div className="spread" style={{ alignItems: "center", marginBottom: 6 }}>
            <strong>Wettkampf-Block einrichten</strong>
            <button className="ghost sm" onClick={tryClose}>✕</button>
          </div>
          {/* Fortschritts-Punkte — anklickbar: die Einstellung ändern, ohne 6 Schritte durchzuklicken. */}
          <div className="row" style={{ gap: 6, marginBottom: 14 }}>
            {STEPS.slice(0, -1).map((s, i) => (
              <button key={s} title={s} disabled={done} onClick={() => setStep(i)} aria-label={s} style={{
                flex: 1, height: 3, borderRadius: 2, padding: 0, border: "none", cursor: done ? "default" : "pointer",
                background: i <= step ? "var(--accent)" : "var(--border)",
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

              <div className="spread" style={{ marginTop: 16, gap: 8 }}>
                <button className="ghost sm" disabled={step === 0 || done || busy} onClick={() => setStep((s) => Math.max(0, s - 1))}>Zurück</button>
                <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                  {/* Nur die Einstellungen sichern — für „Donnerstag von 100 auf 60 min", ohne den Block neu zu bauen. */}
                  {!done && (
                    <button className="ghost sm" disabled={busy || !d} onClick={() => save(true)}
                      title="Speichert Verfügbarkeit, Schwerpunkt-Modus und Renn-Rollen — ohne Ziel-km und ohne Phasen zu schreiben.">
                      {busy ? "…" : "Speichern & schließen"}
                    </button>
                  )}
                  {done ? (
                    <button className="primary sm" onClick={onDone}>Blockplan laden →</button>
                  ) : last ? (
                    <button className="primary sm" disabled={busy || !d} onClick={() => save(false)}>{busy ? "speichert…" : "Block erstellen"}</button>
                  ) : (
                    <button className="primary sm" disabled={!d} onClick={() => setStep((s) => s + 1)}>Weiter</button>
                  )}
                </div>
              </div>
            </div>

            {/* Live-Vorschau: der echte Blockplan zu den aktuellen Eingaben (entprellt, schreibt nichts). */}
            {d && !done && <BlockPreview body={previewBody} goalTimeS={d.race?.goal_time_s ?? null} onPlan={(p) => setCap(p.capacity ?? null)} />}
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
