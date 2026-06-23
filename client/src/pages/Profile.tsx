// Profil-Menü (v0.12.0, ToDo 6): Profile verwalten (umbenennen/löschen/zurücksetzen) + HF-Zonen/Schwellen.
// Angelehnt an TrainingPeaks/Strava-Profilseiten: alles Profil-Bezogene an einem Ort.
import { useEffect, useState } from "react";
import { api, type Profile } from "../lib/api.ts";
import ZoneSets from "../components/ZoneSets.tsx";
import LactateTests from "../components/LactateTests.tsx";
import AthleteCard from "../components/AthleteCard.tsx";
import AvailabilityCard from "../components/AvailabilityCard.tsx";
import T from "../components/T.tsx";
import { useT } from "../lib/i18n.tsx";

const CONFIRM_CODE = "4397"; // Bestätigungscode für Umbenennen/Löschen/Zurücksetzen.

export default function ProfilePage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [active, setActive] = useState(1);
  const [msg, setMsg] = useState("");
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

  return (
    <div>
      <h1><T k="profile.title">Profil</T></h1>
      {msg && <div className="flag ok"><span className="dot" /><span>{msg}</span></div>}

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
      </div>

      {/* Athletendaten (Geburtsjahr/Geschlecht/Gewicht/Max-HF) — Grundlage für VO2max-Niveau & TSS */}
      <AthleteCard />

      {/* HF-Zonen & Schwellen des aktiven Profils */}
      <ZoneSets />

      {/* Trainings-Verfügbarkeit (A1, v1.4.0) */}
      <AvailabilityCard />

      {/* Laktat-/Feldtest-Diagnostik (G3, v1.3.0) */}
      <LactateTests />
    </div>
  );
}
