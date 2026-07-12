import { useState, type CSSProperties } from "react";
import { api, type SessionTemplate } from "../lib/api.ts";
import { typeColor, typeLabel, sportLabel } from "../lib/util.ts";
import { OverlayPortal } from "./OverlayPortal.tsx";
import T from "./T.tsx";
import { useT } from "../lib/i18n.tsx";

// Schlankes Verwalten-Modal: Vorlagen umbenennen / löschen. Aufgerufen aus der Tages-Schnellauswahl.
export default function TemplateManager({
  templates, onClose, onChange,
}: {
  templates: SessionTemplate[]; onClose: () => void; onChange: () => void;
}) {
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const t = useT();

  async function rename(tpl: SessionTemplate, name: string) {
    const n = name.trim();
    if (!n || n === tpl.name) return;
    await api.updateTemplate(tpl.id!, { ...tpl, name: n });
    onChange();
  }
  async function remove(id: number) {
    await api.deleteTemplate(id);
    setConfirmId(null);
    onChange();
  }

  return (
    <OverlayPortal>
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal} className="card">
        <div className="spread mb">
          <h2><T k="tpl.title">Vorlagen verwalten</T></h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>

        {!templates.length && <p className="muted"><T k="tpl.empty">Noch keine Vorlagen. Speichere eine Einheit über „☆ Als Vorlage speichern".</T></p>}

        {templates.map((tpl) => (
          <div key={tpl.id} className="row" style={{ gap: 8, padding: "6px 0", borderBottom: "1px solid var(--line, #e6e9ef)" }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: typeColor(tpl.type), flexShrink: 0 }} title={typeLabel(tpl.type)} />
            <input defaultValue={tpl.name} style={{ flex: 1 }}
              onBlur={(e) => rename(tpl, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            <span className="tiny muted nowrap">
              {tpl.sport !== "Run" && sportLabel(tpl.sport) + " · "}{typeLabel(tpl.type)}
              {tpl.planned_km ? ` · ${tpl.planned_km} km` : tpl.planned_min ? ` · ${tpl.planned_min} min` : ""}
            </span>
            {confirmId === tpl.id ? (
              <>
                <button className="sm danger" onClick={() => remove(tpl.id!)}><T k="tpl.btn.delete">Löschen?</T></button>
                <button className="sm ghost" onClick={() => setConfirmId(null)}>✕</button>
              </>
            ) : (
              <button className="sm ghost danger" title={t("tpl.btn.delete", "Löschen?")} onClick={() => setConfirmId(tpl.id!)}>✕</button>
            )}
          </div>
        ))}

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button className="primary" onClick={onClose}><T k="tpl.btn.done">Fertig</T></button>
        </div>
      </div>
    </div>
    </OverlayPortal>
  );
}

const overlay: CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(20,28,44,0.45)", display: "flex",
  alignItems: "flex-start", justifyContent: "center", padding: "10vh 16px", zIndex: 55,
};
const modal: CSSProperties = { width: 560, maxWidth: "100%", marginBottom: 0 };
