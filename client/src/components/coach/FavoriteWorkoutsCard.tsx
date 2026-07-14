// Einheiten-Vorlieben (v3.1.0, extrahiert aus AvailabilityCard): ♥ häufiger · ⊘ vermeiden. Das ist
// Bibliotheks-Pflege, keine Block-Einrichtung — deshalb bleibt sie als eigene, eingeklappte Karte im Coach,
// während alles andere aus der alten Verfügbarkeits-Karte in den Wizard gewandert ist. Beratend: Phasen- und
// Erholungsregeln bleiben verbindlich, eine Vorliebe kippt keine Pflicht-Einheit.
import { useEffect, useState } from "react";
import { api, type Availability, type WorkoutInfo } from "../../lib/api.ts";
import T from "../T.tsx";

const EMPTY: Availability = { minutesByWeekday: [0, 0, 0, 0, 0, 0, 0], longRunDay: null, hardDays: [] };

export default function FavoriteWorkoutsCard() {
  const [av, setAv] = useState<Availability>(EMPTY);
  const [workouts, setWorkouts] = useState<WorkoutInfo[]>([]);
  const [famTab, setFamTab] = useState("Alle");
  const [q, setQ] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.availability().then((r) => { if (r) setAv(r); }).catch(() => {});
    api.workouts().then(setWorkouts).catch(() => {});
  }, []);

  // Vorlieben speichern direkt (ein Klick = eine Entscheidung, kein Formular) — im Gegensatz zur
  // Block-Einrichtung, die im Wizard bewusst erst auf „Speichern" schreibt.
  const persist = (next: Availability) => {
    setAv(next);
    api.saveAvailability(next)
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); })
      .catch(() => {});
  };

  // Favorit/Vermeiden schließen einander aus.
  const toggleFav = (id: string) => {
    const fav = av.favoriteWorkouts ?? [];
    persist({
      ...av,
      favoriteWorkouts: fav.includes(id) ? fav.filter((x) => x !== id) : [...fav, id],
      avoidWorkouts: (av.avoidWorkouts ?? []).filter((x) => x !== id),
    });
  };
  const toggleAvoid = (id: string) => {
    const avo = av.avoidWorkouts ?? [];
    persist({
      ...av,
      avoidWorkouts: avo.includes(id) ? avo.filter((x) => x !== id) : [...avo, id],
      favoriteWorkouts: (av.favoriteWorkouts ?? []).filter((x) => x !== id),
    });
  };

  if (!workouts.length) return null;

  const favC = av.favoriteWorkouts?.length ?? 0, avoC = av.avoidWorkouts?.length ?? 0;
  const families = Array.from(new Set(workouts.map((w) => w.family)));
  const ql = q.trim().toLowerCase();
  const filtered = workouts.filter((w) =>
    (famTab === "Alle" || w.family === famTab) &&
    (!ql || w.name.toLowerCase().includes(ql) || (w.purpose ?? "").toLowerCase().includes(ql)));

  return (
    <details className="card tight" style={{ marginBottom: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        <T k="availability.fav.title">Lieblings- &amp; Vermeiden-Einheiten</T>
        {(favC + avoC) > 0 && <span className="tiny muted" style={{ fontWeight: 400 }}> · ♥ {favC} · ⊘ {avoC}</span>}
        {saved && <span className="tiny" style={{ color: "var(--ok)", fontWeight: 400 }}> · gespeichert ✓</span>}
      </summary>
      <div style={{ marginTop: 8 }}>
        <p className="tiny muted" style={{ margin: "0 0 8px" }}>
          <T k="availability.fav.hint">♥ = häufiger, ⊘ = vermeiden. Wirkt beratend auf die Auswahl — Phasen &amp; Erholungsregeln bleiben verbindlich.</T>
        </p>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          {["Alle", ...families].map((fam) => (
            <button key={fam} className={`sm ${famTab === fam ? "" : "ghost"}`} style={{ padding: "3px 10px" }} onClick={() => setFamTab(fam)}>{fam}</button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Einheit suchen…"
            style={{ marginLeft: "auto", width: 150, padding: "5px 9px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 8 }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 6 }}>
          {filtered.map((w) => {
            const fav = (av.favoriteWorkouts ?? []).includes(w.id);
            const avo = (av.avoidWorkouts ?? []).includes(w.id);
            return (
              <div key={w.id} title={w.purpose} style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${fav ? "var(--ok)" : avo ? "var(--danger)" : "var(--border)"}`, borderRadius: 9, padding: "5px 8px", background: fav ? "rgba(16,185,129,0.08)" : avo ? "rgba(239,68,68,0.06)" : "var(--card)" }}>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 500, opacity: avo ? 0.7 : 1 }}>{w.name}</span>
                <button className="sm ghost" onClick={() => toggleFav(w.id)} title="Favorit — häufiger vorschlagen"
                  style={{ padding: "1px 6px", borderRadius: 6, fontWeight: 700, color: fav ? "#fff" : "var(--muted)", background: fav ? "var(--ok)" : "transparent" }}>♥</button>
                <button className="sm ghost" onClick={() => toggleAvoid(w.id)} title="Vermeiden"
                  style={{ padding: "1px 6px", borderRadius: 6, fontWeight: 700, color: avo ? "#fff" : "var(--muted)", background: avo ? "var(--danger)" : "transparent" }}>⊘</button>
              </div>
            );
          })}
          {filtered.length === 0 && <span className="tiny muted">Keine Einheit gefunden.</span>}
        </div>
      </div>
    </details>
  );
}
