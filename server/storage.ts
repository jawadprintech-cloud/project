import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { get, head, put } from "@vercel/blob";

/**
 * File-based storage. Everything lives under DATA_DIR:
 *   catalog.json          admin-managed catalog (sizes, finishes, colours, fonts…)
 *   templates/<id>.json   admin-added or overridden box templates
 *   projects/<id>.json    saved customer designs
 *   quotes/<id>.json      submitted quote requests
 *   assets/<id>           uploaded/generated files (+ <id>.json metadata)
 *
 * Swap this module for a database/object store in larger deployments; the
 * rest of the server only uses the functions exported here.
 */
export class Storage {
  private readonly query: ReturnType<typeof neon> | null;

  constructor(readonly root: string) {
    this.query = process.env.NEON_DATABASE_URL ? neon(process.env.NEON_DATABASE_URL) : null;
  }

  async init() {
    if (this.query) {
      await this.query`CREATE TABLE IF NOT EXISTS box_builder_records (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
      return;
    }
    if (process.env.VERCEL) throw new Error("NEON_DATABASE_URL is required for the Vercel API.");
    for (const d of ["templates", "projects", "quotes", "assets"]) await fs.mkdir(path.join(this.root, d), { recursive: true });
  }

  private file(...parts: string[]) {
    return path.join(this.root, ...parts);
  }

  async readJson<T>(rel: string): Promise<T | null> {
    if (this.query) {
      const rows = (await this.query`SELECT value FROM box_builder_records WHERE key = ${rel}`) as unknown as { value: T }[];
      return rows[0]?.value ?? null;
    }
    try {
      return JSON.parse(await fs.readFile(this.file(rel), "utf8")) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async writeJson(rel: string, data: unknown) {
    if (this.query) {
      await this.query`INSERT INTO box_builder_records (key, value, updated_at)
        VALUES (${rel}, ${JSON.stringify(data)}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
      return;
    }
    const target = this.file(rel);
    const tmp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, target);
  }

  async remove(rel: string) {
    if (this.query) {
      await this.query`DELETE FROM box_builder_records WHERE key = ${rel}`;
      return;
    }
    await fs.rm(this.file(rel), { force: true });
  }

  async list(dir: string): Promise<string[]> {
    if (this.query) {
      const prefix = `${dir.replace(/\/$/, "")}/`;
      const rows = (await this.query`SELECT key FROM box_builder_records
        WHERE left(key, length(${prefix})) = ${prefix} AND right(key, 5) = '.json'
        ORDER BY key`) as unknown as { key: string }[];
      return rows.map(({ key }) => key.slice(prefix.length));
    }
    try {
      return (await fs.readdir(this.file(dir))).filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"));
    } catch {
      return [];
    }
  }

  async writeAsset(id: string, data: Buffer, meta: AssetMeta) {
    if (this.query) {
      const blob = await put(`assets/${id}`, data, {
        access: "private",
        contentType: meta.mime,
        multipart: data.byteLength > 100_000_000,
      });
      await this.writeJson(`assets/${id}.json`, { ...meta, blobPath: blob.pathname });
      return;
    }
    await fs.writeFile(this.file("assets", id), data);
    await this.writeJson(`assets/${id}.json`, meta);
  }

  async inspectBlob(pathname: string): Promise<{ size: number; contentType: string; prefix: Buffer } | null> {
    if (!this.query) return null;
    const info = await head(pathname, { access: "private" });
    const blob = await get(pathname, { access: "private", useCache: false });
    if (!blob?.stream) return null;
    const reader = blob.stream.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (length < 16) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        length += value.length;
      }
    } finally {
      await reader.cancel();
    }
    return {
      size: info.size,
      contentType: info.contentType,
      prefix: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).subarray(0, 16),
    };
  }

  async registerBlobAsset(id: string, pathname: string, meta: AssetMeta) {
    await this.writeJson(`assets/${id}.json`, { ...meta, blobPath: pathname });
  }

  async assetStream(id: string): Promise<Readable | null> {
    const meta = await this.assetMeta(id);
    if (!meta) return null;
    if (!this.query) return createReadStream(this.file("assets", id));
    if (!meta.blobPath) return null;
    const blob = await get(meta.blobPath, { access: "private" });
    return blob?.stream ? Readable.fromWeb(blob.stream as ReadableStream<Uint8Array>) : null;
  }

  async assetMeta(id: string): Promise<AssetMeta | null> {
    return this.readJson<AssetMeta>(`assets/${id}.json`);
  }

  assetPath(id: string) {
    return this.file("assets", id);
  }

  async secret(): Promise<string> {
    if (this.query) {
      const existing = await this.readJson<string>(".secret");
      if (existing) return existing;
      const secret = randomBytes(32).toString("hex");
      await this.writeJson(".secret", secret);
      return secret;
    }
    const rel = ".secret";
    try {
      return (await fs.readFile(this.file(rel), "utf8")).trim();
    } catch {
      const s = randomBytes(32).toString("hex");
      await fs.writeFile(this.file(rel), s, { mode: 0o600 });
      return s;
    }
  }
}

export interface AssetMeta {
  id: string;
  mime: string;
  size: number;
  fileName: string;
  kind: "upload" | "generated";
  createdAt: string;
  blobPath?: string;
}

export function newId(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}
