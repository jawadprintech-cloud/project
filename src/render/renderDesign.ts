import type { ResolvedCatalog, FinishOption } from "../../shared/catalog";
import type { Dieline, DielinePanel } from "../../shared/dieline";
import { elementCenter, panelPaint, type Design, type DesignElement, type ImageElement } from "../../shared/design";
import { signedArea, type Pt } from "../../shared/geom";
import { qrMatrix, QUIET_ZONE } from "../lib/qr";
import { drawText, layoutText } from "./text";

export interface RenderSources {
  /** Drawable for an image element, or null while loading. */
  image: (el: ImageElement) => CanvasImageSource | null;
}

export type RenderMode =
  /** What gets printed (+ board colour under unprinted panels). */
  | "color"
  /** R = bump height, G = roughness, B = metalness — drives the 3D material. */
  | "finish"
  /** Black-on-transparent mask of one area finish, for the print team. */
  | "mask"
  /** White where a glossy coating sits (gloss lamination, spot UV) — drives the 3D clearcoat. */
  | "coat";

export interface RenderOptions {
  pxPerMm: number;
  mode: RenderMode;
  /** Draw the raw board under everything (3D texture / editor). Off for the print file. */
  board: boolean;
  /** Editor extras: placeholders for loading images, metallic hint for foil. */
  editor?: boolean;
  /** For mode "mask": which finish. */
  maskFinishId?: string;
}

interface PanelPaths {
  poly: Map<string, Path2D>;
  dilated: Map<string, Path2D>;
  others: Map<string, Path2D>;
  printUnion: Path2D;
  unprintable: Path2D;
}

const pathCache = new WeakMap<Dieline, PanelPaths>();

function polyPath(pts: Pt[], into = new Path2D()): Path2D {
  // Normalise winding so unions with the nonzero rule never cancel out.
  const p = signedArea(pts) < 0 ? pts.slice().reverse() : pts;
  p.forEach(([x, y], i) => (i ? into.lineTo(x, y) : into.moveTo(x, y)));
  into.closePath();
  return into;
}

function bigRect(dl: Dieline, into = new Path2D()) {
  into.rect(-10, -10, dl.width + 20, dl.height + 20);
  return into;
}

export function panelPaths(dl: Dieline): PanelPaths {
  let pp = pathCache.get(dl);
  if (pp) return pp;
  const poly = new Map<string, Path2D>();
  const dilated = new Map<string, Path2D>();
  const others = new Map<string, Path2D>();
  const printUnion = new Path2D();
  const unprintable = bigRect(dl);
  for (const p of dl.panels) {
    poly.set(p.id, polyPath(p.polygon));
    dilated.set(p.id, polyPath(p.dilated));
    if (p.printable) polyPath(p.dilated, printUnion);
    else polyPath(p.polygon, unprintable);
  }
  for (const p of dl.panels) {
    const o = bigRect(dl);
    for (const q of dl.panels) if (q !== p) polyPath(q.polygon, o);
    others.set(p.id, o);
  }
  pp = { poly, dilated, others, printUnion, unprintable };
  pathCache.set(dl, pp);
  return pp;
}

/** Clip to a panel plus the bleed beyond its cut edges (but never onto neighbouring panels). */
function clipPanel(ctx: CanvasRenderingContext2D, pp: PanelPaths, p: DielinePanel) {
  ctx.clip(pp.dilated.get(p.id)!);
  ctx.clip(pp.others.get(p.id)!, "evenodd");
}

function clipPrintable(ctx: CanvasRenderingContext2D, pp: PanelPaths) {
  ctx.clip(pp.printUnion, "nonzero");
  ctx.clip(pp.unprintable, "evenodd");
}

export function finishById(cat: ResolvedCatalog, id: string | null | undefined): FinishOption | undefined {
  return id ? cat.finishes.find((f) => f.id === id) : undefined;
}

const LAM_ROUGHNESS: Record<string, number> = { matte: 0.62, gloss: 0.14, "soft-touch": 0.92 };

function finishChannels(el: DesignElement, cat: ResolvedCatalog, baseRough: number): [number, number, number] | null {
  let r = 128, g = Math.round(baseRough * 255), b = 0;
  let any = false;
  for (const id of el.finishes) {
    const f = finishById(cat, id);
    if (!f) continue;
    any = true;
    if (f.effect === "spot-uv") g = 10;
    if (f.effect === "foil") {
      g = 85; // brushed-metal roughness: catches more light than a mirror at most angles
      b = 255;
    }
    if (f.effect === "emboss") r = 255;
    if (f.effect === "deboss") r = 0;
  }
  return any ? [r, g, b] : null;
}

export function foilColor(el: DesignElement, cat: ResolvedCatalog): string | null {
  for (const id of el.finishes) {
    const f = finishById(cat, id);
    if (f?.effect === "foil") return f.color ?? "#d4af37";
  }
  return null;
}

/** Element size in mm (text is measured). */
export function elementSize(el: DesignElement): [number, number] {
  if (el.type === "text") {
    const L = layoutText(el);
    return [L.wMm, L.hMm];
  }
  if (el.type === "qr") return [el.w, el.w];
  return [el.w, el.h];
}

function metallic(ctx: CanvasRenderingContext2D, color: string, w: number, h: number): CanvasGradient {
  const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.45, "#ffffff");
  g.addColorStop(0.55, color);
  g.addColorStop(1, color);
  return g;
}

let scratch: HTMLCanvasElement | null = null;

/** Draw one element at the origin. `fill` overrides all colours (used for masks and foil). */
function drawElementBody(
  ctx: CanvasRenderingContext2D,
  el: DesignElement,
  src: RenderSources,
  pxPerMm: number,
  fill: string | CanvasGradient | null,
  editor: boolean,
) {
  const [w, h] = elementSize(el);
  switch (el.type) {
    case "image": {
      const img = src.image(el);
      if (!img) {
        if (editor) {
          ctx.fillStyle = "rgba(120,130,150,0.18)";
          ctx.fillRect(-w / 2, -h / 2, w, h);
        }
        return;
      }
      if (!fill) {
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        return;
      }
      // Tint the image's alpha shape with the fill colour.
      const cw = Math.max(1, Math.min(2048, Math.round(w * pxPerMm)));
      const ch = Math.max(1, Math.min(2048, Math.round(h * pxPerMm)));
      scratch ??= document.createElement("canvas");
      scratch.width = cw;
      scratch.height = ch;
      const s = scratch.getContext("2d")!;
      s.clearRect(0, 0, cw, ch);
      s.drawImage(img, 0, 0, cw, ch);
      s.globalCompositeOperation = "source-in";
      if (typeof fill === "string") s.fillStyle = fill;
      else {
        const g = s.createLinearGradient(0, 0, cw, ch);
        g.addColorStop(0, "#b8962e");
        g.addColorStop(0.5, "#fff6d0");
        g.addColorStop(1, "#b8962e");
        s.fillStyle = g;
      }
      s.fillRect(0, 0, cw, ch);
      s.globalCompositeOperation = "source-over";
      ctx.drawImage(scratch, -w / 2, -h / 2, w, h);
      return;
    }
    case "text":
      drawText(ctx, el, fill ?? el.color.hex);
      return;
    case "qr": {
      const size = el.w;
      let m;
      try {
        m = qrMatrix(el.data, el.ecc);
      } catch {
        ctx.fillStyle = "rgba(220,38,38,0.25)";
        ctx.fillRect(-size / 2, -size / 2, size, size);
        return;
      }
      const total = m.size + 2 * QUIET_ZONE;
      const unit = size / total;
      if (el.bg && !fill) {
        ctx.fillStyle = el.bg.hex;
        ctx.fillRect(-size / 2, -size / 2, size, size);
      }
      ctx.save();
      ctx.translate(-size / 2 + QUIET_ZONE * unit, -size / 2 + QUIET_ZONE * unit);
      ctx.scale(unit, unit);
      ctx.fillStyle = fill ?? el.fg.hex;
      if (m.path) ctx.fill(m.path);
      ctx.restore();
      return;
    }
    case "shape": {
      ctx.beginPath();
      if (el.shape === "ellipse") ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      else if (el.shape === "line") ctx.rect(-w / 2, -el.strokeWidth / 2, w, el.strokeWidth);
      else if (el.radius > 0) ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(el.radius, w / 2, h / 2));
      else ctx.rect(-w / 2, -h / 2, w, h);
      if (el.shape === "line") {
        const c = fill ?? el.stroke?.hex ?? el.fill?.hex;
        if (c) {
          ctx.fillStyle = c;
          ctx.fill();
        }
        return;
      }
      if (el.fill || fill) {
        ctx.fillStyle = fill ?? el.fill!.hex;
        ctx.fill();
      }
      if (el.stroke && el.strokeWidth > 0) {
        ctx.lineWidth = el.strokeWidth;
        ctx.strokeStyle = fill ?? el.stroke.hex;
        ctx.stroke();
      }
    }
  }
}

/**
 * Render the flat design onto `ctx` (canvas sized dl.width × dl.height × pxPerMm).
 * One renderer feeds the editor, the 3D textures and the print/proof files, so they always match.
 */
export function renderDesign(
  ctx: CanvasRenderingContext2D,
  dl: Dieline,
  design: Design,
  cat: ResolvedCatalog,
  src: RenderSources,
  o: RenderOptions,
) {
  const pp = panelPaths(dl);
  const px = o.pxPerMm;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(px, 0, 0, px, 0, 0);
  ctx.imageSmoothingQuality = "high";
  const material = cat.materials.find((m) => m.id === design.materialId) ?? cat.materials[0];
  const lam = finishById(cat, design.laminationId);
  const baseRough = lam ? (LAM_ROUGHNESS[lam.effect] ?? 0.8) : 0.82;

  if (o.mode === "finish") {
    ctx.fillStyle = `rgb(128,${Math.round(baseRough * 255)},0)`;
    ctx.fillRect(0, 0, dl.width, dl.height);
  } else if (o.mode === "coat") {
    ctx.fillStyle = lam?.effect === "gloss" ? "#ffffff" : "#000000";
    ctx.fillRect(0, 0, dl.width, dl.height);
  } else if (o.mode === "color" && o.board && material) {
    ctx.fillStyle = material.boardColor;
    for (const p of dl.panels) ctx.fill(pp.poly.get(p.id)!);
  }

  if (o.mode === "color") {
    for (const p of dl.panels) {
      if (!p.printable) continue;
      const paint = panelPaint(design, p.id);
      if (!paint) continue;
      ctx.save();
      clipPanel(ctx, pp, p);
      ctx.fillStyle = paint.hex;
      ctx.fillRect(p.bbox.x - dl.bleed - 1, p.bbox.y - dl.bleed - 1, p.bbox.w + 2 * dl.bleed + 2, p.bbox.h + 2 * dl.bleed + 2);
      ctx.restore();
    }
  }

  for (const el of design.elements) {
    const panel = dl.byId[el.panelId];
    let fill: string | CanvasGradient | null = null;
    if (o.mode === "finish") {
      const ch = finishChannels(el, cat, baseRough);
      if (!ch) continue;
      fill = `rgb(${ch[0]},${ch[1]},${ch[2]})`;
    } else if (o.mode === "coat") {
      if (!el.finishes.some((id) => finishById(cat, id)?.effect === "spot-uv")) continue;
      fill = "#ffffff";
    } else if (o.mode === "mask") {
      if (!o.maskFinishId || !el.finishes.includes(o.maskFinishId)) continue;
      fill = "#000000";
    }
    ctx.save();
    if (el.clip && panel) clipPanel(ctx, pp, panel);
    else clipPrintable(ctx, pp);
    const [cx, cy] = elementCenter(dl, el);
    ctx.translate(cx, cy);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.globalAlpha = o.mode === "color" ? el.opacity : 1;
    if (o.mode === "color") {
      const foil = foilColor(el, cat);
      if (foil) {
        const [w, h] = elementSize(el);
        fill = o.editor ? metallic(ctx, foil, w, h) : foil;
      }
    }
    if (o.mode === "finish") {
      const f = el.finishes.map((id) => finishById(cat, id));
      if (f.some((x) => x?.effect === "emboss" || x?.effect === "deboss")) ctx.filter = `blur(${Math.max(1, px * 0.5)}px)`;
    }
    drawElementBody(ctx, el, src, px, fill, !!o.editor);
    ctx.restore();
  }
  ctx.restore();
}

/** Corners of an element's rotated box in sheet mm. */
export function elementCorners(dl: Dieline, el: DesignElement): Pt[] {
  const [w, h] = elementSize(el);
  const [cx, cy] = elementCenter(dl, el);
  const a = (el.rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as Pt);
}
