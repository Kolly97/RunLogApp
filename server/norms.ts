// Alters-/geschlechtsgradierte VO2max-Einordnung (v0.15.0, O1).
// Schwellen angelehnt an die Cooper-Institute-/ACSM-Normtabellen (untere Grenze je Stufe, ml/kg/min).
// Stufen: Elite (≈Superior) · Exzellent · Sehr gut (Good) · Durchschnitt (Fair) · darunter.

type Band = { age: number; elite: number; exzellent: number; sehrGut: number; durchschnitt: number };

// Männer: untere Grenzen je Altersband (Startalter).
const MALE: Band[] = [
  { age: 20, elite: 55.4, exzellent: 51.1, sehrGut: 45.4, durchschnitt: 41.7 },
  { age: 30, elite: 54.0, exzellent: 48.3, sehrGut: 44.0, durchschnitt: 40.5 },
  { age: 40, elite: 52.5, exzellent: 46.4, sehrGut: 42.4, durchschnitt: 38.5 },
  { age: 50, elite: 48.9, exzellent: 43.4, sehrGut: 39.2, durchschnitt: 35.0 },
  { age: 60, elite: 45.7, exzellent: 39.5, sehrGut: 35.5, durchschnitt: 30.9 },
];

// Frauen: untere Grenzen je Altersband (Startalter).
const FEMALE: Band[] = [
  { age: 20, elite: 49.6, exzellent: 43.9, sehrGut: 39.5, durchschnitt: 36.1 },
  { age: 30, elite: 47.4, exzellent: 42.4, sehrGut: 37.8, durchschnitt: 34.4 },
  { age: 40, elite: 45.3, exzellent: 39.7, sehrGut: 36.3, durchschnitt: 33.0 },
  { age: 50, elite: 41.1, exzellent: 36.7, sehrGut: 33.0, durchschnitt: 30.1 },
  { age: 60, elite: 37.8, exzellent: 33.0, sehrGut: 30.0, durchschnitt: 27.5 },
];

function bandFor(age: number, table: Band[]): Band {
  let pick = table[0];
  for (const b of table) if (age >= b.age) pick = b;
  return pick;
}

/** VO2max/VDOT-Wert → deutsche Niveau-Einstufung relativ zur Alters-/Geschlechtsnorm. */
export function vo2maxLevel(value: number, age: number, sex: "m" | "f"): string {
  const b = bandFor(age, sex === "f" ? FEMALE : MALE);
  if (value >= b.elite) return "Elite";
  if (value >= b.exzellent) return "Exzellent";
  if (value >= b.sehrGut) return "Sehr gut";
  if (value >= b.durchschnitt) return "Durchschnitt";
  return "Unter Durchschnitt";
}
