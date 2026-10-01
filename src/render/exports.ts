import type { ResolvedCatalog } from "../../shared/catalog";
import { describePaint, panelPaint, type Design, type ImageElement } from "../../shared/design";
import type { Dieline } from "../../shared/dieline";
import type { Pt } from "../../shared/geom";
import { loadOriginal } from "../lib/images";
import { renderDesign, type RenderSources } from "./renderDesign";

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** Highest resolution the browser can safely allocate, capped at `dpi`. */
export function exportScale(dl: Dieline, dpi: number): number {
  const maxPixels = isIOS() ? 16_000_000 : 64_000_000;
  const maxSide = isIOS() ? 4096 : 16000;
  return Math.min(dpi / 25.4, maxSide / dl.width, maxSide / dl.height, Math.sqrt(maxPixels / (dl.width * dl.height)));
}

function canvasFor(dl: Dieline, px: number) {
  const c = document.createElement("canvas");
  c.width = Math.round(dl.width * px);
  c.height = Math.round(dl.height * px);
  return c;
}

const toBlob = (c: HTMLCanvasElement, type = "image/png", q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not create file."))), type, q));

/** Load full-resolution originals for every image in the design (falls back to the preview). */
export async function loadPrintSources(design: Design, preview: RenderSources): Promise<RenderSources> {
  const map = new Map<string, CanvasImageSource>();
  const images = design.elements.filter((e): e is ImageElement => e.type === "image");
  await Promise.all(
    images.map(async (e) => {
      if (map.has(e.originalAssetId)) return;
      try {
        map.set(e.originalAssetId, await loadOriginal(e.originalAssetId, e.mime));
      } catch {
        /* preview fallback */
      }
    }),
  );
  return { image: (el) => map.get(el.originalAssetId) ?? preview.image(el) };
}

export interface PrintFiles {
  print: Blob;
  proof: Blob;
  dielineSvg: Blob;
  masks: { finishId: string; blob: Blob }[];
  dpi: number;
}

export async function buildPrintFiles(
  dl: Dieline,
  design: Design,
  cat: ResolvedCatalog,
  preview: RenderSources,
  onStep: (s: string) => void,
): Promise<PrintFiles> {
  onStep("Loading full-resolution artwork…");
  const hi = await loadPrintSources(design, preview);
  const px = exportScale(dl, 300);
  onStep(`Rendering print file at ${Math.round(px * 25.4)} DPI…`);
  const c = canvasFor(dl, px);
  renderDesign(c.getContext("2d")!, dl, design, cat, hi, { pxPerMm: px, mode: "color", board: false });
  const print = await toBlob(c);

  const masks: PrintFiles["masks"] = [];
  const used = [...new Set(design.elements.flatMap((e) => e.finishes))].filter((id) => cat.finishes.some((f) => f.id === id));
  for (const finishId of used) {
    onStep(`Rendering ${cat.finishes.find((f) => f.id === finishId)?.name ?? finishId} mask…`);
    const ctx = c.getContext("2d")!;
    renderDesign(ctx, dl, design, cat, hi, { pxPerMm: px, mode: "mask", board: false, maskFinishId: finishId });
    // White background so the mask is unambiguous in any viewer.
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.restore();
    masks.push({ finishId, blob: await toBlob(c) });
  }
  c.width = c.height = 1; // release memory

  onStep("Creating proof…");
  const ppx = exportScale(dl, 110);
  const pc = canvasFor(dl, ppx);
  const pctx = pc.getContext("2d")!;
  pctx.fillStyle = "#ffffff";
  pctx.fillRect(0, 0, pc.width, pc.height);
  const art = canvasFor(dl, ppx);
  renderDesign(art.getContext("2d")!, dl, design, cat, hi, { pxPerMm: ppx, mode: "color", board: true });
  pctx.drawImage(art, 0, 0);
  drawGuides(pctx, dl, ppx);
  const proof = await toBlob(pc, "image/jpeg", 0.9);

  onStep("Creating vector dieline…");
  const artJpeg = art.toDataURL("image/jpeg", 0.85);
  const svg = dielineSvg(dl, design, cat, artJpeg);
  return { print, proof, dielineSvg: new Blob([svg], { type: "image/svg+xml" }), masks, dpi: Math.round(px * 25.4) };
}

function drawGuides(ctx: CanvasRenderingContext2D, dl: Dieline, px: number) {
  ctx.save();
  ctx.setTransform(px, 0, 0, px, 0, 0);
  const lw = 1.4 / px;
  const segs = (list: [Pt, Pt][]) => {
    ctx.beginPath();
    for (const [a, b] of list) {
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  };
  const poly = (pts: Pt[]) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  ctx.lineWidth = lw;
  ctx.strokeStyle = "rgba(245,158,11,0.9)";
  ctx.setLineDash([2, 1.5]);
  for (const p of dl.panels) {
    poly(p.dilated);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(22,163,74,0.8)";
  ctx.setLineDash([1.5, 1.5]);
  for (const p of dl.panels) if (p.safe && p.printable) (poly(p.safe), ctx.stroke());
  ctx.strokeStyle = "#2563eb";
  ctx.setLineDash([3, 2]);
  segs(dl.foldLines);
  ctx.strokeStyle = "#e11d48";
  ctx.setLineDash([]);
  segs(dl.cutLines);
  ctx.fillStyle = "rgba(20,20,20,0.35)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of dl.panels) {
    const size = Math.max(2, Math.min(4.5, p.bbox.w / 12, p.bbox.h / 6));
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.save();
    ctx.translate(p.center[0], p.center[1]);
    ctx.rotate((p.upright * Math.PI) / 180);
    // Label near the panel's top edge so it doesn't cover the artwork.
    const half = (p.upright === 90 || p.upright === 270 ? p.bbox.w : p.bbox.h) / 2;
    ctx.fillText(p.label.toUpperCase(), 0, -half + size * 1.2 + dl.safeMargin);
    ctx.restore();
  }
  ctx.restore();
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const f = (n: number) => n.toFixed(3);

/**
 * Production dieline: vector cut / crease / bleed / safe layers in mm, with a
 * locked low-res artwork layer for position reference.
 */
export function dielineSvg(dl: Dieline, design: Design, cat: ResolvedCatalog, artDataUrl?: string): string {
  const path = (segs: [Pt, Pt][]) => segs.map(([a, b]) => `M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`).join("");
  const poly = (pts: Pt[]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${f(x)} ${f(y)}`).join("") + "Z";
  const tpl = cat.templates.find((t) => t.id === design.styleId);
  const dims = (tpl?.dimensions ?? []).map((d) => `${d.label} ${design.dims[d.key]}`).join(" × ");
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${f(dl.width)}mm" height="${f(dl.height)}mm" viewBox="0 0 ${f(dl.width)} ${f(dl.height)}">`,
    `<title>${esc(`${tpl?.name ?? design.styleId} – ${dims} mm`)}</title>`,
    `<desc>${esc(`Units: mm. Bleed ${dl.bleed} mm, safe margin ${dl.safeMargin} mm. Material: ${cat.materials.find((m) => m.id === design.materialId)?.name ?? design.materialId}. Background: ${describePaint(design.colors.base)}.`)}</desc>`,
  ];
  if (artDataUrl) lines.push(`<g id="Artwork_Reference" opacity="1"><image x="0" y="0" width="${f(dl.width)}" height="${f(dl.height)}" preserveAspectRatio="none" xlink:href="${artDataUrl}"/></g>`);
  lines.push(
    `<g id="Bleed" fill="none" stroke="#f59e0b" stroke-width="0.2" stroke-dasharray="1.5 1">${dl.panels.map((p) => `<path d="${poly(p.dilated)}"/>`).join("")}</g>`,
    `<g id="Safe_Area" fill="none" stroke="#16a34a" stroke-width="0.2" stroke-dasharray="1 1">${dl.panels
      .filter((p) => p.safe && p.printable)
      .map((p) => `<path d="${poly(p.safe!)}"/>`)
      .join("")}</g>`,
    `<g id="Crease" fill="none" stroke="#2563eb" stroke-width="0.3" stroke-dasharray="3 2"><path d="${path(dl.foldLines)}"/></g>`,
    `<g id="Cut" fill="none" stroke="#e11d48" stroke-width="0.3"><path d="${path(dl.cutLines)}"/></g>`,
    `<g id="Panel_Labels" font-family="Arial, sans-serif" font-size="4" fill="#555" text-anchor="middle">${dl.panels
      .map((p) => {
        const c = panelPaint(design, p.id);
        return `<text transform="translate(${f(p.center[0])} ${f(p.center[1])}) rotate(${p.upright})" dominant-baseline="middle">${esc(p.label)}${p.printable && c ? ` (${esc(c.hex)})` : ""}</text>`;
      })
      .join("")}</g>`,
    `</svg>`,
  );
  return lines.join("\n");
}

export function dataUrlToBlob(url: string): Blob {
  const [head, b64] = url.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
