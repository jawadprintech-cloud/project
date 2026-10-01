import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app";
import { BUILTIN_TEMPLATES } from "../shared/templates";

let server: Server;
let base = "";
const dataDir = mkdtempSync(path.join(tmpdir(), "bb-test-"));

const PNG_1PX = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201a5b1a4d80000000049454e44ae426082",
  "hex",
);

beforeAll(async () => {
  const handler = await createApp({ dataDir, adminPassword: "secret" });
  server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const json = (method: string, body: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const design = {
  version: 1,
  name: "Test",
  styleId: "mailer-box",
  dims: { L: 250, W: 180, H: 60 },
  sizeMode: "custom",
  unit: "mm",
  materialId: "kraft",
  colors: { base: { hex: "#ffffff" }, panels: { lid: { hex: "#112233", pantone: "534 C" } } },
  laminationId: "lam-matte",
  elements: [
    {
      id: "el_1",
      type: "text",
      panelId: "front",
      x: 0,
      y: 0,
      w: 10,
      h: 5,
      rotation: 0,
      opacity: 1,
      clip: true,
      finishes: ["foil-gold"],
      text: "Hello",
      fontFamily: "Inter",
      fontSize: 24,
      color: { hex: "#000000" },
      bold: true,
      italic: false,
      align: "center",
      letterSpacing: 0,
      lineHeight: 1.2,
    },
  ],
};

async function upload(body: Buffer, type: string, kind?: string) {
  return fetch(`${base}/api/assets`, {
    method: "POST",
    headers: { "Content-Type": type, "X-File-Name": "a.png", ...(kind ? { "X-Asset-Kind": kind } : {}) },
    body: new Uint8Array(body),
  });
}

describe("API", () => {
  it("serves the catalog with every built-in style", async () => {
    const r = await fetch(`${base}/api/catalog`);
    const c = await r.json();
    expect(c.templates.map((t: { id: string }) => t.id).sort()).toEqual(BUILTIN_TEMPLATES.map((t) => t.id).sort());
    expect(c.finishes.length).toBeGreaterThan(5);
  });

  it("accepts image uploads by content and rejects other files", async () => {
    const ok = await upload(PNG_1PX, "image/jpeg"); // wrong header; signature wins
    expect(ok.status).toBe(201);
    const a = await ok.json();
    expect(a.mime).toBe("image/png");
    const got = await fetch(`${base}${a.url}`);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG_1PX)).toBe(true);

    const bad = await upload(Buffer.from("<script>alert(1)</script>"), "image/png");
    expect(bad.status).toBe(415);
    const svgAsUpload = await upload(Buffer.from("<svg/>"), "image/svg+xml");
    expect(svgAsUpload.status).toBe(415);
    const svgGenerated = await upload(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml", "generated");
    expect(svgGenerated.status).toBe(201);
    const svgGet = await fetch(`${base}${(await svgGenerated.json()).url}`);
    expect(svgGet.headers.get("content-disposition")).toMatch(/^attachment/);
  });

  it("saves, loads and updates projects", async () => {
    const c = await fetch(`${base}/api/projects`, json("POST", { design }));
    expect(c.status).toBe(201);
    const { id } = await c.json();
    const g = await (await fetch(`${base}/api/projects/${id}`)).json();
    expect(g.design.colors.panels.lid.pantone).toBe("534 C");
    const u = await fetch(`${base}/api/projects/${id}`, json("PUT", { design: { ...design, name: "Renamed" } }));
    expect(u.status).toBe(200);
    expect((await (await fetch(`${base}/api/projects/${id}`)).json()).design.name).toBe("Renamed");
    expect((await fetch(`${base}/api/projects/${"0".repeat(32)}`)).status).toBe(404);
  });

  it("rejects invalid designs", async () => {
    const r = await fetch(`${base}/api/projects`, json("POST", { design: { ...design, elements: [{ type: "evil" }] } }));
    expect(r.status).toBe(400);
    const nonJson = await fetch(`${base}/api/projects`, { method: "POST", body: "x" });
    expect(nonJson.status).toBe(415);
  });

  it("accepts quotes and exposes them to admins only", async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await (await upload(PNG_1PX, "image/png", "generated")).json()).id);
    const quote = {
      design,
      customer: { name: "Jane", email: "jane@example.com" },
      requirements: { quantity: 500, materialId: "kraft", printOptionId: "cmyk-outside" },
      files: { printFile: ids[0], proof: ids[1], dieline: ids[2], designJson: ids[3], mockups: [ids[4]] },
    };
    const bad = await fetch(`${base}/api/quotes`, json("POST", { ...quote, customer: { name: "", email: "nope" } }));
    expect(bad.status).toBe(400);
    const missingFile = await fetch(`${base}/api/quotes`, json("POST", { ...quote, files: { ...quote.files, proof: "f".repeat(32) } }));
    expect(missingFile.status).toBe(400);
    const r = await fetch(`${base}/api/quotes`, json("POST", quote));
    expect(r.status).toBe(201);
    const { id, reference } = await r.json();
    expect(reference).toMatch(/^Q-\d{8}-[0-9A-F]{6}$/);

    expect((await fetch(`${base}/api/admin/quotes`)).status).toBe(401);
    expect((await fetch(`${base}/api/admin/login`, json("POST", { password: "wrong" }))).status).toBe(401);
    const { token } = await (await fetch(`${base}/api/admin/login`, json("POST", { password: "secret" }))).json();
    const auth = { Authorization: `Bearer ${token}` };
    const list = await (await fetch(`${base}/api/admin/quotes`, { headers: auth })).json();
    expect(list.quotes[0].reference).toBe(reference);
    const detail = await (await fetch(`${base}/api/admin/quotes/${id}`, { headers: auth })).json();
    expect(detail.summary.styleName).toBe("Mailer Box");
    expect(detail.summary.finishes).toEqual(["Gold Foil Stamping"]);
    expect(detail.summary.lamination).toBe("Matte Lamination");
    const patched = await (await fetch(`${base}/api/admin/quotes/${id}`, json("PATCH", { status: "quoted", internalNotes: "£1.20/unit" }, auth))).json();
    expect(patched.status).toBe("quoted");
    expect((await fetch(`${base}/api/admin/quotes/${id}`, json("PATCH", { status: "bogus" }, auth))).status).toBe(400);
    const forged = { Authorization: `Bearer ${token.split(".")[0]}.AAAA` };
    expect((await fetch(`${base}/api/admin/quotes`, { headers: forged })).status).toBe(401);
  });

  it("lets admins manage the catalog and add templates without a rebuild", async () => {
    const { token } = await (await fetch(`${base}/api/admin/login`, json("POST", { password: "secret" }))).json();
    const auth = { Authorization: `Bearer ${token}` };
    const { catalog } = await (await fetch(`${base}/api/admin/catalog`, { headers: auth })).json();
    catalog.styles = catalog.styles.map((s: { id: string }) => (s.id === "burger-box" ? { ...s, enabled: false } : s));
    catalog.settings.companyName = "Acme Packaging";
    expect((await fetch(`${base}/api/admin/catalog`, json("PUT", { catalog }, auth))).status).toBe(200);
    const pub = await (await fetch(`${base}/api/catalog`)).json();
    expect(pub.settings.companyName).toBe("Acme Packaging");
    expect(pub.styles.some((s: { id: string }) => s.id === "burger-box")).toBe(false);

    const tpl = { ...BUILTIN_TEMPLATES.find((t) => t.id === "reverse-tuck-end")!, id: "straight-tuck", name: "Straight Tuck End" };
    expect((await fetch(`${base}/api/admin/templates/straight-tuck`, json("PUT", { template: tpl }, auth))).status).toBe(200);
    const broken = { ...tpl, id: "broken", panels: [{ id: "x", label: "X", parent: "missing", edge: "top", depth: 5 }] };
    expect((await fetch(`${base}/api/admin/templates/broken`, json("PUT", { template: broken }, auth))).status).toBe(400);
    const pub2 = await (await fetch(`${base}/api/catalog`)).json();
    expect(pub2.styles.some((s: { id: string }) => s.id === "straight-tuck")).toBe(true);
  });
});
