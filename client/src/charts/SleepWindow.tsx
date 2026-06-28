// Schlaffenster (v0.15.5): pro Tag ein Balken von Bettzeit → Aufwachzeit (Whoop-Stil).
// Y-Achse = Uhrzeit, Anker 18:00; nach Mitternacht/morgens läuft die Zeit weiter nach unten (reversed),
// d.h. späteres Zubettgehen/Aufstehen = weiter unten.
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const ANCHOR = 1080; // 18:00 in Minuten

function toMin(t: unknown): number | null {
  if (typeof t !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
/** Bettzeit → Minuten ab 18:00 (vor Mittag = nach Mitternacht). */
function bedAxis(t: unknown): number | null {
  const v = toMin(t); if (v == null) return null;
  return (v < 720 ? v + 1440 : v) - ANCHOR;
}
/** Aufwachzeit → Minuten ab 18:00 (immer „morgens", also +24h). */
function wakeAxis(t: unknown): number | null {
  const v = toMin(t); if (v == null) return null;
  return v + 1440 - ANCHOR;
}
function axisToClock(a: number): string {
  const mins = (((Math.round(a) + ANCHOR) % 1440) + 1440) % 1440;
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
}

interface Row { x: string; lohi: [number, number] | null; bed: string | null; wake: string | null; }

export default function SleepWindow({ data, xTickFormatter, height = 135 }: {
  data: { x: string; bedtime?: unknown; wake_time?: unknown }[];
  xTickFormatter?: (s: string) => string;
  height?: number;
}) {
  const rows: Row[] = data.map((d) => {
    const b = bedAxis(d.bedtime), w = wakeAxis(d.wake_time);
    const clean = (t: unknown) => (typeof t === "string" ? t.slice(0, 5) : null);
    return { x: d.x, lohi: b != null && w != null && w > b ? [b, w] : null, bed: clean(d.bedtime), wake: clean(d.wake_time) };
  });
  if (!rows.some((r) => r.lohi)) return <p className="tiny muted">Keine Bettzeit-/Aufwachdaten.</p>;

  const vals = rows.flatMap((r) => (r.lohi ? r.lohi : []));
  const min = Math.floor((Math.min(...vals) - 30) / 30) * 30;
  const max = Math.ceil((Math.max(...vals) + 30) / 30) * 30;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 6, right: 8, left: -6, bottom: -4 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="x" tickFormatter={xTickFormatter} minTickGap={20} interval="preserveStartEnd" tick={{ fontSize: 10, fill: "var(--chart-tick)" }} />
        <YAxis reversed domain={[min, max]} tickFormatter={axisToClock} width={44} tick={{ fontSize: 10, fill: "var(--chart-tick)" }} />
        <Tooltip content={<SleepTip xf={xTickFormatter} />} cursor={{ fill: "rgba(59,130,246,0.06)" }} />
        <Bar dataKey="lohi" fill="#3b82f6" radius={[3, 3, 3, 3]} maxBarSize={16} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function SleepTip({ active, payload, xf }: any) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as Row;
  if (!r.lohi) return null;
  const dur = r.lohi[1] - r.lohi[0];
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "6px 9px", fontSize: 12 }}>
      <div style={{ fontWeight: 700 }}>{xf ? xf(r.x) : r.x}</div>
      <div>Bett {r.bed ?? "–"} → Auf {r.wake ?? "–"}</div>
      <div className="muted">{Math.floor(dur / 60)}:{String(dur % 60).padStart(2, "0")} h im Bett</div>
    </div>
  );
}
