import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { loadOptions } from "./lib/options.ts";
import "./styles.css";

// Konfigurierbare Auswahllisten früh laden (Cache füllt sich, Komponenten re-rendern).
void loadOptions();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
