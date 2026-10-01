import { build } from "esbuild";

await build({
  entryPoints: ["server/app.ts"],
  outfile: "server/app.runtime.mjs",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node20",
});