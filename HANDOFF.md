# HANDOFF — RunLogApp

> Zweck: Sessionübergreifender Stand, damit ohne erneutes Einlesen weitergearbeitet werden kann.
> Aufgaben-Quelle: `ToDo.md` (Nutzer hakt ab/löscht Erledigtes). Versionshistorie: `CHANGELOG.md`.
> Plan-Datei: `~/.claude/plans/users-kollybook-library-mobile-document-gentle-bird.md`

## Projekt-Basics
- Pfad: `~/Library/Mobile Documents/com~apple~CloudDocs/Kolja_Hildenbrand/Privates/Sport/RunLogApp/`
  (**Leerzeichen + `~` im Pfad — immer quoten!** Ordner heißt `RunLogApp`, nicht `runlog`.)
- Stack: Vite+React+TS (`client/`), Express + **node:sqlite** (`server/`), echte Daten in `training.db`.
- Befehle: `npm run dev` (5173) · `npm run build && npm start` (3000) · Typecheck:
  `npx tsc --noEmit -p tsconfig.json` und `-p client/tsconfig.json`.
- **tsx-Gotcha:** `import.meta.url === file://argv[1]`-Main-Blöcke feuern NICHT (iCloud-Pfad) →
  Runner-`_x.ts` im Projektordner schreiben, `npx tsx _x.ts`, danach löschen. Kein `/tmp` (relative Imports).
- **Server-Smoke-Tests weglassen** (Nutzer-Vorgabe; liefen nie zuverlässig, App läuft trotzdem).
- **DB-Regel:** Migrationen NUR additiv (ALTER ADD COLUMN mit PRAGMA-Guard bzw. v2-Tabellen mit Einmal-Kopie).
- **Arbeitsweise (Nutzer-Vorgabe):** Schritte sequenziell inline, KEINE teuren Agent-Schwärme.
  Fable 5 nur wenn nötig; Leichtes (Einlesen, Doku, einzelne Bugs) → günstigeres Modell. Bei Problemen
  nicht festbeißen → zurückstellen und Kolja fragen.

## ✅ Stand v0.4.0 (13.6.2026) — Visualisierungs- & Account-Runde (tsc + build grün, Daten intakt)

- **Server:** `analysis.ts` → `tssIntensityShares`/`zoneKmIntensityOf`/`weekRatingLevel`/`classifyTss`;
  `index.ts` analyze-Route liefert `tssIntensity`/`zoneKmIntensity`/`weekRating` + Referenz-Helfer
  `avgSessionTss`/`avgWeeklyTss`; Schwellen `easy_pct`/`hard_pct`/`intensity_window_weeks` (THRESHOLD_DEFAULTS,
  gemischt → gilt auch für Altbestand); neue Route `PUT /api/profiles/:id` (umbenennen).
- **Charts:** `Pmc.tsx` neu (eigene TSS-Achse, gestrichelte Prognose ab heute, Wochen-TSS-Sägezahn,
  klickbare Legende, Props `races`/`sickRanges`); `SeasonProgress.tsx` (+ Jahresgrenze, Props
  `races`/`sickLabels`); `IntensityDonut.tsx` (Mitte konfigurierbar); NEU `IntensityCard.tsx`,
  `lib/markers.ts` (Race/Krank-Marker aus Saison+Sessions).
- **Seiten:** NEU `pages/SeasonPlan.tsx` (+ Nav `/season`); Saisonplan aus `Settings.tsx` ausgelagert,
  dort jetzt `ProfilesCard` (umbenennen/löschen, Code **4397**) + Intensitäts-Schwellen-Felder.
  Dashboard/LongTerm/WeekReport übergeben Marker an die Charts; WeekReport-PMC/Season ab 1.1.;
  LongTerm-Summen-Kacheln; WeekTrack editierbares Einheit-Notizfeld.
- Version 0.4.0 (package.json + Footer 13.06.2026), README/CHANGELOG aktualisiert.

## ✅ Stand v0.3.0 (12.6.2026) — Profile, Strava & Feinschliff (tsc + build grün, Daten intakt)

**Historie:** Scan-Import (14 Wochen handschriftlich, `!!!`-Marker für Unleserliches) · Welle 0 Fundament
(options-Tabelle + Config-Seite `/options`, kcal/efforts/zone_min/zone_km/speed_zones/power_zones/
sleep_performance-Spalten, KW-Labels, min/km vs km/h Formatter) · Welle 1 (Engine: Bike-TSS-Fix,
`/api/intervals/trend`, realZoneMin/byCategory; Eingabe: EffortBuilder, Tracking-Formular-Gruppen,
Commute-Quick-Add; Auswertung: RangeSelector, WellnessTrends, 2-seitiger Druck) · Fix-Runde (Watt-Zonen,
mm:ss-Pace, Langzeit-Seite, Footer/Impressum + `client/public/usage.html`).

**Abschlussrunde (12.6., inline ohne Agents):**
1. **Wochen-Auto-Renummerierung** — `renumberWeeks()` in `server/db.ts` (pro Profil, v2-Tabellen,
   Offset-Transaktion), Aufruf nach PUT/DELETE `/api/season/week/:no` + Seed. Erste Woche (Datum) = #0.
2. **Dashboard-PMC Default „3 Wo"** — Preset `3w` in `charts/RangeSelector.tsx` (Mo vor 2 Wochen bis So
   nächste Woche), `defaultMode="3w"` im Dashboard.
3. **Langzeit-Seite** (`pages/LongTerm.tsx`) — oben groß PMC + Saison-Progression (Range-gesteuert),
   Druck-Button (`window.print`, Titel `h1.lt-title` bleibt im Druck sichtbar, Zeitraum-Zeile).
4. **Wochenbericht-Notizen lesbarer** — `.note-row` mit Einzug/Linksborder/dunklerer Schrift/line-height;
   Einheiten-Name nur bei >1 Aktivität am Tag; Druck-CSS angepasst.
5. **Profile/Accounts (leicht, ohne Passwort)** — `profiles`-Tabelle (1=Kolja, Bestandsdaten);
   `profile_id` auf activities/planned_sessions/zone_sets; **v2-Tabellen** `daily_log_v2` (PK date+profile),
   `season_weeks_v2`, `week_log_v2` (PK profile+week) mit verlustfreier Einmal-Kopie (Originale = Backup);
   ALLE Routen + zones.ts + import-docx.ts profil-gefiltert; `ProfileSwitcher` in der Sidebar (App.tsx),
   Wechsel = `PUT /api/profile/active` + reload. Profil 1 + aktives Profil nicht löschbar.
6. **Strava** (`server/strava.ts` + Karte in Settings) — OAuth (Callback `localhost`, Credentials in
   settings: `strava_client_id/secret`, Tokens `strava_tokens` mit Auto-Refresh), `POST /api/strava/sync
   {after}`: paginierter Listen-Import (Upsert per strava_id, nie überschreiben), Sport-Mapping,
   TSS = COROS-TL×Faktor (Detail-Anreicherung Budget 50/Sync, Marker: notes nicht leer) sonst
   hrTSS-Näherung aus Ø-HF, kcal, Matching zu geplanter Einheit; Jahres-Import-Button (PMC ganzes Jahr).
   KEINE HR-Stream-Massenabfragen (Rate-Limit). **Wartet nur noch auf Koljas API-Credentials.**
7. **Doku** — README neu (Seiten, Profile, Strava-Setup), Version 0.3.0.

## ⏭ Offen
- Kolja: Strava-API-App anlegen (strava.com/settings/api, Callback-Domain `localhost`), ID+Secret in
  Einstellungen eintragen, verbinden, „Ganzes Jahr importieren" (ggf. mehrfach wegen Rate-Limit-Häppchen).
- ToDo.md „In Zukunft NICHT JETZT": v2.0-Redesign (GSAP/Three.js, eigener Branch), gestrichelte
  Prediction-Linien, TSS-Wochenverlauf im PMC, Chrome-DevTools-Testing.

## Verifikations-Routine (nach Änderungen)
1. Beide Typechecks + `npm run build`.
2. Daten-Intaktheit per Runner (Counts: profiles=1+, season_weeks_v2≥18, activities≥100, daily_log_v2≥107).
3. UI testet Kolja selbst (`npm run dev`); Strava-Sync erst nach Credentials möglich.
