// Minimal-EMA Session-Feedback (P4, Frage 6): 3 schnelle Tap-Felder unter einer Schlüsseleinheit —
// RPE (1–10), „vs. erwartet" (−2…+2) und Life-Stress (1–5). Speichert debounced (upsert per activity_id).
// Niedrige Reibung; baut die subjektive Datenbasis für den Feedback-Loop auf.
import { useEffect, useRef, useState } from "react";
import { api, type MlFeedback } from "../lib/api.ts";

export default function FeedbackPrompt({ activityId, date, sessionFamily }: { activityId: number; date?: string; sessionFamily?: string | null }) {
  const [f, setF] = useState<MlFeedback>({});
  const timer = useRef<number | null>(null);

  useEffect(() => {
    api.mlGetFeedback(activityId).then((r) => { if (r) setF(r); }).catch(() => {});
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [activityId]);

  const save = (patch: Partial<MlFeedback>) => {
    const next = { ...f, ...patch };
    setF(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api.mlSaveFeedback({ activity_id: activityId, date, session_family: sessionFamily ?? null, rpe: next.rpe ?? null, felt_vs_expected: next.felt_vs_expected ?? null, life_stress: next.life_stress ?? null }).catch(() => {});
    }, 400);
  };
  const numOrNull = (v: string) => (v === "" ? null : Number(v));

  return (
    <div className="tiny" style={{ display: "flex", gap: 14, alignItems: "center", padding: "3px 8px 6px", flexWrap: "wrap" }}>
      <span className="muted">Gefühl:</span>
      <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
        RPE
        <select value={f.rpe ?? ""} onChange={(e) => save({ rpe: numOrNull(e.target.value) })} style={{ width: 50 }}>
          <option value="">—</option>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
        vs. erwartet
        <select value={f.felt_vs_expected ?? ""} onChange={(e) => save({ felt_vs_expected: numOrNull(e.target.value) })} style={{ width: 64 }}>
          <option value="">—</option>
          <option value={-2}>− −</option>
          <option value={-1}>−</option>
          <option value={0}>=</option>
          <option value={1}>+</option>
          <option value={2}>+ +</option>
        </select>
      </label>
      <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
        Life-Stress
        <select value={f.life_stress ?? ""} onChange={(e) => save({ life_stress: numOrNull(e.target.value) })} style={{ width: 50 }}>
          <option value="">—</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </div>
  );
}
