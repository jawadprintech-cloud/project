import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

type UploadRequest = IncomingMessage & { body?: unknown };
type UploadClientPayload = { id?: string; fileName?: string; kind?: string; mime?: string };

const recentRequests = new Map<string, { count: number; resetAt: number }>();
const GENERATED_TYPES = new Set(["image/png", "image/jpeg", "image/svg+xml", "application/json"]);
const UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/tiff", "image/webp", "image/jpg", "image/tif", "application/octet-stream"]);

export const config = { api: { bodyParser: false } };

function webHeaders(headers: IncomingHttpHeaders) {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (key === "connection" || key === "content-length" || key === "host" || value === undefined) continue;
    out.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return out;
}

async function readBody(req: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Invalid upload request.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function limit(ip: string) {
  const now = Date.now();
  const current = recentRequests.get(ip);
  if (!current || current.resetAt < now) {
    recentRequests.set(ip, { count: 1, resetAt: now + 10 * 60_000 });
    return;
  }
  if (++current.count > 120) throw new Error("Too many upload requests. Please wait and try again.");
}

function parseClientPayload(value: string | null): UploadClientPayload {
  if (!value) throw new Error("Missing upload metadata.");
  const payload = JSON.parse(value) as UploadClientPayload;
  if (!payload.id || !/^[a-f0-9]{32}$/.test(payload.id)) throw new Error("Invalid upload id.");
  if (payload.kind !== "upload" && payload.kind !== "generated") throw new Error("Invalid upload kind.");
  if (typeof payload.fileName !== "string" || payload.fileName.length > 255) throw new Error("Invalid file name.");
  if (typeof payload.mime !== "string" || payload.mime.length > 64) throw new Error("Invalid file type.");
  return payload;
}

export default async function handler(req: UploadRequest, res: ServerResponse) {
  try {
    const rawBody = typeof req.body === "string" ? req.body : await readBody(req, 100_000);
    const body = JSON.parse(rawBody) as HandleUploadPresignedBody;
    const request = new Request(new URL(req.url ?? "/", `https://${req.headers.host ?? "localhost"}`), {
      method: req.method ?? "POST",
      headers: webHeaders(req.headers),
      body: rawBody,
    });
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown").split(",")[0].trim();
    limit(ip);

    const result = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname, clientPayload) => {
        const meta = parseClientPayload(clientPayload);
        if (pathname !== `assets/${meta.id}`) throw new Error("Invalid upload path.");
        const mime = meta.mime.toLowerCase();
        const allowedTypes = meta.kind === "upload" ? UPLOAD_TYPES : GENERATED_TYPES;
        if (!allowedTypes.has(mime)) throw new Error("Unsupported file type.");
        const maximumSizeInBytes = meta.kind === "generated" ? 150_000_000 : 200_000_000;
        const validUntil = Date.now() + 10 * 60_000;
        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          allowedContentTypes: [mime],
          maximumSizeInBytes,
          validUntil,
        });
        return {
          token,
          urlOptions: {
            access: "private",
            allowedContentTypes: [mime],
            maximumSizeInBytes,
            addRandomSuffix: false,
            allowOverwrite: false,
            validUntil,
          },
        };
      },
    });

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload authorization failed.";
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: message }));
  }
}