import type { Expr } from "./expr";

/**
 * Declarative dieline template format.
 *
 * A box is described as a tree of panels ("hinge tree"). A root panel is a
 * plain rectangle; every other panel is attached to one edge of its parent's
 * frame rectangle and folds around that edge by `fold` degrees (positive =
 * toward the unprinted/inside face). All sizes are expressions over the box
 * dimensions (L, W, H, ...), template `vars`, and the global `bleed`/`safe`.
 *
 * Adding a new box style = adding one JSON document in this format, either in
 * `shared/templates/` (bundled) or through the admin panel (stored at runtime).
 */

export type EdgeName = "top" | "right" | "bottom" | "left";
export type FaceName = "front" | "back" | "left" | "right" | "top" | "bottom";
export type PanelKind = "panel" | "flap" | "tuck" | "dust" | "glue" | "inner";

export interface TemplateShape {
  /** Inset of the far corners along the hinge: one value or [start, end]. Makes tapered flaps. */
  inset?: Expr | [Expr, Expr];
  /** Round the two far corners with this radius. */
  radius?: Expr;
  /** Curvature of the far edge: positive bulges outward, negative dips inward (scoop). */
  farSag?: Expr;
  /** Curved score: the hinge bows into the parent panel by this amount (e.g. pillow box ends). */
  hingeSag?: Expr;
  /** Custom polygon in local coordinates [along hinge, away from hinge]; may use `len` and `depth`. */
  points?: [Expr, Expr][];
}

export interface TemplatePanel {
  id: string;
  label: string;
  /** Which side of the finished box this panel represents (used for labels & default views). */
  face?: FaceName;
  kind?: PanelKind;
  /** Non-printable panels (glue flaps) stay the raw board colour. Default true. */
  printable?: boolean;
  /** Root panels only: rectangle size. */
  w?: Expr;
  h?: Expr;
  /** Child panels: attachment. */
  parent?: string;
  edge?: EdgeName;
  /** Distance from the hinge to the far edge. */
  depth?: Expr;
  /** Length along the hinge (default: the full parent edge). */
  length?: Expr;
  offset?: Expr;
  align?: "start" | "center" | "end";
  shape?: TemplateShape;
  /** Fold angle in degrees when the box is closed (default 90). */
  fold?: Expr;
  /** Fold angle when the box is shown "open" (lids). Defaults to `fold`. */
  openFold?: Expr;
  /** Offset in mm toward the inside face, used to stack overlapping flaps in 3D. */
  layer?: Expr;
}

export interface TemplatePlacement {
  /** Position of the piece root's top-left corner, relative to the primary root's top-left (x right, y up, z toward viewer). */
  position?: [Expr, Expr, Expr];
  /** Euler rotation in degrees (XYZ order). */
  rotation?: [Expr, Expr, Expr];
}

export interface TemplatePiece {
  id: string;
  label: string;
  root: string;
  place?: TemplatePlacement;
  openPlace?: TemplatePlacement;
}

export interface TemplateDimension {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  help?: string;
}

export interface TemplateDeform {
  type: "pillow";
  length: Expr;
  width: Expr;
  thickness: Expr;
}

export interface StandardSize {
  id: string;
  label: string;
  dims: Record<string, number>;
}

export interface BoxTemplate {
  schema: 1;
  id: string;
  name: string;
  description: string;
  dimensions: TemplateDimension[];
  constraints?: { expr: string; message: string }[];
  vars?: Record<string, Expr>;
  pieces: TemplatePiece[];
  panels: TemplatePanel[];
  deform?: TemplateDeform;
  standardSizes?: StandardSize[];
}
