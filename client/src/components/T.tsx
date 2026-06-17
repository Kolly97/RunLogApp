import { type KeyboardEvent, type MouseEvent, useRef } from "react";
import { applyTranslation, rawTranslation, useLang } from "../lib/i18n.tsx";

// Übersetzter Text. children = deutscher Default-Text (Fallback, falls der Key noch fehlt,
// und Doku des Quelltexts im Code).
// Produktion / Edit-Modus aus → reiner Text ohne Wrapper.
// Dev + Edit-Modus an → der Text wird direkt inline editierbar (contentEditable); beim
// Klick-weg/Enter wird der Wert der AKTUELL angezeigten Sprache zurück in die JSON geschrieben.
export default function T({ k, children }: { k: string; children?: string }) {
  const { t, editMode } = useLang();
  const fallback = typeof children === "string" ? children : undefined;
  const text = t(k, fallback);

  if (!import.meta.env.DEV || !editMode) return <>{text}</>;
  return <EditableT tk={k} text={text} fallbackDe={fallback} />;
}

function EditableT({ tk, text, fallbackDe }: { tk: string; text: string; fallbackDe?: string }) {
  const { lang, bump } = useLang();
  const ref = useRef<HTMLSpanElement>(null);

  async function commit() {
    const el = ref.current;
    if (!el) return;
    const next = el.textContent ?? "";
    if (next === text) return; // unverändert
    // nur die aktuelle Sprache überschreiben, die andere beibehalten
    const de = lang === "de" ? next : rawTranslation("de", tk) || fallbackDe || "";
    const en = lang === "en" ? next : rawTranslation("en", tk);
    try {
      const r = await fetch("/api/dev/i18n", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: tk, de, en }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      applyTranslation(tk, de, en);
      bump(); // sofortiges Feedback überall, wo der Key verwendet wird
    } catch (e) {
      el.textContent = text; // bei Fehler Originaltext wiederherstellen
      console.error("i18n save failed:", e);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      ref.current?.blur();
    } else if (e.key === "Escape") {
      if (ref.current) ref.current.textContent = text;
      ref.current?.blur();
    }
  }

  // Klick/Mousedown auf den editierbaren Text darf den umgebenden Button/Link nicht auslösen.
  const swallow = (e: MouseEvent) => e.stopPropagation();

  return (
    <span
      ref={ref}
      className="i18n-edit"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-i18n-key={tk}
      title={`i18n: ${tk} — ${lang.toUpperCase()} bearbeiten, Enter speichert`}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onClick={swallow}
      onMouseDown={swallow}
    >
      {text}
    </span>
  );
}
