import { elementCenter, uid, type DesignElement } from "../../shared/design";
import { toUnit } from "../../shared/catalog";
import { ColorPicker } from "../components/ColorPicker";
import { elementSize } from "../render/renderDesign";
import { useElementOps, useStudio } from "./context";

export function effectiveDpi(el: DesignElement): number | null {
  if (el.type !== "image") return null;
  return Math.round(Math.min(el.pxWidth / (el.w / 25.4), el.pxHeight / (el.h / 25.4)));
}

const TYPE_LABEL: Record<DesignElement["type"], string> = { image: "Image", text: "Text", qr: "QR code", shape: "Shape" };

export function Inspector() {
  const s = useStudio();
  const ops = useElementOps();
  const el = s.selected;
  const unit = s.design.unit;

  if (!el) {
    const p = s.activePanel;
    const count = s.design.elements.filter((e) => e.panelId === p.id).length;
    return (
      <div className="inspector">
        <div className="insp-head">
          <strong>{p.label}</strong>
          <span className="tag">{p.printable ? "Panel" : "Glue area – not printed"}</span>
        </div>
        <p className="muted">
          {toUnit(p.bbox.w, unit)} × {toUnit(p.bbox.h, unit)} {unit} · {count} item{count === 1 ? "" : "s"}
        </p>
        <ul className="legend">
          <li><i className="lg-cut" /> Cut line</li>
          <li><i className="lg-fold" /> Fold line</li>
          <li><i className="lg-bleed" /> Bleed ({s.catalog.settings.bleedMm} mm) – extend backgrounds into it</li>
          <li><i className="lg-safe" /> Safe area – keep text & logos inside</li>
        </ul>
        <p className="hint">Guides are never printed. Select an item on the dieline to edit it.</p>
      </div>
    );
  }

  const panel = s.dieline.byId[el.panelId] ?? s.activePanel;
  const [w, h] = elementSize(el);
  const [cx, cy] = elementCenter(s.dieline, el);
  const offX = cx - panel.center[0], offY = cy - panel.center[1];
  const setOffset = (dx: number, dy: number) =>
    ops.patch(el.id, { x: dx / panel.bbox.w, y: dy / panel.bbox.h }, `pos:${el.id}`);
  const idx = s.design.elements.findIndex((e) => e.id === el.id);
  const reorder = (to: number) =>
    s.update((d) => {
      const arr = d.elements.slice();
      const [it] = arr.splice(idx, 1);
      arr.splice(Math.max(0, Math.min(arr.length, to)), 0, it);
      return { ...d, elements: arr };
    });
  const fitPanel = (mode: "fit" | "fill") => {
    const turned = ((Math.round(el.rotation / 90) % 2) + 2) % 2 === 1;
    const pw = (turned ? panel.bbox.h : panel.bbox.w) + (mode === "fill" ? 2 * s.dieline.bleed : 0);
    const ph = (turned ? panel.bbox.w : panel.bbox.h) + (mode === "fill" ? 2 * s.dieline.bleed : 0);
    const k = mode === "fill" ? Math.max(pw / el.w, ph / el.h) : Math.min(pw / el.w, ph / el.h);
    const rotation = Math.round(el.rotation / 90) * 90;
    if (el.type === "shape" && mode === "fill") ops.patch(el.id, { w: pw, h: ph, x: 0, y: 0, rotation });
    else ops.patch(el.id, { w: el.w * k, h: el.h * k, x: 0, y: 0, rotation });
  };
  const dpi = effectiveDpi(el);
  const num = (label: string, value: number, onChange: (v: number) => void, suffix: string, step = 1) => (
    <label className="mini-field">
      <span>{label}</span>
      <input className="input" type="number" step={step} value={Math.round(value * 10) / 10} onChange={(e) => Number.isFinite(parseFloat(e.target.value)) && onChange(parseFloat(e.target.value))} disabled={s.readOnly} />
      <em>{suffix}</em>
    </label>
  );

  return (
    <div className="inspector">
      <div className="insp-head">
        <strong>{TYPE_LABEL[el.type]}</strong>
        <select className="input compact" value={el.panelId} onChange={(e) => {
            // Keep the item reading upright on the assembled box when it moves to a differently oriented panel.
            const to = s.dieline.byId[e.target.value];
            const rotation = ((el.rotation + (to?.upright ?? 0) - panel.upright) % 360 + 360) % 360;
            ops.patch(el.id, { panelId: e.target.value, x: 0, y: 0, rotation });
          }} aria-label="Panel" disabled={s.readOnly}>
          {s.dieline.panels.filter((p) => p.printable).map((p) => (
            <option key={p.id} value={p.id}>
              on {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid4">
        {num("X", toUnit(offX, unit), (v) => setOffset((v * (unit === "in" ? 25.4 : unit === "cm" ? 10 : 1)), offY), unit)}
        {num("Y", toUnit(offY, unit), (v) => setOffset(offX, v * (unit === "in" ? 25.4 : unit === "cm" ? 10 : 1)), unit)}
        {el.type !== "text" &&
          num("W", toUnit(w, unit), (v) => {
            const mm = v * (unit === "in" ? 25.4 : unit === "cm" ? 10 : 1);
            if (mm <= 0) return;
            ops.patch(el.id, el.type === "image" ? { w: mm, h: (el.h * mm) / el.w } : el.type === "qr" ? { w: mm, h: mm } : { w: mm }, `w:${el.id}`);
          }, unit)}
        {el.type === "shape" && num("H", toUnit(h, unit), (v) => v > 0 && ops.patch(el.id, { h: v * (unit === "in" ? 25.4 : unit === "cm" ? 10 : 1) }, `h:${el.id}`), unit)}
        {num("Rotate", el.rotation, (v) => ops.patch(el.id, { rotation: ((v % 360) + 360) % 360 }, `rot:${el.id}`), "°")}
        <label className="mini-field">
          <span>Opacity</span>
          <input className="input" type="number" min={0} max={100} value={Math.round(el.opacity * 100)} onChange={(e) => ops.patch(el.id, { opacity: Math.max(0, Math.min(1, Number(e.target.value) / 100)) }, `op:${el.id}`)} disabled={s.readOnly} />
          <em>%</em>
        </label>
      </div>
      {dpi !== null && (
        <p className={`dpi ${dpi < 150 ? "bad" : dpi < 250 ? "meh" : "good"}`}>
          Print resolution: <strong>{dpi} DPI</strong> {dpi < 150 ? "– too low, may print blurry" : dpi < 250 ? "– acceptable" : "– excellent"}
        </p>
      )}
      {el.type === "shape" && (
        <>
          <span className="label">{el.shape === "line" ? "Line colour" : "Fill"}</span>
          <ColorPicker
            idKey={`shape-${el.id}`}
            value={el.shape === "line" ? el.stroke : el.fill}
            allowNone={el.shape !== "line"}
            swatches={s.catalog.colors}
            onChange={(p, k) => ops.patch(el.id, el.shape === "line" ? { stroke: p } : { fill: p }, k)}
          />
          {el.shape === "rect" && num("Corner radius", el.radius, (v) => ops.patch(el.id, { radius: Math.max(0, v) }, `rad:${el.id}`), "mm")}
        </>
      )}
      <div className="btn-row wrap">
        <button className="btn small" onClick={() => ops.patch(el.id, { x: 0, y: 0 })} disabled={s.readOnly}>Centre on panel</button>
        {(el.type === "image" || el.type === "shape") && (
          <>
            <button className="btn small" onClick={() => fitPanel("fit")} disabled={s.readOnly}>Fit panel</button>
            <button className="btn small" onClick={() => fitPanel("fill")} disabled={s.readOnly} title="Cover the panel including bleed">Fill panel</button>
          </>
        )}
        <button className="btn small" onClick={() => ops.patch(el.id, { rotation: panel.upright })} disabled={s.readOnly} title="Rotate so it reads upright on the assembled box">Upright on box</button>
      </div>
      <div className="row between">
        <label className="check">
          <input type="checkbox" checked={el.clip} onChange={(e) => ops.patch(el.id, { clip: e.target.checked })} disabled={s.readOnly} /> Clip to panel
        </label>
        <label className="check">
          <input type="checkbox" checked={!!el.locked} onChange={(e) => ops.patch(el.id, { locked: e.target.checked })} disabled={s.readOnly} /> Lock
        </label>
      </div>
      <div className="btn-row">
        <button className="btn small" title="Bring to front" onClick={() => reorder(s.design.elements.length)} disabled={s.readOnly}>⤒ Front</button>
        <button className="btn small" title="Bring forward" onClick={() => reorder(idx + 1)} disabled={s.readOnly}>↑</button>
        <button className="btn small" title="Send backward" onClick={() => reorder(idx - 1)} disabled={s.readOnly}>↓</button>
        <button className="btn small" title="Send to back" onClick={() => reorder(0)} disabled={s.readOnly}>⤓ Back</button>
      </div>
      <div className="btn-row">
        <button
          className="btn small"
          disabled={s.readOnly}
          onClick={() => {
            const copy = { ...el, id: uid(), x: el.x + 0.05, y: el.y + 0.05 } as DesignElement;
            ops.add(copy);
          }}
        >
          Duplicate
        </button>
        <button className="btn small danger" onClick={() => ops.remove(el.id)} disabled={s.readOnly}>Delete</button>
      </div>
    </div>
  );
}
