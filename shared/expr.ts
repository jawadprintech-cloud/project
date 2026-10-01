/**
 * Tiny, safe arithmetic expression evaluator used by dieline templates.
 *
 * Templates are JSON data (admins can add new ones at runtime), so we never
 * use eval/new Function. Supported syntax:
 *   numbers, identifiers, + - * / % ^, parentheses, unary -, !,
 *   comparisons (< <= > >= == !=), && ||, ternary a ? b : c,
 *   functions: min max abs sqrt round floor ceil clamp sin cos tan atan2 pi()
 */

export type Scope = Record<string, number>;
export type Expr = string | number;

type Node =
  | { t: "num"; v: number }
  | { t: "id"; name: string }
  | { t: "un"; op: string; a: Node }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "tern"; c: Node; a: Node; b: Node }
  | { t: "call"; fn: string; args: Node[] };

const FUNCS: Record<string, (...a: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  sqrt: Math.sqrt,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: (d) => Math.sin((d * Math.PI) / 180),
  cos: (d) => Math.cos((d * Math.PI) / 180),
  tan: (d) => Math.tan((d * Math.PI) / 180),
  atan2: (y, x) => (Math.atan2(y, x) * 180) / Math.PI,
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  pi: () => Math.PI,
};

const PREC: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
  "^": 7,
};

export class ExprError extends Error {}

function tokenize(src: string): string[] {
  const out: string[] = [];
  const re = /\s*(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[A-Za-z_][A-Za-z0-9_]*|<=|>=|==|!=|&&|\|\||[-+*/%^()?:,<>!])/y;
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) {
      i++;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new ExprError(`Unexpected character "${src[i]}" in "${src}"`);
    out.push(m[1]);
    i = re.lastIndex;
  }
  return out;
}

function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (t: string) => {
    if (toks[p] !== t) throw new ExprError(`Expected "${t}" in "${src}"`);
    p++;
  };

  function primary(): Node {
    const t = next();
    if (t === undefined) throw new ExprError(`Unexpected end of "${src}"`);
    if (t === "(") {
      const e = ternary();
      expect(")");
      return e;
    }
    if (t === "-" || t === "+" || t === "!") return { t: "un", op: t, a: binary(7) };
    if (/^[\d.]/.test(t)) return { t: "num", v: parseFloat(t) };
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === "(") {
        next();
        const args: Node[] = [];
        if (peek() !== ")") {
          do args.push(ternary());
          while (peek() === "," && next());
        }
        expect(")");
        if (!FUNCS[t]) throw new ExprError(`Unknown function "${t}"`);
        return { t: "call", fn: t, args };
      }
      return { t: "id", name: t };
    }
    throw new ExprError(`Unexpected "${t}" in "${src}"`);
  }

  function binary(minPrec: number): Node {
    let left = primary();
    for (;;) {
      const op = peek();
      const prec = op !== undefined ? PREC[op] : undefined;
      if (prec === undefined || prec < minPrec) return left;
      next();
      // ^ is right-associative
      const right = binary(op === "^" ? prec : prec + 1);
      left = { t: "bin", op, a: left, b: right };
    }
  }

  function ternary(): Node {
    const c = binary(1);
    if (peek() === "?") {
      next();
      const a = ternary();
      expect(":");
      const b = ternary();
      return { t: "tern", c, a, b };
    }
    return c;
  }

  const node = ternary();
  if (p !== toks.length) throw new ExprError(`Unexpected "${toks[p]}" in "${src}"`);
  return node;
}

function run(n: Node, s: Scope): number {
  switch (n.t) {
    case "num":
      return n.v;
    case "id": {
      const v = s[n.name];
      if (v === undefined) throw new ExprError(`Unknown variable "${n.name}"`);
      return v;
    }
    case "un": {
      const a = run(n.a, s);
      return n.op === "-" ? -a : n.op === "!" ? (a ? 0 : 1) : a;
    }
    case "tern":
      return run(n.c, s) ? run(n.a, s) : run(n.b, s);
    case "call":
      return FUNCS[n.fn](...n.args.map((a) => run(a, s)));
    case "bin": {
      const a = run(n.a, s);
      if (n.op === "&&") return a ? run(n.b, s) : 0;
      if (n.op === "||") return a ? a : run(n.b, s);
      const b = run(n.b, s);
      switch (n.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "%": return a % b;
        case "^": return Math.pow(a, b);
        case "<": return +(a < b);
        case "<=": return +(a <= b);
        case ">": return +(a > b);
        case ">=": return +(a >= b);
        case "==": return +(Math.abs(a - b) < 1e-9);
        case "!=": return +(Math.abs(a - b) >= 1e-9);
      }
    }
  }
  throw new ExprError("Bad expression");
}

const cache = new Map<string, Node>();

export function evaluate(expr: Expr, scope: Scope): number {
  if (typeof expr === "number") return expr;
  let node = cache.get(expr);
  if (!node) {
    node = parse(expr);
    if (cache.size > 5000) cache.clear();
    cache.set(expr, node);
  }
  const v = run(node, scope);
  if (!Number.isFinite(v)) throw new ExprError(`"${expr}" did not produce a finite number`);
  return v;
}

/** Evaluate an optional expression, returning `fallback` when absent. */
export function evalOr(expr: Expr | undefined, scope: Scope, fallback: number): number {
  return expr === undefined || expr === "" ? fallback : evaluate(expr, scope);
}
