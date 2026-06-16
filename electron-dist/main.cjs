const __IMPORT_META_URL__ = require('url').pathToFileURL(__filename).href;
"use strict";

// electron/main.ts
var import_electron = require("electron");
var import_node_path = require("node:path");
var import_node_fs = require("node:fs");
var DEV_URL = process.env.ELECTRON_START_URL || "";
var isDev = !!DEV_URL;
var win = null;
function ensureUserDb(dbPath) {
  if ((0, import_node_fs.existsSync)(dbPath)) return;
  const candidates = [
    process.env.RUNLOG_IMPORT_DB,
    // expliziter Override (z.B. Migration vom Dev-Ordner)
    (0, import_node_path.join)(process.resourcesPath || "", "seed", "training.db")
    // im Paket mitgelieferte Start-DB
  ].filter((p) => !!p && (0, import_node_fs.existsSync)(p));
  const src = candidates[0];
  if (!src) return;
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(dbPath), { recursive: true });
  for (const sfx of ["", "-wal", "-shm"]) {
    if ((0, import_node_fs.existsSync)(src + sfx)) (0, import_node_fs.copyFileSync)(src + sfx, dbPath + sfx);
  }
  console.log(`RunLog: Trainings-DB \xFCbernommen von ${src}`);
}
async function startEmbeddedServer() {
  const userData = import_electron.app.getPath("userData");
  const dbPath = (0, import_node_path.join)(userData, "training.db");
  ensureUserDb(dbPath);
  process.env.RUNLOG_DB = dbPath;
  process.env.RUNLOG_EMBED = "1";
  process.env.RUNLOG_DIST = (0, import_node_path.join)(__dirname, "..", "dist");
  process.env.NODE_ENV = "production";
  const serverMod = require("./server.cjs");
  const { port } = await serverMod.startServer(0);
  return port;
}
function createWindow(url) {
  win = new import_electron.BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#ffffff",
    title: "RunLog",
    webPreferences: {
      preload: (0, import_node_path.join)(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadURL(url);
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\/localhost(?::\d+)?\//.test(target)) return { action: "allow" };
    import_electron.shell.openExternal(target);
    return { action: "deny" };
  });
  win.on("closed", () => {
    win = null;
  });
}
import_electron.app.whenReady().then(async () => {
  let url = DEV_URL;
  if (!isDev) {
    const port = await startEmbeddedServer();
    url = `http://localhost:${port}`;
  }
  buildMenu();
  createWindow(url);
  import_electron.app.on("activate", () => {
    if (import_electron.BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});
import_electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") import_electron.app.quit();
});
function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...isMac ? [{ role: "appMenu" }] : [],
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
        { role: "togglefullscreen" }
      ]
    },
    { role: "windowMenu" }
  ];
  import_electron.Menu.setApplicationMenu(import_electron.Menu.buildFromTemplate(template));
}
