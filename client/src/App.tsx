import { NavLink, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard.tsx";
import WeekPlan from "./pages/WeekPlan.tsx";
import WeekTrack from "./pages/WeekTrack.tsx";
import WeekReport from "./pages/WeekReport.tsx";
import Settings from "./pages/Settings.tsx";
import OptionsConfig from "./pages/OptionsConfig.tsx";

const NAV = [
  { to: "/", ico: "▣", label: "Dashboard", end: true },
  { to: "/plan", ico: "✎", label: "Wochenplanung" },
  { to: "/track", ico: "✓", label: "Tracking" },
  { to: "/report", ico: "🖨", label: "Wochenbericht" },
  { to: "/settings", ico: "⚙", label: "Einstellungen" },
  { to: "/options", ico: "🏷", label: "Auswahllisten" },
];

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar no-print">
        <div className="brand">Run<span>Log</span></div>
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
          <Route path="/settings" element={<Settings />} />
          <Route path="/options" element={<OptionsConfig />} />
        </Routes>
      </main>
    </div>
  );
}
