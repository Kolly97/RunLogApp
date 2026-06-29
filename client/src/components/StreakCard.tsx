// C2/Item 2 (#6): Trainings-Streak als Monats-Kalender-Heatmap — klinisch/premium, kein verspieltes Gamification.
// - Zellen passen sich dynamisch an Breite UND Höhe der Karte an (immer quadratisch).
// - Piktogramm der dominanten Disziplin (Lauf/Rad/Kraft) je Tag; roter Rahmen bei harter Einheit; Füllfarbe = TSS-Last.
// - Headline = laufende Serie bis heute. Regel „nur echtes Training" (#11): echte Einheit (sport≠General) hält
//   die Serie; reiner Commute-Tag bricht — außer eingetragener Ruhetag (type "Rest") überbrückt; Leertag bricht.
import { useEffect, useRef, useState } from "react";
import type { Activity, PlannedSession } from "../lib/api.ts";
import { todayIso } from "../lib/util.ts";

const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const addDays = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const HARD_TYPES = new Set(["VO2", "Threshold", "Race", "Renntempo", "Hill"]);

type Disc = "run" | "bike" | "strength" | "other";
const ICON: Record<Disc, string> = {
  // Material-Symbols (24×24) — monochrom, currentColor.
  run: "M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z",
  bike: "M5 20.5A3.5 3.5 0 0 1 1.5 17 3.5 3.5 0 0 1 5 13.5 3.5 3.5 0 0 1 8.5 17 3.5 3.5 0 0 1 5 20.5M5 12a5 5 0 0 0-5 5 5 5 0 0 0 5 5 5 5 0 0 0 5-5 5 5 0 0 0-5-5m9.8-2H19V8.2h-3.2l-1.9-3.1c-.3-.5-.8-.8-1.4-.8-.5 0-.9.2-1.2.5L7.7 8.1c-.3.3-.5.7-.5 1.2 0 .6.3 1 .7 1.3L11 13v5h1.8v-6.1l-2.1-1.6 2.6-2.6M19 12a5 5 0 0 0-5 5 5 5 0 0 0 5 5 5 5 0 0 0 5-5 5 5 0 0 0-5-5m0 8.5a3.5 3.5 0 0 1-3.5-3.5 3.5 3.5 0 0 1 3.5-3.5 3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m-2.7-15a2 2 0 0 0 2-2 2 2 0 0 0-2-2 2 2 0 0 0-2 2 2 2 0 0 0 2 2z",
  strength: "M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29z",
  other: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z",
};
function discOf(sport?: string | null): Disc {
  if (sport === "Run") return "run";
  if (sport && (sport.startsWith("Bike") || sport === "General")) return "bike";
  if (sport === "Strength" || sport === "Physio") return "strength";
  return "other";
}
function isHard(a: Activity): boolean {
  if (a.type && HARD_TYPES.has(a.type)) return true;
  const z = a.zone_min || a.zone_km;
  if (z) {
    const tot = Object.values(z).reduce((s, v) => s + (Number(v) || 0), 0);
    const hard = (Number(z[4]) || 0) + (Number(z[5]) || 0) + (Number(z[6]) || 0);
    if (tot > 0 && hard / tot >= 0.3) return true;
  }
  return false;
}
/** TSS → Füllstufe 0–4 (grüne „erledigt"-Skala). */
function level(tss: number): number {
  if (tss <= 0) return 0;
  if (tss < 40) return 1;
  if (tss < 80) return 2;
  if (tss < 120) return 3;
  return 4;
}

type DayAgg = { tss: number; discW: Partial<Record<Disc, number>>; hard: boolean; real: boolean };

export default function StreakCard({ acts, sessions, height }: { acts: Activity[]; sessions: PlannedSession[]; height?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [gridW, setGridW] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setGridW(el.clientWidth));
    ro.observe(el);
    setGridW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const today = todayIso();
  // Pro Tag: TSS-Summe, Disziplin-Gewichte (für dominante Disziplin), Hart-Flag, „echtes Training"-Flag.
  const agg = new Map<string, DayAgg>();
  for (const a of acts) {
    const e = agg.get(a.date) ?? { tss: 0, discW: {}, hard: false, real: false };
    const w = (a.tss || 0) || (a.moving_s || 0) / 60 || 1;
    const d = discOf(a.sport);
    e.tss += a.tss || 0;
    e.discW[d] = (e.discW[d] || 0) + w;
    if (isHard(a)) e.hard = true;
    if (a.sport !== "General") e.real = true; // General = Commute → kein echtes Training
    agg.set(a.date, e);
  }
  const covered = (d: string) => agg.has(d);
  const domDisc = (e: DayAgg): Disc => (Object.entries(e.discW).sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0] as Disc) ?? "other";
  // Ruhetag = eingetragene geplante Session „Rest" (überbrückt die Serie); geplantes Training (offen) nur für Tooltip.
  const restLogged = new Set(sessions.filter((s) => s.type === "Rest" && s.date).map((s) => s.date));
  const plannedTrain = new Set(sessions.filter((s) => s.type !== "Rest" && s.date).map((s) => s.date));

  // Monatsraster (Mo-first).
  const first = today.slice(0, 7) + "-01";
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(first + "T00:00:00Z").getUTCDay() + 6) % 7; // Mo=0
  const cells: ({ date: string; day: number } | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let dn = 1; dn <= daysInMonth; dn++) cells.push({ date: `${first.slice(0, 8)}${String(dn).padStart(2, "0")}`, day: dn });
  const rows = Math.ceil(cells.length / 7);

  // Metrik (#11): laufende Serie bis heute (Headline) + längste Serie + aktive Tage diesen Monat.
  // Regel „nur echtes Training": echte Einheit → Serie +1; eingetragener Ruhetag → überbrücken; reiner
  // Commute-Tag ODER Leertag (in der Vergangenheit) → Bruch. Heute bleibt „offen" und bricht (noch) nicht.
  const todayDay = today.slice(0, 7) === first.slice(0, 7) ? Number(today.slice(8, 10)) : daysInMonth;
  let activeDays = 0;
  for (let dn = 1; dn <= todayDay; dn++) if (covered(`${first.slice(0, 8)}${String(dn).padStart(2, "0")}`)) activeDays++;
  let longest = 0, current = 0, run = 0, grace = 0;
  if (acts.length) {
    const floor = acts.reduce((mn, a) => (a.date < mn ? a.date : mn), today);
    for (let d = floor; d <= today; d = addDays(d, 1)) {
      const e = agg.get(d);
      if (e?.real) { run++; longest = Math.max(longest, run); grace = 0; } // echtes Training
      else if (restLogged.has(d)) { grace = 0; }                           // Ruhetag → überbrücken
      else if (d === today) { /* heute noch offen */ }
      else { grace++; if (grace >= 2) { run = 0; grace = 0; } }           // 1 Tag Gnadenfrist; 2 Tage → Bruch
    }
    current = run;
  }

  // Dynamische Zellgröße: an Breite UND Höhe der Karte fitten (immer quadratisch).
  const gap = 4, headPx = 96;
  const byW = gridW > 0 ? (gridW - (7 - 1) * gap) / 7 : 30;
  const byH = height && height > headPx ? (height - headPx - rows * gap) / rows : Infinity;
  const cell = Math.max(15, Math.min(byW, byH, 46));
  const monthName = new Date(first + "T00:00:00Z").toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
  const colTpl = `repeat(7, ${cell}px)`;

  return (
    <div className="card streak-card">
      <div className="spread" style={{ alignItems: "baseline" }}>
        <h2 style={{ margin: 0 }}>Serie</h2>
        <span className="tiny muted">{monthName}</span>
      </div>
      <div className="streak-head">
        <span className="streak-flame" aria-hidden="true">🔥</span>
        <span className="streak-num">{current}</span>
        <span className="tiny muted">Tage in Folge · {activeDays} aktiv diesen Monat{longest > 0 ? ` · längste ${longest}` : ""}</span>
      </div>
      <div ref={wrapRef}>
        <div className="streak-grid streak-wd" style={{ gridTemplateColumns: colTpl, gap }}>
          {WD.map((w) => <div key={w} className="streak-wdlabel">{w}</div>)}
        </div>
        <div className="streak-grid" style={{ gridTemplateColumns: colTpl, gap }}>
          {cells.map((c, i) => {
            if (!c) return <div key={`b${i}`} className="streak-cell empty" style={{ width: cell, height: cell }} />;
            const future = c.date > today;
            const e = agg.get(c.date);
            const tss = e?.tss ?? 0;
            const lv = level(tss);
            const realDay = !!e?.real;                  // echtes Training → grüne „erledigt"-Stufe
            const commuteOnly = !!e && !e.real;         // nur Commute → neutral, bricht die Serie
            const restHere = restLogged.has(c.date);
            const disc = e ? domDisc(e) : null;
            const title = future ? c.date
              : `${c.date}${tss > 0 ? ` · ${Math.round(tss)} TSS` : ""}${commuteOnly ? " · Commute" : ""}${restHere ? " · Ruhetag" : ""}${!e && !restHere ? " · frei" : ""}${e?.hard ? " · harte Einheit" : ""}`;
            const lightText = lv < 3;
            const icon = cell * 0.46;
            return (
              <div key={c.date} title={title}
                className={"streak-cell" + (c.date === today ? " today" : "") + (future ? " future" : "") + (e?.hard ? " hard" : "") + (commuteOnly ? " commute" : "") + (restHere && !e ? " rest" : "")}
                style={{ width: cell, height: cell, fontSize: Math.max(8, cell * 0.3), ...(!future && realDay && lv > 0 ? { background: `rgba(34,197,94,${0.22 + 0.18 * lv})`, borderColor: e?.hard ? undefined : "transparent", color: lightText ? undefined : "#fff" } : {}) }}>
                <span className="streak-daynum">{c.day}</span>
                {disc && !future && cell >= 22 && (
                  <svg className="streak-ico" viewBox="0 0 24 24" width={icon} height={icon} aria-hidden="true"><path d={ICON[disc]} fill="currentColor" /></svg>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
