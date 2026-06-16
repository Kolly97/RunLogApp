// Electron-Main: startet den bestehenden Express-Server im Main-Prozess (Sidecar) und zeigt
// den React-Renderer in einem Fenster. Risikoarme Architektur (CLAUDE.md §12) — kein IPC-Umbau.
import { app, BrowserWindow, Menu, shell } from "electron";
import { join, dirname } from "node:path";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";

// Dev-Modus: Vite-Dev-Server (5173) + tsx-Server (3000) laufen extern; nur das Fenster zeigen.
const DEV_URL = process.env.ELECTRON_START_URL || "";
const isDev = !!DEV_URL;

let win: BrowserWindow | null = null;

/**
 * Übernimmt einmalig eine vorhandene Trainings-DB in den App-Datenordner, falls dort noch keine liegt.
 * Quelle: RUNLOG_IMPORT_DB (explizit) oder die im Paket mitgelieferte Vorlage. Bestehende Daten bleiben
 * UNANGETASTET — kopiert wird nur, wenn das Ziel fehlt (Bestand ist heilig).
 */
function ensureUserDb(dbPath: string): void {
  if (existsSync(dbPath)) return; // niemals überschreiben
  const candidates = [
    process.env.RUNLOG_IMPORT_DB, // expliziter Override (z.B. Migration vom Dev-Ordner)
    join(process.resourcesPath || "", "seed", "training.db"), // im Paket mitgelieferte Start-DB
  ].filter((p): p is string => !!p && existsSync(p));
  const src = candidates[0];
  if (!src) return; // keine Quelle → frische DB wird vom Server angelegt
  mkdirSync(dirname(dbPath), { recursive: true });
  for (const sfx of ["", "-wal", "-shm"]) {
    if (existsSync(src + sfx)) copyFileSync(src + sfx, dbPath + sfx);
  }
  console.log(`RunLog: Trainings-DB übernommen von ${src}`);
}

async function startEmbeddedServer(): Promise<number> {
  const userData = app.getPath("userData");
  const dbPath = join(userData, "training.db");
  ensureUserDb(dbPath);

  // WICHTIG: vor dem Laden des Servers setzen — db.ts liest RUNLOG_DB beim Modul-Load.
  process.env.RUNLOG_DB = dbPath;
  process.env.RUNLOG_EMBED = "1"; // unterdrückt den Auto-Listen im Server
  process.env.RUNLOG_DIST = join(__dirname, "..", "dist"); // gebautes Frontend (vite) eine Ebene höher
  process.env.NODE_ENV = "production";

  // Server-Bundle als separates CJS-File (esbuild external) — garantiert Env-Reihenfolge.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const serverMod = require("./server.cjs") as {
    startServer: (port?: number) => Promise<{ port: number }>;
  };
  const { port } = await serverMod.startServer(0); // ephemerer Port
  return port;
}

function createWindow(url: string): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#ffffff",
    title: "RunLog",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(url);

  // Externe Links (z.B. strava.com-Hilfeseiten) im System-Browser öffnen, nicht im App-Fenster.
  // Die Strava-OAuth-Navigation läuft über localhost und bleibt daher im Fenster.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\/localhost(?::\d+)?\//.test(target)) return { action: "allow" };
    shell.openExternal(target);
    return { action: "deny" };
  });

  win.on("closed", () => {
    win = null;
  });
}

app.whenReady().then(async () => {
  let url = DEV_URL;
  if (!isDev) {
    const port = await startEmbeddedServer();
    url = `http://localhost:${port}`;
  }
  buildMenu();
  createWindow(url);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ role: "appMenu" as const }]
      : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "Ansicht",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
