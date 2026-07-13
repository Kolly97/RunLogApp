// Gemeinsame Doku-Interaktion (Anleitung + Changelog): Theme-Umschalter,
// Scrollspy fürs Inhaltsverzeichnis, TOC-Schnellfilter, Scroll-Reveals.
// Bewusst framework-frei — die Doku-Seiten sind eigenständige Vite-Entries.

const THEME_KEY = "runlog.docs.theme";

export function initTheme(): void {
  const saved = localStorage.getItem(THEME_KEY);
  const system = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = saved === "light" || saved === "dark" ? saved : system;

  const btn = document.querySelector<HTMLButtonElement>(".theme-toggle");
  btn?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
  });
}

/** Markiert den TOC-Link zum gerade sichtbaren Kapitel (.chapter[id]). */
export function initScrollspy(): void {
  const links = new Map<string, HTMLAnchorElement>();
  document.querySelectorAll<HTMLAnchorElement>('.toc a[href^="#"]').forEach((a) => {
    links.set(decodeURIComponent(a.hash.slice(1)), a);
  });
  if (!links.size) return;

  let activeId = "";
  const setActive = (id: string) => {
    if (id === activeId) return;
    activeId = id;
    links.forEach((a, key) => a.classList.toggle("active", key === id));
    links.get(id)?.scrollIntoView({ block: "nearest" });
  };

  const visible = new Set<string>();
  const obs = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).id;
        if (e.isIntersecting) visible.add(id);
        else visible.delete(id);
      }
      // oberstes sichtbares Kapitel gewinnt (Dokumentreihenfolge)
      for (const id of links.keys()) {
        if (visible.has(id)) { setActive(id); return; }
      }
    },
    { rootMargin: "-72px 0px -55% 0px" },
  );
  links.forEach((_, id) => {
    const el = document.getElementById(id);
    if (el) obs.observe(el);
  });
}

/** Schnellfilter über die TOC-Einträge ("/" fokussiert das Feld). */
export function initTocFilter(): void {
  const input = document.querySelector<HTMLInputElement>(".toc-filter");
  if (!input) return;
  const entries = Array.from(document.querySelectorAll<HTMLAnchorElement>(".toc a"));
  const groups = Array.from(document.querySelectorAll<HTMLElement>(".toc .grp"));

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    entries.forEach((a) => {
      a.classList.toggle("toc-hidden", q !== "" && !(a.textContent ?? "").toLowerCase().includes(q));
    });
    groups.forEach((g) => {
      let sib = g.nextElementSibling;
      let any = false;
      while (sib && !sib.classList.contains("grp")) {
        if (sib.matches("a") && !sib.classList.contains("toc-hidden")) { any = true; break; }
        sib = sib.nextElementSibling;
      }
      g.style.display = any || q === "" ? "" : "none";
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== input && !(document.activeElement instanceof HTMLInputElement)) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

/** Sanfte Eintritts-Reveals (respektiert prefers-reduced-motion via CSS). */
export function initReveals(): void {
  const els = document.querySelectorAll<HTMLElement>(".reveal");
  if (!els.length) return;
  const obs = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          obs.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
  );
  els.forEach((el) => obs.observe(el));
}

export function initDocPage(): void {
  initTheme();
  initScrollspy();
  initTocFilter();
  initReveals();
}
