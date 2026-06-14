# HANDOFF — RunLogApp

> Lies dieses Dokument zuerst, dann kannst du ohne weiteres Erkunden weiterarbeiten.
> Detaillierte Versionshistorie: `CHANGELOG.md`. Offene Wünsche: `ToDo.md`. Anleitung im Programm: `client/public/usage.html`.
> Stand: **v0.11.0** (14.6.2026). Lokale Trainings-App (Langstreckenlauf) im TrainingPeaks-Stil.

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
  `streamZoneSplit` (Sek.+Meter je Zone). PMC: `computePmc` (CTL 42d / ATL 7d, **TSB = gestrige CTL−ATL**),
  `ctlRamp`. Sonst `parseCorosLoad`, `DEFAULT_ZONE_PACE/SPEED`, `round1`. Typen `HrZone`/`PmcPoint`.
- `analysis.ts` — `weekTotals`, `plannedSessionTss` (Lauf → `rTssFromZones`, Rad → Power/IF, +`thresholdPace`-Param),
  `typeIntensityShares` (Donut **nach Einheitstyp**), `zoneKmOf`/`zoneKmIntensityOf`, `classifyTss`,
  `weekRatingLevel`, `weekLoadFlag` + `kmPolarizationFlag` (Wochen-Check), `intervalEffortStat`, `analyzeWeek`.
- `index.ts` — alle Routen. `pid()` (aktives Profil; **alle Queries profil-gefiltert**), `effectiveZoneSet`,
  `thresholds()`, `dailyTssMap`, `earliestDataDate` (PMC-Seeding), `avgPlannedWeeklyTss`/`avgWeeklyTss`,
  `computeSessionTss`, `activityTssToStore` (Lauf rTSS / Rad Power-TSS/Schätzung, respektiert `overrides:['tss']`).
  Wichtige Endpunkte: `/api/pmc` (geseedet, Ramp@heute), `/api/analyze/week/:no` (totals, flags, `tssIntensity`,
  `realTssIntensity`/`realTotalTss`, `zoneKmIntensity`, `realZone*`, `weekRating`, `projectedTsb`),
  `/api/recompute-tss` (Backup via `VACUUM INTO`, rechnet Lauf+Rad-TSS rückwirkend).
- `zones.ts` — `effectiveZoneSet(date)` / `effectiveZoneSetForSeed()` (profil-gefiltert; hr/pace/power-zones,
  lthr/ftp/threshold_pace).
- `strava.ts` — OAuth + `stravaSync`: Listen-Import per `strava_id` (nie überschreiben). Anreicherung budgetiert
  (`MAX_REQ ≈ 90`/Sync): Detail (COROS-TL→`training_load`, kcal, Beschreibung→leere Notiz; `desc_fetched=1`) +
  **Streams** für Lauf (velocity/grade/hr/distance → `ngp`, `zone_min`, `zone_km`) und Rad (watts/hr → `np`,
  `zone_min`) → `streams_fetched=1`, nur leere Zonenfelder. COROS setzt `tss` NICHT (nur informativ).
- `import-docx.ts` (Seed), `import-scans.ts` (historisch), `reset-db.ts` (leere Vorlage).

**client/src/**
- `lib/api.ts` — ALLE Typen + `api`-Objekt (eine Stelle für Endpunkte; `Activity` hat u.a. `ngp`/`np`/`elevation`).
- `lib/util.ts` — Formatter (`paceStr`, `fmtDur`, `fmtDate/Y`, `speedKmh`, `paceOrSpeed`, `isBikeSport`, `weekLabel`,
  `daysOfWeek`, `DAY_NAMES`, `num`, …) + Re-Exports der Options-Helfer.
- `lib/options.ts` — Options-Cache, `useOptions()`, `loadOptions()`, `phaseColor/Label`, `typeColor/Label`,
  `typeIntensity` (easy|moderate|hard je sessionType), `sportLabel`.
- `lib/hooks.ts` (`useSeason()`), `lib/markers.ts` (`raceMarkers*` NUR aus Races-Tabelle, `sick*`, `phaseRuns*`,
  `yearMarks*` per Band-Index).
- `pages/` — `Dashboard`, `WeekPlan`, `WeekTrack` (?date), `WeekReport` (2-seitiger Druck), `LongTerm`, `Races`,
  `SeasonPlan`, `Settings`, `OptionsConfig`.
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
  `zones`/`zone_min`/`zone_km` JSON, `efforts` JSON, `tss`, `training_load` (COROS, informativ), `strava_id`,
  `matched_session_id`, `overrides` JSON, `notes`, **`ngp`** (s/km, Lauf), **`np`** (W, Rad), `desc_fetched`,
  `streams_fetched`).
- `zone_sets` (profile_id, hr/pace/speed/power-zones JSON, lthr/ftp/threshold_pace, valid_from).
- `races` (profile_id, date, name, distance_m, time_s, placement, notes, `splits` JSON [{km,time_s,pace_s,avg_hr,
  max_hr,elevation_m}], `avg_hr`, `max_hr`, `elevation_m`, `source`=manual|season; Auto-Import aus Saisonplan
  `goal_race` via Ledger-Setting `season_races_imported_<pid>`).
- `options` (kind: phase|sport|sessionType; value/label/color/sort/active; `intensity`=easy|moderate|hard nur bei
  sessionType → steuert den TSS-Donut). `settings` (key→JSON).

## 4. Funktionsstand v0.11.0 (Ist-Stand, nicht Historie)

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
Saisonplan · Einstellungen · Auswahllisten. Leichte Profile (Wechsel in Sidebar; Löschen/Umbenennen mit Code **4397**).

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

- **v0.11.0-Runde abgeschlossen** (alle 11 ToDo-Punkte umgesetzt). Restlicher Backlog steht in `ToDo.md`
  unter „In Zukunft NICHT JETZT" (Readiness, Trainingsplanung mit Sets/Wiederholungen, Dashboard-Tagesvorschlag,
  Intervall-Auto-Extraktion, v2.0-Redesign). **Nach dem Update einmal „TSS neu berechnen" drücken** (Wander-TSS).
- **Strava-Streams nachziehen:** NGP/NP + min/Zone + km/Zone kommen je Einheit erst beim Sync (budgetiert) →
  Altbestand braucht mehrere Syncs; danach „TSS neu berechnen (Lauf + Rad)" drücken. Recompute ist **profil-gescoped**.
- **Zurückgestellt — Intervall-Auto-Extraktion:** Efforts (Zeit/Strecke/Pace/Ø+Max-HF je Wiederholung) für harte
  Einheiten automatisch aus Lap/Stream ziehen. Eigene Runde.
- **Kleinkram (ToDo.md „In Zukunft NICHT JETZT"):** Donut „%"-Zeichen entfernen; v2.0-Redesign (awwwards-Stil,
  GSAP/Three.js, eigener Branch/Folder) — erst auf ausdrücklichen Wunsch.
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
