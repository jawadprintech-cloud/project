import { evalOr, evaluate, ExprError, type Scope } from "./expr";
import {
  bboxOf,
  collinearOverlap,
  dedupe,
  filletPolygon,
  offsetPolygon,
  signedArea,
  subtractIntervals,
  unionRect,
  lerpPt,
  type Pt,
  type Rect,
  type Seg,
} from "./geom";
import type { BoxTemplate, EdgeName, FaceName, PanelKind, TemplatePanel } from "./template-types";
import { applyDir, applyDirInverse, type Vec3 } from "./mat4";
import { panelTransforms } from "./fold";

export interface Placement {
  position: Vec3;
  rotation: Vec3;
}

export interface DielinePanel {
  id: string;
  label: string;
  face?: FaceName;
  kind: PanelKind;
  printable: boolean;
  piece: string;
  parent?: string;
  edge?: EdgeName;
  children: string[];
  treeDepth: number;
  /** Outline in sheet coordinates (mm, y down). */
  polygon: Pt[];
  /** Attachment frame rectangle (children attach to its sides). */
  frame: Rect;
  bbox: Rect;
  center: Pt;
  /** Hinge chord with the parent (sheet coords) and unit direction from hinge into this panel. */
  hinge?: Seg;
  outward?: Pt;
  fold: number;
  openFold: number;
  layer: number;
  /** Panel outline grown by the bleed (for artwork clipping). */
  dilated: Pt[];
  /** Panel outline shrunk by the safe margin; null if the panel is too small. */
  safe: Pt[] | null;
  /** Rotation (deg, clockwise) that makes artwork upright on the assembled box. */
  upright: number;
}

export interface DielinePiece {
  id: string;
  label: string;
  root: string;
  bbox: Rect;
  place: Placement;
  openPlace?: Placement;
}

export interface Dieline {
  templateId: string;
  dims: Record<string, number>;
  width: number;
  height: number;
  bleed: number;
  safeMargin: number;
  panels: DielinePanel[];
  byId: Record<string, DielinePanel>;
  pieces: DielinePiece[];
  cutLines: Seg[];
  foldLines: Seg[];
  deform?: { type: "pillow"; length: number; width: number; thickness: number };
  hasOpenState: boolean;
}

export interface BuildOptions {
  bleed: number;
  safe: number;
}

export class TemplateError extends Error {}

const OUTWARD: Record<EdgeName, Pt> = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

/** Scope with dimensions, globals and template vars (evaluated in order). */
export function templateScope(t: BoxTemplate, dims: Record<string, number>, opts: BuildOptions): Scope {
  const scope: Scope = { bleed: opts.bleed, safe: opts.safe };
  for (const d of t.dimensions) scope[d.key] = dims[d.key] ?? d.default;
  for (const [k, v] of Object.entries(t.vars ?? {})) {
    try {
      scope[k] = evaluate(v, scope);
    } catch (e) {
      throw new TemplateError(`Variable "${k}": ${(e as Error).message}`);
    }
  }
  return scope;
}

export function buildDieline(t: BoxTemplate, dimsIn: Record<string, number>, opts: BuildOptions): Dieline {
  const dims: Record<string, number> = {};
  for (const d of t.dimensions) dims[d.key] = dimsIn[d.key] ?? d.default;
  const scope = templateScope(t, dims, opts);
  const tp = new Map<string, TemplatePanel>();
  for (const p of t.panels) {
    if (tp.has(p.id)) throw new TemplateError(`Duplicate panel id "${p.id}"`);
    tp.set(p.id, p);
  }

  interface Work {
    tpl: TemplatePanel;
    frame: Rect;
    local: Pt[]; // polygon (sheet coords, before piece layout)
    hinge?: Seg;
    outward?: Pt;
    piece: string;
    depth: number;
    isPlainRect: boolean;
    hingeCurves: { edge: EdgeName; a0: number; pts: Pt[] }[];
  }
  const work = new Map<string, Work>();
  const visiting = new Set<string>();
  const pieceOfRoot = new Map<string, string>();
  for (const pc of t.pieces) pieceOfRoot.set(pc.root, pc.id);

  const ev = (expr: Parameters<typeof evaluate>[0], s: Scope, what: string) => {
    try {
      return evaluate(expr, s);
    } catch (e) {
      throw new TemplateError(`${what}: ${(e as Error).message}`);
    }
  };

  function build(id: string): Work {
    const done = work.get(id);
    if (done) return done;
    const p = tp.get(id);
    if (!p) throw new TemplateError(`Unknown panel "${id}"`);
    if (visiting.has(id)) throw new TemplateError(`Panel "${id}" is part of a parent cycle`);
    visiting.add(id);
    let w: Work;
    if (!p.parent) {
      const piece = pieceOfRoot.get(id);
      if (!piece) throw new TemplateError(`Root panel "${id}" is not listed as a piece root`);
      const W = ev(p.w ?? 0, scope, `${id}.w`), H = ev(p.h ?? 0, scope, `${id}.h`);
      if (W <= 0 || H <= 0) throw new TemplateError(`Panel "${id}" has non-positive size`);
      w = {
        tpl: p,
        frame: { x: 0, y: 0, w: W, h: H },
        local: [[0, 0], [W, 0], [W, H], [0, H]],
        piece,
        depth: 0,
        isPlainRect: true,
        hingeCurves: [],
      };
    } else {
      if (!p.edge) throw new TemplateError(`Panel "${id}" needs an "edge"`);
      const parent = build(p.parent);
      const P = parent.frame;
      const Lp = p.edge === "top" || p.edge === "bottom" ? P.w : P.h;
      const len = ev(p.length ?? Lp, scope, `${id}.length`);
      const d = ev(p.depth ?? 0, scope, `${id}.depth`);
      if (len <= 0 || d <= 0) throw new TemplateError(`Panel "${id}" has non-positive size (length ${len.toFixed(1)}, depth ${d.toFixed(1)})`);
      const o = evalOr(p.offset, scope, 0);
      const off = p.align === "center" ? (Lp - len) / 2 + o : p.align === "end" ? Lp - len - o : o;
      const map = (a: number, b: number): Pt => {
        switch (p.edge) {
          case "top": return [P.x + off + a, P.y - b];
          case "bottom": return [P.x + off + a, P.y + P.h + b];
          case "left": return [P.x - b, P.y + off + a];
          default: return [P.x + P.w + b, P.y + off + a];
        }
      };
      const ls: Scope = { ...scope, len, depth: d };
      const sh = p.shape ?? {};
      let localPts: Pt[];
      let isPlainRect = false;
      let hingePts: Pt[] = [[0, 0], [len, 0]];
      if (sh.points) {
        localPts = sh.points.map(([a, b], i) => [ev(a, ls, `${id}.points[${i}]`), ev(b, ls, `${id}.points[${i}]`)] as Pt);
      } else {
        const ins = Array.isArray(sh.inset) ? sh.inset : [sh.inset ?? 0, sh.inset ?? 0];
        const i0 = ev(ins[0], ls, `${id}.inset`), i1 = ev(ins[1], ls, `${id}.inset`);
        const sag = evalOr(sh.farSag, ls, 0);
        const hs = evalOr(sh.hingeSag, ls, 0);
        const r = evalOr(sh.radius, ls, 0);
        if (i0 + i1 >= len) throw new TemplateError(`Panel "${id}" insets exceed its length`);
        const N = 24;
        if (hs) {
          hingePts = [];
          for (let k = 0; k <= N; k++) {
            const a = (len * k) / N;
            hingePts.push([a, -hs * Math.sin((Math.PI * a) / len)]);
          }
        }
        localPts = [...hingePts];
        const farStart: Pt = [len - i1, d];
        const farEnd: Pt = [i0, d];
        const radii: number[] = [];
        if (sag) {
          for (let k = 0; k <= N; k++) {
            const pt = lerpPt(farStart, farEnd, k / N);
            localPts.push([pt[0], d + sag * Math.sin((Math.PI * k) / N)]);
          }
        } else {
          localPts.push(farStart, farEnd);
          radii.length = localPts.length;
          radii.fill(0);
          radii[localPts.length - 2] = r;
          radii[localPts.length - 1] = r;
        }
        if (r > 0 && !sag) localPts = filletPolygon(localPts, radii);
        isPlainRect = !hs && !sag && !r && !i0 && !i1;
      }
      const poly = localPts.map(([a, b]) => map(a, b));
      const f0 = map(0, 0), f1 = map(len, d);
      const frame: Rect = {
        x: Math.min(f0[0], f1[0]),
        y: Math.min(f0[1], f1[1]),
        w: Math.abs(f1[0] - f0[0]),
        h: Math.abs(f1[1] - f0[1]),
      };
      // A curved score folds about its deepest point so the flap tucks fully inside.
      const hingeB = sh.hingeSag !== undefined && !sh.points ? -evalOr(sh.hingeSag, ls, 0) : 0;
      if (hingePts.length > 2) {
        parent.hingeCurves.push({ edge: p.edge, a0: off, pts: hingePts.map(([a, b]) => map(a, b)) });
      }
      w = {
        tpl: p,
        frame,
        local: poly,
        hinge: [map(0, hingeB), map(len, hingeB)],
        outward: OUTWARD[p.edge],
        piece: parent.piece,
        depth: parent.depth + 1,
        isPlainRect,
        hingeCurves: [],
      };
    }
    visiting.delete(id);
    work.set(id, w);
    return w;
  }

  for (const p of t.panels) build(p.id);

  // Parents with curved scores: splice the child's hinge curve into the parent's outline.
  for (const w of work.values()) {
    if (!w.hingeCurves.length || !w.isPlainRect) continue;
    const { x, y, w: W, h: H } = w.frame;
    const sides: { edge: EdgeName; from: Pt; to: Pt; reverse: boolean }[] = [
      { edge: "top", from: [x, y], to: [x + W, y], reverse: false },
      { edge: "right", from: [x + W, y], to: [x + W, y + H], reverse: false },
      { edge: "bottom", from: [x + W, y + H], to: [x, y + H], reverse: true },
      { edge: "left", from: [x, y + H], to: [x, y], reverse: true },
    ];
    const out: Pt[] = [];
    for (const s of sides) {
      out.push(s.from);
      const curves = w.hingeCurves.filter((c) => c.edge === s.edge).sort((a, b) => a.a0 - b.a0);
      if (s.reverse) curves.reverse();
      for (const c of curves) out.push(...(s.reverse ? c.pts.slice().reverse() : c.pts));
    }
    w.local = out;
  }

  // Lay pieces out side by side on the sheet.
  const bleed = opts.bleed;
  const margin = bleed + 10;
  const gap = 30 + 2 * bleed;
  const piecesOut: DielinePiece[] = [];
  let cursor = margin;
  let maxH = 0;
  const shift = new Map<string, Pt>();
  for (const pc of t.pieces) {
    const members = [...work.values()].filter((w) => w.piece === pc.id);
    if (!members.length) throw new TemplateError(`Piece "${pc.id}" has no panels`);
    let bb = bboxOf(members[0].local);
    for (const m of members) bb = unionRect(bb, bboxOf(m.local));
    const dx = cursor - bb.x, dy = margin - bb.y;
    shift.set(pc.id, [dx, dy]);
    const place = (pl: typeof pc.place, what: string): Placement => ({
      position: (pl?.position ?? [0, 0, 0]).map((e, i) => ev(e, scope, `${what}.position[${i}]`)) as Vec3,
      rotation: (pl?.rotation ?? [0, 0, 0]).map((e, i) => ev(e, scope, `${what}.rotation[${i}]`)) as Vec3,
    });
    piecesOut.push({
      id: pc.id,
      label: pc.label,
      root: pc.root,
      bbox: { x: cursor, y: margin, w: bb.w, h: bb.h },
      place: place(pc.place, `${pc.id}.place`),
      openPlace: pc.openPlace ? place(pc.openPlace, `${pc.id}.openPlace`) : undefined,
    });
    cursor += bb.w + gap;
    maxH = Math.max(maxH, bb.h);
  }
  const width = cursor - gap + margin;
  const height = maxH + 2 * margin;

  const mv = (p: Pt, d: Pt): Pt => [p[0] + d[0], p[1] + d[1]];
  const panels: DielinePanel[] = [];
  const byId: Record<string, DielinePanel> = {};
  let hasOpenState = t.pieces.some((p) => p.openPlace);
  for (const p of t.panels) {
    const w = work.get(p.id)!;
    const d = shift.get(w.piece)!;
    const polygon = dedupe(w.local.map((q) => mv(q, d)));
    const bbox = bboxOf(polygon);
    const fold = evalOr(p.fold, scope, p.parent ? 90 : 0);
    const openFold = evalOr(p.openFold, scope, fold);
    if (openFold !== fold) hasOpenState = true;
    const safeRaw = offsetPolygon(polygon, -opts.safe);
    const safeOk =
      Math.sign(signedArea(safeRaw)) === Math.sign(signedArea(polygon)) &&
      Math.abs(signedArea(safeRaw)) > 25 &&
      bbox.w > opts.safe * 2.5 &&
      bbox.h > opts.safe * 2.5;
    const panel: DielinePanel = {
      id: p.id,
      label: p.label,
      face: p.face,
      kind: p.kind ?? "panel",
      printable: p.printable ?? (p.kind !== "glue"),
      piece: w.piece,
      parent: p.parent,
      edge: p.edge,
      children: [],
      treeDepth: w.depth,
      polygon,
      frame: { ...w.frame, x: w.frame.x + d[0], y: w.frame.y + d[1] },
      bbox,
      center: [bbox.x + bbox.w / 2, bbox.y + bbox.h / 2],
      hinge: w.hinge ? [mv(w.hinge[0], d), mv(w.hinge[1], d)] : undefined,
      outward: w.outward,
      fold,
      openFold,
      layer: evalOr(p.layer, scope, 0),
      dilated: offsetPolygon(polygon, bleed),
      safe: safeOk ? safeRaw : null,
      upright: 0,
    };
    panels.push(panel);
    byId[p.id] = panel;
  }
  for (const p of panels) if (p.parent) byId[p.parent].children.push(p.id);

  const { cutLines, foldLines } = computeLines(panels, byId);

  let deform: Dieline["deform"];
  if (t.deform) {
    deform = {
      type: t.deform.type,
      length: ev(t.deform.length, scope, "deform.length"),
      width: ev(t.deform.width, scope, "deform.width"),
      thickness: ev(t.deform.thickness, scope, "deform.thickness"),
    };
  }

  const dl: Dieline = {
    templateId: t.id,
    dims,
    width,
    height,
    bleed,
    safeMargin: opts.safe,
    panels,
    byId,
    pieces: piecesOut,
    cutLines,
    foldLines,
    deform,
    hasOpenState,
  };
  assignUpright(dl);
  return dl;
}

function edgesOf(poly: Pt[]): Seg[] {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]] as Seg);
}

/** Folds = boundary shared between a panel and its parent. Cuts = every other boundary. */
function computeLines(panels: DielinePanel[], byId: Record<string, DielinePanel>) {
  const cutLines: Seg[] = [];
  const foldLines: Seg[] = [];
  const edgeCache = new Map<string, Seg[]>();
  const edges = (p: DielinePanel) => {
    let e = edgeCache.get(p.id);
    if (!e) edgeCache.set(p.id, (e = edgesOf(p.polygon)));
    return e;
  };
  for (const p of panels) {
    const relatives = [...(p.parent ? [byId[p.parent]] : []), ...p.children.map((c) => byId[c])];
    for (const e of edges(p)) {
      const shared: [number, number][] = [];
      for (const r of relatives) {
        for (const f of edges(r)) {
          const ov = collinearOverlap(e, f);
          if (!ov) continue;
          shared.push(ov);
          if (r.id === p.parent) foldLines.push([lerpPt(e[0], e[1], ov[0]), lerpPt(e[0], e[1], ov[1])]);
        }
      }
      for (const [a, b] of subtractIntervals(shared)) cutLines.push([lerpPt(e[0], e[1], a), lerpPt(e[0], e[1], b)]);
    }
  }
  return { cutLines: mergeCollinear(cutLines), foldLines: mergeCollinear(foldLines) };
}

/** Join consecutive collinear segments that share endpoints (keeps SVG output compact). */
function mergeCollinear(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last) {
      const [a, b] = last;
      const [c, d] = s;
      if (Math.hypot(b[0] - c[0], b[1] - c[1]) < 1e-6) {
        const cross = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(d[0] - c[0], d[1] - c[1]);
        if (l > 0 && Math.abs(cross) / l < 1e-6) {
          last[1] = d;
          continue;
        }
      }
    }
    out.push([s[0], s[1]]);
  }
  return out;
}

function assignUpright(dl: Dieline) {
  const mats = panelTransforms(dl, { progress: 1, open: 0 });
  for (const p of dl.panels) {
    const m = mats[p.id];
    const n = applyDir(m, [0, 0, 1]);
    const up: [number, number, number] = Math.abs(n[1]) < 0.7 ? [0, 1, 0] : n[1] > 0 ? [0, 0, -1] : [0, 0, 1];
    const l = applyDirInverse(m, up);
    const du = l[0], dv = -l[1];
    const deg = (Math.atan2(du, -dv) * 180) / Math.PI;
    p.upright = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  }
}

export { ExprError };
