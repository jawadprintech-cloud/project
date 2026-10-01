import { createReadStream, promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { ZodError } from "zod";
import { BUILTIN_TEMPLATES } from "../shared/templates";
import { normalizeCatalog, type Catalog, type ResolvedCatalog } from "../shared/catalog";
import { validateTemplate } from "../shared/validate";
import type { BoxTemplate } from "../shared/template-types";
import type { Design } from "../shared/design";
import { Storage, newId, type AssetMeta } from "./storage";
import { catalogSchema, designSchema, quoteSchema, QUOTE_STATUSES, type QuoteInput } from "./schemas";

export interface AppOptions {
  dataDir: string;
  /** Built client (served in production). */
  staticDir?: string;
  adminPassword?: string;
  webhookUrl?: string;
  publicUrl?: string;
  log?: (msg: string) => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface QuoteRecord {
  id: string;
  reference: string;
  createdAt: string;
  updatedAt: string;
  status: (typeof QUOTE_STATUSES)[number];
  internalNotes: string;
  projectId?: string;
  customer: QuoteInput["customer"];
  requirements: QuoteInput["requirements"];
  design: Design;
  files: QuoteInput["files"];
  artwork: { assetId: string; originalAssetId: string; fileName: string; panelId: string }[];
  summary: {
    styleName: string;
    dims: string;
    material: string;
    printing: string;
    lamination: string;
    finishes: string[];
    elementCount: number;
  };
}

const IMAGE_SIGNATURES: { mime: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  {
    mime: "image/tiff",
    test: (b) =>
      (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a),
  },
];
const GENERATED_TYPES = new Set(["image/png", "image/jpeg", "image/svg+xml", "application/json"]);
const MIME_ALIASES: Record<string, string> = { "image/jpg": "image/jpeg", "image/tif": "image/tiff", "image/x-tiff": "image/tiff" };

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

export async function createApp(opts: AppOptions) {
  const store = new Storage(opts.dataDir);
  await store.init();
  const secret = await store.secret();
  const log = opts.log ?? (() => {});

  // ---------------------------------------------------------------- catalog
  async function customTemplates(): Promise<BoxTemplate[]> {
    const out: BoxTemplate[] = [];
    for (const f of await store.list("templates")) {
      const t = await store.readJson<BoxTemplate>(`templates/${f}`);
      if (t) out.push(t);
    }
    return out;
  }

  async function allTemplates(): Promise<BoxTemplate[]> {
    const custom = await customTemplates();
    const merged = BUILTIN_TEMPLATES.map((t) => custom.find((c) => c.id === t.id) ?? t);
    for (const c of custom) if (!merged.some((t) => t.id === c.id)) merged.push(c);
    return merged;
  }

  async function catalog(): Promise<ResolvedCatalog> {
    const templates = await allTemplates();
    const stored = await store.readJson<Partial<Catalog>>("catalog.json");
    return { ...normalizeCatalog(stored, templates), templates };
  }

  // ---------------------------------------------------------------- helpers
  const rate = new Map<string, { n: number; reset: number }>();
  function limit(req: IncomingMessage, bucket: string, max: number, windowMs: number) {
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() || req.socket.remoteAddress || "?";
    const key = `${bucket}:${ip}`;
    const now = Date.now();
    const r = rate.get(key);
    if (!r || r.reset < now) {
      rate.set(key, { n: 1, reset: now + windowMs });
      if (rate.size > 10000) for (const [k, v] of rate) if (v.reset < now) rate.delete(k);
      return;
    }
    if (++r.n > max) throw new HttpError(429, "Too many requests. Please wait a moment and try again.");
  }

  async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > maxBytes) throw new HttpError(413, `File too large (max ${Math.round(maxBytes / 1e6)} MB).`);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) throw new HttpError(413, `File too large (max ${Math.round(maxBytes / 1e6)} MB).`);
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async function readJsonBody(req: IncomingMessage, maxBytes = 3_000_000): Promise<unknown> {
    const ct = req.headers["content-type"] ?? "";
    if (!ct.includes("application/json")) throw new HttpError(415, "Expected application/json.");
    const body = await readBody(req, maxBytes);
    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      throw new HttpError(400, "Malformed JSON.");
    }
  }

  function send(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    });
    res.end(body);
  }

  // Admin tokens: HMAC-signed expiry, no server-side session state.
  function signToken(expMs: number) {
    const payload = Buffer.from(JSON.stringify({ exp: expMs })).toString("base64url");
    const sig = createHmac("sha256", secret).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }
  function requireAdmin(req: IncomingMessage) {
    const h = req.headers.authorization ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    const [payload, sig] = token.split(".");
    if (payload && sig) {
      const expected = createHmac("sha256", secret).update(payload).digest("base64url");
      const a = Buffer.from(sig), b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) {
        try {
          const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
          if (typeof exp === "number" && exp > Date.now()) return;
        } catch {
          /* fall through */
        }
      }
    }
    throw new HttpError(401, "Admin sign-in required.");
  }

  async function ensureAssets(ids: string[]) {
    for (const id of ids) {
      if (!(await store.assetMeta(id))) throw new HttpError(400, `Unknown file reference ${id}.`);
    }
  }

  function parse<T>(schema: { parse: (v: unknown) => T }, v: unknown): T {
    try {
      return schema.parse(v);
    } catch (e) {
      if (e instanceof ZodError) {
        const first = e.issues[0];
        throw new HttpError(400, `Invalid ${first.path.join(".") || "data"}: ${first.message}`, e.issues.slice(0, 10));
      }
      throw e;
    }
  }

  async function nextReference(): Promise<string> {
    const d = new Date();
    const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
    return `Q-${stamp}-${newId(3).toUpperCase()}`;
  }

  function summarize(q: QuoteInput, cat: ResolvedCatalog): QuoteRecord["summary"] {
    const tpl = cat.templates.find((t) => t.id === q.design.styleId);
    const style = cat.styles.find((s) => s.id === q.design.styleId);
    const dims = (tpl?.dimensions ?? []).map((d) => `${d.label} ${q.design.dims[d.key] ?? "?"}`).join(" × ");
    const finishIds = new Set(q.design.elements.flatMap((e) => e.finishes));
    const fin = (id: string | null) => cat.finishes.find((f) => f.id === id)?.name;
    return {
      styleName: style?.name || tpl?.name || q.design.styleId,
      dims: `${dims} mm`,
      material: cat.materials.find((m) => m.id === q.requirements.materialId)?.name ?? q.requirements.materialId,
      printing: cat.printOptions.find((p) => p.id === q.requirements.printOptionId)?.name ?? q.requirements.printOptionId,
      lamination: fin(q.design.laminationId) ?? "None",
      finishes: [...finishIds].map((id) => fin(id) ?? id),
      elementCount: q.design.elements.length,
    };
  }

  async function notify(q: QuoteRecord) {
    if (!opts.webhookUrl) return;
    try {
      await fetch(opts.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "quote.submitted",
          reference: q.reference,
          customer: { name: q.customer.name, email: q.customer.email, company: q.customer.company },
          style: q.summary.styleName,
          dims: q.summary.dims,
          quantity: q.requirements.quantity,
          adminUrl: opts.publicUrl ? `${opts.publicUrl.replace(/\/$/, "")}/admin#quote/${q.id}` : undefined,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      log(`Quote webhook failed: ${(e as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- routes
  type Handler = (req: IncomingMessage, res: ServerResponse, params: string[], url: URL) => Promise<void>;
  const routes: { method: string; re: RegExp; h: Handler }[] = [];
  const route = (method: string, pattern: string, h: Handler) =>
    routes.push({ method, re: new RegExp(`^${pattern.replace(/:id/g, "([A-Za-z0-9_-]+)")}$`), h });

  route("GET", "/api/health", async (_q, res) => send(res, 200, { ok: true }));

  route("GET", "/api/catalog", async (_q, res) => {
    const cat = await catalog();
    // Only enabled options are exposed to customers.
    send(
      res,
      200,
      {
        ...cat,
        styles: cat.styles.filter((s) => s.enabled),
        materials: cat.materials.filter((m) => m.enabled),
        finishes: cat.finishes.filter((f) => f.enabled),
        fonts: cat.fonts.filter((f) => f.enabled),
      },
      { "Cache-Control": "no-cache" },
    );
  });

  route("POST", "/api/assets", async (req, res) => {
    limit(req, "upload", 400, 10 * 60_000);
    const cat = await catalog();
    const kind = req.headers["x-asset-kind"] === "generated" ? "generated" : "upload";
    let mime = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    mime = MIME_ALIASES[mime] ?? mime;
    const max = kind === "generated" ? 150_000_000 : cat.settings.maxUploadMb * 1_000_000;
    const body = await readBody(req, max);
    if (!body.length) throw new HttpError(400, "Empty file.");
    if (kind === "upload") {
      const sig = IMAGE_SIGNATURES.find((s) => s.test(body));
      if (!sig) throw new HttpError(415, "Unsupported file. Please upload JPEG, PNG, TIFF or WebP artwork.");
      mime = sig.mime; // trust the bytes, not the header
    } else if (!GENERATED_TYPES.has(mime)) {
      throw new HttpError(415, "Unsupported generated file type.");
    } else if (mime.startsWith("image/") && mime !== "image/svg+xml" && !IMAGE_SIGNATURES.some((s) => s.mime === mime && s.test(body))) {
      throw new HttpError(415, "File content does not match its type.");
    }
    let fileName = "file";
    try {
      fileName = decodeURIComponent(String(req.headers["x-file-name"] ?? "file")).replace(/[^\w.\- ()]+/g, "_").slice(0, 120) || "file";
    } catch {
      /* keep default */
    }
    const id = newId();
    const meta: AssetMeta = { id, mime, size: body.length, fileName, kind, createdAt: new Date().toISOString() };
    await store.writeAsset(id, body, meta);
    send(res, 201, { id, url: `/api/assets/${id}`, mime, size: body.length });
  });

  route("GET", "/api/assets/:id", async (_req, res, [id], url) => {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new HttpError(404, "Not found.");
    const meta = await store.assetMeta(id);
    if (!meta) throw new HttpError(404, "Not found.");
    const download = url.searchParams.has("download") || meta.mime === "image/svg+xml" || meta.mime === "application/json";
    res.writeHead(200, {
      "Content-Type": meta.mime,
      "Content-Length": String(meta.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${meta.fileName.replace(/"/g, "")}"`,
    });
    createReadStream(store.assetPath(id)).pipe(res);
  });

  route("POST", "/api/projects", async (req, res) => {
    limit(req, "save", 300, 10 * 60_000);
    const body = (await readJsonBody(req)) as { design?: unknown };
    const design = parse(designSchema, body.design);
    const id = newId();
    const now = new Date().toISOString();
    await store.writeJson(`projects/${id}.json`, { id, createdAt: now, updatedAt: now, design });
    send(res, 201, { id, updatedAt: now });
  });

  route("GET", "/api/projects/:id", async (_req, res, [id]) => {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new HttpError(404, "Project not found.");
    const p = await store.readJson<{ id: string; design: Design; updatedAt: string }>(`projects/${id}.json`);
    if (!p) throw new HttpError(404, "Project not found.");
    send(res, 200, p);
  });

  route("PUT", "/api/projects/:id", async (req, res, [id]) => {
    limit(req, "save", 300, 10 * 60_000);
    if (!/^[a-f0-9]{32}$/.test(id)) throw new HttpError(404, "Project not found.");
    const existing = await store.readJson<{ createdAt: string }>(`projects/${id}.json`);
    if (!existing) throw new HttpError(404, "Project not found.");
    const body = (await readJsonBody(req)) as { design?: unknown };
    const design = parse(designSchema, body.design);
    const now = new Date().toISOString();
    await store.writeJson(`projects/${id}.json`, { id, createdAt: existing.createdAt, updatedAt: now, design });
    send(res, 200, { id, updatedAt: now });
  });

  route("POST", "/api/quotes", async (req, res) => {
    limit(req, "quote", 20, 10 * 60_000);
    const q = parse(quoteSchema, await readJsonBody(req));
    const cat = await catalog();
    if (!cat.templates.some((t) => t.id === q.design.styleId)) throw new HttpError(400, "Unknown box style.");
    if (q.requirements.quantity < cat.settings.minQuantity)
      throw new HttpError(400, `Minimum order quantity is ${cat.settings.minQuantity}.`);
    const images = q.design.elements.filter((e) => e.type === "image");
    await ensureAssets([
      q.files.printFile,
      q.files.proof,
      q.files.dieline,
      q.files.designJson,
      ...q.files.mockups,
      ...q.files.masks.map((m) => m.assetId),
      ...images.flatMap((e) => [e.assetId, e.originalAssetId]),
    ]);
    const now = new Date().toISOString();
    const record: QuoteRecord = {
      id: newId(),
      reference: await nextReference(),
      createdAt: now,
      updatedAt: now,
      status: "new",
      internalNotes: "",
      projectId: q.projectId,
      customer: q.customer,
      requirements: q.requirements,
      design: q.design as Design,
      files: q.files,
      artwork: images.map((e) => ({ assetId: e.assetId, originalAssetId: e.originalAssetId, fileName: e.fileName, panelId: e.panelId })),
      summary: summarize(q, cat),
    };
    await store.writeJson(`quotes/${record.id}.json`, record);
    log(`Quote ${record.reference} submitted by ${record.customer.email}`);
    void notify(record);
    send(res, 201, { id: record.id, reference: record.reference });
  });

  // ---------------------------------------------------------------- admin
  route("POST", "/api/admin/login", async (req, res) => {
    limit(req, "login", 10, 60_000);
    if (!opts.adminPassword) throw new HttpError(503, "Admin access is disabled. Set the ADMIN_PASSWORD environment variable.");
    const { password } = (await readJsonBody(req, 10_000)) as { password?: string };
    const a = createHmac("sha256", secret).update(String(password ?? "")).digest();
    const b = createHmac("sha256", secret).update(opts.adminPassword).digest();
    if (!timingSafeEqual(a, b)) throw new HttpError(401, "Incorrect password.");
    send(res, 200, { token: signToken(Date.now() + 12 * 3600_000) });
  });

  route("GET", "/api/admin/quotes", async (req, res) => {
    requireAdmin(req);
    const out = [];
    for (const f of await store.list("quotes")) {
      const q = await store.readJson<QuoteRecord>(`quotes/${f}`);
      if (!q) continue;
      out.push({
        id: q.id,
        reference: q.reference,
        createdAt: q.createdAt,
        status: q.status,
        customer: { name: q.customer.name, email: q.customer.email, company: q.customer.company },
        quantity: q.requirements.quantity,
        styleName: q.summary.styleName,
        dims: q.summary.dims,
        mockup: q.files.mockups[0],
      });
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    send(res, 200, { quotes: out });
  });

  route("GET", "/api/admin/quotes/:id", async (req, res, [id]) => {
    requireAdmin(req);
    const q = await store.readJson<QuoteRecord>(`quotes/${id}.json`);
    if (!q) throw new HttpError(404, "Quote not found.");
    send(res, 200, q);
  });

  route("PATCH", "/api/admin/quotes/:id", async (req, res, [id]) => {
    requireAdmin(req);
    const q = await store.readJson<QuoteRecord>(`quotes/${id}.json`);
    if (!q) throw new HttpError(404, "Quote not found.");
    const body = (await readJsonBody(req, 100_000)) as { status?: string; internalNotes?: string };
    if (body.status !== undefined) {
      if (!QUOTE_STATUSES.includes(body.status as QuoteRecord["status"])) throw new HttpError(400, "Invalid status.");
      q.status = body.status as QuoteRecord["status"];
    }
    if (body.internalNotes !== undefined) q.internalNotes = String(body.internalNotes).slice(0, 10000);
    q.updatedAt = new Date().toISOString();
    await store.writeJson(`quotes/${id}.json`, q);
    send(res, 200, q);
  });

  route("GET", "/api/admin/catalog", async (req, res) => {
    requireAdmin(req);
    const cat = await catalog();
    const custom = await customTemplates();
    send(res, 200, { catalog: cat, customTemplateIds: custom.map((t) => t.id), builtinTemplateIds: BUILTIN_TEMPLATES.map((t) => t.id) });
  });

  route("PUT", "/api/admin/catalog", async (req, res) => {
    requireAdmin(req);
    const body = (await readJsonBody(req)) as { catalog?: unknown };
    const c = parse(catalogSchema, body.catalog);
    const ids = (arr: { id: string }[], what: string) => {
      const seen = new Set<string>();
      for (const x of arr) {
        if (seen.has(x.id)) throw new HttpError(400, `Duplicate ${what} id "${x.id}".`);
        seen.add(x.id);
      }
    };
    ids(c.materials, "material");
    ids(c.finishes, "finish");
    ids(c.printOptions, "print option");
    if (!c.materials.some((m) => m.enabled)) throw new HttpError(400, "At least one material must be enabled.");
    await store.writeJson("catalog.json", c);
    send(res, 200, { ok: true });
  });

  route("PUT", "/api/admin/templates/:id", async (req, res, [id]) => {
    requireAdmin(req);
    const body = (await readJsonBody(req)) as { template?: BoxTemplate };
    const t = body.template;
    const cat = await catalog();
    const errors = validateTemplate(t, cat.settings);
    if (errors.length) throw new HttpError(400, errors[0], errors);
    if (t!.id !== id) throw new HttpError(400, "Template id does not match the URL.");
    await store.writeJson(`templates/${id}.json`, t);
    send(res, 200, { ok: true });
  });

  route("DELETE", "/api/admin/templates/:id", async (req, res, [id]) => {
    requireAdmin(req);
    await store.remove(`templates/${id}.json`);
    send(res, 200, { ok: true });
  });

  // ---------------------------------------------------------------- static
  async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!opts.staticDir || (req.method !== "GET" && req.method !== "HEAD")) return false;
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    else if (rel === "/admin" || rel === "/admin/") rel = "/admin.html";
    const file = path.normalize(path.join(opts.staticDir, rel));
    if (!file.startsWith(path.normalize(opts.staticDir))) return false;
    let target = file;
    try {
      const st = await fs.stat(target);
      if (!st.isFile()) throw new Error();
    } catch {
      if (path.extname(rel)) return false;
      target = path.join(opts.staticDir, "index.html");
    }
    const ext = path.extname(target);
    const immutable = rel.startsWith("/assets/");
    res.writeHead(200, {
      "Content-Type": STATIC_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(target).pipe(res);
    return true;
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        for (const r of routes) {
          if (r.method !== req.method) continue;
          const m = r.re.exec(url.pathname);
          if (m) return await r.h(req, res, m.slice(1), url);
        }
        throw new HttpError(404, "Not found.");
      }
      if (await serveStatic(req, res, url)) return;
      throw new HttpError(404, "Not found.");
    } catch (e) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (e instanceof HttpError) {
        send(res, e.status, { error: e.message, details: e.details });
      } else {
        log(`Error on ${req.method} ${url.pathname}: ${(e as Error).stack ?? e}`);
        send(res, 500, { error: "Something went wrong on our side. Please try again." });
      }
    }
  };
}
