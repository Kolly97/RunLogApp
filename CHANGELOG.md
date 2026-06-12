# Changelog

Alle nennenswerten Änderungen an RunLog. Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/),
Versionierung nach [SemVer](https://semver.org/lang/de/). Datenbank-Migrationen sind immer **additiv**
(keine Bestandsdaten gehen verloren).

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

[0.3.0]: #030--2026-06-12--profile-strava--feinschliff
[0.2.0]: #020--2026-06-12--auswertung-eingabe--konfigurierbarkeit
[0.1.0]: #010--2026-06-11--erste-version-mvp
