# HANDOFF — RunLogApp

> Lies dieses Dokument zuerst, dann kannst du ohne weiteres Erkunden weiterarbeiten.
> Detaillierte Versionshistorie: `CHANGELOG.md`. Offene Wünsche: `ToDo.md`. Anleitung im Programm: `client/public/usage.html`.
> Stand: **v0.14.0** (15.6.2026). Lokale Trainings-App (Langstreckenlauf) im TrainingPeaks-Stil.

---

## 0. Arbeitsweise (WICHTIG — so will Kolja es)

- **Dateien NICHT jedes Mal komplett neu einlesen.** Kolja sagt, was er wo geändert hat. Vertraue dem Kontext;
  lies gezielt nur die Stelle, die du brauchst.
- **Schritte sequenziell, inline, von dir** — KEINE teuren Agent-Schwärme.
- **Bei Problemen nicht festbeißen** → zurückstellen, Kolja schildern, gemeinsam lösen.
- **Plan-Modus für jede neue ToDo-Runde:** erst Screenshots/Code ansehen, mehrdeutige Design-Fragen per
  AskUserQuestion klären (Kolja will als UX/UI-Experte beraten werden — Stil **klinisch/datenanalytisch**,
  KEIN v2.0-Redesign), dann Plan, dann umsetzen. Kolja justiert Chart-Kosmetik (Abstände, Schrift) oft selbst —
  seine Werte nicht ohne Anlass zurückdrehen.
- **Verifikation je Schritt:** `npx tsc --noEmit -p tsconfig.json` **und** `-p client/tsconfig.json`; am Ende
  `npm run build`. **Keine Server-Smoke-Tests** (liefen nie zuverlässig). DB-Checks per Runner-Skript (s. §6).
- **Rundenabschluss:** README + CHANGELOG + dieses HANDOFF + `package.json`-Version + `App.tsx` BUILD_DATE +
  ggf. `usage.html` anheben. **Commit nur, wenn Kolja es sagt.**

## 1. Projekt-Basics

- Pfad: `~/Library/Mobile Documents/com~apple~CloudDocs/Kolja_Hildenbrand/Privates/Sport/RunLogApp/`
  — **Leerzeichen + `~` → in Bash immer quoten!** Ordner heißt `RunLogApp`.
- Stack: **Vite + React + TS** (`client/`), **Express + node:sqlite** (`server/`), Recharts. Läuft über `tsx`.
- Befehle: `npm run dev` (→ 5173, Client + `tsx watch` Server auf 3000) · `npm run build && npm start` (→ 3000) ·
  `npm run db:template` (leere Vorlage) · `npm run db:reset` (eigene DB zurücksetzen, mit Backup).
- **Daten in `data/training.db`** (SQLite, gitignored; beim Update nur `data/` kopieren). Override via `RUNLOG_DB`.
  Alte Wurzel-`training.db` wird beim ersten Start einmalig nach `data/` übernommen (Original → `training.db.bak`).
- **tsx-Gotcha:** `import.meta.url === file://argv[1]`-Main-Blöcke feuern wegen des iCloud-Pfads NICHT → für
  DB-Checks ein Runner-`_x.ts` IM Projektordner schreiben, `npx tsx _x.ts`, danach `rm`. Kein `/tmp`.
- **DB-Regel:** Migrationen NUR additiv — `addColumn()` (PRAGMA-Guard) oder neue Tabelle mit Einmal-Kopie.
  Bestandsdaten (Strava-Jahresimport, ~1800 Aktivitäten) sind **heilig** → vor Massen-Updates Backup.
- **Live-Umgebung:** Meist läuft schon ein `tsx watch`-Server auf :3000 + Vite auf :5173. Server-Edits lädt der
  Watcher selbst neu; Endpunkte testbar via `curl http://localhost:3000/api/...`. Kollas Prozesse nicht killen.

## 2. Architektur-Karte (wo liegt was)

**server/**
- `db.ts` — `initSchema()` → `migrate()` (additiv) + Seeds. `DB_PATH` (export), `renumberWeeks()`,
  `activeProfile()`, `getSetting/setSetting`, `DEFAULT_HR_ZONES`. Spalten-Migrationen am Ende von `migrate()`.
- `load.ts` — **TSS-Mathe.** Lauf: `rTss` (Ø-Pace/NGP), `rTssFromZones` (geplant, per Zone), `runTss` (NGP→Ø-Pace).
  Rad: `powerTss` (NP/FTP), `bikeTssEstimate` (Dauer×IF). HF: `hrTssFromZones`, `timeInZone`. Streams:
  `computeNgp`+`gradeFactor` (NGP = Minetti-Grade-Korrektur + 30s-Norm), `computeNp` (NP, 30s-Norm),
  `streamZoneSplit` (HF-Zonen, Sek.+Meter), **`paceZoneSplit`** (Pace-Zonen-Sek. via `zoneFromPace`, für Plan-%),
  **`computeKmSplits`** (per-km Race-Splits). PMC: `computePmc` (CTL 42d / ATL 7d, **TSB = gestrige CTL−ATL**),
  `ctlRamp`. Sonst `DEFAULT_ZONE_PACE/SPEED`, `round1`. Typen `HrZone`/`PmcPoint`. (`parseCorosLoad` entfernt.)
- `analysis.ts` — `weekTotals`, `plannedSessionTss`, `typeIntensityShares` (Donut **nach Einheitstyp**),
  `zoneKmOf`/`zoneKmIntensityOf`, `classifyTss`, `weekRatingLevel`, `weekLoadFlag` + `kmPolarizationFlag`,
  **`sessionCompletion`** (Plan-% = TSS-Treffer + Pace-Zonen-Overlap), `intervalEffortStat`, `analyzeWeek`
  (Taper-Flag jetzt renntag-basiert: `raceDate/raceTsb/racePre7Tss/raceAvgWeeklyTss`).
- `index.ts` — alle Routen. `pid()`, `effectiveZoneSet`, `thresholds()` (+ `raceweek_tss_max_pct`), `dailyTssMap`,
  `earliestDataDate`, `avgPlannedWeeklyTss`/`avgWeeklyTss`, `addDaysIso`, **`ensureSeasonWeeks`** (2 Zukunftswochen
  + bis Renntag), **`syncRaceFromActivity`** (Race aus Tracking), `activityTssToStore`. Endpunkte u.a.:
  `/api/analyze/week/:no` (+ `adherence{perSession,weekPct}`), **`/api/bests`** (PB + CS), **`/api/plan-adherence`**
  (Wochenmittel), **`/api/strava/import-zones`**, `/api/recompute-tss`. `GET /api/season` ruft `ensureSeasonWeeks`.
- `zones.ts` — `effectiveZoneSet(date)` / `effectiveZoneSetForSeed()` (profil-gefiltert; hr/pace/power-zones,
  lthr/ftp/threshold_pace).
- `strava.ts` — OAuth (Scope `activity:read_all,profile:read_all`) + `stravaSync`: Listen-Import per `strava_id`
  (nie überschreiben). `api()` führt Rate-Limit-Header mit → `rateLimitMessage()` (15-min vs. **Tageslimit**) +
  `dayBudgetExhausted()`-Bremse. Anreicherung budgetiert: Detail (kcal, Beschreibung→leere Notiz; bei Läufen
  `best_efforts`→`parseBestEfforts`) + **Streams** (Lauf: `ngp`, `zone_min/km`, **`pace_zone_min`**, bei `type=Race`
  km-Splits ans verknüpfte Race; Rad: `np`). **`fetchAthleteZonesAndFtp`** für den Zonen-Import. Kein COROS mehr.
- `import-scans.ts` (historisch), `reset-db.ts` (leere Vorlage). (`import-docx.ts`/Seed in v0.12.0 entfernt.)

**client/src/**
- `lib/api.ts` — ALLE Typen + `api`-Objekt (eine Stelle für Endpunkte; `Activity` hat u.a. `ngp`/`np`/`elevation`).
- `lib/util.ts` — Formatter (`paceStr`, `fmtDur`, `fmtDate/Y`, `speedKmh`, `paceOrSpeed`, `isBikeSport`, `weekLabel`,
  `daysOfWeek`, `DAY_NAMES`, `num`, …) + Re-Exports der Options-Helfer.
- `lib/options.ts` — Options-Cache, `useOptions()`, `loadOptions()`, `phaseColor/Label`, `typeColor/Label`,
  `typeIntensity` (easy|moderate|hard je sessionType), `sportLabel`.
- `lib/hooks.ts` (`useSeason()`), `lib/markers.ts` (`raceMarkers*` NUR aus Races-Tabelle, `sick*`, `phaseRuns*`,
  `yearMarks*` per Band-Index).
- `pages/` — `Dashboard`, `WeekPlan` (Ziel-km editierbar), `WeekTrack` (?date; Tag/Woche-Switcher + Plan-%),
  `WeekReport` (2-seitiger Druck; EF + Plan-%-Graph + Werte-Block), `LongTerm` (+ Plan-%-Trend), `Races`,
  **`Bests`** (Bestzeiten + Critical Speed), `SeasonPlan`, `Profile`, `Settings`, `OptionsConfig`.
- `charts/` — `Pmc`, `SeasonProgress`, `ChartDecor` (Phasenband + Jahresmarke-Dreieck + Phasenname, `vRefLabel`),
  `IntensityDonut`, `IntensityCard`, `ZoneDistribution` (füllt Kachel + Z1–Z6-Legende), `WeekdayBars`
  (Bericht: gestapelt km [Lauf + Rad-äq.] und TSS [rTSS + übrige]), `IntervalTrend`, `WellnessTrends`, `RangeSelector`.
- `components/` — `WeekSelector`, `SessionModal`, `EffortBuilder`. `App.tsx`, `styles.css`, `pages/track.css`.

## 3. Datenmodell (SQLite, alles profil-bezogen)

- `profiles(id,name)` — aktives Profil in `settings.active_profile` (Default 1 = „Kolja").
- **v2-Tabellen sind LIVE** (Originale als Backup): `season_weeks_v2` (PK profile_id,week_no), `week_log_v2`,
  `daily_log_v2` (PK date,profile_id).
- `planned_sessions` (profile_id, `zone_alloc` JSON {byKm/byMin}, `efforts` JSON, `structured`, `planned_tss`).
- `activities` (profile_id, `distance_m`, `moving_s`, `avg_hr`/`max_hr`, `avg_power`, `elevation`, `kcal`,
  `zones`/`zone_min`/`zone_km` JSON, **`pace_zone_min`** JSON (Pace-Zonen-Min, für Plan-%), `efforts` JSON, `tss`,
  `training_load` (Legacy, ungenutzt → null), **`best_efforts`** JSON {distance_m:time_s} (Bestzeiten), `strava_id`,
  `matched_session_id`, `overrides` JSON, `notes`, **`ngp`** (s/km, Lauf), **`np`** (W, Rad), `desc_fetched`,
  `streams_fetched`).
- `zone_sets` (profile_id, hr/pace/speed/power-zones JSON, lthr/ftp/threshold_pace, valid_from; `source` u.a. „Strava").
- `races` (profile_id, date, name, distance_m, time_s, placement, notes, `splits` JSON [{km,time_s,pace_s,avg_hr,
  max_hr,elevation_m}], `avg_hr`, `max_hr`, `elevation_m`, `source`=manual|season|**tracking**, **`activity_id`**
  (verknüpfte getrackte Einheit); Auto-Import aus Saisonplan `goal_race` (Ledger `season_races_imported_<pid>`)
  **und aus Tracking** (`type='Race'` → `syncRaceFromActivity`)).
- `options` (kind: phase|sport|sessionType; value/label/color/sort/active; `intensity`=easy|moderate|hard nur bei
  sessionType → steuert den TSS-Donut). `settings` (key→JSON).

## 4. Funktionsstand v0.14.0 (Ist-Stand, nicht Historie)

**Neu in v0.14.0 (Kurz):**
- **Geräteneutral:** COROS-Training-Load komplett raus (Parsing/Faktor/Feld). TSS nur noch rTSS/NGP,
  Power-TSS/NP bzw. Schätzung + manuell. DB-Spalte `training_load` bleibt (additiv), wird nur noch `null`.
- **Bestzeiten + Critical Speed** (`/bests`, [Bests.tsx](client/src/pages/Bests.tsx)): PBs je Distanz aus
  Stravas `best_efforts` (Spalte `activities.best_efforts`); `GET /api/bests` aggregiert + fittet 2-Param-CS
  (`d=CS·t+D'`, aerobe PBs 2–30 min) inkl. Prognosen. Backfill budgetiert über Enrich.
- **Plan-Erfüllung (%)**: `sessionCompletion()` ([analysis.ts](server/analysis.ts)) = 0.5·TSS-Treffer +
  0.5·Pace-Zonen-Overlap (Spalte `activities.pace_zone_min` via `paceZoneSplit`/`zoneFromPace` im Enrich;
  fehlt sie → TSS-only). analyze-Route liefert `adherence{perSession,weekPct}`; `GET /api/plan-adherence`
  (Wochenmittel) fürs Langzeit. Anzeige: Tracking-Kachel-Badge, Bericht-Balken, Langzeit-Trend.
- **Efficiency Factor je Wochentag** im Bericht (NGP-m/min ÷ Ø-HF, nur Easy/Long), „⚡ hart davor"-Marker.
- **Race aus Tracking**: Lauf-Typ `Race` → `syncRaceFromActivity` ([index.ts](server/index.ts)) legt
  verknüpften Race an (Spalte `races.activity_id`, `source='tracking'`); km-Splits beim Enrich aus Streams
  (`computeKmSplits`). Typ zurückgeändert → Auto-Race weg.
- **Auto-Wochen**: `ensureSeasonWeeks()` hält immer 2 Zukunftswochen + Wochen bis Renntag (leer); läuft in
  `GET /api/season` + nach `POST /api/races`.
- **Race-Taper auf 7-Tage-Fenster**: analyze nutzt Renntag (Races/goal_race) → `raceTsb` + `racePre7Tss` vs.
  `raceweek_tss_max_pct` (Default 60); ersetzt den phasen-basierten Taper-Flag.
- **Strava-Zonen-Import**: `fetchAthleteZonesAndFtp` + `POST /api/strava/import-zones` → neues zone_set ab
  wählbarem Datum (HF 5→6, Power, FTP; LTHR/Pace übernommen). Scope jetzt `activity:read_all,profile:read_all`
  → einmal neu verbinden. Strava-`api()` führt Rate-Limit-Header mit (ehrliche Meldung + Tages-Bremse
  `dayBudgetExhausted`).
- **Strava-Zeitraum** als Setting `strava_sync_from`; Sync-Button „Sync ab Datum".
- **Tracking-Redesign** ([WeekTrack.tsx](client/src/pages/WeekTrack.tsx)): Wochentag-Switcher (`WeekdayTabs`,
  Punkte = geplant Typ-Farbe + grün wenn getrackt) + Tag/Woche-Toggle (Tag default); Kachel-Farbbalken nach Typ.
- **Ziel-km in Wochenplanung** editierbar; **Dauer hh:mm:ss** (Tracking+Planung, `clockToSec`/`secToClock`);
  Race-Splits-Felder breiter; globaler Button-Feinschliff.

**Neu in v0.13.0 (Kurz):**
- **Geplante km per Datumsbereich:** `/api/analyze/week` + `/api/sessions?week` laden `planned_sessions`
  per `date BETWEEN wk.start..end` (nicht week_no) → „Geplante Woche" == Tag-Raster; fehlgeleitete Altlast
  verfälscht nicht mehr. [index.ts](server/index.ts).
- **Wochen-Pfeile** ← → im [WeekSelector](client/src/components/WeekSelector.tsx) (season ist datums-sortiert).
- **Planung ohne HF:** [EffortBuilder](client/src/components/EffortBuilder.tsx) `planning`-Prop blendet Ø-/Max-HF
  aus (SessionModal übergibt `planning`). Tracking unverändert.
- **Strava nur anreichern:** `enrichBudgeted()` ausgelagert; neuer Endpoint `POST /api/strava/enrich`
  (`stravaEnrich`) + Button in den Einstellungen — zieht Details/Streams/Laps für Bestand nach, ohne neue zu importieren.
- **Tagesfaktor-Kategorien:** Options-`kind='dailyCat'` (editierbar in Auswahllisten); Zuordnung je Feld in der
  `color`-Spalte des `daily`-Options. DailyForm rendert klappbare Sektionen je Kategorie (`legs` als Spezialfeld).
- **Reset** löscht zusätzlich planned_sessions/season_weeks_v2/races (+ Race-Ledger); nur zone_sets bleiben.

**Neu in v0.12.0 (Kurz):**
- **Saisonplan KW-gesteuert** ([SeasonPlan.tsx](client/src/pages/SeasonPlan.tsx)): nur KW(+Jahr) editierbar,
  Datum (Mo–So) automatisch via `mondayOfIsoWeek` (util.ts). „Beispiel-Saison importieren" **entfernt**
  (`import-docx.ts` gelöscht, Route `/api/seed` + npm-Script `seed` weg). `deleteWeek` löscht die geplanten
  Einheiten der Woche mit; `POST /api/season/cleanup-orphans` (beim Laden) entfernt Plan-Einheiten ohne Woche.
- **Wiederholungs-Gruppen (Sets)** im EffortBuilder: `Effort` kann `{group:true, reps, children}` sein;
  `flattenEfforts`/`flattenEffortLines` expandieren für Stats/Trend/Bericht (`fmtEffort` → „3×(1000+200)").
- **Strava-Work-Laps** ([strava.ts](server/strava.ts) `extractWorkLaps`): Laps schneller als Z3 / Ø-HF ≥ Z4
  → Efforts (nur in leere), Marker `activities.laps_fetched`.
- **Profil-Seite** ([Profile.tsx](client/src/pages/Profile.tsx), Route `/profile`): Profile + Reset
  (`POST /api/profiles/:id/reset`, löscht activities/daily/weeklog/**planned_sessions/season_weeks_v2/races** +
  Race-Import-Ledger, behält NUR zone_sets, Backup) + HF-Zonen/Schwellen
  ([components/ZoneSets.tsx](client/src/components/ZoneSets.tsx), aus Settings ausgelagert).
- **Konfigurierbare Tagesfaktoren**: Options-`kind='daily'` (Feldtyp in der `intensity`-Spalte), feste Basis
  (`BASE_DAILY` in options.ts); eigene Felder in `daily_log_v2.custom` (JSON). DailyForm/OptionsConfig getrieben.
- **HF-Zonen-Eingabe** nur Obergrenze (Untergrenze = Vorzone+1); **Heatmap-Wochen-Score** (gold→rot) + sticky
  Kategorie-Spalte; **Phasenname im Chart-Tooltip** (Wellness/Effizienz) + Jahresmarken via `yearMarksByDateAll`;
  **Bericht** 3 Karten (Balken/Donuts/breite reale Schilder); **Tracking-Layout** in Blöcke; OptionsConfig-Eingabe Label→Wert.

**Neu in v0.11.0 (Kurz):**
- **Schilder geplant/real getrennt:** `/api/analyze/week` liefert `flags` (geplant → Wochenplanung) **plus**
  `realLoadFlag`/`realKmFlag`/`realKmIntensity` (real → Wochenbericht). Bericht behält beide Donuts.
- **Tracking-Einheitstyp:** Spalte `activities.type`; Dropdown im Tracking; im Real-Donut + Intervall-Trend
  hat `a.type` Vorrang vor dem gematchten Plan-Typ. Neue sessionType-Optionen LT1/LT2/VO2short/VO2long
  (idempotent geseedet, `intervalEffortStat` mappt sie direkt auf die Trend-Kategorie).
- **Wochen-Checks konfigurierbar:** Options-`kind='check'` (Auswahllisten-Editor), Wochenbericht liest sie
  dynamisch; **Langzeit-Heatmap** (`/api/weeklogs`, Wochen × Checks). week_log_v2.checks unverändert.
- **Wander/Sonstiges-TSS:** `activityTssToStore` → General/Other HR-basiert (`otherTssEstimate`:
  hrTssFromZones, sonst Ø-HF-IF, sonst Fixwert 0.45); Bike bleibt Power/`bikeTssEstimate`. **Recompute drücken.**
- **Charts:** Jahres-Dreieck+Phasenband in den Langzeit-Wellness/Effizienz-Charts (`ChartDecor` via
  `<Customized>`); Effizienz-Legende (Pace/HF) klickbar; Wochentags-Chart kühl=Distanz/warm=Last + gruppierte
  Legende. **Jahres-Akkordeon** in `WeekSelector` (Popover) + Saisonplan-Tabelle (`groupByYear` in util.ts).
- **Navigation:** Sprung-Icon Wochenbericht↔Tracking (`WeekSelector` `jumpTo`-Prop, `?date=`); GAP+Höhenmeter
  im Tracking-Formular.


**Seiten:** Dashboard · Wochenplanung · Tracking · Wochenbericht (2-seitig druckbar) · Langzeit · Races ·
Bestzeiten · Saisonplan · Profil · Einstellungen · Auswahllisten. Leichte Profile (Wechsel in Sidebar; Löschen/Umbenennen mit Code **4397**).

**TSS-Modell (Kern, TrainingPeaks):**
- **Lauf → rTSS** = `(s/3600)·(NGP/FTP)²·100`, FTP = Schwellen-Pace. Aktivität nutzt `ngp` (aus Strava-Stream),
  sonst Ø-Pace (`runTss`). Geplant per Zone (`rTssFromZones`).
- **Rad/Rolle/Commute → Power-TSS** = `(s/3600)·(NP/FTP)²·100`. Aktivität nutzt `np` (aus watts-Stream), sonst
  Ø-Power; ohne Leistung `bikeTssEstimate` (Dauer×IF nach Typ).
- **COROS-Training-Load** ist nur noch informativ (kein TSS mehr). Manuell gesetzter `tss` (`overrides:['tss']`)
  hat Vorrang. Quelle: `activityTssToStore` (index.ts) für Aktivitäten, `plannedSessionTss` (analysis.ts) für Plan.
- **Recompute:** Settings-Button „TSS neu berechnen (Lauf + Rad)" → `/api/recompute-tss` (Backup + alle
  Lauf-/Rad-TSS + geplante TSS, aktives Profil). Nach Strava-Syncs (mehr NGP/NP) erneut drücken.

**PMC:** `CTL` (42d-EWMA), `ATL` (7d-EWMA), **`TSB` = CTL_gestern − ATL_gestern**. CTL/ATL aus der vollen
Historie geseedet, Anzeige auf den Zeitraum zugeschnitten. **CTL-Ramp** am „heute"-Punkt (Δ CTL/Woche; 5–8 = nachhaltig).
Geplante Einheiten → gestrichelte Prognose rechts von heute. Hover = Einheitsname, Klick → Tracking.

**Intensität & Check:** TSS-Donut **nach Einheitstyp** (easy/moderat/hart, je Typ in „Auswahllisten" einstellbar).
Wochenbericht: zwei Donuts geplant vs. real (TSS-Zahl in der Mitte; real **hybrid**: zonen-anteilig, sonst
gematchter Typ). Wochen-Check-Hinweise: Volumen, Ramp, **Wochen-Last** (adaptiv geplant↔geplant / real↔real) und
**km-Polarisierung** (nur km-in-Zone). ZoneDistribution = gestapelter %-km-Balken Z1–Z6 (füllt Kachel + Legende).

**Charts:** PMC + Saison-Progression mit Phasen-Farbband (Hover = Phasenname; Phasenname unten links), Jahresmarke
als **Dreieck** zwischen KW52/KW1, Race-Marker (gold, vertikal, nur aus Races-Tabelle, an/aus), „diese Woche" als
`ReferenceArea`, Krank-Wochen rot. Wochenbericht hat zusätzlich den **WeekdayBars**-Chart (1/3) neben der
Saison-Progression (2/3). Höhenmeter + GAP (nur Lauf, =`ngp`) bei den Einheiten in Tracking + Bericht.
Langzeit: Wellness- + Zonen-Effizienz-Verläufe (beide mit Krank-Rot), Intervall-Trend (LT1/LT2/VO2).

**Strava:** OAuth + Sync (nie überschreiben), Streams für Lauf (NGP) + Rad (NP) budgetiert; manuelle Notizen/Zonen
geschützt. **Commute**-Schalter (Bike-Einheit → Sportart General, Name „Commute", Notiz weg, `desc_fetched=1`).

## 5. Offen / nächste Schritte

- **v0.14.0 inhaltlich abgeschlossen** (ToDo.md v0.14.0 komplett bis auf den Desktop-Punkt). **Offen: WS 6 —
  Electron-Desktop-App** (App per Icon auf Mac/Windows) → bewusst eigener Meilenstein (Packaging/Icons/Sidecar;
  node:sqlite braucht Node 22+). Plan + Entscheidungen liegen in `~/.claude/plans/polished-sparking-russell.md`.
- **Strava-Backfill (budgetiert):** `best_efforts` (Bestzeiten), `pace_zone_min` (Plan-Erfüllung Pace-Anteil),
  NGP/NP + min/km-Zone, Race-Splits kommen je Einheit erst beim „Details/Splits nachziehen" rein → Altbestand
  braucht mehrere Durchläufe (Tages-Bremse stoppt vor dem Strava-Tageslimit). Danach „TSS neu berechnen". Plan-%
  ist bis dahin TSS-only (`tssOnly`), Bestzeiten/CS füllen sich nach und nach.
- **Grenzen (dokumentiert):** Strava liefert nur *aktuelle* Zonen (Import-`valid_from` selbst wählen, 5→6-HF-
  Mapping, Z6 geschätzt); CS-Modell braucht aerobe PBs; EF/Plan-% nur für Strava-Läufe mit Streams.
- **Zurückgestellt — Intervall-Auto-Extraktion:** Efforts je Wiederholung automatisch aus Lap/Stream. Eigene Runde.
- **„In Zukunft NICHT JETZT" (ToDo.md):** Readiness, Dashboard-Tagesvorschlag, VO2max, Pace-/HF-Histogramm,
  Race-Prediction, v2.0-Redesign (awwwards/GSAP/Three.js, eigener Branch) — erst auf ausdrücklichen Wunsch.
- **Bekannte Feinheiten (Kolja-Kosmetik, nicht zurückdrehen):** Jahresmarke-Dreieck in `ChartDecor.tsx`
  (Spitze `plotBottom-20`, Jahreszahl `plotBottom+34`, Phasentext `plotBottom+50`, Phasenband `plotBottom-6`);
  Chart-Bottom-Margin `Pmc.tsx` 30 / `SeasonProgress.tsx` 28.

## 6. Verifikations-Routine

1. `npx tsc --noEmit -p tsconfig.json` + `-p client/tsconfig.json` + `npm run build` → grün.
2. DB-Runner (`_x.ts` im Projektordner, danach `rm`): Bestand intakt — `profiles ≥1`, `season_weeks_v2 ≥18`,
   `activities` ~1800, `daily_log_v2 ≥100`, `races` vorhanden; Spalten `ngp`/`np`/`streams_fetched` da.
   Importiere dafür aus `./server/load.ts`/`./server/zones.ts` und rechne Stichproben gegen die gespeicherten Werte.
3. TSS-/PMC-Endpunkte ggf. per `curl localhost:3000/api/...` prüfen (Watch-Server läuft meist).
4. UI testet Kolja selbst (`npm run dev`).
