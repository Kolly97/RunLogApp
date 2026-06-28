// Achievement-Watcher (Premium-Politur M6): erkennt drei weitere echte Erfolge und feiert sie dezent —
//  #2 Wunsch-/Zielzeit geschlagen (race.time_s ≤ race.goal_time_s)
//  #3 Konsistenz-Streak (aufeinanderfolgende Trainingswochen; Meilensteine 4/8/12/26/52)
//  #4 Trainingsblock abgeschlossen (Phasen-Run ≥2 Wochen, nur echte Arbeitsblöcke)
// Alles client-seitig aus vorhandenen Endpunkten (races/activities/season) + localStorage-Dedup je Profil.
// Beim ALLERERSTEN Lauf wird nur still der Snapshot gesetzt (kein Nachfeiern der Historie). Rendert nichts.
import { useEffect } from "react";
import { api } from "../lib/api.ts";
import { addDays, todayIso, secToClock } from "../lib/util.ts";
import { phaseLabel } from "../lib/options.ts";
import { celebrate } from "./Celebration.tsx";

const STREAK_MILESTONES = [4, 8, 12, 26, 52];
// Nur „Arbeitsblöcke" feiern — nicht Entlastung (Deload), Race Week (Taper) oder Krank.
const WORK_PHASES = new Set(["Base", "Belastung", "Race Specific"]);

function mondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Längster aktueller Streak: aufeinanderfolgende Wochen (Mo–So) mit ≥1 Aktivität, mit Karenz für die laufende Woche. */
function weekStreak(weeks: Set<string>): number {
  let cursor = mondayOf(todayIso());
  if (!weeks.has(cursor)) cursor = mondayOf(addDays(cursor, -7)); // laufende Woche darf noch „leer" sein
  let streak = 0;
  while (weeks.has(cursor)) { streak++; cursor = mondayOf(addDays(cursor, -7)); }
  return streak;
}

function load(key: string): { snap: any; firstRun: boolean } {
  try { const raw = localStorage.getItem(key); return raw ? { snap: JSON.parse(raw), firstRun: false } : { snap: null, firstRun: true }; }
  catch { return { snap: null, firstRun: true }; }
}
function save(key: string, val: unknown): void { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ } }

export default function AchievementWatcher() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pr = await api.profiles().catch(() => null);
      if (!pr || cancelled) return;
      const p = pr.active;
      const [races, acts, season] = await Promise.all([
        api.races().catch(() => []),
        api.activities({ from: addDays(todayIso(), -400), to: todayIso() }).catch(() => []),
        api.season().catch(() => []),
      ]);
      if (cancelled) return;
      const fires: Array<() => void> = [];

      // #2 — Wunschzeit geschlagen.
      {
        const key = `runlog-goalrace-${p}`;
        const { snap, firstRun } = load(key);
        const done = new Set<string>(Array.isArray(snap) ? snap : []);
        const hit = races
          .filter((r) => r.time_s != null && r.goal_time_s != null && r.goal_time_s > 0 && r.time_s <= r.goal_time_s)
          .map((r) => ({ r, k: String(r.id ?? `${r.date}|${r.name ?? ""}`) }));
        const fresh = hit.filter((h) => !done.has(h.k)).sort((a, b) => a.r.date.localeCompare(b.r.date));
        for (const h of hit) done.add(h.k);
        save(key, [...done]);
        const top = fresh.at(-1); // jüngste neu geschlagene Zielzeit
        if (!firstRun && top) {
          const { r } = top;
          fires.push(() => celebrate({
            emoji: "🎯", title: "Wunschzeit geschlagen!",
            subtitle: `${r.name || "Wettkampf"}: ${secToClock(r.time_s!)} (Ziel ${secToClock(r.goal_time_s!)})`,
          }));
        }
      }

      // #4 — Trainingsblock abgeschlossen (Phasen-Run, sortiert nach Start).
      {
        const key = `runlog-block-${p}`;
        const { snap, firstRun } = load(key);
        const done = new Set<string>(Array.isArray(snap) ? snap : []);
        const ws = [...season].filter((w) => w.start_date && w.end_date).sort((a, b) => a.start_date.localeCompare(b.start_date));
        type Run = { phase: string; end: string; weeks: number };
        const runs: Run[] = [];
        for (const w of ws) {
          const last = runs[runs.length - 1];
          if (last && last.phase === w.phase) { last.weeks++; last.end = w.end_date; }
          else runs.push({ phase: w.phase, end: w.end_date, weeks: 1 });
        }
        const today = todayIso();
        const completed = runs
          .filter((r) => WORK_PHASES.has(r.phase) && r.weeks >= 2 && r.end < today)
          .map((r) => ({ r, k: `${r.phase}|${r.end}` }));
        const fresh = completed.filter((c) => !done.has(c.k)).sort((a, b) => a.r.end.localeCompare(b.r.end));
        for (const c of completed) done.add(c.k);
        save(key, [...done]);
        const top = fresh.at(-1);
        if (!firstRun && top) {
          fires.push(() => celebrate({
            emoji: "✅", title: "Trainingsblock abgeschlossen",
            subtitle: `${phaseLabel(top.r.phase)} · ${top.r.weeks} Wochen abgehakt.`,
          }));
        }
      }

      // #3 — Konsistenz-Streak.
      {
        const key = `runlog-streak-${p}`;
        const { snap, firstRun } = load(key);
        const prevMax = typeof snap === "number" ? snap : 0;
        const weeks = new Set<string>();
        for (const a of acts) if (a.date) weeks.add(mondayOf(a.date));
        const streak = weekStreak(weeks);
        const reached = STREAK_MILESTONES.filter((m) => m <= streak).at(-1) ?? 0;
        save(key, Math.max(prevMax, reached));
        if (!firstRun && reached > prevMax) {
          fires.push(() => celebrate({
            emoji: "🔥", title: `${reached} Wochen am Stück trainiert`,
            subtitle: "Konsistenz ist der stärkste Trainingsreiz — weiter so.",
          }));
        }
      }

      // Nacheinander auslösen (Celebration-Queue serialisiert die Anzeige). Etwas nach PB-Watcher (1200 ms).
      if (fires.length && !cancelled) window.setTimeout(() => { for (const f of fires) f(); }, 1500);
    })();
    return () => { cancelled = true; };
  }, []);
  return null;
}
