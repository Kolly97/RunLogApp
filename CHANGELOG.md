# Changelog

Alle nennenswerten Änderungen an RunLog. Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/),
Versionierung nach [SemVer](https://semver.org/lang/de/). Datenbank-Migrationen sind immer **additiv**
(keine Bestandsdaten gehen verloren).

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
