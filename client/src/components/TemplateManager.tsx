import { useState, type CSSProperties } from "react";
import { api, type SessionTemplate } from "../lib/api.ts";
import { typeColor, typeLabel, sportLabel } from "../lib/util.ts";

// Schlankes Verwalten-Modal: Vorlagen umbenennen / löschen. Aufgerufen aus der Tages-Schnellauswahl.
export default function TemplateManager({
  templates, onClose, onChange,
}: {
  templates: SessionTemplate[]; onClose: () => void; onChange: () => void;
}) {
  const [confirmId, setConfirmId] = useState<number | null>(null);

  async function rename(t: SessionTemplate, name: string) {
    const n = name.trim();
    if (!n || n === t.name) return;
    await api.updateTemplate(t.id!, { ...t, name: n });
    onChange();
  }
  async function remove(id: number) {
    await api.deleteTemplate(id);
    setConfirmId(null);
    onChange();
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal} className="card">
        <div className="spread mb">
          <h2>Vorlagen verwalten</h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>

        {!templates.length && <p className="muted">Noch keine Vorlagen. Speichere eine Einheit über „☆ Als Vorlage speichern".</p>}

        {templates.map((t) => (
          <div key={t.id} className="row" style={{ gap: 8, padding: "6px 0", borderBottom: "1px solid var(--line, #e6e9ef)" }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: typeColor(t.type), flexShrink: 0 }} title={typeLabel(t.type)} />
            <input defaultValue={t.name} style={{ flex: 1 }}
              onBlur={(e) => rename(t, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            <span className="tiny muted nowrap">
              {t.sport !== "Run" && sportLabel(t.sport) + " · "}{typeLabel(t.type)}
              {t.planned_km ? ` · ${t.planned_km} km` : t.planned_min ? ` · ${t.planned_min} min` : ""}
            </span>
            {confirmId === t.id ? (
              <>
                <button className="sm danger" onClick={() => remove(t.id!)}>Löschen?</button>
                <button className="sm ghost" onClick={() => setConfirmId(null)}>✕</button>
              </>
            ) : (
              <button className="sm ghost danger" title="Vorlage löschen" onClick={() => setConfirmId(t.id!)}>✕</button>
            )}
          </div>
        ))}

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button className="primary" onClick={onClose}>Fertig</button>
        </div>
      </div>
    </div>
  );
}

const overlay: CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(20,28,44,0.45)", display: "flex",
  alignItems: "flex-start", justifyContent: "center", padding: "10vh 16px", zIndex: 55,
};
const modal: CSSProperties = { width: 560, maxWidth: "100%", marginBottom: 0 };
