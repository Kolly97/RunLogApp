import { useState, type MouseEvent, type ReactNode } from "react";
import { applyTranslation, rawTranslation, useLang } from "../lib/i18n.tsx";

// Übersetzter Text. children = deutscher Default-Text (Fallback, falls der Key noch fehlt,
// und Doku des Quelltexts im Code). In Produktion reiner Text ohne Wrapper; im Dev-Modus
// öffnet Alt+Klick einen kleinen Inline-Editor für DE+EN, der zurück in die JSON-Dateien schreibt.
export default function T({ k, children }: { k: string; children?: ReactNode }) {
  const { t } = useLang();
  const fallback = typeof children === "string" ? children : undefined;
  const text = t(k, fallback);

  if (!import.meta.env.DEV) return <>{text}</>;
  return <DevT tk={k} text={text} fallbackDe={fallback} />;
}

// --- Dev-Editor (nur in import.meta.env.DEV; in Prod tree-geshaked) ---------
function DevT({ tk, text, fallbackDe }: { tk: string; text: string; fallbackDe?: string }) {
  const { bump } = useLang();
  const [editing, setEditing] = useState(false);

  function onClick(e: MouseEvent) {
    if (!e.altKey) return; // normaler Klick (z.B. Nav-Link) läuft durch
    e.preventDefault();
    e.stopPropagation();
    setEditing(true);
  }

  return (
    <span className="i18n-dev" data-i18n-key={tk} onClickCapture={onClick} title={`i18n: ${tk} (Alt+Klick zum Bearbeiten)`}>
      {text}
      {editing && <Editor tk={tk} fallbackDe={fallbackDe} onClose={() => setEditing(false)} onSaved={bump} />}
    </span>
  );
}

function Editor({ tk, fallbackDe, onClose, onSaved }: { tk: string; fallbackDe?: string; onClose: () => void; onSaved: () => void }) {
  const [de, setDe] = useState(() => rawTranslation("de", tk) || fallbackDe || "");
  const [en, setEn] = useState(() => rawTranslation("en", tk));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/dev/i18n", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: tk, de, en }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      applyTranslation(tk, de, en); // sofortiges Feedback; HMR lädt die Datei danach nach
      onSaved();
      onClose();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  // Klicks im Popover dürfen nicht zum umgebenden Element (z.B. Nav-Link) durchschlagen.
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <span className="i18n-pop" onClick={stop} onClickCapture={stop}>
      <span className="i18n-pop-key">{tk}</span>
      <label className="i18n-pop-row">
        <span>DE</span>
        <input value={de} onChange={(e) => setDe(e.target.value)} autoFocus />
      </label>
      <label className="i18n-pop-row">
        <span>EN</span>
        <input value={en} onChange={(e) => setEn(e.target.value)} placeholder="(English)" />
      </label>
      {err && <span className="i18n-pop-err">{err}</span>}
      <span className="i18n-pop-actions">
        <button type="button" disabled={busy} onClick={save}>{busy ? "…" : "Speichern"}</button>
        <button type="button" className="ghost" disabled={busy} onClick={onClose}>Abbrechen</button>
      </span>
    </span>
  );
}
