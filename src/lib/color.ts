import type { Paint } from "../../shared/design";

export type RGB = [number, number, number];

export function normalizeHex(input: string): string | null {
  let h = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/i.test(h) ? `#${h.toLowerCase()}` : null;
}

export function hexToRgb(hex: string): RGB {
  const h = normalizeHex(hex) ?? "#000000";
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Naive (uncalibrated) CMYK → RGB, suitable for on-screen approximation only. */
export function cmykToRgb([c, m, y, k]: [number, number, number, number]): RGB {
  const f = (v: number) => 255 * (1 - v / 100) * (1 - k / 100);
  return [f(c), f(m), f(y)];
}

export function rgbToCmyk([r, g, b]: RGB): [number, number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const k = 1 - Math.max(rr, gg, bb);
  if (k >= 1) return [0, 0, 0, 100];
  const f = (v: number) => Math.round(((1 - v - k) / (1 - k)) * 100);
  return [f(rr), f(gg), f(bb), Math.round(k * 100)];
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function paint(hex: string): Paint {
  return { hex };
}

/**
 * Common Pantone® references with approximate sRGB screen values.
 * Screen colours are indicative only; the print team matches the reference.
 */
export const PANTONE_REFS: { code: string; hex: string }[] = [
  { code: "Yellow C", hex: "#fedd00" },
  { code: "109 C", hex: "#ffd100" },
  { code: "123 C", hex: "#ffc72c" },
  { code: "137 C", hex: "#ffa300" },
  { code: "151 C", hex: "#ff8200" },
  { code: "165 C", hex: "#ff671f" },
  { code: "Orange 021 C", hex: "#fe5000" },
  { code: "Warm Red C", hex: "#f9423a" },
  { code: "Red 032 C", hex: "#ef3340" },
  { code: "185 C", hex: "#e4002b" },
  { code: "186 C", hex: "#c8102e" },
  { code: "1795 C", hex: "#d22630" },
  { code: "199 C", hex: "#d50032" },
  { code: "Rubine Red C", hex: "#ce0058" },
  { code: "Rhodamine Red C", hex: "#e10098" },
  { code: "Purple C", hex: "#bb29bb" },
  { code: "Violet C", hex: "#440099" },
  { code: "2685 C", hex: "#330072" },
  { code: "Blue 072 C", hex: "#10069f" },
  { code: "Reflex Blue C", hex: "#001489" },
  { code: "286 C", hex: "#0033a0" },
  { code: "287 C", hex: "#003087" },
  { code: "293 C", hex: "#003da5" },
  { code: "300 C", hex: "#005eb8" },
  { code: "Process Blue C", hex: "#0085ca" },
  { code: "7545 C", hex: "#425563" },
  { code: "Green C", hex: "#00ab84" },
  { code: "354 C", hex: "#00b140" },
  { code: "348 C", hex: "#00843d" },
  { code: "368 C", hex: "#78be20" },
  { code: "375 C", hex: "#97d700" },
  { code: "7406 C", hex: "#f1c400" },
  { code: "871 C (Metallic Gold)", hex: "#84754e" },
  { code: "877 C (Metallic Silver)", hex: "#8a8d8f" },
  { code: "Cool Gray 1 C", hex: "#d9d9d6" },
  { code: "Cool Gray 11 C", hex: "#53565a" },
  { code: "426 C", hex: "#25282a" },
  { code: "Black C", hex: "#2d2926" },
];
