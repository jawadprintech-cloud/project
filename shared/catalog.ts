import type { BoxTemplate, StandardSize } from "./template-types";
import { BUILTIN_TEMPLATES } from "./templates";

export type Unit = "mm" | "cm" | "in";

export interface StyleConfig {
  id: string;
  enabled: boolean;
  order: number;
  name?: string;
  description?: string;
  /** Product photo for the style card (URL). Falls back to a built-in photo or the dieline outline. */
  image?: string;
  /** Replaces the template's own standard sizes when set. */
  standardSizes?: StandardSize[];
  /** Narrows/widens dimension limits per key. */
  limits?: Record<string, { min: number; max: number }>;
}

export interface MaterialOption {
  id: string;
  name: string;
  description: string;
  /** Colour of the unprinted outside of the board. */
  boardColor: string;
  /** Colour of the inside face. */
  insideColor: string;
  enabled: boolean;
}

export type FinishEffect = "matte" | "gloss" | "soft-touch" | "spot-uv" | "foil" | "emboss" | "deboss";

export interface FinishOption {
  id: string;
  name: string;
  description: string;
  /** lamination = whole-box coating (pick one); area = applied to selected artwork. */
  kind: "lamination" | "area";
  effect: FinishEffect;
  /** Foil colour. */
  color?: string;
  enabled: boolean;
}

export interface Swatch {
  name: string;
  hex: string;
  cmyk?: [number, number, number, number];
  pantone?: string;
}

export interface FontOption {
  family: string;
  category: "sans" | "serif" | "display" | "script" | "mono";
  /** Loaded from Google Fonts when true; otherwise must be a system/web-safe font. */
  google: boolean;
  bold: boolean;
  italic: boolean;
  enabled: boolean;
}

export interface PrintOption {
  id: string;
  name: string;
  description: string;
}

export interface CatalogSettings {
  companyName: string;
  bleedMm: number;
  safeMm: number;
  defaultUnit: Unit;
  maxUploadMb: number;
  allowCustomSizes: boolean;
  maxSheetMm: { w: number; h: number };
  quantityPresets: number[];
  minQuantity: number;
  quoteIntro: string;
}

export interface Catalog {
  settings: CatalogSettings;
  styles: StyleConfig[];
  materials: MaterialOption[];
  finishes: FinishOption[];
  colors: Swatch[];
  fonts: FontOption[];
  printOptions: PrintOption[];
}

export interface ResolvedStyle {
  template: BoxTemplate;
  config: StyleConfig;
  name: string;
  description: string;
  standardSizes: StandardSize[];
}

export interface ResolvedCatalog extends Catalog {
  templates: BoxTemplate[];
}

const font = (family: string, category: FontOption["category"], bold = true, italic = true, google = true): FontOption => ({
  family,
  category,
  google,
  bold,
  italic,
  enabled: true,
});

export const DEFAULT_CATALOG: Catalog = {
  settings: {
    companyName: "Custom Box Builder",
    bleedMm: 3,
    safeMm: 3,
    defaultUnit: "mm",
    maxUploadMb: 50,
    allowCustomSizes: true,
    maxSheetMm: { w: 1600, h: 1100 },
    quantityPresets: [100, 250, 500, 1000, 2500, 5000, 10000],
    minQuantity: 50,
    quoteIntro: "Our packaging specialists will review your design and send a custom quotation, usually within one business day.",
  },
  styles: BUILTIN_TEMPLATES.map((t, i) => ({ id: t.id, enabled: true, order: i })),
  materials: [
    { id: "sbs-white", name: "White SBS Paperboard", description: "Premium bleached board, bright white both sides.", boardColor: "#f7f7f4", insideColor: "#f4f4f1", enabled: true },
    { id: "kraft", name: "Kraft Paperboard", description: "Natural brown, eco-friendly board.", boardColor: "#c49a6c", insideColor: "#c9a174", enabled: true },
    { id: "corrugated-white", name: "E-Flute Corrugated (White)", description: "Sturdy corrugated board with white liner — best for mailers.", boardColor: "#f3f1ec", insideColor: "#cfa77a", enabled: true },
    { id: "corrugated-kraft", name: "E-Flute Corrugated (Kraft)", description: "Corrugated board with brown kraft liner.", boardColor: "#b98c5e", insideColor: "#c29466", enabled: true },
    { id: "rigid", name: "Rigid Greyboard (Wrapped)", description: "2 mm chipboard wrapped in printed art paper — for luxury rigid boxes.", boardColor: "#fbfbf8", insideColor: "#f2efe9", enabled: true },
    { id: "black-card", name: "Black Card", description: "Coloured-through black board for premium looks.", boardColor: "#1d1d1f", insideColor: "#1d1d1f", enabled: true },
  ],
  finishes: [
    { id: "lam-matte", name: "Matte Lamination", description: "Smooth, non-reflective protective film.", kind: "lamination", effect: "matte", enabled: true },
    { id: "lam-gloss", name: "Gloss Lamination", description: "High-shine, vivid colours.", kind: "lamination", effect: "gloss", enabled: true },
    { id: "lam-soft", name: "Soft-Touch Lamination", description: "Velvety, premium feel.", kind: "lamination", effect: "soft-touch", enabled: true },
    { id: "spot-uv", name: "Spot UV", description: "Glossy raised coating on selected artwork.", kind: "area", effect: "spot-uv", enabled: true },
    { id: "foil-gold", name: "Gold Foil Stamping", description: "Metallic gold foil on selected artwork.", kind: "area", effect: "foil", color: "#d4af37", enabled: true },
    { id: "foil-silver", name: "Silver Foil Stamping", description: "Metallic silver foil on selected artwork.", kind: "area", effect: "foil", color: "#c9ccd1", enabled: true },
    { id: "foil-rose", name: "Rose Gold Foil Stamping", description: "Metallic rose gold foil.", kind: "area", effect: "foil", color: "#d8a08b", enabled: true },
    { id: "emboss", name: "Embossing", description: "Raised relief on selected artwork.", kind: "area", effect: "emboss", enabled: true },
    { id: "deboss", name: "Debossing", description: "Pressed-in relief on selected artwork.", kind: "area", effect: "deboss", enabled: true },
  ],
  colors: [
    { name: "White", hex: "#ffffff", cmyk: [0, 0, 0, 0] },
    { name: "Black", hex: "#1a1a1a", cmyk: [0, 0, 0, 100] },
    { name: "Rich Black", hex: "#0d0d0f", cmyk: [60, 40, 40, 100] },
    { name: "Warm Grey", hex: "#8a8580", pantone: "Warm Gray 9 C" },
    { name: "Kraft", hex: "#c49a6c" },
    { name: "Cream", hex: "#f4ecd8" },
    { name: "Red", hex: "#d62828", pantone: "485 C" },
    { name: "Orange", hex: "#f77f00", pantone: "151 C" },
    { name: "Sunflower", hex: "#fcbf49", pantone: "7409 C" },
    { name: "Forest", hex: "#2d6a4f", pantone: "7727 C" },
    { name: "Mint", hex: "#95d5b2" },
    { name: "Teal", hex: "#0f7c80", pantone: "7713 C" },
    { name: "Sky", hex: "#4ea8de", pantone: "2995 C" },
    { name: "Navy", hex: "#1d3557", pantone: "534 C" },
    { name: "Royal Blue", hex: "#1f4bb4", pantone: "2728 C" },
    { name: "Lavender", hex: "#b8a1e3" },
    { name: "Plum", hex: "#6a2c70", pantone: "2613 C" },
    { name: "Blush", hex: "#f4c7c3" },
    { name: "Hot Pink", hex: "#e5446d", pantone: "213 C" },
    { name: "Gold", hex: "#c9a227", pantone: "7406 C" },
  ],
  fonts: [
    font("Inter", "sans"),
    font("Montserrat", "sans"),
    font("Poppins", "sans"),
    font("Roboto", "sans"),
    font("Open Sans", "sans"),
    font("Lato", "sans"),
    font("Raleway", "sans"),
    font("Oswald", "sans", true, false),
    font("Playfair Display", "serif"),
    font("Merriweather", "serif"),
    font("Lora", "serif"),
    font("Cormorant Garamond", "serif"),
    font("Bebas Neue", "display", false, false),
    font("Anton", "display", false, false),
    font("Abril Fatface", "display", false, false),
    font("Pacifico", "script", false, false),
    font("Dancing Script", "script", true, false),
    font("Great Vibes", "script", false, false),
    font("Lobster", "script", false, false),
    font("Roboto Mono", "mono"),
    font("Arial", "sans", true, true, false),
    font("Georgia", "serif", true, true, false),
  ],
  printOptions: [
    { id: "cmyk-outside", name: "Full colour (CMYK) – outside", description: "Standard four-colour process on the outside." },
    { id: "cmyk-both", name: "Full colour (CMYK) – outside & inside", description: "Printing on both faces of the board." },
    { id: "pantone", name: "Pantone spot colours", description: "Exact brand colour matching with PMS inks." },
    { id: "one-color", name: "1–2 colour print", description: "Economical spot-colour printing." },
    { id: "unprinted", name: "No printing (plain)", description: "Unprinted boxes, finishes only." },
  ],
};

/** Merge stored (partial) catalog data over the defaults so new fields always exist. */
export function normalizeCatalog(stored: Partial<Catalog> | null | undefined, templates: BoxTemplate[]): Catalog {
  const base = DEFAULT_CATALOG;
  const c: Catalog = {
    settings: { ...base.settings, ...(stored?.settings ?? {}) },
    styles: stored?.styles ? stored.styles.map((s) => ({ ...s })) : base.styles.map((s) => ({ ...s })),
    materials: stored?.materials ?? base.materials,
    finishes: stored?.finishes ?? base.finishes,
    colors: stored?.colors ?? base.colors,
    fonts: stored?.fonts ?? base.fonts,
    printOptions: stored?.printOptions ?? base.printOptions,
  };
  // Every template gets a style entry (new templates appear automatically).
  let order = Math.max(-1, ...c.styles.map((s) => s.order));
  for (const t of templates) {
    if (!c.styles.some((s) => s.id === t.id)) c.styles.push({ id: t.id, enabled: true, order: ++order });
  }
  c.styles = c.styles.filter((s) => templates.some((t) => t.id === s.id));
  c.styles.sort((a, b) => a.order - b.order);
  return c;
}

export function resolveStyles(cat: ResolvedCatalog, includeDisabled = false): ResolvedStyle[] {
  const out: ResolvedStyle[] = [];
  for (const config of cat.styles) {
    if (!config.enabled && !includeDisabled) continue;
    const template = cat.templates.find((t) => t.id === config.id);
    if (!template) continue;
    out.push({
      template,
      config,
      name: config.name || template.name,
      description: config.description || template.description,
      standardSizes: config.standardSizes ?? template.standardSizes ?? [],
    });
  }
  return out;
}

/** Template with catalog limit overrides applied to its dimension specs. */
export function effectiveTemplate(style: ResolvedStyle): BoxTemplate {
  const limits = style.config.limits;
  if (!limits) return style.template;
  return {
    ...style.template,
    dimensions: style.template.dimensions.map((d) =>
      limits[d.key] ? { ...d, min: limits[d.key].min, max: limits[d.key].max } : d,
    ),
  };
}

export const MM_PER: Record<Unit, number> = { mm: 1, cm: 10, in: 25.4 };

export function toUnit(mm: number, unit: Unit): number {
  const v = mm / MM_PER[unit];
  return unit === "in" ? Math.round(v * 1000) / 1000 : unit === "cm" ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
}

export function fromUnit(v: number, unit: Unit): number {
  return v * MM_PER[unit];
}
