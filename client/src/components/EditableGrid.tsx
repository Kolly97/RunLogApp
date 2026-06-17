// Anpassbares Chart-Raster je Seite (T8) via react-grid-layout. Zwei Modi:
//  • continuous (Dashboard): durchgehende Leinwand, Auto-Höhe, frei skalierend.
//  • paged (Wochenbericht/Langzeit): feste A4-Seiten (WYSIWYG-Druck). Jede Seite ist eine
//    Design-A4-Box (794×1123 px @96dpi); im Editor per CSS-transform skaliert, im Druck 1:1 →
//    PDF = Editor. Kacheln bleiben per maxRows/isBounded innerhalb der Seite; Seitenwechsel per Button.
// Layout pro Profil server-seitig persistiert (api.getLayout/setLayout).
import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import { api, type LayoutMap } from "../lib/api.ts";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const AutoGrid = WidthProvider(GridLayout); // continuous (misst Breite selbst)

export interface EgBlock {
  id: string;
  title: string;
  /** Default-Breite in 12er-Rastereinheiten (4 = ⅓, 6 = ½, 8 = ⅔, 12 = voll). */
  defaultSpan: number;
  /** Natürliche Chart-Höhe in px; gesetzt → Block ist ein Chart (Höhe wird an render() übergeben). */
  defaultHeight?: number;
  /** Karten-Chrome (Titel + Legende + Caption) in px für die Chart-Höhe im paged-Modus. Default ~116. */
  reserve?: number;
  render: (height: number | undefined) => ReactNode;
}

/** Deklarative Block-Definition als Kind von <EditableGrid>. children = (höhe) => JSX. */
export function EgItem(_props: {
  id: string; title: string; defaultSpan: number; defaultHeight?: number; reserve?: number;
  children: (height: number | undefined) => ReactNode;
}): null { return null; }

// ---- continuous (Dashboard) ----
const COLS = 12;
const ROW_H = 8;
const MARGIN = 8;
const HEADER_PX = 96;
const TOOLBAR_PX = 34;
const MIN_W = 3;
const MIN_H = 6;
const rowSpanFor = (px: number) => Math.max(MIN_H, Math.ceil((px + MARGIN) / (ROW_H + MARGIN)));

// ---- paged (A4 @96dpi) ----
const A4_W = 794, A4_H = 1123;     // A4 hoch @96dpi = Druckgröße (Druck-Scale 1)
const PAGE_PAD = 22;               // Innen-Padding der Seite
const P_COLS = 12;
const P_ROW_H = 22;                // feines Zeilenraster → präzise Platzierung
const P_MARGIN = 6;
const P_CONTENT_H = A4_H - 2 * PAGE_PAD;
const P_MAX_ROWS = Math.floor((P_CONTENT_H + P_MARGIN) / (P_ROW_H + P_MARGIN));
const P_MIN_H = 2;                 // Tiles dürfen klein gezogen werden (an Inhalt anpassen)
const P_DEF_RESERVE = 26;          // Karten-Chrome-Reserve für die Default-Höhen-Schätzung
const pRowSpanFor = (px: number) => Math.max(P_MIN_H, Math.ceil((px + P_MARGIN) / (P_ROW_H + P_MARGIN)));

interface Placed { x: number; y: number; w: number; h: number; page: number; }

/** Default-Anordnung für paged: Shelf-Packing in 12-Spalten-Reihen, neue Seite bei Überlauf. */
function defaultPaged(blocks: EgBlock[]): Record<string, Placed> {
  const out: Record<string, Placed> = {};
  let page = 1, x = 0, y = 0, shelfH = 0;
  for (const b of blocks) {
    const w = Math.min(P_COLS, b.defaultSpan);
    const h = Math.min(P_MAX_ROWS, pRowSpanFor((b.defaultHeight ?? 140) + P_DEF_RESERVE));
    if (x + w > P_COLS) { x = 0; y += shelfH; shelfH = 0; }
    if (y + h > P_MAX_ROWS) { page += 1; x = 0; y = 0; shelfH = 0; }
    out[b.id] = { x, y, w, h, page };
    x += w; shelfH = Math.max(shelfH, h);
  }
  return out;
}

/** Default-Anordnung für continuous (Dashboard). */
function defaultPos(blocks: EgBlock[]): Record<string, { x: number; y: number; w: number; h: number }> {
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  let x = 0, y = 0, shelfH = 0;
  for (const b of blocks) {
    const w = Math.min(COLS, b.defaultSpan);
    const h = rowSpanFor((b.defaultHeight ?? 160) + HEADER_PX);
    if (x + w > COLS) { x = 0; y += shelfH; shelfH = 0; }
    out[b.id] = { x, y, w, h };
    x += w; shelfH = Math.max(shelfH, h);
  }
  return out;
}

export default function EditableGrid({ page, blocks, children, paged }: {
  page: string; blocks?: EgBlock[]; children?: ReactNode; paged?: boolean;
}) {
  const [layout, setLayout] = useState<LayoutMap>({});
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [autoH, setAutoH] = useState<Record<string, number>>({});
  const [extraPages, setExtraPages] = useState(1);   // manuell hinzugefügte Seiten (paged)
  const [stageW, setStageW] = useState(A4_W);        // gemessene Editor-Breite (paged)
  // Diagramm-Textgröße (paged): kleiner % → größere Design-Leinwand → fixe px-Schriften relativ kleiner.
  const [textPct, setTextPct] = useState<number>(() => {
    const v = Number(localStorage.getItem(`eg-text-${page}`));
    return v >= 0.5 && v <= 1.0 ? v : 0.7;
  });
  const setText = (v: number) => { setTextPct(v); try { localStorage.setItem(`eg-text-${page}`, String(v)); } catch { /* ignore */ } };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const obs = useRef<ResizeObserver | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { api.getLayout(page).then((m) => { setLayout(m || {}); setLoaded(true); }).catch(() => setLoaded(true)); }, [page]);

  // continuous: Inhalts-Höhe messen → autoH.
  useEffect(() => {
    if (paged) return;
    const measure = (el: HTMLElement) => {
      const id = el.dataset.egId!;
      const want = rowSpanFor(el.offsetHeight);
      setAutoH((prev) => (prev[id] === want ? prev : { ...prev, [id]: want }));
    };
    obs.current = new ResizeObserver((entries) => entries.forEach((e) => measure(e.target as HTMLElement)));
    return () => obs.current?.disconnect();
  }, [paged]);

  // paged: Editor-Breite messen → Skalierung der A4-Seiten.
  useEffect(() => {
    if (!paged) return;
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageW(el.clientWidth || A4_W);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [paged, loaded]);

  const EDIT_ROWS = Math.ceil(TOOLBAR_PX / (ROW_H + MARGIN));
  const measureRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) { el.dataset.egId = id; obs.current?.observe(el); }
  };

  const blocks2: EgBlock[] = blocks ?? Children.toArray(children)
    .filter((ch): ch is React.ReactElement<React.ComponentProps<typeof EgItem>> => isValidElement(ch) && ch.type === EgItem)
    .map((ch) => ({
      id: ch.props.id, title: ch.props.title, defaultSpan: ch.props.defaultSpan,
      defaultHeight: ch.props.defaultHeight, reserve: ch.props.reserve, render: ch.props.children,
    }));

  const persist = (next: LayoutMap) => {
    setLayout(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { api.setLayout(page, next).catch(() => {}); }, 350);
  };

  if (!loaded) return null;

  const visible = blocks2.filter((b) => !layout[b.id]?.hidden);
  const hidden = blocks2.filter((b) => layout[b.id]?.hidden);

  const editbar = (
    <div className="eg-editbar no-print">
      {editing ? (
        <>
          <span className="tiny muted">Layout-Bearbeitung — pro Profil gespeichert</span>
          <button onClick={() => { persist({}); setExtraPages(1); }} className="tiny">Zurücksetzen</button>
          <button onClick={() => setEditing(false)} className="primary tiny">Fertig</button>
        </>
      ) : (
        <button onClick={() => setEditing(true)} className="tiny">✎ Layout bearbeiten</button>
      )}
    </div>
  );

  const tray = editing && hidden.length > 0 && (
    <div className="eg-tray no-print">
      <span className="tiny muted">Ausgeblendet:</span>
      {hidden.map((b) => (
        <button key={b.id} className="tiny" onClick={() => persist({ ...layout, [b.id]: { ...layout[b.id], hidden: false } })}>+ {b.title}</button>
      ))}
    </div>
  );

  // ============================ PAGED ============================
  if (paged) {
    const defs = defaultPaged(blocks2);
    const placeOf = (b: EgBlock): Placed => {
      const ov = layout[b.id] || {};
      const d = defs[b.id];
      return ov.page != null
        ? { x: ov.x ?? d.x, y: ov.y ?? d.y, w: ov.w ?? d.w, h: ov.h ?? d.h, page: ov.page }
        : d;
    };
    const pageCount = Math.max(extraPages, ...visible.map((b) => placeOf(b).page), 1);
    const pages = Array.from({ length: pageCount }, (_, i) => i + 1);

    // Design-Leinwand: A4 × K (K = 1/textPct). Größeres K → fixe px-Texte relativ kleiner.
    const K = 1 / textPct;
    const Wd = Math.round(A4_W * K), Hd = Math.round(A4_H * K);
    const pad = PAGE_PAD * K, rowH = P_ROW_H * K, mgn = P_MARGIN * K;
    const contentW = Math.round((A4_W - 2 * PAGE_PAD) * K);
    const RESERVE = 116;                      // Default-Kopf+Legende (Design-px); pro Block via reserve überschreibbar
    const editorScale = Math.min(1.8, Math.max(0.3, stageW / Wd));
    const printScale = A4_W / Wd;             // ≈ textPct → Seite druckt auf A4
    const pTileScaled = (h: number) => h * rowH + (h - 1) * mgn;

    const onChangePage = (p: number, next: Layout[]) => {
      const map: LayoutMap = { ...layout };
      for (const it of next) map[it.i] = { ...map[it.i], x: it.x, y: it.y, w: it.w, h: it.h, page: p };
      persist(map);
    };
    const moveToPage = (id: string, p: number) => {
      const target = Math.max(1, p);
      if (target > pageCount) setExtraPages(target);
      const pl = placeOf(blocks2.find((b) => b.id === id)!);
      persist({ ...layout, [id]: { ...layout[id], page: target, x: 0, y: 0, w: pl.w, h: pl.h } });
    };

    return (
      <>
        <div className="eg-pages" ref={stageRef}>
          {pages.map((p) => {
            const onPage = visible.filter((b) => placeOf(b).page === p);
            const rgl: Layout[] = onPage.map((b) => {
              const pl = placeOf(b);
              return { i: b.id, x: pl.x, y: pl.y, w: pl.w, h: pl.h, minW: MIN_W, minH: P_MIN_H, maxH: P_MAX_ROWS };
            });
            return (
              <div key={p} className="eg-sheet-wrap" style={{ height: Hd * editorScale + 20 }}>
                {editing && <div className="eg-sheet-label no-print">Seite {p}</div>}
                <div className="eg-sheet" style={{ width: Wd * editorScale, height: Hd * editorScale }}>
                  <div className="eg-sheet-scale" style={{ width: Wd, height: Hd, transform: `scale(${editorScale})`, ["--sp" as string]: printScale }}>
                    <GridLayout className="eg-pagegrid" width={contentW} cols={P_COLS} rowHeight={rowH}
                      margin={[mgn, mgn]} containerPadding={[0, 0]} maxRows={P_MAX_ROWS} isBounded
                      transformScale={editorScale} isDraggable={editing} isResizable={editing}
                      draggableCancel=".eg-nodrag" resizeHandles={["se", "sw", "ne", "nw"]}
                      compactType="vertical" preventCollision={false}
                      style={{ position: "absolute", top: pad, left: pad, width: contentW }}
                      layout={rgl} onDragStop={(l) => onChangePage(p, l)} onResizeStop={(l) => onChangePage(p, l)}>
                      {rgl.map((it) => {
                        const b = blocks2.find((x) => x.id === it.i)!;
                        const hpx = b.defaultHeight ? Math.max(90, pTileScaled(it.h) - (b.reserve ?? RESERVE)) : undefined;
                        return (
                          <div key={b.id} className={"eg-block" + (editing ? " editing" : "")}>
                            {editing && (
                              <div className="eg-toolbar eg-drag eg-overlay no-print">
                                <span className="eg-handle">⠿</span>
                                <span className="eg-title" title={b.title}>{b.title}</span>
                                <span className="eg-spacer" />
                                <span className="eg-grp eg-nodrag">
                                  <button title="Seite zurück" onClick={() => moveToPage(b.id, p - 1)} disabled={p === 1}>←&nbsp;S</button>
                                  <button title="Seite vor" onClick={() => moveToPage(b.id, p + 1)}>S&nbsp;→</button>
                                </span>
                                <button className="eg-eye eg-nodrag" title="ausblenden" onClick={() => persist({ ...layout, [b.id]: { ...layout[b.id], hidden: true } })}>👁</button>
                              </div>
                            )}
                            <div className={"eg-content" + (editing ? " locked" : "")}>{b.render(hpx)}</div>
                          </div>
                        );
                      })}
                    </GridLayout>
                  </div>
                </div>
              </div>
            );
          })}
          {editing && (
            <button className="eg-addpage no-print" onClick={() => setExtraPages(pageCount + 1)}>+ Seite hinzufügen</button>
          )}
        </div>
        {editing && (
          <div className="eg-textctl no-print">
            <span className="tiny muted">Diagramm-Text</span>
            <span className="eg-grp">
              {[0.6, 0.7, 0.85, 1.0].map((v) => (
                <button key={v} className={Math.abs(textPct - v) < 0.001 ? "on" : ""} onClick={() => setText(v)}>{Math.round(v * 100)}%</button>
              ))}
            </span>
          </div>
        )}
        {tray}
        {editbar}
      </>
    );
  }

  // ========================== CONTINUOUS ==========================
  const defaults = defaultPos(blocks2);
  const heightOf = (b: EgBlock) => layout[b.id]?.h ?? ((autoH[b.id] ?? defaults[b.id].h) + (editing ? EDIT_ROWS : 0));
  const rgl: Layout[] = visible.map((b) => {
    const ov = layout[b.id] || {};
    const d = defaults[b.id];
    return { i: b.id, x: ov.x ?? d.x, y: ov.y ?? d.y, w: ov.w ?? d.w, h: heightOf(b), minW: MIN_W, minH: MIN_H };
  });
  const onChange = (next: Layout[]) => {
    const map: LayoutMap = { ...layout };
    for (const it of next) map[it.i] = { ...map[it.i], x: it.x, y: it.y, w: it.w, h: it.h };
    persist(map);
  };
  const setHidden = (id: string, h: boolean) => {
    if (h) { persist({ ...layout, [id]: { ...layout[id], hidden: true } }); return; }
    const maxY = rgl.reduce((m, it) => Math.max(m, it.y + it.h), 0);
    const d = defaults[id];
    persist({ ...layout, [id]: { ...layout[id], hidden: false, x: 0, y: maxY, w: layout[id]?.w ?? d.w } });
  };

  return (
    <>
      <div className="eg-stage">
        <AutoGrid className={"editable-grid" + (editing ? " editing" : "")} layout={rgl} cols={COLS} rowHeight={ROW_H}
          margin={[MARGIN, MARGIN]} containerPadding={[0, 0]} isDraggable={editing} isResizable={editing}
          draggableCancel=".eg-nodrag" resizeHandles={["se", "sw", "ne", "nw"]}
          isBounded={false} compactType="vertical" preventCollision={false}
          onDragStop={onChange} onResizeStop={onChange}>
          {[...rgl].sort((a, c) => a.y - c.y || a.x - c.x).map((it) => {
            const b = blocks2.find((x) => x.id === it.i)!;
            const hpx = b.defaultHeight ? (layout[b.id]?.h ? Math.max(120, it.h * ROW_H + (it.h - 1) * MARGIN - HEADER_PX) : b.defaultHeight) : undefined;
            return (
              <div key={b.id} className={"eg-block" + (editing ? " editing" : "")}>
                {editing && (
                  <div className="eg-toolbar eg-drag no-print">
                    <span className="eg-handle">⠿</span>
                    <span className="eg-title" title={b.title}>{b.title}</span>
                    <span className="eg-spacer" />
                    <button className="eg-eye eg-nodrag" title="ausblenden" onClick={() => setHidden(b.id, true)}>👁</button>
                  </div>
                )}
                <div className={"eg-content" + (editing ? " locked" : "")}>
                  <div className="eg-measure" ref={measureRef(b.id)}>{b.render(hpx)}</div>
                </div>
              </div>
            );
          })}
        </AutoGrid>
      </div>
      {tray}
      {editbar}
    </>
  );
}
