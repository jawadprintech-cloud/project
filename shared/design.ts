import type { Unit } from "./catalog";
import type { Dieline, DielinePanel } from "./dieline";
import type { Pt } from "./geom";

/** A colour with optional print references (CMYK build / Pantone) for the print team. */
export interface Paint {
  hex: string;
  cmyk?: [number, number, number, number];
  pantone?: string;
}

interface ElementBase {
  id: string;
  /** Panel the element is anchored to. */
  panelId: string;
  /** Centre offset from the panel centre, as a fraction of the panel's bounding box. */
  x: number;
  y: number;
  /** Size in mm (for text this is the measured bounding box). */
  w: number;
  h: number;
  /** Clockwise rotation in degrees. */
  rotation: number;
  opacity: number;
  /** Clip to the owning panel (+ bleed where it meets a cut edge). */
  clip: boolean;
  /** Area finish ids (spot UV, foil, emboss…). */
  finishes: string[];
  locked?: boolean;
}

export interface ImageElement extends ElementBase {
  type: "image";
  /** Optimised preview (used for the editor and 3D). */
  assetId: string;
  /** Untouched original upload (used for the print file). */
  originalAssetId: string;
  fileName: string;
  mime: string;
  pxWidth: number;
  pxHeight: number;
}

export interface TextElement extends ElementBase {
  type: "text";
  text: string;
  fontFamily: string;
  /** Font size in points. */
  fontSize: number;
  color: Paint;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  /** Extra spacing between letters, in thousandths of an em (like design tools). */
  letterSpacing: number;
  lineHeight: number;
}

export type QrContent =
  | { kind: "url"; url: string }
  | { kind: "text"; text: string }
  | { kind: "contact"; name: string; org: string; phone: string; email: string; url: string; address: string }
  | { kind: "email"; email: string; subject: string; body: string }
  | { kind: "phone"; phone: string };

export interface QrElement extends ElementBase {
  type: "qr";
  content: QrContent;
  /** Encoded payload. */
  data: string;
  fg: Paint;
  bg: Paint | null;
  ecc: "L" | "M" | "Q" | "H";
}

export interface ShapeElement extends ElementBase {
  type: "shape";
  shape: "rect" | "ellipse" | "line";
  fill: Paint | null;
  stroke: Paint | null;
  strokeWidth: number;
  radius: number;
}

export type DesignElement = ImageElement | TextElement | QrElement | ShapeElement;

export interface Design {
  version: 1;
  name: string;
  styleId: string;
  dims: Record<string, number>;
  sizeMode: "standard" | "custom";
  standardSizeId?: string;
  unit: Unit;
  materialId: string;
  colors: {
    /** Background ink for the whole box; null = unprinted board. */
    base: Paint | null;
    /** Per-panel override; null = unprinted, missing = use base. */
    panels: Record<string, Paint | null>;
  };
  laminationId: string | null;
  elements: DesignElement[];
}

export const PT_TO_MM = 25.4 / 72;

export function uid(prefix = "el"): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${r}`;
}

/** Element centre in sheet mm. Falls back to the sheet centre if the panel no longer exists. */
export function elementCenter(dl: Dieline, el: { panelId: string; x: number; y: number }): Pt {
  const p = dl.byId[el.panelId];
  if (!p) return [dl.width / 2, dl.height / 2];
  return [p.center[0] + el.x * p.bbox.w, p.center[1] + el.y * p.bbox.h];
}

/** Relative position for a given sheet point, anchored to `panel`. */
export function relativeTo(panel: DielinePanel, [u, v]: Pt): { x: number; y: number } {
  return { x: (u - panel.center[0]) / panel.bbox.w, y: (v - panel.center[1]) / panel.bbox.h };
}

/** Effective paint for a panel background. */
export function panelPaint(design: Design, panelId: string): Paint | null {
  return panelId in design.colors.panels ? design.colors.panels[panelId] : design.colors.base;
}

export function describePaint(p: Paint | null | undefined): string {
  if (!p) return "Unprinted";
  const refs = [p.hex.toUpperCase()];
  if (p.pantone) refs.push(`Pantone ${p.pantone}`);
  if (p.cmyk) refs.push(`C${p.cmyk[0]} M${p.cmyk[1]} Y${p.cmyk[2]} K${p.cmyk[3]}`);
  return refs.join(" · ");
}
