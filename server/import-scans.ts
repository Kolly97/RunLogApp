// Import der handschriftlich ausgefüllten Scans (Woche 0..13) in die DB.
// Transkribiert aus Scans_of_trainingsplan/*.pdf. Unleserliches ist mit `bad`/"!!!" markiert.
// Idempotent: löscht je verarbeiteter Woche vorhandene manuelle Aktivitäten + daily_log + week_log und schreibt neu.
import { db, initSchema } from "./db.ts";
import { rTss } from "./load.ts";
import { effectiveZoneSet } from "./zones.ts";

type Sport = "Run" | "BikeRoad" | "BikeIndoor" | "Strength" | "Physio" | "Rest" | "Other";
type Legs = "easy" | "ok" | "hard";

interface DayScan {
  d: number; // 0=Mo .. 6=So
  session?: string;
  sport?: Sport;
  km?: number | null;
  hf?: number | null;
  paceAvg?: string | null; // "m:ss" pro km
  pace?: string | null;
  durMin?: number | null; // falls Dauer statt Pace bekannt (z.B. Rad)
  rpe?: number | null;
  sleepH?: number | null;
  sleepPct?: number | null;
  hrv?: number | null;
  strain?: number | null;
  recov?: number | null;
  restingHr?: number | null;
  weight?: number | null;
  legs?: Legs | null;
  pain?: number | null;
  zoneOk?: boolean | null;
  notes?: string;
  bad?: string[]; // unleserliche Felder
}

interface PlannedScan { d: number; sport?: Sport; type: string; km?: number | null; min?: number | null; desc: string; }

interface WeekScan {
  no: number;
  phase: string;
  start: string;
  end: string;
  target?: number;
  runKm?: number | null;
  runH?: number | null;
  bikeKm?: number | null;
  bikeH?: number | null;
  runEquiv?: number | null;
  tload?: number | null;
  trainingHours?: number | null;
  checks?: Record<string, boolean>;
  whoop?: Record<string, number | null>;
  refl?: { good?: string; hard?: string; change?: string };
  days: DayScan[];
  planned?: PlannedScan[]; // nur für Wochen ohne Seed (9..13)
  bad?: string[];
}

function paceSec(p?: string | null): number | null {
  if (!p) return null;
  const m = p.match(/(\d+):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ====================================================================
// TRANSKRIPTION DER SCANS
// ====================================================================
const WEEKS: WeekScan[] = [
  // -------------------- Woche 0 (KW9) Race 23.2-1.3, 65 km --------------------
  {
    no: 0, phase: "Race", start: "2026-02-23", end: "2026-03-01", target: 65,
    runKm: 66.4, runH: 5.43, bikeKm: 40, bikeH: 2, tload: 801,
    checks: { mileage: true, threshold2x: false, longrun: true, plyo: true },
    whoop: { sleep10: 4, hrv: 74, stress: 6, motivation: 9 },
    refl: {
      good: "Mileage gut rein bekommen und auch nach Race gut weiter gemacht.",
      hard: "Der 5k ran war schwierig und hat mir gezeigt, dass ich frisch in Wettkämpfe gehen muss und dass ich mehr Tempotraining machen will.",
      change: "2x Threshold + Bergläufe. Montag anstatt Lauf (8km E) aufs Rennrad um Beine zu schonen. Mehr Schlaf und immer 23:30 ins Bett !!!",
    },
    days: [
      { d: 0, session: "Krankengymnastik (1h20)", sport: "Strength", hf: 95, rpe: 3, sleepH: 6.25, hrv: 81, legs: "easy", pain: 1, notes: "Ganz gut. leg press SL 120 kg | RDL 60 kg | Hip Thrust 25 kg | Dips" },
      { d: 1, session: "VO2: 5x800 @ Z5 P130''", sport: "Run", km: 7.2, hf: 153, paceAvg: "4:54", pace: "3:18", rpe: 7, sleepH: 6.8, hrv: 72, legs: "hard", pain: 7, zoneOk: true, notes: "Extremer Muskelkater vom Krafttraining, war beim Laufen und im Alltag sehr unbequem." },
      { d: 2, session: "6 km E + 6x20'' Abläufe @3:00", sport: "Run", km: 7.2, hf: 140, paceAvg: "5:01", rpe: 5, sleepH: 8.98, hrv: 71, legs: "hard", pain: 4, zoneOk: false, notes: "Immer noch sehr viel Muskelkater in Beinen & Po." },
      { d: 3, session: "6 km E + 2x2' @ 5k RP", sport: "Run", km: 7.5, hf: 141, paceAvg: "4:46", pace: "3:18", rpe: 6, sleepH: 8.32, hrv: 76, legs: "ok", pain: 2, zoneOk: true, notes: "Schnell angefühlt, Beine noch etwas hart. Belastung 3:18 mit 164 HF." },
      { d: 4, session: "Race: 5 km Hawei + Wu/Cd", sport: "Run", km: 12, hf: 183, paceAvg: "3:23", rpe: 9, sleepH: 7.07, hrv: 60, legs: "ok", pain: 8, zoneOk: true, notes: "Extrem hart, ab km 1 wie Vollsprint. Beine zu schwer, Pace nicht kontrollierbar. Zu wenig schnelles/kein Bergtraining." },
      { d: 5, session: "11 km E mit Merle + 4 Abläufe", sport: "Run", km: 11.8, hf: 142, paceAvg: "4:44", rpe: 3, sleepH: 5.88, hrv: 79, legs: "ok", pain: 1, zoneOk: true, notes: "Mit Merle. Überraschend gut trotz Lauf am Tag davor. 4 Abläufe @2:57 für 25s." },
      { d: 6, session: "Longrun: 21 km", sport: "Run", km: 21, hf: 149, paceAvg: "4:37", rpe: 5, sleepH: 6.95, hrv: 81, legs: "ok", pain: 0.5, zoneOk: true, notes: "Beine schwer und zu kurz davor gegessen. Musste nach 18 km aufs Klo.", bad: ["pain (0.5? schwer lesbar)"] },
    ],
  },

  // -------------------- Woche 1 (KW10) Belastung 2.3-8.3, 70 km --------------------
  {
    no: 1, phase: "Belastung", start: "2026-03-02", end: "2026-03-08", target: 70,
    runKm: 38.5, runH: 3, bikeKm: 172, bikeH: 7, tload: 925, trainingHours: 10,
    checks: { mileage: false, threshold2x: false, longrun: false, plyo: true },
    whoop: { sleepH: 6.65, sleep10: 5, hrv: 77, stress: 8, motivation: 5 },
    refl: {
      good: "Gute lange Rennradfahrt. Bergläufe sehr gut trotz Muskelkater.",
      hard: "Kein Threshold und kein Longrun. Durch Masterarbeit sehr gestresst und mentale Schwierigkeiten.",
      change: "Stick to the plan. Früher ins Bett, früher aufstehen und produktiv sein. Du kannst das und machst jetzt ein Schritt nach dem anderen.",
    },
    days: [
      { d: 0, session: "Rennrad: 90 min @Z1", sport: "BikeRoad", km: 41, hf: 125, durMin: 90, rpe: 2, sleepH: 6.32, hrv: 85, legs: "ok", pain: 2, zoneOk: false, notes: "" },
      { d: 1, session: "T1: 4x6' @ Z4 (90'' jog)", sport: "Run", km: 16, hf: 158, paceAvg: "4:08", pace: "3:28", rpe: 7, sleepH: 7.5, hrv: 78, legs: "ok", pain: 1, zoneOk: true, notes: "Threshold in Alphaflys komisch, konnte nicht rollen lassen. Puls am Ende Tick zu hoch (171/173/177/176, max 183). 6'@3:31, 30''@2:59." },
      { d: 2, session: "6 km E + 85 km Rennrad (3h)", sport: "BikeRoad", km: 85, hf: 140, durMin: 180, rpe: 6, sleepH: 7.18, hrv: 74, legs: "ok", pain: 0, zoneOk: true, notes: "Geburtstag-Rennradtour, ~2h Run-Äquivalent. Etwas gedrückt, Beine nicht ganz locker, gute Alternative zum Longrun. Zusätzlich 6 km E. km-Zeile (25) im Scan unklar.", bad: ["km (Zeile zeigt 25, widerspricht 6km E + 85km Rad)"] },
      { d: 3, session: "Pause (statt T2 7x4')", sport: "Rest", rpe: null, sleepH: 5.83, hrv: 67, legs: "ok", notes: "Heute Pause und Kuchen fürs Lab. Beine durch vom Rennradfahren." },
      { d: 4, session: "Krankengymnastik + Kraft", sport: "Strength", km: 6.4, hf: 145, paceAvg: "6:35", rpe: 3, sleepH: 6.13, hrv: 75, legs: "ok", pain: 0, zoneOk: true, notes: "Erstes Mal Sprünge und verkürztes Kraftprogramm. Hip Thrust sehr anstrengend." },
      { d: 5, session: "Berg: 10x2' (SHA) (12 km)", sport: "Run", km: 16, paceAvg: "5:01", pace: "3:05", rpe: null, sleepH: 9.08, hrv: 81, legs: "hard", pain: 4, zoneOk: true, notes: "Beine davor komplett dicht, extremer Muskelkater. Bergläufe trotzdem ok, Oberschenkel komplett fest.", bad: ["HF (leer)", "RPE (leer)"] },
      { d: 6, session: "Fahrrad mit Eltern (statt 18 km Longrun)", sport: "BikeRoad", hf: 116, rpe: 2, sleepH: 6.82, hrv: 78, legs: "hard", pain: 6, zoneOk: false, notes: "Beine komplett schwer, daher kein Longrun. Stattdessen Fahrrad mit Eltern." },
    ],
  },

  // -------------------- Woche 2 (KW11) Belastung 9.3-15.3, 76 km (Race) --------------------
  {
    no: 2, phase: "Belastung", start: "2026-03-09", end: "2026-03-15", target: 76,
    runKm: 75, runH: 6.08, bikeKm: 65, bikeH: 2.5, tload: 975, trainingHours: 10,
    checks: { mileage: true, threshold2x: true, longrun: true, plyo: true },
    whoop: { sleep10: 6, hrv: 76, stress: 6, motivation: 7 },
    refl: {
      good: "10k Lauf richtig gut, scheinbar perfekt rausgenommen. Bauch etc. auch sehr gut. Blaupause für kommende Wettkämpfe.",
      hard: "Threshold am Dienstag sehr schlecht: Puls hoch, Beine schwer. Gut, dass ich es nicht erzwungen habe.",
      change: "Belastung rausnehmen aber KM auf 82 km. Nichts erzwingen und noch etwas Grundlage machen.",
    },
    days: [
      { d: 0, session: "3x12 min Z2 Rolle (60 min)", sport: "BikeIndoor", km: 33, hf: 142, durMin: 60, rpe: 2, sleepH: 6.68, hrv: 86, legs: "hard", pain: 4, zoneOk: true, notes: "Beine schwer, starker Muskelkater v.a. rechter Quadrizeps. Rechte Patellasehne fühlt sich komisch an. Beine nach Rad besser. (max HF ~185)" },
      { d: 1, session: "6x4' P2' (14 km)", sport: "Run", km: 15, hf: 161, paceAvg: "4:14", pace: "3:36", rpe: 8, sleepH: 7.23, hrv: 72, legs: "ok", pain: 2, zoneOk: false, notes: "Nicht gut angefühlt, 5. Rep abgebrochen. Erste 4 min zu schnell, Puls dann hoch (180 bpm bei 4:45). Bis Samstag Ruhe." },
      { d: 2, session: "Krankengymnastik + 12,5 km Trailrun", sport: "Run", km: 12.5, hf: 145, paceAvg: "5:42", rpe: 1, sleepH: 6.07, hrv: 70, legs: "easy", pain: 1, zoneOk: false, notes: "90 min KG mit Sprüngen + verkürztes Krafttraining. Danach 12,5 km DK-Trailrun mit Thomas, sehr schön. Puls etwas erhöht." },
      { d: 3, session: "10 km E", sport: "Run", km: 9.3, hf: 145, paceAvg: "4:38", rpe: 2, sleepH: 7.08, hrv: 75, legs: "easy", pain: 0, zoneOk: true, notes: "Richtig gut angefühlt. Beine am Ende etwas schwer, Puls hoch, sonst im Rahmen. Sehr happy." },
      { d: 4, session: "4 km E + Abläufe", sport: "Run", km: 4.4, rpe: null, sleepH: 7.17, hrv: 79, legs: "easy", pain: 0, notes: "Beine nicht super locker, alles etwas schwer — gutes Omen für die 10 km morgen.", bad: ["HF (leer)", "Ø Pace (leer)", "RPE (leer)"] },
      { d: 5, session: "10 km Schriesheim (Race)", sport: "Run", km: 16, hf: 181, rpe: 7, sleepH: 6.5, hrv: null, legs: "easy", pain: 1, zoneOk: true, notes: "Geil. Beine richtig gut. Bis 8 km easy mit angezogener Handbremse.", bad: ["HRV (leer)", "Ø Pace (leer)"] },
      { d: 6, session: "18 km E (AM)", sport: "Run", km: 18, hf: 145, paceAvg: "4:49", pace: "4:41", rpe: 2, sleepH: 7.55, hrv: 75, legs: "ok", pain: 2, zoneOk: true, notes: "Beine vom Wettkampf schwer, ging gut mit Isabel. Letzten 5 km etwas hart." },
    ],
  },

  // -------------------- Woche 3 (KW12) Belastung 16.3-22.3, 82 km --------------------
  {
    no: 3, phase: "Belastung", start: "2026-03-16", end: "2026-03-22", target: 82,
    runKm: 81.4, runH: 6.5, bikeKm: 83, bikeH: 3, tload: 1155, trainingHours: 11,
    checks: { mileage: true, threshold2x: true, longrun: true, plyo: true },
    whoop: { sleepH: 7.47, sleep10: 6, hrv: 77, stress: 6, motivation: 8 },
    refl: {
      good: "Sehr gut: Wochenkilometer geschafft und Qualieinheiten im richtigen Bereich. Die 8 min Threshold haben sich gut angefühlt.",
      hard: "Bergläufe und Longrun sehr hart. Gemerkt, dass die Beine keine Kraft mehr haben.",
      change: "KM auf 60-70 reduzieren, nur eine Threshold-Einheit. Mehr KM in niedrigem Puls, dazu KG- und Stabi-Session.",
    },
    bad: ["Rennrad-Zeile (83 km / 3:00 h) im Scan vertauscht/unsicher"],
    days: [
      { d: 0, session: "1 h E Rolle + Stabi", sport: "BikeIndoor", km: 32, hf: 121, durMin: 60, rpe: 2, sleepH: 7.5, hrv: 84, legs: "ok", pain: 0, zoneOk: true, notes: "Beine recht locker, HR für die Watts gering. Gut, einen Tag Laufpause zu haben. (~166 W)" },
      { d: 1, session: "T2: 10x1000 @ Z4 (1' jog)", sport: "Run", km: 13, hf: 163, paceAvg: "4:22", rpe: 7, sleepH: 7.88, hrv: 80, recov: null, legs: "easy", pain: 1, zoneOk: true, notes: "Ganz gut, etwas unruhig auf der Bahn. RHR 48. HR max 186, avg 174 (191 im letzten Rep).", bad: ["Intervall-Pace (8:27? wohl 3:2x)"] },
      { d: 2, session: "Krankengymnastik + 8 km E + Gym", sport: "Run", km: 14.2, hf: 142, paceAvg: "4:52", rpe: 1, sleepH: 7.7, hrv: 94, legs: "ok", pain: 0, zoneOk: true, notes: "Morgens 4,2 km, abends 10 km + 90 min Gym. Alles super. RHR 46 (HRV Coros 83, Whoop Sleep-Perf. 85)." },
      { d: 3, session: "Sub T: 3x8' P2' @ max.175 bpm", sport: "Run", km: 16, hf: 155, paceAvg: "4:14", pace: "3:33", rpe: 6, sleepH: 7.2, hrv: 81, legs: "ok", pain: 0, zoneOk: true, notes: "Puls beim Einlaufen sehr niedrig, Beine gut. Erste 8' sehr niedriger Puls, danach hoch. Sehr gut. (8'Ø 171)" },
      { d: 4, session: "8 km E + 1 h Rolle (28 km)", sport: "BikeIndoor", km: 28, hf: 127, durMin: 60, rpe: 3, sleepH: 6.5, hrv: 89, legs: "ok", pain: 0, zoneOk: true, notes: "Zusätzlich 8 km E Lauf. 1h Rolle, Puls am Anfang okay, hinten hochgedriftet. Beine etwas kaputt, Waden schwer. RHR 48. (~173 W)" },
      { d: 5, session: "Berg: 3x(1000/800/400) (16 km)", sport: "Run", km: 18, hf: 141, paceAvg: "5:13", pace: "3:00", rpe: 8, sleepH: 6.3, hrv: 80, legs: "ok", pain: 0, zoneOk: true, notes: "Lief echt hart, 3 anstrengende Wochen hinter mir. Beine echt schwer, Waden hart." },
      { d: 6, session: "20 km E (AM)", sport: "Run", km: 20, hf: 138, paceAvg: "4:48", pace: "4:43", rpe: null, sleepH: 8.32, hrv: 85, legs: "ok", pain: 0, zoneOk: true, notes: "Beine tot müde, Hüftbeuger zu. HR sehr niedrig, Beine limitierender Faktor. Brauche jetzt eine easy Woche.", bad: ["RPE (Wert '8/4' unklar)"] },
    ],
  },

  // -------------------- Woche 4 (KW13) Entlastung 23.3-30.3, 65 km --------------------
  {
    no: 4, phase: "Entlastung", start: "2026-03-23", end: "2026-03-29", target: 65,
    runKm: 56, runH: 4.17, bikeKm: 98, bikeH: 4.42, tload: 688, trainingHours: 11.6,
    checks: { mileage: true, threshold2x: false, longrun: true, plyo: true },
    whoop: { recov: 63, strain: 13.5, stress: 4, motivation: 5, sleepH: 7.13, sleepPct: 84, hrv: 80, rhr: 47 },
    refl: {
      good: "Nicht so viel, außer dass ich es geschafft habe die KM deutlich zu reduzieren.",
      hard: "Dienstag hat die Leiste schon beim WU geschmerzt (ging gut weg). Der Longrun war viel zu hart.",
      change: "Gezieltes Trainieren. KM wieder auf 80 bringen. Stabi nicht vernachlässigen. Longrun alleine oder mit Merle/Isabel.",
    },
    days: [
      { d: 0, session: "30 min Rolle + Stabi + 22 km Commute", sport: "BikeRoad", km: 40, hf: 120, durMin: 90, rpe: 1, sleepH: 7.12, sleepPct: 85, hrv: 82, strain: 12.7, recov: 62, legs: "ok", zoneOk: true, notes: "Easy auf dem Rad + Exact Health 30 min Core. Allgemein down wegen Masterarbeit." },
      { d: 1, session: "2k WU / 6k @ Z3 / 2k CD", sport: "Run", km: 10, hf: 155, paceAvg: "4:02", rpe: 6, sleepH: 7.25, sleepPct: 86, hrv: 72, strain: 15, recov: 44, legs: "easy", notes: "RPE 5-6. HRV niedrig wegen Bier+Wein. Schmerzen in der Leistengegend beim Einlaufen, 2x anhalten müssen. Evtl. Sportlerleiste." },
      { d: 2, session: "Krankengymnastik", sport: "Physio", rpe: 0, sleepH: 6.92, sleepPct: 84, hrv: 85, strain: 12.7, recov: 77, legs: "ok", notes: "Leiste suspekt, Lauf rausgenommen. KG ging trotzdem gut. Morgen Restlauf." },
      { d: 3, session: "6 km Testlauf (statt Sub-T)", sport: "Run", km: 6.5, hf: 139, paceAvg: "4:46", rpe: 1, sleepH: 7.93, sleepPct: 87, hrv: 82, strain: 13.6, recov: 75, legs: "easy", zoneOk: true, notes: "Testlauf okay, keine Schmerzen. Morgen Sub-Threshold sollte gehen." },
      { d: 4, session: "Sub-T 3x8' + 4x30''", sport: "Run", km: 17, hf: 157, paceAvg: "4:15", pace: "3:35", rpe: 6, sleepH: 6.97, sleepPct: 81, hrv: 80, strain: 16.1, recov: 66, legs: "ok", zoneOk: true, notes: "Gute Threshold mit Chris. Erste 8' 170 HR, danach 178/175. In Zoom Fly 4, danach 4x30'' in 2:55. Rechter Hüftbeuger etwas verhärtet." },
      { d: 5, session: "35 min Rolle (Regen, kein Lauf)", sport: "BikeIndoor", km: 20, hf: 126, durMin: 37, rpe: 1, sleepH: 7.52, sleepPct: 86, hrv: 82, strain: 7.6, recov: 68, legs: "ok", zoneOk: true, notes: "Hat geregnet, keine Lust zu laufen. 35 min Rolle war lazy." },
      { d: 6, session: "Longrun 23 km (HD HM, 370 hm)", sport: "Run", km: 23, hf: 153, paceAvg: "4:39", pace: "4:22", rpe: 5, sleepH: 6.85, sleepPct: 81, hrv: 76, strain: 17.5, recov: 52, legs: "ok", notes: "Zu bergig und zu schnell. Schnitt noch Zone 2 aber viele zu harte km, v.a. Berghoch. Ab km 8 rechte Wade geschmerzt." },
    ],
  },

  // -------------------- Woche 5 (KW14) Belastung 1/3: 30.3-5.4, 80 km --------------------
  {
    no: 5, phase: "Belastung 1/2", start: "2026-03-30", end: "2026-04-05", target: 80,
    runKm: 82, runH: 6, bikeKm: 58, bikeH: 2.5, tload: 777, trainingHours: 8.5,
    checks: { mileage: true, threshold2x: true, longrun: true, plyo: false },
    whoop: { recov: 72, strain: 13.3, stress: 7, motivation: 4, sleepH: 6.88, sleepPct: 83, sCons: 82, hrv: 85, rhr: 46 },
    refl: {
      good: "Trotz Osterbesuch die KM zusammen bekommen. TWL und Schwelle (4x6') gut. Erster Quality-Longrun super.",
      hard: "Samstag 3x2000 Tempo für Isabel: Beine schwer, Puls sehr hoch.",
      change: "Harte Woche mit 88 km. Samstag 10k-spezifisch (3-2-2). Evtl. Doppeltag statt jeden DL 12 km+. DL easy Zone 1-2.",
    },
    days: [
      { d: 0, session: "8 km E + 20' Stabi", sport: "Run", km: 7.5, hf: 141, paceAvg: "4:35", rpe: 2, sleepH: 7.0, sleepPct: 83, hrv: 83, strain: 9.5, recov: 72, legs: "ok", zoneOk: true, notes: "Puls und Beine gut. Ramen davor gegessen, nach 3 km Darm schlecht, starker Durchfall." },
      { d: 1, session: "TWL: 5x(1200/800) (4:00/2:56)", sport: "Run", km: 15, hf: 160, paceAvg: "4:08", pace: "3:25", rpe: 8, sleepH: 6.7, sleepPct: 82, hrv: 96, strain: 16.1, recov: 93, legs: "ok", zoneOk: true, notes: "Hart und muskulär schwierig. Linke Hüfte/rechtes Knie etwas weh. 1200 @3:25/176HR, 800 @3:45/176HR." },
      { d: 2, session: "10 km E", sport: "Run", km: 10, hf: 135, paceAvg: "4:54", rpe: 2, sleepH: 7.33, sleepPct: 86, hrv: 76, strain: 11.5, recov: 51, legs: "ok", zoneOk: true, notes: "Mental sehr schlechter Tag, starke Selbstzweifel. Lauf okay, Puls hoch, muskulär etwas schwer." },
      { d: 3, session: "Sub-T 3x8' P2' (168-175) + 4x60''", sport: "Run", km: 13, hf: 149, paceAvg: "4:15", pace: "3:35", rpe: 6, sleepH: 6.68, sleepPct: 86, hrv: 76, strain: 14.5, recov: 51, legs: "ok", zoneOk: true, notes: "Wollte eigentlich keine Schwelle, doch aufgerafft. Puls niedrig beim Einlaufen. Fuß/Ballen weh, am Ende Bauch. (TL 118, Int 107)" },
      { d: 4, session: "60' Rolle + Stabi", sport: "BikeIndoor", km: 30, hf: 128, durMin: 60, rpe: 2, sleepPct: 85, hrv: 88, strain: 9.6, recov: 78, legs: "ok", zoneOk: true, notes: "Beine/Füße muskulär nicht gut, daher lieber 60' Rolle. War gut. (~179 W)", bad: ["Sleep(h) (leer)"] },
      { d: 5, session: "10 km E + 40 min Stabi (3x2k Isabel)", sport: "Run", km: 16, hf: 150, paceAvg: "4:24", pace: "3:47", rpe: 7, sleepH: 7.03, sleepPct: 82, hrv: 82, strain: 14.0, recov: 66, legs: "hard", notes: "Isabel 3x2k gepaced. Beine und Puls schlecht — höher als Sub-T am Do, 14 s/km langsamer. Echt schlecht." },
      { d: 6, session: "Longrun 22 km (last 5 k Steady)", sport: "Run", km: 22, hf: 155, paceAvg: "4:16", pace: "3:44", rpe: 5, sleepH: 6.5, sleepPct: 80, hrv: 93, strain: 17.1, recov: 90, legs: "ok", notes: "Beine recht gut, aber starker Gegenwind, Puls für Pace hoch. Letzten 5 km hart (Puls >168)." },
    ],
  },

  // -------------------- Woche 6 (KW15) Belastung 2/2: 6.4-12.4, 88 km --------------------
  {
    no: 6, phase: "Belastung 2/2", start: "2026-04-06", end: "2026-04-12", target: 88,
    runKm: 60, runH: 5, bikeKm: 125, bikeH: 5, runEquiv: 91.5, tload: 1029, trainingHours: 10,
    checks: { mileage: true, threshold2x: true, longrun: true, plyo: false },
    whoop: { recov: 69, strain: 13.9, stress: 4, motivation: 7, sleepH: 7.23, sleepPct: 83, sCons: 79, hrv: 84, rhr: 46 },
    refl: {
      good: "Trotz Knie-Problemen (ähnlich Bakerzyste) gut durchgezogen und mit 2 Rennrad-Einheiten das Knie orthopädisch entlastet.",
      hard: "Die Knie-Probleme haben stark verunsichert, dachte kurz an komplettes Rausnehmen.",
      change: "Wegen Race (Nidamun 10k Mannheim) rausnehmen. Weiter viel Rennrad. Dienstag 10k-Pace-Einheit, Beine locker halten für Race.",
    },
    days: [
      { d: 0, session: "Rest !!!", sport: "Rest", sleepH: 7.83, sleepPct: 81, hrv: 79, strain: 4.1, recov: 62, legs: "ok", notes: "Isabels Oma & Opa getroffen, 3,5h Autofahrt. Restday sehr gut und wichtig — nach dem Longrun platt." },
      { d: 1, session: "3x(1000-1000-200-200)", sport: "Run", km: 15, hf: 162, paceAvg: "4:34", pace: "3:08", rpe: 8, sleepH: 7.03, sleepPct: 82, hrv: 78, strain: 16.7, recov: 60, legs: "easy", notes: "Frische Beine nach Rest. 1000er 3:12→3:02 (HR 174, max 187), 200er @34s. Sehr gut. Bei 2k-Serie Durchfall-Probleme." },
      { d: 2, session: "6 km (am) + 6 km (pm) E", sport: "Run", km: 16, hf: 146, paceAvg: "4:50", rpe: 3, sleepH: 6.97, sleepPct: 84, hrv: 88, strain: 14.2, recov: 85, legs: "hard", zoneOk: true, notes: "2 Läufe. Morgens sehr schwer (extra easy), nachmittags besser. Links an Kniekehle wieder etwas, Angst vor Bakerzyste. 7km 5:12/132HR, 9km 4:39/144HR." },
      { d: 3, session: "4x8' Sub-T (etwas zu hart)", sport: "Run", km: 15, hf: 156, paceAvg: "4:03", pace: "3:30", rpe: null, sleepH: 6.97, sleepPct: 85, hrv: 88, strain: 16.3, recov: 81, legs: "ok", notes: "Kniekehle abchecken: scheint Bakerzyste zurück. Bewegungsfreiheit kleiner, Spannungsgefühl. Nach Lauf mehr angeschwollen. Puls etwas hoch.", bad: ["RPE (leer)"] },
      { d: 4, session: "60 min Rolle (statt 10 km, Knie schonen)", sport: "BikeIndoor", km: 22, hf: 119, durMin: 60, rpe: 2, sleepH: 6.45, sleepPct: 78, hrv: 90, strain: 7.5, recov: 73, legs: "ok", zoneOk: true, notes: "Bakerzyste nicht reizen: Rad, Dehnen, anti-inflammatorisch, viel gekühlt. Am Ende des Tages gut." },
      { d: 5, session: "3x2k (10k effort) P2.5'", sport: "Run", km: 13, hf: 152, paceAvg: "4:31", pace: "3:16", rpe: 8, sleepH: 7.35, sleepPct: 85, hrv: 85, strain: 15.1, recov: 65, legs: "ok", zoneOk: true, notes: "3x2k gemacht, Knie hat gut mitgemacht. Waden Schwachstelle. Schneller als gedacht, negativ gesplittet. Knie danach etwas angeschwollen." },
      { d: 6, session: "Long Ride 60 km (statt Longrun, RE 26 km)", sport: "BikeRoad", km: 60, hf: 128, durMin: 120, rpe: 4, sleepH: 8.0, sleepPct: 85, hrv: 83, strain: 13.7, recov: 62, legs: "ok", zoneOk: true, notes: "Long Ride statt Longrun, um Knie zu entlasten (Bakerzyste). Lief gut. (NP 190 W)" },
    ],
  },

  // -------------------- Woche 7 (KW16) Race Week 13.4-19.4, 60 km (krank geworden) --------------------
  {
    no: 7, phase: "Race Week", start: "2026-04-13", end: "2026-04-19", target: 60,
    runKm: 30, runH: 2.3, bikeKm: 30, bikeH: 1.5, tload: 315, trainingHours: 4.42,
    checks: { mileage: false, threshold2x: false, longrun: false, plyo: false },
    whoop: { recov: 69, strain: 10.2, stress: 6, motivation: 3, sleepH: 6.9, sleepPct: 79, sCons: 71, hrv: 83, rhr: 46 },
    refl: {
      good: "Dienstag-Training war gut und easy.",
      hard: "Krank geworden und tue mich schwer, zu entspannen und gesund zu werden, da viele Sachen anstehen.",
      change: "Gesund werden.",
    },
    days: [
      { d: 0, session: "8 km E + Strides", sport: "Run", km: 9, hf: 143, paceAvg: "4:38", rpe: 3, sleepH: 6.02, sleepPct: 79, hrv: 76, strain: 12, recov: 44, legs: "ok", zoneOk: true, notes: "Beine etwas schwer, Puls Tick hoch, sonst okay. Knie unangenehm, Hüftbeuger danach zu." },
      { d: 1, session: "6x400 P2' (76-72 sec)", sport: "Run", km: 10, hf: 147, paceAvg: "4:40", pace: "3:15", rpe: 5, sleepH: 7.47, sleepPct: 86, hrv: 87, strain: 14.6, recov: 78, legs: "ok", zoneOk: true, notes: "Fast 8x400 m in 76-77 mit 90 s Pause. Erster schwer, danach lief es. Kopfweh, Isabel erkältet." },
      { d: 2, session: "5 km Laufen (statt 60 min Rolle)", sport: "Run", km: 5, hf: 141, paceAvg: "4:34", rpe: 2, sleepH: 9.65, sleepPct: 83, hrv: 77, strain: 9.5, recov: 49, legs: "ok", zoneOk: true, notes: "Fühle mich etwas kränklich." },
      { d: 3, session: "6 km E + Lauf ABC + Strides", sport: "Run", km: 9, hf: 142, paceAvg: "4:29", rpe: 2, sleepH: 6.47, sleepPct: 83, hrv: 77, strain: 11.8, recov: 54, legs: "ok", zoneOk: true, notes: "Tag nicht gut: lang geschlafen, niedrige HRV, ewig rumgelegen. Im Dunkeln noch 9 km rausgequetscht." },
      { d: 4, session: "Rest (statt 45 min Rolle, Halsweh)", sport: "Rest", sleepH: 7, sleepPct: 82, hrv: 87, strain: 8.4, recov: 84, legs: "ok", notes: "Abends schon Halsweh.", bad: ["Strain (durchgestrichener Wert, ~8.4 unsicher)"] },
      { d: 5, session: "Krank — 4 km Shake Out nicht gelaufen", sport: "Rest", sleepH: 5.83, sleepPct: 71, hrv: 90, strain: 2.9, recov: 89, legs: "ok", notes: "Krank: Schluckbeschwerden, Kopfschmerzen, kein Fieber. Um 7 Uhr wach, nicht mehr eingeschlafen. Nap 12:30-15 Uhr." },
      { d: 6, session: "Race abgesagt (krank) — 3 km Spaziergang", sport: "Other", km: 3, hf: 85, rpe: null, sleepH: 7, sleepPct: 67, hrv: 85, recov: 89, legs: "ok", notes: "Kein Wettkampf da krank. Um 3 Uhr wach, bis 5 Uhr nicht eingeschlafen. 3 km Spaziergang durch Dossenheim um 17 Uhr." },
    ],
  },

  // -------------------- Woche 8 (KW17) Gesund werden 20.4-26.4, 24 km --------------------
  {
    no: 8, phase: "Gesund werden", start: "2026-04-20", end: "2026-04-26", target: 24,
    runKm: 14, runH: 1.18, bikeKm: 93, bikeH: 4.17, runEquiv: 35, tload: 351,
    checks: { mileage: false, threshold2x: false, longrun: false, plyo: false },
    whoop: { recov: 69, strain: 9.8, stress: 9, motivation: 2, sleepH: 7.13, sleepPct: 83, sCons: 75, hrv: 85, rhr: 48 },
    refl: {
      good: "Langsam wieder gesünder werden.",
      hard: "Immer noch stark erhöhter Puls. Mental sehr hart wegen Existenzkrisen durch das DKFZ-Gespräch bei Binder.",
      change: "Mehr schlafen. Früher ins Bett, früher aufstehen, früher mit Arbeiten anfangen.",
    },
    days: [
      { d: 0, session: "45 min Rolle (RE 7 km)", sport: "BikeIndoor", km: 20.6, hf: 123, durMin: 45, rpe: null, sleepH: 8.42, sleepPct: 85, hrv: 88, strain: 7.5, recov: 74, legs: "ok", zoneOk: true, notes: "Sehr wenig Watt getreten (112 W), musste reduzieren. Gute erste Belastung, lieber weniger als mehr.", bad: ["RPE (Wert wirkt zu hoch für easy Rolle, unsicher)"] },
      { d: 1, session: "Rest (immer noch krank)", sport: "Rest", sleepH: 9.9, sleepPct: 87, hrv: 87, strain: 7.1, recov: 72, legs: "ok", notes: "Immer noch krank." },
      { d: 2, session: "6 km E", sport: "Run", km: 6, hf: 136, paceAvg: "5:05", rpe: 3, sleepH: 6.32, sleepPct: 80, hrv: 85, strain: 8.4, recov: 67, legs: "ok", zoneOk: true, notes: "Immer noch etwas krank. Puls erhöht, Körper unrund, aber guter erster Schritt." },
      { d: 3, session: "45-60 min Rolle + Mobility", sport: "BikeIndoor", durMin: 50, rpe: null, sleepH: 6.27, sleepPct: 81, hrv: 80, strain: 8.7, recov: 55, legs: "ok", notes: "DKFZ-Bewerbungsgespräch, danach mental extrem schlecht, leichter Absturz." },
      { d: 4, session: "8 km E", sport: "Run", km: 8, hf: 151, paceAvg: "5:03", rpe: 6, sleepH: 5.95, sleepPct: 79, hrv: 90, strain: 14.7, recov: 83, legs: "ok", notes: "Puls krass hoch (mit Phillip geredet). Sehr langsam laufen müssen um unter 150 zu bleiben, teils über 160." },
      { d: 5, session: "Exact Kraft + Mobility", sport: "Strength", rpe: null, sleepH: 6.75, sleepPct: 82, hrv: 74, strain: 7.5, recov: 46, legs: "ok", notes: "Viel in der Bib gewesen bis 22 Uhr." },
      { d: 6, session: "70 min Rolle + 50 min Core (RE 13-14 km)", sport: "BikeIndoor", km: 26, hf: 133, durMin: 70, rpe: 3, sleepH: 6.63, sleepPct: 84, hrv: 91, strain: 5.2, recov: 87, legs: "easy", zoneOk: true, notes: "Viel Rad. Rolle deutlich besser, konnte wieder okay Watt treten (NP 173 W). Puls leicht hoch aber okay." },
    ],
  },
];

// ====================================================================
// IMPORT-ENGINE
// ====================================================================
export function importScans(): { activities: number; days: number; weeks: number; unreadable: string[] } {
  initSchema();
  let nAct = 0, nDay = 0;
  const unreadable: string[] = [];
  const DAY_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

  for (const w of WEEKS) {
    // Saison-Woche anlegen/aktualisieren
    db.prepare(
      `INSERT INTO season_weeks(week_no, label, phase, start_date, end_date, target_km, goal_race, notes)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(week_no) DO UPDATE SET phase=excluded.phase, start_date=excluded.start_date,
         end_date=excluded.end_date, target_km=COALESCE(excluded.target_km, season_weeks.target_km)`,
    ).run(w.no, `Woche ${w.no}`, w.phase, w.start, w.end, w.target ?? null, "", "");

    const zs = effectiveZoneSet(w.start);

    // idempotent: alte manuelle Einträge dieser Woche weg
    db.prepare("DELETE FROM activities WHERE source='manual' AND date BETWEEN ? AND ?").run(w.start, w.end);
    db.prepare("DELETE FROM daily_log WHERE date BETWEEN ? AND ?").run(w.start, w.end);

    // geplante Einheiten (nur falls mitgeliefert, z.B. Wochen 9-13)
    if (w.planned) {
      db.prepare("DELETE FROM planned_sessions WHERE week_no=?").run(w.no);
      for (const p of w.planned) {
        const date = addDays(w.start, p.d);
        db.prepare(
          `INSERT INTO planned_sessions(date, week_no, sport, type, planned_km, planned_min, zone_alloc, description, planned_tss, sort_order)
           VALUES(?,?,?,?,?,?,?,?,?,?)`,
        ).run(date, w.no, p.sport || "Run", p.type, p.km ?? null, p.min ?? null, null, p.desc, 0, 0);
      }
    }

    for (const day of w.days) {
      const date = addDays(w.start, day.d);
      const isWorkout = day.sport && day.sport !== "Rest";
      if (isWorkout) {
        const pSec = paceSec(day.paceAvg);
        const movingS = day.durMin ? day.durMin * 60 : day.km && pSec ? Math.round(day.km * pSec) : null;
        const tss = day.sport === "Run" && day.km && pSec ? rTss(movingS!, pSec, zs.threshold_pace) : null;
        db.prepare(
          `INSERT INTO activities(strava_id, date, sport, source, name, distance_m, moving_s, avg_hr, tss, training_load, zones, overrides, notes)
           VALUES(NULL,?,?,?,?,?,?,?,?,?,NULL,?,?)`,
        ).run(
          date, day.sport, "manual", day.session || "", day.km != null ? day.km * 1000 : null,
          movingS, day.hf ?? null, tss, null, JSON.stringify([]), day.notes || "",
        );
        nAct++;
      }

      // daily_log
      const cols: Record<string, unknown> = {
        weight: day.weight, hrv: day.hrv, recovery: day.recov, strain: day.strain,
        resting_hr: day.restingHr, sleep_h: day.sleepH, sleep_efficiency: day.sleepPct,
        legs: day.legs, pain: day.pain, rpe: day.rpe, notes: day.notes,
      };
      const keys = Object.keys(cols).filter((k) => cols[k] != null && cols[k] !== "");
      if (keys.length) {
        const ph = keys.map(() => "?").join(",");
        const upd = keys.map((k) => `${k}=excluded.${k}`).join(",");
        db.prepare(`INSERT INTO daily_log(date,${keys.join(",")}) VALUES(?,${ph}) ON CONFLICT(date) DO UPDATE SET ${upd}`)
          .run(date, ...keys.map((k) => cols[k]));
        nDay++;
      }

      for (const b of day.bad || []) unreadable.push(`Woche ${w.no} ${DAY_DE[day.d]} (${date}): ${b}`);
    }

    // Wochen-Log
    db.prepare(
      `INSERT INTO week_log(week_no, run_km, run_h, bike_km, bike_h, run_equiv, week_tss, checks, whoop, refl_good, refl_hard, refl_change, refl_extra)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(week_no) DO UPDATE SET run_km=excluded.run_km, run_h=excluded.run_h, bike_km=excluded.bike_km,
         bike_h=excluded.bike_h, run_equiv=excluded.run_equiv, week_tss=excluded.week_tss, checks=excluded.checks, whoop=excluded.whoop,
         refl_good=excluded.refl_good, refl_hard=excluded.refl_hard, refl_change=excluded.refl_change`,
    ).run(
      w.no, w.runKm ?? null, w.runH ?? null, w.bikeKm ?? null, w.bikeH ?? null, w.runEquiv ?? null, w.tload ?? null,
      JSON.stringify(w.checks || {}), JSON.stringify(w.whoop || {}),
      w.refl?.good || "", w.refl?.hard || "", w.refl?.change || "", JSON.stringify({}),
    );
    for (const b of w.bad || []) unreadable.push(`Woche ${w.no} (Wochen-Check): ${b}`);
  }

  return { activities: nAct, days: nDay, weeks: WEEKS.length, unreadable };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = importScans();
  console.log(`Import: ${r.weeks} Wochen, ${r.activities} Aktivitäten, ${r.days} Tagesprotokolle.`);
  if (r.unreadable.length) {
    console.log(`\n!!! ${r.unreadable.length} unleserliche/unsichere Felder:`);
    for (const u of r.unreadable) console.log("  !!! " + u);
  }
}
