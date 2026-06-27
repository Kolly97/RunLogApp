// Profil-Menü (v0.12.0, ToDo 6): Profile verwalten (umbenennen/löschen/zurücksetzen) + HF-Zonen/Schwellen.
// Angelehnt an TrainingPeaks/Strava-Profilseiten: alles Profil-Bezogene an einem Ort.
import { useEffect, useState } from "react";
import { api, type Profile } from "../lib/api.ts";
import ZoneSets from "../components/ZoneSets.tsx";
import LactateTests from "../components/LactateTests.tsx";
import AthleteCard from "../components/AthleteCard.tsx";
import AvailabilityCard from "../components/AvailabilityCard.tsx";
import CustomWorkoutsCard from "../components/CustomWorkoutsCard.tsx";
import Vo2maxLabCard from "../components/Vo2maxLab.tsx";
import T from "../components/T.tsx";
import { useT } from "../lib/i18n.tsx";

const CONFIRM_CODE = "4397"; // Bestätigungscode für Umbenennen/Löschen/Zurücksetzen.

export default function ProfilePage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [active, setActive] = useState(1);
  const [msg, setMsg] = useState("");
  const [section, setSection] = useState("athlete"); // v1.8.0: opt-nav-Bereich
  const t = useT();
  const reload = () => api.profiles().then((r) => { setProfiles(r.profiles); setActive(r.active); }).catch(() => {});
  useEffect(() => { reload(); }, []);

  async function rename(p: Profile) {
    const name = window.prompt(`Profil „${p.name}" umbenennen in:`, p.name)?.trim();
    if (!name || name === p.name) return;
    if (window.prompt(`Zum Bestätigen Code eingeben:`) !== CONFIRM_CODE) { alert("Falscher Code."); return; }
    await api.renameProfile(p.id, name);
    reload();
  }
  async function remove(p: Profile) {
    if (p.id === active) { alert("Das aktive Profil kann nicht gelöscht werden — erst wechseln."); return; }
    if (!window.confirm(`Profil „${p.name}" mit ALLEN Daten unwiderruflich löschen?`)) return;
    if (window.prompt(`Zum endgültigen Löschen Code eingeben:`) !== CONFIRM_CODE) { alert("Falscher Code."); return; }
    try { await api.deleteProfile(p.id); reload(); }
    catch { alert("Löschen nicht möglich (geschütztes/aktives Profil)."); }
  }
  async function reset(p: Profile) {
    if (!window.confirm(`Profil „${p.name}" zurücksetzen?\n\nLöscht ALLE Trainings- & Plandaten: Aktivitäten, Tagesfaktoren, Wochenlogs, geplante Einheiten, Saisonplan (geplante km) und Wettkämpfe.\nNur die HF-Zonen/Schwellen bleiben erhalten. (DB-Backup wird angelegt.)`)) return;
    const code = window.prompt(`Zum Zurücksetzen Code eingeben:`);
    if (code !== CONFIRM_CODE) { alert("Falscher Code."); return; }
    try {
      const r = await api.resetProfile(p.id, code);
      setMsg(`„${p.name}" zurückgesetzt: ${r.activities} Aktivitäten, ${r.daily} Tagesfaktoren, ${r.weeklogs} Wochenlogs, ${r.sessions} geplante Einheiten, ${r.weeks} Saison-Wochen, ${r.races} Wettkämpfe gelöscht. Backup angelegt.`);
      reload();
    } catch { alert("Zurücksetzen fehlgeschlagen."); }
  }

  // v1.8.0: aufgeräumt wie die Auswahllisten — Bereiche links, Inhalt rechts (statt langer Karten-Liste).
  const SECTIONS = [
    { key: "athlete", title: t("profile.sec.athlete", "Athlet") },
    { key: "zones", title: t("profile.sec.zones", "Zonen & Schwellen") },
    { key: "availability", title: t("profile.sec.availability", "Verfügbarkeit & Block-Präferenzen") },
    { key: "tests", title: t("profile.sec.tests", "Leistungstests") },
    { key: "accounts", title: t("profile.sec.accounts", "Profile / Accounts") },
  ];

  return (
    <div>
      <h1><T k="profile.title">Profil</T></h1>
      <p className="muted tiny" style={{ marginTop: -4 }}>
        <T k="profile.hint">Athlet, Zonen, Verfügbarkeit, Block-Präferenzen und Leistungstests des aktiven Profils — links den Bereich wählen.</T>
      </p>
      {msg && <div className="flag ok"><span className="dot" /><span>{msg}</span></div>}

      <div className="opt-layout">
        <nav className="opt-nav">
          {SECTIONS.map((s) => (
            <button key={s.key} className={section === s.key ? "active" : ""} onClick={() => setSection(s.key)}>
              <span>{s.title}</span>
            </button>
          ))}
        </nav>
        <div className="opt-panel" key={section}>
          {section === "athlete" && <AthleteCard />}
          {section === "zones" && <ZoneSets />}
          {section === "availability" && <><AvailabilityCard /><CustomWorkoutsCard /></>}
          {section === "tests" && <><LactateTests /><Vo2maxLabCard /></>}
          {section === "accounts" && (
            <div className="card">
              <h2><T k="profile.accounts.title">Profile / Accounts</T></h2>
              <p className="tiny muted"><T k="profile.accounts.hint">Wechseln oben in der Seitenleiste. Umbenennen, Löschen und Zurücksetzen erfordern den Bestätigungscode. „Kolja" (Bestandsdaten) ist vor dem Löschen geschützt.</T></p>
              <table>
                <thead><tr><th><T k="profile.table.col">Profil</T></th><th></th></tr></thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}{p.id === active ? ` · ${t("profile.active", "aktiv")}` : ""}{p.id === 1 ? ` · ${t("profile.legacy", "Bestandsdaten")}` : ""}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="sm ghost" onClick={() => rename(p)}><T k="profile.btn.rename">Umbenennen</T></button>
                        <button className="sm ghost danger" onClick={() => reset(p)} title={t("profile.btn.reset.title", "Alle Trainings- & Plandaten löschen (Aktivitäten, Einheiten, Saisonplan, Races), nur Zonen behalten")}><T k="profile.btn.reset">Zurücksetzen</T></button>
                        {p.id !== 1 && <button className="sm ghost danger" onClick={() => remove(p)}><T k="profile.btn.delete">Löschen</T></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Tutorial-Profil (v1.8.0): Beispieljahr zum Ausprobieren aller Funktionen. */}
              <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div className="tiny muted" style={{ marginBottom: 6 }}>
                  <T k="profile.tutorial.hint">Das „Tutorial"-Profil enthält ein erfundenes, realistisches Beispieljahr (Alex Demo) — wechsle oben darauf, um alle Funktionen mit Daten zu sehen. Deine echten Daten bleiben unberührt.</T>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="sm ghost" onClick={async () => { if (!window.confirm("Tutorial-Profil neu erzeugen? (überschreibt das vorhandene Tutorial-Profil)")) return; await api.regenerateTutorial().catch(() => {}); setMsg("Tutorial-Profil neu erzeugt."); reload(); }}>
                    <T k="profile.tutorial.regen">Tutorial neu erzeugen</T>
                  </button>
                  <button className="sm ghost danger" onClick={async () => { if (!window.confirm("Tutorial-Profil löschen?")) return; await api.deleteTutorial().catch(() => {}); setMsg("Tutorial-Profil gelöscht."); reload(); }}>
                    <T k="profile.tutorial.del">Tutorial löschen</T>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
