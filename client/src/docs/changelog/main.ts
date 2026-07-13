// Entry des Changelogs (/changelog.html): Design-System + Timeline/Stats/TOC.
// Eine Wahrheitsquelle: alles wird aus den <details class="release">-Blöcken im DOM gelesen.
import "../docs.css";
import { initDocPage } from "../theme.ts";

type Rel = { el: HTMLDetailsElement; version: string; era: string; date: Date | null; bullets: number };

const ERA_COLOR: Record<string, string> = {
  "0": "var(--series-1)", "1": "var(--series-5)", "2": "var(--series-3)", "3": "var(--series-2)",
};

function collectReleases(): Rel[] {
  return Array.from(document.querySelectorAll<HTMLDetailsElement>("details.release"))
    .filter((el) => el.dataset.version && el.dataset.version !== "Unreleased")
    .map((el) => ({
      el,
      version: el.dataset.version!,
      era: el.dataset.era ?? "0",
      date: el.dataset.date ? new Date(el.dataset.date) : null,
      bullets: el.querySelectorAll("li").length,
    }));
}

/** Hero-Zahlen (Versionen · Tage · Einträge) mit Count-up, reduced-motion-aware. */
function initStats(rels: Rel[]): void {
  const dates = rels.map((r) => r.date).filter((d): d is Date => !!d).map((d) => d.getTime());
  const days = dates.length ? Math.round((Math.max(...dates) - Math.min(...dates)) / 86400000) + 1 : 0;
  const entries = rels.reduce((n, r) => n + r.bullets, 0)
    + (document.querySelector("#unreleased")?.querySelectorAll("li").length ?? 0);
  const values: Record<string, number> = { versions: rels.length, days, entries };

  const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll<HTMLElement>("[data-stat]").forEach((el) => {
    const target = values[el.dataset.stat ?? ""] ?? 0;
    if (!motion) { el.textContent = String(target); return; }
    const t0 = performance.now();
    const dur = 900;
    const tick = (t: number) => {
      const u = Math.min(1, (t - t0) / dur);
      el.textContent = String(Math.round(target * (1 - Math.pow(1 - u, 3))));
      if (u < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Interaktive Timeline: Ären-Bänder + je Version ein klickbarer Punkt (Zeit-Achse). */
function initTimeline(rels: Rel[]): void {
  const wrap = document.querySelector<HTMLElement>(".timeline-wrap");
  if (!wrap || !rels.length) return;
  const dated = rels.filter((r) => r.date).reverse(); // alt → neu
  if (dated.length < 2) return;
  const t0 = dated[0].date!.getTime();
  const t1 = dated[dated.length - 1].date!.getTime();
  const W = 720, H = 92, PAD = 14;
  const x = (t: number) => PAD + ((t - t0) / (t1 - t0)) * (W - 2 * PAD);

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  // Ären-Bänder (zusammenhängende Zeit-Spannen je Major-Version)
  const spans = new Map<string, { a: number; b: number }>();
  for (const r of dated) {
    const s = spans.get(r.era) ?? { a: r.date!.getTime(), b: r.date!.getTime() };
    s.a = Math.min(s.a, r.date!.getTime());
    s.b = Math.max(s.b, r.date!.getTime());
    spans.set(r.era, s);
  }
  const eras = Array.from(spans.entries()).sort((a, b) => a[1].a - b[1].a);
  eras.forEach(([era, s], i) => {
    const next = eras[i + 1];
    const xa = x(s.a), xb = next ? x(next[1].a) : x(s.b) + PAD;
    const band = document.createElementNS(ns, "rect");
    band.setAttribute("x", String(xa - 6));
    band.setAttribute("y", "34");
    band.setAttribute("width", String(Math.max(10, xb - xa)));
    band.setAttribute("height", "12");
    band.setAttribute("rx", "6");
    band.setAttribute("fill", ERA_COLOR[era] ?? "var(--muted)");
    band.setAttribute("opacity", "0.28");
    svg.appendChild(band);
    const lbl = document.createElementNS(ns, "text");
    lbl.textContent = `${era}.x`;
    lbl.setAttribute("x", String(xa - 4));
    lbl.setAttribute("y", "24");
    lbl.setAttribute("font-size", "10");
    lbl.setAttribute("font-family", "JetBrains Mono Variable, monospace");
    lbl.setAttribute("fill", "var(--muted)");
    svg.appendChild(lbl);
  });

  // Versions-Punkte (klickbar → Anker, öffnet Details)
  for (const r of dated) {
    const cx = x(r.date!.getTime());
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("class", "tl-dot");
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", "40");
    const major = /\.0$/.test(r.version) && r.version.split(".").length === 2 || /^\d+\.0\.0$/.test(r.version);
    dot.setAttribute("r", major ? "6" : "3.5");
    dot.setAttribute("fill", ERA_COLOR[r.era] ?? "var(--muted)");
    const title = document.createElementNS(ns, "title");
    title.textContent = `v${r.version} · ${r.el.dataset.date}`;
    dot.appendChild(title);
    dot.addEventListener("click", () => {
      r.el.open = true;
      r.el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    svg.appendChild(dot);
  }

  // Meilenstein-Labels unter den Major-Punkten
  const majors = ["1.0.0", "2.0.0", "3.0.0"].map((v) => dated.find((r) => r.version === v)).filter(Boolean) as Rel[];
  for (const r of [dated[0], ...majors]) {
    const lbl = document.createElementNS(ns, "text");
    lbl.textContent = r === dated[0] ? `v${r.version}` : `v${r.version.split(".")[0]}.0`;
    lbl.setAttribute("x", String(Math.min(Math.max(x(r.date!.getTime()), 28), W - 30)));
    lbl.setAttribute("y", "66");
    lbl.setAttribute("text-anchor", "middle");
    lbl.setAttribute("font-size", "10");
    lbl.setAttribute("font-family", "JetBrains Mono Variable, monospace");
    lbl.setAttribute("fill", "var(--viz-ink)");
    svg.appendChild(lbl);
  }
  wrap.appendChild(svg);
}

/** TOC: Versions-Links generieren (gruppiert nach Ära, neueste zuerst). */
function initVersionToc(rels: Rel[]): void {
  const toc = document.querySelector(".toc");
  if (!toc) return;
  const frag = document.createDocumentFragment();
  const unreleased = document.querySelector<HTMLElement>("#unreleased");
  if (unreleased) {
    const a = document.createElement("a");
    a.href = "#unreleased";
    a.innerHTML = `<span class="no">next</span>Unreleased`;
    frag.appendChild(a);
  }
  for (const r of rels) {
    const a = document.createElement("a");
    a.href = `#${r.el.id}`;
    const t = r.el.querySelector(".t")?.textContent ?? "";
    const no = document.createElement("span");
    no.className = "no";
    no.style.minWidth = "3.6em";
    no.textContent = `v${r.version}`;
    const label = document.createElement("span");
    label.textContent = t.length > 30 ? `${t.slice(0, 29)}…` : t;
    a.append(no, label);
    a.addEventListener("click", () => { r.el.open = true; });
    frag.appendChild(a);
  }
  toc.appendChild(frag);
}

initDocPage();
const rels = collectReleases();
initStats(rels);
initTimeline(rels);
initVersionToc(rels);

// Deep-Link: /changelog.html#v2-7-0 öffnet die Version direkt
if (location.hash) {
  const el = document.querySelector<HTMLDetailsElement>(`details.release${location.hash}`);
  if (el) { el.open = true; el.scrollIntoView(); }
}
