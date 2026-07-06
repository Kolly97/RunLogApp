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
import Methodik from "./pages/Methodik.tsx";
import Settings from "./pages/Settings.tsx";
import ProfilePage from "./pages/Profile.tsx";
import OptionsConfig from "./pages/OptionsConfig.tsx";
import Lernen from "./pages/Lernen.tsx";
import Coach from "./pages/Coach.tsx";
import { PageActionsProvider, PageActionsBar } from "./components/PageActionsBar.tsx";
import Coachmark from "./components/Coachmark.tsx";
import BrandMark from "./components/BrandMark.tsx";
import Celebration from "./components/Celebration.tsx";
import Intro from "./components/Intro.tsx";
import PbWatcher from "./components/PbWatcher.tsx";
import AchievementWatcher from "./components/AchievementWatcher.tsx";
import KonamiLab from "./components/KonamiLab.tsx";
import NerdKeybind from "./components/NerdKeybind.tsx";
import NerdPage from "./pages/NerdPage.tsx";
import { applyTheme, getThemePref, setThemePref, type ThemePref } from "./lib/theme.ts";
import { motionEnabled, getMotionPref, setMotionPref } from "./lib/motion.ts";
import { useSparkPref, setSparkPref } from "./lib/sparkPref.ts";
import pkg from "../../package.json";

// T15: globaler Footer-Toggle für Marker-Sparklines (Pref in localStorage, gelesen auf der Methodik-Seite).
function SparkToggle() {
  const on = useSparkPref();
  return (
    <button type="button" className="linklike" onClick={() => setSparkPref(!on)}
      title="Marker-Verläufe (Sparklines) auf der Methodik-Seite ein-/ausblenden"
      style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "var(--accent)", cursor: "pointer" }}>
      Sparklines: {on ? "an" : "aus"}
    </button>
  );
}

// Stand des letzten inhaltlichen Updates (Footer/Impressum, #75).
const BUILD_DATE = "04.07.2026"; // v2.6.0

// v1.10.0 UI-Konzept A2: Navigation in 5 Gruppen entlang der echten Nutzungs-Schleifen (Heute · Planen · Tracken ·
// Analysieren · Lernen) + Einstellungen separat. Routen unverändert.
type NavItem = { to: string; ico: string; tk: string; label: string; end?: boolean };
const NAV_GROUPS: { label?: string; tk?: string; items: NavItem[] }[] = [
  { items: [{ to: "/", ico: "▣", tk: "nav.dashboard", label: "Dashboard", end: true }] },
  { label: "Planen", tk: "nav.group.plan", items: [
    { to: "/plan", ico: "✎", tk: "nav.plan", label: "Wochenplanung" },
    { to: "/coach", ico: "🧭", tk: "nav.coach", label: "Coach" },
  ] },
  { label: "Tracken", tk: "nav.group.track", items: [
    { to: "/track", ico: "✓", tk: "nav.track", label: "Tracking" },
  ] },
  { label: "Analysieren", tk: "nav.group.analyze", items: [
    { to: "/report", ico: "🖨", tk: "nav.report", label: "Wochenbericht" },
    { to: "/longterm", ico: "📈", tk: "nav.longterm", label: "Langzeit" },
    { to: "/bests", ico: "🏅", tk: "nav.bests", label: "Bestzeiten" },
    { to: "/methodik", ico: "🔬", tk: "nav.methodik", label: "Methodik" },
    { to: "/races", ico: "🏁", tk: "nav.races", label: "Races" },
  ] },
  { label: "Lernen", tk: "nav.group.learn", items: [
    { to: "/lernen", ico: "🎓", tk: "nav.lernen", label: "Lernen" },
  ] },
  { label: "Einstellungen", tk: "nav.group.settings", items: [
    { to: "/profile", ico: "👤", tk: "nav.profile", label: "Profil" },
    { to: "/settings", ico: "⚙", tk: "nav.settings", label: "Einstellungen" },
    { to: "/options", ico: "🏷", tk: "nav.options", label: "Auswahllisten" },
  ] },
];

export default function App() {
  useEffect(() => { api.cleanupOrphans().catch(() => {}); }, []);
  // M1/M2: Theme + Animations-Status auf <html> spiegeln (Auto folgt dem System; reagiert auf Pref-/System-Wechsel).
  useEffect(() => {
    const apply = () => {
      applyTheme();
      document.documentElement.setAttribute("data-motion", motionEnabled() ? "on" : "off");
    };
    apply();
    window.addEventListener("runlog-theme-change", apply);
    window.addEventListener("runlog-motion-change", apply);
    const mqD = window.matchMedia("(prefers-color-scheme: dark)");
    const mqR = window.matchMedia("(prefers-reduced-motion: reduce)");
    mqD.addEventListener?.("change", apply);
    mqR.addEventListener?.("change", apply);
    return () => {
      window.removeEventListener("runlog-theme-change", apply);
      window.removeEventListener("runlog-motion-change", apply);
      mqD.removeEventListener?.("change", apply);
      mqR.removeEventListener?.("change", apply);
    };
  }, []);
  const location = useLocation();
  return (
    <PageActionsProvider>
    <div className="app">
      <aside className="sidebar no-print">
        <BrandMark />
        <ProfileSwitcher />
        <LangSwitcher />
        <ThemeMotionControls />
        <nav className="nav">
          {NAV_GROUPS.map((g, gi) => (
            <div key={gi} className="nav-group">
              {g.label && <div className="nav-group-label">{g.tk ? <T k={g.tk}>{g.label}</T> : g.label}</div>}
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
                  <span className="ico">{n.ico}</span> <T k={n.tk}>{n.label}</T>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main className="main">
        <div key={location.pathname} className="route-enter">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/plan" element={<WeekPlan />} />
            <Route path="/coach" element={<Coach />} />
            <Route path="/track" element={<WeekTrack />} />
            <Route path="/report" element={<WeekReport />} />
            <Route path="/longterm" element={<LongTerm />} />
            <Route path="/races" element={<Races />} />
            <Route path="/bests" element={<Bests />} />
            <Route path="/methodik" element={<Methodik />} />
            <Route path="/lernen" element={<Lernen />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/options" element={<OptionsConfig />} />
            {/* v2.8.0 (Item 4): versteckte Nerd-Seite — bewusst NICHT in NAV_GROUPS gelistet, nur per Tastenkombi erreichbar. */}
            <Route path="/nerd" element={<NerdPage />} />
          </Routes>
        </div>
        <footer className="footer no-print">
          Erstellt von Kolja Hildenbrand mit Claude (Fable 5) · v{pkg.version} · Stand {BUILD_DATE} ·{" "}
          <a href="/usage.html" target="_blank" rel="noreferrer"><T k="footer.guide">Anleitung</T></a> ·{" "}
          <SparkToggle />
        </footer>
        <PageActionsBar />
      </main>
      <Coachmark />
      <Celebration />
      <PbWatcher />
      <AchievementWatcher />
      <KonamiLab />
      <NerdKeybind />
      <Intro />
    </div>
    </PageActionsProvider>
  );
}

// M1/M2: Theme- (Auto/Hell/Dunkel) + Animations-Schalter im Sidebar-Fuß.
function ThemeMotionControls() {
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const [motion, setMotion] = useState(getMotionPref());
  const cycleTheme = () => { const next: ThemePref = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto"; setThemePref(next); setTheme(next); };
  const toggleMotion = () => { const next = motion === "on" ? "off" : "on"; setMotionPref(next); setMotion(next); };
  const themeIcon = theme === "auto" ? "🌓" : theme === "light" ? "☀️" : "🌙";
  const themeLabel = theme === "auto" ? "Auto" : theme === "light" ? "Hell" : "Dunkel";
  return (
    <div className="theme-motion no-print">
      <button className="tm-btn" onClick={cycleTheme} title={`Theme: ${themeLabel} — klicken zum Wechseln`}><span>{themeIcon}</span> {themeLabel}</button>
      <button className="tm-btn" onClick={toggleMotion} title={motion === "on" ? "Animationen an (klicken zum Ausschalten)" : "Animationen aus (klicken zum Einschalten)"}>{motion === "on" ? "✨" : "⏸"}</button>
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
