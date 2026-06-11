# RunLog — Trainingsplanung, Tracking & TrainingPeaks-Auswertung

Lokale, in sich geschlossene Web-App für die wöchentliche Trainingsplanung im Langstreckenlauf:
Einheiten planen → sportwissenschaftlich prüfen (passt das zur Phase?) → reale Daten dagegen halten →
druckfertiger Wochenbericht. Läuft komplett offline auf deinem Rechner, keine Cloud, kein Claude im Hintergrund.

## Voraussetzungen
- Node.js ≥ 22 (nutzt das eingebaute `node:sqlite`, kein nativer Build nötig). Getestet mit Node 25.

## Loslegen
```bash
npm install          # einmalig
npm run seed         # bestehenden Saisonplan (Wochen 0–8) in die DB laden (optional)
npm run dev          # Entwicklungs-Modus → http://localhost:5173
```
Für den Alltag (ohne Auto-Reload, ein Prozess):
```bash
npm run build && npm start   # → http://localhost:3000
```

Die Daten liegen in `training.db` (SQLite) im Projektordner — einfach zu sichern und liegt mit im iCloud-Ordner.

## Seiten
- **Dashboard** — Performance Management Chart (Fitness/Fatigue/Form), Saison-Progression, Form-Status, Check der aktuellen Woche.
- **Wochenplanung** — Einheiten je Tag eintragen (Sport, Typ, km/min, **km je Zone**, Beschreibung). Rechts ein Live-Panel: geplante km vs. Phasenziel, geplante Zonenverteilung & Intensität, geplanter TSS, projizierte Form, und die regelbasierten Hinweise „passt die Woche?".
- **Tracking** — pro Tag Wellness-Werte (Gewicht, Ruhepuls, HRV, Schlaf inkl. Bettgeh-/Aufwachzeit, Recovery, Strain, Beine, RPE, Schmerz, …) und Aktivitäten manuell eintragen/bearbeiten.
- **Wochenbericht** — geplant-vs-real Tagestabelle, Zonen-/Intensitäts-Charts, Whoop-/Wellness-Schnitt, Wochen-Check, erweiterte Reflexion → **Drucken/PDF** (eigenes Druck-Layout).
- **Einstellungen** — Saisonplan-Editor, HF-Zonen-Sets mit Gültig-ab-Datum (neue Leistungsdiagnostik = neues Set), Schwellen (Volumen/Ramp/Polarisierung), Faktoren.

## Auswertungs-Modell (an TrainingPeaks angelehnt)
- **TSS** je Einheit: aus Zonen-Allokation bzw. Typ+Dauer geschätzt (hrTSS); reale Einheiten nutzen COROS Training Load (kalibrierbar) bzw. rTSS/Power-TSS.
- **CTL (Fitness)** = 42-Tage-EWMA, **ATL (Fatigue)** = 7-Tage-EWMA, **TSB (Form)** = CTL − ATL.
- Geplante Einheiten werden in der PMC-Kurve nach vorne projiziert → du siehst vorab, wie die geplante Woche Fitness/Fatigue/Form bewegt.
- Prüf-Engine: Volumen vs. Phasenziel, Ramp-Rate, CTL-Ramp, Form/Taper, Polarisierung (80/20), Quality-Spacing, Longrun-Anteil, Recovery-Readiness, Phasen-Stimmigkeit. Alle Schwellen editierbar.

## Architektur
- `server/` — Express + `node:sqlite`. `db.ts` (Schema), `load.ts` (TSS/PMC), `analysis.ts` (Prüf-Engine), `zones.ts` (Zonen-Sets), `import-docx.ts` (Seed), `index.ts` (API + statisches Hosting).
- `client/` — Vite + React + TypeScript, Charts mit Recharts. `pages/`, `charts/`, `components/`, `lib/`.

## Noch offen (nächster Ausbauschritt)
- **Strava-Auto-Sync** (OAuth + HR-Streams → reale Zeit-in-Zone + COROS-Load-Parsing). Bis dahin reale Einheiten unter „Tracking" manuell eintragen.
