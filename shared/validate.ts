import { evaluate } from "./expr";
import { buildDieline, templateScope, TemplateError, type Dieline } from "./dieline";
import type { BoxTemplate } from "./template-types";
import type { CatalogSettings } from "./catalog";

export interface DimValidation {
  ok: boolean;
  /** Per-dimension messages. */
  fields: Record<string, string>;
  /** Whole-box messages (constraints, sheet size). */
  general: string[];
  dieline?: Dieline;
}

/** Validate dimensions for a template and build the dieline when they are valid. */
export function validateDims(
  t: BoxTemplate,
  dims: Record<string, number>,
  settings: Pick<CatalogSettings, "bleedMm" | "safeMm" | "maxSheetMm">,
): DimValidation {
  const fields: Record<string, string> = {};
  const general: string[] = [];
  for (const d of t.dimensions) {
    const v = dims[d.key];
    if (v === undefined || !Number.isFinite(v)) fields[d.key] = `${d.label} is required.`;
    else if (v < d.min) fields[d.key] = `${d.label} must be at least ${d.min} mm.`;
    else if (v > d.max) fields[d.key] = `${d.label} must be at most ${d.max} mm.`;
  }
  if (Object.keys(fields).length) return { ok: false, fields, general };
  const opts = { bleed: settings.bleedMm, safe: settings.safeMm };
  try {
    const scope = templateScope(t, dims, opts);
    for (const c of t.constraints ?? []) {
      if (!evaluate(c.expr, scope)) general.push(c.message);
    }
  } catch (e) {
    general.push((e as Error).message);
  }
  if (general.length) return { ok: false, fields, general };
  let dieline: Dieline;
  try {
    dieline = buildDieline(t, dims, opts);
  } catch (e) {
    const msg = e instanceof TemplateError ? e.message : String(e);
    return { ok: false, fields, general: [`These dimensions do not produce a valid dieline (${msg}).`] };
  }
  const { w, h } = settings.maxSheetMm;
  const fits = (dieline.width <= w && dieline.height <= h) || (dieline.width <= h && dieline.height <= w);
  if (!fits) {
    general.push(
      `The flat dieline (${Math.round(dieline.width)} × ${Math.round(dieline.height)} mm) exceeds our maximum sheet size of ${w} × ${h} mm.`,
    );
    return { ok: false, fields, general };
  }
  return { ok: true, fields, general, dieline };
}

/** Structural validation for admin-supplied templates. Returns a list of problems (empty = valid). */
export function validateTemplate(t: unknown, settings: Pick<CatalogSettings, "bleedMm" | "safeMm" | "maxSheetMm">): string[] {
  const errs: string[] = [];
  const o = t as Partial<BoxTemplate>;
  if (!o || typeof o !== "object") return ["Template must be a JSON object."];
  if (o.schema !== 1) errs.push('"schema" must be 1.');
  if (!o.id || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(o.id)) errs.push('"id" must be lowercase letters, digits and dashes (2–49 chars).');
  if (!o.name) errs.push('"name" is required.');
  if (!Array.isArray(o.dimensions) || !o.dimensions.length) errs.push('"dimensions" must be a non-empty array.');
  if (!Array.isArray(o.pieces) || !o.pieces.length) errs.push('"pieces" must be a non-empty array.');
  if (!Array.isArray(o.panels) || !o.panels.length) errs.push('"panels" must be a non-empty array.');
  if (errs.length) return errs;
  for (const d of o.dimensions!) {
    if (!d.key || !/^[A-Za-z][A-Za-z0-9_]*$/.test(d.key)) errs.push(`Dimension key "${d.key}" is invalid.`);
    if (!(d.min > 0 && d.max >= d.min && d.default >= d.min && d.default <= d.max)) errs.push(`Dimension "${d.key}" needs 0 < min ≤ default ≤ max.`);
  }
  for (const p of o.panels!) {
    if (!p.id) errs.push("Every panel needs an id.");
    if (p.parent && !p.edge) errs.push(`Panel "${p.id}" needs an edge.`);
    if (!p.parent && (p.w === undefined || p.h === undefined)) errs.push(`Root panel "${p.id}" needs w and h.`);
    if (p.parent && p.depth === undefined) errs.push(`Panel "${p.id}" needs a depth.`);
  }
  if (errs.length) return errs;
  const tpl = o as BoxTemplate;
  const trial = [
    { label: "default size", dims: Object.fromEntries(tpl.dimensions.map((d) => [d.key, d.default])) },
    ...(tpl.standardSizes ?? []).map((s) => ({ label: `standard size "${s.label}"`, dims: s.dims })),
  ];
  for (const { label, dims } of trial) {
    const v = validateDims(tpl, dims, settings);
    if (!v.ok) errs.push(`At ${label}: ${[...Object.values(v.fields), ...v.general].join(" ")}`);
  }
  return errs;
}
