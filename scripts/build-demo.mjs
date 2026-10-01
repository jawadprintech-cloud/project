// Builds the browser-only demo as a single self-contained HTML file (dist-demo/box-builder-demo.html).
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist-demo");
process.env.VITE_DEMO = "1";

await build({
  root,
  configFile: false,
  plugins: [react()],
  css: { postcss: { plugins: [] } },
  logLevel: "warn",
  build: {
    outDir: out,
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { input: path.join(root, "index.html"), output: { inlineDynamicImports: true } },
  },
});

const assets = path.join(out, "assets");
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith(".js")).map((f) => readFileSync(path.join(assets, f), "utf8")).join("\n");
const css = files.filter((f) => f.endsWith(".css")).map((f) => readFileSync(path.join(assets, f), "utf8")).join("\n");
const safeJs = js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

// Page body only: the host wraps it in its own document skeleton.
const html = `<title>Custom Box Builder</title>
<meta name="description" content="Design custom packaging on a real dieline, preview it in 3D and request a quote.">
<style>${css}</style>
<div id="root"></div>
<script type="module">${safeJs}</script>
`;
writeFileSync(path.join(out, "box-builder-demo.html"), html);
console.log(`dist-demo/box-builder-demo.html — ${(html.length / 1e6).toFixed(2)} MB`);
