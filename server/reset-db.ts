// Erzeugt eine FRISCHE, leere Datenbank (nur Schema + Defaults: ein Profil, Default-Zonen-Set,
// Auswahllisten) — OHNE persönliche Trainingsdaten. Zum Weitergeben der App.
//
// Nutzung:
//   npm run db:template   → schreibt training.empty.db (zum Mitgeben; deine training.db bleibt unberührt)
//   npm run db:reset      → setzt deine echte training.db zurück (vorher automatisch gesichert!)
//   npx tsx server/reset-db.ts <pfad>   → freier Zielpfad
import { existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2] || join(__dirname, "..", "training.empty.db"));

// Vorhandene Zieldatei (+ WAL/SHM-Sidecars) sichern statt überschreiben.
if (existsSync(target)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = `${target}.backup-${stamp}`;
  renameSync(target, backup);
  console.log(`Vorhandene Datei gesichert → ${backup}`);
}
for (const sfx of ["-wal", "-shm"]) {
  if (existsSync(target + sfx)) renameSync(target + sfx, `${target}${sfx}.old`);
}

// db.ts liest den Pfad aus RUNLOG_DB beim Import → vor dem Import setzen.
process.env.RUNLOG_DB = target;
const { initSchema, db } = await import("./db.ts");
initSchema(); // legt Tabellen an + seedet Defaults (Profil „Kolja", Default-Zonen, Optionen)
db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); // einzelne, in sich geschlossene Datei

const n = (s: string) => (db.prepare(s).get() as { n: number }).n;
console.log(`\nLeere DB erstellt: ${target}`);
console.log(
  `  Profile=${n("SELECT COUNT(*) n FROM profiles")} · ` +
    `Saison-Wochen=${n("SELECT COUNT(*) n FROM season_weeks_v2")} · ` +
    `Aktivitäten=${n("SELECT COUNT(*) n FROM activities")} · ` +
    `Tagesprotokolle=${n("SELECT COUNT(*) n FROM daily_log_v2")} · ` +
    `Zonen-Sets=${n("SELECT COUNT(*) n FROM zone_sets")} · ` +
    `Optionen=${n("SELECT COUNT(*) n FROM options")}`,
);
console.log("Fertig. Zum Weitergeben: diese Datei als 'training.db' kopieren (oder ohne training.db teilen — sie wird beim ersten Start automatisch angelegt).");
