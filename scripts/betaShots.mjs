// Beta-Screenshot-Harness: fährt jede Persona durch die relevanten Seiten und legt Full-Page-PNGs ab.
// Voraussetzung: Dev-Server (Express :3000) + Vite (:5173) laufen. Aufruf: node scripts/betaShots.mjs [personaId...]
// Härtung: unterdrückt Onboarding-Touren/Intro (localStorage-Stub), verifiziert das aktive Profil vor jedem Shot
// (gegen Races), und erfasst die Methodik-Tabs einzeln.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "http://localhost:3000";
const APP = "http://localhost:5173";
const OUT = join(ROOT, "beta-test", "screenshots");

const PERSONAS = [
  { id: 101, slug: "clara" }, { id: 102, slug: "jonas" }, { id: 103, slug: "petra" }, { id: 104, slug: "mira" },
  { id: 105, slug: "sina" }, { id: 106, slug: "tom" }, { id: 107, slug: "elite" }, { id: 108, slug: "ultra" },
];
const CYCLE = new Set([104, 105]);
const ROUTES = [
  ["dashboard", "/"], ["coach", "/coach"], ["plan", "/plan"], ["track", "/track"], ["report", "/report"],
  ["longterm", "/longterm"], ["bests", "/bests"], ["races", "/races"], ["profile", "/profile"], ["nerd", "/nerd"],
];
// Methodik separat: Tabs einzeln
const METHODIK_TABS = [["methodik-status", "Status"], ["methodik-waswirkt", "Was wirkt?"], ["methodik-experimente", "Experimente"]];

const only = process.argv.slice(2).map(Number).filter(Boolean);
const targets = only.length ? PERSONAS.filter((p) => only.includes(p.id)) : PERSONAS;

async function setActive(id) {
  const r = await fetch(`${API}/api/profile/active`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
  if (!r.ok) throw new Error(`setActive ${id} → ${r.status}`);
  // Verifizieren (gegen Race mit anderen Prozessen)
  const a = (await (await fetch(`${API}/api/profiles`)).json()).active;
  if (a !== id) throw new Error(`active-Profil ist ${a}, erwartet ${id} — läuft ein zweiter Harness?`);
}
async function clean(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => document.querySelectorAll(".intro-overlay").forEach((e) => e.remove()));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
// Onboarding-Touren/Intro dauerhaft als „gesehen" stubben, damit keine Overlays die Screenshots verdecken.
await ctx.addInitScript(() => {
  const _get = Storage.prototype.getItem;
  Storage.prototype.getItem = function (k) { return /^(tour-|runlog-tour)|onboard|intro/i.test(k) ? "1" : _get.call(this, k); };
});
// v2.10.0: Isabel-Tutorial-Welcome unterdrücken (Fortschritt kommt vom Server, nicht aus localStorage).
await ctx.route("**/api/tutorial/progress", (route) => {
  if (route.request().method() === "GET") route.fulfill({ json: { done: [], dismissed: true } });
  else route.continue();
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log(`  [pageerror] ${String(e).slice(0, 120)}`));

async function shoot(slug, name) {
  await page.waitForTimeout(900);
  // react-grid-layout (WidthProvider) misst nur auf resize → Event feuern, damit das Raster die volle Breite nimmt.
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await page.waitForTimeout(900); // Recharts + Raster ausrendern
  await clean(page);
  await page.screenshot({ path: join(OUT, slug, `${name}.png`), fullPage: true });
  process.stdout.write(`  ${slug}/${name} ✓\n`);
}

for (const p of targets) {
  await setActive(p.id);
  mkdirSync(join(OUT, p.slug), { recursive: true });
  await page.goto(`${APP}/`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(500);
  for (const [name, route] of ROUTES) {
    try {
      await page.goto(`${APP}${route}`, { waitUntil: "networkidle", timeout: 30000 });
      await clean(page);
      await shoot(p.slug, name);
    } catch (e) { process.stdout.write(`  ${p.slug}/${name} ✗ ${String(e).slice(0, 80)}\n`); }
  }
  // Methodik-Tabs
  try {
    await page.goto(`${APP}/methodik`, { waitUntil: "networkidle", timeout: 30000 });
    await clean(page);
    const tabs = [...METHODIK_TABS];
    if (CYCLE.has(p.id)) tabs.push(["methodik-zyklus", "Zyklus"]);
    for (const [name, label] of tabs) {
      try {
        await page.getByRole("button", { name: label, exact: true }).first().click({ timeout: 4000 });
        await shoot(p.slug, name);
      } catch {
        // Fallback: Tab per Text
        try { await page.click(`text="${label}"`, { timeout: 3000 }); await shoot(p.slug, name); }
        catch (e) { process.stdout.write(`  ${p.slug}/${name} ✗ tab ${String(e).slice(0, 50)}\n`); }
      }
    }
  } catch (e) { process.stdout.write(`  ${p.slug}/methodik ✗ ${String(e).slice(0, 60)}\n`); }
}
await setActive(1);
await browser.close();
console.log("Fertig. active_profile zurück auf 1.");
