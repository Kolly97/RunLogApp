// Isabel-Tutorial-Engine (v2.10.0): führt die Abschnitte aus sections.ts als Overlay über der echten App aus.
// Step-Arten: say (Spotlight/zentriert) · task (angedockte Karte, App bleibt bedienbar, Check pollt) ·
// quiz (Verständnisfrage mit Feedback) · scene (Isabel-3D-Abschluss). Auto-Start beim ersten App-Start
// (mit Skip); Fortschritt je Abschnitt via /api/tutorial/progress. Ersetzt die alte Coachmark-Tour.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api.ts";
import { SECTIONS, sectionById } from "./sections.ts";
import { CARD, IsabelHead, OverlayPortal } from "./ui.tsx";
import type { SectionId, TutProgress, TutStep } from "./types.ts";

const IsabelScene = lazy(() => import("./IsabelScene.tsx"));
const NerdVisual = lazy(() => import("./NerdVisual.tsx"));
const ChartCinema = lazy(() => import("./cinema/ChartCinema.tsx"));

export function startTutorial(section: SectionId) {
  window.dispatchEvent(new CustomEvent("runlog-tutorial", { detail: section }));
}

// Abschnitt 3/4 lassen den Nutzer aufs Isabel-Profil wechseln — der ProfileSwitcher lädt die App dabei komplett neu
// (location.reload). sessionStorage trägt den laufenden Schritt über diesen Reload; es stirbt mit dem Fenster,
// darum bleibt die Regel „innerhalb eines Abschnitts startet man vorn" für neue Sitzungen erhalten.
const RESUME_KEY = "runlog-tutorial-resume";
function readResume(): { s: SectionId; i: number } | null {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as { s: SectionId; i: number };
    const sec = sectionById(r.s);
    return sec?.available && Number.isInteger(r.i) && r.i >= 0 && r.i < sec.steps.length ? r : null;
  } catch { return null; }
}

// Karte + Kopfzeile leben in ui.tsx (geteilt mit dem Chart-Kino, v2.11.0).

export default function TutorialHost() {
  const nav = useNavigate();
  const [progress, setProgress] = useState<TutProgress | null>(null);
  const [welcome, setWelcome] = useState(false);
  const [sectionId, setSectionId] = useState<SectionId | null>(null);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [taskDone, setTaskDone] = useState(false);
  const [quizPick, setQuizPick] = useState<number | null>(null);
  const raf = useRef(0);
  const baseline = useRef<number | null>(null);

  const section = sectionId ? sectionById(sectionId) : undefined;
  const step: TutStep | undefined = section?.steps[idx];

  // Start-Event (Lernen-Hub / Welcome) + Fortschritt laden; Auto-Start nur beim allerersten App-Start.
  useEffect(() => {
    const onStart = (e: Event) => {
      const id = (e as CustomEvent).detail as SectionId;
      if (sectionById(id)?.available) { setSectionId(id); setIdx(0); setWelcome(false); }
    };
    window.addEventListener("runlog-tutorial", onStart);
    const resume = readResume(); // Schritt über einen Profilwechsel-Reload hinweg fortsetzen
    if (resume) { setSectionId(resume.s); setIdx(resume.i); }
    api.tutorialProgress()
      .then((p) => { setProgress(p); if (!resume && !p.dismissed && p.done.length === 0) setWelcome(true); })
      .catch(() => setProgress({ done: [], dismissed: true }));
    return () => window.removeEventListener("runlog-tutorial", onStart);
  }, []);

  // Resume-Marker aktuell halten: läuft ein Abschnitt → Schritt merken, sonst aufräumen (Pause/Abschluss).
  useEffect(() => {
    try {
      if (sectionId) sessionStorage.setItem(RESUME_KEY, JSON.stringify({ s: sectionId, i: idx }));
      else sessionStorage.removeItem(RESUME_KEY);
    } catch { /* sessionStorage nicht verfügbar → Tutorial läuft trotzdem */ }
  }, [sectionId, idx]);

  // Schrittwechsel: Route ansteuern, Spotlight-Element robust finden + nachmessen (Muster der alten Coachmark-Tour).
  useEffect(() => {
    setRect(null); setTaskDone(false); setQuizPick(null); baseline.current = null;
    if (!step) return;
    const route = "route" in step ? step.route : undefined;
    if (route) nav(route);
    const selector = step.kind === "say" ? step.selector : undefined;
    if (!selector) return;
    let cancelled = false, tries = 0, settle = 0;
    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector(selector);
      if (el) setRect(el.getBoundingClientRect());
      if (settle++ < 24) raf.current = requestAnimationFrame(measure);
    };
    const find = () => {
      if (cancelled) return;
      const el = document.querySelector(selector);
      if (el) { el.scrollIntoView({ block: "center", behavior: "auto" }); raf.current = requestAnimationFrame(measure); }
      else if (tries++ < 150) raf.current = requestAnimationFrame(find);
    };
    const t = window.setTimeout(() => { raf.current = requestAnimationFrame(find); }, 140);
    return () => { cancelled = true; cancelAnimationFrame(raf.current); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, idx]);

  // Aufgaben-Detektion: alle 2 s prüfen (test = absoluter Zustand · count = Zahl steigt gegenüber Step-Start).
  useEffect(() => {
    if (!step || step.kind !== "task" || taskDone) return;
    let cancelled = false;
    const poll = async () => {
      try {
        if ("test" in step.check) {
          if (await step.check.test()) { if (!cancelled) setTaskDone(true); return; }
        } else {
          const n = await step.check.count();
          if (baseline.current == null) baseline.current = n;
          else if (n > baseline.current) { if (!cancelled) setTaskDone(true); return; }
        }
      } catch { /* API kurz nicht erreichbar → nächster Poll */ }
    };
    poll();
    const iv = window.setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, idx, taskDone]);

  if (!progress) return null;

  const saveProgress = (p: TutProgress) => { setProgress(p); api.saveTutorialProgress(p).catch(() => {}); };
  const close = () => { setSectionId(null); setIdx(0); setWelcome(false); };
  const next = () => { if (section && idx < section.steps.length - 1) setIdx(idx + 1); };
  const prev = () => idx > 0 && setIdx(idx - 1);
  const finishSection = () => {
    if (!section) return;
    const done = progress.done.includes(section.id) ? progress.done : [...progress.done, section.id];
    saveProgress({ done, dismissed: true });
    const follow = SECTIONS.find((s) => !s.optional && s.available && !done.includes(s.id));
    close();
    if (!follow) nav("/lernen");
    else setTimeout(() => startTutorial(follow.id), 250);
  };

  // ---- Welcome (Auto-Start beim ersten App-Start, skippbar) ----
  if (welcome && !sectionId) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ ...CARD, width: 460, maxWidth: "92vw" }}>
          <IsabelHead sub="deine Trainingspartnerin in RunLog" />
          <p className="tiny" style={{ margin: "0 0 12px", lineHeight: 1.55 }}>
            Hi! Ich bin Isabel — Läuferin wie du, gerade mitten in meiner Halbmarathon-Vorbereitung.
            Ich zeige dir in vier kurzen Abschnitten, wie du aus RunLog wirklich Training machst:
            einrichten, planen &amp; dokumentieren, verstehen, was bei dir wirkt, und mit dem Coach auf
            deinen Wettkampf hintrainieren. Abschnitt 1 dauert ~12 Minuten — und deine App ist danach echt eingerichtet.
          </p>
          <div className="spread">
            <button className="sm ghost" onClick={() => { saveProgress({ ...progress, dismissed: true }); close(); }}>
              Später — du findest mich unter „Lernen"
            </button>
            <button className="sm primary" onClick={() => { saveProgress({ ...progress, dismissed: true }); setWelcome(false); setSectionId("start"); setIdx(0); }}>
              Los geht's ▶
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!section || !step) return null;
  const stepInfo = `Abschnitt ${section.nr} · Schritt ${idx + 1}/${section.steps.length}`;

  // ---- task: angedockte Karte unten rechts, KEIN Dim — die App muss bedienbar bleiben ----
  if (step.kind === "task") {
    return (
      <div style={{ position: "fixed", right: 18, bottom: 64, width: 390, maxWidth: "92vw", zIndex: 1000, ...CARD, border: taskDone ? "2px solid #16a34a" : "2px solid var(--accent, #2563eb)" }}>
        <IsabelHead sub={stepInfo} />
        <strong style={{ fontSize: 14 }}>{step.title}</strong>
        <p className="tiny" style={{ margin: "6px 0 10px", lineHeight: 1.5 }}>{step.text}</p>
        {taskDone
          ? <p className="tiny" style={{ margin: "0 0 10px", color: "#16a34a", fontWeight: 700 }}>✓ Erledigt — stark!</p>
          : <p className="tiny muted" style={{ margin: "0 0 10px" }}>… ich warte hier, bis du so weit bist (prüft automatisch).</p>}
        {!taskDone && step.skippable && step.skipNote && (
          <p className="tiny muted" style={{ margin: "0 0 10px", lineHeight: 1.45 }}>↷ Überspringen ist okay: {step.skipNote}</p>
        )}
        <div className="spread">
          <button className="sm ghost" onClick={close}>Pause</button>
          <span className="row" style={{ gap: 6 }}>
            {idx > 0 && <button className="sm ghost" onClick={prev}>Zurück</button>}
            {taskDone
              ? <button className="sm primary" onClick={next}>Weiter</button>
              : step.skippable
                ? <button className="sm ghost" onClick={next}>Überspringen</button>
                : <button className="sm ghost" onClick={next} title="Du kannst auch erst weiterschauen und die Aufgabe später machen">Später machen</button>}
          </span>
        </div>
      </div>
    );
  }

  // ---- quiz: zentrierte Karte mit Feedback (falsch → freundlich erklären, nochmal versuchen) ----
  if (step.kind === "quiz") {
    const picked = quizPick != null ? step.options[quizPick] : null;
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ ...CARD, width: 470, maxWidth: "92vw" }}>
          <IsabelHead sub={stepInfo} />
          <strong style={{ fontSize: 14 }}>{step.question}</strong>
          <div style={{ display: "grid", gap: 7, margin: "10px 0" }}>
            {step.options.map((o, i) => (
              <button key={i} className="sm ghost" onClick={() => setQuizPick(i)}
                style={{ textAlign: "left", lineHeight: 1.4, whiteSpace: "normal",
                  border: quizPick === i ? `2px solid ${o.correct ? "#16a34a" : "#dc2626"}` : "1px solid var(--border, #e3e8ef)" }}>
                {o.label}
              </button>
            ))}
          </div>
          {picked && (
            <p className="tiny" style={{ margin: "0 0 10px", lineHeight: 1.5, color: picked.correct ? "#16a34a" : "inherit" }}>
              {picked.correct ? "✓ " : "✗ "}{picked.feedback}
            </p>
          )}
          <div className="spread">
            <button className="sm ghost" onClick={close}>Pause</button>
            <span className="row" style={{ gap: 6 }}>
              {idx > 0 && <button className="sm ghost" onClick={prev}>Zurück</button>}
              <button className="sm primary" disabled={!picked?.correct} onClick={next}>Weiter</button>
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ---- chart3d (Chart-Kino): Vollbild-3D-Szene, Isabel erklärt das Diagramm Beat für Beat ----
  if (step.kind === "chart3d") {
    return (
      <OverlayPortal>
        <Suspense fallback={<div className="tiny muted" style={{ position: "fixed", inset: 0, zIndex: 1100, background: "#0d1526", color: "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center" }}>Das Daten-Kino öffnet…</div>}>
          <ChartCinema chart={step.chart} stepInfo={stepInfo} onDone={next} onClose={close} />
        </Suspense>
      </OverlayPortal>
    );
  }

  // ---- model (Nerd-Add-on): 3D-Intuition + aufklappbare echte Formel ----
  if (step.kind === "model") {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ ...CARD, width: 560, maxWidth: "94vw", maxHeight: "92vh", overflowY: "auto" }}>
          <Suspense fallback={<div style={{ height: 190, display: "flex", alignItems: "center", justifyContent: "center" }} className="tiny muted">Isabel kramt die Kreide raus…</div>}>
            <NerdVisual kind={step.visual} />
          </Suspense>
          <IsabelHead sub={stepInfo} />
          <strong style={{ fontSize: 14 }}>{step.title}</strong>
          <p className="tiny" style={{ margin: "6px 0 10px", lineHeight: 1.55 }}>{step.text}</p>
          <details style={{ marginBottom: 12 }}>
            <summary className="tiny" style={{ cursor: "pointer", fontWeight: 700 }}>Die echte Formel — so rechnet RunLog wirklich</summary>
            <pre className="tiny" style={{ margin: "8px 0 4px", padding: "8px 10px", borderRadius: 8, background: "var(--surface2, rgba(148,163,184,0.12))", overflowX: "auto", lineHeight: 1.6 }}>
              {step.formula.lines.join("\n")}
            </pre>
            {step.formula.note && <p className="tiny muted" style={{ margin: "4px 0 0", lineHeight: 1.45 }}>{step.formula.note}</p>}
          </details>
          <div className="spread">
            <button className="sm ghost" onClick={close}>Pause</button>
            <span className="row" style={{ gap: 6 }}>
              {idx > 0 && <button className="sm ghost" onClick={prev}>Zurück</button>}
              <button className="sm primary" onClick={next}>Weiter</button>
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ---- scene: Abschnitts-Abschluss mit Isabel-3D-Moment + Recap ----
  if (step.kind === "scene") {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.65)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ ...CARD, width: 520, maxWidth: "94vw" }}>
          <Suspense fallback={<div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center" }} className="tiny muted">Isabel schnürt die Schuhe…</div>}>
            <IsabelScene finale={step.finale} />
          </Suspense>
          <IsabelHead sub={`Abschnitt ${section.nr} abgeschlossen`} />
          <strong style={{ fontSize: 15 }}>{step.title}</strong>
          <p className="tiny" style={{ margin: "6px 0 12px", lineHeight: 1.55 }}>{step.text}</p>
          <div className="spread">
            <span className="tiny muted">Jeder Abschnitt ist unter „Lernen" jederzeit wiederholbar.</span>
            <button className="sm primary" onClick={finishSection}>Abschnitt abschließen ✓</button>
          </div>
        </div>
      </div>
    );
  }

  // ---- say: Spotlight (falls selector) oder zentrierte Karte ----
  const pad = 6;
  const vw = window.innerWidth, vh = window.innerHeight;
  const TW = 380, TH = 210;
  let tipTop: number, tipLeft: number;
  if (rect) {
    const below = rect.bottom + 14 + TH < vh;
    tipTop = below ? rect.bottom + 14 : Math.max(12, rect.top - TH - 14);
    tipLeft = Math.min(Math.max(12, rect.left), vw - TW - 12);
  } else {
    tipTop = vh / 2 - TH / 2; tipLeft = vw / 2 - TW / 2;
  }
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000 }}>
      {rect ? (
        <div style={{ position: "fixed", top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
          borderRadius: 12, boxShadow: "0 0 0 9999px rgba(15,23,42,0.55)", border: "2px solid #fff", transition: "all .15s ease" }} />
      ) : (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)" }} />
      )}
      <div style={{ position: "fixed", top: tipTop, left: tipLeft, width: TW, zIndex: 1001, ...CARD }}>
        <IsabelHead sub={stepInfo} />
        <strong style={{ fontSize: 14 }}>{step.title}</strong>
        <p className="tiny" style={{ margin: "6px 0 12px", lineHeight: 1.5 }}>{step.text}</p>
        <div className="spread">
          <button className="sm ghost" onClick={close}>Pause</button>
          <span className="row" style={{ gap: 6 }}>
            {idx > 0 && <button className="sm ghost" onClick={prev}>Zurück</button>}
            <button className="sm primary" onClick={next}>Weiter</button>
          </span>
        </div>
      </div>
    </div>
  );
}
