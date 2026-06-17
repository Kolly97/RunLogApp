import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { loadOptions } from "./lib/options.ts";
import "./styles.css";

// Konfigurierbare Auswahllisten früh laden (Cache füllt sich, Komponenten re-rendern).
void loadOptions();

// Kein React.StrictMode: react-grid-layout (T8 Edit-Modus) bricht im StrictMode-Doppelmount die
// Drag-/Resize-Verdrahtung (findDOMNode in react-draggable). StrictMode ist in Production ohnehin
// ein No-op; das Dev-Doppelrendering machte den Edit-Modus unbedienbar.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
