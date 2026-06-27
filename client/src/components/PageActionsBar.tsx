// Fixierte Aktionsleiste (v1.9.0): hostet „Layout bearbeiten" (von EditableGrid via Context) + „Hilfe & Tipps"
// (route-basiert) gemeinsam in einer am Viewport-Boden klebenden Bande — kein Scrollen, nicht gedruckt.
import { createContext, useContext, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { HELP } from "./PageHelp.tsx";

export interface EditAction { editing: boolean; toggle: () => void; reset: () => void }
const Ctx = createContext<{ edit: EditAction | null; setEdit: (e: EditAction | null) => void }>({ edit: null, setEdit: () => { /* noop */ } });

export function PageActionsProvider({ children }: { children: ReactNode }) {
  const [edit, setEdit] = useState<EditAction | null>(null);
  return <Ctx.Provider value={{ edit, setEdit }}>{children}</Ctx.Provider>;
}
export const usePageActions = () => useContext(Ctx);

const PATH_HELP: Record<string, string> = {
  "/": "dashboard", "/plan": "plan", "/coach": "coach", "/track": "track", "/report": "report", "/longterm": "longterm",
  "/races": "races", "/bests": "bests", "/methodik": "methodik", "/profile": "profile",
};

export function PageActionsBar() {
  const { edit } = usePageActions();
  const loc = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  const help = HELP[PATH_HELP[loc.pathname] ?? ""] ?? null;
  if (!edit && !help) return null;
  return (
    <div className="page-actions-bar no-print">
      {helpOpen && help && (
        <div className="page-actions-help">
          <strong>{help.title}</strong>
          <ul>{help.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
          <a className="tiny" href="/usage.html" target="_blank" rel="noreferrer">→ Vollständige Anleitung öffnen</a>
        </div>
      )}
      <div className="page-actions-row">
        {edit && (edit.editing
          ? <>
              <span className="tiny muted">Layout-Bearbeitung — pro Profil gespeichert</span>
              <button className="sm ghost" onClick={edit.reset}>Zurücksetzen</button>
              <button className="sm primary" onClick={edit.toggle}>✓ Fertig</button>
            </>
          : <button className="sm ghost" onClick={edit.toggle}>✎ Layout bearbeiten</button>)}
        {help && (
          <button className="sm ghost" style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setHelpOpen((o) => !o)}>
            <span className="ph-badge">!</span>{helpOpen ? "Hilfe schließen" : "Hilfe & Tipps"}
          </button>
        )}
      </div>
    </div>
  );
}
