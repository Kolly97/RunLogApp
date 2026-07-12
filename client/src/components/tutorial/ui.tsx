// Isabel-Tutorial: geteilte Mini-UI (Karte + Kopfzeile) — genutzt vom TutorialHost und vom Chart-Kino.
import type { CSSProperties } from "react";

// OverlayPortal lebt jetzt app-weit in components/OverlayPortal.tsx (auch SessionModal & Co. nutzen ihn);
// hier nur re-exportiert, damit bestehende Tutorial-Importe stabil bleiben.
export { OverlayPortal } from "../OverlayPortal.tsx";

export const AVATAR: CSSProperties = {
  width: 30, height: 30, borderRadius: 999, flex: "0 0 auto",
  background: "linear-gradient(135deg, #f0b429 0%, #f59e0b 55%, #2dd4bf 130%)",
  color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
  fontWeight: 800, fontSize: 14, boxShadow: "0 1px 4px rgba(15,23,42,0.25)",
};

export const CARD: CSSProperties = {
  background: "var(--card)", borderRadius: 14, boxShadow: "0 10px 30px rgba(15,23,42,0.3)", padding: 16,
};

export function IsabelHead({ sub }: { sub: string }) {
  return (
    <div className="row" style={{ gap: 9, alignItems: "center", marginBottom: 8 }}>
      <span style={AVATAR}>I</span>
      <span>
        <strong style={{ fontSize: 13, display: "block", lineHeight: 1.2 }}>Isabel</strong>
        <span className="tiny muted">{sub}</span>
      </span>
    </div>
  );
}
