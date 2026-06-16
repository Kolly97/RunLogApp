const __IMPORT_META_URL__ = require('url').pathToFileURL(__filename).href;
"use strict";

// electron/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("runlog", {
  desktop: true,
  platform: process.platform
});
