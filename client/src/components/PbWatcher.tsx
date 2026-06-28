// PB-Watcher (Premium-Politur M6): erkennt neue/verbesserte Bestzeiten gegenüber dem letzten Besuch (Snapshot je
// Profil in localStorage) und feiert sie. Beim ALLERERSTEN Lauf wird nur stillschweigend der Snapshot gesetzt
// (sonst würde jede erste Ansicht feiern). Unsichtbar — rendert nichts.
import { useEffect } from "react";
import { api } from "../lib/api.ts";
import { celebrate } from "./Celebration.tsx";

function fmtT(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.round(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}

export default function PbWatcher() {
  useEffect(() => {
    api.profiles().then((pr) => {
      const key = `runlog-pb-snapshot-${pr.active}`;
      api.bests().then((r) => {
        const pbs = (r.pbs ?? []).filter((p) => p.time_s != null && p.distance_m != null);
        let snap: Record<string, number> = {}, firstRun = false;
        try { const raw = localStorage.getItem(key); if (raw) snap = JSON.parse(raw); else firstRun = true; } catch { firstRun = true; }
        const next: Record<string, number> = {};
        let best: { distance_m: number; time_s: number } | null = null; // die längste verbesserte Distanz feiern
        for (const pb of pbs) {
          const k = String(pb.distance_m);
          next[k] = pb.time_s;
          const prev = snap[k];
          if (!firstRun && (prev == null || pb.time_s < prev - 0.5) && (!best || pb.distance_m > best.distance_m)) {
            best = { distance_m: pb.distance_m, time_s: pb.time_s };
          }
        }
        try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
        if (best) {
          const km = Math.round(best.distance_m / 100) / 10;
          window.setTimeout(() => celebrate({ emoji: "🏅", title: `Neue Bestzeit über ${km} km!`, subtitle: `${fmtT(best!.time_s)} — stark. Dein VDOT zieht mit.` }), 1200);
        }
      }).catch(() => { /* ignore */ });
    }).catch(() => { /* ignore */ });
  }, []);
  return null;
}
