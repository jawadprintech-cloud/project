import { useEffect, useMemo, useRef, useState } from "react";
import type { FontOption } from "../../shared/catalog";
import { panelPaint, type QrContent, type QrElement, type TextElement } from "../../shared/design";
import { ColorPicker } from "../components/ColorPicker";
import { api, assetUrl } from "../lib/api";
import { contrastRatio } from "../lib/color";
import { ACCEPT_ATTR, prepareUpload } from "../lib/images";
import { encodeQr, minQrSizeMm, qrMatrix, QUIET_ZONE } from "../lib/qr";
import { makeImage, makeQr, makeShape, makeText } from "../state/factory";
import { useElementOps, useStudio } from "./context";

function PanelTarget() {
  const s = useStudio();
  const printable = s.dieline.panels.filter((p) => p.printable);
  return (
    <label className="field inline">
      <span>Add to panel</span>
      <select className="input" value={s.activePanel.id} onChange={(e) => s.setActivePanel(e.target.value)}>
        {printable.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ------------------------------------------------------------------ artwork
export function ArtworkPanel() {
  const s = useStudio();
  const ops = useElementOps();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);

  const upload = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      setBusy((b) => [...b, file.name]);
      try {
        const prep = await prepareUpload(file, s.catalog.settings.maxUploadMb);
        const [orig, prev] = await Promise.all([
          api.uploadAsset(prep.original, file.name),
          api.uploadAsset(prep.preview, `preview-${file.name}`),
        ]);
        s.images.prime(prev.id, prep.preview);
        ops.add(
          makeImage(s.activePanel, {
            assetId: prev.id,
            originalAssetId: orig.id,
            fileName: file.name,
            mime: prep.mime,
            pxWidth: prep.pxWidth,
            pxHeight: prep.pxHeight,
          }),
        );
        s.toast(`Added ${file.name} to ${s.activePanel.label}`, "success");
      } catch (e) {
        s.toast((e as Error).message, "error");
      } finally {
        setBusy((b) => b.filter((n) => n !== file.name));
      }
    }
  };

  const images = s.design.elements.filter((e) => e.type === "image");
  return (
    <div className="tool">
      <h2>Upload artwork</h2>
      <PanelTarget />
      <div
        className={`dropzone ${drag ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!s.readOnly) upload(e.dataTransfer.files);
        }}
        onClick={() => !s.readOnly && input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      >
        <strong>Drop files here or click to browse</strong>
        <span>JPEG, PNG, TIFF or WebP · up to {s.catalog.settings.maxUploadMb} MB</span>
        <span>For sharp print, use 300 DPI artwork.</span>
        <input
          ref={input}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {busy.map((n) => (
        <div key={n} className="progress-row">
          <span className="spinner" /> Uploading {n}…
        </div>
      ))}
      {images.length > 0 && (
        <>
          <h3>On your box</h3>
          <div className="thumb-grid">
            {images.map((im) => (
              <button key={im.id} className={`img-thumb ${s.selected?.id === im.id ? "on" : ""}`} onClick={() => s.select(im.id)} title={`${im.fileName} · ${s.dieline.byId[im.panelId]?.label ?? ""}`}>
                <img src={assetUrl(im.assetId)} alt={im.fileName} />
              </button>
            ))}
          </div>
        </>
      )}
      <h3>Shapes</h3>
      <div className="btn-row">
        <button className="btn" disabled={s.readOnly} onClick={() => ops.add(makeShape(s.activePanel, "rect", "#1d3557"))}>▭ Rectangle</button>
        <button className="btn" disabled={s.readOnly} onClick={() => ops.add(makeShape(s.activePanel, "ellipse", "#e5446d"))}>◯ Circle</button>
        <button className="btn" disabled={s.readOnly} onClick={() => ops.add(makeShape(s.activePanel, "line", "#1a1a1a"))}>― Line</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ text
function FontSelect({ value, fonts, onChange }: { value: string; fonts: FontOption[]; onChange: (f: string) => void }) {
  const groups: [string, FontOption["category"]][] = [
    ["Sans serif", "sans"],
    ["Serif", "serif"],
    ["Display", "display"],
    ["Script", "script"],
    ["Monospace", "mono"],
  ];
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: `"${value}"` }} aria-label="Font">
      {groups.map(([label, cat]) => {
        const list = fonts.filter((f) => f.category === cat);
        return list.length ? (
          <optgroup key={cat} label={label}>
            {list.map((f) => (
              <option key={f.family} value={f.family} style={{ fontFamily: `"${f.family}"` }}>
                {f.family}
              </option>
            ))}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}

export function TextEditor({ el }: { el: TextElement }) {
  const s = useStudio();
  const ops = useElementOps();
  const set = (patch: Partial<TextElement>, key: string) => ops.patch(el.id, patch, `${key}:${el.id}`);
  const font = s.catalog.fonts.find((f) => f.family === el.fontFamily);
  return (
    <div className="text-editor">
      <textarea className="input" rows={3} value={el.text} onChange={(e) => set({ text: e.target.value }, "text")} aria-label="Text" disabled={s.readOnly} />
      <div className="row">
        <FontSelect value={el.fontFamily} fonts={s.catalog.fonts} onChange={(f) => set({ fontFamily: f }, "font")} />
        <div className="unit-input narrow">
          <input className="input" type="number" min={2} max={400} step={1} value={el.fontSize} onChange={(e) => set({ fontSize: Math.max(2, Number(e.target.value) || 2) }, "size")} aria-label="Font size" />
          <span>pt</span>
        </div>
      </div>
      <div className="row">
        <div className="seg small" role="group" aria-label="Style">
          <button className={el.bold ? "on" : ""} onClick={() => set({ bold: !el.bold }, "b")} aria-pressed={el.bold} title={font && !font.bold ? "This font has no bold weight; bold will be simulated" : "Bold"}>
            <b>B</b>
          </button>
          <button className={el.italic ? "on" : ""} onClick={() => set({ italic: !el.italic }, "i")} aria-pressed={el.italic} title="Italic">
            <i>I</i>
          </button>
        </div>
        <div className="seg small" role="group" aria-label="Alignment">
          {(["left", "center", "right"] as const).map((a) => (
            <button key={a} className={el.align === a ? "on" : ""} onClick={() => set({ align: a }, "align")} title={`Align ${a}`}>
              {a === "left" ? "⇤" : a === "center" ? "↔" : "⇥"}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Letter spacing · {el.letterSpacing}</span>
        <input type="range" min={-100} max={600} step={5} value={el.letterSpacing} onChange={(e) => set({ letterSpacing: Number(e.target.value) }, "ls")} />
      </label>
      <label className="field">
        <span>Line height · {el.lineHeight.toFixed(2)}</span>
        <input type="range" min={0.7} max={2.5} step={0.05} value={el.lineHeight} onChange={(e) => set({ lineHeight: Number(e.target.value) }, "lh")} />
      </label>
      <span className="label">Text colour</span>
      <ColorPicker idKey={`text-${el.id}`} value={el.color} swatches={s.catalog.colors} onChange={(p, k) => p && ops.patch(el.id, { color: p }, k)} />
    </div>
  );
}

export function TextPanel() {
  const s = useStudio();
  const ops = useElementOps();
  const font = s.catalog.fonts[0]?.family ?? "Arial";
  const sel = s.selected?.type === "text" ? s.selected : null;
  return (
    <div className="tool">
      <h2>Text</h2>
      <PanelTarget />
      <div className="text-presets">
        <button className="preset h" disabled={s.readOnly} onClick={() => ops.add(makeText(s.activePanel, "heading", font))}>Add a heading</button>
        <button className="preset sh" disabled={s.readOnly} onClick={() => ops.add(makeText(s.activePanel, "subheading", font))}>Add a subheading</button>
        <button className="preset b" disabled={s.readOnly} onClick={() => ops.add(makeText(s.activePanel, "body", font))}>Add body text</button>
      </div>
      {sel ? (
        <>
          <h3>Edit selected text</h3>
          <TextEditor el={sel} />
        </>
      ) : (
        <p className="hint">Select text on the dieline to edit its font, size, colour and spacing. Drag the round handle to rotate.</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ QR
const EMPTY: Record<QrContent["kind"], QrContent> = {
  url: { kind: "url", url: "" },
  text: { kind: "text", text: "" },
  contact: { kind: "contact", name: "", org: "", phone: "", email: "", url: "", address: "" },
  email: { kind: "email", email: "", subject: "", body: "" },
  phone: { kind: "phone", phone: "" },
};

function QrThumb({ data, ecc, fg, bg }: { data: string; ecc: QrElement["ecc"]; fg: string; bg: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!data) return;
    try {
      const m = qrMatrix(data, ecc);
      const unit = c.width / (m.size + 2 * QUIET_ZONE);
      ctx.fillStyle = bg ?? "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.save();
      ctx.translate(QUIET_ZONE * unit, QUIET_ZONE * unit);
      ctx.scale(unit, unit);
      ctx.fillStyle = fg;
      if (m.path) ctx.fill(m.path);
      ctx.restore();
    } catch {
      /* too long */
    }
  }, [data, ecc, fg, bg]);
  return <canvas ref={ref} width={160} height={160} className="qr-thumb" aria-label="QR code preview" />;
}

export function QrPanel() {
  const s = useStudio();
  const ops = useElementOps();
  const sel = s.selected?.type === "qr" ? s.selected : null;
  const [draft, setDraft] = useState<QrContent>(sel?.content ?? EMPTY.url);
  useEffect(() => {
    if (sel) setDraft(sel.content);
  }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const content = sel ? sel.content : draft;
  const data = encodeQr(content);
  let tooLong = false;
  try {
    if (data) qrMatrix(data, sel?.ecc ?? "M");
  } catch {
    tooLong = true;
  }
  const setContent = (c: QrContent) => {
    if (sel) ops.patch(sel.id, { content: c, data: encodeQr(c) }, `qr:${sel.id}`);
    else setDraft(c);
  };
  const field = (key: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field" key={key}>
      <span>{label}</span>
      <input
        className="input"
        value={(content as unknown as Record<string, string>)[key] ?? ""}
        onChange={(e) => setContent({ ...content, [key]: e.target.value } as QrContent)}
        disabled={s.readOnly}
        {...props}
      />
    </label>
  );
  const kinds: [QrContent["kind"], string][] = [
    ["url", "Website"],
    ["text", "Text"],
    ["contact", "Contact"],
    ["email", "Email"],
    ["phone", "Phone"],
  ];
  const checks = sel ? qrChecks(sel) : [];
  return (
    <div className="tool">
      <h2>QR code</h2>
      <div className="seg small wrap" role="tablist">
        {kinds.map(([k, label]) => (
          <button key={k} className={content.kind === k ? "on" : ""} onClick={() => setContent(EMPTY[k])} disabled={s.readOnly}>
            {label}
          </button>
        ))}
      </div>
      {content.kind === "url" && field("url", "Website URL", { placeholder: "www.yourbrand.com", inputMode: "url" })}
      {content.kind === "text" && (
        <label className="field">
          <span>Text</span>
          <textarea className="input" rows={3} value={content.text} onChange={(e) => setContent({ ...content, text: e.target.value })} disabled={s.readOnly} />
        </label>
      )}
      {content.kind === "contact" && (
        <>
          {field("name", "Full name")}
          {field("org", "Company")}
          {field("phone", "Phone", { inputMode: "tel" })}
          {field("email", "Email", { inputMode: "email" })}
          {field("url", "Website")}
          {field("address", "Address")}
        </>
      )}
      {content.kind === "email" && (
        <>
          {field("email", "Email address", { inputMode: "email" })}
          {field("subject", "Subject")}
          {field("body", "Message")}
        </>
      )}
      {content.kind === "phone" && field("phone", "Phone number", { inputMode: "tel" })}
      {tooLong && <p className="error-note">This content is too long for a QR code. Shorten it.</p>}
      <div className="qr-preview">
        <QrThumb data={tooLong ? "" : data} ecc={sel?.ecc ?? "M"} fg={sel?.fg.hex ?? "#000000"} bg={sel ? (sel.bg?.hex ?? null) : "#ffffff"} />
        {!sel && (
          <div>
            <PanelTarget />
            <button className="btn primary" disabled={!data || tooLong || s.readOnly} onClick={() => ops.add(makeQr(s.activePanel, draft))}>
              Add QR code to box
            </button>
          </div>
        )}
        {sel && (
          <ul className="checks">
            {checks.map((c) => (
              <li key={c.text} className={c.ok ? "ok" : "warn"}>
                {c.ok ? "✓" : "!"} {c.text}
              </li>
            ))}
          </ul>
        )}
      </div>
      {sel && (
        <>
          <label className="field inline">
            <span>Error correction</span>
            <select className="input" value={sel.ecc} onChange={(e) => ops.patch(sel.id, { ecc: e.target.value as QrElement["ecc"] })}>
              <option value="L">Low (7%)</option>
              <option value="M">Medium (15%) – recommended</option>
              <option value="Q">Quartile (25%)</option>
              <option value="H">High (30%)</option>
            </select>
          </label>
          <span className="label">Code colour</span>
          <ColorPicker idKey={`qrfg-${sel.id}`} value={sel.fg} swatches={s.catalog.colors} onChange={(p, k) => p && ops.patch(sel.id, { fg: p }, k)} />
          <span className="label">Background</span>
          <ColorPicker idKey={`qrbg-${sel.id}`} value={sel.bg} allowNone noneLabel="Transparent (use box colour)" swatches={s.catalog.colors} onChange={(p, k) => ops.patch(sel.id, { bg: p }, k)} />
        </>
      )}
    </div>
  );
}

export function qrChecks(el: QrElement): { ok: boolean; text: string }[] {
  const min = minQrSizeMm(el.data, el.ecc);
  const bg = el.bg?.hex ?? "#ffffff";
  const ratio = contrastRatio(el.fg.hex, bg);
  const darkOnLight = contrastRatio(el.fg.hex, "#000000") < contrastRatio(bg, "#000000");
  return [
    { ok: !!el.data, text: el.data ? "Content encoded" : "Add content to encode" },
    { ok: el.w >= min, text: el.w >= min ? `Size ${el.w.toFixed(0)} mm is large enough` : `Make it at least ${min} mm wide to scan reliably` },
    {
      ok: ratio >= 4 && darkOnLight,
      text: ratio >= 4 && darkOnLight ? "Good contrast" : "Use a dark code on a light background for reliable scanning",
    },
    ...(el.bg ? [] : [{ ok: false, text: "Transparent background: make sure the box colour behind it is light" }]),
    ...(el.finishes.length ? [{ ok: false, text: "Finishes on QR codes can reduce scannability" }] : []),
  ];
}

// ------------------------------------------------------------------ colours
export function ColorsPanel() {
  const s = useStudio();
  const [scope, setScope] = useState<"box" | "panel">("box");
  const printable = s.dieline.panels.filter((p) => p.printable && p.kind === "panel");
  const panel = s.activePanel;
  const override = panel.id in s.design.colors.panels;
  const material = s.catalog.materials.find((m) => m.id === s.design.materialId);
  return (
    <div className="tool">
      <h2>Colours</h2>
      <div className="seg">
        <button className={scope === "box" ? "on" : ""} onClick={() => setScope("box")}>Whole box</button>
        <button className={scope === "panel" ? "on" : ""} onClick={() => setScope("panel")}>Single panel</button>
      </div>
      {scope === "box" ? (
        <>
          <p className="hint">Background colour for every printable panel. Choose “no ink” to show the raw {material?.name ?? "board"}.</p>
          <ColorPicker
            idKey="base"
            value={s.design.colors.base}
            allowNone
            noneLabel="No ink (raw board)"
            swatches={s.catalog.colors}
            onChange={(p, k) => s.update((d) => ({ ...d, colors: { ...d.colors, base: p } }), k)}
          />
          {Object.keys(s.design.colors.panels).length > 0 && (
            <button className="btn link" onClick={() => s.update((d) => ({ ...d, colors: { ...d.colors, panels: {} } }))}>
              Reset {Object.keys(s.design.colors.panels).length} panel colour override(s)
            </button>
          )}
        </>
      ) : (
        <>
          <label className="field inline">
            <span>Panel</span>
            <select className="input" value={panel.id} onChange={(e) => s.setActivePanel(e.target.value)}>
              {printable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              {!printable.includes(panel) && <option value={panel.id}>{panel.label}</option>}
            </select>
          </label>
          <p className="hint">Tip: click any panel on the dieline or the 3D box to select it.</p>
          <ColorPicker
            idKey={`panel-${panel.id}`}
            value={panelPaint(s.design, panel.id)}
            allowNone
            noneLabel="No ink (raw board)"
            swatches={s.catalog.colors}
            onChange={(p, k) => s.update((d) => ({ ...d, colors: { ...d.colors, panels: { ...d.colors.panels, [panel.id]: p } } }), k)}
          />
          {override && (
            <button
              className="btn link"
              onClick={() =>
                s.update((d) => {
                  const panels = { ...d.colors.panels };
                  delete panels[panel.id];
                  return { ...d, colors: { ...d.colors, panels } };
                })
              }
            >
              Use the whole-box colour for this panel
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ finishes
export function FinishesPanel() {
  const s = useStudio();
  const ops = useElementOps();
  const lams = s.catalog.finishes.filter((f) => f.kind === "lamination");
  const areas = s.catalog.finishes.filter((f) => f.kind === "area");
  const sel = s.selected;
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of s.design.elements) for (const f of e.finishes) c[f] = (c[f] ?? 0) + 1;
    return c;
  }, [s.design.elements]);

  const toggle = (id: string) => {
    if (!sel) return;
    const f = s.catalog.finishes.find((x) => x.id === id)!;
    let next = sel.finishes.includes(id) ? sel.finishes.filter((x) => x !== id) : [...sel.finishes, id];
    if (!sel.finishes.includes(id)) {
      // Only one foil colour, and emboss/deboss are mutually exclusive.
      const clash = (o: string) => {
        const g = s.catalog.finishes.find((x) => x.id === o);
        if (!g || o === id) return false;
        return (f.effect === "foil" && g.effect === "foil") || (["emboss", "deboss"].includes(f.effect) && ["emboss", "deboss"].includes(g.effect));
      };
      next = next.filter((o) => !clash(o));
    }
    ops.patch(sel.id, { finishes: next });
  };

  return (
    <div className="tool">
      <h2>Finishes</h2>
      <h3>Lamination (whole box)</h3>
      <div className="option-list" role="radiogroup">
        <label className={`option ${!s.design.laminationId ? "on" : ""}`}>
          <input type="radio" name="lam" checked={!s.design.laminationId} onChange={() => s.update((d) => ({ ...d, laminationId: null }))} disabled={s.readOnly} />
          <span>
            <strong>No lamination</strong>
            <small>Uncoated print.</small>
          </span>
        </label>
        {lams.map((f) => (
          <label key={f.id} className={`option ${s.design.laminationId === f.id ? "on" : ""}`}>
            <input type="radio" name="lam" checked={s.design.laminationId === f.id} onChange={() => s.update((d) => ({ ...d, laminationId: f.id }))} disabled={s.readOnly} />
            <span>
              <strong>{f.name}</strong>
              <small>{f.description}</small>
            </span>
          </label>
        ))}
      </div>
      <h3>Special finishes (selected artwork)</h3>
      {!sel ? (
        <p className="hint">Select a logo, text or shape on the dieline, then choose Spot UV, foil, embossing or debossing for it. The 3D preview shows the effect.</p>
      ) : (
        <p className="hint">
          Applying to: <strong>{sel.type === "text" ? `“${sel.text.slice(0, 24)}”` : sel.type === "image" ? sel.fileName : sel.type === "qr" ? "QR code" : "Shape"}</strong>
        </p>
      )}
      <div className="option-list">
        {areas.map((f) => (
          <label key={f.id} className={`option ${sel?.finishes.includes(f.id) ? "on" : ""} ${!sel ? "disabled" : ""}`}>
            <input type="checkbox" checked={!!sel?.finishes.includes(f.id)} disabled={!sel || s.readOnly} onChange={() => toggle(f.id)} />
            {f.color && <span className="chip" style={{ background: f.color }} />}
            <span>
              <strong>{f.name}</strong>
              <small>
                {f.description}
                {counts[f.id] ? ` · used on ${counts[f.id]} item${counts[f.id] > 1 ? "s" : ""}` : ""}
              </small>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
