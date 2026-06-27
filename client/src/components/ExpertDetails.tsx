// Experten-Details (v1.8.0): klappt tiefere / weniger belastbare Analysen ein, damit die Hauptansicht
// schlicht bleibt und nur robuste Kennzahlen zeigt. Wer mehr will, klappt es auf.
import { type ReactNode } from "react";

export default function ExpertDetails({ summary = "Experten-Details", children, defaultOpen = false }: { summary?: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="expert-details" style={{ marginTop: 8 }}>
      <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)", userSelect: "none" }}>ⓘ {summary}</summary>
      <div style={{ marginTop: 8 }}>{children}</div>
    </details>
  );
}
