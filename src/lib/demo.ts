/**
 * Browser-only backend used by the static demo build (VITE_DEMO=1).
 * Catalog comes from the bundled defaults, files live in IndexedDB and
 * designs in localStorage. Quote submission is simulated.
 */
import { normalizeCatalog, type ResolvedCatalog } from "../../shared/catalog";
import type { Design } from "../../shared/design";
import { BUILTIN_TEMPLATES } from "../../shared/templates";

const urls = new Map<string, string>();
const DB = "bb-demo";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("assets");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(id: string, blob: Blob) {
  try {
    const db = await idb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction("assets", "readwrite");
      tx.objectStore("assets").put(blob, id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    /* storage unavailable: the file still works for this session */
  }
}

async function idbGet(id: string): Promise<Blob | null> {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const req = db.transaction("assets").objectStore("assets").get(id);
      req.onsuccess = () => res((req.result as Blob) ?? null);
      req.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

const hexId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

export const demoAssets = {
  url: (id: string) => urls.get(id) ?? null,
  /** Load a stored file back into memory (after a page reload). */
  async restore(id: string): Promise<string | null> {
    if (urls.has(id)) return urls.get(id)!;
    const blob = await idbGet(id);
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    urls.set(id, u);
    return u;
  },
};

const PROJECTS = "bb-demo-projects";
function readProjects(): Record<string, { design: Design; updatedAt: string }> {
  try {
    return JSON.parse(localStorage.getItem(PROJECTS) ?? "{}");
  } catch {
    return {};
  }
}
function writeProjects(p: Record<string, { design: Design; updatedAt: string }>) {
  try {
    localStorage.setItem(PROJECTS, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export const demoApi = {
  async catalog(): Promise<ResolvedCatalog> {
    const cat = normalizeCatalog(null, BUILTIN_TEMPLATES);
    return { ...cat, settings: { ...cat.settings, companyName: "Custom Box Builder" }, templates: BUILTIN_TEMPLATES };
  },
  async uploadAsset(blob: Blob) {
    const id = hexId();
    urls.set(id, URL.createObjectURL(blob));
    // Keep uploads (not large generated print files) across reloads.
    if (blob.size < 25_000_000 && !blob.type.includes("svg") && !blob.type.includes("json")) void idbPut(id, blob);
    return { id, url: urls.get(id)!, mime: blob.type, size: blob.size };
  },
  async createProject(design: Design) {
    const id = hexId();
    const updatedAt = new Date().toISOString();
    writeProjects({ ...readProjects(), [id]: { design, updatedAt } });
    return { id, updatedAt };
  },
  async saveProject(id: string, design: Design) {
    const updatedAt = new Date().toISOString();
    writeProjects({ ...readProjects(), [id]: { design, updatedAt } });
    return { id, updatedAt };
  },
  async loadProject(id: string) {
    const p = readProjects()[id];
    if (!p) throw new Error("This saved design was not found in this browser.");
    return { id, ...p };
  },
  async submitQuote(_body: unknown) {
    void _body;
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return { id: hexId(), reference: `Q-${stamp}-DEMO${hexId().slice(0, 2).toUpperCase()}` };
  },
};
