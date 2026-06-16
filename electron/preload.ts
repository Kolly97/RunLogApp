// Preload: bewusst minimal. Der Renderer spricht den lokalen Express-Server weiter über
// relative fetch('/api/...')-Aufrufe an — es werden (noch) keine Node-APIs in den Renderer gebrückt.
// Datei existiert als sicherer Einstiegspunkt (contextIsolation aktiv) für spätere Bedarfe.
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("runlog", {
  desktop: true,
  platform: process.platform,
});
