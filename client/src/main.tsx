import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { LangProvider } from "./lib/i18n.tsx";
import { loadOptions } from "./lib/options.ts";
import { applyTheme } from "./lib/theme.ts";
import { motionEnabled } from "./lib/motion.ts";
import "./styles.css";

// M1/M2: Theme + Animations-Status vor dem ersten Paint setzen (kein Flash).
applyTheme();
document.documentElement.setAttribute("data-motion", motionEnabled() ? "on" : "off");

// Konfigurierbare Auswahllisten früh laden (Cache füllt sich, Komponenten re-rendern).
void loadOptions();

// Kein React.StrictMode: react-grid-layout (T8 Edit-Modus) bricht im StrictMode-Doppelmount die
// Drag-/Resize-Verdrahtung (findDOMNode in react-draggable). StrictMode ist in Production ohnehin
// ein No-op; das Dev-Doppelrendering machte den Edit-Modus unbedienbar.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <LangProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </LangProvider>,
);
