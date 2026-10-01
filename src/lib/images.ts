import UTIF from "utif";
import { assetUrl, DEMO } from "./api";
import { demoAssets } from "./demo";

export const ACCEPTED_EXT = ["jpg", "jpeg", "png", "tif", "tiff", "webp"];
export const ACCEPT_ATTR = ".jpg,.jpeg,.png,.tif,.tiff,.webp,image/jpeg,image/png,image/tiff,image/webp";
const PREVIEW_MAX = 2000;

export interface PreparedUpload {
  original: Blob;
  preview: Blob;
  pxWidth: number;
  pxHeight: number;
  mime: string;
}

function mimeFor(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jpg" || ext === "jpeg" || file.type === "image/jpeg") return "image/jpeg";
  if (ext === "png" || file.type === "image/png") return "image/png";
  if (ext === "webp" || file.type === "image/webp") return "image/webp";
  if (ext === "tif" || ext === "tiff" || file.type === "image/tiff") return "image/tiff";
  return null;
}

function decodeTiff(buf: ArrayBuffer): { canvas: HTMLCanvasElement; w: number; h: number } {
  const ifds = UTIF.decode(buf);
  if (!ifds.length) throw new Error("This TIFF file has no images.");
  // Pick the largest page (some TIFFs store a thumbnail first).
  let page = ifds[0];
  for (const p of ifds) if ((p.width ?? 0) * (p.height ?? 0) > (page.width ?? 0) * (page.height ?? 0)) page = p;
  UTIF.decodeImage(buf, page);
  const rgba = UTIF.toRGBA8(page);
  const w = page.width, h = page.height;
  if (!w || !h) throw new Error("Could not read this TIFF file.");
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const pixels = new Uint8ClampedArray(w * h * 4);
  pixels.set(rgba.subarray(0, pixels.length));
  ctx.putImageData(new ImageData(pixels, w, h), 0, 0);
  return { canvas, w, h };
}

function canvasToBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image."))), type, quality),
  );
}

/** Validate an artwork file and create an optimised preview; the original is kept untouched for print. */
export async function prepareUpload(file: File, maxMb: number): Promise<PreparedUpload> {
  const mime = mimeFor(file);
  if (!mime) throw new Error(`"${file.name}" is not a supported format. Use JPEG, PNG, TIFF or WebP.`);
  if (file.size > maxMb * 1_000_000) throw new Error(`"${file.name}" is larger than ${maxMb} MB.`);
  let source: CanvasImageSource;
  let w: number, h: number;
  if (mime === "image/tiff") {
    const t = decodeTiff(await file.arrayBuffer());
    source = t.canvas;
    w = t.w;
    h = t.h;
  } else {
    try {
      const bmp = await createImageBitmap(file);
      source = bmp;
      w = bmp.width;
      h = bmp.height;
    } catch {
      throw new Error(`"${file.name}" could not be read. The file may be damaged.`);
    }
  }
  const scale = Math.min(1, PREVIEW_MAX / Math.max(w, h));
  const pc = document.createElement("canvas");
  pc.width = Math.max(1, Math.round(w * scale));
  pc.height = Math.max(1, Math.round(h * scale));
  const ctx = pc.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, pc.width, pc.height);
  if ("close" in source) (source as ImageBitmap).close();
  const opaque = mime === "image/jpeg";
  let preview = await canvasToBlob(pc, opaque ? "image/jpeg" : "image/webp", 0.9);
  if (!opaque && preview.type !== "image/webp") preview = await canvasToBlob(pc, "image/png");
  return { original: new Blob([file], { type: mime }), preview, pxWidth: w, pxHeight: h, mime };
}

type Listener = () => void;

/** Loads preview images by asset id and notifies listeners when they become drawable. */
export class ImageCache {
  private images = new Map<string, HTMLImageElement>();
  private failed = new Set<string>();
  private listeners = new Set<Listener>();

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  /** Provide an already-decoded image (e.g. right after upload) so it shows instantly. */
  prime(id: string, blob: Blob) {
    if (this.images.has(id)) return;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => this.emit();
    img.src = URL.createObjectURL(blob);
    this.images.set(id, img);
  }

  get(id: string): HTMLImageElement | null {
    let img = this.images.get(id);
    if (!img) {
      if (this.failed.has(id)) return null;
      img = new Image();
      img.decoding = "async";
      img.onload = () => this.emit();
      img.onerror = () => {
        this.failed.add(id);
        this.emit();
      };
      this.images.set(id, img);
      if (DEMO && !demoAssets.url(id)) {
        void demoAssets.restore(id).then((u) => {
          if (u) img!.src = u;
          else {
            this.failed.add(id);
            this.emit();
          }
        });
      } else img.src = assetUrl(id);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  isFailed(id: string) {
    return this.failed.has(id);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}

/** Full-resolution original for print rendering (decodes TIFF in the browser). */
export async function loadOriginal(id: string, mime: string): Promise<CanvasImageSource> {
  const url = DEMO ? await demoAssets.restore(id) : assetUrl(id);
  if (!url) throw new Error("Could not load original artwork.");
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not load original artwork.");
  if (mime === "image/tiff") return decodeTiff(await res.arrayBuffer()).canvas;
  return createImageBitmap(await res.blob());
}
