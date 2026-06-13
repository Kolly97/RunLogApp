# HANDOFF — RunLogApp

> Lies dieses Dokument zuerst, dann kannst du ohne weiteres Erkunden weiterarbeiten.
> Versionshistorie im Detail: `CHANGELOG.md`. Offene Wünsche: `ToDo.md`.
> Stand: **v0.5.0** (13.6.2026). Eine lokale Trainings-App (Langstreckenlauf) im TrainingPeaks-Stil.

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
- Daten in `training.db` (SQLite, im Projektordner, gitignored). Lizenz MIT.
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
  `activities` (profile_id, `kcal`, `zones`/`zone_min`/`zone_km` JSON, `efforts` JSON, `tss`, `training_load`, `strava_id`),
  `zone_sets` (profile_id, hr_zones/pace_zones/speed_zones/power_zones JSON, lthr/ftp/threshold_pace, valid_from),
  `races` (profile_id, date, name, distance_m, time_s, placement, notes, `splits` JSON [{km,time_s,pace_s,avg_hr}]),
  `options` (kind: phase|sport|sessionType, value/label/color/sort/active), `settings` (key→JSON value).

## 4. Aktueller Funktionsstand (v0.5.0)

Planung mit km-je-Zone + Live-Prüf-Engine · Tracking (Wellness + Aktivitäten + Intervall-Builder + Notizen) ·
**PMC** (CTL/ATL/TSB, Prognose gestrichelt, Wochen-TSS-Summe, große Tagesbalken, Phasen-Farbband, Race-Marker
mit Toggle, Hover-Name + Klick→Tracking, klickbare Legende) · **Saison-Progression** (Phasenband, Jahresmarke,
Race/Krank) · **Intensitäts-Panel** (TSS-Donut mit Legende, km-Anteil je Zone, Last- + Polarisierungs-Badge) ·
**Langzeit-Seite** (Kacheln + Wellness/Effizienz/Intervall-Trends, druckbar) · **Races-Seite** mit Splits
(einzeln im Bericht) · **2-seitiger Druck-Bericht** ab 1.1. · konfigurierbare Auswahllisten · Kalenderwochen ·
leichte **Profile** (Wechsel in Sidebar, Umbenennen/Löschen mit Code **4397**) · **Strava** (OAuth + Sync, COROS-TL→TSS).

## 5. Offen / nächste Schritte

- **Strava nutzen:** Kolja hat eine Strava-API-App + Jahresimport gemacht (Daten sind drin). Bei neuem Sync ggf.
  mehrfach (Rate-Limit-Häppchen à 50 für COROS-TL/kcal-Anreicherung).
- **Bekannte Feinheiten v0.5.0** (falls Kolja sich meldet): Phasen-Farbband + Jahres-Beschriftung sitzen an festen
  Pixel-Offsets in `charts/ChartDecor.tsx` (y = plotBottom-5 fürs Band, plotBottom+25 für die Jahreszahl) → bei
  Bedarf dort justieren. „Real"-Zonenverteilung ist nur dort km-genau, wo `zone_km` eingetragen ist (Strava liefert Sekunden).
- **ToDo.md „In Zukunft NICHT JETZT":** v2.0-Redesign (awwwards-Stil, GSAP/Three.js, eigener Branch/Folder),
  Chrome-DevTools-Testing. Erst auf ausdrücklichen Wunsch.

## 6. Verifikations-Routine

1. Beide Typechecks + `npm run build` → grün.
2. Daten intakt (Runner): `profiles ≥1`, `season_weeks_v2 ≥18`, `activities` groß (Strava), `daily_log_v2` ≥100, `races`-Tabelle existiert.
3. UI testet Kolja selbst (`npm run dev`).
