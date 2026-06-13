# RunLog — Trainingsplanung, Tracking & TrainingPeaks-Auswertung

Lokale, in sich geschlossene Web-App für die wöchentliche Trainingsplanung im Langstreckenlauf:
Einheiten planen → sportwissenschaftlich prüfen (passt das zur Phase?) → reale Daten dagegen halten →
druckfertiger Wochenbericht. Läuft komplett offline auf deinem Rechner, keine Cloud, kein Claude im Hintergrund.

## Voraussetzungen
- Node.js ≥ 22 (nutzt das eingebaute `node:sqlite`, kein nativer Build nötig). Getestet mit Node 25.

## Loslegen
```bash
npm install          # einmalig
npm run dev          # Entwicklungs-Modus → http://localhost:5173
```
Für den Alltag (ohne Auto-Reload, ein Prozess):
```bash
npm run build && npm start   # → http://localhost:3000
```

Die Daten liegen in `training.db` (SQLite) im Projektordner — einfach zu sichern und liegt mit im iCloud-Ordner.
In der App führt der Footer-Link **„Anleitung"** zu einer Schritt-für-Schritt-Übersicht (`/usage.html`).

## Seiten
- **Dashboard** — Performance Management Chart (Fitness/Fatigue/Form, Default: letzte 2 Wochen + kommende, Zeitraum umschaltbar), Saison-Progression, Form-Status, Check der aktuellen Woche, Intervall-Trend.
- **Wochenplanung** — Einheiten je Tag (Sport, Typ, km/min, **km je Zone**, Intervall-Builder, Beschreibung). Live-Panel: geplante km vs. Phasenziel, Zonenverteilung & Intensität, geplanter TSS, projizierte Form + regelbasierte Hinweise.
- **Tracking** — pro Tag Wellness (Gewicht, Ruhepuls, HRV, Schlaf inkl. Bett-/Aufwachzeit & Sleep-Performance, Recovery, Strain, Beine, RPE, Schmerz, …) und Aktivitäten (inkl. Intervall-Belastungen, km je Zone, kcal, Commute-Schnellerfassung).
- **Wochenbericht** — geplant-vs-real Tagestabelle mit Notizen unter jeder Einheit, Kategorie-Summen (Lauf/Rad/Kraft), Zonen-/Intensitäts-Charts, PMC-Ausschnitt, Wellness-Schnitt, Wochen-Check, Reflexion → **Drucken/PDF** (2-seitiges Druck-Layout).
- **Langzeit** — PMC + Saison-km über frei wählbaren Zeitraum, Wellness-Verläufe (HRV, Ruhepuls, Recovery, Strain, Schlaf, Bettzeit, Sleep-Performance, Gewicht), Zonen-Effizienz der Easy-Läufe, Intervall-Trend (LT1/LT2/VO2) → ebenfalls druckbar.
- **Races** (eigene Seite) — Wettkämpfe mit Endzeit, Distanz, Platzierung, Max-HF, Höhenmeter, manuellen Splits (km/Zeit/Pace/Ø-HF) und Notizen; erscheinen als (vertikale) goldene Marker in den Charts und einzeln im Wochenbericht. Wettkämpfe aus dem Saisonplan werden automatisch übernommen (manuelles Anlegen weiterhin möglich).
- **Saisonplan** (eigene Seite) — Wochen anlegen/bearbeiten; werden automatisch nach Datum sortiert und ab 0 durchnummeriert (erste Woche = #0).
- **Einstellungen** — Zonen-Sets mit Gültig-ab-Datum (HF, Pace mm:ss, Power in Watt), Analyse-Schwellen inkl. Intensitäts-Einstufung (TSS-basiert), Profile umbenennen/löschen (mit Bestätigungscode), **Strava-Verbindung**.
- **Auswahllisten** — Phasen, Sportarten und Einheitstypen ohne Code-Änderung hinzufügen/umbenennen/umfärben.

## Profile (mehrere Personen, ein PC)
Oben in der Sidebar sitzt der Profil-Wechsler („+ Neues Profil…" z. B. für Isabel). Jedes Profil hat
eigene Saison, Einheiten, Tracking-Daten und Zonen-Sets — ohne Passwort, alles lokal. Bestandsdaten
gehören dem Profil „Kolja".

## Strava-Anbindung (optional)
1. Einmalig auf [strava.com/settings/api](https://www.strava.com/settings/api) eine kostenlose API-App anlegen
   („Autorisierungs-Callback-Domain": `localhost`).
2. Client-ID + Client-Secret in **Einstellungen → Strava-Verbindung** eintragen → „Mit Strava verbinden".
3. „Sync seit Saisonstart" oder „Ganzes Jahr importieren" (→ PMC fürs ganze Jahr). Der Import holt km/Zeit/Ø-HF/Watt,
   liest die COROS-Training-Load aus der Beschreibung (TSS = TL × Faktor) und überschreibt **nie** vorhandene oder
   manuell bearbeitete Einheiten. Wegen des Strava-Rate-Limits reichert der Sync Details in Häppchen à 50 an —
   bei großen Importen einfach nach 15 min erneut ausführen.

## Auswertungs-Modell (an TrainingPeaks angelehnt)
- **TSS** je Einheit: aus Zonen-Allokation bzw. Typ+Dauer geschätzt (hrTSS, Rad über Watt/FTP); reale Einheiten nutzen COROS Training Load (kalibrierbar) bzw. rTSS/Power-TSS.
- **CTL (Fitness)** = 42-Tage-EWMA, **ATL (Fatigue)** = 7-Tage-EWMA, **TSB (Form)** = CTL − ATL.
- Geplante Einheiten werden in der PMC-Kurve nach vorne projiziert → du siehst vorab, wie die geplante Woche Fitness/Fatigue/Form bewegt.
- Prüf-Engine: Volumen vs. Phasenziel, Ramp-Rate, CTL-Ramp, Form/Taper, Polarisierung (80/20), Quality-Spacing, Longrun-Anteil, Recovery-Readiness, Phasen-Stimmigkeit. Alle Schwellen editierbar.

## Architektur
- `server/` — Express + `node:sqlite`. `db.ts` (Schema/Migrationen/Profile), `load.ts` (TSS/PMC), `analysis.ts` (Prüf-Engine), `zones.ts` (Zonen-Sets), `strava.ts` (OAuth/Sync), `import-docx.ts` (Seed), `index.ts` (API + statisches Hosting).
- `client/` — Vite + React + TypeScript, Charts mit Recharts. `pages/`, `charts/`, `components/`, `lib/`.
- Migrationen sind strikt **additiv** (`ALTER TABLE ADD COLUMN` + v2-Tabellen mit Kopie) — Bestandsdaten werden nie angetastet.

## App weitergeben / Datenbank zurücksetzen
Deine Trainingsdaten liegen ausschließlich im Ordner **`data/`** (`data/training.db`). Dieser Ordner ist per
`.gitignore` von der Versionskontrolle ausgenommen. **Beim Update der App** kopierst du einfach deinen
`data/`-Ordner in die neue Version. (Eine alte `training.db` aus dem Projekt-Wurzelordner wird beim ersten
Start einmalig automatisch nach `data/` übernommen; das Original bleibt als `training.db.bak`.)

- **Leere Vorlage erzeugen** (zum Mitgeben): `npm run db:template` → schreibt `training.empty.db`
  (nur Schema + Default-Zonen/Auswahllisten, **keine** persönlichen Daten). Dein `data/`-Ordner bleibt unberührt.
- **Eigene Daten zurücksetzen** (neu anfangen): `npm run db:reset` — sichert deine aktuelle `data/training.db`
  automatisch und legt eine frische an.

**Beim Weitergeben:** den Ordner **ohne `data/`** teilen (die App legt beim ersten Start automatisch eine
leere DB an) oder `training.empty.db` als `data/training.db` mitkopieren. `node_modules/` und `dist/` müssen
nicht mit — sie entstehen via `npm install` / `npm run build`.

## Änderungshistorie
Siehe [CHANGELOG.md](CHANGELOG.md) — aktuell **v0.9.0**.

## Ideen für später (siehe ToDo.md „In Zukunft")
v2.0-Redesign (GSAP/Three.js), gestrichelte Prediction-Linien rechts von „heute", TSS-Wochenverlauf im PMC.

## Lizenz
[MIT](LICENSE) © 2026 Kolja Hildenbrand. Erstellt mit Claude (Fable 5).
