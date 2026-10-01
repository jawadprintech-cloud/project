import type { IncomingMessage, ServerResponse } from "node:http";
import { tsImport } from "tsx/esm/api";

type AppHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
let appPromise: Promise<AppHandler> | undefined;

export const config = { api: { bodyParser: false } };

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    appPromise ??= tsImport("../server/app.ts", import.meta.url).then(({ createApp }) => createApp({
        dataDir: "/tmp/box-builder",
        adminPassword: process.env.ADMIN_PASSWORD,
        webhookUrl: process.env.QUOTE_WEBHOOK_URL,
        publicUrl: process.env.PUBLIC_URL,
        log: (message) => console.log(`[box-builder] ${message}`),
      }));
    const app = await appPromise;
    await app(req, res);
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "The API could not connect to its persistent storage." }));
    console.error("[box-builder] API initialization failed", error);
  }
}