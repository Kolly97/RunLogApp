import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api, type Profile } from "./lib/api.ts";
import { useLang } from "./lib/i18n.tsx";
import T from "./components/T.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import WeekPlan from "./pages/WeekPlan.tsx";
import WeekTrack from "./pages/WeekTrack.tsx";
import WeekReport from "./pages/WeekReport.tsx";
import LongTerm from "./pages/LongTerm.tsx";
import Races from "./pages/Races.tsx";
import Bests from "./pages/Bests.tsx";
import Settings from "./pages/Settings.tsx";
import ProfilePage from "./pages/Profile.tsx";
import OptionsConfig from "./pages/OptionsConfig.tsx";
import pkg from "../../package.json";

// Stand des letzten inhaltlichen Updates (Footer/Impressum, #75).
const BUILD_DATE = "17.06.2026";

const NAV = [
  { to: "/", ico: "▣", tk: "nav.dashboard", label: "Dashboard", end: true },
  { to: "/plan", ico: "✎", tk: "nav.plan", label: "Wochenplanung" },
  { to: "/track", ico: "✓", tk: "nav.track", label: "Tracking" },
  { to: "/report", ico: "🖨", tk: "nav.report", label: "Wochenbericht" },
  { to: "/longterm", ico: "📈", tk: "nav.longterm", label: "Langzeit" },
  { to: "/races", ico: "🏁", tk: "nav.races", label: "Races" },
  { to: "/bests", ico: "🏅", tk: "nav.bests", label: "Bestzeiten" },
  { to: "/profile", ico: "👤", tk: "nav.profile", label: "Profil" },
  { to: "/settings", ico: "⚙", tk: "nav.settings", label: "Einstellungen" },
  { to: "/options", ico: "🏷", tk: "nav.options", label: "Auswahllisten" },
];

export default function App() {
  useEffect(() => { api.cleanupOrphans().catch(() => {}); }, []);
  const location = useLocation();
  return (
    <div className="app">
      <aside className="sidebar no-print">
        <div className="brand">Run<span>Log</span></div>
        <ProfileSwitcher />
        <LangSwitcher />
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
              <span className="ico">{n.ico}</span> <T k={n.tk}>{n.label}</T>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main">
        <div key={location.pathname} className="route-enter">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/plan" element={<WeekPlan />} />
            <Route path="/track" element={<WeekTrack />} />
            <Route path="/report" element={<WeekReport />} />
            <Route path="/longterm" element={<LongTerm />} />
            <Route path="/races" element={<Races />} />
            <Route path="/bests" element={<Bests />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/options" element={<OptionsConfig />} />
          </Routes>
        </div>
        <footer className="footer no-print">
          Erstellt von Kolja Hildenbrand mit Claude (Fable 5) · v{pkg.version} · Stand {BUILD_DATE} ·{" "}
          <a href="/usage.html" target="_blank" rel="noreferrer"><T k="footer.guide">Anleitung</T></a>
        </footer>
      </main>
    </div>
  );
}

// Sprachumschalter DE/EN (i18n). Auswahl in localStorage, kein Reload nötig.
// Im Dev-Build zusätzlich ein ✎-Schalter für den Inline-Übersetzungs-Edit-Modus.
function LangSwitcher() {
  const { lang, setLang, editMode, setEditMode } = useLang();
  return (
    <div className="lang-switch" role="group" aria-label="Sprache">
      {(["de", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          className={lang === l ? "active" : ""}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
      {import.meta.env.DEV && (
        <button
          type="button"
          className={editMode ? "active edit" : "edit"}
          title="Übersetzungs-Edit-Modus: Texte direkt anklicken und überschreiben"
          onClick={() => setEditMode(!editMode)}
        >
          ✎
        </button>
      )}
    </div>
  );
}

// Leichter Account-Wechsel (ToDo #9): aktives Profil global serverseitig; Wechsel lädt die App neu.
function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [active, setActive] = useState<number>(1);

  useEffect(() => {
    api.profiles().then((r) => { setProfiles(r.profiles); setActive(r.active); }).catch(() => {});
  }, []);

  async function switchTo(v: string) {
    if (v === "__new__") {
      const name = window.prompt("Name des neuen Profils (z.B. Isabel):")?.trim();
      if (!name) return;
      const r = await api.addProfile(name);
      await api.setActiveProfile(r.id);
      location.reload();
      return;
    }
    const id = Number(v);
    if (id === active) return;
    await api.setActiveProfile(id);
    location.reload();
  }

  if (!profiles.length) return null;
  return (
    <div className="profile-switch">
      <span className="ico">👤</span>
      <select value={active} onChange={(e) => switchTo(e.target.value)} title="Aktives Profil">
        {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value="__new__">+ Neues Profil…</option>
      </select>
    </div>
  );
}
