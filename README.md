# RunLog — Trainingsplanung, Tracking & TrainingPeaks-Auswertung 

Lokale, in sich geschlossene lokale Web-App für die wöchentliche Trainingsplanung im Langstreckenlauf:
Einheiten planen → sportwissenschaftlich prüfen (passt das zur Phase?) → reale Daten dagegen halten →
druckfertiger Wochenbericht. Läuft komplett offline auf deinem Rechner, keine Cloud oder so im Hintergrund.

![RunLog_GitHub_Repo_Card](app_icon/RunLog_GitHub_Repo_Card.jpg)

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
- **Dashboard** — Performance Management Chart (PMC, 2fr) + Aktuelle Woche (1fr) nebeneinander; darunter Saison-Progression + Intensity-Trend (ATL/CTL-Verhältnis, 5-Band) auf halber Breite. Stat-Grid mit CTL/ATL/TSB/CTL-Ramp + **VO2max-Kachel** (VDOT, Niveau-Badge, Mini-Sparkline). Zeitraum umschaltbar.
- **Wochenplanung** — Einheiten je Tag (Sport, Typ, km/min, **km je Zone**, Intervall-Builder, Beschreibung). Phase-Pille klickbar (Inline-Dropdown). Einheiten per Drag-and-Drop verschieben oder ⊕ kopieren. Live-Panel: geplante km vs. Phasenziel, Zonenverteilung & Intensität, geplanter TSS, projizierte Form, regelbasierte Hinweise + **TSS-Empfehlung-Badge** (Ampel aus CTL × Phase). Wettkampf-Einheit → Race automatisch angelegt.
- **Tracking** — Wochentag-Switcher (Punkte skalieren mit TSS), Tag/Woche-Umschalter; pro Tag Wellness (Schlaf inkl. Bett-/Aufwachzeit in h:mm & Sleep-Performance, HRV, Ruhepuls, Recovery, Strain, Beine, RPE, Schmerz, Gewicht, …) und Aktivitäten als Kacheln (Typ-Farbbalken, **% Plan-Erfüllung**, Intervall-Belastungen, km je Zone, kcal, Dauer als h:mm:ss, Commute-Schnellerfassung, „+ Zusätzliche Einheit"). Strava-Aktivitäten: „↻ Aus Strava neu laden"-Knopf (setzt Intervall-Sperre zurück). Ein Lauf mit Typ „Wettkampf" landet automatisch in Races.
- **Wochenbericht** — geplant-vs-real Tagestabelle mit Notizen + **Plan-Erfüllung als Farb-Kachel je Tag** (≥ 90 % grün / ≥ 70 % gold / sonst rot), Kategorie-Summen, Zonen-/Intensitäts-Charts, **Efficiency Factor je Wochentag**, PMC bis zur Berichtswoche (+ CTL/ATL/TSB/Ramp), reale Bewertungs-Schilder, Wellness-Schnitt inkl. **Schlaffenster (Bett → Auf)**, Wochen-Check, Reflexion → **Drucken/PDF** (2-seitiges Layout, Wasserzeichen).
- **Langzeit** — PMC + Saison-km, **Intensity-Trend (ATL/CTL)**, Wellness-Verläufe (HRV, Ruhepuls, Recovery, Strain, Schlaf, **Schlaffenster-Chart im Whoop-Stil**, Sleep-Performance, Gewicht, 8-Wochen-Referenzband), Zonen-Effizienz der Easy-Läufe, **Plan-Erfüllung (Wochenmittel)**, Intervall-Trend (LT1/LT2/VO2) → ebenfalls druckbar.
- **Races** (eigene Seite) — Wettkämpfe mit Endzeit, Distanz, Platzierung, Ø-/Max-HF, Höhenmeter, manuellen Splits und Notizen; erscheinen als goldene Marker in den Charts. Wettkämpfe aus Saisonplan, Tracking **und Wochenplanung** werden automatisch übernommen.
- **Bestzeiten** (eigene Seite) — persönliche Bestzeiten je Standarddistanz aus Strava + **Critical-Speed-Modell** (CS-Pace, D′, R², Prognosen) mit Distanz-Zeit-Diagramm + **Race-Prediction-Chart** (5k/10k/HM/Marathon über den Saisonverlauf aus dem CS-Modell, Y-Achse invertiert: schneller = oben).
- **Saisonplan** (eigene Seite) — Wochen anlegen/bearbeiten; automatisch nach Datum sortiert und ab 0 nummeriert.
- **Profil** — Athletenprofil (Geburtsjahr, Geschlecht, Gewicht, Max-HF für VO2max-Norm), HF-Zonen Lauf + **Fahrrad** separat, Pace- und Power-Zonen. Profile umbenennen/löschen/zurücksetzen.
- **Einstellungen** — Zonen-Sets mit Gültig-ab-Datum, Analyse-Schwellen, Strava-Verbindung.
- **Auswahllisten** — Phasen, Sportarten und Einheitstypen ohne Code-Änderung hinzufügen/umbenennen/umfärben.

## Profile (mehrere Personen, ein PC)
Oben in der Sidebar sitzt der Profil-Wechsler („+ Neues Profil…" z. B. für Isabel). Jedes Profil hat
eigene Saison, Einheiten, Tracking-Daten und Zonen-Sets — ohne Passwort, alles lokal. Bestandsdaten
gehören dem Profil „Kolja".

## Strava-Anbindung (optional)
1. Einmalig auf [strava.com/settings/api](https://www.strava.com/settings/api) eine kostenlose API-App anlegen
   („Autorisierungs-Callback-Domain": `localhost`).
2. Client-ID + Client-Secret in **Einstellungen → Strava-Verbindung** eintragen → „Mit Strava verbinden".
3. „Sync ab Datum" (das **„Daten ab"-Datum** ist einstellbar) oder „Ganzes Jahr importieren" (→ PMC fürs ganze Jahr).
   Der Import holt km/Zeit/Ø-HF/Watt + Streams (NGP/NP, Zeit-in-Zone, Bestzeiten) und überschreibt **nie** vorhandene
   oder manuell bearbeitete Einheiten — geräteneutral (kein COROS-Bezug mehr). Wegen des Strava-Rate-Limits
   (100/15 min **und** ~1000/Tag) reichert der Sync Details budgetiert an und stoppt vor dem Tageslimit; die
   Meldung sagt, welches Limit erreicht ist. Optional lassen sich HF-/Power-Zonen + FTP aus Strava importieren
   (Profil → HF-Zonen → „Aus Strava holen"; einmaliges Neu-Verbinden nötig).

## Auswertungs-Modell (an TrainingPeaks angelehnt)
- **TSS** je Einheit, geräteneutral: Lauf = **rTSS** (NGP/Ø-Pace gegen Schwellen-Pace), Rad = **Power-TSS** (NP/FTP) bzw. Schätzung; geplant per Zonen-Allokation (rTSS je Zone). Ein selbst eingetragener TSS hat Vorrang.
- **CTL (Fitness)** = 42-Tage-EWMA, **ATL (Fatigue)** = 7-Tage-EWMA, **TSB (Form)** = CTL − ATL.
- **ACWR (Intensity-Trend)** = ATL/CTL × 100 %: zeigt wo du aktuell im Belastungs-Korridor liegst (5 Bänder von Decreasing bis Excessive; optimal: 80–149 %).
- **VO2max-Schätzung** per VDOT-Formel (Daniels-Gilbert) aus deinen besten Laufzeiten — mit Niveau-Badge nach ACSM-Normen (Alter + Geschlecht). Füllt sich automatisch mit den Strava-Bestzeiten.
- **Race-Prediction** aus dem Critical-Speed-Modell: CS-Pace + D′ aus aeroben Bestzeiten → Prognosekurven 5k/10k/HM/Marathon über den Saisonverlauf.
- **TSS-Wochenempfehlung** (3:1-Prinzip): Korridor aus CTL × Phase — Aufbau, Erhalt, Entlastung, Race Week und Krank haben eigene Faktoren; wird als Ampel-Badge in der Wochenplanung angezeigt.
- Geplante Einheiten werden in der PMC-Kurve nach vorne projiziert → du siehst vorab, wie die geplante Woche Fitness/Fatigue/Form bewegt.
- Prüf-Engine: Volumen vs. Phasenziel, Ramp-Rate, CTL-Ramp, Form/Taper, Polarisierung (80/20), Quality-Spacing, Longrun-Anteil, Recovery-Readiness, Phasen-Stimmigkeit. Alle Schwellen editierbar.

## Architektur
- `server/` — Express + `node:sqlite`. `db.ts` (Schema/Migrationen/Profile), `load.ts` (TSS/PMC/NGP/Best-Efforts/Zonen-Splits), `analysis.ts` (Prüf-Engine + Plan-Erfüllung), `zones.ts` (Zonen-Sets), `strava.ts` (OAuth/Sync/Zonen-Import), `index.ts` (API + statisches Hosting).
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
Siehe [CHANGELOG.md](CHANGELOG.md) — aktuell **v0.15.5**.

## Desktop-App (Electron)
Fertige Installer liegen in den [GitHub Releases](../../releases) — als App mit Desktop-Icon, ganz ohne Terminal:

- **macOS:** `RunLog-<version>-arm64.dmg` herunterladen, öffnen, RunLog in den Programme-Ordner ziehen, fertig.
- **Windows:** `RunLog-Setup-<version>.exe` herunterladen und ausführen. Der Installations-Assistent führt durch
  Pfadwahl und legt Startmenü-Eintrag + Deinstaller an. Da der Installer nicht signiert ist, meldet sich beim
  ersten Start ggf. der Windows-SmartScreen („Unbekannter Herausgeber") → **Weitere Informationen → Trotzdem ausführen**.

Deine Trainingsdaten liegen pro Betriebssystem im jeweiligen App-Datenordner
(`~/Library/Application Support/RunLog` auf macOS, `%APPDATA%\RunLog` auf Windows) — getrennt von der App, bleiben
bei Updates erhalten.

Wer lieber im Web-Modus arbeitet oder selbst baut: `npm run build && npm start` → [http://localhost:3000](http://localhost:3000) — alle Features sind auch im Browser vollständig verfügbar.

### Selbst bauen
- **macOS:** `npm install && npm run electron:build` → `.dmg` in `release/`.
- **Windows:** `npm install && npm run electron:build:win` → NSIS-`.exe` in `release/`.
- **Automatisch (CI):** Beim Pushen eines Tags `v*` (z. B. `git tag v1.0.0 && git push origin v1.0.0`) baut GitHub Actions
  den Windows-Installer auf einem Windows-Runner und hängt ihn ans zugehörige Release
  (siehe `.github/workflows/build-windows.yml`).

## Ideen für später (siehe ToDo.md „In Zukunft")
Readiness · Dashboard-Tagesvorschlag · Pace-/HF-Histogramm · v2.0-Redesign (GSAP/Three.js)

## Lizenz
[MIT](LICENSE) © 2026 Kolja Hildenbrand
