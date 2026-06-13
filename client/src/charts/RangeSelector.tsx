// Wiederverwendbarer Zeitraum-Wähler für die großen Übersichts-Charts (Dashboard).
// Buttons: Saison · 1M · 6M · 1J · Eigene (+ zwei Datumsfelder bei „Eigene").
// Default: aktuelle Saison (Fallback 1J, solange noch kein Saisonplan geladen ist).
import { useEffect, useState } from "react";
import { addDays, todayIso } from "../lib/util.ts";

export type RangeMode =  "1m" | "6m" | "1y" | "ytd" | "season" | "custom";
export interface DateRange { from: string; to: string; }

const PRESETS: { mode: RangeMode; label: string }[] = [
  { mode: "1m", label: "1M" },
  { mode: "6m", label: "6M" },
  { mode: "ytd", label: "YTD" },
  { mode: "1y", label: "1J" },
  { mode: "season", label: "Saison" },
  { mode: "custom", label: "Eigene" },
];

/** Montag der Woche, in der `iso` liegt. */
function mondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

/** 1. Januar des aktuellen Jahres als ISO-Date-String. */
function startOfCurrentYear(): string {
  const year = new Date().getFullYear();
  return `${year}-01-01`;
}

function resolve(mode: RangeMode, custom: DateRange, seasonRange?: DateRange | null): DateRange {
  const today = todayIso();
  switch (mode) {
    case "custom": return custom;
    case "1m": {
      // Letzte 4 Wochen + die kommende (wochenbündig Mo–So).
      const mon = mondayOf(today);
      return { from: addDays(mon, -28), to: addDays(mon, 13) };
    }
    case "ytd": {
      const year_date = startOfCurrentYear();
      return { from: addDays(year_date, 0), to: addDays(today, 14)};
    }
    case "season":
      if (seasonRange) return seasonRange;
      return { from: addDays(today, -365), to: addDays(today, 21) }; // Fallback ohne Saisonplan
    case "6m": return { from: addDays(today, -182), to: addDays(today, 14) };
    case "1y": return { from: addDays(today, -365), to: addDays(today, 31) };
  }
}

export default function RangeSelector({
  seasonRange, onChange, defaultMode = "season",
}: {
  /** Zeitraum der Saison (Default-Auswahl); null solange nicht geladen. */
  seasonRange?: DateRange | null;
  onChange: (r: DateRange) => void;
  /** Vorausgewählter Zeitraum (z.B. "6m" auf der Langzeit-Seite). */
  defaultMode?: RangeMode;
}) {
  const [mode, setMode] = useState<RangeMode>(defaultMode);
  const [custom, setCustom] = useState<DateRange>({ from: addDays(todayIso(), -90), to: todayIso() });

  useEffect(() => {
    const r = resolve(mode, custom, seasonRange);
    if (r.from && r.to && r.from <= r.to) onChange(r);
    // onChange bewusst nicht in den Deps (Eltern dürfen Inline-Callbacks übergeben).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, custom.from, custom.to, seasonRange?.from, seasonRange?.to]);

  return (
    <div className="row" style={{ gap: 8, width: "auto" }}>
      <div className="seg">
        {PRESETS.map((p) => (
          <button key={p.mode} type="button" className={mode === p.mode ? "active" : ""} onClick={() => setMode(p.mode)}>
            {p.label}
          </button>
        ))}
      </div>
      {mode === "custom" && (
        <span className="row" style={{ gap: 5, width: "auto" }}>
          <input type="date" value={custom.from} style={{ width: "auto", padding: "4px 7px", fontSize: 12 }}
            onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <span className="tiny muted">–</span>
          <input type="date" value={custom.to} style={{ width: "auto", padding: "4px 7px", fontSize: 12 }}
            onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
        </span>
      )}
    </div>
  );
}
