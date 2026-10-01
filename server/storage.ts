import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

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
  constructor(readonly root: string) {}

  async init() {
    for (const d of ["templates", "projects", "quotes", "assets"]) await fs.mkdir(path.join(this.root, d), { recursive: true });
  }

  private file(...parts: string[]) {
    return path.join(this.root, ...parts);
  }

  async readJson<T>(rel: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(this.file(rel), "utf8")) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async writeJson(rel: string, data: unknown) {
    const target = this.file(rel);
    const tmp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, target);
  }

  async remove(rel: string) {
    await fs.rm(this.file(rel), { force: true });
  }

  async list(dir: string): Promise<string[]> {
    try {
      return (await fs.readdir(this.file(dir))).filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"));
    } catch {
      return [];
    }
  }

  async writeAsset(id: string, data: Buffer, meta: AssetMeta) {
    await fs.writeFile(this.file("assets", id), data);
    await this.writeJson(`assets/${id}.json`, meta);
  }

  async assetMeta(id: string): Promise<AssetMeta | null> {
    return this.readJson<AssetMeta>(`assets/${id}.json`);
  }

  assetPath(id: string) {
    return this.file("assets", id);
  }

  async secret(): Promise<string> {
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
}

export function newId(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}
