// Runs the API server and the Vite dev server together.
import { spawn } from "node:child_process";

const procs = [
  spawn("npx", ["tsx", "watch", "server/index.ts"], { stdio: "inherit", env: process.env, shell: true }),
  spawn("npx", ["vite"], { stdio: "inherit", env: process.env, shell: true }),
];
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", (code) => { stop(); process.exit(code ?? 0); }));
