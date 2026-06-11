import { useEffect, useState } from "react";
import { api, type SeasonWeek } from "./api.ts";
import { todayIso } from "./util.ts";

export function useSeason() {
  const [season, setSeason] = useState<SeasonWeek[]>([]);
  const [weekNo, setWeekNo] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    const s = await api.season();
    setSeason(s);
    setLoading(false);
    return s;
  }

  useEffect(() => {
    reload().then((s) => {
      if (s.length && weekNo == null) {
        const today = todayIso();
        const cur = s.find((w) => w.start_date <= today && today <= w.end_date);
        setWeekNo(cur ? cur.week_no : s[s.length - 1].week_no);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const week = season.find((w) => w.week_no === weekNo) || null;
  return { season, week, weekNo, setWeekNo, loading, reload };
}
