# HANDOFF — RunLogApp

> Lies dieses Dokument zuerst, dann kannst du ohne weiteres Erkunden weiterarbeiten.
> Detaillierte Versionshistorie: `CHANGELOG.md`. Offene Wünsche: `ToDo.md`. Anleitung im Programm: `client/public/usage.html`.
> Stand: **v2.3.0** (02.07.2026). Lokale Trainings-App (Langstreckenlauf) im TrainingPeaks-Stil.

### Neu in v2.3.0 (Kurz)
- **Langzeit-Charts vereinheitlicht** (`client/src/pages/LongTerm.tsx`): dezente Rohpunkte + klare Trendlinie +
  Monatsmittel-Marker + Streuband über Pace-vs-HF, Effizienz, Entkopplung, effective VO2max.
- **Zyklus optional per Profil** (`Profile.tsx` → `CycleActivationCard.tsx`, nutzt bestehende `cycleConsent`-API);
  steuert Methodik-Zyklus-Tab (`Methodik.tsx`) und das Symptom-Modul im Tracking.
- **Marathon-Pace & Repetitions**: Konkretisierung korrigiert in `planbuilder.concretizeSession` (M ≈ Z3-Dauerlauf,
  R ≈ schnelle Z6-Intervalle, Daniels); Labels/Farben in `lib/options.ts`.
- **Flexibler Qualitätstag** (`planbuilder.scheduleWeek`): bevorzugter Berg-Tag ist zugleich Qualitätstag (Berg
  oder Tempo, periodengerecht).
- **Kausal-Vorschläge**: `mlJobs.buildProposal` — Regex-Bug (Marathon fälschlich „hart") behoben, Value-of-Information
  korrekt der Nutzen-Dimension zugeordnet; `ProspectiveTrialCard` zeigt „warum dieser / warum nicht die anderen".
- **Zyklus-Backfill #14**: `cycleTraining.reconstructPhases()` + `backfillCyclePhases()` in `index.ts` (läuft nach
  Perioden-Add/-Delete + `POST /api/cycle-training/backfill-phases`), leakage-frei/additiv.
- **Robustheit (Audit-Fixes)**: Strava-Backup-Retention (`strava.pruneBackfillBackups`), Symptom-Wochen-Batch
  (`WeekTrack`), Tutorial-Marker statt Name (`tutorial.ts`). Audit-Report: `ToDo/Codex/CODEX_AUDIT_v2.3.0.md`.
- **Tests**: 14 Kern-Tests (`tests/runlog-core.test.ts`), `npm test` grün. **Doku/Version** überall auf v2.3.0.

### Nachtrag nach v2.2.1 (02.07.2026)
- **Adversarial Audit jetzt als Workflow:** `server/mlJobs.ts` liefert `adversarialAudit()`, `server/index.ts`
  exposed `POST /api/ml/audit`, `client/src/components/DoseResponseCard.tsx` zeigt den per Button erzeugten
  Report. Prüft Design-Zeitordnung/CV-Basis, Frische, Identifizierbarkeit, FDR/MCID, Vorzeichen-Stabilität
  und Gesundheits-Confounder.
- **Zyklus/Verhütung erklärt konkretes App-Verhalten:** `CycleScaffoldCard.tsx` zeigt pro Methode, ob RunLog
  natürlich, ovulationsunterdrückt oder unsicher modelliert und was das für Gate, Beobachtung und Vorschläge
  bedeutet.
- **km-je-Zone-Fix:** `planbuilder.concretizeSession()` erzeugt `planned_km` und `zone_alloc.byKm`; `analysis.enrichZoneAllocKm()`
  ergänzt alte byMin-Sessions beim Laden/Speichern; `sessionCompletion()` versteht `byMin` direkt.

### Neu in v2.2.1 (Kurz)
- **Stabilisierung Coach-Kern:** `activities.match_ignore` + Match-API `ignore`; bewusst nicht zugeordnete
  Aktivitäten zählen zur realen Last, aber nicht zur Plan-Erfüllung. `analysis.matchActivities` und
  `/api/plan-adherence` respektieren das.
- **VDOT/VO2max-Saison-Bug:** `/api/fitness-trend` nutzt für Future-Range-Punkte kein in die Zukunft
  verschobenes 90-Tage-Fenster mehr; `current` wird stabil zum heutigen Datum berechnet.
- **Testbasis:** `npm test` läuft über `node --import tsx --test tests/**/*.test.ts`; Kern-Tests decken
  Load/PMC, Analyse, Planbuilder, Pacing, Laktat und ML-Feature-Backbone ab.
- **Taxonomie:** `MarathonPace` und `Repetitions` sind kanonisch und im ML-Feature-Backbone gemappt.
- **Strava-Erstanreicherung:** neue Queue-Endpunkte `/api/strava/backfill/status|start|step|cancel`;
  Start legt ein SQLite-Backup an, Steps nutzen `enrichBudgeted` und respektieren Rate-Limits.
- **Langzeit:** Pace-vs-HF, Effizienz-Faktor, Entkopplung und effective VO2max zeigen Trendlinie,
  Monatsmittel und Streuband.
- **Methodik Research-Lab:** Tabs `Status`/`Was wirkt?`/`Experimente`/`Zyklus`; prospektive Trial-Proposals
  kommen als Ranking-Liste (`proposals`) mit Score-Komponenten. Einzel-`proposal` bleibt rückwärtskompatibel.
- **Tracking/Zyklus:** optionales Symptom-Modul in Tracking nur nach Consent; bleibt lokal/nicht-diagnostisch.
- **Doku/Version:** `package.json`, Footer-Stand, README, CHANGELOG und HANDOFF auf v2.2.1.

### Neu in v2.2.0 (Kurz)
- **ML-Trainingssteuerung:** Latente Fitness, Dosis-Wirkung, Readiness/Gesundheits-Gate, Feedback,
  prospektiv-randomisierte N-of-1-Trials und Zyklus-Scaffold (Consent-Hard-Gate), siehe CHANGELOG.

### Neu in v1.12.1 (Kurz)
- **Bugfix StructureEditor:** `CountField`/`Row` von innen nach außen auf Modul-Ebene gehoben → Fokus-Verlust
  nach jeder Ziffer behoben (React-Komponenten-Typ-Instabilität).
- **Bugfix Dark Mode:** Präferenz-Kacheln (Profil → Block-Präferenzen) nicht markierter Einheiten nutzen
  jetzt `var(--card)` statt `#fff` (AvailabilityCard.tsx:261).

### Neu in v1.12.0 (Kurz)
- **Verschachtelter Workout-Builder (Coros-artig):** `SegNode` (rekursiv, additiv auf `WorkoutTemplate.structure?`);
  `renderStructure()` in `server/workouts.ts` (neuer Zweig in `renderWorkout`); verschachtelte `Effort[]` mit
  von-bis-Bändern und Satz-Anzahl via T7-Mechanik (TSB + Fitness + Phase); `Effort.group?/children?` in
  planbuilder + api.ts. `StructureEditor.tsx` (neu): Coros-artiger Editor (Segmente/Gruppen, „±"-Spielraum,
  Pausen, ▲▼, beliebige Tiefe). `CustomWorkoutsCard.tsx`: Einfach/Strukturiert-Modus, Tabelle mit
  Struktur-Spalte (`effShort`) + aufklappbarer `EffortTree`-Detailzeile. `estimateCustom` ruft bei `structure`
  denselben Renderer (`DEFAULT_EST_ZONES`). `GET /api/workouts` rendert jedes Template mit echten Profil-Zonen.
- **Keine DB-Migration** — `custom_workouts.template` ist JSON; additives Feld.

### Neu in v1.11.1 (Kurz)
- **Bugfix IntervalTrend Legende:** `onClick` strip `_avg`-Suffix → Kategorien toggeln wieder korrekt.
- **Bugfix Kachel-Höhe:** `hpx` aus `layout[b.id]?.h` statt statischem Wert → Höhen-Resize funktioniert.
- **Dark Mode Tracking-Tabs + PowerCard-Zonen-Pills** per CSS-Token behoben.
- **Methodik CS-Klarheit:** Tooltip/Hilfetext differenziert Absolutwert / Δ / vorher→nachher.

### Neu in v1.11.0 (Kurz)
- **Laktat-Diagnostik:** Wissenschaftliche Begründungen je Schwelle; x-Achse min/km ↔ km/h ↔ Watt;
  Watt-Eingabe Rad-Tests. `LactateTests.tsx` + `server/lactate.ts`.
- **Sparklines:** `Sparkline.tsx` (SVG, trend-farbig) + `sparkPref.ts` (localStorage-Toggle im Footer);
  Methodik: 5 Trend-Sparklines; Dashboard: CTL/ATL/TSB per `pastPmc`.
- **Dynamische Einheiten (T7):** `repsBand(tpl, fitness, progress, tsb?)` → `{lo, hi, target}`;
  `fitnessLevel()` VDOT-verfeinert; `adaptNote` in `ConcreteSession`/`BlockDay`/`PlannedSession`.
  `EffortLines` in WeekPlan zeigt von-bis + „heute: N".
- **Methodik-Korrektheit (T6 contiguous blocks):** `methodInference` rechnet auf zusammenhängenden
  Regime-Blöcken; `nBlocks` in `RegimeStat`.
- **Periodisierungs-Ziel + Override (T14):** `phaseDistributionTarget(phase, overrides?)` mit Rationale;
  `phase_dist_overrides` in settings; Override-UI in WeekReport.
- **Dark Mode Vollständig:** CSS-Token-Sweep (Inputs/Modals/Tabellen/Popovers); `.table`-Klasse;
  `@media print`-Reset; glass-vars.
- **GSAP Intro-Animation:** Läufer folgt Form-Kurve via `getPointAtLength`-Proxy-Tween → App-Icon.
- **Count-up in WeekTrack:** `useCountUp`-Hooks für KPI-Kacheln.

### Neu in v1.10.0 (Kurz)
- **Design-Tokens + gruppierte Navigation** (Heute/Planen/Tracken/Analysieren/Lernen).
- **Dark Mode** (Auto/Hell/Dunkel), CSS-Variablen in Charts; `data-theme` auf `<html>`.
- **Motion-System:** `lib/motion.ts` (`useMotion`, `useReveal`, `useCountUp`); `prefers-reduced-motion`-Gating.
- **Signature-Hero „Form-Ribbon"** oben am Dashboard: CTL/ATL/TSB-Band ~6 Wochen + Draw-on.
- **Chart-Veredelung:** PMC-Gradient, PB-Marker, niceYDomain-Helfer, Jahres-Dreieck kleiner, PMC-Legende.
- **Celebrations:** `Celebration.tsx` (Konfetti); `PbWatcher.tsx` (Streak-/PB-Gate).
- `lib/theme.ts`, `lib/motion.ts`, `charts/FormRibbon.tsx`, `components/Celebration.tsx`,
  `components/PbWatcher.tsx` (alle neu).

### Neu in v1.8.0 (Kurz)
- **UX-Rationalisierung:** klare Seiten-Rollen + Captions; **Zeit-in-Zone** ist Leit-Intensität (ATL/CTL →
  „Last-Trend" umbenannt); Konfidenz-Pattern (`components/ConfidenceBadge.tsx` + `ExpertDetails.tsx`) versteckt
  unsichere Werte hinter „Experten-Details". **Bestzeiten modular** (`EditableGrid` page="bests"), **Profil**
  über `opt-nav` aufgeräumt.
- **Coach-Variation:** mehrsegmentiges Workout-Modell (`WorkoutSegment`/`segments`/`setsByFitness` in
  `workouts.ts`, Render-Zweig TSS-neutral) + 8 neue Templates (Fartlek, Ladder, Cut-down, Mixed, gebrochener
  Tempolauf, lange Bergintervalle, Renntempo-Float). **Coach-Matrix** Distanz×Niveau in `pickWeekWorkouts`.
  **Block-Präferenzen** (`Availability.emphasis/favoriteWorkouts/avoidWorkouts`) gewichten advisory +
  phasengerecht; `GET /api/workouts`.
- **Tutorial-Profil:** `server/tutorial.ts` (`ensureTutorialProfile`/`regenerate`/`delete`) erzeugt beim ersten
  Start ein eigenes Profil „Tutorial" mit vollem Beispieljahr (eigenes `profile_id`, idempotent, löschbar).
  Hook in `index.ts`-Startup; `GET/POST/DELETE /api/tutorial[...]`. **Seiten-Hilfe** (`components/PageHelp.tsx`)
  + **Methodik-Intro/Tour** (`components/OnboardingTour.tsx`).
- **Watt-Analytik:** `runningEffectiveness` (Speed/Watt, Ökonomie-Trend) + `wPrimeBalance` (Skiba W′-bal) in
  `load.ts`; `GET /api/run-effectiveness`, `GET /api/wprime/latest` (rekonstruiert die Watt-Kurve aus `efforts`+CP).
  Anzeige in `charts/PowerCard.tsx`.
- **DB:** keine Schema-Änderung (Block-Präferenzen im Availability-JSON; Tutorial auf eigenem `profile_id`).

### Neu in v1.7.0 (Kurz)
- **Adaptive Paces + Zielzeit:** Wunsch-Zielzeit am Ziel-Rennen (`races.goal_time_s`) → Fitness-Projektion
  (`projectVdot`, gedeckelt) → Block-Paces ankern je Woche an der projizierten Fitness (`zonesForWeek` +
  `danielsPaces`) und wachsen Richtung Zielpace. **Gelockte Einheiten** speichern ihre Intention
  (`planned_sessions.prescription`) und werden beim Laden **live neu gerendert** (`resolvePlannedSession`,
  Hook in `GET /api/sessions`). Gap-Karte `GET /api/plan/goal-gap` + `GoalGapCard` in WeekPlan.
- **Scheduling:** `scheduleWeek` legt **nie zwei harte Tage hintereinander** (sonst Easy-Downgrade + Reason),
  bevorzugt den **Berglauf-Tag** und hängt **Stabi/Core** an Easy-Tage. Doppel-Schwelle = **zwei** Einheiten am
  selben Tag (`pair`-Marker). Profil-Felder: `hillDay`, `corePerWeek`, `coreDays`.
- **Lauf-Power (Coros/Stryd-Stil):** Enrich zieht `watts` → `run_np` + `power_curve`; `fitCriticalPower`,
  `powerZonesFromCp`, `runningStressScore` (load.ts); `GET /api/power-curve` + `/api/cp-trend`; `PowerCard`
  in Bestzeiten; optionaler Watt-Anker in `renderWorkout` (`zones.cp`).
- **Entkopplung = GAP** (steigungs-adjustiert) und nur für gleichmäßige Läufe. **Einheiten füllen jetzt die
  Felder** (`renderWorkout` gibt `zone_alloc.byKm`, TSS-neutral). Phasen aus dem Block-Vorschlag setzbar
  (`PUT /api/season/week/:no/phase` + „Phasen übernehmen").
- **DB additiv:** `races.goal_time_s`, `planned_sessions.prescription`, `activities.run_np`, `activities.power_curve`.

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
  `ctlRamp`. **v0.15:** `vdot(distanceM, timeS)` (Daniels-Gilbert, nur Efforts ≥ 1500 m / ≥ 180 s),
  `fitCriticalSpeed(pts)` (aus `/api/bests` extrahiert), `predictFromCs(cs, dPrime, distances)`.
  Sonst `DEFAULT_ZONE_PACE/SPEED`, `round1`. Typen `HrZone`/`PmcPoint`/`CsFit`. (`parseCorosLoad` entfernt.)
  **v1.5.0:** `effectiveVo2max({ngpSec,avgPaceSec,avgHr,decoupling,hrRest,hrMax})` → Pro-Lauf-VO2max
  (Daniels-Kosten + %VO2R≈%HRR), aggregat-basiert/backfillbar; Typ `EffVo2max`.
  **v1.7.0:** `aerobicDecoupling(vel,hr,time,grade?)` jetzt **GAP** (steigungs-adjustiert). `danielsPaces(vdot)`
  → E/M/T/I/R-Paces (s/km, validiert). Lauf-Power: `powerDurationCurve(watts,time)`, `fitCriticalPower(pts)`
  (2-Param Work=CP·t+W′, Spiegel von `fitCriticalSpeed`), `powerZonesFromCp(cp)` (%CP, Stryd-nah),
  `runningStressScore(np,cp,sec)` (RSS). `POWER_CURVE_DURATIONS`.
  **v1.8.0:** `runningEffectiveness(distM,movS,powerW,massKg)` (Speed/Watt, Ökonomie), `wPrimeBalance(power[],time[],cp,wPrime)`
  (Skiba W′-bal: Entleerung über CP, exp. Erholung darunter → Verlauf + min-Stand + Defizit-Zeit).
- `analysis.ts` — `weekTotals`, `plannedSessionTss`, `typeIntensityShares` (Donut **nach Einheitstyp**),
  `zoneKmOf`/`zoneKmIntensityOf`, `classifyTss`, `weekRatingLevel`, `weekLoadFlag` + `kmPolarizationFlag`,
  **`sessionCompletion`** (Plan-% = TSS-Treffer + Pace-Zonen-Overlap), `intervalEffortStat`, `analyzeWeek`
  (Taper-Flag jetzt renntag-basiert: `raceDate/raceTsb/racePre7Tss/raceAvgWeeklyTss`).
  **v0.15:** `tssRecommendation(ctl, phase)` → `{min,max,target,kind}` nach 3:1-Belastungsprinzip (Aufbau
  +5–7 CTL/Woche; Entlastung 55–65 %; Race-Week ~50 %; Krank 0–40 %); `analyzeWeek` liefert `tssRec`.
  **v1.5.0:** `adjustTodaySession(planned, ctx)` → `SessionAdjustment` (adaptiver Coach: TSB/Ramp/Readiness/Risiko
  → heutige Einheit re-konkretisieren; advisory|gate); in `/api/today` als `adjustment`.
  **v1.7.0:** `projectVdot(curVdot, goalVdot, weeks, cap≈0.4)` → wöchentliche Fitness-Projektion (+`infeasible`);
  `zonesForWeek(base, projVdot, goalDistanceM)` → projizierte Pace-Anker je Block-Woche; `resolvePlannedSession(presc,
  date, ctx)` → Live-Render gelockter Einheiten aus aktueller+projizierter Fitness. `blockPlan` nimmt `curVdot`/
  `goalTimeS` und rendert jede Woche mit `weekZones`; `BlockDay.prescription` trägt die Intention; `scheduleWeek`
  spacing/`pair`/`downgrade` (s. planbuilder).
- `index.ts` — alle Routen. `pid()`, `effectiveZoneSet`, `thresholds()` (+ `raceweek_tss_max_pct`), `dailyTssMap`,
  `earliestDataDate`, `avgPlannedWeeklyTss`/`avgWeeklyTss`, `addDaysIso`, **`ensureSeasonWeeks`** (2 Zukunftswochen
  + bis Renntag), **`syncRaceFromActivity`** (Race aus Tracking), `activityTssToStore`. Endpunkte u.a.:
  `/api/analyze/week/:no` (+ `adherence{perSession,weekPct}`, **`tssRec`**), **`/api/bests`** (PB + CS; nutzt
  jetzt `fitCriticalSpeed`/`predictFromCs` aus load.ts), **`/api/plan-adherence`** (Wochenmittel),
  **`/api/strava/import-zones`**, `/api/recompute-tss`. `GET /api/season` ruft `ensureSeasonWeeks`.
  **v0.15 neu:** `GET /api/fitness-trend?from&to` (VDOT + CS-Prognosen je Wochenpunkt, Alters-Norm aus
  `server/norms.ts`); `POST /api/activities/:id/relink-efforts` (setzt `efforts_locked=0, laps_fetched=0,
  efforts=NULL` → nächster Sync zieht Laps neu); `PUT /api/activities/:id` setzt jetzt `efforts_locked=1`.
  **v1.7.0:** `GET /api/plan/goal-gap` (Soll/Ist), `GET /api/power-curve` + `GET /api/cp-trend` (+ Helfer
  `currentCp`/`aggregatePowerCurve`/`cpFromAgg`), `PUT /api/season/week/:no/phase` (Teil-Update); `GET /api/sessions`
  rendert zukünftige Einheiten mit `prescription` live (`buildResolveCtx`); Block-/Resolver-Zonen tragen `cp`.
  **v1.8.0:** `GET /api/workouts` (Bibliothek für Block-Präferenzen), `GET/POST/DELETE /api/tutorial[/regenerate]`
  (Startup-Hook `ensureTutorialProfile`), `GET /api/run-effectiveness`, `GET /api/wprime/latest` (W′-bal aus
  `efforts`+CP rekonstruiert); `currentCpFit` (cp+W′). Neues Modul **`server/tutorial.ts`** (Beispieljahr-Generator,
  eigenes `profile_id`). Block-/Wochen-Route reicht `prefs` (emphasis/favorite/avoid) an `pickWeekWorkouts`.
- `zones.ts` — `effectiveZoneSet(date)` / `effectiveZoneSetForSeed()` (profil-gefiltert; hr/pace/power-zones,
  lthr/ftp/threshold_pace, **`lt1_hr`/`lt1_pace`** — LT1-Anker; Default aus Z2/Z3-Grenze, von G3 überschreibbar).
- `planbuilder.ts` (**neu v1.4.0**) — pure Modul (keine DB): `concretizeSession(type, targetTss, zones, opts)` →
  `ConcreteSession` (planned_min, zone_alloc.byMin, efforts, description, paceTarget). Invertiert exakt
  `rTssFromZones`. `scheduleWeek(units, availability, weekDates)` → `ScheduledUnit[]` (Tagesplaner).
  **v1.7.0:** `scheduleWeek` strikt **kein harter Folgetag** (sonst `downgrade`→Easy), Hügel auf `availability.hillDay`,
  Core an Easy-Tage/`coreDays`, Doppel-Schwelle via `pair` (AM+PM selber Tag, zählt als ein harter Tag).
  `ConcreteSession.zone_alloc` jetzt `{byKm?|byMin?}`. (Workout-Bibliothek + Renderer: `server/workouts.ts`,
  `renderWorkout` gibt `byKm`, optionaler Watt-Anker via `zones.cp`.)
- `pacing.ts` (**neu v1.4.0**) — pure Modul: `pacingPlan({distanceM, targetTimeS, profile?, negativeSplit?})`
  → km-Splits mit GAP (Minetti-Gradient). Σ(pace_i·dist_i) == targetTimeS exakt.
- `lactate.ts` (**neu v1.3.0**) — pure Modul (keine DB): `lactateThresholds(points)` → LT1 (Baseline+0.4 mmol/L
  interpoliert) + LT2 (modifizierter Dmax/AIS: Polynom-Fit Grad min(3,n-1), Gauß-Elim., max. senkrechte Distanz
  vom Sehnen-Startpunkt). `proposedHrBounds(lt1Hr, lt2Hr, maxHr?)` und `proposedPaceBounds(lt1Pace, lt2Pace)` → 6
  Zonen-Grenzen-Arrays für Zonen-Set-Vorschlag.
- `strava.ts` — OAuth (Scope `activity:read_all,profile:read_all`) + `stravaSync`: Listen-Import per `strava_id`
  (nie überschreiben). `api()` führt Rate-Limit-Header mit → `rateLimitMessage()` (15-min vs. **Tageslimit**) +
  `dayBudgetExhausted()`-Bremse. Anreicherung budgetiert: Detail (kcal, Beschreibung→leere Notiz; bei Läufen
  `best_efforts`→`parseBestEfforts`) + **Streams** (Lauf: `ngp`, `zone_min/km`, **`pace_zone_min`**, bei `type=Race`
  km-Splits ans verknüpfte Race; Rad: `np`). **`fetchAthleteZonesAndFtp`** für den Zonen-Import. Kein COROS mehr.
  **v0.15:** `extractWorkLaps` nutzt bei Bike-Aktivitäten `hr_zones_bike` (falls vorhanden); Auto-Labels
  (Z5+ → VO2long/VO2max, Z4 → LT2, sonst → LT1); `enrichBudgeted`-Kandidaten-Query schließt
  `efforts_locked=1` aus (Spalte `activities.efforts_locked`).
  **v1.7.0:** Lauf-Streams ziehen jetzt `watts` mit → `run_np` (NP) + `power_curve` (Power-Duration);
  `'{}'`-Sentinel verhindert Re-Fetch bei Läufen ohne Watt. Decoupling-Backfill = GAP + nur gleichmäßige Läufe.
- `norms.ts` (**neu**) — `vo2maxLevel(value, age, sex)`: ACSM/Cooper-Perzentile je Altersband+Geschlecht →
  „Elite" | „Exzellent" | „Sehr gut" | „Durchschnitt" | „Unter Durchschnitt".
- `import-scans.ts` (historisch), `reset-db.ts` (leere Vorlage). (`import-docx.ts`/Seed in v0.12.0 entfernt.)

**client/src/**
- `lib/api.ts` — ALLE Typen + `api`-Objekt. Seit v1.11.0: `Effort` += `reps_lo/hi`, `pace_lo/hi`, `group?`,
  `children?`; `PlannedSession` += `adaptNote?`; `BlockDay` += `adaptNote?`; `RegimeStat` += `nBlocks?`;
  `WorkoutInfo` += `description?`, `efforts?`, `planned_min?`, `planned_tss?`, `adaptNote?`;
  `SegNode` (rekursiv, v1.12.0); `CustomInput` += `structure?: SegNode[]`.
- `lib/util.ts` — Formatter + Re-Exports der Options-Helfer.
- `lib/options.ts` — Options-Cache, `useOptions()`, Farb-/Label-Helfer.
- `lib/motion.ts` (**neu v1.10.0**) — `useMotion()`, `motionEnabled()`, `useReveal()`, `useCountUp()`;
  alle Animationen gated (`prefers-reduced-motion` + globaler Schalter).
- `lib/theme.ts` (**neu v1.10.0**) — `useTheme()`, `setTheme()`; `data-theme` auf `<html>`.
- `lib/sparkPref.ts` (**neu v1.11.0**) — `getSparkPref()/setSparkPref()/useSparkPref()`; localStorage-Toggle.
- `lib/hooks.ts` (`useSeason()`), `lib/markers.ts` (`raceMarkers*`, `sick*`, `phaseRuns*`, `yearMarks*`).
- `pages/` — `Dashboard` (Form-Ribbon + StatCard-Sparklines v1.11.0, Count-up v1.11.0),
  `WeekPlan` (EffortLines + adaptNote + Phase-Override v1.11.0; Ziel-km; Phase-Pill; Drag&Copy; TSS-Badge),
  `WeekTrack` (Count-up v1.11.0; Tag/Woche-Switcher; Plan-%; Schlaf hh:mm; Relink-Button),
  `WeekReport` (phaseDistributionTarget-Override v1.11.0; 2-seitiger Druck; EF; Inline-Plan-Kacheln),
  `LongTerm`, `Races`, `Bests` (Critical Speed + Race-Prediction), `Methodik` (Marker-Sparklines v1.11.0;
  Block-Terme; CS-Tooltips v1.11.1), `SeasonPlan`, `Profile`, `Settings`, `OptionsConfig`.
- `charts/` — `Pmc`, `SeasonProgress`, `ChartDecor` (Jahres-Dreiecke kleiner v1.10.0), `IntensityDonut`,
  `ZoneDistribution`, `WeekdayBars`, `IntervalTrend` (Rolling-Mittel v1.11.0; Legende-Fix v1.11.1),
  `WellnessTrends`, `RangeSelector`, `Vo2maxCard`, `IntensityRatio` (Dark Mode v1.11.0),
  `SleepWindow`, `ThresholdTrendChart` (Legende v1.10.0; niceYDomain), `MarkerDelta`,
  `FormRibbon.tsx` (**neu v1.10.0**) — Signature-Hero CTL/ATL/TSB-Band mit Draw-on.
- `components/` — `WeekSelector`, `SessionModal`, `EffortBuilder`, `AthleteCard`, `ZoneSets`,
  `LactateTests` (Watt-Eingabe + x-Achse-Toggle v1.11.0), `AvailabilityCard` (Dark-Mode-Fix v1.12.1),
  `CustomWorkoutsCard` (**v1.12.0**: Einfach/Strukturiert, `EffortTree`, Struktur-Spalte),
  `StructureEditor.tsx` (**neu v1.12.0**) — Coros-artiger rekursiver Editor (Modul-Ebene = kein Fokus-Bug),
  `Sparkline.tsx` (**neu v1.11.0**) — SVG-Sparkline mit trend-farbiger Linie,
  `Celebration.tsx` (**neu v1.10.0**) — Konfetti-Overlay für Bestzeiten/Streaks,
  `PbWatcher.tsx` (**neu v1.10.0**) — Gate für Celebration-Trigger,
  `PageHelp.tsx` (Seiten-Hilfe), `OnboardingTour.tsx`, `EditableGrid.tsx` (Höhen-Resize-Fix v1.11.1).
  `App.tsx`, `styles.css` (massive Dark-Mode-Sweep v1.11.0), `pages/track.css` (Dark-Mode-Fix v1.11.1).

## 3. Datenmodell (SQLite, alles profil-bezogen)

- `profiles(id,name)` — aktives Profil in `settings.active_profile` (Default 1 = „Kolja").
- **v2-Tabellen sind LIVE** (Originale als Backup): `season_weeks_v2` (PK profile_id,week_no), `week_log_v2`,
  `daily_log_v2` (PK date,profile_id).
- `planned_sessions` (profile_id, `zone_alloc` JSON {byKm/byMin}, `efforts` JSON, `structured`, `planned_tss`).
- `activities` (profile_id, `distance_m`, `moving_s`, `avg_hr`/`max_hr`, `avg_power`, `elevation`, `kcal`,
  `zones`/`zone_min`/`zone_km` JSON, **`pace_zone_min`** JSON (Pace-Zonen-Min, für Plan-%), `efforts` JSON, `tss`,
  `training_load` (Legacy, ungenutzt → null), **`best_efforts`** JSON {distance_m:time_s} (Bestzeiten), `strava_id`,
  `matched_session_id`, `overrides` JSON, `notes`, **`ngp`** (s/km, Lauf), **`np`** (W, Rad), `desc_fetched`,
  `streams_fetched`, **`efforts_locked`** INTEGER DEFAULT 0 — v0.15: Strava-Overwrite-Schutz;
  **`eff_vo2max`** REAL — v1.5.0: Effective VO2max je Lauf, via Recompute backfillbar).
- `zone_sets` (profile_id, hr/pace/speed/power-zones JSON, lthr/ftp/threshold_pace, valid_from; `source` u.a.
  „Strava"; **`hr_zones_bike`** TEXT — v0.15; **`lt1_hr`/`lt1_pace`** REAL — v1.3.0: LT1-Anker addiert).
- `lactate_tests` (**neu v1.3.0** — additiv): id, profile_id, date, sport, kind, notes, lt1_hr, lt1_pace, lt2_hr,
  lt2_pace, confidence, warnings, created_at. Index auf (profile_id, date).
- `lactate_points` (**neu v1.3.0** — additiv): id, test_id, stage, speed_kmh, pace_s, power_w, hr, lactate, rpe.
  FK test_id → lactate_tests.
- `vo2max_lab` (**neu v1.5.0** — additiv): id, profile_id, date, value, source, notes, created_at. Labor-VO2max-
  Werte über Zeit → eichen die Effective-VO2max-Schätzung. Index auf (profile_id, date).
- `method_experiments` (**neu v1.6.0** — additiv): id, profile_id, start_date, end_date, method
  (polarized|pyramidal|threshold|norwegian_double_threshold|custom), label, notes, created_at. Geführte
  N-of-1-Methoden-Blöcke; Marker-Snapshots werden on-the-fly berechnet (kein Speicherzwang). Index (profile_id, start_date).
- **`efforts`-JSON v1.6.0:** je Intervall optional `rest_s` (Pause s), `rest_type` (jog|stand), `hr_recovery`
  (bpm) — additiv im bestehenden TEXT-Feld, kein Schema-Change.
- `races` (profile_id, date, name, distance_m, time_s, placement, notes, `splits` JSON [{km,time_s,pace_s,avg_hr,
  max_hr,elevation_m}], `avg_hr`, `max_hr`, `elevation_m`, `source`=manual|season|**tracking**, **`activity_id`**
  (verknüpfte getrackte Einheit); Auto-Import aus Saisonplan `goal_race` (Ledger `season_races_imported_<pid>`)
  **und aus Tracking** (`type='Race'` → `syncRaceFromActivity`)).
- `options` (kind: phase|sport|sessionType; value/label/color/sort/active; `intensity`=easy|moderate|hard nur bei
  sessionType → steuert den TSS-Donut). `settings` (key→JSON).

## 4. Funktionsstand v1.12.1 (Ist-Stand, nicht Historie)

**Neu in v1.12.1 (Bugfixes):**
- `StructureEditor.tsx`: `CountField`+`Row` auf Modul-Ebene → Fokus-Verlust behoben (React-Typ-Instabilität).
- `AvailabilityCard.tsx:261`: neutrale Kacheln `#fff` → `var(--card)` (Dark Mode Fix).

**Neu in v1.12.0 (Strukturierter Workout-Builder):**
- `server/workouts.ts`: `SegNode`-Interface (rekursiv) + `WorkoutTemplate.structure?: SegNode[]` (additiv).
  `renderStructure(tpl, ctx)`: rekursiver Renderer (Gruppen nutzen `repsBand`-Logik für Satz-Anzahl; Reps
  bekommen Pace-Band vom Anker ± paceWindow + paceOffset); gibt verschachtelte `Effort[]` mit
  `group/children/reps_lo/hi/pace_lo/hi` aus. `describeStructure()` → Kurztext. `DEFAULT_EST_ZONES` (für
  `estimateCustom` ohne DB). `estimateCustom`: bei `inp.structure` → Template bauen + `renderWorkout`.
  `fitnessLevel()` nimmt jetzt optional `vdot` (verfeinert Level ±1 Schritt).
- `server/planbuilder.ts`: `Effort` += `group?: boolean; children?: Effort[]`.
- `server/index.ts`: `GET /api/workouts` rendert jedes Template mit echten Profil-Zonen → liefert
  `efforts/description/planned_min/planned_tss/adaptNote`.
- `client/src/lib/api.ts`: `SegNode` (gespiegelt), `WorkoutInfo`-Anreicherung, `CustomInput.structure?`.
- `client/src/components/StructureEditor.tsx` (neu): Coros-artiger rekursiver Editor (Segmente/Gruppen,
  „±"-Spielraum auf Anzahl, Pausen, ▲▼, beliebige Tiefe). Fokus-sicher durch Modul-Ebene.
- `client/src/components/CustomWorkoutsCard.tsx`: Modus „Einfach | Strukturiert"; Struktur-Spalte mit
  `effShort()` + aufklappbarer Detailzeile (`EffortTree` rekursiv + adaptNote-Hinweis).
- `package.json` → 1.12.0 (→ 1.12.1 mit Bugfixes).

**Neu in v1.11.x (dynamische Einheiten + Diagnostik + Premium-Feinschliff):**
- `server/workouts.ts`: `repsBand(tpl, fitness, progress, tsb?)` → `{lo, hi, target}` (T7-Mechanik, TSB-Shift
  ±0.3 Band-Fraktion); `buildAdaptNote(ctx)` → „angepasst: Build · TSB -4 · Fit mid · VDOT 59".
- `server/analysis.ts`: `methodInference` auf zusammenhängende `Block[]` (korrekte Wochenzahl + Δ-CS);
  `RegimeStat.nBlocks`; `phaseDistributionTarget(phase, overrides?)` mit `DIST_MODELS`/`MODEL_RATIONALE`;
  `BlockDay.adaptNote?`; `ResolveCtx.curTsb?`.
- `server/index.ts`: `buildResolveCtx` reicht `curTsb`; `phase_dist_overrides` aus settings.
- Frontend: `Sparkline.tsx` (neu), `sparkPref.ts` (neu), Methodik-Sparklines, Dashboard-StatCard-Sparklines,
  `EffortLines` in WeekPlan, Phase-Override in WeekReport, Dark-Mode-Sweep, `FormRibbon.tsx` (v1.10.0),
  `Celebration.tsx`/`PbWatcher.tsx` (v1.10.0), Count-up, Intro-Animation.
- v1.11.1 Bugfixes: IntervalTrend-Legende (strip `_avg`), Kachel-Höhe (generisch aus Layout), Dark-Mode
  Tracking-Tabs + PowerCard-Pills, CS-Klarheit-Tooltips.

**Neu in v1.6.2 (historisch, nicht Ist-Stand — zur Orientierung):**

**Neu in v1.6.2 (Kurz, historisch):**
- **N-of-1-Inferenz-Performance (`server/index.ts`):** `buildMethodInference` ist jetzt ein gecachter Accessor
  (`computeMethodInference` = ein `loadProfileRuns()`-Load + In-Memory-Fenster + leichte `rollingCsVdot` statt
  60 voller `buildMarkerSnapshot`). Cache pro Profil, globale `inferenceVersion`, invalidiert über Middleware bei
  **jedem Nicht-GET** (`invalidateInference`). Ergebnisse identisch. `buildMarkerSnapshot` nur noch on-demand
  (`/api/markers`, `/:id/evaluation`). Block-Route holt CS/VDOT via `rollingCsVdot(runs, today, 90)`.
- **Renntempo nach Zieldistanz (`workouts.ts`):** neuer Anker **`"race"`** → `zones.goal_pace`; `race_pace` nutzt ihn;
  neue Vorlagen `race_pace_long` (HM/Marathon) + `long_mp_segments` (Marathon-Longrun). `pickWeekWorkouts(…,
  goalDistanceM)` wählt Race-Specific distanzgerecht (short ≤15k VO2-lastig / mid HM / long ≥30k MP-Schwelle).
  `ZonesInput` um `goal_distance_m`/`goal_pace`; Block-Route leitet sie aus `races.distance_m` + `predictFromVdot` ab;
  `blockPlan` reicht `goalDistanceM` durch.

**Neu in v1.6.1 (Kurz):**
- **Trainings-Einheiten-Bibliothek (`server/workouts.ts`, neu, pure):** ~23 `WorkoutTemplate` mit Metadaten
  (Familie, Phase, Anstrengung, Nutzen, Synergie, Quelle). `fitnessLevel(ctl,csPace)`→low/mid/high skaliert die
  Reps (20×400 nur high). `pickWeekWorkouts(phase,weekInPhase,fitness,allowDoubles)` komponiert+rotiert die Woche
  (Doppel-Schwellen-Tag bei Doubles). `renderWorkout(tpl,{zones,fitness,progress,targetTss})` → konkrete Einheit
  mit **Pace-Bereich** (Anker LT1/LT2/CS ± Fenster) + **HF-Spanne** (aus `hr_zones`) + **Pausen** je Effort;
  Berg = Aufwand+HF. **`blockPlan`** nutzt jetzt diesen Pfad (Easy/Long gleichen die Wochen-TSS-Differenz aus,
  Hybrid); `phaseProgress()` liefert Rotation/Progression. `ZonesInput` um `hr_zones`/`cs_pace`/`rep_pace`
  erweitert; block-suggestion reicht aktuelle CS-Pace + hr_zones. `concretizeSession` bleibt Fallback (Coach/Einzel).
- **Effective-VO2max-Gate (`effVo2maxForRow`):** nur Läufe >30 min + gleichmäßige Typen (Dauer/kont. Tempo/Schwelle;
  Intervalle/VO2/Berg/Race raus). Recompute-Query selektiert jetzt `type`/`efforts`. Nach Update „TSS neu berechnen".
- **HTML-Cleanup:** veraltete `client/public/{changelog,readme}.html` + ihre `usage.html`-Nav-Links entfernt.

**Neu in v1.6.0 (Kurz):**
- **Methoden-Findung (N-of-1), Seite „Methodik":** `markerSnapshot`/`compareMarkers`/`methodInference`/
  `classifyWeekRegime` (alle `analysis.ts`, pure) + Helfer `efficiencyFactor` (`load.ts`). Marker-Batterie
  (CS primär, VDOT, Threshold-Pace/HF, Decoupling, Submax-EF, Effective VO2max, Laktat-an-Pace, PI/Verteilung)
  über ein Fenster (Default 14 Tage); Vorher/Nachher-Verdikt gegen MCID-Rauschen + Konfidenz; passive Inferenz
  (Wochen-Regime → vorwärtsgerichtete CS/VDOT-Reaktion, strenge Confounder-Kontrolle: Krank/Taper/Race raus,
  stabile CTL). Engine-Nudge (advisory `methodPreference` in `weekStructureRecommendation`/`blockPlan`).
  Neue Tabelle `method_experiments`. Endpoints `/api/method-experiments` (CRUD), `…/:id/evaluation`,
  `/api/markers`, `/api/method-inference`. Seite `pages/Methodik.tsx` + `charts/MarkerDelta.tsx`.
- **Periodisierung Block-Vorschlag:** `derivePhaseSequence()` leitet Phasen rückwärts vom Renntag ab
  (Base→Belastung→Race-Specific→Race Week) + 3:1-Entlastung; **manuelle `season_weeks_v2.phase` gewinnt immer**.
  Evidenzbasierte LT1/LT2/VO2/Sub-Threshold-Einheiten je Phase (Norwegian/Casado) + Wochen-Variation.
- **Intervall-Pausen:** `Effort` um `rest_s`/`rest_type`/`hr_recovery` erweitert (JSON, additiv). UI im
  `EffortBuilder` (Spalten Pause/Art); Strava `extractWorkLaps` füllt Pause + HF-Erholung aus der Recovery-Runde.
- **Fixes:** Wochencheck-Ampeln (`--warn` gelb, `--info` neutral-grau, ok grün, danger rot) + Badge-Angleich;
  Zonen-Plausibilität in `ZoneSets` (HF/Power steigen, Pace wird je Zone schneller).

**Neu in v1.5.0 (Kurz):**
- **Effective VO2max je Lauf (V):** `effectiveVo2max()` in `load.ts` — submax HF↔Pace (Daniels-Laufkosten +
  %VO2R≈%HRR), NGP-basiert, Gate auf stetig-aerobe Läufe. Aggregat-basiert (aus `ngp`/`avg_hr`/`decoupling`)
  → über die volle Historie backfillbar (Recompute). Neue Spalte `activities.eff_vo2max`.
- **Labor-Kalibrierung:** Tabelle `vo2max_lab` (mehrere Werte über Zeit) + `hr_rest` im `athlete`-Setting.
  CRUD `/api/vo2max-lab`; `/api/effective-vo2max-trend` (roh + linear interpolierte Eichung zwischen Tests).
  UI: Karte in Langzeit (Trend + Labor-Punkte + geeichte Linie), `Vo2maxLabCard` + Ruhe-HF im Profil.
- **Adaptiver Coach (S):** `adjustTodaySession()` in `analysis.ts` — Decision-Tree (TSB/Ramp/Readiness/Risiko)
  passt die heutige Haupt-Einheit an, re-konkretisiert über `concretizeSession` (Plan-TSS exakt). `/api/today`
  liefert `adjustment`; Dashboard-Coach-Karte mit „Anpassung übernehmen" (`POST /api/sessions/:id/apply-adjustment`).
  Gate-Modus konfigurierbar (Setting `readiness_gate_mode` advisory|gate, Toggle in Einstellungen).
- **Anreicherungs-Fortschritt (D1):** `GET /api/enrich-progress`; zwei Doughnuts „x/Σ" (Details, Streams) in der Strava-Karte.
- **Bugfix-Notiz:** Threshold-TSS-„Explosion" war eine Pace-Zonen-Fehleingabe (Z4 0:03 statt 3:24), kein Code-Bug
  (Zonen-Pace ~0 → `IF²` in `rTssFromZones` explodiert). **Offen v1.6:** Methoden-Findung (N-of-1).

## 4a. Funktionsstand v1.4.0 (historisch)

**Neu in v1.4.0 (Kurz):**
- **Verfügbarkeits-Profil (A1):** `AvailabilityCard` in Profile.tsx. 7×Minuten/Tag, Longrun-Tag, Qualitätstage,
  Doubles. Gespeichert als `availability_<pid>` in Settings. Endpoints `GET/PUT /api/availability`.
- **Session-Konkretisierer (A2):** `server/planbuilder.ts` `concretizeSession()` — invertiert `rTssFromZones`
  exakt → Plan-TSS trifft Ziel; gibt `zone_alloc.byMin + efforts + description + paceTarget` zurück.
- **Tages-Scheduler (A3):** `scheduleWeek()` in `planbuilder.ts` — Longrun/48h-Hart/Doubles/Budget; Fallback Round-Robin.
- **Mesozyklus-Planer (A4):** `blockPlan()` in `analysis.ts` — 3:1 + Deload + Taper bis Renntag, PMC-Vorwärtsprojektion.
  Endpoint `GET /api/plan/block-suggestion`.
- **Konkrete Engine-Karte & Block-Vorschau (A5):** WeekPlan zeigt Einheiten mit Wochentag/Dauer/Pace/Intervall.
  Block-Vorschau (ausklappbar, alle Wochen bis Renntag) mit „Woche übernehmen". `applySuggestion` schreibt jetzt
  `zone_alloc/efforts/planned_min` statt nur type+tss.
- **Race-Pacing B1/B2:** `server/pacing.ts` `pacingPlan()` mit GAP/Minetti; Endpoint `GET /api/races/:id/pacing`.
  In Races.tsx: `PacingPanel` mit Zielzeit-Eingabe, Negativ-Split, Split-Tabelle, Mini-BarChart.
- **Durability/Decoupling-Trend (C1):** Zeitreihe aerobe Entkopplung (≥30-min-Läufe) in Langzeit.
  Endpoint `GET /api/decoupling-trend`. Referenzlinie 5 %.
- **Überlastungs-Frühwarnung (C2):** `injuryRiskFlag()` in `analysis.ts` — ACWR + Monotonie + Ramp + Readiness;
  in `/api/today`-Response.
- **Zonen-Histogramm (C3):** Aggregierte Zeit in HF/Pace-Zonen. Endpoint `GET /api/zone-histogram`.
  Neues Chart `charts/ZoneHistogram.tsx`. EgItem in Langzeit.
- **Fitness-Signale (C4):** ComposedChart CTL + VDOT in Langzeit (zwei Y-Achsen).

## 4b. Funktionsstand v1.3.0 (nicht Ist-Stand — historisch)

**Neu in v1.3.0 (Kurz):**
- **Echte Intensitätsverteilung (G4):** physiologisches 3-Zonen-Modell (Z1 < LT1 / Z2 = LT1–LT2 / Z3 > LT2) aus
  vorhandenem `realZoneMin`. Polarisierungs-Index (Treff et al. 2019): `PI = log10((Z1/Z2)×Z3)`, PI ≥ 2.0 = polarisiert.
  Phasen-Ziel-Band je Saisonphase (pyramidal/polarisiert/regenerativ). Neuer `realPolarizationFlag` in WeekReport.
  Neue additive Spalten `zone_sets.lt1_hr/lt1_pace` (LT1-Anker, Default Z2/Z3-Grenze).
- **Laktat-/Feldtest-Diagnostik (G3):** Stufentest-Eingabe in Profile.tsx (`LactateTests`-Komponente):
  Geschwindigkeit/Pace/HF/Laktat/RPE je Stufe, automatische LT1- + LT2-Berechnung (LT1 = Baseline+0.4 mmol/L;
  LT2 = modifizierter Dmax/AIS). Schwellen-Trend-Chart (ab 2 Tests). Button „Als Zonen-Set übernehmen" (Vorschlag-Modus).
  Neues Modul `server/lactate.ts` (pure). Endpunkte `/api/lactate-tests` (CRUD+Punkte) + `propose-zoneset`.
  Neue Tabellen `lactate_tests` / `lactate_points` (additiv).
- **Wochen-/Block-Empfehlung (Engine):** Engine-Karte in WeekPlan: regelbasierter Vorschlag aus CTL/TSB/Phase/
  Readiness. Periodisierungsmodell (Block ≥ traditionell bei Specific), Schlüsseleinheiten + TSS-Anteile +
  Verteilungs-Ziel + Begründungstext + Konfidenz. Button „In Wochenplanung übernehmen" (additiv, Vorschlag-Modus).
  `weekStructureRecommendation()` in `analysis.ts`; Endpunkt `GET /api/plan/week-suggestion`.

**Neu in v1.2.0 (Kurz):**
- **Tagescoach / Coach „Heute"** (Dashboard + `/api/today`): Readiness-Score (0–100, aus Schlaf/HRV/Fatigue/
  Monotonie/Taper), Trainingsempfehlung mit Art/Dauer/Intensität + Begründung, `dailyRecommendation()`.
- **Readiness-Kachel** (Dashboard): Farbbalken + Score + Ampel-Icon + Kurztext; `readinessLevel` in AnalyzeResult.
- **Aerobe Entkopplung (EF-Drift):** `efDrift` (NGP-EF 1. vs. 2. Hälfte) in `/api/analyze/week`; Flag in WeekReport.
- **Monotonie + Strain:** `dailyMonotony` / `dailyStrain` (Foster); `monotonyFlag` + `strainFlag` in analyze; in
  WeekReport. `daily_log_v2.monotony/strain` berechnet und gespeichert.
- **Kovariationskoeff. (CV-Pace):** Wochenrythmus-Flag aus Standardabweichung der NGP-Tage.

## 4c. Funktionsstand v1.1.0 (nicht Ist-Stand — historisch)

**Neu in v1.1.0 (Kurz):**
- **EditableGrid (react-grid-layout v1.5.3):** Wochenbericht + Langzeit als freies Drag-Resize-Kachel-Layout
  (paged A4-WYSIWYG). Dashboard bleibt kontinuierlich. Layout pro Seite+Profil in `settings` (`GET/PUT
  /api/layout/:page`). `EgItem` + `EgBlock` mit `reserve?: number` (Kachel-Chrome-px, Default 116) für
  Chart-Höhenberechnung. `P_MIN_H=2` (Kacheln sehr klein skalierbar). React.StrictMode entfernt (RGL-
  Kompatibilität). `textPct` (60/70/85/100 %) pro Seite in `localStorage`; `K=1/textPct` vergößert Canvas.
- **WYSIWYG A4-Druck:** A4-Canvas 794×1123 px @ 96 dpi; Outer-Scale `editorScale = stageW/Wd`, Inner-Scale
  `--sp = printScale` auf `.eg-sheet-scale`. Print CSS: `@page{size:A4; margin:0}` + `break-after:page`.
  Toolbar als `position:absolute` Overlay (volles Tile-Höhe im Editor = Print). Legenden-Button-Fix:
  `.pmc-legend button { display: inline-flex !important }`.
- **Manuelle PBs (`pb_overrides`):** additiv via `ALTER TABLE IF NOT EXISTS`, `PUT/DELETE /api/bests/override`.
  Distanz-Zeit-Graph (ScatterChart) aus Bests.tsx entfernt.
- **EffortTable:** Intervall-Mini-Tabelle im Wochenbericht (Nr., Länge, Zeit, Pace, Ø-HF, max-HF); ≥ 6 Einträge
  → 2 Tabellen nebeneinander.
- **Wellness-Tiles (LongTerm):** je Metrik eigenes EgItem mit `reserve={42}`; individuelle Position + Größe.
- **Motion-System (T11):** `--dur-fast/--dur/--dur-slow`, `--ease/--ease-out` in `:root`. `route-enter`
  (Fade+Rise), `modal-pop`, Nav-Gleitstrich, Button-Press. `prefers-reduced-motion` + Print deaktivieren alles.
  `.eg-sheet .card` + `.eg-block .card` von Karten-Staffelung ausgenommen (RGL/Druck).
- **Auswahllisten Master-Detail:** links Kategorie-Nav (Badge), rechts aktive Liste (Cross-Fade); Filter ab >4;
  Drag-and-Drop-Sortierung (⠿), kein Sort-Zahlenfeld mehr.
- **T1:** Plan-% aus `SeasonProgress.tsx` entfernt; neue Heatmap-Zeile „Plan-Erf. %" in Langzeit.
- **T2:** Wochentag-Switcher: 2 Dots (geplant=Typ-Farbe, getrackt=grün) übereinander.
- **T3:** `General`/`Other` TSS ×0.6 (Wandern-Dämpfung). **T4:** Typ-Dropdown nur Run/BikeRoad.
- **T5:** `fmtDateY` in allen Recharts-Tooltips. **T10:** Tabellen-Container `overflow-x: auto`.

**Neu in v0.15.5 (Kurz):**
- **Dashboard-Layout v2:** Reihe 1 PMC (2fr) + Aktuelle Woche (1fr); Reihe 2 Saison-Progression (1fr) +
  Intensity-Trend (1fr) auf gleicher Höhe.
- **SleepWindow-Chart:** Whoop-Stil, Floating Bars `[bedAxis, wakeAxis]` mit Anker 18:00; `reversed` Y-Achse;
  ersetzt Bettzeit-Linienplot in LongTerm + WellnessTrends.
- **Feinschliff:** Plan-Erfüllung als Inline-Kacheln je Tag (WeekReport, BarChart entfernt); Bettzeit-Y
  invertiert; VO2max-Sparkline Tooltip; Intensity-Bänder `fillOpacity 0.18` + grüne Korridor-Linien.

**Neu in v0.15.0 (Kurz):**
- **VO2max-Kachel:** VDOT nach Daniels-Gilbert (Rolling 90d, nur ≥ 1500 m / ≥ 180 s), Niveau-Badge aus
  ACSM-Normen (age + sex aus `athlete`-Setting), Mini-Sparkline + Hover. Endpoint `/api/fitness-trend`.
  Athletenprofil (`AthleteCard`) in Profile.tsx für Geburtsjahr/Geschlecht/Gewicht/Max-HF.
- **Race-Prediction-Chart** (Bests.tsx): 4 CS-Prognoselinien 5k/10k/HM/M, reversed Y, Legende togglebar.
- **Intensity-Trend** (`IntensityRatio.tsx`): ATL/CTL×100 % mit 5 COROS-Bändern; im Dashboard (Reihe 2) und
  Langzeit. Guard `ctl ≥ 1` gegen Früh-Spikes.
- **TSS-Wochenempfehlung** (`tssRecommendation` in analysis.ts): Ampel-Badge in WeekPlan-Header;
  Korridor aus CTL + Phase (Aufbau / Erhalt / Entlastung / Race Week / Krank).
- **Strava-Overwrite-Schutz** (`efforts_locked`): manuelle Bearbeitung sperrt die Einheit; Reset-Knopf
  „↻ Aus Strava neu laden" (`POST /api/activities/:id/relink-efforts`) öffnet sie wieder.
- **TSS-Donut hart = voll rot:** `typeIntensity(a.type) === "hard"` → gesamte TSS ins Hard-Bucket (statt
  zonen-anteilig).
- **Fahrrad-HF-Zonen** (`zone_sets.hr_zones_bike`, additiv); Strava-Auto-Labels (Z5+ → VO2max, Z4 → LT2).
- **UX-Features:** Phase-Pill editierbar (inline select); Drag&Copy WeekPlan; Einheits-Dots nach TSS-Größe;
  8-Wochen-Referenz in Wellness-Sparklines; Schlaf-Felder hh:mm; IntervalTrend-Legende togglebar;
  PDF-Wasserzeichen; VO2max-Konsolidierung (VO2short/VO2long → VO2max + Effort-Label).

## 4d. Funktionsstand v0.14.0 (historisch)

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


**Seiten:** Dashboard (PMC+AktuelleWoche | Saison+IntensityTrend; VO2max-Kachel) · Wochenplanung
(Phase editierbar, Drag&Copy, TSS-Badge) · Tracking (Dots nach TSS, Schlaf hh:mm, Relink-Button) ·
Wochenbericht (2-seitig druckbar; Plan-% Inline-Kacheln; EF) · Langzeit (IntensityRatio; Schlaffenster) ·
Races · Bestzeiten (Race-Prediction-Chart) · Saisonplan · Profil (AthleteCard) · Einstellungen ·
Auswahllisten. Leichte Profile (Wechsel in Sidebar; Löschen/Umbenennen mit Code **4397**).

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
Wochenbericht: zwei Donuts geplant vs. real (TSS-Zahl in der Mitte; real **hybrid**: harte Typen → alles ins
Hard-Bucket; sonst zonen-anteilig). Plan-Erfüllung jetzt als farbige %-Kachel je Tag (statt Balkendiagramm).
Wochen-Check-Hinweise: Volumen, Ramp, **Wochen-Last** (adaptiv geplant↔geplant / real↔real),
**km-Polarisierung** (nur km-in-Zone) + **TSS-Empfehlung** (Ampel-Badge, `tssRec` aus analyzeWeek).
ZoneDistribution = gestapelter %-km-Balken Z1–Z6 (füllt Kachel + Legende).

**Charts:** PMC + Saison-Progression mit Phasen-Farbband (Hover = Phasenname; Phasenname unten links), Jahresmarke
als **Dreieck** zwischen KW52/KW1, Race-Marker (gold, vertikal, nur aus Races-Tabelle, an/aus), „diese Woche" als
`ReferenceArea`, Krank-Wochen rot. Wochenbericht hat zusätzlich den **WeekdayBars**-Chart (1/3) neben der
Saison-Progression (2/3). Höhenmeter + GAP (nur Lauf, =`ngp`) bei den Einheiten in Tracking + Bericht.
Langzeit: Wellness- + Zonen-Effizienz-Verläufe (beide mit Krank-Rot), Intervall-Trend (LT1/LT2/VO2).

**Strava:** OAuth + Sync (nie überschreiben), Streams für Lauf (NGP) + Rad (NP) budgetiert; manuelle Notizen/Zonen
geschützt. **Commute**-Schalter (Bike-Einheit → Sportart General, Name „Commute", Notiz weg, `desc_fetched=1`).
**v0.15:** manuell bearbeitete Intervalle durch `efforts_locked=1` geschützt — Sync überspringt sie;
Reset-Knopf öffnet Sperre für einzelne Aktivität (`POST /api/activities/:id/relink-efforts`).

**Analyse-Karten (v0.15):**
- `Vo2maxCard`: VDOT (Daniels) aus `/api/fitness-trend`, Niveau per `vo2maxLevel()` (`server/norms.ts`), Sparkline.
- `IntensityRatio`: ATL/CTL×100 % aus PMC-Daten, 5 COROS-Bänder, Korridor-Linien 80 %/149 %.
- `SleepWindow`: Floating Bars Bettzeit→Aufwachzeit (Anker 18:00, reversed), ersetzt Bettzeit-Linie.

## 5. Offen / nächste Schritte

- **v1.12.1 abgeschlossen.** Nächster großer Meilenstein: **Electron-Desktop-App** (App per Icon auf Mac/Windows)
  → Packaging/Icons/Sidecar; node:sqlite braucht Node 22+. Plan in `~/.claude/plans/`.
- **Strava-Backfill (budgetiert):** `best_efforts`, `pace_zone_min`, NGP/NP + min/km-Zone, Race-Splits kommen
  je Einheit erst beim Enrich → Altbestand braucht mehrere Durchläufe (Tages-Bremse). Danach „TSS neu berechnen".
- **Grenzen (dokumentiert):** Strava liefert nur *aktuelle* Zonen; CS-/VDOT-Modell braucht aerobe PBs
  (≥ 1500 m, ≥ 3 min); EF/Plan-% nur für Strava-Läufe mit Streams; `estimateCustom` nutzt `DEFAULT_EST_ZONES`
  statt echter Profil-Zonen → leichte Differenz vs. Tabelle (gewollt: Schätz- vs. echte Auflösung).
- **„In Zukunft NICHT JETZT" (ToDo.md):** Readiness, Dashboard-Tagesvorschlag, Pace-/HF-Histogramm,
  v2.0-Redesign (awwwards/GSAP/Three.js, eigener Branch) — erst auf ausdrücklichen Wunsch.
- **Bekannte Feinheiten (Kolja-Kosmetik, nicht zurückdrehen):** Jahresmarke-Dreieck in `ChartDecor.tsx`
  (Spitze `plotBottom-20`, Jahreszahl `plotBottom+34`, Phasentext `plotBottom+50`, Phasenband `plotBottom-6`);
  Chart-Bottom-Margin `Pmc.tsx` 30 / `SeasonProgress.tsx` 28; SleepWindow Anker 18:00 (1080 min) für
  cross-midnight Bettzeiten.
- **Zurückgestellt:** S4 Template-Speicherung, O5 Strava-Splits-Sync-Konsistenz.

## 6. Verifikations-Routine

1. `npx tsc --noEmit -p tsconfig.json` + `-p client/tsconfig.json` + `npm run build` → grün.
2. DB-Runner (`_x.ts` im Projektordner, danach `rm`): Bestand intakt — `profiles ≥1`, `season_weeks_v2 ≥18`,
   `activities` ~1800, `daily_log_v2 ≥100`, `races` vorhanden; Spalten `ngp`/`np`/`streams_fetched` da.
   Importiere dafür aus `./server/load.ts`/`./server/zones.ts` und rechne Stichproben gegen die gespeicherten Werte.
3. TSS-/PMC-Endpunkte ggf. per `curl localhost:3000/api/...` prüfen (Watch-Server läuft meist).
4. UI testet Kolja selbst (`npm run dev`).
