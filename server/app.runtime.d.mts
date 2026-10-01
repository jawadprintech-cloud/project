import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppOptions } from "./app.ts";

export declare function createApp(
  options: AppOptions,
): Promise<(req: IncomingMessage, res: ServerResponse) => Promise<void>>;