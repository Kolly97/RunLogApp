// Staged den Python-Sidecar für die Electron-Pakete: kopiert engine.py + requirements nach build/sidecar/
// und lädt (best effort) eine relocatable CPython (python-build-standalone) für DAS aktuelle OS herunter und
// installiert die requirements hinein. Schlägt der Runtime-Teil fehl, wird OHNE Runtime gestaged → die App
// nutzt zur Laufzeit den Pure-TS-Fallback (Plan: Python im Default, TS als Sicherheitsnetz).
//
// Modi:
//   node scripts/build-sidecar.mjs                 voll: stage + Runtime laden + pip install
//   node scripts/build-sidecar.mjs --check         nur Plan ausgeben, nichts schreiben/laden
//   node scripts/build-sidecar.mjs --skip-runtime  nur engine.py/requirements stagen (kein Download)
//
// electron-builder verschifft build/sidecar via extraResources nach process.resourcesPath/sidecar.
// Pro-OS-Validierung gehört in CI (electron-builder baut je OS, dieses Script läuft je OS).
import { mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const SRC = join(ROOT, "server", "ml-sidecar");
const STAGE = join(ROOT, "build", "sidecar");
const RUNTIME = join(STAGE, "runtime");

// python-build-standalone Release pinnen (astral-sh). Bei Update beide Werte anheben.
const PBS_TAG = "20250612";
const PY_VER = "3.12.11"; // in Tag 20250612 verfügbar (3.12.4 existiert dort NICHT → 404). Beide Werte zusammen anheben.
const TRIPLES = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
};
const key = `${process.platform}-${process.arch}`;
const triple = TRIPLES[key];
const url = triple
  ? `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/cpython-${PY_VER}+${PBS_TAG}-${triple}-install_only.tar.gz`
  : null;

const args = process.argv.slice(2);
const check = args.includes("--check");
const skipRuntime = args.includes("--skip-runtime");
const targetArg = args.find((a) => a.startsWith("--target="));
const target = targetArg ? targetArg.slice("--target=".length) : null; // erwartetes Ziel-OS: darwin|win32|linux

console.log(`[sidecar] OS=${key}  triple=${triple || "NICHT UNTERSTÜTZT"}`);
console.log(`[sidecar] runtime url: ${url || "(keine)"}`);
console.log(`[sidecar] stage dir:   ${STAGE}`);

if (check) {
  console.log("[sidecar] --check: nichts geschrieben/geladen.");
  process.exit(0);
}

// Cross-OS-Builds werden NICHT unterstützt: relocatable CPython + native Wheels (numpy/pymc/scipy) sind pro-OS.
// electron-builder + dieses Script müssen je Ziel-OS AUF dessen OS laufen (siehe npm run electron:build:*).
// Ohne Guard würde z.B. beim Bauen des Windows-Pakets auf dem Mac eine macOS-Python ins .exe verschifft.
if (target && target !== process.platform) {
  console.error(
    `[sidecar] ABBRUCH: Ziel-OS '${target}' ≠ Host-OS '${process.platform}'.\n` +
      `           Baue das ${target}-Paket auf einem ${target}-Rechner (oder in CI je OS).\n` +
      `           Sonst landet eine ${process.platform}-Python (+ Wheels) in einem ${target}-Paket → nicht lauffähig.`,
  );
  process.exit(1);
}

// 1) IMMER: engine.py + requirements stagen (damit extraResources 'from' existiert)
mkdirSync(STAGE, { recursive: true });
copyFileSync(join(SRC, "engine.py"), join(STAGE, "engine.py"));
if (existsSync(join(SRC, "requirements.txt"))) {
  copyFileSync(join(SRC, "requirements.txt"), join(STAGE, "requirements.txt"));
}
console.log("[sidecar] engine.py + requirements gestaged.");

if (skipRuntime || !url) {
  console.log("[sidecar] Runtime übersprungen → Laufzeit nutzt TS-Fallback.");
  process.exit(0);
}

// 2) BEST EFFORT: relocatable CPython laden + requirements installieren
try {
  rmSync(RUNTIME, { recursive: true, force: true });
  mkdirSync(RUNTIME, { recursive: true });
  const tgz = join(STAGE, "python.tar.gz");
  console.log("[sidecar] lade CPython …");
  execSync(`curl -fsSL "${url}" -o "${tgz}"`, { stdio: "inherit" });
  // install_only-Tarball entpackt nach python/ → strip-components=1 legt bin/ direkt in RUNTIME
  execSync(`tar -xzf "${tgz}" -C "${RUNTIME}" --strip-components=1`, { stdio: "inherit" });
  rmSync(tgz, { force: true });
  const py = process.platform === "win32" ? join(RUNTIME, "python.exe") : join(RUNTIME, "bin", "python3");
  console.log("[sidecar] installiere requirements …");
  execSync(`"${py}" -m pip install --no-warn-script-location -r "${join(STAGE, "requirements.txt")}"`, {
    stdio: "inherit",
  });
  console.log("[sidecar] Runtime fertig:", py);
} catch (e) {
  console.warn("[sidecar] WARNUNG: Runtime-Bundling fehlgeschlagen → ohne Runtime gestaged (TS-Fallback aktiv).");
  console.warn(String(e?.message || e));
  rmSync(RUNTIME, { recursive: true, force: true });
}
