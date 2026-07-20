import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { LangProvider } from "./lib/i18n.tsx";
import { loadOptions } from "./lib/options.ts";
import { applyTheme } from "./lib/theme.ts";
import { motionEnabled } from "./lib/motion.ts";
import { setAppToday, todayIso } from "./lib/util.ts";
import "./styles.css";

// M1/M2: Theme + Animations-Status vor dem ersten Paint setzen (kein Flash).
applyTheme();
document.documentElement.setAttribute("data-motion", motionEnabled() ? "on" : "off");

// Konfigurierbare Auswahllisten früh laden (Cache füllt sich, Komponenten re-rendern).
void loadOptions();

// v3.2.0: Das „heute" der App vom Server holen, BEVOR gerendert wird — im Demo-Profil (Isabel) ist es eingefroren.
// Ohne diesen Schritt liefe der Browser auf der Systemuhr und die App zeigte eine andere Woche als der Server
// plant. Ein fehlgeschlagener Abruf ist unkritisch: `todayIso()` fällt dann auf die Systemuhr zurück.
async function bootAppTime(): Promise<void> {
  try {
    const r = await fetch("/api/app-time");
    if (r.ok) setAppToday(((await r.json()) as { today?: string }).today ?? null);
  } catch { /* offline/Startrennen → Systemuhr */ }
}

async function refreshAppTime(): Promise<void> {
  try {
    const before = todayIso();
    const r = await fetch("/api/app-time");
    if (!r.ok) return;
    const next = ((await r.json()) as { today?: string }).today ?? null;
    if (next && next !== before) {
      setAppToday(next);
      window.location.reload();
    }
  } catch { /* App bleibt auf dem zuletzt bekannten Tag */ }
}

// Kein React.StrictMode: react-grid-layout (T8 Edit-Modus) bricht im StrictMode-Doppelmount die
// Drag-/Resize-Verdrahtung (findDOMNode in react-draggable). StrictMode ist in Production ohnehin
// ein No-op; das Dev-Doppelrendering machte den Edit-Modus unbedienbar.
void bootAppTime().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <LangProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </LangProvider>,
  );
  window.addEventListener("focus", () => { void refreshAppTime(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshAppTime(); });
  window.setInterval(() => { void refreshAppTime(); }, 15 * 60 * 1000);
});
