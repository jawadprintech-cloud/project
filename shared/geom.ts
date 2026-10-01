export type Pt = [number, number];
export type Seg = [Pt, Pt];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function bboxOf(pts: Pt[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export function pointInPolygon([px, py]: Pt, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Remove consecutive duplicate points. */
export function dedupe(pts: Pt[], eps = 1e-6): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p);
  }
  while (out.length > 2) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > eps) break;
    out.pop();
  }
  return out;
}

/**
 * Offset a simple polygon by `d` (positive = outward) using mitred edge
 * offsets. Exact for convex polygons and good for gently concave ones
 * (scoops, curved scores), which is all dieline panels need.
 */
export function offsetPolygon(pts: Pt[], d: number): Pt[] {
  const n = pts.length;
  if (n < 3 || d === 0) return pts.slice();
  const orient = signedArea(pts) > 0 ? 1 : -1; // +1 = CCW in y-down coords means clockwise on screen
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const n1 = edgeNormal(p0, p1, orient), n2 = edgeNormal(p1, p2, orient);
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) {
      out.push([p1[0] + n1[0] * d, p1[1] + n1[1] * d]);
      continue;
    }
    mx /= ml;
    my /= ml;
    const cos = mx * n1[0] + my * n1[1];
    const len = d / Math.max(cos, 0.25); // mitre, limited to 4x the offset
    out.push([p1[0] + mx * len, p1[1] + my * len]);
  }
  return out;
}

function edgeNormal(a: Pt, b: Pt, orient: number): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  // outward normal for the given winding
  return orient > 0 ? [dy / l, -dx / l] : [-dy / l, dx / l];
}

/**
 * Parametric overlap of segment `s` with segment `o` when collinear.
 * Returns the [t0, t1] interval on `s` (0..1) or null.
 */
export function collinearOverlap(s: Seg, o: Seg, eps = 0.05): [number, number] | null {
  const [a, b] = s;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const dist = (p: Pt) => Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
  if (dist(o[0]) > eps || dist(o[1]) > eps) return null;
  const t = (p: Pt) => ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len);
  let t0 = t(o[0]), t1 = t(o[1]);
  if (t0 > t1) [t0, t1] = [t1, t0];
  const lo = Math.max(0, t0), hi = Math.min(1, t1);
  if (hi - lo < eps / len) return null;
  return [lo, hi];
}

/** Subtract a set of [t0,t1] intervals from [0,1]. */
export function subtractIntervals(cuts: [number, number][]): [number, number][] {
  const sorted = cuts.slice().sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let cur = 0;
  for (const [a, b] of sorted) {
    if (a > cur + 1e-6) out.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (cur < 1 - 1e-6) out.push([cur, 1]);
  return out;
}

export function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Round selected corners of a polygon with circular fillets.
 * `radii[i]` is the radius for vertex i (0 = keep sharp).
 */
export function filletPolygon(pts: Pt[], radii: number[], segments = 6): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const r = radii[i] ?? 0;
    const p = pts[i];
    if (r <= 0) {
      out.push(p);
      continue;
    }
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const v1 = norm([a[0] - p[0], a[1] - p[1]]);
    const v2 = norm([b[0] - p[0], b[1] - p[1]]);
    const cos = Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1]));
    const ang = Math.acos(cos);
    if (ang < 1e-3 || ang > Math.PI - 1e-3) {
      out.push(p);
      continue;
    }
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    let tan = r / Math.tan(ang / 2);
    const maxTan = Math.min(la, lb) * 0.49;
    let rr = r;
    if (tan > maxTan) {
      rr = (r * maxTan) / tan;
      tan = maxTan;
    }
    const t1: Pt = [p[0] + v1[0] * tan, p[1] + v1[1] * tan];
    const t2: Pt = [p[0] + v2[0] * tan, p[1] + v2[1] * tan];
    const bis = norm([v1[0] + v2[0], v1[1] + v2[1]]);
    const cd = rr / Math.sin(ang / 2);
    const c: Pt = [p[0] + bis[0] * cd, p[1] + bis[1] * cd];
    const s = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    const e = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
    let sweep = e - s;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    for (let k = 0; k <= segments; k++) {
      const t = s + (sweep * k) / segments;
      out.push([c[0] + Math.cos(t) * rr, c[1] + Math.sin(t) * rr]);
    }
  }
  return out;
}

function norm(v: Pt): Pt {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
