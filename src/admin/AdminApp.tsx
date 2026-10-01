import { useCallback, useEffect, useMemo, useState } from "react";
import type { Catalog, FinishOption, FontOption, MaterialOption, PrintOption, ResolvedCatalog, StyleConfig, Swatch } from "../../shared/catalog";
import { buildDieline } from "../../shared/dieline";
import type { BoxTemplate, StandardSize } from "../../shared/template-types";
import { validateTemplate } from "../../shared/validate";
import { adminApi, adminToken, ApiError, assetUrl, type AdminQuote, type AdminQuoteSummary } from "../lib/api";
import { describePaint } from "../../shared/design";
import { ListEditor } from "./ListEditor";

type Section = "quotes" | "styles" | "templates" | "options" | "settings";
const STATUSES = ["new", "in-review", "quoted", "won", "lost", "archived"];

export function AdminApp() {
  const [authed, setAuthed] = useState(!!adminToken.get());
  const [section, setSection] = useState<Section>("quotes");
  const [quoteId, setQuoteId] = useState<string | null>(null);

  // Simple hash routing: #quote/<id>
  useEffect(() => {
    const sync = () => {
      const m = /^#quote\/([a-f0-9]+)/.exec(location.hash);
      setQuoteId(m ? m[1] : null);
      if (m) setSection("quotes");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const onAuthError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      adminToken.set(null);
      setAuthed(false);
    }
  }, []);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  const nav: [Section, string][] = [
    ["quotes", "Quote requests"],
    ["styles", "Box styles & sizes"],
    ["templates", "Dieline templates"],
    ["options", "Materials, finishes, colours & fonts"],
    ["settings", "Settings"],
  ];
  return (
    <div className="admin">
      <header className="topbar">
        <div className="brand">
          <span className="logo">▣</span> Box Builder Admin
        </div>
        <div className="top-actions">
          <a className="btn ghost" href="/" target="_blank" rel="noreferrer">Open builder ↗</a>
          <button className="btn" onClick={() => (adminToken.set(null), setAuthed(false))}>Sign out</button>
        </div>
      </header>
      <div className="admin-body">
        <nav className="admin-nav">
          {nav.map(([id, label]) => (
            <button
              key={id}
              className={section === id ? "on" : ""}
              onClick={() => {
                setSection(id);
                if (location.hash) history.replaceState(null, "", location.pathname);
                setQuoteId(null);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <main className="admin-main">
          {section === "quotes" && (quoteId ? <QuoteDetail id={quoteId} onError={onAuthError} /> : <QuoteList onError={onAuthError} />)}
          {section !== "quotes" && <CatalogEditor section={section} onError={onAuthError} />}
        </main>
      </div>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="boot">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            const { token } = await adminApi.login(pw);
            adminToken.set(token);
            onDone();
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>Admin sign in</h2>
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="current-password" />
        </label>
        {err && <p className="error-note">{err}</p>}
        <button className="btn primary" disabled={busy || !pw}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ quotes
function QuoteList({ onError }: { onError: (e: unknown) => void }) {
  const [quotes, setQuotes] = useState<AdminQuoteSummary[] | null>(null);
  const [filter, setFilter] = useState("active");
  const [q, setQ] = useState("");
  useEffect(() => {
    adminApi.quotes().then((r) => setQuotes(r.quotes)).catch(onError);
  }, [onError]);
  if (!quotes) return <span className="spinner" />;
  const shown = quotes.filter(
    (x) =>
      (filter === "all" || (filter === "active" ? !["archived", "lost"].includes(x.status) : x.status === filter)) &&
      `${x.reference} ${x.customer.name} ${x.customer.email} ${x.customer.company} ${x.styleName}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div>
      <div className="admin-title">
        <h1>Quote requests</h1>
        <div className="row">
          <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="active">Active</option>
            <option value="all">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!shown.length ? (
        <p className="muted">No quote requests yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th></th>
              <th>Reference</th>
              <th>Customer</th>
              <th>Box</th>
              <th>Qty</th>
              <th>Received</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((x) => (
              <tr key={x.id} onClick={() => (location.hash = `quote/${x.id}`)}>
                <td><img className="q-thumb" src={assetUrl(x.mockup)} alt="" loading="lazy" /></td>
                <td className="mono">{x.reference}</td>
                <td>
                  <strong>{x.customer.name}</strong>
                  <div className="muted">{x.customer.company || x.customer.email}</div>
                </td>
                <td>
                  {x.styleName}
                  <div className="muted">{x.dims}</div>
                </td>
                <td>{x.quantity.toLocaleString()}</td>
                <td>{new Date(x.createdAt).toLocaleString()}</td>
                <td><span className={`status s-${x.status}`}>{x.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function QuoteDetail({ id, onError }: { id: string; onError: (e: unknown) => void }) {
  const [q, setQ] = useState<AdminQuote | null>(null);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    adminApi
      .quote(id)
      .then((r) => {
        setQ(r);
        setNotes(r.internalNotes);
      })
      .catch(onError);
  }, [id, onError]);
  if (!q) return <span className="spinner" />;
  const patch = async (p: { status?: string; internalNotes?: string }) => {
    try {
      setQ(await adminApi.updateQuote(id, p));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      onError(e);
      alert((e as Error).message);
    }
  };
  const dl = (assetId: string, label: string) => (
    <a className="btn small" href={`${assetUrl(assetId)}?download=1`}>
      ⤓ {label}
    </a>
  );
  return (
    <div>
      <a className="btn link" href="#" onClick={(e) => (e.preventDefault(), history.replaceState(null, "", location.pathname), dispatchEvent(new HashChangeEvent("hashchange")))}>
        ← All quotes
      </a>
      <div className="admin-title">
        <h1>
          {q.reference} <span className={`status s-${q.status}`}>{q.status}</span>
        </h1>
        <div className="row">
          <select className="input" value={q.status} onChange={(e) => patch({ status: e.target.value })}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <a className="btn" href={`/?quote=${q.id}`} target="_blank" rel="noreferrer">Open in builder ↗</a>
        </div>
      </div>
      <div className="mockups">
        {q.files.mockups.map((m) => (
          <a key={m} href={assetUrl(m)} target="_blank" rel="noreferrer">
            <img src={assetUrl(m)} alt="3D mockup" />
          </a>
        ))}
      </div>
      <div className="detail-grid">
        <section className="card">
          <h3>Customer</h3>
          <dl className="spec">
            <dt>Name</dt><dd>{q.customer.name}</dd>
            <dt>Email</dt><dd><a href={`mailto:${q.customer.email}?subject=${encodeURIComponent(`Your packaging quote ${q.reference}`)}`}>{q.customer.email}</a></dd>
            <dt>Phone</dt><dd>{q.customer.phone || "—"}</dd>
            <dt>Company</dt><dd>{q.customer.company || "—"}</dd>
            <dt>Country</dt><dd>{q.customer.country || "—"}</dd>
            <dt>Address</dt><dd>{q.customer.address || "—"}</dd>
            <dt>Submitted</dt><dd>{new Date(q.createdAt).toLocaleString()}</dd>
          </dl>
        </section>
        <section className="card">
          <h3>Specification</h3>
          <dl className="spec">
            <dt>Box style</dt><dd>{q.summary.styleName}</dd>
            <dt>Dimensions</dt><dd>{q.summary.dims}</dd>
            <dt>Quantity</dt><dd>{[q.requirements.quantity, ...q.requirements.extraQuantities].map((n) => n.toLocaleString()).join(" / ")}</dd>
            <dt>Material</dt><dd>{q.summary.material}</dd>
            <dt>Printing</dt><dd>{q.summary.printing}</dd>
            <dt>Background</dt><dd>{describePaint(q.design.colors.base)}</dd>
            <dt>Lamination</dt><dd>{q.summary.lamination}</dd>
            <dt>Special finishes</dt><dd>{q.summary.finishes.join(", ") || "None"}</dd>
            <dt>Needed by</dt><dd>{q.requirements.deadline || "—"}</dd>
          </dl>
          {q.requirements.notes && (
            <>
              <h3>Customer notes</h3>
              <p className="notes">{q.requirements.notes}</p>
            </>
          )}
        </section>
        <section className="card">
          <h3>Production files</h3>
          <div className="btn-row wrap">
            {dl(q.files.printFile, "Print artwork (PNG)")}
            {dl(q.files.dieline, "Dieline (SVG)")}
            {dl(q.files.proof, "Proof (JPG)")}
            {dl(q.files.designJson, "Design data (JSON)")}
            {(q.files.masks ?? []).map((m) => dl(m.assetId, `${m.finishId} mask`))}
          </div>
          <h3>Original artwork uploads</h3>
          {q.artwork.length ? (
            <ul className="files">
              {q.artwork.map((a) => (
                <li key={a.originalAssetId + a.panelId}>
                  <a href={`${assetUrl(a.originalAssetId)}?download=1`}>{a.fileName}</a> <span className="muted">on {a.panelId}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No uploaded images.</p>
          )}
          <a href={assetUrl(q.files.proof)} target="_blank" rel="noreferrer">
            <img className="proof" src={assetUrl(q.files.proof)} alt="Dieline proof" />
          </a>
        </section>
        <section className="card">
          <h3>Internal notes</h3>
          <textarea className="input" rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Pricing notes, follow-ups… (not visible to the customer)" />
          <div className="btn-row">
            <button className="btn primary" onClick={() => patch({ internalNotes: notes })}>Save notes</button>
            {saved && <span className="muted">Saved ✓</span>}
          </div>
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ catalog
function CatalogEditor({ section, onError }: { section: Exclude<Section, "quotes">; onError: (e: unknown) => void }) {
  const [data, setData] = useState<{ catalog: ResolvedCatalog; customTemplateIds: string[]; builtinTemplateIds: string[] } | null>(null);
  const [cat, setCat] = useState<Catalog | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    adminApi
      .catalog()
      .then((r) => {
        setData(r);
        const { templates: _t, ...rest } = r.catalog;
        void _t;
        setCat(rest);
        setDirty(false);
      })
      .catch(onError);
  }, [onError]);
  useEffect(load, [load]);
  if (!data || !cat) return <span className="spinner" />;
  const change = (c: Catalog) => {
    setCat(c);
    setDirty(true);
    setMsg(null);
  };
  const save = async () => {
    try {
      await adminApi.saveCatalog(cat);
      setDirty(false);
      setMsg("Saved. Customers see the changes on their next page load.");
    } catch (e) {
      onError(e);
      setMsg((e as Error).message);
    }
  };
  const saveBar = section !== "templates" && (
    <div className={`save-bar ${dirty ? "dirty" : ""}`}>
      <span>{msg ?? (dirty ? "You have unsaved changes." : "All changes saved.")}</span>
      <button className="btn" onClick={load} disabled={!dirty}>Discard</button>
      <button className="btn primary" onClick={save} disabled={!dirty}>Save changes</button>
    </div>
  );
  return (
    <div>
      {section === "styles" && <StylesEditor cat={cat} templates={data.catalog.templates} onChange={change} />}
      {section === "templates" && <TemplatesEditor data={data} settings={cat.settings} onSaved={load} onError={onError} />}
      {section === "options" && <OptionsEditor cat={cat} onChange={change} />}
      {section === "settings" && <SettingsEditor cat={cat} onChange={change} />}
      {saveBar}
    </div>
  );
}

function StylesEditor({ cat, templates, onChange }: { cat: Catalog; templates: BoxTemplate[]; onChange: (c: Catalog) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const setStyle = (id: string, patch: Partial<StyleConfig>) => onChange({ ...cat, styles: cat.styles.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const move = (i: number, d: number) => {
    const arr = cat.styles.slice();
    const [x] = arr.splice(i, 1);
    arr.splice(Math.max(0, Math.min(arr.length, i + d)), 0, x);
    onChange({ ...cat, styles: arr.map((s, k) => ({ ...s, order: k })) });
  };
  return (
    <div>
      <div className="admin-title">
        <h1>Box styles &amp; standard sizes</h1>
      </div>
      <p className="muted">Enable, rename and reorder styles, and manage the standard sizes customers can pick. Dieline geometry lives in the templates.</p>
      {cat.styles.map((s, i) => {
        const t = templates.find((x) => x.id === s.id)!;
        if (!t) return null;
        const sizes = s.standardSizes ?? t.standardSizes ?? [];
        const setSizes = (list: StandardSize[]) => setStyle(s.id, { standardSizes: list });
        return (
          <div className="le-card" key={s.id}>
            <div className="le-head">
              <label className="check">
                <input type="checkbox" checked={s.enabled} onChange={(e) => setStyle(s.id, { enabled: e.target.checked })} />
                <strong>{s.name || t.name}</strong>
                <span className="muted mono">{t.id}</span>
              </label>
              <div className="btn-row">
                <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === cat.styles.length - 1}>↓</button>
                <button className="btn small" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? "Close" : "Edit"}</button>
              </div>
            </div>
            {open === s.id && (
              <div>
                <div className="le-fields">
                  <label className="field">
                    <span>Display name</span>
                    <input className="input" placeholder={t.name} value={s.name ?? ""} onChange={(e) => setStyle(s.id, { name: e.target.value || undefined })} />
                  </label>
                  <label className="field">
                    <span>Card photo URL (optional)</span>
                    <input className="input" placeholder="https://… or /images/box.jpg" value={s.image ?? ""} onChange={(e) => setStyle(s.id, { image: e.target.value || undefined })} />
                  </label>
                  <label className="field full">
                    <span>Description</span>
                    <textarea className="input" rows={2} placeholder={t.description} value={s.description ?? ""} onChange={(e) => setStyle(s.id, { description: e.target.value || undefined })} />
                  </label>
                </div>
                <h3>Dimension limits (mm)</h3>
                <div className="le-fields">
                  {t.dimensions.map((d) => {
                    const lim = s.limits?.[d.key] ?? { min: d.min, max: d.max };
                    const setLim = (p: Partial<{ min: number; max: number }>) => setStyle(s.id, { limits: { ...(s.limits ?? {}), [d.key]: { ...lim, ...p } } });
                    return (
                      <div className="row" key={d.key}>
                        <span style={{ minWidth: 90 }}>{d.label}</span>
                        <input className="input" type="number" value={lim.min} onChange={(e) => setLim({ min: Number(e.target.value) })} aria-label={`${d.label} min`} />
                        <span>–</span>
                        <input className="input" type="number" value={lim.max} onChange={(e) => setLim({ max: Number(e.target.value) })} aria-label={`${d.label} max`} />
                      </div>
                    );
                  })}
                </div>
                <h3>Standard sizes</h3>
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Label</th>
                      {t.dimensions.map((d) => (
                        <th key={d.key}>{d.key} (mm)</th>
                      ))}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sizes.map((z, k) => (
                      <tr key={z.id}>
                        <td><input className="input" value={z.label} onChange={(e) => setSizes(sizes.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)))} /></td>
                        {t.dimensions.map((d) => (
                          <td key={d.key}>
                            <input className="input" type="number" value={z.dims[d.key] ?? ""} onChange={(e) => setSizes(sizes.map((x, j) => (j === k ? { ...x, dims: { ...x.dims, [d.key]: Number(e.target.value) } } : x)))} />
                          </td>
                        ))}
                        <td><button className="icon-btn" onClick={() => setSizes(sizes.filter((_, j) => j !== k))} aria-label="Remove size">🗑</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  className="btn small"
                  onClick={() => setSizes([...sizes, { id: `${t.id}-${Date.now().toString(36)}`, label: "New size", dims: Object.fromEntries(t.dimensions.map((d) => [d.key, d.default])) }])}
                >
                  + Add standard size
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DielinePreview({ template, settings }: { template: BoxTemplate; settings: Catalog["settings"] }) {
  const svg = useMemo(() => {
    try {
      const dl = buildDieline(template, Object.fromEntries(template.dimensions.map((d) => [d.key, d.default])), { bleed: settings.bleedMm, safe: settings.safeMm });
      return {
        vb: `0 0 ${dl.width} ${dl.height}`,
        cut: dl.cutLines.map(([a, b]) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`).join(""),
        fold: dl.foldLines.map(([a, b]) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`).join(""),
        labels: dl.panels.map((p) => ({ id: p.id, c: p.center, s: Math.max(3, Math.min(10, p.bbox.w / 8, p.bbox.h / 4)) })),
      };
    } catch {
      return null;
    }
  }, [template, settings]);
  if (!svg) return <p className="muted">No preview (fix the errors first).</p>;
  return (
    <svg className="tpl-preview" viewBox={svg.vb}>
      <path d={svg.cut} fill="none" stroke="#e11d48" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      <path d={svg.fold} fill="none" stroke="#2563eb" strokeWidth={1} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
      {svg.labels.map((l) => (
        <text key={l.id} x={l.c[0]} y={l.c[1]} fontSize={l.s} textAnchor="middle" dominantBaseline="middle" fill="#667085">
          {l.id}
        </text>
      ))}
    </svg>
  );
}

function TemplatesEditor({
  data,
  settings,
  onSaved,
  onError,
}: {
  data: { catalog: ResolvedCatalog; customTemplateIds: string[]; builtinTemplateIds: string[] };
  settings: Catalog["settings"];
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const parsed = useMemo(() => {
    if (!text.trim()) return { t: null as BoxTemplate | null, errors: [] as string[] };
    try {
      const t = JSON.parse(text) as BoxTemplate;
      return { t, errors: validateTemplate(t, settings) };
    } catch (e) {
      return { t: null, errors: [`JSON: ${(e as Error).message}`] };
    }
  }, [text, settings]);
  const open = (t: BoxTemplate, asCopy = false) => {
    const copy = asCopy ? { ...t, id: `${t.id}-custom`, name: `${t.name} (custom)` } : t;
    setText(JSON.stringify(copy, null, 2));
    setEditing(copy.id);
  };
  const save = async () => {
    if (!parsed.t || parsed.errors.length) return;
    try {
      await adminApi.saveTemplate(parsed.t.id, parsed.t);
      alert(`Template "${parsed.t.id}" saved. It is now available in the builder (enable it under Box styles if needed).`);
      onSaved();
    } catch (e) {
      onError(e);
      alert((e as Error).message);
    }
  };
  const remove = async (id: string) => {
    const builtin = data.builtinTemplateIds.includes(id);
    if (!confirm(builtin ? `Revert "${id}" to the built-in version?` : `Delete custom template "${id}"? Saved designs using it can no longer be opened.`)) return;
    try {
      await adminApi.deleteTemplate(id);
      onSaved();
    } catch (e) {
      onError(e);
    }
  };
  return (
    <div>
      <div className="admin-title">
        <h1>Dieline templates</h1>
      </div>
      <p className="muted">
        Each box style is a JSON template: panels attached edge-to-edge with fold angles, sizes written as formulas of the dimensions (e.g. <code>"W + 2 * c"</code>). Start from a copy of an existing style, adjust, preview and save — no rebuild or deployment needed. See <code>docs/TEMPLATES.md</code> for the full reference.
      </p>
      <table className="table compact">
        <thead>
          <tr>
            <th>Template</th>
            <th>Source</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.catalog.templates.map((t) => {
            const custom = data.customTemplateIds.includes(t.id);
            const builtin = data.builtinTemplateIds.includes(t.id);
            return (
              <tr key={t.id}>
                <td>
                  <strong>{t.name}</strong> <span className="muted mono">{t.id}</span>
                </td>
                <td>{custom ? (builtin ? "Built-in (overridden)" : "Custom") : "Built-in"}</td>
                <td className="btn-row">
                  <button className="btn small" onClick={() => open(t)}>Edit</button>
                  <button className="btn small" onClick={() => open(t, true)}>Duplicate</button>
                  {custom && <button className="btn small danger" onClick={() => remove(t.id)}>{builtin ? "Revert" : "Delete"}</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editing !== null && (
        <div className="tpl-editor">
          <div>
            <h3>Template JSON {parsed.t ? `· ${parsed.t.id}` : ""}</h3>
            <textarea className="input mono" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} rows={28} />
          </div>
          <div>
            <h3>Preview (default size)</h3>
            {parsed.t && !parsed.errors.length ? <DielinePreview template={parsed.t} settings={settings} /> : null}
            {parsed.errors.length ? (
              <ul className="preflight">
                {parsed.errors.map((e) => (
                  <li key={e} className="warn">
                    {e}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ok-note">✓ Template is valid at the default and all standard sizes.</p>
            )}
            <div className="btn-row">
              <button className="btn" onClick={() => setEditing(null)}>Close</button>
              <button className="btn primary" onClick={save} disabled={!parsed.t || parsed.errors.length > 0}>Save template</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OptionsEditor({ cat, onChange }: { cat: Catalog; onChange: (c: Catalog) => void }) {
  const [tab, setTab] = useState<"materials" | "finishes" | "colors" | "fonts" | "print">("materials");
  return (
    <div>
      <div className="admin-title">
        <h1>Options</h1>
      </div>
      <div className="seg">
        {(
          [
            ["materials", "Materials"],
            ["finishes", "Finishes"],
            ["colors", "Colour swatches"],
            ["fonts", "Fonts"],
            ["print", "Printing options"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "materials" && (
        <ListEditor<MaterialOption>
          items={cat.materials}
          onChange={(materials) => onChange({ ...cat, materials })}
          title={(m) => m.name}
          addLabel="Add material"
          blank={() => ({ id: `material-${Date.now().toString(36)}`, name: "New material", description: "", boardColor: "#f5f5f0", insideColor: "#f5f5f0", enabled: true })}
          fields={[
            { key: "name", label: "Name", type: "text" },
            { key: "id", label: "ID", type: "text" },
            { key: "description", label: "Description", type: "textarea", width: "full" },
            { key: "boardColor", label: "Outside board colour", type: "color" },
            { key: "insideColor", label: "Inside colour", type: "color" },
            { key: "enabled", label: "Enabled", type: "bool" },
          ]}
        />
      )}
      {tab === "finishes" && (
        <ListEditor<FinishOption>
          items={cat.finishes}
          onChange={(finishes) => onChange({ ...cat, finishes })}
          title={(f) => f.name}
          addLabel="Add finish"
          blank={() => ({ id: `finish-${Date.now().toString(36)}`, name: "New finish", description: "", kind: "area", effect: "spot-uv", enabled: true })}
          fields={[
            { key: "name", label: "Name", type: "text" },
            { key: "id", label: "ID", type: "text" },
            { key: "description", label: "Description", type: "textarea", width: "full" },
            { key: "kind", label: "Applies to", type: "select", options: [{ value: "lamination", label: "Whole box (lamination)" }, { value: "area", label: "Selected artwork" }] },
            {
              key: "effect",
              label: "3D effect",
              type: "select",
              options: ["matte", "gloss", "soft-touch", "spot-uv", "foil", "emboss", "deboss"].map((v) => ({ value: v, label: v })),
            },
            { key: "color", label: "Foil colour", type: "color", optional: true },
            { key: "enabled", label: "Enabled", type: "bool" },
          ]}
        />
      )}
      {tab === "colors" && (
        <ListEditor<Swatch>
          items={cat.colors}
          onChange={(colors) => onChange({ ...cat, colors })}
          title={(c) => `${c.name} ${c.hex}`}
          addLabel="Add swatch"
          blank={() => ({ name: "New colour", hex: "#888888" })}
          fields={[
            { key: "name", label: "Name", type: "text" },
            { key: "hex", label: "Screen colour", type: "color" },
            { key: "pantone", label: "Pantone reference", type: "text", optional: true },
            { key: "cmyk", label: "CMYK (C, M, Y, K)", type: "numbers" },
          ]}
        />
      )}
      {tab === "fonts" && (
        <ListEditor<FontOption>
          items={cat.fonts}
          onChange={(fonts) => onChange({ ...cat, fonts })}
          title={(f) => f.family}
          addLabel="Add font"
          blank={() => ({ family: "Nunito", category: "sans", google: true, bold: true, italic: true, enabled: true })}
          fields={[
            { key: "family", label: "Family (exact Google Fonts name)", type: "text" },
            { key: "category", label: "Category", type: "select", options: ["sans", "serif", "display", "script", "mono"].map((v) => ({ value: v, label: v })) },
            { key: "google", label: "Load from Google Fonts", type: "bool" },
            { key: "bold", label: "Has bold", type: "bool" },
            { key: "italic", label: "Has italic", type: "bool" },
            { key: "enabled", label: "Enabled", type: "bool" },
          ]}
        />
      )}
      {tab === "print" && (
        <ListEditor<PrintOption>
          items={cat.printOptions}
          onChange={(printOptions) => onChange({ ...cat, printOptions })}
          title={(p) => p.name}
          addLabel="Add printing option"
          blank={() => ({ id: `print-${Date.now().toString(36)}`, name: "New option", description: "" })}
          fields={[
            { key: "name", label: "Name", type: "text" },
            { key: "id", label: "ID", type: "text" },
            { key: "description", label: "Description", type: "textarea", width: "full" },
          ]}
        />
      )}
    </div>
  );
}

function SettingsEditor({ cat, onChange }: { cat: Catalog; onChange: (c: Catalog) => void }) {
  const s = cat.settings;
  const set = (p: Partial<Catalog["settings"]>) => onChange({ ...cat, settings: { ...s, ...p } });
  const num = (label: string, key: keyof Catalog["settings"], hint?: string) => (
    <label className="field">
      <span>{label}</span>
      <input className="input" type="number" value={s[key] as number} onChange={(e) => set({ [key]: Number(e.target.value) })} />
      {hint && <small>{hint}</small>}
    </label>
  );
  return (
    <div>
      <div className="admin-title">
        <h1>Settings</h1>
      </div>
      <div className="le-card">
        <div className="le-fields">
          <label className="field">
            <span>Company name (shown in the builder)</span>
            <input className="input" value={s.companyName} onChange={(e) => set({ companyName: e.target.value })} />
          </label>
          <label className="field">
            <span>Default unit</span>
            <select className="input" value={s.defaultUnit} onChange={(e) => set({ defaultUnit: e.target.value as "mm" })}>
              <option value="mm">mm</option>
              <option value="cm">cm</option>
              <option value="in">inches</option>
            </select>
          </label>
          {num("Bleed (mm)", "bleedMm")}
          {num("Safe margin (mm)", "safeMm")}
          {num("Max upload size (MB)", "maxUploadMb")}
          {num("Minimum order quantity", "minQuantity")}
          <label className="field">
            <span>Maximum sheet size (mm)</span>
            <div className="row">
              <input className="input" type="number" value={s.maxSheetMm.w} onChange={(e) => set({ maxSheetMm: { ...s.maxSheetMm, w: Number(e.target.value) } })} />
              ×
              <input className="input" type="number" value={s.maxSheetMm.h} onChange={(e) => set({ maxSheetMm: { ...s.maxSheetMm, h: Number(e.target.value) } })} />
            </div>
            <small>Flat dielines larger than this are rejected as invalid sizes.</small>
          </label>
          <label className="field">
            <span>Quantity suggestions</span>
            <input
              className="input"
              defaultValue={s.quantityPresets.join(", ")}
              onBlur={(e) => set({ quantityPresets: e.target.value.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0) })}
            />
          </label>
          <label className="field inline">
            <span>Allow custom sizes</span>
            <input type="checkbox" checked={s.allowCustomSizes} onChange={(e) => set({ allowCustomSizes: e.target.checked })} />
          </label>
          <label className="field full">
            <span>Quote form introduction</span>
            <textarea className="input" rows={3} value={s.quoteIntro} onChange={(e) => set({ quoteIntro: e.target.value })} />
          </label>
        </div>
      </div>
    </div>
  );
}
