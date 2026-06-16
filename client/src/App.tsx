import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api, type Profile } from "./lib/api.ts";
import Dashboard from "./pages/Dashboard.tsx";
import WeekPlan from "./pages/WeekPlan.tsx";
import WeekTrack from "./pages/WeekTrack.tsx";
import WeekReport from "./pages/WeekReport.tsx";
import LongTerm from "./pages/LongTerm.tsx";
import Races from "./pages/Races.tsx";
import Bests from "./pages/Bests.tsx";
import SeasonPlan from "./pages/SeasonPlan.tsx";
import Settings from "./pages/Settings.tsx";
import ProfilePage from "./pages/Profile.tsx";
import OptionsConfig from "./pages/OptionsConfig.tsx";
import pkg from "../../package.json";

// Stand des letzten inhaltlichen Updates (Footer/Impressum, #75).
const BUILD_DATE = "16.06.2026";

const NAV = [
  { to: "/", ico: "▣", label: "Dashboard", end: true },
  { to: "/plan", ico: "✎", label: "Wochenplanung" },
  { to: "/track", ico: "✓", label: "Tracking" },
  { to: "/report", ico: "🖨", label: "Wochenbericht" },
  { to: "/longterm", ico: "📈", label: "Langzeit" },
  { to: "/races", ico: "🏁", label: "Races" },
  { to: "/bests", ico: "🏅", label: "Bestzeiten" },
  { to: "/season", ico: "🗓", label: "Saisonplan" },
  { to: "/profile", ico: "👤", label: "Profil" },
  { to: "/settings", ico: "⚙", label: "Einstellungen" },
  { to: "/options", ico: "🏷", label: "Auswahllisten" },
];

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar no-print">
        <div className="brand">Run<span>Log</span></div>
        <ProfileSwitcher />
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
              <span className="ico">{n.ico}</span> {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/plan" element={<WeekPlan />} />
          <Route path="/track" element={<WeekTrack />} />
          <Route path="/report" element={<WeekReport />} />
          <Route path="/longterm" element={<LongTerm />} />
          <Route path="/races" element={<Races />} />
          <Route path="/bests" element={<Bests />} />
          <Route path="/season" element={<SeasonPlan />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/options" element={<OptionsConfig />} />
        </Routes>
        <footer className="footer no-print">
          Erstellt von Kolja Hildenbrand mit Claude (Fable 5) · v{pkg.version} · Stand {BUILD_DATE} ·{" "}
          <a href="/usage.html" target="_blank" rel="noreferrer">Anleitung</a>
        </footer>
      </main>
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
