// Einmaliger Daten-Import in die installierte RunLog-Desktop-App.
// Kopiert data/training.db (inkl. -wal/-shm) in den App-Datenordner — nur falls dort noch keine DB liegt.
// Bestehende App-Daten werden NIE überschrieben (Bestand ist heilig).
//
//   node scripts/import-data.mjs           → Quelle: data/training.db
//   node scripts/import-data.mjs <pfad>    → eigene Quell-DB
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir, platform } from "node:os";

const PRODUCT = "RunLog";
const src = resolve(process.argv[2] || join(process.cwd(), "data", "training.db"));

function userDataDir() {
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", PRODUCT);
  if (platform() === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), PRODUCT);
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), PRODUCT);
}

const destDir = userDataDir();
const dest = join(destDir, "training.db");

if (!existsSync(src)) {
  console.error(`Quelle nicht gefunden: ${src}`);
  process.exit(1);
}
if (existsSync(dest)) {
  console.error(`Abbruch: ${dest} existiert bereits — App-Daten werden nicht überschrieben.`);
  console.error("Lösche die Datei zuerst manuell, wenn du wirklich neu importieren willst.");
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
for (const sfx of ["", "-wal", "-shm"]) {
  if (existsSync(src + sfx)) copyFileSync(src + sfx, dest + sfx);
}
console.log(`Importiert: ${src} → ${dest}`);
