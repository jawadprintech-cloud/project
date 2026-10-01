import { PT_TO_MM, type TextElement } from "../../shared/design";
import { fontString } from "../lib/fonts";

/** Text is laid out at a fixed 100px reference size and scaled, so metrics are stable at any zoom. */
const REF = 100;

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d")!;
  return measureCtx;
}

export interface TextLayout {
  /** Scale from reference px to mm. */
  k: number;
  lines: { text: string; width: number; offsets: number[] }[];
  /** Box size in reference px. */
  width: number;
  height: number;
  lineH: number;
  /** Box size in mm. */
  wMm: number;
  hMm: number;
}

type TextProps = Pick<TextElement, "text" | "fontFamily" | "fontSize" | "bold" | "italic" | "letterSpacing" | "lineHeight">;

export function layoutText(el: TextProps, ctx: CanvasRenderingContext2D = mctx()): TextLayout {
  ctx.font = fontString(el.fontFamily, el.bold, el.italic, REF);
  const spacing = (el.letterSpacing / 1000) * REF;
  const lines = (el.text || " ").split("\n").map((text) => {
    const offsets: number[] = [];
    let width: number;
    if (spacing === 0) {
      width = ctx.measureText(text).width;
    } else {
      // Per-glyph positions that keep kerning: advance of the prefix + accumulated spacing.
      const chars = Array.from(text);
      let prefix = "";
      for (let i = 0; i < chars.length; i++) {
        offsets.push(ctx.measureText(prefix).width + i * spacing);
        prefix += chars[i];
      }
      width = ctx.measureText(text).width + Math.max(0, chars.length - 1) * spacing;
    }
    return { text, width, offsets };
  });
  const lineH = REF * el.lineHeight;
  const width = Math.max(1, ...lines.map((l) => l.width));
  const height = lineH * lines.length;
  const k = (el.fontSize * PT_TO_MM) / REF;
  return { k, lines, width, height, lineH, wMm: width * k, hMm: height * k };
}

/** Draw text centred on the current origin (mm space). */
export function drawText(ctx: CanvasRenderingContext2D, el: TextElement, fill: string | CanvasGradient) {
  const L = layoutText(el, ctx);
  ctx.save();
  ctx.scale(L.k, L.k);
  ctx.font = fontString(el.fontFamily, el.bold, el.italic, REF);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = fill;
  L.lines.forEach((line, i) => {
    const y = -L.height / 2 + (i + 0.5) * L.lineH;
    const x = el.align === "left" ? -L.width / 2 : el.align === "right" ? L.width / 2 - line.width : -line.width / 2;
    if (!line.offsets.length) {
      ctx.fillText(line.text, x, y);
    } else {
      Array.from(line.text).forEach((ch, j) => ctx.fillText(ch, x + line.offsets[j], y));
    }
  });
  ctx.restore();
}
