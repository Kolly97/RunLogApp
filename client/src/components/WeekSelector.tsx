// Wochenauswahl als Jahres-Akkordeon (ToDo 8, v0.11.0): statt einem langen <select> ein Popover,
// in dem die Jahre 2019…2026 aufklappbar gruppiert sind. Aktives Jahr ist beim Öffnen offen.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { SeasonWeek } from "../lib/api.ts";
import { fmtDate, fmtDateY, weekLabel, groupByYear, todayIso } from "../lib/util.ts";
import { phaseColor, phaseLabel } from "../lib/options.ts";

export default function WeekSelector({
  season, weekNo, setWeekNo, jumpTo,
}: {
  season: SeasonWeek[]; weekNo: number | null; setWeekNo: (n: number) => void;
  /** Optionaler Sprung zur gleichen Woche einer anderen Seite (z.B. Bericht ↔ Tracking). */
  jumpTo?: { href: string; title: string; label: string };
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = season.find((w) => w.week_no === weekNo) || null;
  const groups = groupByYear(season);
  const curYear = (current?.start_date ?? todayIso()).slice(0, 4);
  const [openYears, setOpenYears] = useState<Set<string>>(() => new Set([curYear]));

  // Außen-Klick / Esc schließt das Popover.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  // Beim Öffnen das aktuelle Jahr ausklappen.
  useEffect(() => { if (open) setOpenYears((s) => new Set(s).add(curYear)); }, [open, curYear]);

  const pick = (n: number) => { setWeekNo(n); setOpen(false); };
  const toggleYear = (y: string) =>
    setOpenYears((s) => { const n = new Set(s); if (n.has(y)) n.delete(y); else n.add(y); return n; });

  // Vor/Zurück-Pfeile (v0.13.0): season ist nach Startdatum sortiert; einen Schritt verschieben.
  const idx = season.findIndex((w) => w.week_no === weekNo);
  const go = (delta: number) => { const t = season[idx + delta]; if (t) setWeekNo(t.week_no); };

  return (
    <span className="row" style={{ width: "auto", gap: 6, alignItems: "center", flexWrap: "nowrap", whiteSpace: "nowrap" }}>
      <button type="button" className="sm ghost" disabled={idx <= 0} onClick={() => go(-1)} title="Vorige Woche" style={{ padding: "4px 8px" }}>←</button>
      <div className="week-select" ref={ref}>
        <button type="button" className="week-select-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="wst-label">
            {current
              ? `${weekLabel(current)} · ${phaseLabel(current.phase)} · ${fmtDate(current.start_date)}–${fmtDateY(current.end_date)}`
              : "Woche wählen"}
          </span>
          <span className="caret">▾</span>
        </button>
        {open && (
          <div className="week-select-pop">
            {groups.map(({ year, items }) => {
              const isOpen = openYears.has(year);
              return (
                <div key={year} className="wy-group">
                  <button type="button" className="wy-head" onClick={() => toggleYear(year)}>
                    <span className="caret">{isOpen ? "▾" : "▸"}</span>
                    <strong>{year}</strong>
                    <span className="tiny muted">{items.length} Wo.</span>
                  </button>
                  <div className={"wy-body" + (isOpen ? " open" : "")}>
                    <div className="wy-body-inner">
                      {items.map((w) => (
                        <button key={w.week_no} type="button"
                          className={"wy-week" + (w.week_no === weekNo ? " active" : "") + (w.phase === "Krank" ? " sick" : "")}
                          onClick={() => pick(w.week_no)}>
                          <span className="wy-dot" style={{ background: phaseColor(w.phase) }} />
                          <span className="wy-week-label">{weekLabel(w)}</span>
                          <span className="tiny muted wy-week-meta">
                            {phaseLabel(w.phase)} · {fmtDate(w.start_date)}{w.target_km ? ` · ${w.target_km} km` : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            {!groups.length && <div className="tiny muted" style={{ padding: 8 }}>Keine Wochen.</div>}
          </div>
        )}
      </div>
      <button type="button" className="sm ghost" disabled={idx < 0 || idx >= season.length - 1} onClick={() => go(1)} title="Nächste Woche" style={{ padding: "4px 8px" }}>→</button>
      {jumpTo && (
        <Link to={jumpTo.href} className="sm ghost no-print" title={jumpTo.title} style={{ whiteSpace: "nowrap" }}>{jumpTo.label}</Link>
      )}
    </span>
  );
}
