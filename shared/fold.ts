import type { Dieline, DielinePanel, Placement } from "./dieline";
import type { Pt } from "./geom";
import {
  applyDir,
  applyPoint,
  axisRotation,
  eulerRotation,
  multiply,
  translation,
  type Mat4,
  type Vec3,
} from "./mat4";

/**
 * Fold state: `progress` 0 = flat sheet, 1 = fully folded.
 * `open` 0 = closed, 1 = lids open (uses openFold / openPlace).
 */
export interface FoldState {
  progress: number;
  open: number;
  /** Unfold panels in sequence (outermost flaps first) instead of all at once. */
  stagger?: boolean;
}

/**
 * Single "open amount" used by the viewer's Open/Close control:
 * 0 = closed box, then lids/tucks open, then the box unfolds panel by panel, 1 = flat dieline.
 */
export function foldFromOpenAmount(dl: Dieline, t: number): FoldState {
  const a = dl.hasOpenState ? 0.3 : 0;
  const tt = Math.max(0, Math.min(1, t));
  const open = a ? Math.min(1, tt / a) : 0;
  const progress = 1 - Math.max(0, (tt - a) / (1 - a));
  return { progress, open, stagger: true };
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Per-panel fold amount when staggered: deepest (outermost) panels unfold first. */
function panelProgress(p: number, depth: number, maxDepth: number): number {
  if (maxDepth <= 1) return smooth(p);
  const u = 1 - p; // unfold amount
  const k = maxDepth - depth; // 0 for the outermost flaps
  const w = Math.min(1, 2.2 / maxDepth);
  const start = (k / (maxDepth - 1)) * (1 - w);
  const local = Math.max(0, Math.min(1, (u - start) / w));
  return 1 - smooth(local);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Sheet (u right, v down) -> flat 3D (x right, y up, z toward viewer = printed side). */
export const flat3 = ([u, v]: Pt): Vec3 => [u, -v, 0];

function placementMatrix(pl: Placement, rootTL: Pt): Mat4 {
  const [u0, v0] = rootTL;
  return multiply(
    multiply(translation(pl.position[0], pl.position[1], pl.position[2]), eulerRotation(pl.rotation)),
    translation(-u0, v0, 0),
  );
}

/**
 * World matrix for every panel. Each panel inherits its parent's transform and
 * rotates around its hinge; folds go toward the unprinted side.
 */
export function panelTransforms(dl: Dieline, s: FoldState): Record<string, Mat4> {
  const out: Record<string, Mat4> = {};
  const p = Math.max(0, Math.min(1, s.progress));
  const maxDepth = Math.max(1, ...dl.panels.map((q) => q.treeDepth));
  for (const piece of dl.pieces) {
    const root = dl.byId[piece.root];
    const tl: Pt = [root.frame.x, root.frame.y];
    const closed = piece.place;
    const target: Placement = piece.openPlace
      ? {
          position: closed.position.map((v, i) => lerp(v, piece.openPlace!.position[i], s.open)) as Vec3,
          rotation: closed.rotation.map((v, i) => lerp(v, piece.openPlace!.rotation[i], s.open)) as Vec3,
        }
      : closed;
    // Flat layout keeps the sheet arrangement, centred on the origin.
    const flatPos: Vec3 = [tl[0] - dl.width / 2, -tl[1] + dl.height / 2, 0];
    const pl: Placement = {
      position: flatPos.map((v, i) => lerp(v, target.position[i], p)) as Vec3,
      rotation: target.rotation.map((v) => v * p) as Vec3,
    };
    const visit = (panel: DielinePanel, parentM: Mat4 | null) => {
      let m: Mat4;
      if (!parentM || !panel.hinge || !panel.outward) {
        m = placementMatrix(pl, tl);
      } else {
        const h = flat3(panel.hinge[0]);
        const n: Vec3 = [panel.outward[0], -panel.outward[1], 0];
        const axis: Vec3 = [-n[1], n[0], 0];
        const pp = s.stagger ? panelProgress(p, panel.treeDepth, maxDepth) : p;
        const angle = lerp(panel.fold, panel.openFold, s.open) * pp;
        m = multiply(
          parentM,
          multiply(multiply(translation(h[0], h[1], h[2]), axisRotation(axis, angle)), translation(-h[0], -h[1], -h[2])),
        );
      }
      out[panel.id] = m;
      for (const c of panel.children) visit(dl.byId[c], m);
    };
    visit(root, null);
  }
  return out;
}

/** Matrix used for the visible mesh: adds the stacking offset toward the inside face. */
export function meshMatrix(m: Mat4, panel: DielinePanel, progress: number): Mat4 {
  if (!panel.layer) return m;
  return multiply(m, translation(0, 0, -panel.layer * Math.min(1, progress)));
}

/** Optional shape deformation (e.g. pillow boxes bulge in the middle). Operates on pre-centering world coords. */
export function deformPoint(dl: Dieline, panel: DielinePanel, m: Mat4, pt: Vec3, progress: number): Vec3 {
  const d = dl.deform;
  if (!d || panel.kind !== "panel" || progress <= 0) return pt;
  const n = applyDir(m, [0, 0, 1]);
  const s = Math.sign(n[2]);
  if (Math.abs(n[2]) < 0.5) return pt;
  const tx = Math.max(0, Math.min(1, pt[0] / d.length));
  const ty = Math.max(0, Math.min(1, -pt[1] / d.width));
  const across = Math.pow(Math.sin(Math.PI * ty), 0.55);
  const along = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * tx - 1), 3)), 0.5);
  const bulge = (d.thickness / 2) * across * along * progress * progress;
  return [pt[0], pt[1], pt[2] + s * bulge];
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  size: Vec3;
}

export function foldedBounds(dl: Dieline, s: FoldState): Bounds {
  const mats = panelTransforms(dl, s);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const panel of dl.panels) {
    const m = meshMatrix(mats[panel.id], panel, s.progress);
    for (const q of panel.polygon) {
      const w = deformPoint(dl, panel, m, applyPoint(m, flat3(q)), s.progress);
      for (let i = 0; i < 3; i++) {
        if (w[i] < min[i]) min[i] = w[i];
        if (w[i] > max[i]) max[i] = w[i];
      }
    }
  }
  const center = min.map((v, i) => (v + max[i]) / 2) as Vec3;
  const size = min.map((v, i) => max[i] - v) as Vec3;
  return { min, max, center, size };
}
