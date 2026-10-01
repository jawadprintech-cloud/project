import { createServer } from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import { createApp } from "./app";

const root = path.resolve(import.meta.dirname, "..");
// `--production` works on every OS (Windows shells cannot set NODE_ENV inline).
const production = process.env.NODE_ENV === "production" || process.argv.includes("--production");
const port = Number(process.env.PORT ?? (production ? 8080 : process.env.API_PORT ?? 8787));
const host = process.env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1");
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(root, "data"));
const staticDir = path.join(root, "dist");

let adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword && !production) {
  adminPassword = "admin";
  console.warn('[box-builder] ADMIN_PASSWORD not set — using "admin" for local development only.');
}
if (!adminPassword) console.warn("[box-builder] ADMIN_PASSWORD not set — the admin panel is disabled.");

const handler = await createApp({
  dataDir,
  staticDir: production && existsSync(staticDir) ? staticDir : undefined,
  adminPassword,
  webhookUrl: process.env.QUOTE_WEBHOOK_URL,
  publicUrl: process.env.PUBLIC_URL,
  log: (m) => console.log(`[box-builder] ${m}`),
});

createServer(handler).listen(port, host, () => {
  console.log(`[box-builder] API${production ? " + app" : ""} listening on http://${host}:${port} (data: ${dataDir})`);
});
