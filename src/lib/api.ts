import type { ResolvedCatalog } from "../../shared/catalog";
import type { Design } from "../../shared/design";
import { uploadPresigned } from "@vercel/blob/client";
import { demoApi, demoAssets } from "./demo";

/** Static demo build: everything runs in the browser, no server. */
export const DEMO = import.meta.env.VITE_DEMO === "1";
const BLOB_UPLOADS = import.meta.env.VITE_BLOB_UPLOADS === "1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Request failed (${res.status}).`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

const json = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const newAssetId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

const serverApi = {
  catalog: () => request<ResolvedCatalog>("/api/catalog"),
  uploadAsset: async (blob: Blob, fileName: string, kind: "upload" | "generated" = "upload") => {
    if (BLOB_UPLOADS) {
      const id = newAssetId();
      const mime = blob.type || "application/octet-stream";
      const pathname = `assets/${id}`;
      await uploadPresigned(pathname, blob, {
        access: "private",
        handleUploadUrl: "/api/assets/upload",
        contentType: mime,
        multipart: blob.size > 100_000_000,
        clientPayload: JSON.stringify({ id, fileName, kind, mime }),
      });
      return request<{ id: string; url: string; mime: string; size: number }>("/api/assets/register", json("POST", { id, pathname, fileName, kind, mime }));
    }
    return request<{ id: string; url: string; mime: string; size: number }>("/api/assets", {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(fileName),
        "X-Asset-Kind": kind,
      },
      body: blob,
    });
  },
  createProject: (design: Design) => request<{ id: string; updatedAt: string }>("/api/projects", json("POST", { design })),
  saveProject: (id: string, design: Design) => request<{ id: string; updatedAt: string }>(`/api/projects/${id}`, json("PUT", { design })),
  loadProject: (id: string) => request<{ id: string; design: Design; updatedAt: string }>(`/api/projects/${id}`),
  submitQuote: (body: unknown) => request<{ id: string; reference: string }>("/api/quotes", json("POST", body)),
};

export const api: typeof serverApi = DEMO ? (demoApi as unknown as typeof serverApi) : serverApi;

export const assetUrl = (id: string) => (DEMO ? (demoAssets.url(id) ?? "") : `/api/assets/${id}`);

// ------------------------------------------------------------------ admin
const TOKEN_KEY = "bb-admin-token";
export const adminToken = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string | null) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export function adminRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const t = adminToken.get();
  return request<T>(url, { ...init, headers: { ...(init.headers ?? {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) } });
}

export const adminApi = {
  login: (password: string) => request<{ token: string }>("/api/admin/login", json("POST", { password })),
  quotes: () => adminRequest<{ quotes: AdminQuoteSummary[] }>("/api/admin/quotes"),
  quote: (id: string) => adminRequest<AdminQuote>(`/api/admin/quotes/${id}`),
  updateQuote: (id: string, patch: { status?: string; internalNotes?: string }) =>
    adminRequest<AdminQuote>(`/api/admin/quotes/${id}`, json("PATCH", patch)),
  catalog: () =>
    adminRequest<{ catalog: ResolvedCatalog; customTemplateIds: string[]; builtinTemplateIds: string[] }>("/api/admin/catalog"),
  saveCatalog: (catalog: unknown) => adminRequest<{ ok: true }>("/api/admin/catalog", json("PUT", { catalog })),
  saveTemplate: (id: string, template: unknown) => adminRequest<{ ok: true }>(`/api/admin/templates/${id}`, json("PUT", { template })),
  deleteTemplate: (id: string) => adminRequest<{ ok: true }>(`/api/admin/templates/${id}`, { method: "DELETE" }),
};

export interface AdminQuoteSummary {
  id: string;
  reference: string;
  createdAt: string;
  status: string;
  customer: { name: string; email: string; company: string };
  quantity: number;
  styleName: string;
  dims: string;
  mockup: string;
}

export interface AdminQuote {
  id: string;
  reference: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  internalNotes: string;
  projectId?: string;
  customer: { name: string; email: string; phone: string; company: string; country: string; address: string };
  requirements: {
    quantity: number;
    extraQuantities: number[];
    materialId: string;
    printOptionId: string;
    deadline: string;
    notes: string;
  };
  design: Design;
  files: {
    printFile: string;
    proof: string;
    dieline: string;
    designJson: string;
    mockups: string[];
    masks?: { finishId: string; assetId: string }[];
  };
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
