import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const num = z.number().finite();
const assetId = z.string().regex(/^[a-f0-9]{32}$/);

export const paintSchema = z.object({
  hex,
  cmyk: z.tuple([num, num, num, num]).optional(),
  pantone: z.string().max(40).optional(),
});

const base = {
  id: z.string().min(1).max(64),
  panelId: z.string().min(1).max(64),
  x: num.min(-50).max(50),
  y: num.min(-50).max(50),
  w: num.min(0).max(5000),
  h: num.min(0).max(5000),
  rotation: num.min(-3600).max(3600),
  opacity: num.min(0).max(1),
  clip: z.boolean(),
  finishes: z.array(z.string().max(64)).max(10),
  locked: z.boolean().optional(),
};

const qrContent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"), url: z.string().max(2000) }),
  z.object({ kind: z.literal("text"), text: z.string().max(2000) }),
  z.object({
    kind: z.literal("contact"),
    name: z.string().max(200),
    org: z.string().max(200),
    phone: z.string().max(60),
    email: z.string().max(200),
    url: z.string().max(500),
    address: z.string().max(500),
  }),
  z.object({ kind: z.literal("email"), email: z.string().max(200), subject: z.string().max(300), body: z.string().max(1000) }),
  z.object({ kind: z.literal("phone"), phone: z.string().max(60) }),
]);

export const elementSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("image"),
    assetId,
    originalAssetId: assetId,
    fileName: z.string().max(255),
    mime: z.string().max(64),
    pxWidth: z.number().int().min(1).max(100000),
    pxHeight: z.number().int().min(1).max(100000),
  }),
  z.object({
    ...base,
    type: z.literal("text"),
    text: z.string().max(2000),
    fontFamily: z.string().max(80),
    fontSize: num.min(1).max(1000),
    color: paintSchema,
    bold: z.boolean(),
    italic: z.boolean(),
    align: z.enum(["left", "center", "right"]),
    letterSpacing: num.min(-500).max(2000),
    lineHeight: num.min(0.5).max(4),
  }),
  z.object({
    ...base,
    type: z.literal("qr"),
    content: qrContent,
    data: z.string().max(2953),
    fg: paintSchema,
    bg: paintSchema.nullable(),
    ecc: z.enum(["L", "M", "Q", "H"]),
  }),
  z.object({
    ...base,
    type: z.literal("shape"),
    shape: z.enum(["rect", "ellipse", "line"]),
    fill: paintSchema.nullable(),
    stroke: paintSchema.nullable(),
    strokeWidth: num.min(0).max(100),
    radius: num.min(0).max(1000),
  }),
]);

export const designSchema = z.object({
  version: z.literal(1),
  name: z.string().max(120),
  styleId: z.string().min(1).max(64),
  dims: z.record(z.string().max(16), num.min(0).max(10000)),
  sizeMode: z.enum(["standard", "custom"]),
  standardSizeId: z.string().max(64).optional(),
  unit: z.enum(["mm", "cm", "in"]),
  materialId: z.string().max(64),
  colors: z.object({
    base: paintSchema.nullable(),
    panels: z.record(z.string().max(64), paintSchema.nullable()),
  }),
  laminationId: z.string().max(64).nullable(),
  elements: z.array(elementSchema).max(300),
});

export const quoteSchema = z.object({
  projectId: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  design: designSchema,
  customer: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(200),
    phone: z.string().trim().max(40).optional().default(""),
    company: z.string().trim().max(120).optional().default(""),
    country: z.string().trim().max(80).optional().default(""),
    address: z.string().trim().max(400).optional().default(""),
  }),
  requirements: z.object({
    quantity: z.number().int().min(1).max(10_000_000),
    extraQuantities: z.array(z.number().int().min(1).max(10_000_000)).max(5).optional().default([]),
    materialId: z.string().max(64),
    printOptionId: z.string().max(64),
    deadline: z.string().max(40).optional().default(""),
    notes: z.string().max(5000).optional().default(""),
  }),
  files: z.object({
    printFile: assetId,
    proof: assetId,
    dieline: assetId,
    designJson: assetId,
    mockups: z.array(assetId).min(1).max(6),
    /** One black-on-white mask per area finish (spot UV, foil, emboss…). */
    masks: z.array(z.object({ finishId: z.string().max(64), assetId })).max(12).optional().default([]),
  }),
});

export type QuoteInput = z.infer<typeof quoteSchema>;

const styleConfig = z.object({
  id: z.string().max(64),
  enabled: z.boolean(),
  order: z.number().int(),
  name: z.string().max(120).optional(),
  description: z.string().max(1000).optional(),
  image: z.string().max(2000).regex(/^(https:\/\/|\/)/, "Image must be an https:// URL or a site path").optional(),
  standardSizes: z
    .array(z.object({ id: z.string().max(64), label: z.string().max(120), dims: z.record(z.string().max(16), num.positive()) }))
    .max(100)
    .optional(),
  limits: z.record(z.string().max(16), z.object({ min: num.positive(), max: num.positive() })).optional(),
});

export const catalogSchema = z.object({
  settings: z.object({
    companyName: z.string().max(120),
    bleedMm: num.min(0).max(20),
    safeMm: num.min(0).max(30),
    defaultUnit: z.enum(["mm", "cm", "in"]),
    maxUploadMb: num.min(1).max(200),
    allowCustomSizes: z.boolean(),
    maxSheetMm: z.object({ w: num.positive().max(10000), h: num.positive().max(10000) }),
    quantityPresets: z.array(z.number().int().positive()).max(20),
    minQuantity: z.number().int().min(1),
    quoteIntro: z.string().max(1000),
  }),
  styles: z.array(styleConfig).max(500),
  materials: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().max(120),
        description: z.string().max(500),
        boardColor: hex,
        insideColor: hex,
        enabled: z.boolean(),
      }),
    )
    .max(100),
  finishes: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().max(120),
        description: z.string().max(500),
        kind: z.enum(["lamination", "area"]),
        effect: z.enum(["matte", "gloss", "soft-touch", "spot-uv", "foil", "emboss", "deboss"]),
        color: hex.optional(),
        enabled: z.boolean(),
      }),
    )
    .max(100),
  colors: z
    .array(z.object({ name: z.string().max(80), hex, cmyk: z.tuple([num, num, num, num]).optional(), pantone: z.string().max(40).optional() }))
    .max(500),
  fonts: z
    .array(
      z.object({
        family: z.string().min(1).max(80).regex(/^[A-Za-z0-9 ]+$/),
        category: z.enum(["sans", "serif", "display", "script", "mono"]),
        google: z.boolean(),
        bold: z.boolean(),
        italic: z.boolean(),
        enabled: z.boolean(),
      }),
    )
    .max(200),
  printOptions: z.array(z.object({ id: z.string().min(1).max(64), name: z.string().max(120), description: z.string().max(500) })).max(50),
});

export const QUOTE_STATUSES = ["new", "in-review", "quoted", "won", "lost", "archived"] as const;
