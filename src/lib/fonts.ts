import type { FontOption } from "../../shared/catalog";

const requested = new Set<string>();

/** Inject Google Fonts stylesheets for the catalog's fonts (fonts download lazily when first used). */
export function registerFonts(fonts: FontOption[]) {
  const google = fonts.filter((f) => f.google && !requested.has(f.family));
  if (!google.length || typeof document === "undefined") return;
  // Batch to keep URLs short.
  for (let i = 0; i < google.length; i += 8) {
    const batch = google.slice(i, i + 8);
    const families = batch
      .map((f) => {
        requested.add(f.family);
        const name = f.family.replace(/ /g, "+");
        if (f.bold && f.italic) return `family=${name}:ital,wght@0,400;0,700;1,400;1,700`;
        if (f.bold) return `family=${name}:wght@400;700`;
        if (f.italic) return `family=${name}:ital@0;1`;
        return `family=${name}`;
      })
      .join("&");
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    document.head.appendChild(link);
  }
}

export function fontString(family: string, bold: boolean, italic: boolean, px: number): string {
  return `${italic ? "italic " : ""}${bold ? 700 : 400} ${px}px "${family}", system-ui, sans-serif`;
}

const pending = new Map<string, Promise<void>>();

/** Resolves once the face is available to canvas; calls `onReady` the first time it loads. */
export function ensureFont(family: string, bold: boolean, italic: boolean, onReady: () => void): boolean {
  if (typeof document === "undefined" || !document.fonts) return true;
  const spec = fontString(family, bold, italic, 40);
  if (document.fonts.check(spec)) return true;
  if (!pending.has(spec)) {
    pending.set(
      spec,
      document.fonts
        .load(spec)
        .then(() => onReady())
        .catch(() => {}),
    );
  }
  return false;
}
