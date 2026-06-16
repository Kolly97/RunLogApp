// Bündelt Electron-Main, Preload und den Express-Server zu lauffähigen Node-CJS-Dateien.
// Vermeidet das Mitliefern von tsx; node:sqlite bleibt als Built-in extern.
import { build } from "esbuild";
import { rmSync } from "node:fs";

const OUT = "electron-dist";
rmSync(OUT, { recursive: true, force: true });

const common = {
  bundle: true,
  platform: "node",
  target: "node22", // Electron 42 bringt Node 24; node22 ist sicher abwärtskompatibel
  format: "cjs",
  sourcemap: false,
  logLevel: "info",
  // node:sqlite ist ein Built-in von Electrons Node → niemals bündeln.
  external: ["electron", "node:sqlite"],
  // Im CJS-Bundle gibt es kein import.meta.url → auf die Datei-URL von __filename mappen,
  // damit `dirname(fileURLToPath(import.meta.url))` weiterhin __dirname ergibt.
  define: { "import.meta.url": "__IMPORT_META_URL__" },
  banner: {
    js: "const __IMPORT_META_URL__ = require('url').pathToFileURL(__filename).href;",
  },
};

// Server inkl. express in ein eigenes Bundle (wird vom Main per require('./server.cjs') geladen).
await build({
  ...common,
  entryPoints: { server: "server/index.ts" },
  outdir: OUT,
  outExtension: { ".js": ".cjs" },
});

// Preload separat (eigener Kontext im Renderer).
await build({
  ...common,
  entryPoints: { preload: "electron/preload.ts" },
  outdir: OUT,
  outExtension: { ".js": ".cjs" },
});

// Main: server.cjs bleibt extern (Laufzeit-require), damit die Env-Reihenfolge stimmt.
await build({
  ...common,
  entryPoints: { main: "electron/main.ts" },
  outdir: OUT,
  outExtension: { ".js": ".cjs" },
  external: [...common.external, "./server.cjs"],
});

console.log("electron-dist gebaut: main.cjs, preload.cjs, server.cjs");
