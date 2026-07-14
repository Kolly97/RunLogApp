// Isabel-Tutorial (v2.10.0): Typen der Step-Registry. Das Tutorial läuft als Overlay über der echten App
// (Demo = Profil „Tutorial: Isabel", Aufgaben = echtes Profil des Nutzers). Fortschritt wird nur je Abschnitt
// persistiert (Setting tutorial_progress:<pid>); innerhalb eines Abschnitts startet man vorn.

export type SectionId = "start" | "plan" | "analyse" | "coach" | "nerd";

/** Chart-Kino (v2.11.0): die Diagramme, die Isabel als 3D-Szene erklärt. */
export type CinemaChartId = "pmc" | "latent" | "dose" | "wellness" | "readiness" | "threshold" | "power" | "vo2" | "cycle" | "nof1";

/** Aufgaben-Detektion: entweder absoluter Zustand (test) oder „Zahl steigt gegenüber Step-Start" (count). */
export type TaskCheck =
  | { test: () => Promise<boolean> }
  | { count: () => Promise<number> };

export type TutStep =
  /** Isabel erklärt. Mit selector → Spotlight auf das echte Element, sonst zentrierte Karte. */
  | { kind: "say"; title: string; text: string; route?: string; selector?: string }
  /** Echte Aufgabe: Karte dockt unten rechts an (App bleibt bedienbar), Check pollt bis erledigt. */
  | { kind: "task"; title: string; text: string; route: string; check: TaskCheck; skippable?: boolean; skipNote?: string }
  /** Mini-Wissens-Check: falsche Antwort → freundliches Feedback + neuer Versuch. */
  | { kind: "quiz"; question: string; options: { label: string; correct?: boolean; feedback: string }[] }
  /** Nerd-Add-on: ein ML-Modell — 3D-Intuition (NerdVisual) + aufklappbare echte Formel. */
  | { kind: "model"; title: string; text: string; visual: "pmc" | "cs" | "kalman" | "dose" | "permutation" | "banister"; formula: { lines: string[]; note?: string } }
  /** Chart-Kino (v2.11.0): Vollbild-3D-Szene — Isabel erklärt ein echtes Diagramm Beat für Beat. */
  | { kind: "chart3d"; chart: CinemaChartId; title: string }
  /** Abschnitts-Abschluss: Isabel-3D-Moment + Recap. finale = Zieleinlauf-Variante (Abschnitt 4). */
  | { kind: "scene"; title: string; text: string; finale?: boolean };

export type TutSection = {
  id: SectionId;
  nr: number;              // Anzeige-Reihenfolge (1..4, Nerd = 5/optional)
  icon: string;
  title: string;
  tagline: string;         // Isabels Einzeiler auf der Hub-Karte
  minutes: number;         // grobe Dauer im Erstdurchlauf
  optional?: boolean;      // Nerd-Add-on
  available: boolean;      // false = „in Arbeit" (Hub-Karte ohne Start)
  steps: TutStep[];
};

export type TutProgress = { done: string[]; dismissed: boolean };
