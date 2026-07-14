// Profil-Menü (v0.12.0, ToDo 6): Profile verwalten (umbenennen/löschen/zurücksetzen) + HF-Zonen/Schwellen.
// Angelehnt an TrainingPeaks/Strava-Profilseiten: alles Profil-Bezogene an einem Ort.
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, type Profile } from "../lib/api.ts";
import ZoneSets from "../components/ZoneSets.tsx";
import LactateTests from "../components/LactateTests.tsx";
import AthleteCard from "../components/AthleteCard.tsx";
import Vo2maxLabCard from "../components/Vo2maxLab.tsx";
import CycleActivationCard from "../components/CycleActivationCard.tsx";
import T from "../components/T.tsx";
import { useT } from "../lib/i18n.tsx";

const CONFIRM_CODE = "4397"; // Bestätigungscode für Umbenennen/Löschen/Zurücksetzen.
const notifyProfilesChanged = () => window.dispatchEvent(new Event("runlog:profiles-updated"));

export default function ProfilePage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [active, setActive] = useState(1);
  const [msg, setMsg] = useState("");
  const location = useLocation();
  const [section, setSection] = useState(() => new URLSearchParams(location.search).get("section") === "accounts" ? "accounts" : "athlete"); // v1.8.0: opt-nav-Bereich
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameDraft, setRenameDraft] = useState<{ id: number; name: string; code: string } | null>(null);
  const [deleteDraft, setDeleteDraft] = useState<{ id: number; code: string } | null>(null);
  const [resetDraft, setResetDraft] = useState<{ id: number; code: string } | null>(null);
  const t = useT();
  const reload = () => api.profiles().then((r) => { setProfiles(r.profiles); setActive(r.active); }).catch(() => {});
  useEffect(() => { reload(); }, []);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get("section") === "accounts") setSection("accounts");
    if (q.get("new") === "1") setAddOpen(true);
  }, [location.search]);
  useEffect(() => {
    const openAdd = () => { setSection("accounts"); setAddOpen(true); };
    window.addEventListener("runlog:profile-add-requested", openAdd);
    return () => window.removeEventListener("runlog:profile-add-requested", openAdd);
  }, []);

  async function addProfile() {
    const name = newName.trim();
    if (!name) return;
    try {
      const r = await api.addProfile(name);
      await api.setActiveProfile(r.id);
      setNewName("");
      setAddOpen(false);
      setMsg(`Profil „${name}" angelegt und aktiviert.`);
      await reload();
      notifyProfilesChanged();
    } catch {
      alert("Profil konnte nicht angelegt werden.");
    }
  }

  async function rename(p: Profile) {
    if (!renameDraft || renameDraft.id !== p.id) return;
    const name = renameDraft.name.trim();
    if (!name || name === p.name) { setRenameDraft(null); return; }
    if (renameDraft.code !== CONFIRM_CODE) { alert("Falscher Code."); return; }
    try {
      await api.renameProfile(p.id, name);
      setRenameDraft(null);
      setMsg(`Profil „${p.name}" in „${name}" umbenannt.`);
      await reload();
      notifyProfilesChanged();
    } catch {
      alert("Umbenennen fehlgeschlagen.");
    }
  }
  async function remove(p: Profile) {
    if (p.id === active) { alert("Das aktive Profil kann nicht gelöscht werden — erst wechseln."); return; }
    if (!deleteDraft || deleteDraft.id !== p.id) return;
    if (deleteDraft.code !== CONFIRM_CODE) { alert("Falscher Code."); return; }
    if (!window.confirm(`Profil „${p.name}" mit ALLEN Daten unwiderruflich löschen?`)) return;
    try {
      await api.deleteProfile(p.id);
      setDeleteDraft(null);
      setMsg(`Profil „${p.name}" gelöscht.`);
      await reload();
      notifyProfilesChanged();
    }
    catch { alert("Löschen nicht möglich (geschütztes/aktives Profil)."); }
  }
  async function reset(p: Profile) {
    if (!resetDraft || resetDraft.id !== p.id) return;
    if (resetDraft.code !== CONFIRM_CODE) { alert("Falscher Code."); return; }
    if (!window.confirm(`Profil „${p.name}" zurücksetzen?\n\nLöscht ALLE Trainings- & Plandaten: Aktivitäten, Tagesfaktoren, Wochenlogs, geplante Einheiten, Saisonplan (geplante km) und Wettkämpfe.\nNur die HF-Zonen/Schwellen bleiben erhalten. (DB-Backup wird angelegt.)`)) return;
    try {
      const r = await api.resetProfile(p.id, resetDraft.code);
      setResetDraft(null);
      setMsg(`„${p.name}" zurückgesetzt: ${r.activities} Aktivitäten, ${r.daily} Tagesfaktoren, ${r.weeklogs} Wochenlogs, ${r.sessions} geplante Einheiten, ${r.weeks} Saison-Wochen, ${r.races} Wettkämpfe gelöscht. Backup angelegt.`);
      await reload();
    } catch { alert("Zurücksetzen fehlgeschlagen."); }
  }

  // v1.8.0: aufgeräumt wie die Auswahllisten — Bereiche links, Inhalt rechts (statt langer Karten-Liste).
  const SECTIONS = [
    { key: "athlete", title: t("profile.sec.athlete", "Athlet") },
    { key: "zones", title: t("profile.sec.zones", "Zonen & Schwellen") },
    { key: "tests", title: t("profile.sec.tests", "Leistungstests") },
    { key: "cycle", title: t("profile.sec.cycle", "Zyklus") },
    { key: "accounts", title: t("profile.sec.accounts", "Profile / Accounts") },
  ];

  return (
    <div>
      <h1><T k="profile.title">Profil</T></h1>
      <p className="muted tiny" style={{ marginTop: -4 }}>
        <T k="profile.hint">Athlet, Zonen/Schwellen und Leistungstests des aktiven Profils — Verfügbarkeit, Vorlieben & eigene Einheiten findest du jetzt im Coach.</T>
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
          {section === "tests" && <><LactateTests /><Vo2maxLabCard /></>}
          {section === "cycle" && <CycleActivationCard />}
          {section === "accounts" && (
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <h2 style={{ marginBottom: 0 }}><T k="profile.accounts.title">Profile / Accounts</T></h2>
                <button type="button" className="sm" onClick={() => setAddOpen(true)}>+ <T k="profile.btn.add">Account</T></button>
              </div>
              <p className="tiny muted"><T k="profile.accounts.hint">Wechseln oben in der Seitenleiste. Umbenennen, Löschen und Zurücksetzen erfordern den Bestätigungscode. „Kolja" (Bestandsdaten) ist vor dem Löschen geschützt.</T></p>
              {addOpen && (
                <div className="row" style={{ gap: 8, margin: "10px 0 12px" }}>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addProfile(); }}
                    placeholder={t("profile.add.placeholder", "Neuer Accountname")}
                  />
                  <button type="button" className="sm" onClick={addProfile}><T k="profile.btn.create">Anlegen</T></button>
                  <button type="button" className="sm ghost" onClick={() => { setAddOpen(false); setNewName(""); }}><T k="common.cancel">Abbrechen</T></button>
                </div>
              )}
              <table>
                <thead><tr><th><T k="profile.table.col">Profil</T></th><th></th></tr></thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {renameDraft?.id === p.id ? (
                          <div className="row" style={{ gap: 8 }}>
                            <input
                              value={renameDraft.name}
                              onChange={(e) => setRenameDraft({ ...renameDraft, name: e.target.value })}
                              onKeyDown={(e) => { if (e.key === "Enter") rename(p); }}
                              aria-label={t("profile.rename.name", "Neuer Profilname")}
                            />
                            <input
                              type="password"
                              value={renameDraft.code}
                              onChange={(e) => setRenameDraft({ ...renameDraft, code: e.target.value })}
                              onKeyDown={(e) => { if (e.key === "Enter") rename(p); }}
                              placeholder={t("profile.rename.code", "Code")}
                              aria-label={t("profile.rename.code", "Code")}
                              style={{ maxWidth: 90 }}
                            />
                            <button type="button" className="sm" onClick={() => rename(p)}><T k="common.save">Speichern</T></button>
                            <button type="button" className="sm ghost" onClick={() => setRenameDraft(null)}><T k="common.cancel">Abbrechen</T></button>
                          </div>
                        ) : resetDraft?.id === p.id ? (
                          <div className="row" style={{ gap: 8 }}>
                            <span>{p.name}</span>
                            <input
                              type="password"
                              value={resetDraft.code}
                              onChange={(e) => setResetDraft({ ...resetDraft, code: e.target.value })}
                              onKeyDown={(e) => { if (e.key === "Enter") reset(p); }}
                              placeholder={t("profile.reset.code", "Code")}
                              aria-label={t("profile.reset.code", "Code")}
                              style={{ maxWidth: 90 }}
                            />
                            <button type="button" className="sm danger" onClick={() => reset(p)}><T k="profile.btn.reset.final">Zurücksetzen</T></button>
                            <button type="button" className="sm ghost" onClick={() => setResetDraft(null)}><T k="common.cancel">Abbrechen</T></button>
                          </div>
                        ) : deleteDraft?.id === p.id ? (
                          <div className="row" style={{ gap: 8 }}>
                            <span>{p.name}</span>
                            <input
                              type="password"
                              value={deleteDraft.code}
                              onChange={(e) => setDeleteDraft({ ...deleteDraft, code: e.target.value })}
                              onKeyDown={(e) => { if (e.key === "Enter") remove(p); }}
                              placeholder={t("profile.delete.code", "Code")}
                              aria-label={t("profile.delete.code", "Code")}
                              style={{ maxWidth: 90 }}
                            />
                            <button type="button" className="sm danger" onClick={() => remove(p)}><T k="profile.btn.delete.final">Endgültig löschen</T></button>
                            <button type="button" className="sm ghost" onClick={() => setDeleteDraft(null)}><T k="common.cancel">Abbrechen</T></button>
                          </div>
                        ) : (
                          <>{p.name}{p.id === active ? ` · ${t("profile.active", "aktiv")}` : ""}{p.id === 1 ? ` · ${t("profile.legacy", "Bestandsdaten")}` : ""}</>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {deleteDraft?.id !== p.id && resetDraft?.id !== p.id && (
                          <>
                            <button type="button" className="sm ghost" onClick={() => { setDeleteDraft(null); setResetDraft(null); setRenameDraft({ id: p.id, name: p.name, code: "" }); }}><T k="profile.btn.rename">Umbenennen</T></button>
                            <button className="sm ghost danger" onClick={() => { setRenameDraft(null); setDeleteDraft(null); setResetDraft({ id: p.id, code: "" }); }} title={t("profile.btn.reset.title", "Alle Trainings- & Plandaten löschen (Aktivitäten, Einheiten, Saisonplan, Races), nur Zonen behalten")}><T k="profile.btn.reset">Zurücksetzen</T></button>
                            {p.id !== 1 && <button className="sm ghost danger" onClick={() => { setRenameDraft(null); setResetDraft(null); setDeleteDraft({ id: p.id, code: "" }); }}><T k="profile.btn.delete">Löschen</T></button>}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Tutorial-Profil: Isabel-Demo zum Ausprobieren aller Funktionen (zugleich Guide des Tutorials). */}
              <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div className="tiny muted" style={{ marginBottom: 6 }}>
                  <T k="profile.tutorial.hint">„Tutorial: Isabel" enthält 18 Monate fiktive, physiologisch plausible Halbmarathon-Daten plus Zukunftsplan, Feedback und Zyklus-Demo. Isabel führt auch durch das Tutorial (Lernen-Seite). Deine echten Daten bleiben unberührt.</T>
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
