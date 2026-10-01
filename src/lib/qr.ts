import qrcode from "qrcode-generator";
import type { QrContent } from "../../shared/design";

qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];

export const QUIET_ZONE = 4;

const escapeV = (s: string) => s.replace(/([\\;,])/g, "\\$1").replace(/\n/g, "\\n");

/** Encode structured QR content into the payload string scanners understand. */
export function encodeQr(c: QrContent): string {
  switch (c.kind) {
    case "url": {
      const u = c.url.trim();
      if (!u) return "";
      return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
    }
    case "text":
      return c.text;
    case "phone":
      return c.phone.trim() ? `tel:${c.phone.replace(/[^\d+]/g, "")}` : "";
    case "email": {
      if (!c.email.trim()) return "";
      const q = new URLSearchParams();
      if (c.subject) q.set("subject", c.subject);
      if (c.body) q.set("body", c.body);
      const qs = q.toString().replace(/\+/g, "%20");
      return `mailto:${c.email.trim()}${qs ? `?${qs}` : ""}`;
    }
    case "contact": {
      if (![c.name, c.phone, c.email, c.url, c.org].some((v) => v.trim())) return "";
      const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:;${escapeV(c.name)};;;`, `FN:${escapeV(c.name)}`];
      if (c.org) lines.push(`ORG:${escapeV(c.org)}`);
      if (c.phone) lines.push(`TEL;TYPE=CELL:${escapeV(c.phone)}`);
      if (c.email) lines.push(`EMAIL:${escapeV(c.email)}`);
      if (c.url) lines.push(`URL:${escapeV(c.url)}`);
      if (c.address) lines.push(`ADR:;;${escapeV(c.address)};;;;`);
      lines.push("END:VCARD");
      return lines.join("\n");
    }
  }
}

export interface QrMatrix {
  size: number;
  path: Path2D | null;
  cells: boolean[][];
}

const cache = new Map<string, QrMatrix>();

/** Module matrix for a payload (cached). Throws if the payload is too long for a QR code. */
export function qrMatrix(data: string, ecc: "L" | "M" | "Q" | "H"): QrMatrix {
  const key = `${ecc}|${data}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const q = qrcode(0, ecc);
  q.addData(data || " ", "Byte");
  q.make();
  const size = q.getModuleCount();
  const cells: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) row.push(q.isDark(r, c));
    cells.push(row);
  }
  let path: Path2D | null = null;
  if (typeof Path2D !== "undefined") {
    path = new Path2D();
    for (let r = 0; r < size; r++) {
      let c = 0;
      while (c < size) {
        if (!cells[r][c]) {
          c++;
          continue;
        }
        let e = c;
        while (e < size && cells[r][e]) e++;
        // Slight overlap avoids hairline seams between modules when rasterised.
        path.rect(c, r, e - c + 0.02, 1.02);
        c = e;
      }
    }
  }
  const m = { size, path, cells };
  if (cache.size > 100) cache.clear();
  cache.set(key, m);
  return m;
}

/** Smallest recommended printed size for reliable scanning (mm). */
export function minQrSizeMm(data: string, ecc: "L" | "M" | "Q" | "H"): number {
  try {
    const { size } = qrMatrix(data, ecc);
    // ~0.5 mm per module is a safe minimum for print; 15 mm floor.
    return Math.max(15, Math.ceil((size + 2 * QUIET_ZONE) * 0.5));
  } catch {
    return 15;
  }
}
