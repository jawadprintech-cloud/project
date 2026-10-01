import type { ResolvedCatalog } from "../../shared/catalog";
import { resolveStyles } from "../../shared/catalog";
import type { Dieline, DielinePanel } from "../../shared/dieline";
import { PT_TO_MM, uid, type Design, type ImageElement, type QrContent, type QrElement, type ShapeElement, type TextElement } from "../../shared/design";
import { encodeQr } from "../lib/qr";

export function newDesign(cat: ResolvedCatalog, styleId?: string): Design {
  const styles = resolveStyles(cat);
  const style = styles.find((s) => s.template.id === styleId) ?? styles[0];
  const std = style.standardSizes[0];
  const dims = std ? { ...std.dims } : Object.fromEntries(style.template.dimensions.map((d) => [d.key, d.default]));
  const material = cat.materials.find((m) => m.id === "corrugated-white" && style.template.id === "mailer-box") ?? cat.materials[0];
  return {
    version: 1,
    name: "Untitled design",
    styleId: style.template.id,
    dims,
    sizeMode: std ? "standard" : "custom",
    standardSizeId: std?.id,
    unit: cat.settings.defaultUnit,
    materialId: material?.id ?? "",
    colors: { base: { hex: "#ffffff" }, panels: {} },
    laminationId: null,
    elements: [],
  };
}

/** The panel artwork should go to by default: the front, else the largest printable panel. */
export function defaultPanel(dl: Dieline): DielinePanel {
  return (
    dl.panels.find((p) => p.face === "front") ??
    dl.panels.filter((p) => p.printable).sort((a, b) => b.bbox.w * b.bbox.h - a.bbox.w * a.bbox.h)[0] ??
    dl.panels[0]
  );
}

const base = (panel: DielinePanel) => ({
  id: uid(),
  panelId: panel.id,
  x: 0,
  y: 0,
  rotation: panel.upright,
  opacity: 1,
  clip: true,
  finishes: [] as string[],
});

/** Fit a w×h box into the panel (accounting for its upright rotation), at most `frac` of the panel. */
function fitSize(panel: DielinePanel, w: number, h: number, frac: number): [number, number] {
  const turned = panel.upright === 90 || panel.upright === 270;
  const pw = turned ? panel.bbox.h : panel.bbox.w, ph = turned ? panel.bbox.w : panel.bbox.h;
  const s = Math.min((pw * frac) / w, (ph * frac) / h);
  return [w * s, h * s];
}

export function makeImage(panel: DielinePanel, a: Omit<ImageElement, keyof ReturnType<typeof base> | "type" | "w" | "h">): ImageElement {
  const [w, h] = fitSize(panel, a.pxWidth, a.pxHeight, 0.6);
  return { ...base(panel), type: "image", w, h, ...a };
}

export function makeText(panel: DielinePanel, preset: "heading" | "subheading" | "body", font: string): TextElement {
  const sizes = { heading: 28, subheading: 16, body: 10 };
  const turned = panel.upright === 90 || panel.upright === 270;
  const span = turned ? panel.bbox.h : panel.bbox.w;
  // Keep default text comfortably inside small panels.
  const pt = Math.max(6, Math.min(sizes[preset], (span * 0.1) / PT_TO_MM));
  return {
    ...base(panel),
    type: "text",
    w: 0,
    h: 0,
    text: preset === "heading" ? "Your Brand" : preset === "subheading" ? "Tagline goes here" : "Add your product details here",
    fontFamily: font,
    fontSize: Math.round(pt),
    color: { hex: "#1a1a1a" },
    bold: preset !== "body",
    italic: false,
    align: "center",
    letterSpacing: preset === "heading" ? 20 : 0,
    lineHeight: 1.2,
  };
}

export function makeQr(panel: DielinePanel, content: QrContent): QrElement {
  const turned = panel.upright === 90 || panel.upright === 270;
  const span = Math.min(turned ? panel.bbox.h : panel.bbox.w, turned ? panel.bbox.w : panel.bbox.h);
  const size = Math.max(20, Math.min(35, span * 0.5));
  return {
    ...base(panel),
    type: "qr",
    w: size,
    h: size,
    content,
    data: encodeQr(content),
    fg: { hex: "#000000" },
    bg: { hex: "#ffffff" },
    ecc: "M",
  };
}

export function makeShape(panel: DielinePanel, shape: ShapeElement["shape"], hex: string): ShapeElement {
  const [w, h] = shape === "line" ? fitSize(panel, 100, 1, 0.7) : fitSize(panel, 1, shape === "ellipse" ? 1 : 0.6, 0.5);
  return {
    ...base(panel),
    type: "shape",
    shape,
    w,
    h: shape === "line" ? 0.8 : h,
    fill: shape === "line" ? null : { hex },
    stroke: shape === "line" ? { hex } : null,
    strokeWidth: shape === "line" ? 0.8 : 0,
    radius: 0,
  };
}
