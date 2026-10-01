import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { effectiveTemplate, resolveStyles, type ResolvedCatalog } from "../shared/catalog";
import { buildDieline, type Dieline } from "../shared/dieline";
import type { Design, DesignElement } from "../shared/design";
import { validateDims } from "../shared/validate";
import { DielineEditor, type Guides } from "./editor/DielineEditor";
import { adminApi, api, DEMO } from "./lib/api";
import { ensureFont, registerFonts } from "./lib/fonts";
import { ImageCache } from "./lib/images";
import { StudioContext, type Studio } from "./panels/context";
import { SizePanel, StylePanel } from "./panels/BoxPanels";
import { ArtworkPanel, ColorsPanel, FinishesPanel, QrPanel, TextPanel } from "./panels/DesignPanels";
import { Inspector } from "./panels/Inspector";
import type { BoxPreviewHandle } from "./preview/BoxPreview";
import { dielineSvg } from "./render/exports";
import type { RenderSources } from "./render/renderDesign";
import { defaultPanel, newDesign } from "./state/factory";
import { useHistory } from "./state/history";
import { QuoteDialog } from "./quote/QuoteDialog";

const BoxPreview = lazy(() => import("./preview/BoxPreview").then((m) => ({ default: m.BoxPreview })));

type Tab = "style" | "size" | "artwork" | "text" | "qr" | "colors" | "finishes" | "item";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "style", label: "Style", icon: "M4 8l8-4 8 4-8 4-8-4zm0 0v8l8 4 8-4V8M12 12v8" },
  { id: "size", label: "Size", icon: "M4 20L20 4M4 20h6M4 20v-6M20 4h-6M20 4v6" },
  { id: "artwork", label: "Upload", icon: "M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" },
  { id: "text", label: "Text", icon: "M5 6V4h14v2M12 4v16m-3 0h6" },
  { id: "qr", label: "QR", icon: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" },
  { id: "colors", label: "Colours", icon: "M12 3a9 9 0 100 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 1.8-1.5H17a4 4 0 004-4c0-4.4-4-8.5-9-8.5zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01" },
  { id: "finishes", label: "Finishes", icon: "M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" },
];

const DRAFT_KEY = "bb-draft-v1";

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

interface Toast {
  id: number;
  msg: string;
  kind: "info" | "error" | "success";
}

export function App() {
  const [catalog, setCatalog] = useState<ResolvedCatalog | null>(null);
  const [boot, setBoot] = useState<{ design: Design; projectId: string | null; readOnly: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const cat = await api.catalog();
        registerFonts(cat.fonts);
        const params = new URLSearchParams(location.search);
        const pid = params.get("project");
        const qid = params.get("quote");
        let design: Design | null = null;
        let projectId: string | null = null;
        let readOnly: string | null = null;
        if (qid) {
          const q = await adminApi.quote(qid);
          design = q.design;
          readOnly = q.reference;
        } else if (pid) {
          const p = await api.loadProject(pid);
          design = p.design;
          projectId = p.id;
        } else {
          try {
            const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
            if (draft?.design?.version === 1) {
              design = draft.design;
              projectId = draft.projectId ?? null;
            }
          } catch {
            /* ignore */
          }
        }
        if (design && !cat.templates.some((t) => t.id === design!.styleId)) design = null;
        setCatalog(cat);
        setBoot({ design: design ?? newDesign(cat), projectId, readOnly });
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="boot">
        <h1>We couldn't open the box builder</h1>
        <p>{error}</p>
        <button className="btn primary" onClick={() => location.assign(location.pathname)}>Start a new design</button>
      </div>
    );
  }
  if (!catalog || !boot) {
    return (
      <div className="boot">
        <span className="spinner big" />
        <p>Loading the box builder…</p>
      </div>
    );
  }
  return <Studio catalog={catalog} initial={boot.design} initialProjectId={boot.projectId} readOnlyRef={boot.readOnly} />;
}

function Studio({ catalog, initial, initialProjectId, readOnlyRef }: { catalog: ResolvedCatalog; initial: Design; initialProjectId: string | null; readOnlyRef: string | null }) {
  const h = useHistory<Design>(initial);
  const design = h.value;
  const readOnly = !!readOnlyRef;
  const [tab, setTab] = useState<Tab>("style");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"design" | "3d">("design");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guides>({ cut: true, fold: true, bleed: true, safe: true, labels: true });
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [savedDesign, setSavedDesign] = useState<Design | null>(initialProjectId ? initial : null);
  const [saving, setSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const previewRef = useRef<BoxPreviewHandle>(null);

  const images = useMemo(() => new ImageCache(), []);
  useEffect(() => images.subscribe(() => setVersion((v) => v + 1)), [images]);
  const sources: RenderSources = useMemo(() => ({ image: (el) => images.get(el.assetId) }), [images]);

  const toast = useCallback((msg: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3200);
  }, []);

  // ------------------------------------------------------------- derived
  const styles = useMemo(() => resolveStyles(catalog, true).filter((st) => st.config.enabled || st.template.id === design.styleId), [catalog, design.styleId]);
  const style = styles.find((st) => st.template.id === design.styleId) ?? styles[0];
  const lastGood = useRef<Dieline | null>(null);
  const dieline = useMemo(() => {
    const v = validateDims(effectiveTemplate(style), design.dims, catalog.settings);
    if (v.ok && v.dieline) return (lastGood.current = v.dieline);
    if (lastGood.current?.templateId === style.template.id) return lastGood.current;
    const t = style.template;
    return (lastGood.current = buildDieline(t, Object.fromEntries(t.dimensions.map((d) => [d.key, d.default])), { bleed: catalog.settings.bleedMm, safe: catalog.settings.safeMm }));
  }, [style, design.dims, catalog.settings]);

  const activePanel = (activePanelId && dieline.byId[activePanelId]) || defaultPanel(dieline);
  const selected = design.elements.find((e) => e.id === selectedId) ?? null;

  // Fonts: make sure every face in use is loaded, then repaint.
  useEffect(() => {
    for (const el of design.elements) {
      if (el.type === "text") ensureFont(el.fontFamily, el.bold, el.italic, () => setVersion((v) => v + 1));
    }
  }, [design.elements]);

  const update = useCallback(
    (fn: (d: Design) => Design, mergeKey?: string) => {
      if (!readOnly) h.update(fn, mergeKey);
    },
    [h, readOnly],
  );

  // Local draft so a refresh never loses work.
  useEffect(() => {
    if (readOnly) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ design, projectId }));
      } catch {
        /* storage full or blocked */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [design, projectId, readOnly]);

  const dirty = savedDesign !== design;
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty && projectId) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, projectId]);

  // ------------------------------------------------------------- save
  const saveProject = useCallback(async (): Promise<string | undefined> => {
    if (readOnly) return undefined;
    setSaving(true);
    try {
      const snapshot = design;
      let id = projectId;
      if (id) await api.saveProject(id, snapshot);
      else {
        id = (await api.createProject(snapshot)).id;
        setProjectId(id);
        const url = new URL(location.href);
        url.searchParams.set("project", id);
        history.replaceState(null, "", url);
      }
      setSavedDesign(snapshot);
      return id;
    } finally {
      setSaving(false);
    }
  }, [design, projectId, readOnly]);

  const onSave = async () => {
    try {
      const first = !projectId;
      await saveProject();
      if (first) setShareOpen(true);
      else toast("Design saved", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const newProject = () => {
    // Browser dialogs are unavailable in the embedded demo.
    if (!DEMO && !confirm("Start a new design? Your current design stays available from its saved link.")) return;
    const url = new URL(location.href);
    url.searchParams.delete("project");
    history.replaceState(null, "", url);
    setProjectId(null);
    setSavedDesign(null);
    h.reset(newDesign(catalog, design.styleId));
    setSelectedId(null);
    setTab("style");
  };

  const downloadDieline = () => {
    const svg = dielineSvg(dieline, design, catalog);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    a.download = `${style.template.id}-dieline.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ------------------------------------------------------------- element ops
  const changeElement = useCallback(
    (id: string, patch: Partial<DesignElement>, mergeKey: string) =>
      update((d) => ({ ...d, elements: d.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as DesignElement) : e)) }), mergeKey),
    [update],
  );

  const selectElement = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      const el = id ? design.elements.find((e) => e.id === id) : null;
      if (el) {
        setActivePanelId(el.panelId);
        if (el.type === "text" && tab !== "finishes") setTab("text");
        else if (el.type === "qr" && tab !== "finishes") setTab("qr");
      }
    },
    [design.elements, tab],
  );

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) h.redo();
        else h.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        h.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void onSave();
        return;
      }
      if (!selected || readOnly) {
        if (e.key === "Escape") setSelectedId(null);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        update((d) => ({ ...d, elements: d.elements.filter((x) => x.id !== selected.id) }));
        setSelectedId(null);
      } else if (e.key === "Escape") setSelectedId(null);
      else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const copy = { ...selected, id: `el_${Math.random().toString(36).slice(2, 10)}`, x: selected.x + 0.05, y: selected.y + 0.05 } as DesignElement;
        update((d) => ({ ...d, elements: [...d.elements, copy] }));
        setSelectedId(copy.id);
      } else if (e.key.startsWith("Arrow") && !selected.locked) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const p = dieline.byId[selected.panelId];
        if (!p) return;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        changeElement(selected.id, { x: selected.x + dx / p.bbox.w, y: selected.y + dy / p.bbox.h }, `nudge:${selected.id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const studio: Studio = {
    catalog,
    styles,
    style,
    design,
    dieline,
    update,
    selected,
    select: selectElement,
    activePanel,
    setActivePanel: setActivePanelId,
    images,
    toast,
    readOnly,
  };

  const panelFor = (t: Tab) =>
    ({ style: <StylePanel />, size: <SizePanel />, artwork: <ArtworkPanel />, text: <TextPanel />, qr: <QrPanel />, colors: <ColorsPanel />, finishes: <FinishesPanel />, item: <Inspector /> })[t];

  const guideToggles: [keyof Guides, string, string][] = [
    ["cut", "Cut", "lg-cut"],
    ["fold", "Fold", "lg-fold"],
    ["bleed", "Bleed", "lg-bleed"],
    ["safe", "Safe area", "lg-safe"],
    ["labels", "Labels", "lg-label"],
  ];

  return (
    <StudioContext.Provider value={studio}>
      <div className={`app view-${mobileView} ${sheetOpen ? "sheet-open" : ""}`}>
        <header className="topbar">
          <div className="brand">
            <span className="logo" aria-hidden>▣</span>
            <span className="brand-name">{catalog.settings.companyName}</span>
          </div>
          <input
            className="project-name"
            value={design.name}
            onChange={(e) => update((d) => ({ ...d, name: e.target.value.slice(0, 120) }), "name")}
            aria-label="Design name"
            disabled={readOnly}
          />
          <div className="top-actions">
            <button className="icon-btn" onClick={h.undo} disabled={!h.canUndo || readOnly} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
            <button className="icon-btn" onClick={h.redo} disabled={!h.canRedo || readOnly} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
            {!readOnly && (
              <>
                <button className="btn ghost hide-sm" onClick={newProject}>New</button>
                <button className="btn" onClick={onSave} disabled={saving}>
                  {saving ? "Saving…" : projectId && !dirty ? "✓ Saved" : "Save"}
                </button>
                <button className="btn primary" onClick={() => setQuoteOpen(true)}>
                  Submit for Quote
                </button>
              </>
            )}
          </div>
        </header>
        {DEMO && (
          <div className="banner">
            Demo version: designs and uploads are saved in this browser only, and quote requests are simulated (all production files are still generated).
          </div>
        )}
        {readOnly && <div className="banner">Viewing quote {readOnlyRef} – read-only snapshot of the submitted design.</div>}
        <div className="mobile-switch">
          <button className={mobileView === "design" ? "on" : ""} onClick={() => setMobileView("design")}>Dieline</button>
          <button className={mobileView === "3d" ? "on" : ""} onClick={() => setMobileView("3d")}>3D preview</button>
        </div>

        <div className="workspace">
          <nav className="rail" aria-label="Tools">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? "on" : ""}
                onClick={() => {
                  if (tab === t.id) setSheetOpen((o) => !o);
                  else setSheetOpen(true);
                  setTab(t.id);
                }}
                aria-current={tab === t.id}
              >
                <Icon d={t.icon} />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
          <aside className="toolpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
            <button className="sheet-close" onClick={() => setSheetOpen(false)} aria-label="Close panel">
              ✕
            </button>
            {panelFor(tab)}
          </aside>
          <main className="center">
            <div className="editor-bar">
              <div className="guides" role="group" aria-label="Guides">
                {guideToggles.map(([k, label, cls]) => (
                  <button key={k} className={`guide-toggle ${guides[k] ? "on" : ""}`} onClick={() => setGuides((g) => ({ ...g, [k]: !g[k] }))} aria-pressed={guides[k]}>
                    <i className={cls} /> {label}
                  </button>
                ))}
              </div>
              {!DEMO && <button className="btn small ghost hide-sm" onClick={downloadDieline} title="Download the dieline as SVG">
                ⤓ Dieline SVG
              </button>}
            </div>
            {selected && !readOnly && (
              <div className="sel-bar" role="toolbar" aria-label="Selected item">
                <button
                  className="phone-only"
                  onClick={() => {
                    setTab("item");
                    setSheetOpen(true);
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    const copy = { ...selected, id: `el_${Math.random().toString(36).slice(2, 10)}`, x: selected.x + 0.05, y: selected.y + 0.05 } as DesignElement;
                    update((d) => ({ ...d, elements: [...d.elements, copy] }));
                    setSelectedId(copy.id);
                  }}
                >
                  Duplicate
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    update((d) => ({ ...d, elements: d.elements.filter((x) => x.id !== selected.id) }));
                    setSelectedId(null);
                  }}
                >
                  Delete
                </button>
              </div>
            )}
            <DielineEditor
              dieline={dieline}
              design={design}
              catalog={catalog}
              sources={sources}
              version={version}
              guides={guides}
              selectedId={selectedId}
              activePanelId={activePanel.id}
              onSelectElement={selectElement}
              onSelectPanel={setActivePanelId}
              onChangeElement={changeElement}
            />
          </main>
          <section className="right">
            <Suspense fallback={<div className="preview loading"><span className="spinner" /></div>}>
              <BoxPreview
                ref={previewRef}
                dieline={dieline}
                design={design}
                catalog={catalog}
                sources={sources}
                version={version}
                onPickPanel={(id) => {
                  setActivePanelId(id);
                  setSelectedId(null);
                }}
              />
            </Suspense>
            <Inspector />
          </section>
        </div>

        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`}>
              {t.msg}
            </div>
          ))}
        </div>

        {shareOpen && projectId && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal">
              <header className="modal-head">
                <h2>Design saved</h2>
                <button className="icon-btn" onClick={() => setShareOpen(false)} aria-label="Close">✕</button>
              </header>
              <div className="modal-body">
                {DEMO ? (
                  <p>Your design is saved in this browser. Open this page again on the same device to continue editing — it reopens automatically.</p>
                ) : (
                <p>Your design is saved. Bookmark or copy this private link to continue editing later on any device:</p>
                )}
                {!DEMO && (
                <div className="row">
                  <input className="input mono" readOnly value={location.href} onFocus={(e) => e.target.select()} />
                  <button
                    className="btn"
                    onClick={() => {
                      navigator.clipboard
                        ?.writeText(location.href)
                        .then(() => toast("Link copied", "success"))
                        .catch(() => toast("Select the link and copy it manually.", "info"));
                    }}
                  >
                    Copy
                  </button>
                </div>
                )}
                {!DEMO && <p className="hint">Anyone with this link can open and edit the design. Save again at any time with Ctrl+S.</p>}
                <footer className="modal-foot">
                  <button className="btn primary" onClick={() => setShareOpen(false)}>Continue designing</button>
                </footer>
              </div>
            </div>
          </div>
        )}
        {quoteOpen && (
          <QuoteDialog
            preview={previewRef}
            sources={sources}
            saveProject={saveProject}
            onClose={() => setQuoteOpen(false)}
            onFocusElement={(id) => {
              selectElement(id);
              setMobileView("design");
            }}
          />
        )}
      </div>
    </StudioContext.Provider>
  );
}
