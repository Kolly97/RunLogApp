import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import deJson from "../translations/de.json";
import enJson from "../translations/en.json";

// Leichtgewichtiges i18n ohne externe Dep. DE ist die kanonische Sprache; fehlt ein EN-Key,
// fällt t() auf DE und zuletzt auf den inline angegebenen Default bzw. den Key-Namen zurück.
export type Lang = "de" | "en";
type Dict = Record<string, string>;

// Veränderbare In-Memory-Kopien: der Dev-Editor (Alt+Klick) schreibt hier sofort rein,
// damit die UI ohne Warten auf den Vite-HMR-Reload der JSON-Datei aktualisiert.
const dicts: Record<Lang, Dict> = {
  de: { ...(deJson as Dict) },
  en: { ...(enJson as Dict) },
};

export function translate(lang: Lang, key: string, fallback?: string): string {
  return dicts[lang][key] ?? dicts.de[key] ?? fallback ?? key;
}

// Rohwert für einen Key in einer Sprache (leer wenn nicht vorhanden) — für die Editor-Felder.
export function rawTranslation(lang: Lang, key: string): string {
  return dicts[lang][key] ?? "";
}

// Vom Dev-Editor nach erfolgreichem Speichern aufgerufen: In-Memory-Dicts direkt aktualisieren.
export function applyTranslation(key: string, de: string, en: string): void {
  dicts.de[key] = de;
  dicts.en[key] = en;
}

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, fallback?: string) => string;
  bump: () => void; // erzwingt Re-Render nach In-Memory-Edit
  editMode: boolean; // Dev: Inline-Übersetzungs-Edit-Modus an/aus
  setEditMode: (b: boolean) => void;
};

const LangContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "runlog.lang";

function initialLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "de";
  } catch {
    return "de";
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [version, setVersion] = useState(0);
  const [editMode, setEditMode] = useState(false);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* localStorage nicht verfügbar — Sprache bleibt für die Sitzung */
    }
  }, []);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const t = useCallback((key: string, fallback?: string) => translate(lang, key, fallback), [lang]);
  // version in den Value aufnehmen: erzwingt nach einem In-Memory-Edit (bump) ein neues
  // Value-Objekt, sonst re-rendern die <T>-Consumer nicht und die Änderung bleibt unsichtbar.
  const value = useMemo<Ctx>(
    () => ({ lang, setLang, t, bump, editMode, setEditMode }),
    [lang, setLang, t, bump, version, editMode],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): Ctx {
  const c = useContext(LangContext);
  if (!c) throw new Error("useLang must be used within LangProvider");
  return c;
}

export function useT(): (key: string, fallback?: string) => string {
  return useLang().t;
}

// Interpolates {{key}} placeholders in a translated string.
function tpl(str: string, p: Record<string, string | number | null>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => p[k] != null ? String(p[k]) : "");
}

// Renders a server Flag using translation keys, with f.message as fallback.
export function renderFlag(f: { code: string; message: string; params?: Record<string, string | number | null> }, t: (key: string, fallback?: string) => string): string {
  const p = f.params ?? {};
  const key = `flag.${f.code}`;
  if (f.code === "taper") {
    const parts: string[] = [];
    if (p.tooNeg) parts.push(tpl(t("flag.taper.tsb_neg", "Form am Renntag (TSB {{tsb}}) zu negativ"), p));
    if (p.tooHigh) parts.push(tpl(t("flag.taper.load_high", "geplante 7-Tage-Last ({{pre7tss}} TSS) zu hoch fürs Tapering (max ~{{tssCap}})"), p));
    return tpl(t(key, f.message), { ...p, parts: parts.join(" · ") });
  }
  const tmpl = t(key, "");
  if (!tmpl) return f.message;
  return tpl(tmpl, p);
}
