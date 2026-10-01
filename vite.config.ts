import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const apiPort = Number(process.env.API_PORT ?? 8787);

export default defineConfig({
  plugins: [react()],
  // Self-contained: don't inherit PostCSS config from parent folders.
  css: { postcss: { plugins: [] } },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        admin: resolve(import.meta.dirname, "admin.html"),
      },
      output: {
        manualChunks: { three: ["three"] },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
} as Parameters<typeof defineConfig>[0]);
