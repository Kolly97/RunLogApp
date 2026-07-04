# Changelog

Alle nennenswerten Änderungen an RunLog. Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/),
Versionierung nach [SemVer](https://semver.org/lang/de/). Datenbank-Migrationen sind immer **additiv**
(keine Bestandsdaten gehen verloren).

## [Unreleased]

### Hinzugefügt
- **Zyklus steuert jetzt den Plan (4. Steuer-Input, gestuft + health-first):** Die menstruationszyklus-adaptive
  Steuerung ist nicht mehr nur Anzeige — mit dem Master-Schalter **„Zyklus steuert meinen Plan"** fließt sie neben
  Dosis/Regime/Schwerpunkt in den Coach-Blockplan ein. **Gestuft:** an DEINEN Daten belastbar gemessene Phasen×Reiz-
  Effekte (≥2 Zyklen, CI ohne 0, |g|≥0.2) steuern real; sonst nudged nur der schwache mechanistische Prior sanft (klar
  „Hypothese"). **Hebel Typ + sanfte Last:** in günstigen Phasen wird eine Qualität Richtung VO2/Schwelle gedreht, in
  Menstruation/später Lutealphase aerob/lockerer + etwas weniger Wochenlast — alles **geklemmt** ins Periodisierungs-
  Band; Health-Cap, km-Ceiling (ACWR) und Periodisierung übersteuern **immer**, jede Anpassung im Coach begründet.
  Heutige starke Symptome dämpfen die nächste Woche zusätzlich (health-first). (`server/cycleTraining.ts`
  `cyclePlanningBias`/`projectedPhaseForDate`, `server/analysis.ts` `blockPlan` `cycleByWeek`, `server/index.ts`.)
- **Zyklus-Band + km/TSS je Woche in der Coach-Timeline:** Die Überblicksgrafik zeigt zusätzlich zum Periodisierungs-
  Band ein **Zyklus-Phasen-Band je Woche** (Men/Fol/Ovu/fLut/sLut, vorausberechnet), der Tooltip nennt **Σ km und
  Σ TSS** je Woche + Phase, plus eine **Ø km/TSS-je-Phase**-Zeile. (`client/src/charts/BlockTimeline.tsx`.)
- **4. Zyklus-Panel im „Was hilft dir?"-Verdikt:** zusammengefasste Zyklus-Antwort (aktuelle Phase, was je Phase
  favorisiert wird — gemessen/Hypothese — und ob er den Plan steuert), consent-gated. (`TrainingVerdictCard.tsx`,
  `GET /api/cycle-training/status` `planningSummary`.)
- **MCID an die eigene Messgenauigkeit verankert (Reliable-Change + Marker-Floor):** Die Praxisschwelle „ab hier zählt
  ein Effekt als echt" ist keine feste Magic-Number mehr, sondern wird aus dem **eigenen latenten Messrauschen**
  abgeleitet (Median der latenten `sd`) und nach unten am physiologischen Test-Retest-Minimum gefloort — verrauschte/
  dünne Daten heben die Schwelle, präzise Daten senken sie bis zum Minimum, nie darunter. Verankert werden die
  **latente MCID** (Trials/Prospektiv, Erfolgsschwelle wird am Design-Zeitpunkt fixiert = Prä-Registrierung) und die
  **CS-Achse** (jetzt aus einer Quelle `MARKER_MCID` statt doppeltem `MIN_CS`-Literal); die per-SD-Dosis-Schwelle
  (`DOSE_PER_SD_MCID`) ist zentralisiert, aber bewusst fix (Slope ohne Marker-Analog). Neue pure Kern-Datei
  `server/ml/mcidAnchor.ts`; Trials setzen `mcid_source` = `anchored|default|user`.
- **Praxisschwellen-Erklär-Block im „Was hilft dir?"-Verdikt:** transparenter Block „Deine Praxisschwelle (MCID)"
  (`TrainingVerdictCard.tsx`) — was die Schwelle bedeutet, dass sie an die eigene Messgenauigkeit gekoppelt ist,
  aktuelle Werte + Quelle; das Kausal-Experiment nennt seine verankerte Erfolgsschwelle. `GET /api/ml/settings`
  liefert die verankerte MCID live mit.

### Geändert
- **Verdikt-Caching (Fingerprint-Auto):** Das „Was hilft dir?"-Verdikt wird je Profil gecacht
  (`ml_verdict_cache`, additiv). Der teure Teil — zwei Sidecar-`exposure_dose`-Läufe (je bis 120 s), die bisher bei
  **jedem Coach-Laden** neu anfielen — wird nur noch berechnet, wenn sich die Inputs ändern (neuer ML-Run, neuer
  bewerteter Trial, geänderte MCID); sonst Cache-Treffer. `?fresh=1` erzwingt Neuberechnung. Coach lädt spürbar
  schneller. (`server/index.ts` `buildTrainingVerdict`/`verdictFingerprint`, `server/db.ts`.)

## [2.4.0] – 2026-07-04 — Coach-Cockpit, Wettkampf-Prognose & adaptive Steuerung

### Hinzugefügt
- **Visueller Wettkampf-Block + Wettkampf-Prognose bis zum Renntag (Baustein 2.1–2.4):** Der Coach-Block ist jetzt
  ein Timeline-Dashboard statt Textliste, mit Form-Prognose und automatischer Peak-Ausrichtung.
  - **Timeline-Dashboard (2.1):** Wochen bis Renntag als gestapelter Load-Balken (umschaltbar **Zonen ↔ Einheiten-Art**),
    Phasen-Band, Renntag-Marker, je Woche **KM + Kern-Einheit**. **Klick auf eine Woche im Diagramm klappt ihren
    Tagesplan auf** (Akkordeon + Scroll + Spalten-Highlight); Tagesplan clean neu gestaltet (farbige Typ-Kante · Pill ·
    Beschreibung · min·TSS · Begründungszeile). „Übernehmen"/„Phasen übernehmen" erhalten.
  - **Form-Readiness-Kurve (2.2):** über der Timeline Readiness = Fitness × Frische (CTL × TSB-Frische, Gauss-Band um
    TSB +12) mit **Peak-Marker** + Ampel „Peak trifft/verfehlt den Renntag" (+ Block/Taper-Empfehlung), gekoppelt an die
    Ziel-Prognose („am Renntag bereit für X:XX vs. Ziel Y:YY", aus `tuneupProgress`).
  - **Individuelle IR-Fitness-Prognose (2.3):** liegt ein Dose-Response-Run vor, nutzt die Readiness die individuelle
    Fitness-Prognose (Faltung der geplanten Kanal-Lasten mit den gefitteten Impulse-Response-Kernels β·exp(−Δ/τ)) statt
    der groben CTL — **automatisch, ohne neuen Sidecar-Lauf**; sonst PMC-Form-Fallback + Hinweis „Dose-Response rechnen".
  - **„Peak auf Renntag ausrichten" + intelligenter Taper (2.4):** Button **🎯 Peak ausrichten** probiert valide
    **Taper-Längen (1–3 Wochen)** durch und legt den Form-Peak möglichst auf den Renntag (nur Vorschau; manuelle Phasen
    bleiben). Der Taper reduziert zudem das Qualitäts-**VOLUMEN** (weniger Reps — Race Week ~−50 %, Deload ~−30 %) bei
    **gleicher Pace** („Tempo in kleineren Dosen"), Steigerungen bleiben voll.
  (`server/analysis.ts` `derivePhaseSequence(taperWeeks)`/`blockPlan`, `server/mlJobs.ts` `blockIrFitness`,
  `server/index.ts` block-suggestion (`?taper=`), `server/workouts.ts` `RenderCtx.taperFactor`,
  `client/src/charts/BlockTimeline.tsx`, `client/src/lib/blockReadiness.ts`, `client/src/pages/Coach.tsx`,
  `BlockWeek.irFitness` in `analysis.ts`+`api.ts`.)
- **Adaptiver Last-/Intensitäts-Regler (athleten-angepasst, gebündelt-auto + transparent):** Drei geschlossene
  Regelkreise steuern den Coach-Block jetzt individuell:
  **(C1) Load-Regler** — das Wochen-TSS-Ziel folgt einem phasengerechten **ATL:CTL-Band** (Intensity-Trend „Load
  Impact / Base Fitness"): Belastung/Specific am oberen „Optimized"-Rand (~120–135 %), Base darunter, Entlastung/Taper
  drunter, **nie „Excessive"** (Kappung < 150 %).
  **(A1) km-Ceiling** — verletzungssicheres Wochen-km-Limit aus der eigenen Historie (**ACWR** akut 7 d : chronisch
  28 d, ≤ 1.3), progressiv wachsend; deckelt auch manuelle km + flaggt.
  **(B1) RPE-Loop** — je Einheiten-Typ (LT2/VO2/Race) fließen RPE + `felt_vs_expected` (Confounder raus) in das
  **Volumen** der nächsten gleichen Qualität (weniger Reps wenn zuletzt zu hart, mehr wenn zu leicht — **Pace bleibt**).
  Jede Anpassung mit Begründung im Coach; Health-Cap vetot über allem. (`server/analysis.ts` `tssRecommendation`/
  `typeVolumeFactors`/`blockPlan`, `server/load.ts` `kmCeiling`, `server/workouts.ts` `RenderCtx.volumeFactor`,
  `server/index.ts` block-suggestion, `client/src/pages/Coach.tsx`.)
- **LT1 ↔ LT2 getrennt: neuer Schwerpunkt „LT1 (aerobe Schwelle)" + LT1-Marker.** Der Coach unterscheidet jetzt die
  aerobe Schwelle (LT1, Z3 — hohes lockeres Volumen, Fettstoffwechsel/Clearance) von der Laktatschwelle (LT2, Z4 —
  renn-spezifisches Tempo) und steuert beide getrennt: neuer Block-Schwerpunkt „lt1" (Coach/Availability + Methodik-
  Analyse), der LT1-Volumen phasengerecht setzt (Base/Build; in Specific bewusst nicht erzwungen). Die Evidenz spricht
  den Schwellenbereich als LT1/LT2 (Dose-Kanäle „M → LT1 · Marathon", „T → LT2 · Schwelle"; Kanal→Schwerpunkt-Map
  M/Marathon-Pace → lt1 statt schwelle); `classifyWeekEmphasis` trennt LT1 (LT1/Steady/Marathon-Pace) von LT2. Neuer
  **LT1-Pace-Marker** in der Methodik-Batterie (`zones.lt1_pace`, Z2/Z3-Grenze), LT2 als „LT2 · Threshold-Pace"
  präzisiert. (`server/analysis.ts` (`Markers`+`MarkerZones`), `server/workouts.ts`, `server/coachSynthesis.ts`,
  `server/ml/trainingVerdict.ts`, `server/index.ts` /api/markers, `client/src/components/{AvailabilityCard,
  MethodEmphasisCard}.tsx`, `client/src/charts/ForestPlot.tsx`, `client/src/pages/Methodik.tsx`.)
- **Adaptives, faktenbasiertes Coaching-Gerüst (ToDo 35):** Der Coach zieht jetzt die „Was hilft dir?"-Synthese in die
  konkrete Planung. Der Block-Vorschlag (`/api/plan/block-suggestion`) leitet aus dem geschichteten Verdikt einen
  **Schwerpunkt** (→ `pickWeekWorkouts`) und eine **Verteilung** (→ Intensitäts-Nudge) ab — **automatisch, wenn belastbar**
  (sonst sportwissenschaftlicher Standard), **gestuft** (kausal-geprüfte N-of-1-Trials stark · beobachtet sanft ·
  Hypothese nur Anzeige). **Health-Flags (RED-S/Übertraining) kappen die Wochenlast + höchste Intensität HART**
  (übersteuert die Evidenz), Readiness moduliert, Zyklus bleibt beratend. Neuer „Adaptives Coaching-Verdikt"-Banner
  im Coach erklärt das „warum" (ehrlich beobachtet vs. kausal geprüft) + Auto/manuell-Schwerpunkt-Umschalter
  (`coach_emphasis_mode`) + Frische-Hinweis. Neues pures Modul `server/coachSynthesis.ts`; geteilter
  `buildTrainingVerdict`-Helper (identische Zahlen wie die Karten). (`server/index.ts`, `server/analysis.ts`,
  `server/workouts.ts`-Emphasis-Pfad, `client/pages/Coach.tsx`.)
- **Zyklus-N-of-1-Aktivierung (Teil 5, beratend, Opt-in je Effekt):** Die bereits gebaute, beobachtende Phase×Reiz-
  Auswertung darf jetzt auf „aktiv" flippen — aber nur für Zellen, die der Nutzer bewusst freischaltet. Neuer Master-
  Schalter „Aktivierung erlauben" (`cycle_adaptive_enabled`) + Per-Effekt-Opt-in (persistiert in `phase_stimulus_map`),
  neue Route `POST /api/cycle-training/activate` (schaltet nur belastbare Zellen frei: Konf≥mittel · CI ohne 0 · |g|≥0.2 ·
  ≥2 Zyklen). Neuer Zustand `activatable` (belastbar, aber noch nicht freigeschaltet). Rein beratend — kein Eingriff in
  den Planer; Health-Gate (Amenorrhoe/RED-S) und Symptom-Override schlagen jede Aktivierung. (`cycleTraining.ts`,
  `index.ts`, `CycleScaffoldCard.tsx`, `api.ts`.)
- **Composition-Bayes (Volumen-bereinigt):** Die „Volumen-bereinigt"-Sicht der Dosis-Wirkungs-Karte nutzt jetzt die
  Bayes-Engine (vorher TS-Ridge) — mit Sum-to-zero-Constraint (Σβ=0), da die gegen den Gesamt-Umfang residualisierten
  Kanäle rank-defizient sind. Jeder Effekt = Abweichung vom mittleren Mix bei gleichem Umfang; Effekte summieren sich zu 0.
- **Engine-Reset/Abbrechen:** Der „Neu berechnen"-Button lässt sich während des Rechnens erneut klicken = laufenden/
  hängenden Lauf abbrechen und die Engine zurücksetzen (`POST /api/ml/cancel` markiert den Lauf sofort als abgebrochen).

### Geändert
- **Coach & Methodik: klare Rollentrennung „Cockpit + Werkbank" — keine doppelten Regler mehr.** Der
  **Block-Schwerpunkt** (`availability.emphasis`) ist jetzt **nur noch im Coach** (Cockpit) einstellbar; die
  `MethodEmphasisCard` in der Methodik (Werkbank) ist **read-only** geworden (zeigt gewählten + evidenz-besten
  Schwerpunkt) und verlinkt „→ im Coach einstellen" — beseitigt die bisher dreifache, verwirrende Setz-Möglichkeit.
  Neue **bidirektionale Deep-Links**: Coach-Verdikt → „→ Belege in Methodik" (öffnet direkt den „Was wirkt?"-Tab
  via `?tab=`), Werkbank → „→ im Coach einstellen". Untertitel beider Seiten geschärft (Coach = „Cockpit — was jetzt
  zu tun ist", Methodik = „Werkbank — das Warum dahinter"). Reine UI-/Framing-Änderung, keine Modell-/Datenänderung.
  (`client/src/components/MethodEmphasisCard.tsx`, `client/src/pages/Methodik.tsx`, `client/src/pages/Coach.tsx`.)
- **Schwerpunkt wirkt jetzt in JEDER Blockwoche — auch in Base.** Der evidenz-abgeleitete Schwerpunkt (aus dem
  Coaching-Verdikt) drehte bisher nur in Build/Specific eine Qualität; in Base wurde er ignoriert. Jetzt greift er auch
  in Base/phasenlos — physiologisch korrekt über base-legale Präkursoren (Schwelle→LT1-Volumen, VO2→Fartlek/Bergsprints,
  Berg→Hügel, Norwegian→LT1-Reps, Fartlek→Fartlek). Deload/Taper/Race-Week/Recovery bleiben unangetastet. Zusätzlich zeigt
  der Wettkampf-Block je Qualitäts-/Long-Tag eine knappe „Warum diese Einheit"-Begründung (physiologischer Zweck), am
  schwerpunkt-getriebenen Tag mit Schwerpunkt-Label. (`server/workouts.ts`, `server/analysis.ts`, `client/src/lib/api.ts`,
  `client/src/pages/Coach.tsx`.)
- **„Race Specific"-Token getrennt vom Wettkampf:** Race-Specific-Workouts (`Renntempo`) zeigen jetzt ihr eigenes
  Token **„Race Specific"** (statt fälschlich „Wettkampf"); „Wettkampf" bleibt echten Rennen vorbehalten. Ursache war
  der Alias `Renntempo→Race` bei fehlendem Nutzer-Token; gefixt via eigenem Label + Default-Set-Fallback im
  Token-Resolver, plus eigener Bar-Familie „Race Specific" in der Block-Timeline. (`client/src/lib/options.ts`,
  `client/src/charts/BlockTimeline.tsx`.)
- **Forest-Plot zeigt den Bayes-Posterior:** Balken + Intervall zeigen jetzt Posterior-Mittel/94%-HDI, wenn eine
  Bayes-Engine lief (deckt sich mit Engine-Label und Detail-Panel) — sonst weiter TS-Punktschätzung + Block-Bootstrap-CI.
- **Auto-Kanalwahl mit VIF-Reserve:** Auto splittet nur in feinere Kanäle, wenn deutlich trennbar (autoVifThreshold 6),
  nicht mehr haarscharf an der 8er-Grenze; die Leiter kennzeichnet die 6–8-Zone als „grenzwertig".
- **„Was hilft dir?"-Overview:** unterscheidet ehrlich „berechnet, aber kein eindeutiges Ergebnis" (Effekt statistisch
  klar, aber unter der Praxisschwelle MCID) von „sammelt Daten"; MCID-Gate prüft gegen dieselbe Schätzung, die angezeigt
  wird (Bayes-HDI bzw. TS), und aktualisiert sich nach einem Recompute automatisch.

### Behoben
- **Falscher/veralteter Dosis-Lauf angezeigt:** Anzeige und Frische nehmen jetzt den zum aktuellen Input-Hash passenden
  Lauf (nicht blind den mit der höchsten ID) — nach einem Kanal-Wechsel zeigte die Karte sonst den falschen, wiederver-
  wendeten Lauf und blieb fälschlich „veraltet".
- **Hängende „rechnet…"-Anzeige:** tote Läufe heilen sich beim Status-Poll selbst (Reap > 20 min); der Bayes-Lauf rechnet
  bis zur vollen Genauigkeit durch (Timeout 15 min statt ~2 min → kein vorzeitiger Rückfall auf die gröbere TS-Ridge).
- **Graue Einheiten-Pills im Coach-Block:** generierte Einheiten mit einem Session-Typ, den die eigene Auswahlliste nur
  unter einem Synonym führt (z.B. „Threshold" vs. konfiguriert „LT2"), nutzen jetzt das passende fixierte Farb-/Label-Token
  (Synonym-Fallback in `typeColor`/`typeLabel`: Threshold↔LT2, Repetitions↔Rep, Renntempo↔Race; exakte Treffer gewinnen).

### Dev
- **Changelog-Pflicht in CLAUDE.md (§5c):** nach jeder Änderung sofort diesen `[Unreleased]`-Block pflegen.

## [2.3.0] – 2026-07-02 — Analytik-Feinschliff, flexible Planung & ehrliche Kausal-Vorschläge

Baut auf dem Research-Lab-Fundament von v2.2.1 auf: die Langzeit-Analytik wird klarer, die Wochenplanung
flexibler, die kausalen Trainingsvorschläge ehrlicher — und der gesamte Zuwachs ist durch einen Architektur-
und Stabilitäts-Audit gegangen. Alle Migrationen bleiben additiv, echte Trainingsdaten werden nie verändert.

### Hinzugefügt
- **Langzeit-Charts, einheitlicher Trend-Look:** Pace-vs-HF, Effizienz-Faktor, aerobe Entkopplung und effective
  VO2max zeigen jetzt dezente Rohpunkte, eine klare Trendlinie, das Monatsmittel als distinkte Marker und ein
  subtiles Streuband — analytisch, nicht überladen.
- **Zyklus-Steuerung als Profil-Option:** im Profil aktivierbar; erst danach erscheinen der Methodik-Zyklus-Tab
  und das Symptom-Tagesmodul im Tracking. Standardmäßig aus, lokal, nicht-diagnostisch.
- **Marathon-Pace & Repetitions voll integriert:** eigene Auswahl-Labels/Farben und wissenschaftlich korrekte
  Konkretisierung — Marathon-Pace als moderater Z3-Dauerlauf (~84 % VO2max, Daniels M), Repetitions als kurze,
  schnelle Z6-Intervalle mit voller Erholung (~107 % VO2max, Daniels R).
- **Flexibler Qualitätstag:** ein bevorzugter Berg-Tag ist zugleich Qualitätstag — je nach Trainingsphase kann
  dort Berg **oder** Tempodauerlauf liegen, statt den Tag starr auf einen Typ festzunageln.
- **„Warum dieser Vorschlag / warum nicht die anderen":** die Trial-Vorschläge begründen im Klartext, warum ein
  Kontrast oben steht und warum die Alternativen niedriger ranken (nach Datenlage, Nutzen, Dauer, Risiko,
  Erklärbarkeit — bewusst ohne „Erfolgswahrscheinlichkeit").
- **Zyklus-Phasen rückwirkend:** neu geloggte Periodenstarts rekonstruieren die Phase der bereits getaggten
  Einheiten aus der vollen Historie (statt nur zum Erfassungszeitpunkt zu stempeln) — leakage-frei und additiv.
- **Echter adversarial Audit-Workflow:** `POST /api/ml/audit` rekonstruiert das aktuelle Dosis-Wirkungs-Design
  und prüft Zeitordnung/CV-Basis, Frische, Identifizierbarkeit, Shrinkage/FDR/MCID, Vorzeichen-Stabilität
  sowie Gesundheits-Confounder. Die Methodik-Karte zeigt den Report per „Audit laufen lassen".
- **Verhütung/Status-Mehrwert:** die Zyklus-Karte erklärt je Methode konkret, ob RunLog natürlich,
  ovulationsunterdrückt oder unsicher modelliert und was das für Gate, Beobachtung und Vorschläge bedeutet.
- **„Alles neu berechnen":** nach der Strava-Erstanreicherung erscheint der Neuberechnen-Schritt sichtbar, damit
  die nachgezogenen Details/Streams (NGP/NP) auch in die TSS einfließen.

### Behoben
- **Kausal-Scoring:** Marathon-Pace wurde durch einen Buchstaben-Regex fälschlich als hartes Intervall gezählt;
  der Informationsgewinn (CI-Überlappung) ist jetzt korrekt der Nutzen- statt der Datenlage-Dimension zugeordnet.
- **Trainingstypen-Pace:** Marathon-Pace und Repetitions rendern nicht mehr versehentlich als lockerer Dauerlauf.
- **Geplante km je Zone:** fehlende `zone_alloc.byKm` werden serverseitig aus `byMin` ergänzt; Plan-Erfüllung
  arbeitet direkt mit `byMin`, ohne dass Einheiten manuell neu gespeichert werden müssen.

### Geändert / Robustheit
- **Strava-Backups begrenzt:** die Backfill-Backups behalten nur die letzten drei — kein unbegrenztes
  Plattenwachstum mehr.
- **Tracking-Performance:** Zyklus-Symptome werden je Woche gebündelt geladen statt pro Tag.
- **Tutorial-Demo robuster:** „Mara" wird über einen stabilen Marker statt über den Profilnamen erkannt — echte
  Profile können nie als Demo behandelt werden.
- **Testbasis erweitert:** 14 Kern-Tests, u.a. Kausal-Scoring, Zyklus-Backfill, flexibler Plan-Tag und die
  Pace-Zonen für Marathon-Pace/Repetitions.
- **Architektur-/Stabilitäts-Audit:** der gesamte Zuwachs wurde gegen die bestehenden Muster geprüft (additive
  Migrationen, unveränderte Export-Signaturen, Transaktions- und Settings-Konventionen).
- **Doku/Version:** README, Changelog, Handoff, Footer-Stand und Paketversion auf v2.3.0 synchronisiert.

## [2.2.1] – 2026-07-02 — Stabiler Coach-Kern + Research-Lab

Stabilisierungs- und Forschungs-Inkrement nach v2.2.0: Plan-Erfüllung wird robuster, Strava-Erstanreicherung
ist kontrolliert fortsetzbar, Langzeit-Charts werden analytischer und die Methodik-Seite ist als Research-Lab
strukturiert. Keine destruktiven Migrationen.

### Hinzugefügt
- **Testbasis:** `npm test` via `node --import tsx --test`, erste Kern-Tests für Load/PMC, Analyse,
  Planbuilder, Pacing, Laktat und ML-Feature-Backbone.
- **Bewusste Nicht-Zuordnung:** `activities.match_ignore` + Match-API `ignore`. Aktivitäten zählen weiter zur
  realen Last, aber nicht zur Plan-Erfüllung.
- **Trainings-Taxonomie:** kanonische Typen `MarathonPace` und `Repetitions` inkl. ML-sicherer Kanal-/Zonen-Mappings.
- **Strava-Erstanreicherung:** resumierbare Queue mit Status/Start/Step/Cancel, Backup vor Start,
  Rate-Limit-Schutz und Fortschritt in den Einstellungen.
- **Langzeit-Charts:** Pace-vs-HF, Effizienz-Faktor, aerobe Entkopplung und effective VO2max mit Trendlinie,
  Monatsmittel und Streuband.
- **Research-Lab:** Methodik-Tabs `Status`, `Was wirkt?`, `Experimente`, `Zyklus`; Trial-Vorschläge als
  Ranking nach Datenlage, Nutzen, Dauer, Risiko und Erklärbarkeit.
- **Tracking:** optionales Zyklus/Symptom-Tagesmodul, nur nach aktivem Consent, lokal und nicht-diagnostisch.

### Behoben
- **VDOT/VO2max-Saisonansicht:** Future-Range-Punkte verwenden für das aktuelle Fitness-Signal kein künstlich
  in die Zukunft verschobenes 90-Tage-Fenster mehr. Dashboard, Langzeit und Bestzeiten bleiben konsistent.

### Geändert
- **Beobachtungs-ML klarer geframed:** Dosis-Wirkung bleibt Hypothese/Korrelation; “geprüft” bleibt dem
  prospektiv-randomisierten N-of-1-Pfad vorbehalten.
- **Adversarial Audit verankert:** Identifizierbarkeit, CV-Leakage, Priors/Shrinkage, Confounder-Sensitivität
  und Vorzeichen-Stabilität stehen sichtbar als Audit-Checkliste in der Dosis-Wirkungs-Karte.
- **Doku/Version:** README, Changelog, Handoff, Footer-Stand und Paketversion auf v2.2.1 synchronisiert.

## [2.2.0] – 2026-07-01 — ML-Trainingssteuerung: Latente Fitness · Dosis-Wirkung · Kausal-Experiment · Zyklus-Tracking

Kern-Release der datengesteuerten Trainingssteuerungs-Engine (P0–P6): sieben Ausbaustufen vom einfachen
Fitness-Modell bis zum prospektiv-randomisierten N-of-1-Kausalexperiment und zyklusbasierter
Trainingsforschung. Alle Auswertungen lokal, keine Cloud-Abhängigkeit.

### Hinzugefügt

- **P0 — Latente Fitness (`LatentFitnessCard`):** Banister-Impuls-Antwort-Modell auf Basis der
  Trainingstagebuch-Daten. Langzeitreihe (CTL-Glättung als Proxy) + MCID-Schwelle (Minimal Clinically
  Important Difference, Default 1,0 VO2-Äquiv.). Karte auf Methodik-Seite.

- **P1 — Dosis-Wirkung / Forest-Plot (`DoseResponseCard`, `ForestPlot`):** Kanal-Effekte aus
  `ml_channel_effects` (Reiz × Fitness-Delta), Forest-Plot mit Konfidenzintervallen, `ConfidenceBadge`
  (insufficient / exploratory / low / medium / high). Recompute-Button, Methodenwechsel gesperrt bis
  ausreichend Daten.

- **P2 — Readiness & Gesundheits-Gate (`ReadinessHealthCard`, `ReadinessChart`):** Wellness-Aggregat
  aus `daily_log_v2` (Schlaf, HRV, Ermüdung, Stimmung); Confounder-Tracking (Krankheit, hohe Last,
  schlechter Schlaf → Flag). Gesundheitsstatus-Ampel + Trend. Gate blockiert ML-Empfehlungen bei
  aktivem Confounder-Flag.

- **P3 — EMA-Feedback (`FeedbackPrompt`, `session_feedback_v2`):** Nach jeder abgeschlossenen Einheit
  optionaler Micro-Survey (felt_vs_expected −2…+2, RPE 1–10, session_family, Notiz). Confounder-Flag
  (Krankheit, externe Stressfaktoren) explizit erfassbar. Server-seitiges Auto-Tagging mit
  Zyklus-Kontext wenn P6-Consent aktiv.

- **P4 — Feedback-Auswertung (`evaluateFeedback`, `methodInference`):** Aggregiert `session_feedback_v2`
  nach `session_family`; identifiziert gut / schlecht tolerierte Reize; Konfidenz aus n; DoseResponse-
  Karte zeigt Recompute-Ergebnis.

- **P5 — Kausal-Experiment: Prospektiv-randomisierter N-of-1-Trial (`ProspectiveTrialCard`):**
  - Counterbalanced AB/BA-Blockdesign, determinstischer Seed (FNV-Hash), exakter Within-Pair-
    Permutationstest (2^P Vorzeichenflips).
  - Verdikt-Ampel: `geprueft` (p ≤ 0,031, ≥ 6 saubere Paare ≈ 1,5–2 Jahre), `hypothese`,
    `inconclusive`, `insufficient`.
  - **Auto-Plan:** Load-matched Blöcke per Button+Vorschau in `planned_sessions` schreiben
    (Wochenvolumen TSS bleibt phasen-/CTL-getrieben; nur Reiz-Mix kippt). Blöcke mit
    `experiment_id` getaggt — Abort löscht ausschließlich getaggte Zeilen, manuelle Einheiten
    bleiben unberührt (DB-sicher verifiziert).
  - Hochgesundheits-Flag-Fenster werden als Blöcke ausgeschlossen, um Confounder-Bias zu verhindern.

- **P6 — Zyklus-Trainingssteuerung — Scaffold OFF (`CycleScaffoldCard`):**
  - **Consent-Hard-Gate:** alle Zyklus-Endpunkte liefern `403 {needsConsent:true}` ohne
    explizites Opt-in; Zyklus-Daten sind lokal und unverschlüsselt (offengelegt, bewusste
    Entscheidung; Verschlüsselung = Folge-Increment).
  - **5 additive Tabellen:** `cycle_training_settings`, `cycle_period_log_v2`,
    `cycle_symptoms_v2`, `cycle_stimulus_evidence_v2`, `cycle_stability_v2`.
  - **Gate & Beobachtungsmodus:** natural + ≥ 3 stabile Zyklen → passed; suppressed (Pille /
    Implantat) → n/a; < 3 Zyklen → Beobachtungsmodus; Amenorrhoe (> 90 d) → Gesundheits-Flag.
  - **Perioden-Log:** Zyklusstart-Chips, löschen per Klick.
  - **Symptom-Erfassung:** Tages-Survey cramps / energy / sleep / mood / flow (1–5 + Notiz).
  - **Phase × Reiz-Heatmap (`evaluatePhaseStimulus`):** Standardisierter Effekt vs. Reiz-Baseline
    je Phase (Menstruation / Follikulär / Ovulation / Früh-Luteal / Spät-Luteal × Reiz-Familie);
    Confounder-Zeilen ausgeschlossen; Konfidenz n < 3 → insufficient / 3–5 → exploratory / ≥ 10 →
    medium. CSS-Grid, divergierende Farben (grün/rot), insufficient-Zellen klar gemutet.
    Empfehlung immer `off · sammelt Daten` (Scaffold).
  - **Zyklus-Phasen-Farbband-Overlay** auf PMC-, Intensity-Ratio- und Wellness-Diagrammen
    (LongTerm + Dashboard): Band knapp über dem Trainingsphasen-Band (`plotBottom-13`, h = 4,5);
    5-Farb-Palette (Menstruation #e0698a, Follikulär #2dd4bf, Ovulation #f0b429,
    Früh-Luteal #7c9cf0, Spät-Luteal #b47ccb). Rendert gar nicht ohne Consent → null Risiko
    für Nutzer ohne Zyklus-Daten.
  - **1-Klick-Daten-Löschen + Consent-Widerruf** (löscht alle cycle_*-Zeilen + setzt Consent zurück).

### Technisch

- **Neue Server-Dateien:** `server/ml/prospective.ts` (Engine), `server/mlJobs.ts` (Lifecycle),
  `server/cycleTraining.ts` (pure Engine: Phase, Gate, Stabilität, Feedback-Auswertung).
- **`server/db.ts`:** additive Migration: 16 neue Spalten in `method_experiments`, `experiment_id`
  in `planned_sessions`, 5 neue Cycle-Tabellen.
- **`server/index.ts`:** `/api/ml/prospective` (6 Routen) + `/api/cycle-training` (12+ Routen,
  alle consent-gated).
- **Neue Client-Komponenten:** `ProspectiveTrialCard`, `CycleScaffoldCard`, `LatentFitnessCard`,
  `DoseResponseCard`, `ReadinessHealthCard`, `FeedbackPrompt`.
- **Neue Client-Charts:** `ForestPlot`, `LatentFitnessChart`, `ReadinessChart`.
- **`client/src/charts/ChartDecor.tsx`:** `cycleRuns`-Prop + Zyklus-Phasen-Band.
- **`client/src/lib/markers.ts`:** `cyclePhaseRunsByDate()`.
- **`client/src/lib/api.ts`:** vollständige Typen für P5 (`MlProspective*`) + P6 (`Cycle*`).

---

## [2.1.0] – 2026-06-30 — Distanzadaptive Trainingsplanung + Streak-Logik + Wochenbericht-Kacheln

Drei Vertiefungen am Trainingsmodell und an der Oberfläche: Wochenplanung und Blockplanung reagieren jetzt auf
die Wettkampfdistanz (5k bis Marathon), die Streak-Karte zeigt die korrekte laufende Serie und Wochenbericht-
Kategorien erscheinen als kompakte, nicht überdehnte Stat-Felder.

### Hinzugefügt
- **Distanzadaptiver Workout-Picker (4 Buckets):** Neues `is10k`-Bucket (7–15 km) neben 5k, HM und Marathon.
  Specific-Phase für 10k: VO2-max + LT2-Mix (`long_fastfinish`, VO2-Pool, LT2/Race-Pace-Rotation, Strides).
  Build-Phase HM/M: zweiter Qualitätstag aus gefiltertem LT2-Pool (kein Duplikat mit Slot 1) + `long_mp_segments`.
  Basis-Phase Marathon: Hill Reps früher im Rotations-Pool.
- **`phaseDistributionTarget` distanzabhängig:** Akzeptiert jetzt `goalDistanceM`; 5k/10k → polarisierter
  (+Z3), HM/M → pyramidal (+Z2); fließende Abstufung zwischen den Buckets.
- **km-Alignment in `blockPlan`:** Wenn `target_km` gesetzt, skaliert ein `factor` (0.7–1.4) die TSS der
  Easy/Long-Sessions so, dass die Gesamtwoche näher am Kilometerziel liegt; Quality-Sessions bleiben unberührt.
- **Wettkampfdistanz an alle Planungs-Endpunkte durchgereicht:** `week-suggestion`, `block-suggestion` und
  `analyze-week` lesen die nächste Race-`distance_m` und übergeben sie als `goalDistanceM`.

### Geändert
- **Streak-Regel „Nur echtes Training":** Eine Einheit mit `sport ≠ General` (kein Commute) verlängert die
  Serie; reiner Commute-Tag (nur `sport = General`) bricht die Serie; eingetragener Ruhetag (`type = Rest`)
  überbrückt; leerer Vergangenheitstag bricht. Heute bleibt offen (bricht nicht, sofern noch kein Real-Training).
- **Streak-Headline = laufende Serie:** Große Zahl zeigt die aktuelle Serie bis heute; Nebenzeile zeigt aktive
  Tage diesen Monat und die längste Serie. Commute-only-Tage im Kalender: neutral/gestrichelt; Ruhetag: gepunktet.
- **Wochenbericht-Kategorien als 3 Stat-Kacheln:** Ehemaliges einzelnes, überdehnendes `cat-lines`-EgItem
  durch drei kompakte Kacheln (`cat-run`, `cat-bike`, `cat-str`, je `defaultSpan={4}`, ~84 px Höhe) ersetzt.
  Jede Kachel zeigt Ist-Wert, geplanten Wert und eine farbige Completion-Bar (≥98 % grün, ≥70 % accent, sonst warn).

### Technisch
- `server/workouts.ts`: 4-Bucket-Matrix + Build/Specific-Phase-Distanzmodulation.
- `server/analysis.ts`: `phaseDistributionTarget(phase, overrides?, goalDistanceM?)`, `BlockWeekInput.target_km`,
  `renderUnit`-Closure + km-Alignment-Loop in `blockPlan`.
- `server/index.ts`: Race-`distance_m`-Lookup in `week-suggestion`, `block-suggestion`, `analyze-week`.
- `client/src/components/StreakCard.tsx`: `DayAgg.real`, `restLogged`-Set, neue Streak-Iteration, Kalender-Klassen.
- `client/src/pages/WeekReport.tsx`: `CatStat`-Komponente, 3 separate EgItems.
- `client/src/styles.css`: `.cat-stat`, `.cat-bar`, `.streak-cell.commute`, `.streak-cell.rest`.

## [2.0.0] – 2026-06-29 — Vollständig aktualisierte Anleitung (Anleitung v2.0) + Versionsmeilenstein

Versionsmeilenstein nach dem umfangreichen Funktionsausbau v1.10–v1.12.1: Premium-Politur (Dark Mode,
Motion-System, Signature-Hero), vollständige N-of-1-Diagnostik, strukturierter Workout-Builder (Coros-Style),
dynamische Einheiten mit TSB/Fitness-Anpassung. Die **In-App-Anleitung** (`client/public/usage.html`) wurde
vollständig auf den aktuellen Stand gebracht (Anleitung Version 2.0) — alle Seiten, alle Funktionen.

### Geändert
- **Anleitung v2.0:** Dashboard (Form-Ribbon, Sparklines, Dark Mode), Wochenplanung (dynamische Einheiten
  mit von–bis, strukturierter Builder), Wochenbericht (Periodisierungs-Override), Methodik (Block-Inferenz,
  Sparklines), Profil (Laktat-Achse, Tutorial-Profil, Block-Präferenzen + Builder), Einstellungen (Theme,
  Animationen, Sparklines). Neue Seite „Was ist neu? v1.10–1.12" im Nav.
- `package.json` → **2.0.0**.

## [1.12.1] – 2026-06-29 — Bugfixes: Eingabefokus-Verlust & Dark-Mode-Kacheln

### Behoben
- **Strukturierter Builder – Eingabefokus:** In den Zahlenfeldern des verschachtelten Workout-Editors (Anzahl,
  Distanz, Dauer, Pausen, Pace-Offset) ging der Fokus nach jeder Ziffer verloren — man musste nach jeder Taste
  neu klicken. Ursache: `CountField` und `Row` waren als Funktionen *innerhalb* der `StructureEditor`-Komponente
  definiert und wurden bei jedem Re-render als neuer Typ erkannt → unmount/remount. Behoben durch Anheben auf
  Modul-Ebene mit Callbacks als Props.
- **Dark Mode — neutrale Einheits-Kacheln:** Die Präferenz-Karte (Profil → Block-Präferenzen) zeigte nicht
  markierte Einheiten im Dark Mode auf weißem Hintergrund (`#fff` statt `var(--card)`).

### Geändert
- Keine funktionalen Änderungen; Datensicherheit und Trainingsdaten unberührt.

## [1.12.0] – 2026-06-28 — Strukturierter Workout-Builder (Coros-Style) + Spielraum + Engine-Anpassung

Eigene Einheiten lassen sich jetzt **frei verschachtelt** anlegen (wie bei Coros) — mit **Spielraum** auf den
Wiederholungen, eigenen Pausen und automatischer Anpassung an deine Form. Bibliothek **und** eigene Einheiten
zeigen ihre volle Struktur in einer Tabelle. Additiv, keine Datenbank-Migration.

### Hinzugefügt
- **Verschachtelter Builder:** Segmente und Gruppen in beliebiger Tiefe, z. B. `3×(1000-1000-600-200-200)`. Je Zeile
  Distanz **oder** Dauer, optionaler Pace-Offset zum Anker, eigene Pause; Gruppen mit eigener Satz-Anzahl und Satz-Pause.
  Reihenfolge per ▲▼, hinzufügen/löschen, beliebig schachteln. „Einfach"-Modus (N × Rep) bleibt für simple Einheiten.
- **Spielraum (von-bis) auf der Anzahl:** je Segment/Satz per „±" ein Bereich (z. B. 5–6× oder Satz 3–4×). Die Engine
  wählt den **Tageswert** nach **Phase · Form (TSB) · Fitness · VDOT** (gleiche Mechanik wie die dynamischen Einheiten);
  Pace bleibt als Band sichtbar.
- **Volle Struktur in der Tabelle „Alle Einheiten":** neue **Struktur**-Spalte (von-bis-Kurzfassung) + **aufklappbare
  Detailzeile** mit allen Segmenten/Pausen/Bändern, „heute"-Wert und dem Hinweis „so passt die Engine es an deine Form an"
  — für Bibliotheks- **und** eigene Einheiten, gerendert mit deinen echten Zonen.

### Geändert
- **Einheitliches Modell & Engine:** Bibliothek und eigene Einheiten teilen denselben Renderer; die TSS-/Dauer-Schätzung
  des Builders kommt aus genau diesem Renderer (eine Quelle der Wahrheit).

## [1.11.1] – 2026-06-28 — Bugfixes & Klarstellungen

Kleine, sichere Folge-Politur nach v1.11.0 — keine neuen Features, kein Eingriff in Trainingslogik/Daten.

### Behoben
- **Intervall-Trend – Legende:** Ein-/Ausblenden je Kategorie funktioniert wieder (eine Regression aus dem Rolling-Mittel
  von v1.11.0). Ein Klick schaltet jetzt **beide** Serien der Kategorie gemeinsam — gedämpfte Rohpunkte **und** die
  7-Tage-Mittel-Linie.
- **Layout-Modus – Höhe:** Chart-Kacheln lassen sich nun auch **in der Höhe** anpassen (vorher nur Breite). Diagramme
  folgen generisch der Kachelhöhe.

### Geändert
- **Dark Mode (gezielt):** Wochentag-Tabs im Tracking und die Power-Zonen-Pills bei „Lauf-Power" (Bestzeiten) sind jetzt
  sauber dunkel gethemt und lesbar; Hell-Modus unverändert, Druck bleibt hell.
- **Methodik – Klarheit:** Ausklappbarer Hilfetext „Was bedeuten diese Werte?" + Tooltips erklären, warum „CS" an
  mehreren Stellen unterschiedliche Zahlen zeigt — **Absolutwert** (Marker, 14-Tage), **Δ CS** (Veränderung je Block)
  und **vorher → nachher** (Abschnitts-Auswertung) messen bewusst Verschiedenes.

## [1.11.0] – 2026-06-28 — Diagnostik, Methodik-Korrektheit, dynamische Einheiten & Premium-Feinschliff

Großes Inhalts-Update nach der Premium-Politur: wissenschaftlich fundierte **Laktat-Diagnostik**, eine **korrigierte und
transparentere Methodik** (N-of-1), **dynamische Trainingseinheiten** mit sichtbaren von-bis-Bändern sowie viel
**Chart-/Dark-Mode-Feinschliff**. Alles datensicher (keine Migrationen nötig), barrierearm und druckfest.

### Hinzugefügt
- **Laktat-Diagnostik:** ausführliche wissenschaftliche Begründung je Schwelle (FatMax, LT1, 2 mmol, LT2, 4 mmol/OBLA —
  Physiologie **und** Methode/Quelle, ausklappbar); x-Achse umschaltbar **min/km ↔ km/h ↔ Watt**; Watt-Eingabe für
  Rad-Tests; Marker-Beschriftung innerhalb des Plots.
- **Methodik – Marker-Verläufe:** Mini-Sparklines für CS, VDOT, Schwelle, Entkopplung und eff. VO₂max (aus bestehenden
  Trend-Daten), global **abschaltbar im Footer**; zusätzlich CTL/ATL/TSB-Sparklines im Dashboard-Form-Überblick.
- **Methodik – Periodisierungs-Transparenz:** Klartext, warum das Z1/Z2/Z3-Ziel aus der Saison-Phase folgt
  (Base/Belastung → pyramidal, Race-Specific → polarisiert, Taper → regenerativ) **+ manueller Override pro Phase**.
- **Wochenplanung – dynamische Einheiten:** rohe Einheiten mit **von-bis-Wiederholungen** + empfohlenem Tageswert
  („heute: N") und **Pace-Band**; additive, gedeckelte Anpassung an **Phase · TSB · Fitness · VDOT** mit „angepasst"-Notiz.
- **Intro:** animierter Läufer joggt entlang der Form-Kurve und endet im echten App-Icon (GSAP-gegated, skippbar).

### Behoben
- **Methodik – Passive Inferenz (Rechenfehler):** Auswertung auf **zusammenhängende Regime-Blöcke** umgestellt —
  korrekte Wochenzahl (+ Blockanzahl) und Δ-CS als Block-Start→Ende statt überlappender Wochenpaare (Behebung des
  „16-Wochen"/Δ-CS-Problems). Konfidenz folgt jetzt den unabhängigen Blöcken.
- **Charts im Dark Mode:** Intensitäts-Verhältnis und Jahres-Marker sind sichtbar/theme-fähig; PB-Dreiecke nicht mehr
  am Rand abgeschnitten.

### Geändert
- **Dark Mode durchgängiger:** Inputs, Modals, Tabellen und Popover über Tokens; **A4-Druckvorschau im Dark Mode dunkel**
  gethemt, echter Druck bleibt erzwungen hell.
- **Tabellen:** globale, theme-fähige `.table`-Politur (Zebra, Sticky-Header, rechtsbündige Zahlen).
- **Schwellen-Trend:** Legende ergänzt (lila = Critical Power) + Plot-Beschriftung; Jahres-Dreiecke ~30 % kleiner,
  PB-Dreiecke erklärt.
- **Y-Achsen:** smartere „nice"-Skalierung mit etwas Polster; **Intervall-Trend** mit 7-Tage-Rolling-Mittel über
  gedämpften Rohwerten.
- **Wochenplanung:** Kennzahlen zählen sanft hoch (Count-up).

## [1.10.0] – 2026-06-28 — Premium-Politur: Dark Mode, Motion, Signature-Hero, Chart-Veredelung & Delight

Großes Veredelungs-Update der Oberfläche — aus dem soliden, analytischen RunLog wird ein **premium, klinisch-edles**
Produkt, ohne den seriösen Charakter zu verlieren. Aufbauend auf dem neuen **Design-Fundament** (Tokens, gruppierte
Navigation, Seiten-Hierarchie, einheitliche Chart-Grammatik) kommen ein **Dark Mode** („Performance-Lab"), ein
zentral abschaltbares **Motion-System**, ein **Signature-Hero** am Dashboard, **dezent veredelte Charts** und ein paar
geschmackvolle **Delight-Momente**. Alles barrierearm (`prefers-reduced-motion` + globaler Aus-Schalter); die
Druck-Sicht (Wochenbericht) bleibt unberührt — immer hell und statisch.

### Hinzugefügt

**Design-Fundament**
- **Design-Tokens** als einzige Quelle für Farben/Abstände, **gruppierte Navigation** (Heute · Planen · Tracken ·
  Analysieren · Lernen + Einstellungen), klarere **Seiten-Hierarchie** und eine **einheitliche Chart-Grammatik**
  (gemeinsame Tooltip-/Achsen-/Gitter-Stile).

**Dark Mode („Performance-Lab")**
- **Auto (System) · Hell · Dunkel**, umschaltbar im Sidebar-Fuß; Wahl bleibt gespeichert.
- **Theme-fähige Charts:** Tick-/Gitter-/Tooltip-/Serien-Farben kommen aus CSS-Variablen statt fixer Hex-Werte —
  Diagramme bleiben in beiden Modi gut lesbar. Druck wird stets hell erzwungen.

**Motion-System**
- **Zentrale, gegatete Helfer** (`useMotion`/`useCountUp`/`useReveal`/Draw-on): jede Bewegung läuft nur, wenn
  Animationen an sind **und** das System keine reduzierte Bewegung verlangt — sonst sofort der Endzustand.
- **Einstellungen:** Schalter „Animationen" (an/aus) + „Theme"; Default lebendig, 60-fps-budgetiert (nur transform/opacity).

**Micro-Motion**
- **Zahl-Tweens** für KPIs (CTL/ATL/TSB/Ramp/VO₂max, Bestzeiten, Wochenbericht-Kopf), **Draw-on** für Linien/Flächen,
  **gestaffeltes Einblenden** von Karten beim Seitenwechsel, dezente **Hover-/Press**-Mikro-Interaktionen.

**Signature-Hero — „Form-Ribbon"**
- Oben am Dashboard ein fließendes **CTL/ATL/TSB-Band** der letzten ~6 Wochen mit Draw-on und großen Live-Kennzahlen;
  reduced-motion → statisch.

**Chart-Veredelung (dezent)**
- Sanfte **Verläufe/Glow** (PMC-Fläche, Schwellen-Trend, Wellness-Normalbereich-Bänder), **feinere Achsen** und
  **PB-Marker** auf der PMC-Zeitachse (dezente Wimpel mit Hover-Detail; Dashboard · Langzeit · Wochenbericht).

**Delight — Celebrations, Intro & Easter Eggs**
- **Celebrations** bei echten Erfolgen — neue Bestzeit · geschlagene Wunschzeit · Konsistenz-Streak (4/8/12/26/52
  Wochen) · abgeschlossener Trainingsblock — als dezenter, schließbarer Glanz-Moment (Queue, reduced-motion-treu).
- **Cineastischer Intro** beim App-Start (Brand- + „Form"-Reveal), skippbar, reduced-motion → übersprungen.
- **Easter Eggs (subtil):** Tageszeit-Begrüßung + „Lauf"-Akzent am Logo · **Vier Jahreszeiten auf den Graphen**
  (Winter: Schnee + Skifahrer auf der Form-Kurve · Frühling: Blüten · Sommer: Sonne & Wellen · Herbst: Blätter) ·
  **Lab Mode** (Konami-Code → Lifetime-Kennzahlen mit Erdumrundung/Everest) · **Ghost-PB** (Doppelklick im
  Prognose-Chart blendet die eigenen Bestzeiten als Benchmark ein).

### Geändert
- Recharts-Diagramme beziehen ihre Farben durchgängig aus theme-fähigen CSS-Variablen (statt fester Hex-Werte).
- Wellness-Normalbereich-Bänder mit weichem Gradient statt flachem Fill; Theme-Umschalter zieht in den Sidebar-Fuß.

### Technik
- Neuer **read-only** Endpoint `GET /api/overview` (Lifetime-Summen je Profil für Lab Mode) — additiv, keine
  Datenbank-Änderung, keine Schreibvorgänge.

## [1.9.0] – 2026-06-27 — Plan rund ums Rennen, optimale Zonen, UI-Politur, Lern-Tutorial & Erweiterbarkeit

Fünf-Phasen-Update aus der ToDo-Liste: der Trainingsplan wird **um das Rennen herum vollständig** (echtes Rennen
am Renntag + adaptive Erholung danach), die **Plan-Erfüllung ordnet Aktivität ↔ Einheit korrekt zu**, das Training
passt sich auf Wunsch an **HRV/Schlaf** an, **optimale Zonen** (Pace/HF/Watt) werden sportwissenschaftlich berechnet,
die **Oberfläche wirkt deutlich polierter** (fixierte Hilfe-/Bearbeiten-Leiste, Wochen-Header mit Form), ein
**interaktives Lern-Tutorial + Glossar** führt durch die echten Marker, und **eigene Einheiten + ein Rad-Ziel**
machen den Plan erweiterbar.

### Hinzugefügt

**Trainingsplan rund ums Rennen**
- **Echtes Ziel-Rennen am Renntag:** In der Race-Week steht statt einer generischen Einheit das tatsächliche
  Rennen (Distanz, Zielpace, geschätzte Renn-TSS) am korrekten Renntag.
- **Adaptive Erholung nach dem Rennen:** Der Plan endet nicht am Renntag — es werden so lange Recovery-Wochen
  angehängt, bis die Form (TSB) wieder in einem sicheren Band ist. **Distanzabhängig:** Marathon → mehr/tiefere
  Erholung (≈ 3 Wochen), Halbmarathon ≈ 2, 5–10 km ≈ 1 Woche; PMC-gesteuert, damit der Wiedereinstieg nicht ins
  Verletzungsrisiko führt.

**Plan-Erfüllung korrekt zugeordnet**
- **Robustes Auto-Matching** Aktivität ↔ geplante Einheit (Datum + Typ/TSS/Dauer-Best-Match) — falsche
  Niedrig-Prozente (z. B. eine Recovery-Runde auf eine harte Einheit gerechnet) entfallen.
- **Manuelle Überschreibung** je Aktivität im Tracking („Gehört zu geplanter Einheit") — die Auto-Zuordnung lässt
  sich pro Lauf gezielt korrigieren. Plan-% erscheinen jetzt auch für automatisch gematchte (Strava-)Aktivitäten.

**Readiness-Anpassung (beratend)**
- Bei schwachen HRV-/Schlaf-Werten schlägt RunLog vor, die **nächste harte Einheit** (heute … +3 Tage) zu
  entschärfen bzw. eine Recovery-Einheit zu wählen — 1-Klick-Übernahme, nie automatisch. Eigene Karte in der
  Wochenplanung mit Readiness-Status + nächster harter Einheit.

**Optimale Zonen (Pace/HF/Watt)**
- **Berechnung aus etablierten Modellen:** Pace aus VDOT (Daniels) bzw. Critical Speed · HF aus LT1/LT2
  (Laktattest bevorzugt, sonst %LTHR/Friel aus LTHR bzw. Max-HF) · Watt aus Critical Power (%CP).
- **Dashboard-Übersichtskarte** (Pace · HF · Watt nebeneinander, mit Quelle je Achse) + Knopf „Als aktives
  Zonen-Set übernehmen" (Vorschlag-Modus, manuelle Zonen bleiben erhalten).
- **Langzeit-Schwellen-Trend:** Schwellen-Pace und Critical Power über die Zeit als verschieb-/ausblendbare Kachel.

**UI-/UX-Politur**
- **Fixierte Aktionsleiste:** „Layout bearbeiten" + „Hilfe & Tipps" teilen sich eine am Viewport-Boden klebende,
  nicht druckende Bande — kein Scrollen, auf jeder Seite gleich.
- **Wochen-Header mit Form:** Fitness (CTL) · Ermüdung (ATL) · Form (TSB) + CTL-Ramp + Mini-CTL-Sparkline der Woche.
- **Wochenbericht-Kopf:** aktuelle VO₂max (VDOT-basiert) prominent + darunter die Veränderung zur Vorwoche (Δ, grün ↗/rot ↘).
- **Präferenzen-Picker neu:** Schwerpunkt als prominentes Segmented-Control; Lieblings/Vermeiden in einem
  aufgeräumten Panel mit Familie-Tabs + Suchfeld und klaren ♥/⊘-Toggles.

**Lern-Tutorial & Glossar**
- **Lern-/Glossar-Seite („🎓 Lernen"):** alle Kennzahlen mit Bedeutung, **Richtwerten** (TSB-Bänder, CTL-Ramp,
  PI ≥ 2, Entkopplung < 5 %, CP/W′ …) und ihrem Zusammenspiel — zum Nachschlagen.
- **Coachmark-Tour:** seitenübergreifende geführte Tour, die echte Marker hervorhebt (PMC · optimale Zonen ·
  Wochen-Form · Readiness · Lauf-Power · Schwellen-Trend · Methodik) und ihre Bedeutung erklärt. Auto-Start beim
  ersten Tutorial-Besuch, jederzeit per Knopf neu startbar; robuster Fallback, wenn ein Element fehlt.
- **Tutorial-Daten stimmig:** geplante Einheiten mit km je Zone, Aktivitäten mit Zonen-km, Wochen-Checks der
  abgeschlossenen Wochen passend abgehakt, heutige Wellness für die Readiness.

**Eigene Einheiten & Rad**
- **Eigene Einheiten:** Coach-Formular (Struktur eingeben) → die App schätzt **Familie/Anstrengung/TSS** vor →
  anlegen. Als ♥ markiert erscheinen sie im Wochen-Vorschlag; sie laufen durch denselben Renderer wie die
  Bibliothek (Intervalle, Pace-Bereich, HF, Zonen-km). Profil-scoped, überschreiben nie die Bibliothek.
- **Rad-km-Wochenziel:** optionales Rad-km-Ziel je Woche (Saisonplan + Wochenplanung) inkl. Anzeige „Rad X / Ziel Y km".

### Geändert
- Die optimalen Pace-Zonen verankern die Endurance-Zone (Z2) an der Easy-Pace (statt Marathon-Pace) — praxisnähere,
  breitere Zonen.
- Die Seiten-Hilfe wandert von einzelnen Buttons je Seite in die gemeinsame fixierte Aktionsleiste.

### Datenbank (additiv)
- `season_weeks_v2.target_km_bike` (Rad-km-Ziel) und neue Tabelle `custom_workouts` (eigene Einheiten je Profil).
  Beides additiv — Bestandsdaten unberührt.

## [1.8.0] – 2026-06-27 — Polish-Release: Aufgeräumte Analytik, Coach-Variation, Tutorial-Onboarding & Watt-Analytik

Großes Polish-Update in vier Bausteinen: die Oberfläche wird aufgeräumt und entwirrt, der Trainings-Vorschlag
bekommt deutlich mehr sportwissenschaftliche Abwechslung, ein vollständiges Tutorial-Profil + Seiten-Hilfe
führen neue Nutzer ein, und die Lauf-Watt werden tiefer ausgewertet (Ökonomie + anaerobe Reserve).

### Hinzugefügt

**UX-Rationalisierung & Polish**
- **Klare Seiten-Rollen + Captions:** Dashboard = Status heute · Langzeit = Jahres-Trends · Wochenbericht =
  diese Woche. Jede Seite trägt eine Rollen-Zeile; doppelte Darstellungen sind entwirrt.
- **Konfidenz-Pattern (`ConfidenceBadge` + `ExpertDetails`):** unsichere/explorative Werte (eff. VO2max,
  N-of-1) stehen hinter „Experten-Details" mit Konfidenz-Badge — die Hauptansicht zeigt nur robuste Kennzahlen.
- **Bestzeiten modular:** PB-Tabelle, VDOT/VO2max, Race-Prognose und Power sind verschieb-/ausblendbare Kacheln
  (wie das Dashboard, `EditableGrid`).
- **Profil aufgeräumt:** Bereichs-Navigation (wie die Auswahllisten) — Athlet · Zonen & Schwellen ·
  Verfügbarkeit & Block-Präferenzen · Leistungstests · Profile/Accounts.

**Coach-Variation**
- **8 neue, sportwissenschaftlich kuratierte Einheiten:** Fartlek (strukturiert + nach Gefühl), Schwellen-Ladder
  (2000-1000-600-400), Cut-down-1000er, Mixed 1000+400, gebrochener Tempolauf, lange Bergintervalle (3–4'),
  Renntempo-Float. Neues **mehrsegmentiges Workout-Modell** (gemischte Distanzen + progressiv schnellere Reps),
  TSS-neutral zum bestehenden Modell.
- **Coach-Matrix Distanz × Niveau:** Einsteiger bekommen einfache gleiche Reps, Fortgeschrittene Ladder/
  Cut-down/Mixed; die Auswahl ist distanzgerecht (5–10k VO2/Renntempo · HM/M Renntempo-Blöcke + Float).
- **Block-Präferenzen (Profil):** Schwerpunkt (Schwelle/VO2/Berg/Norwegian/Fartlek) + Lieblings-/Vermeiden-
  Einheiten. Die Engine gewichtet **beratend** und **phasengerecht** — Periodisierung + Erholungsregeln bleiben verbindlich.

**Tutorial & Hilfe**
- **Tutorial-Profil:** beim ersten Start wird ein eigenes Profil „Tutorial" mit einem kompletten, erfundenen
  Beispieljahr („Alex Demo", 10-km-Fokus) angelegt — Phasen, alle Einheitstypen, Wettkämpfe mit Splits,
  Wellness, Laktattest, Wunsch-Zielzeit. Zum gefahrlosen Ausprobieren aller Funktionen; idempotent,
  neu erzeugbar/löschbar im Profil; strikt auf eigenem `profile_id` (echte Daten unberührt).
- **Seiten-Hilfe:** dezenter „!"-Button unten auf jeder Seite erklärt die Diagramme + verlinkt die Anleitung.
- **Methodik-Einführung:** ausklappbare Intro-Karte + geführte Onboarding-Tour beim ersten Besuch.

**Watt-Analytik (relativ zu deinen Coros-Watt)**
- **Running Effectiveness:** Lauf-Ökonomie als Speed pro Watt (masseunabhängiger Trend) — wird die gleiche Pace
  mit weniger Watt erreicht?
- **W′-bal im Intervall (Skiba):** Verlauf der anaeroben Reserve W′ über eine Einheit (Entleerung über CP,
  exponentielle Erholung darunter), aus der Intervall-Struktur + CP rekonstruiert — zeigt, ob die Pausen reichen.

### Geändert
- **Intensität entwirrt:** der ATL/CTL-„Intensity-Trend" heißt jetzt **„Last-Trend (ATL/CTL)"** (klar als
  Last-Kennzahl, nicht Zonen-Intensität). Leit-Intensität ist die **Zeit-in-Zone** + Polarisierungs-Index;
  der Typ-Donut ist als ergänzende Sicht gekennzeichnet.

### Datenbank
- **Keine Schema-Änderung.** Block-Präferenzen liegen im Availability-Setting (JSON); das Tutorial-Profil nutzt
  ausschließlich bestehende Tabellen auf einem eigenen `profile_id`.

### Hinweise
- Das **Tutorial-Profil** erscheint im Profil-Umschalter (zum Ansehen darauf wechseln). **Watt-Analysen**
  brauchen Watt-Daten (CP) — im Tutorial sofort, sonst nach dem Power-Backfill der Strava-Syncs.

## [1.7.0] – 2026-06-26 — Adaptive Pace-Progression, Zielzeit-Steuerung & Lauf-Power

Großes Coach-Update in drei Bausteinen: Trainings-Paces wachsen mit deiner projizierten Fitness Richtung
Wunsch-Zielzeit, das Scheduling schützt die Erholung, und Coros-Laufwatt werden Stryd-artig ausgewertet.

### Hinzugefügt
- **Wunsch-Zielzeit + Soll/Ist-Abgleich:** Am Ziel-Rennen lässt sich eine Wunsch-Zielzeit eintragen
  (`races.goal_time_s`). Eine Gap-Karte in der Wochenplanung zeigt Prognose vs. Wunsch, die nötige Progression
  (VDOT/Woche) und eine Machbarkeits-Ampel (machbar / sehr ambitioniert mit realistischer End-Prognose).
- **Adaptive, projizierte Paces:** Eine Fitness-Projektion (`projectVdot`, gedeckelt auf ~0,4 VDOT/Woche)
  interpoliert von heute Richtung Ziel-VDOT. Die Block-Einheiten ankern ihre Paces je Woche an der projizierten
  Fitness (Daniels-Paces E/M/T/I/R) — die Intervall-Tempi **wachsen Woche für Woche** Richtung Zielpace, statt
  auf der heutigen Prognose einzufrieren.
- **Live-Resolution gelockter Einheiten:** Übernommene Block-Einheiten speichern ihre Intention
  (`planned_sessions.prescription`); beim Anzeigen werden Pace/HF aus aktueller + projizierter Fitness **neu
  berechnet** — eine in 8 Wochen geplante Einheit zeigt automatisch das dann passende (schnellere) Tempo.
  Manuelles Bearbeiten „pinnt" die Einheit (keine Live-Anpassung mehr).
- **Lauf-Power (Coros via Strava, Stryd-Stil):** Laufwatt werden aus den Strava-Streams erfasst → Normalized
  Power je Lauf + Power-Duration-Kurve (`activities.run_np`, `power_curve`). Daraus **Critical Power** (2-Param
  CP/W′-Fit), **%CP-Power-Zonen** (Stryd-nah) und **RSS** (Running Stress Score) sowie eine Power-Sektion in der
  Bestzeiten-Seite (CP-Wert, Power-Kurve, CP-Trend, Zonen, RSS-Liste). Intervalle zeigen optional ein
  **Watt-Ziel** neben Pace/HF. Hinweis: Coros-Watt sind gerätespezifisch → Werte relativ zu deinen Coros-Watt.
- **Profil:** Berglauf-Tag, Stabi/Core-Frequenz und bevorzugte Core-Tage in der Verfügbarkeit.

### Geändert
- **Scheduling — Erholung zuerst:** Zwei harte Einheiten liegen **nie** an Folgetagen; passt nichts spacing-
  konform, wird eine Qualität automatisch zu Easy abgestuft (+ Begründung). **Stabi/Core** wird an Easy-Tage
  gehängt; der **Berglauf-Tag** wird bevorzugt belegt.
- **Doppel-Schwelle = zwei Einheiten:** Norwegian-Doppeltage erscheinen jetzt als **zwei** Einheiten am selben
  Tag (AM 6'-Reps + PM 400er) statt einer kombinierten — je eigene Pausen; der Tag zählt als ein harter Tag.
- **Aerobe Entkopplung = GAP, nur gleichmäßige Läufe:** Die Entkopplung nutzt jetzt die steigungs-adjustierte
  Geschwindigkeit (statt roher Pace) und wird nur für Easy/Long/Steady berechnet (Intervalle ausgeschlossen).
- **Einheiten füllen die Felder:** Vorgeschlagene Einheiten schreiben ihre Werte (km je Zone + Intervalle) jetzt
  in die **editierbaren Felder** des „Einheit bearbeiten"-Dialogs, nicht nur in die Beschreibung (TSS-neutral).
- **Wochenphasen aus dem Block-Vorschlag:** Beim Übernehmen wird die abgeleitete Phase mitgesetzt; ein Knopf
  „Phasen übernehmen" schreibt alle Phasen des Vorschlags (manuell gesetzte Phasen bleiben).

### Datenbank (additiv)
- `races.goal_time_s`, `planned_sessions.prescription`, `activities.run_np`, `activities.power_curve`.

### Hinweise
- **Lauf-Power** füllt sich erst über die Strava-Syncs — Watt-Streams werden budget-schonend nachgezogen
  (Läufe ≥ 10 min). **Adaptive Paces** brauchen eine Wunsch-Zielzeit am Ziel-Rennen + genug Bestzeiten für ein VDOT.

## [1.6.2] – 2026-06-24 — N-of-1-Inferenz-Performance & Renntempo nach Zieldistanz

Zwei Folge-Fixes: der Wochen-/Block-Vorschlag lädt deutlich schneller, und das vorgeschlagene Renntempo
richtet sich nach deiner Zieldistanz.

### Geändert / Behoben
- **N-of-1-Inferenz-Performance:** `buildMethodInference` rechnete je Woche einen **vollen** Marker-Snapshot
  (überlappende 42-Tage-DB-Fenster, Laktat-Interpolation, EF, Decoupling, Physio-Zonen) — gebraucht wurden nur
  CS/VDOT. Jetzt: **ein** Daten-Load + leichte Rolling-CS (`rollingCsVdot`) + **In-Memory-Cache** (invalidiert
  bei jedem Schreibzugriff). Ergebnisse **identisch**, aber der Block-/Wochen-Vorschlag lädt um ein Vielfaches
  schneller (zweiter Aufruf aus dem Cache ~sofort).
- **Renntempo nach Zieldistanz (Daniels VDOT):** Die Race-Specific-Einheiten ankern das Renntempo jetzt an der
  **Zieldistanz des angesteuerten Rennens** (`races.distance_m`) — via VDOT-Prognose individuell (5k schneller,
  Marathon langsamer). Neue Vorlagen **`race_pace_long`** (3–4×2–3 km für HM/Marathon) und **`long_mp_segments`**
  (Longrun mit Marathon-Pace-Blöcken). Die **Race-Specific-Auswahl** passt sich der Distanz an: ≤10k → VO2-lastig;
  HM → Schwelle + Renntempo-Blöcke; Marathon → Schwelle/MP-lastig mit MP-Longrun, VO2 reduziert. Ohne Renn-Eintrag
  bleibt das bisherige CS-Verhalten.

## [1.6.1] – 2026-06-24 — Trainings-Einheiten-Bibliothek (Variety-Engine), VO2max-Gate & HTML-Cleanup

Der automatische Block-Vorschlag erzeugt jetzt **echte Abwechslung** statt immer „3×12' Threshold". Neue,
sportwissenschaftlich fundierte Einheiten-Bibliothek (Daniels T/I/R · Bakken/Casado Norwegian-LGTIT · Seiler ·
Billat · neuromuskuläre Hügelläufe), aus der die Engine je Phase **rotierende + progressive**, **fitness-
skalierte** Einheiten wählt — mit Pace-**Bereich** (verankert an LT1/LT2/CS) + HF-Spanne + Pausen-Empfehlung.

### Hinzugefügt
- **Einheiten-Bibliothek (`server/workouts.ts`, neu, pure):** ~23 Vorlagen mit Metadaten (Familie, Phase,
  Anstrengung 1–5, Nutzen, Synergie, Quelle) — LT1 (kont./Reps), LT2 (Tempo, Cruise, 1000er, Norwegian 400er,
  Sub-T-6'-Reps, **Doppel-Schwelle AM+PM**), VO2max (3', 4–5', 1000er, 400er, Billat 30/30), Berg (Sprints,
  Hügel-Reps kurz/lang), Speed (R-Pace-Reps, Steigerungen), Renntempo, Easy/Long (inkl. Fast-Finish).
- **`fitnessLevel()`** (CTL/CS → low/mid/high) skaliert die Wiederholungszahlen — z.B. **20–25×400 nur bei
  hoher Fitness**, weniger bei niedriger.
- **`pickWeekWorkouts()`** komponiert die Woche je Phase + **rotiert** die Qualitäts-Slots Woche für Woche;
  **Doppel-Schwellen-Tage** in Build/Belastung, wenn das Verfügbarkeitsprofil Doubles erlaubt.
- **`renderWorkout()`** rendert mit **Pace-Bereich** (Anker LT1/LT2/CS ± Fenster) + **HF-Spanne** (aus den
  Zonen) + **Pausen** (Dauer + Trab/Stehen) je Intervall. Berg = Aufwand + HF (keine Pace). Hybrid: Reps
  fitness-/progressionsbasiert, Easy/Long gleichen die Wochen-TSS-Differenz aus.
- **Block-Verdrahtung (`blockPlan`):** Phasen-Progression über `phaseProgress`; Routen reichen aktuelle
  **CS-Pace** + **HF-Zonen** in die Zonen-Eingabe. `concretizeSession` bleibt als Fallback (Einzel-Vorschlag/Coach).

### Geändert / Behoben
- **Effective-VO2max-Gate:** nur noch Läufe **> 30 min** UND gleichmäßige Typen (Dauerläufe + kontinuierliche
  Tempo/Schwelle; **Intervalle/VO2/Berg/Race raus**) — die submaximale HF↔Pace-Schätzung gilt nur für stetige
  aerobe Läufe. Nach dem Update **„TSS neu berechnen"** drücken (Backfill).
- **HTML-Cleanup:** veraltete `client/public/changelog.html` + `readme.html` (Stand v1.1.0, nur sich selbst
  verlinkt) entfernt + die Nav-Links in `usage.html`. Aktuell bleiben Root-`README.html`/`CHANGELOG.html` + `usage.html`.

## [1.6.0] – 2026-06-24 — Methoden-Findung (N-of-1), Periodisierung, Intervall-Pausen & Fixes

Dritter Pfeiler der Meta-Studie: **Methoden-Findung (N-of-1)** — findet mit Koljas eigenen Daten heraus,
welche Trainingsmethode den größten Benefit bringt (geführte Experimente + passive Inferenz). Plus echte
Periodisierung im Block-Vorschlag, Intervall-Pausen-Tracking und vier Fixes. Alles additiv auf v1.5.0,
Vorschlag-Modus, lokal, erklärbar; N-of-1-Grenzen (kleine n, Korrelation≠Kausalität) sichtbar gemacht.
Evidenz: Bakken/Casado et al. 2023 (Norwegian/LGTIT), Casado 2022 (Periodisierung), Treff 2019 (PI).

### Hinzugefügt

**Block N — Methoden-Findung (N-of-1, Flaggschiff)**
- **Marker-Batterie (`markerSnapshot`, `server/analysis.ts`):** pure Funktion über ein Rückblick-Fenster
  (Default 14 Tage). Marker: Critical Speed (Primär), VDOT, Threshold-Pace/HF, aerobe Entkopplung,
  Submax-EF (neuer Helfer `efficiencyFactor` in `load.ts`), Effective VO2max, Laktat-an-Pace (aus Feldtests
  interpoliert), Polarisierungs-Index + Zeit-Verteilung. Maximal aus vorhandener Mathe wiederverwendet
  (`fitCriticalSpeed`/`vdot`/`effectiveVo2max`/`physioTimeZones`/`polarizationIndex`).
- **Vorher/Nachher-Vergleich (`compareMarkers`):** Marker-Deltas + Verdikt aus dem Primär-Marker CS
  (besser/flach/schlechter gegen MCID-Rauschen) + Konfidenz (n + Konsistenz); kleine n als „explorativ".
- **Passive Inferenz (`methodInference` + `classifyWeekRegime`):** bucketet Wochen nach Regime
  (polarisiert/pyramidal/threshold/**Norwegian Double-Threshold**, aus PI + Session-Struktur) und misst die
  vorwärtsgerichtete CS/VDOT-Reaktion über 2–4 Folgewochen. **Strenge Confounder-Kontrolle:** Krank/Taper/
  Race-Wochen raus, nur Paare mit stabiler CTL (|ΔCTL| ≤ 8). Ranking der Regimes + advisory Note.
- **Engine-Kopplung (advisory):** beste Methode nudgt das Verteilungsziel in `weekStructureRecommendation`/
  `blockPlan` sanft Richtung favorisiertes Regime — nur ab Konfidenz ≥ mittel, nie erzwingend.
- **DB:** neue additive Tabelle `method_experiments` (Methoden-Block-Zeiträume). Snapshots on-the-fly.
- **Endpoints:** CRUD `/api/method-experiments`, `/api/method-experiments/:id/evaluation`,
  `/api/markers`, `/api/method-inference`. `block-/week-suggestion` liefern jetzt `methodPreference`.
- **UI:** neue Seite **„Methodik"** (`pages/Methodik.tsx`, Nav) — aktuelle Marker, passive Inferenz-Karte,
  Experiment-Liste/Anlegen, Vorher/Nachher-Auswertung (Tabelle + `charts/MarkerDelta.tsx`).

**Block P — Periodisierung des Block-Vorschlags**
- **`derivePhaseSequence()`:** leitet Phasen rückwärts vom Renntag ab (Base→Belastung→Race-Specific→Race
  Week) + automatische 3:1-Entlastung — **füllt nur leere Wochen, manuelle Phasen übersteuern immer** und
  der Vorschlag passt sich an. 3:1-`weekNo`-Deload aktiviert.
- **Evidenzbasierte Einheiten je Phase:** Base = LT1-Volumen + lockere LT2; Belastung = 2 kontrollierte
  Sub-Threshold-Einheiten (Norwegian, Doppel-Schwellen-Tag) + Long; Race-Specific = VO2max + Renntempo,
  polarisiert; Taper = Steigerungen. Wochen-zu-Wochen-Variation der Schlüsseleinheiten.

**Block I — Intervall-Pausen im Tracking**
- `Effort` um `rest_s`/`rest_type` (Trab/Stehen)/`hr_recovery` erweitert (additiv im JSON). Eingabe im
  `EffortBuilder` (Spalten Pause/Art). Strava `extractWorkLaps` füllt Pause + HF-Erholung automatisch aus
  der folgenden Recovery-Runde.

### Geändert / Behoben (Fixes)
- **F1 Wochencheck-Ampeln:** `--warn` → klares Gelb (passt nicht ganz), `--info`/`.flag.info` → neutrales
  Grau, `--ok` grün (gut), `--danger` rot (Warnung). TSS-Rec-Badge „unter" → neutral, Adherence-Mittelfeld → gelb.
- **F2 Zonen-Plausibilität:** `ZoneSets` warnt, wenn HF/Power nicht je Zone steigen oder Pace nicht je Zone
  schneller wird (Z3 nicht schneller als Z4).

## [1.5.0] – 2026-06-24 — Effective VO2max, adaptiver Coach & Anreicherungs-Fortschritt

Zweiter Pfeiler der Meta-Studie (Intelligenz & Steuerung), Teil 1. Block V (tägliches, am Labor
kalibrierbares Fitness-Signal) + Block S (Coach „Heute" passt die geplante Einheit aktiv an) + D1
(Anreicherungs-Fortschritt in den Einstellungen). Methoden-Findung (N-of-1) folgt als eigenes großes
Update v1.6. Alle Änderungen additiv auf v1.4.0.

### Hinzugefügt

**Block V — Effective VO2max je Lauf**
- **Pro-Lauf-VO2max-Schätzung (V1):** `effectiveVo2max()` in `server/load.ts` — submaximale HF↔Pace
  (Daniels-Laufkosten + %VO2R≈%HRR-Brücke, NGP-basiert). Gate auf stetig-aerobe Läufe (HF-Reserve-Band +
  aerobe Entkopplung). Aggregat-basiert aus gespeicherten Feldern → über die volle Historie backfillbar.
- **Labor-Kalibrierung (V2):** neue additive Spalte `activities.eff_vo2max`; neue Tabelle `vo2max_lab`
  (mehrere Werte über Zeit). Backfill über „TSS neu berechnen". CRUD `GET/POST/PUT/DELETE /api/vo2max-lab`;
  Trend-Endpoint `GET /api/effective-vo2max-trend` (roh + linear zwischen Labortests interpolierte Eichung).
  Athlete-Feld `hr_rest` (Ruhe-HF) für die HF-Reserve.
- **UI (V3):** Karte „Effective VO2max je Lauf" in Langzeit (Schätz-Trend + Labor-Punkte + geeichte Linie);
  Laborwert-Tabelle `Vo2maxLabCard` + Ruhe-HF-Feld in Profil.

**Block S — Adaptiver Coach**
- **`adjustTodaySession()` (S1)** in `server/analysis.ts`: erklärbarer Decision-Tree aus Form (TSB/CTL-Ramp),
  Readiness und Überlastungsrisiko → passt die heutige Haupt-Einheit an (TSS skalieren / harte Einheit
  entschärfen) und re-konkretisiert über `concretizeSession` (Plan-TSS exakt). Vollständige Begründung + Konfidenz.
- **Integration (S2):** `/api/today` liefert jetzt `adjustment`; Coach-„Heute"-Karte im Dashboard zeigt die
  Anpassung geschichtet mit Button „Anpassung übernehmen" (`POST /api/sessions/:id/apply-adjustment`,
  server-autoritative TSS). Konfigurierbarer Gate-Modus (Setting `readiness_gate_mode`, advisory|gate) in den Einstellungen.

**Block D — Anreicherungs-Fortschritt**
- **Doughnut in den Einstellungen (D1):** `GET /api/enrich-progress` (total / Details / Streams je aktivem
  Profil); zwei kompakte Ring-Statistiken „x / Σ" in der Strava-Karte, aktualisiert nach „Details/Splits nachziehen".

### Geändert
- `POST /api/recompute-tss` backfillt zusätzlich `eff_vo2max` aller Läufe (Antwort um `effVo2` erweitert).
- `client/src/lib/api.ts`: Typen `Vo2maxLab`, `EffVo2maxPoint`, `EffVo2maxTrend`, `TodayResult.adjustment`;
  Methoden `vo2maxLabs/addVo2maxLab/updateVo2maxLab/deleteVo2maxLab`, `effVo2maxTrend`, `applyAdjustment`, `enrichProgress`.

### Behoben
- Threshold-Plan-TSS-„Explosion" war eine versehentliche Pace-Zonen-Eingabe (Z4 0:03 statt 3:24) — kein
  Code-Fehler. Diagnose dokumentiert: eine Zonen-Pace nahe 0 lässt `IF²` in `rTssFromZones` explodieren.

## [1.4.0] – 2026-06-23 — Konkreter Mesoplaner, Race-Pacing & tiefere Analytik

Block A (konkreter, tagesgebundener Trainingsplaner), Block B (Race-Pacing mit GAP/Höhenprofil), Block C (4 neue Analytik-Karten). Alle Änderungen additiv auf v1.3.0.

### Hinzugefügt

**Block A — Konkreter Mesoplaner**
- **Verfügbarkeits-/Präferenz-Profil (A1):** neues Formular auf der Profil-Seite (`AvailabilityCard`).
  7 Felder Zeitbudget/Wochentag (0 = Ruhetag), Longrun-Tag, Qualitätstage, Doubles-Option, bevorzugte Double-Tage.
  Gespeichert als Setting-JSON `availability_<pid>` (additiv). Endpoints `GET/PUT /api/availability`.
- **Session-Konkretisierer (A2):** `server/planbuilder.ts` `concretizeSession(type, targetTss, zones)` →
  konkrete Einheit mit `planned_min`, `zone_alloc.byMin`, `efforts`, `description`, `paceTarget`.
  Invertiert exakt die `rTssFromZones`-Mathe — Plan-TSS trifft Ziel auf die Nachkommastelle.
  Easy/Long: Z2-Dauerlauf; LT1: Z3 @ lt1_pace; Threshold: N×12' @ Z4; VO2: N×4' @ Z5; Hill: N×1' @ Z4.
- **Tages-Scheduler (A3):** `scheduleWeek()` in `planbuilder.ts` verteilt Einheiten per Regel auf Wochentage:
  Longrun → `longRunDay`, Qualität → `hardDays` mit ≥48 h Abstand, Easy füllt Trainingstage,
  Doubles nur auf Easy-Tagen wenn erlaubt; Tagesbudget wird auf alle Einheiten aufgeteilt.
  Fallback ohne Profil = Round-Robin (keine Regression).
- **Mesozyklus-Planer bis Renntag (A4):** `blockPlan()` in `analysis.ts` iteriert Wochen bis Renntag
  (aus `races`-Tabelle oder `goal_race`-Woche), wendet 3:1-Deload + Taper an, akkumuliert Plan-TSS
  in PMC-Vorwärtsprojektion für realistische Formschätzung je Woche.
  Endpoint `GET /api/plan/block-suggestion`.
- **Konkrete Engine-Karte & Block-Vorschau (A5):** `WeekPlan.tsx` Button „Wochen-Vorschlag" lädt jetzt
  VDOT `weekSuggestion` + `blockSuggestion` parallel. Engine-Karte zeigt konkrete Einheiten mit
  Wochentag · Dauer · Ziel-Pace · Beschreibung. „Übernehmen" schreibt `zone_alloc/efforts/planned_min`
  (nicht mehr nur type+tss). Neue **Block-Vorschau** zeigt alle Wochen bis Renntag mit selektivem
  „Woche übernehmen" — strikt additiv, bestehende `planned_sessions` unangetastet.

**Block B — Race-Pacing**
- **Pacing-Core (B1):** `server/pacing.ts` `pacingPlan()` verteilt Zielzeit auf km-Splits:
  höhenkorrigiert via Minetti-Gradient-Faktor (wie NGP), optionaler linearer Negativ-Split (+/–f).
  Garantie: `Σ(pace_i × dist_i) == Zielzeit` exakt. Endpoint `GET /api/races/:id/pacing`.
- **Pacing-UI (B2):** Races-Seite: Button „Pacing" pro Wettkampf öffnet `PacingPanel` mit
  Zielzeit-Eingabe, Negativ-Split-Toggle, Split-Tabelle (km · Steigung · Soll-Pace · GAP · kumuliert)
  und Mini-BarChart (Pace je Split, Referenzlinie even_pace).

**Block C — Tiefere Analytik**
- **Durability/Decoupling-Trend (C1):** Zeitreihe der aeroben Entkopplung (Pa:HR-Drift) je Lauf ≥30 min.
  Endpoint `GET /api/decoupling-trend`. Neues EgItem „Aerobe Entkopplung" in Langzeit mit
  Referenzlinie bei 5 % (kritische Drift-Schwelle).
- **Überlastungs-Frühwarnung (C2):** `injuryRiskFlag()` kombiniert ACWR + Monotonie/Strain + CTL-Ramp
  + Readiness-Level zu einem gewichteten Risiko-Score (ok/info/warn/danger). Erscheint in
  `/api/today`-Response; ausbaubar auf Dashboard/WeekReport.
- **Zonen-Histogramm (C3):** Aggregierte Zeit in HF- und Pace-Zonen über den gewählten Zeitraum.
  Endpoint `GET /api/zone-histogram`. Neues EgItem „Zeit in HF- und Pace-Zonen" in Langzeit
  (horizontale BarCharts je Zone). Neues Chart-Modul `charts/ZoneHistogram.tsx`.
- **Fitness-Signale konsolidiert (C4):** CTL (blau, täglich aus PMC) + VDOT (orange, wöchentlich aus
  fitness-trend) in einem `ComposedChart` mit zwei Y-Achsen. Neues EgItem „Fitness-Signale" in Langzeit.

### Geändert
- `client/src/lib/api.ts`: neue Typen `Availability`, `BlockDay`, `BlockWeek`, `BlockPlan`,
  `PacingSplit`, `PacingResult`, `DecouplingPoint`, `ZoneBand`, `ZoneHistogramData`, `FitnessTrend`
  (Import); neue API-Methoden `availability`, `saveAvailability`, `blockSuggestion`, `racePacing`,
  `decouplingTrend`, `zoneHistogram`.
- `WeekPlan.tsx` `applySuggestion`: verwendet jetzt `zone_alloc/efforts/planned_min` aus Block-Plan
  statt abstrakter Verteilung (Fallback auf alte Logik ohne Block-Plan).

## [1.3.0] – 2026-06-23 — Echte Intensitätsverteilung, Laktat-Diagnostik & Wochen-Engine

Zweite Runde der sportwiss. Meta-Studie. G4→G3→Engine-Reihenfolge, alle Blöcke addierend auf v1.2.0.

### Hinzugefügt
- **Echte Zeit-Intensitätsverteilung (G4):** physiologisches 3-Zonen-Modell (Z1 < LT1 / Z2 LT1–LT2 / Z3 > LT2)
  aus `realZoneMin`, kalibrierbar über LT1/LT2-Grenzen. **Polarisierungs-Index (Treff et al. 2019)**:
  `PI = log10((Z1/Z2)×Z3)`, PI ≥ 2.0 = polarisiert. **Phasen-Ziel** (pyramidal/polarisiert/regenerativ)
  als Soll-Band. Neuer Flag `realPolarizationFlag` in „Bewertung der realen Woche" (WeekReport).
  Neue Spalten `zone_sets.lt1_hr/lt1_pace` (LT1-Anker, Default = Z2/Z3-Grenze, von G3 überschreibbar).
- **Laktat-/Feldtest-Diagnostik (G3, Profil-Seite):** vollständige Stufentest-Eingabe (km/h + Pace + HF +
  Laktat + RPE), automatische Berechnung von **LT1** (Baseline + 0.4 mmol/L) und **LT2** (modifizierter Dmax,
  AIS) in s/km und bpm. **Schwellen-Trend-Chart** (min. 2 Tests). **Zonen-Set-Vorschlag** aus LT1/LT2 (verankert
  Z2-Top=LT1, Z4-Top=LT2) — Vorschlag-Modus, du bestätigst via `addZoneset`. Neuer Endpoint `/api/lactate-tests`
  (CRUD + Punkte) + `/api/lactate-tests/:id/propose-zoneset`. Neues Modul `server/lactate.ts` (pure, keine DB).
  Neue Tabellen `lactate_tests` / `lactate_points` (additiv).
- **Wochen-/Block-Empfehlungs-Engine (WeekPlan):** regelbasierter Vorschlag für die Wochenstruktur aus Form
  (TSB/CTL), Saison-Phase, Readiness und Periodisierungs-Modell (Block ≥ traditionell bei Specific). Liefert
  Schlüsseleinheiten + TSS-Anteile + Verteilungs-Ziel + Begründung + Konfidenz. Button „In Wochenplanung
  übernehmen" fügt Einheiten additiv ein (Vorschlag-Modus). Endpoint `GET /api/plan/week-suggestion`.
  `weekStructureRecommendation()` in `analysis.ts`.

### Geändert
- `server/zones.ts` / lokales `effectiveZoneSet` in `index.ts`: LT1-Felder hinzugefügt, Default aus Z2/Z3-Grenze.
- `AnalyzeResult` (api.ts): `physioDist`, `polarizationIndex`, `phaseTarget`, `realPolarizationFlag` ergänzt.

### Datenbank
- `zone_sets.lt1_hr` (REAL, additiv, NULL = Schätzwert aus Z2-Top).
- `zone_sets.lt1_pace` (REAL, additiv, NULL = keine Pace-Schätzung).
- `lactate_tests` (neue Tabelle, profilgefiltert).
- `lactate_points` (neue Tabelle, FK auf test_id).

---

## [1.2.0] – 2026-06-23 — Coach „Heute", Readiness, aerobe Entkopplung & Monotonie/Strain

Erste Runde der sportwissenschaftlichen Meta-Studie (Intelligenz- & Analytik-Pfeiler). Alles regelbasiert/
lokal, erklärbar, Vorschlag-Modus (ändert nie ungefragt).

### Hinzugefügt
- **Coach-Karte „Heute"** (Dashboard, `GET /api/today`): regelbasierte Tages-Empfehlung aus Form (TSB/CTL-Ramp),
  Readiness, Saison-Phase und Wochen-TSS-Ziel — mit **aufklappbarer Begründung** und „In Wochenplanung öffnen".
  Decision-Tree in `dailyRecommendation()` (`analysis.ts`), voll erklärbar (keine LLM).
- **Readiness-Score (advisory):** morgendliche **HRV gegen rollende 7-Tage-Baseline** (z-Score) als Kern, plus
  Recovery/Schlaf/Muskelkater als Modifikatoren → Score 0–100 + Ampel (grün/gelb/rot). Beeinflusst die
  Empfehlung als Hinweis, gated nicht zwingend (Evidenz: HRV-gesteuert ≥ feste Pläne). `readinessScore()`.
- **Aerobe Entkopplung (Pa:HR, Friel):** je Lauf aus dem Velocity-/HF-Stream berechnet (Effizienz Speed/HF
  2. vs. 1. Hälfte), Ampel <5 %/5–10 %/>10 %. Anzeige im Tracking & Wochenbericht. Neue Spalte
  `activities.decoupling`; „Details/Splits nachziehen" füllt den Altbestand budgetiert nach (Läufe ≥ 20 min mit HF).
- **Trainings-Monotonie & -Strain (Foster):** `Monotonie = Ø/SD der Tageslast`, `Strain = Wochenlast × Monotonie`
  → Schild in der „Bewertung der realen Woche" (Infekt-/Übertrainings-Frühwarner). `trainingMonotonyStrain()`.

## [1.1.0] – 2026-06-17 — Editierbares Layout, WYSIWYG-Druck, Motion-System & Auswahllisten-Redesign

### Hinzugefügt
- **Editierbares Grid-Layout (EditableGrid):** Wochenbericht und Langzeit nutzen jetzt `react-grid-layout`
  (v1.5.3) — Kacheln per Drag-and-Drop verschieben und an den Ecken skalieren, Kacheln ausblenden (Auge-Icon).
  Layout pro Seite + Profil in `settings` gespeichert (`GET/PUT /api/layout/:page`).
  Dashboard bleibt weiterhin im kontinuierlichen Modus (kein Paging).
- **WYSIWYG A4-Druck (T9):** Wochenbericht und Langzeit rendern in einem festen A4-Canvas (794 px @ 96 dpi,
  CSS-`transform: scale` für Editor und `@media print`). Was im Editor zu sehen ist, entspricht exakt dem PDF.
  Textgröße einstellbar (60/70/85/100 % als Prozenttaste im Toolbar); pro Seite in `localStorage` gespeichert.
  Overlay-Toolbar (absolute Position) belegt keine Kachelhöhe → kein Clip im Druck.
- **Manuelle Bestzeiten editierbar:** `pb_overrides`-Tabelle (additiv). Neue Taste „+ Manuell" und Inline-
  Bearbeitungszeile; manuelle PBs überschreiben Strava-PBs; löschbar mit ✕. Distanz-Zeit-Diagramm entfernt
  (war redundant neben Race-Prediction-Chart).
- **Intervall-Mini-Tabelle (EffortTable):** Wochenbericht zeigt strukturierte Intervalle als Tabelle
  (Nr., Länge, Zeit, Pace, Ø-HF, max-HF); ab ≥ 6 Intervallen automatisch 2-spaltig nebeneinander.
- **Wellness-Sparklines einzeln verschiebbar (LongTerm):** jede Wellness-Metrik ist ein eigenes EditableGrid-
  Tile → separat positionierbar, größenveränderbar und ausblendbar.
- **Motion-System (T11):** globale CSS Motion-Tokens (`--dur-fast: 250 ms`, `--dur: 500 ms`, `--dur-slow: 1 s`,
  `--ease`, `--ease-out`) in `:root`. Animationen: Seiten-Eintritt Fade+Rise (`route-enter`), Modal Pop-In
  (`modal-pop`), Nav-Aktiv-Gleitstrich (`.nav a::before`), Button-Press (`:active translateY+scale`),
  Input-Border-Transition. `@media (prefers-reduced-motion)` schaltet alles ab; `@media print` deaktiviert
  Route-Animationen.

### Geändert
- **Auswahllisten — Master-Detail-Layout (T11):** Statt 6 gestapelter immer offener Karten jetzt eine
  zweigeteilte Ansicht: **links** eine vertikale Kategorie-Navigation (mit Anzahl-Badge), **rechts** nur die
  aktive Liste mit Cross-Fade beim Kategorienwechsel. Filter-Feld erscheint ab > 4 Einträgen. **Sortierung**
  per Drag-and-Drop (Anfasser ⠿) statt Sort-Zahlenfeld.
- **Plan-% aus SeasonProgress entfernt (T1):** Adherence-Linie/Y-Achse aus dem Saison-Progressions-Chart
  entfernt; Plan-Erfüllung erscheint stattdessen als eigene Zeile „Plan-Erf. %" in der Langzeit-Heatmap.
- **Zwei Dots im Wochentag-Switcher (T2):** Je Tag zwei übereinander — geplanter Dot (Typ-Farbe) und
  getrickter Dot (grün); sofortiger Überblick geplant vs. tatsächlich.
- **Wandern/Allgemein TSS ×0.6 (T3):** Sport `General`/`Other` mit Bewegungszeit bekommen einen
  Dämpfungsfaktor 0.6 auf den berechneten TSS — Hiking ist kein Lauf-/Rad-Stress.
- **Typ-Dropdown nur bei Lauf/Rennrad (T4):** SessionModal zeigt das Typ-Feld nur bei Sport `Run` oder
  `BikeRoad`; andere Sportarten brauchen keinen Einheitstyp.
- **Jahr in Chart-Tooltips (T5):** `fmtDateY` (TT.MM.JJJJ) statt `fmtDate` (TT.MM.) in allen
  Recharts-Tooltips — kein versehentliches Jahres-Verwechseln mehr.
- **Tabellen-Overflow (T10):** Alle Tabellen-Container haben `overflow-x: auto` → kein Layout-Bruch bei
  engen Kacheln.

## [0.15.5] – 2026-06-16 — Dashboard-Umbau, Schlaffenster-Chart & Feinschliff

### Hinzugefügt
- **Schlaffenster-Chart (Whoop-Stil):** neues `SleepWindow.tsx` zeigt pro Tag einen Balken von
  **Bettzeit → Aufwachzeit** (Recharts Floating Bar `[lo, hi]`); Y-Achse als Uhrzeit (Anker 18:00,
  `reversed` → später = weiter unten), Tooltip mit Bett/Auf/Dauer. Ersetzt den alten
  Bettzeit-Abweichungs-Linienplot in Langzeit + Wochenbericht.

### Geändert
- **Dashboard-Layout umgebaut:** Reihe 1 = **PMC (2fr) | Aktuelle Woche (1fr)** nebeneinander; Reihe 2 =
  **Saison-Progression (1fr) | Intensity-Trend (1fr)** auf gleicher Höhe. Vorher: PMC + Intensity-Trend
  full-width übereinander, Saison/Aktuelle Woche darunter.
- **Plan-Erfüllungs-Balkendiagramm entfernt** aus dem Wochenbericht. Stattdessen inline: farbige %-Kachel
  je Tag in der Einheitentabelle (≥ 90 % grün / ≥ 70 % gold / sonst rot) + „Ø Woche …%" in der Überschrift.
- **Bettzeit-Y-Achse invertiert** in Langzeit-Charts und Wochenbericht-Wellness (`reversed: true`): späteres
  Zubettgehen liegt nun unten (schlechter = tiefer — konsistent mit allen anderen Wellness-Trends).
- **VO2max-Sparkline-Hover:** Tooltip zur Mini-Sparkline in `Vo2maxCard.tsx` zeigt Datum + VDOT-Wert.
- **Intensity-Trend Bänder kräftiger:** `fillOpacity` 0.10 → 0.18; grüne gestrichelte `ReferenceLine` bei
  80 % und 149 % (Optimal-Korridor); Tooltip zeigt Wert + Band-Bezeichnung.

## [0.15.0] – 2026-06-15 — VO2max-Kachel, Race-Prediction, Intensity-Trend, TSS-Empfehlung, Fahrrad-Zonen & Bugfixes

### Hinzugefügt
- **VO2max-Kachel (Dashboard):** VDOT-Schätzung nach Daniels-Gilbert aus den besten Lauf-Bestzeiten
  (Rolling-Window 90 Tage). Zeigt aktuelle VDOT-Zahl, Trend-Pfeil (↗/↘/→), farbiges Niveau-Badge
  (Elite/Exzellent/Sehr gut/Durchschnitt/Unter Ø nach ACSM-Normen je Alter+Geschlecht) und eine
  Mini-Sparkline über den Saisonverlauf. Geburtsjahr + Geschlecht im Athletenprofil (`Profile.tsx`,
  wird in `athlete`-Setting gespeichert).
- **Race-Prediction-Diagramm** (`/bests`): 4 Prognoselinien (5k/10k/HM/Marathon) aus dem Critical-Speed-Modell
  über den Saisonverlauf; Y-Achse `reversed` (schneller = oben); Legende klickbar (Distanzen ein-/ausblenden).
- **Intensity-Trend (ATL/CTL-Verhältnis):** neues `IntensityRatio.tsx` zeigt `ATL/CTL × 100 %` mit 5 farbigen
  COROS-Bändern (Decreasing/Resuming/Maintaining/Optimized/Excessive) im Dashboard und der Langzeit-Seite.
- **TSS-Wochenempfehlung:** Ampel-Badge in der Wochenplanung (WeekPlan-Header) mit empfohlenem TSS-Korridor
  aus CTL-Start + Saisonplan-Phase (Aufbau / Erhalt / Entlastung / Race Week / Krank). Berechnet in
  `tssRecommendation()` (`analysis.ts`), über den `/api/analyze/week`-Endpoint geliefert.
- **Fahrrad-HF-Zonen** (ZoneSets): separater Zonen-Set-Abschnitt „HF-Zonen Fahrrad" in den Einstellungen
  (Profil-Seite); „Von Lauf übernehmen"-Shortcut; DB-Spalte `zone_sets.hr_zones_bike` (additiv).
  Strava-Interval-Extraktion nutzt bei Bike-Aktivitäten automatisch die Fahrrad-Zonen.
- **Race aus WeekPlan:** wird eine geplante Einheit als Typ „Wettkampf" gespeichert, legt die App automatisch
  einen verknüpften Race-Eintrag an (nutzt dieselbe `api.addRace`-Logik wie Tracking).
- **Wochentyp-Pill editierbar:** Klick auf die Phase-Pille in der Wochenplanung öffnet ein Inline-`<select>`;
  Phase wird direkt gespeichert.
- **Intervall-Label-Dropdown:** beim Bearbeiten von Efforts ist der Label (LT1/LT2/VO2max) über ein Dropdown
  wählbar statt Freitext.
- **VO2max-Konsolidierung:** Einheitstypen „VO2short" und „VO2long" entfernt; Differenzierung jetzt über den
  Effort-Label (LT2/VO2max). Vorhandene Labels werden beim Start automatisch nachgelabelt.
- **Drag & Copy in der Wochenplanung:** geplante Einheiten lassen sich per Drag-and-Drop auf einen anderen Tag
  verschieben oder per ⊕-Button kopieren.
- **Einheits-Dots mit TSS-Größe:** Punkte im Wochentag-Switcher (Tracking) skalieren mit dem TSS der Einheit.
- **8-Wochen-Mittel + Range:** gestrichelte Referenzlinie und Bereich (± 1σ) der letzten 8 Wochen in den
  Wellness-Sparklines (LongTerm).
- **Auto-Split-Label:** Läufe unter Z4-HF bekommen automatisch „GA1" als Label; Strava-Laps über der Z4-Grenze
  behalten den feineren Label (LT1/LT2/VO2max).
- **Schlaf in hh:mm:** Schlaf-Zeitfelder (Bettzeit, Aufwachzeit) in den Tagesfaktoren zeigen das Eingabeformat
  `h:mm` statt rohe Minuten.
- **Intervall-Trend-Legende togglebar:** Klick auf eine Kategorie (LT1/LT2/VO2) blendet die zugehörige Linie
  im IntervalTrend-Chart ein/aus.
- **PDF-Wasserzeichen:** beim Drucken erscheint „RunLog – Kolja Hildenbrand 2026 ©" unten rechts auf jedem Ausdruck.
- **Neuer API-Endpoint `/api/fitness-trend`:** liefert VDOT + CS-Prognosen (5k/10k/HM/M) je Wochenpunkt über
  einen wählbaren Zeitraum; wird von Vo2maxCard und Race-Prediction-Chart genutzt.

### Geändert
- **Strava-Interval-Overwrite-Schutz:** neue Spalte `activities.efforts_locked` (additiv, DEFAULT 0). Jede
  manuelle Bearbeitung/Löschung von Intervallen setzt `efforts_locked=1`; Strava-Sync überschreibt diese
  Einheiten nicht mehr. Reset-Knopf „↻ Aus Strava neu laden" (nur Strava-Aktivitäten) setzt die Sperre zurück
  und zieht Laps beim nächsten Sync neu.
- **TSS-Farbkodierung (Wochenbericht):** harte Einheitstypen (typeIntensity = „hard") weisen im Realen TSS-Donut
  ihre gesamte TSS dem „hart"-Bucket zu statt zonen-anteilig. Easy- und Moderate-Einheiten bleiben zonen-anteilig.
- **VDOT-Filter** (Bestzeiten): nur Efforts mit distance_m ≥ 1500 und time_s ≥ 180 s fließen in die VDOT-
  Schätzung ein (verhindert Überabschätzung durch kurze Sprints).
- **Athletenprofil-Seite** erweitert: `AthleteCard`-Komponente für Geburtsjahr, Geschlecht, Gewicht, Max-HF
  (gespeichert im `athlete`-Setting, kein Schema-Change).

## [0.14.0] – 2026-06-15 — Geräteneutral, Bestzeiten/Critical Speed, Plan-Erfüllung, Race-aus-Tracking & Tracking-Redesign

### Hinzugefügt
- **Bestzeiten-Menü** (`/bests`, 🏅): persönliche Bestzeiten je Standarddistanz aus Stravas `best_efforts`
  (Distanz · Zeit · Ø-Pace · Datum) plus ein **2-Parameter-Critical-Speed-Modell** (CS-Pace, D′, R²,
  Prognosen 5k/10k/HM/M) mit Distanz-Zeit-Diagramm. Füllt sich über die Strava-Syncs.
- **Plan-Erfüllung (%)**: je getrackter Einheit, wie gut die geplante Einheit umgesetzt wurde —
  zusammengesetzt aus **TSS-Treffer + Zeit in der Ziel-Pace-Zone**. Anzeige je Einheit im Tracking,
  als Balken-Graph im Wochenbericht und als Wochenmittel-Trend im Langzeit.
- **Efficiency Factor je Wochentag** (DL/Longruns) im Wochenbericht (NGP-Tempo ÷ Ø-HF) — mit Markierung,
  wenn am Vortag eine harte Einheit/ein Wettkampf war (Carry-over sichtbar).
- **Race aus Tracking**: ein Lauf mit Typ „Wettkampf" legt automatisch einen verknüpften Race-Eintrag an;
  die **km-Splits** werden beim „Details/Splits nachziehen" aus den Strava-Streams berechnet.
- **Strava-Zonen-Import**: HF-/Power-Zonen + FTP aus Strava als neues Zonen-Set ab wählbarem Datum
  (Profil → HF-Zonen → „Aus Strava holen"). Braucht einmaliges Neu-Verbinden (Scope `profile:read_all`).
- **Tracking-Redesign**: Wochentag-Switcher oben (Farbpunkte je Tag: geplant in Typ-Farbe + grün wenn
  getrackt), Tag/Woche-Umschalter, getrackte Kacheln mit Typ-Farbbalken + „% Plan". „+ Zusätzliche
  Einheit" mit frei wählbarem Datum.
- **Ziel-km direkt in der Wochenplanung** editierbar (gleiche Quelle wie Saisonplan).
- **Automatische Wochen**: immer 2 Zukunftswochen vorhanden; ein neuer Wettkampf legt alle Wochen bis
  zum Renntag an (leeres Gerüst).
- **Strava-Extraktionszeitraum** als Einstellung („Daten ab"-Datum) + ehrliche Rate-Limit-Meldung
  (unterscheidet 15-min- vs. Tageslimit) und Tages-Budget-Bremse (Sync/Enrich stoppen vor dem Tageslimit).
- **Dauer als `hh:mm:ss`** in Tracking und Wochenplanung.

### Geändert
- **COROS-Training-Load entfernt** → die App ist geräteneutral (Garmin/Polar/COROS …): TSS kommt aus
  NGP/NP bzw. Schätzung (manuell überschreibbar). Der COROS-Faktor + das Feld sind weg (DB-Spalte bleibt).
- **Wochenbericht**: PMC + Saison-Progression enden jetzt **an der Berichtswoche** (nicht mehr bis heute+2);
  rechts neben dem PMC ein kompakter Block mit **CTL/ATL/TSB + CTL-Ramp am Wochenende**. Reale Bewertungs-
  Schilder stehen **nebeneinander** (gleich groß); **Commutes je Tag zusammengelegt** (spart Druckplatz).
- **Race-Week-Warnung** bezieht sich jetzt auf die **7 Tage vor dem Renntag** (TSB am Renntag UND geplante
  7-Tage-Last), nicht mehr auf die Kalenderwoche. Neue Schwelle „Race 7d-Last max %".
- **Race-Splits-Eingabe**: Felder für km/Ø-HF/Max-HF verbreitert (3 Ziffern sichtbar).
- **Buttons** app-weit einheitlicher (Hover/Fokus/disabled-Zustände), rein kosmetisch.

## [0.13.0] – 2026-06-14 — Planungs-Feinschliff, Daily-Kategorien & Strava-Details

### Hinzugefügt
- **Vor/Zurück-Pfeile** (← →) neben dem Wochen-Dropdown in Planung, Tracking und Wochenbericht.
- **Tagesfaktoren in Kategorien** (Morgens, Schlaf, Subjektiv, Sonstiges) — als aufklappbare Sektionen im
  Tracking; die Kategorien selbst sind in „Auswahllisten → Tagesfaktor-Kategorien" editierbar, die Zuordnung
  je Feld in „Tagesfaktoren".
- **Strava „Details/Splits nachziehen"**-Knopf in den Einstellungen: holt nur Details, Streams (Zonen/NGP) und
  Intervalle (aus den Laps) für bestehende Aktivitäten — ohne neue zu importieren (budgetiert).

### Geändert
- **Geplante km/Einheiten** in Planung & Analyse werden über den **Datumsbereich** der Woche geladen (statt
  `week_no`) → die „Geplante Woche" stimmt jetzt immer mit dem Tag-Raster überein; alte fehlgeleitete
  Einheiten (falsches `week_no`) verfälschen die Summe nicht mehr.
- **Trainingsplanung**: im Intervall-/Set-Builder werden Ø-HF und Max-HF ausgeblendet (kennt man beim Planen
  noch nicht — Zone reicht). Im Tracking bleiben sie.
- **Profil-Reset** löscht jetzt auch geplante Einheiten, Saisonplan (Ziel-km) und Wettkämpfe — nur die
  HF-Zonen/Schwellen bleiben (mit DB-Backup).

## [0.12.0] – 2026-06-14 — KW-Saisonplan, Sets, Strava-Intervalle, Profil-Menü & konfigurierbare Felder

### Hinzugefügt
- **Trainingsplanung mit Wiederholungs-Gruppen**: Intervalle als Sets wie **3×(1000+200)** statt jede
  Wiederholung einzeln (Coros-Stil) — im EffortBuilder „+ Wiederholungs-Gruppe".
- **Automatische Intervall-Extraktion aus Strava**: beim Sync werden die **Work-Laps** (schneller als Z3 bzw.
  Ø-HF ≥ Z4) als Efforts unter die Einheit geschrieben (nur in leere Effort-Felder, budgetiert).
- **Profil-Seite** (`/profil`): Profile umbenennen/löschen + **Profil zurücksetzen** (löscht alle Trainings- &
  Plandaten: Aktivitäten, Tagesfaktoren, Wochenlogs, geplante Einheiten, Saisonplan/Ziel-km und Wettkämpfe —
  nur die HF-Zonen/Schwellen bleiben; mit DB-Backup) + HF-Zonen/Schwellen je Profil.
- **Konfigurierbare Tagesfaktoren**: in „Auswahllisten" (Rubrik „Tagesfaktoren") mit Feldtyp
  (Zahl/Zeit/Text/Haken/Skala); feste Basis-Felder. Eigene Felder landen in einer JSON-Spalte.
- **Heatmap-Bewertung**: Wochen-Score gold/grün/gelb/orange/rot (% erfüllter Checks); Kategorie-Namen bleiben
  beim Horizontal-Scrollen fixiert.
- **Phasenname im Chart-Tooltip** bei Zonen-Effizienz & Wellness-Verläufen; Jahresmarken erscheinen dort jetzt
  auch ohne Jahres-Wechsel.

### Geändert
- **Saisonplan KW-gesteuert**: nur die **KW** (+ Jahr) ist editierbar, das Datum (Mo–So) wird automatisch
  berechnet und read-only angezeigt. „Beispiel-Saison importieren" entfernt (verhindert Geister-Wochen).
- **Wochenbericht-Layout**: Zonen-Balken und TSS-Donuts je eigene Karte, darunter eine breite Karte mit den
  realen Analyse-Schildern.
- **Tracking-Layout** in logische Blöcke (oben nur Sport/Typ/Name, dann Leistung, dann Körper/Last).
- **HF-Zonen-Eingabe** wie bei Pace: nur die Obergrenze je Zone, die Untergrenze ergibt sich automatisch.
- **OptionsConfig**: Eingabefelder in der Reihenfolge Label → Wert (wie die Zeilen darüber).

### Behoben
- Gelöschte Wochen verschwinden im Saisonplan jetzt sofort (nicht erst nach Reload); beim Löschen einer Woche
  werden ihre geplanten Einheiten mitentfernt, verwaiste Plan-Einheiten werden beim Laden bereinigt.

## [0.11.0] – 2026-06-14 — Chart-Decor, geplant/real-Schilder, Wochen-Checks & Wander-TSS

### Hinzugefügt
- **Jahres-Dreieck + Phasen-Farbband** jetzt auch in den **Langzeit-Charts** (Wellness-Verläufe +
  Zonen-Effizienz) — einheitliche Zeit-Orientierung wie bei PMC/Saison-Progression.
- **Klickbare Effizienz-Legende**: Ø-Pace und Ø-HF lassen sich im „Ø-Pace vs. Ø-HF"-Chart einzeln
  ein-/ausblenden (wie in der PMC-Legende).
- **Einheitstyp beim Tracking** (Dropdown LT1, LT2, VO2max kurz/lang, Longrun …): überschreibt für den
  **Real-Donut** den gematchten Plan-Typ und schärft den Intervall-Trend. Neue Spalte `activities.type`.
- **Konfigurierbare Wochen-Checks**: in „Auswahllisten" (neue Liste „Wochen-Checks") frei definierbar;
  im Wochenbericht abhakbar und in der **Langzeit-Heatmap** (Wochen × Checks) über die Saison getrackt.
- **GAP + Höhenmeter im Tracking-Formular**: GAP neben der Ø-Pace, editierbares Höhenmeter-Feld.
- **Sprung-Icon Wochenbericht ↔ Tracking** (gleiche Woche, beide Richtungen) am Wochen-Selector.
- **Wochenauswahl + Saisonplan als Jahres-Akkordeon**: Wochen pro Jahr (2019…2026) auf-/zuklappbar mit
  sanfter Animation; aktuelles Jahr automatisch offen.

### Geändert
- **Wochen-Schilder geplant vs. real getrennt**: Wochenplanung zeigt die Last- & km-Polarisierungs-Schilder
  aus den **geplanten** Werten, der Wochenbericht aus den **realen** (Bericht behält beide TSS-Donuts).
- **TSS für Wanderungen/Sonstiges** (Sport „Allgemein"/„Sonstiges") jetzt **HR-Zonen-basiert** statt der
  Rad-IF-Schätzung (vorher stark überschätzt); ohne HF niedriger Fixwert-IF, mit Leistung weiter Power-TSS.
  → einmal **„TSS neu berechnen"** drücken, um Altbestand rückwirkend zu korrigieren.
- **Wochentags-Chart**: neue Farb-Semantik (Distanz kühl, Belastung warm) + gruppierte Legende.

## [0.10.0] – 2026-06-13 — Rad-TSS (NP), Bericht-Charts & Anzeige-Feinschliff

### Hinzugefügt
- **Rad-/Rollen-/Commute-TSS nach TrainingPeaks**: `(s·NP·IF)/(FTP·3600)·100` mit **Normalized Power** aus dem
  Strava-Power-Stream (30s-normalisiert). Ohne Powermeter: Dauer×IF-Schätzung nach Typ. COROS-Load nur noch
  informativ. „TSS neu berechnen"-Button deckt jetzt **Lauf + Rad** ab (mit Backup).
- **Wochentags-Chart im Wochenbericht** (links, 1/3) neben der Saison-Progression (2/3): pro Tag km
  (Lauf + Rad×0.25) und rTSS.
- **Höhenmeter + grade-adjusted Pace (GAP)** bei den Einheiten — in Tracking und Wochenbericht (GAP nur Lauf,
  links neben der Ø-Pace; Höhenmeter Lauf + Rad).
- **Zonenverteilung**: Balken füllen die Kachelhöhe + Farb-Legende (Z1–Z6).

### Behoben
- **Krank-Markierung in der Zonen-Effizienz** erscheint jetzt auch für trainingsfreie Krank-Wochen
  (vorher fehlte mangels Datenpunkt der Anker).

### Hinweis
- NP/min-Zone/km-Zone fürs Rad kommen wie bei den Läufen erst beim Strava-Sync herein (budgetiert, ggf. mehrere
  Syncs) → danach „TSS neu berechnen" drücken. Bis dahin Ø-Power-Näherung bzw. Schätzung.

## [0.9.0] – 2026-06-13 — PMC nach TrainingPeaks & running-TSS (rTSS/NGP)

### Behoben / Geändert (PMC)
- **Form (TSB)** jetzt TrainingPeaks-konform: **gestrige Fitness − gestrige Fatigue** (vorher heutige Werte).
- **CTL/ATL aus der vollen Historie geseedet** — Fitness/Fatigue am Anfang jedes Zeitraums sind korrekt
  (vorher startete jede Ansicht bei 0).
- **CTL-Ramp** wird am „heute"-Punkt gemessen (vorher am Ende des in die Zukunft reichenden Zeitraums).

### Hinzugefügt (running-TSS)
- **rTSS** ist jetzt die primäre Lauf-TSS (TrainingPeaks-Formel, COROS-/Garmin-unabhängig). Geplante Läufe:
  per-Zone aus Pace vs. Schwellen-Pace; Aktivitäten: aus NGP, sonst Ø-Pace. COROS-Load bleibt informativ.
- **Strava-Streams für Läufe** beim Import: Minuten/Zone (HF-Stream gegen deine Zonen), km/Zone (Strecke je
  Zone) und **NGP** (Normalized Graded Pace; Minetti-Grade-Korrektur + 30s-Normalisierung) — füllt leere
  Zonen-Felder automatisch (manuelle Werte bleiben), berechnet daraus die genaue rTSS. Budgetiert (Rate-Limit).
- **„Lauf-TSS (rTSS) neu berechnen"** in den Einstellungen (mit automatischem DB-Backup) — rechnet alle Läufe
  + geplanten Lauf-TSS neu; nach Syncs (mehr NGP-Daten) erneut auslösbar.

### Hinweis
- Skala ändert sich ggü. COROS×0.6 → CTL-Zahlen verschieben sich (gewollt). Bis die Streams für den Altbestand
  nachgeladen sind, nutzen alte Läufe Ø-Pace (NGP folgt mit den nächsten Syncs).

## [0.8.0] – 2026-06-13 — Geplant-vs-real-Donuts, Commute & Chart-Feinschliff

### Hinzugefügt
- **Wochenbericht-Intensität:** zwei TSS-Donuts nebeneinander — **Geplant vs. Real** — je mit der TSS-Zahl
  in der Mitte und der Auflistung (easy/moderat/hart). Reale Intensität **hybrid**: zonen-anteilig wo
  Zonen-Daten vorliegen, sonst nach dem Typ der gematchten geplanten Einheit. Der alte km-„Real (Zonen)"-Donut
  entfällt.
- **Commute-Schalter** im Aktivitäts-Formular (bei Radfahrten): setzt Sportart auf „Allgemein/Commute",
  Name auf „Commute", löscht & sperrt die Notizen — kurze Pendelfahrten verstopfen den Wochenbericht nicht
  mehr (zählen aber weiter als Rad-km). Strava-Sync füllt die Notiz nicht wieder (`desc_fetched`).
- **Krank-Hinterlegung** jetzt auch in den Zonen-Effizienz-Charts (Langzeit).
- **Races:** Höhenmeter **pro Split**; das Distanz-km-Feld doppelt so breit.

### Geändert
- **Zonenverteilung** (Bericht): dickere Balken (weniger Weißfläche) + X-Achse in 20 %-Schritten.
- **Jahresmarke** in Saison-Progression/Wochenkm sitzt jetzt **vor KW1** (zwischen KW52 und KW1).
- **„Diese Woche"** in der Saison-Progression als dezente **Wochen-Markierung** statt gestrichelter Linie.

### Behoben
- **Geister-Race-Marker:** goldene Marker kommen nur noch aus der **Races-Tabelle** (nicht mehr aus geplanten
  „Race"-Einheiten/`goal_race`) — ein in Races gelöschter Wettkampf verschwindet zuverlässig.

### Zurückgestellt
- running-TSS nach TrainingPeaks-Formel (COROS-/Garmin-unabhängig) · TrainingPeaks-Artikel auswerten.

## [0.7.0] – 2026-06-13 — TSS-Bewertung korrigiert & Layout-Welle

### Behoben
- **TSS-Donut fachlich korrekt:** Die Intensität einer Einheit kommt jetzt aus dem **Einheitstyp**
  (easy/moderat/hart), nicht mehr aus der TSS-Größe. Vorher wurde ein langer ruhiger Dauerlauf wegen
  hoher TSS als „hart" eingestuft und eine kurze VO2-Einheit als „moderat" — genau verkehrt. TSS ist nun
  nur noch das Gewicht (Anteil der Last je Intensität).
- **Wochen-Last adaptiv:** Vergleich konsistent — in der Planung geplant↔Ø geplant, im abgeschlossenen
  Wochenbericht real↔Ø real (vorher geplant diese Woche ↔ real letzte 4 Wochen, also Äpfel mit Birnen).
- **Races:** Split-Zeiten lassen sich wieder eintippen (vorher setzte das Parsen bei jedem Tastendruck zurück).

### Hinzugefügt
- **Intensität je Einheitstyp** in „Auswahllisten" einstellbar (easy/moderat/hart); neuer Typ
  **„Steady / Tempo"** (moderat). Defaults: Easy/Long = easy, Threshold/VO2/Hill/Race = hart.
- **Races:** Ø-HF je Wettkampf und **Max-HF je Split** (Ø-HF vor Max-HF in Tabelle & Bericht).
- **Wellness-Langzeitbericht:** Krank-Wochen rot hinterlegt (wie in den anderen Charts).
- **Persönliche Daten in `data/`** ausgelagert — beim Update nur diesen Ordner kopieren. Bestehende
  `training.db` wird einmalig sicher übernommen (Original bleibt als `training.db.bak`).

### Geändert
- **Polarisierung** nur noch über **km-in-Zone** (die Zeit-in-Zone-Polarisierungs-Hinweise sind raus).
- **Layout:** Dashboard Wochenkm 2/3 + aktuelle Woche 1/3; Wochenbericht PMC + Saison-Progression über
  volle Breite; PMC & Wochenkm-Charts ~20 % höher; Race-Labels im Vordergrund; Jahreslinie kräftiger;
  Phasenname auch im Wochenkm-Chart + mehr Abstand; Legende näher am Graph; Races-Toggle in die Legende.

### Zurückgestellt
- km/Zone aus Strava-Sekunden · Intervalldaten für harte Einheiten aus Strava (eigene Strava-Stream-Runde).

## [0.6.0] – 2026-06-13 — Panel-Konsolidierung & Detail-Schliff

### Hinzugefügt
- **Phasenname unten links im PMC** (in Phasenfarbe) — folgt dem Hover und zeigt die Phase des Tages unter dem Cursor.
- **Races:** Max-HF & Höhenmeter je Wettkampf; **Auto-Import** der Wettkämpfe aus dem Saisonplan
  (`goal_race`, Datum = Wochen-Enddatum) — manuelles Hinzufügen weiterhin möglich, gelöschte Auto-Races
  bleiben gelöscht.
- **Wochen-Check:** Wochen-TSS-Last und km-Polarisierung erscheinen jetzt als Hinweise im Check.

### Geändert
- **Intensitäts-Panel** entschlackt: nur noch **ein TSS-Donut** + der bestehende %-km-Balken je Zone.
  Die doppelten Prozent-Zeilen und die zwei Bewertungs-Boxen sind raus (Bewertungen → Wochen-Check).
- **Phasen-Farbband** liegt jetzt **über** den TSS-Balken (wurde vorher verdeckt) und ist etwas kräftiger.
- **Race-Marker** in PMC & Saison-Progression als **vertikales Label** an der Markierung.
- **Jahresmarke** schwarz, kürzer (kein Strich quer durch den Graphen), Jahreszahl tiefer; im
  Wochenbericht ausgeblendet (beginnt ohnehin am 1.1.).

### Behoben
- **Jahresmarke in den Wochen-Charts** war bei „1 J / Saison" unzuverlässig (doppelte KW-Labels über
  Jahresgrenzen) — jetzt positionsbasiert (Band-Index), konsistent und sitzt zwischen KW1 und KW2.
- **Strava-Notizen:** Geänderte/gelöschte Notizen werden beim erneuten Sync **nicht mehr überschrieben**
  (neuer `desc_fetched`-Marker trennt den Beschreibungs-Abruf von den Notizen).

### Zurückgestellt
- km-je-Zone aus Strava-Zeit-in-Zone (braucht eigene, ratenlimitierte Zonen-Abrufe + Zonen-Mapping).

## [0.5.0] – 2026-06-13 — Chart-Politur & Races

### Hinzugefügt
- **Races als eigene Seite** (🏁): Wettkämpfe mit Endzeit, Distanz, Platzierung, **manuellen Splits**
  (km/Zeit/Pace/Ø-HF) und Notizen. Erscheinen als goldene Marker in den Charts und **einzeln im Wochenbericht**.
- **Phasen-Farbband** unter der x-Achse von PMC & Saison-Progression (Hover = Phasenname) — verbindendes Orientierungselement.
- **PMC-Klick → Tracking**: Hover zeigt oben links die Einheit des Tages, Klick springt zur passenden Tracking-Woche.
- **Race-Marker an/aus** (Toggle) in beiden Charts.

### Geändert
- **PMC:** Wochen-TSS als echte Wochen-Summe (statt akkumuliertem Sägezahn); TSS-Tagesbalken größer
  (höchster Balken reicht bis oben, eigene Achse).
- **Jahresmarke** dezenter: halbhoher Strich + Jahreszahl unter der Achse (PMC + Saison-Progression).
- **Intensitäts-Panel** verständlicher: Donut = TSS-Anteile mit eigener Legende & neutraler Mitte;
  rechts km-Anteil je Zone; zwei Bewertungen (Last vs. Ø-Wochen **und** Polarisierung).
- Beim Laufen durchgängig **km je Zone** (Zonenverteilung km-basiert).

## [0.4.0] – 2026-06-13 — Visualisierung & Accounts

### Hinzugefügt
- **PMC deutlich überarbeitet:** TSS-Balken auf eigener Achse → die Fitness-Kurve nutzt die volle Höhe;
  Prognose-Linien (Fitness/Fatigue/Form) rechts von „heute" **gestrichelt**; zusätzliche Linie
  **kumulierter Wochen-TSS** (Sägezahn); **klickbare Legende** (Serien an/aus, ausgeblendet = transparent).
- **Wettkämpfe** als goldener Strich + Beschriftung und **Krank-Wochen** rot hinterlegt — in PMC und Saison-Progression.
- **Saison-Progression:** dicker Strich + Jahreszahl am Jahreswechsel.
- **Intensität neu (TSS-basiert):** Donut = TSS-Anteile (Mitte = % hart), rechts km-Anteile je Zonen-Gruppe,
  darunter eine **Wochen-Bewertung** (Wochen-TSS vs. Ø der letzten Wochen). Schwellen + Referenz-Fenster in den Einstellungen konfigurierbar.
- **Langzeit-Seite:** Summen-Kacheln (Lauf / Rad / Kraft) für den gewählten Zeitraum.
- **Editierbare Einheit-Notizen** im Tracking (Strava-Beschreibung wird vorbefüllt, frei änderbar).
- **Saisonplan als eigene Seite** (eigener Menüpunkt) — entrümpelt die Einstellungen.
- **Profile umbenennen & löschen** in den Einstellungen, abgesichert mit Bestätigungscode.

### Geändert
- Wochenbericht: PMC & Saison-Progression bauen sich **ab 1.1. des Jahres** auf (PMC mit 2 Wochen Prognose).
- Achsen-Ticks durchgehend über Mindestabstand (saubere Beschriftung bei langen Zeiträumen).

## [0.3.0] – 2026-06-12 — Profile, Strava & Feinschliff

### Hinzugefügt
- **Profile/Accounts** (lokal, ohne Passwort): Profil-Wechsler in der Sidebar, getrennte Daten je Person
  (z. B. Kolja/Isabel). Verlustfreie `*_v2`-Tabellen mit zusammengesetztem Schlüssel (`profile_id`),
  Originaltabellen bleiben als Backup. Profil 1 = Bestandsdaten („Kolja").
- **Strava-Anbindung** (optional): OAuth-Verbindung + Sync, „Ganzes Jahr importieren" → PMC fürs ganze Jahr.
  COROS-Training-Load aus der Aktivitätsbeschreibung → TSS (sonst hrTSS aus Ø-Puls), Sport-Mapping,
  Matching zu geplanten Einheiten. Manuell eingetragene/bearbeitete Einheiten werden nie überschrieben.
- **Drucken/PDF auf der Langzeit-Seite** (druckt den aktuell eingestellten Zeitraum).
- PMC + Saison-Progression jetzt auch oben auf der Langzeit-Seite (zeitraumgesteuert).
- PMC-Zeitraum-Preset **„3 Wochen"** (2 zurück + kommende) als Dashboard-Default.

### Geändert
- **Wochen sortieren sich automatisch nach Datum** und werden lückenlos ab `0` neu nummeriert
  (erste Woche = #0); verknüpfte Einheiten/Wochen-Logs ziehen mit um.
- Wochenbericht-Notizen lesbarer unter der Einheit (Einzug, Trennlinie, kursiv, mehr Zeilenabstand;
  Einheiten-Name nur bei mehreren Einheiten/Tag).
- README + HANDOFF aktualisiert.

## [0.2.0] – 2026-06-12 — Auswertung, Eingabe & Konfigurierbarkeit

### Hinzugefügt
- **Intervall-Builder** (à la Strava/Coros): Zeit · Distanz · Pace · Ø-HF · Max-HF je Belastung mit
  Auto-Durchschnitt — für Plan- und Ist-Einheiten.
- **Intervall-Trend** nach Kategorie (LT1 · LT2 · VO2 kurz/lang) + Endpoint `/api/intervals/trend`.
- **km/Minuten je Zone** beim Eintragen, mit Anzeige der aktuellen HF-/Pace-Bereiche neben den Zonen.
- **Pace-Zonen** (Lauf) und **Speed-/Power-Zonen** (Rad) aus der Leistungsdiagnostik.
- **kcal je Einheit**, **Commute-/Allgemein-Schnellerfassung**.
- Feld **„Sleep Performance"** bei den Tagesfaktoren.
- Konfigurierbare Auswahllisten + neue Seite **„Auswahllisten"** (Phasen/Sportarten/Einheitstypen ohne Code-Änderung).
- Neue **Langzeit-Seite** (Wellness-Verläufe, Zonen-Effizienz, Intervall-Trend).
- **Zeitraum-Umschalter** (1J / 6M / 1M / eigener) für die großen Charts.
- Reale Zeit-in-Zone (`realZoneMin`) + Kategorie-Summen (Lauf/Rad/Kraft) in der Wochen-Analyse.
- Footer/Impressum + Anleitung (`usage.html`).
- DB-Spalten (additiv): `kcal`, `efforts`, `zone_min`, `zone_km`, `speed_zones`, `power_zones`, `sleep_performance`.

### Geändert
- **Bike-TSS-Bug behoben**: Rad-TSS jetzt Watt-/IF-basiert statt HF-Schätzung (keine überhöhten Werte mehr).
- Einheiten kontextabhängig: Lauf = **min/km**, Rad/Rolle = **km/h**.
- Wochenbericht: PMC + Saison-Progression ergänzt, Doppelung entfernt; **2-seitiges Druck-Layout**
  (S.1 Einheiten/Charts/Wellness/Checks, S.2 Tagesfaktoren-Tabelle + Reflexion); Doughnut-Styling.
- Default-Einheitsname aus der Planung übernommen.
- Tracking-Formular entzerrt & in Abschnitte gruppiert.
- Phasen-Liste gestrafft (Base, Belastung, Entlastung, Race Week, Krank, Race Specific) + „Trainingslager"/„Urlaub".
- Wochen-Anzeige als **Kalenderwochen** (KW9 statt Woche 0) inkl. Jahreszahlen.

## [0.1.0] – 2026-06-11 — Erste Version (MVP)

### Hinzugefügt
- Lokale, offline laufende Web-App (Vite+React+TS Client, Express + `node:sqlite` Server).
- Wochenplanung mit km-je-Zone und regelbasierter Prüf-Engine („passt die Woche zur Phase?").
- **TrainingPeaks-Modell**: TSS, CTL (Fitness), ATL (Fatigue), TSB (Form) + PMC mit Forward-Projection.
- Tracking (Wellness-Tagesfaktoren + manuelle Aktivitäten), druckbarer Wochenbericht.
- Zonen-Sets mit Gültig-ab-Datum (neue Leistungsdiagnostik = neues Set).
- Seed-Import des bestehenden `.docx`-Saisonplans; Import der 14 handschriftlich ausgefüllten Wochen-Scans.

[0.5.0]: #050--2026-06-13--chart-politur--races
[0.4.0]: #040--2026-06-13--visualisierung--accounts
[0.3.0]: #030--2026-06-12--profile-strava--feinschliff
[0.2.0]: #020--2026-06-12--auswertung-eingabe--konfigurierbarkeit
[0.1.0]: #010--2026-06-11--erste-version-mvp
