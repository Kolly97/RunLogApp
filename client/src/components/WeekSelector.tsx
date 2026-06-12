import type { SeasonWeek } from "../lib/api.ts";
import { fmtDate, fmtDateY, weekLabel, phaseLabel } from "../lib/util.ts";

export default function WeekSelector({
  season, weekNo, setWeekNo,
}: {
  season: SeasonWeek[]; weekNo: number | null; setWeekNo: (n: number) => void;
}) {
  return (
    <select value={weekNo ?? ""} onChange={(e) => setWeekNo(Number(e.target.value))} style={{ width: "auto", minWidth: 280 }}>
      {season.map((w) => (
        <option key={w.week_no} value={w.week_no}>
          {weekLabel(w)} · {phaseLabel(w.phase)} · {fmtDate(w.start_date)}–{fmtDateY(w.end_date)}{w.target_km ? ` · ${w.target_km} km` : ""}
        </option>
      ))}
    </select>
  );
}
