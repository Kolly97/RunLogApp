// Coach-Setup-Zeile (v3.1.0): Der Wizard ist die EINE Einrichtungs-Stelle — hier steht nur, was gerade gilt,
// plus ein Weg dorthin. Ersetzt die frühere „Trainings-Verfügbarkeit"-Karte (zwei Orte für dieselbe Einstellung).
import { useEffect, useState } from "react";
import { api, type Availability } from "../../lib/api.ts";

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const EMPHASIS_LABEL: Record<string, string> = {
  ausgewogen: "Ausgewogen", lt1: "LT1", schwelle: "Schwelle", vo2: "VO2max",
  berg: "Berg", norwegian: "Norwegian", fartlek: "Fartlek",
};

/** Ein Satz, der die Blockeinrichtung zusammenfasst — leer, solange nichts eingerichtet ist. */
export default function BlockSetupSummary({ reloadKey, onEdit }: { reloadKey: number; onEdit: () => void }) {
  const [av, setAv] = useState<Availability | null>(null);
  const [mode, setMode] = useState<"auto" | "manual">("auto");

  useEffect(() => {
    api.availability().then(setAv).catch(() => setAv(null));
    api.settings().then((s) => setMode(s?.coach_emphasis_mode === "manual" ? "manual" : "auto")).catch(() => {});
  }, [reloadKey]);

  const mins = av?.minutesByWeekday ?? [];
  const days = mins.filter((m) => (m || 0) > 0).length;
  const total = mins.reduce((a, b) => a + (b || 0), 0);
  const hard = (av?.hardDays ?? []).map((i) => DAYS[i]).join("/");
  const emph = av?.emphasis ? (EMPHASIS_LABEL[av.emphasis] ?? av.emphasis) : null;

  const parts = days > 0
    ? [
        `${days} Trainingstage`,
        `${total} min/Woche`,
        av?.longRunDay != null ? `Longrun ${DAYS[av.longRunDay]}` : null,
        hard ? `hart ${hard}` : null,
        emph ? `Schwerpunkt ${emph}${mode === "auto" ? " (Auto)" : ""}` : `Schwerpunkt Auto (Evidenz)`,
        (av?.corePerWeek ?? 0) > 0 ? `${av!.corePerWeek}× Stabi` : null,
        av?.allowDoubles ? "Doubles" : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="card tight" style={{ marginBottom: 12 }}>
      <div className="spread" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div className="tiny muted" style={{ letterSpacing: ".06em", textTransform: "uppercase" }}>Deine Einrichtung</div>
          {parts.length ? (
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>{parts.join(" · ")}</div>
          ) : (
            <div className="tiny muted">Noch nichts eingerichtet — der Wizard führt dich durch Ziel, Umfang, Zeit, Zonen und Schwerpunkt.</div>
          )}
        </div>
        <button className="sm ghost" onClick={onEdit} title="Öffnet den Block-Wizard direkt im Zeit-Schritt — dort änderst du Minuten, Longrun-Tag, harte Tage und die Feinheiten.">✎ Ändern</button>
      </div>
    </div>
  );
}
