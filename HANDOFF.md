# HANDOFF — RunLogApp

> Lies dieses Dokument zuerst, dann kannst du ohne weiteres Erkunden weiterarbeiten.
> Versionshistorie im Detail: `CHANGELOG.md`. Offene Wünsche: `ToDo.md`.
> Stand: **v0.7.0** (13.6.2026). Eine lokale Trainings-App (Langstreckenlauf) im TrainingPeaks-Stil.

---

## 0. Arbeitsweise (WICHTIG — so will Kolja es)

- **Dateien NICHT jedes Mal komplett neu einlesen.** Kolja sagt Bescheid, was er in welcher Datei geändert
  hat. Vertraue dem Kontext; lies gezielt nur die Stelle, die du brauchst.
- **Schritte sequenziell, inline, von dir** — KEINE teuren Agent-Schwärme. Fable 5 nur wenn zwingend;
  Leichtes (Doku, einzelne Bugs, Einlesen) → günstigeres Modell.
- **Bei Problemen nicht festbeißen** → zurückstellen, Kolja das Problem schildern, gemeinsam lösen.
- **Plan-Modus** für jede neue ToDo-Runde: erst Screenshots/Code ansehen, mehrdeutige Design-Fragen per
  AskUserQuestion klären (Kolja will als UX/UI-Experte beraten werden — Stil bleibt **klinisch/datenanalytisch**,
  KEIN v2.0-Redesign), dann Plan, dann umsetzen.
- **Verifikation je Schritt:** `npx tsc --noEmit -p tsconfig.json` + `-p client/tsconfig.json`; am Ende `npm run build`.
  **Keine Server-Smoke-Tests** (liefen nie zuverlässig). DB-Checks per Runner-Skript (siehe unten).
- Nach Abschluss einer Runde: README + CHANGELOG + dieses HANDOFF + `package.json`-Version + `App.tsx` BUILD_DATE anheben.
  **Commit nur, wenn Kolja es sagt.**

## 1. Projekt-Basics

- Pfad: `~/Library/Mobile Documents/com~apple~CloudDocs/Kolja_Hildenbrand/Privates/Sport/RunLogApp/`
  — **Leerzeichen + `~` im Pfad → in Bash immer quoten!** Ordner heißt `RunLogApp` (nicht `runlog`).
- Stack: **Vite + React + TS** (`client/`), **Express + node:sqlite** (`server/`), Recharts. Läuft über `tsx`.
- Befehle: `npm run dev` (→ 5173) · `npm run build && npm start` (→ 3000) · `npm run db:template` (leere DB) ·
  `npm run db:reset` (eigene DB zurücksetzen, mit Backup).
- Daten in **`data/training.db`** (SQLite, gitignored; seit v0.7.0 im `data/`-Ordner — beim Update nur diesen
  kopieren). Pfad-Override via `RUNLOG_DB`. Alte Wurzel-`training.db` wird beim ersten Start einmalig nach
  `data/` übernommen (Original bleibt als `training.db.bak`). Lizenz MIT.
- **tsx-Gotcha:** `if (import.meta.url === file://argv[1])`-Main-Blöcke feuern wegen des iCloud-Pfads NICHT →
  für DB-Checks ein Runner-`_x.ts` IM Projektordner schreiben, `npx tsx _x.ts`, danach `rm`. Kein `/tmp` (relative Imports brechen).
- **DB-Regel:** Migrationen NUR additiv — `ALTER TABLE ADD COLUMN` mit `PRAGMA table_info`-Guard, oder neue
  Tabelle mit Einmal-Kopie. Bestandsdaten (Strava-Jahresimport, 1700+ Aktivitäten) sind heilig.

## 2. Architektur-Karte (wo liegt was)

**server/**
- `db.ts` — `initSchema()` → `migrate()` (additiv) + `seedDefaults()`. `renumberWeeks()` (Wochen pro Profil nach
  Datum ab 0). `activeProfile()`, `getSetting/setSetting`, `DEFAULT_HR_ZONES`.
- `index.ts` — alle Routen (Express). `pid()` = aktives Profil; **alle Daten-Queries profil-gefiltert**.
  `thresholds()` mischt `THRESHOLD_DEFAULTS` über gespeicherte (neue Keys gelten auch für Altbestand).
  `effectiveZoneSet`, `dailyTssMap`, `avgSessionTss/avgWeeklyTss`. `/api/analyze/week/:no` liefert u.a.
  `totals`, `flags`, `tssIntensity`, `zoneKmIntensity`, `plannedZoneKm`, `realZoneMin/Km`, `realByCategory`, `weekRating`, `projectedTsb`.
- `load.ts` — TSS-Mathe: `rTss`, `hrTssFromZones`, `powerTss`, `bikeTssEstimate`, `computePmc` (CTL 42d/ATL 7d/TSB),
  `ctlRamp`, `parseCorosLoad`, `timeInZone`, `DEFAULT_ZONE_PACE`, `round1`. Typen `HrZone`/`PmcPoint`.
- `analysis.ts` — `weekTotals`, `plannedSessionTss`, `sessionZoneMinutes`, `zoneKmOf`/`zoneKmIntensityOf`,
  `tssIntensityShares`, `weekRatingLevel`, `classifyTss`, `intervalEffortStat`, `analyzeWeek` (Prüf-Engine/Flags).
- `zones.ts` — `effectiveZoneSet(date)` (profil-gefiltert), `effectiveZoneSetForSeed()`.
- `strava.ts` — OAuth (login/callback), `stravaSync` (Listen-Import per `strava_id`, nie überschreiben,
  COROS-TL aus description → TSS, sonst hrTSS; Detail-Budget 50/Sync). `import-docx.ts` (Seed v2/Profil),
  `import-scans.ts` (Scan-Import, historisch), `reset-db.ts` (leere Vorlage).

**client/src/**
- `lib/api.ts` — ALLE Typen + `api`-Objekt (eine Stelle für Endpunkte). `lib/util.ts` — Formatter
  (`paceStr`,`fmtDur`,`fmtDate`,`fmtDateY`,`speedKmh`,`paceOrSpeed`,`isBikeSport`,`isoWeek`,`weekLabel`,`num`,…)
  + Re-Exports der Options-Helfer. `lib/options.ts` — Options-Cache, `useOptions()`, `loadOptions()` (in main.tsx),
  `phaseColor/phaseLabel/typeColor/typeLabel/sportLabel`. `lib/hooks.ts` — `useSeason()`. `lib/markers.ts` —
  `raceMarkers*`, `sick*`, `phaseRuns*`, `yearMarks*` (für die Charts).
- `pages/` — `Dashboard`, `WeekPlan`, `WeekTrack` (liest `?date`), `WeekReport` (2-seitiger Druck), `LongTerm`,
  `Races`, `SeasonPlan`, `Settings` (Profile-Verwaltung + Schwellen + Strava + Zonen-Sets), `OptionsConfig`.
- `charts/` — `Pmc`, `SeasonProgress`, `ChartDecor` (Phasenband+Jahresmarke als `<Customized>`), `IntensityDonut`,
  `IntensityCard`, `ZoneDistribution`, `IntervalTrend`, `WellnessTrends`, `RangeSelector`.
- `components/` — `WeekSelector`, `SessionModal`, `EffortBuilder`. `App.tsx` (Nav/Routen/ProfileSwitcher/Footer),
  `styles.css`, `pages/track.css`, `public/usage.html`.

## 3. Datenmodell (SQLite, alles profil-bezogen)

- `profiles(id,name)` — aktives Profil in `settings.active_profile` (Default 1 = „Kolja", Bestandsdaten).
- **v2-Tabellen sind die LIVE-Tabellen** (Originale bleiben als Backup): `season_weeks_v2` (PK profile_id,week_no),
  `week_log_v2` (PK profile_id,week_no), `daily_log_v2` (PK date,profile_id).
- `planned_sessions` (profile_id, `zone_alloc` JSON {byKm/byMin}, `efforts` JSON, `structured`, `planned_tss`),
  `activities` (profile_id, `kcal`, `zones`/`zone_min`/`zone_km` JSON, `efforts` JSON, `tss`, `training_load`, `strava_id`,
  `desc_fetched` = Strava-Beschreibung schon abgerufen → schützt Notizen vor Re-Sync-Überschreiben),
  `zone_sets` (profile_id, hr_zones/pace_zones/speed_zones/power_zones JSON, lthr/ftp/threshold_pace, valid_from),
  `races` (profile_id, date, name, distance_m, time_s, placement, notes, `splits` JSON [{km,time_s,pace_s,avg_hr,max_hr}],
  `avg_hr`, `max_hr`, `elevation_m`, `source` = manual|season; Auto-Import aus Saisonplan `goal_race` via Ledger `season_races_imported_<pid>`),
  `options` (kind: phase|sport|sessionType, value/label/color/sort/active, `intensity` = easy|moderate|hard nur bei sessionType
  → Grundlage für den TSS-Donut „nach Typ"), `settings` (key→JSON value).

## 4. Aktueller Funktionsstand (v0.7.0)

Planung mit km-je-Zone + Live-Prüf-Engine · Tracking (Wellness + Aktivitäten + Intervall-Builder + Notizen) ·
**PMC** (CTL/ATL/TSB, Prognose gestrichelt, Wochen-TSS-Summe, große Tagesbalken, Phasen-Farbband, Race-Marker
mit Toggle, Hover-Name + Klick→Tracking, klickbare Legende) · **Saison-Progression** (Phasenband, Jahresmarke,
Race/Krank) · **Intensitäts-Panel** (TSS-Donut mit Legende, km-Anteil je Zone, Last- + Polarisierungs-Badge) ·
**Langzeit-Seite** (Kacheln + Wellness/Effizienz/Intervall-Trends, druckbar) · **Races-Seite** mit Splits
(einzeln im Bericht) · **2-seitiger Druck-Bericht** ab 1.1. · konfigurierbare Auswahllisten · Kalenderwochen ·
leichte **Profile** (Wechsel in Sidebar, Umbenennen/Löschen mit Code **4397**) · **Strava** (OAuth + Sync, COROS-TL→TSS).

**v0.6.0-Schliff:** Intensitäts-Panel = nur noch TSS-Donut + %-km-Balken je Zone; Wochen-TSS-Last &
km-Polarisierung als Hinweise im Wochen-Check (`weekLoadFlag`/`kmPolarizationFlag` in `analysis.ts`,
angehängt in der `/api/analyze/week`-Route). Phasen-Farbband liegt jetzt VOR den Balken (Customized zuletzt
gerendert) + Phasenname unten links im PMC (folgt dem Hover). Jahresmarke positionsbasiert (Band-Index in
`markers.ts`/`ChartDecor.tsx`) → konsistent über alle Zeiträume, zwischen KW1/KW2, schwarz. Race-Labels
vertikal (`vRefLabel` in `ChartDecor.tsx`). Races mit Max-HF/Höhenmeter + Auto-Import aus Saisonplan.

**v0.7.0-Schliff:** TSS-Donut zählt jetzt **nach Einheitstyp** (`typeIntensityShares` in `analysis.ts`; Map aus
`options.intensity`, in „Auswahllisten" einstellbar) statt nach TSS-Größe — kein „Longrun = hart" mehr. Wochen-
Last **adaptiv** (Planung geplant↔Ø geplant via `avgPlannedWeeklyTss`, abgeschlossene Woche real↔Ø real).
Polarisierung nur noch km-in-Zone (Zeit-in-Zone-Flags raus). Races: Ø-HF + Max-HF (auch je Split), Split-Zeit
wieder eintippbar (uncontrolled `defaultValue`+`onBlur`). Layout: Dashboard 2/3+1/3, Bericht-Charts volle Breite,
PMC/Wochenkm ~20 % höher (Defaults 360/336), Phasenname auch im Wochenkm-Chart, Races-Toggle in der Legende.
Wellness-Langzeit mit Krank-Hinterlegung. Persönliche DB in `data/`.

## 5. Offen / nächste Schritte

- **Zurückgestellt — Strava-Stream-Runde:** (a) km je Zone aus Strava-Zeit-in-Zone, (b) Intervalldaten
  (Zeit/Strecke/Pace/Ø+Max-HF) für harte Einheiten automatisch aus dem Strava-Upload. Beide brauchen extra,
  ratenlimitierte `/activities/{id}/zones`- bzw. Lap/Stream-Abrufe + Mapping Strava-Zonen → eigene Zonen.
  Bis dahin ist „Real"-km je Zone nur dort genau, wo `zone_km` manuell eingetragen ist.
- **Strava nutzen:** Bei neuem Sync ggf. mehrfach (Rate-Limit-Häppchen à 50 für COROS-TL/kcal-Anreicherung).
  Notizen sind seit v0.6.0 vor Überschreiben geschützt (`desc_fetched`).
- **Bekannte Feinheiten v0.7.0** (falls Kolja sich meldet): Chart-Bodenbereich in `charts/ChartDecor.tsx` —
  Phasenband bei `plotBottom-6`, Jahres-/Phasentext bei `plotBottom+34`, Jahresstrich 0.25·Höhe (Opacity 0.85);
  Chart-Bottom-Margin in `Pmc.tsx`/`SeasonProgress.tsx` = 48; Default-Höhen 360 (PMC) / 336 (Wochenkm).
  Phasenname unten links jetzt in PMC **und** Wochenkm. Typ→Intensität-Map steuert den Donut (in „Auswahllisten").
- **ToDo.md „In Zukunft NICHT JETZT":** v2.0-Redesign (awwwards-Stil, GSAP/Three.js, eigener Branch/Folder),
  Chrome-DevTools-Testing. Erst auf ausdrücklichen Wunsch.

## 6. Verifikations-Routine

1. Beide Typechecks + `npm run build` → grün.
2. Daten intakt (Runner): `profiles ≥1`, `season_weeks_v2 ≥18`, `activities` groß (Strava), `daily_log_v2` ≥100, `races`-Tabelle existiert.
3. UI testet Kolja selbst (`npm run dev`).
