import { useEffect, useMemo, useState } from "react";
import { effectiveTemplate, fromUnit, toUnit, type ResolvedStyle, type Unit } from "../../shared/catalog";
import { buildDieline } from "../../shared/dieline";
import { validateDims } from "../../shared/validate";
import { defaultPanel } from "../state/factory";
import { useStudio } from "./context";
import { elementSize } from "../render/renderDesign";
import type { DesignElement } from "../../shared/design";
import type { DielinePanel } from "../../shared/dieline";

/** Scale an item down (never up) so it fits inside `panel` in its current rotation. */
function fitInto(e: DesignElement, panel: DielinePanel): DesignElement {
  const [w, h] = elementSize(e);
  const turned = Math.round(e.rotation / 90) % 2 !== 0;
  const pw = (turned ? panel.bbox.h : panel.bbox.w) * 0.9;
  const ph = (turned ? panel.bbox.w : panel.bbox.h) * 0.9;
  const k = Math.min(1, pw / w, ph / h);
  if (k >= 0.999) return e;
  if (e.type === "text") return { ...e, fontSize: Math.max(4, Math.round(e.fontSize * k * 10) / 10) };
  return { ...e, w: e.w * k, h: e.h * k };
}
import { STYLE_IMAGES } from "../lib/styleImages";

function StyleThumb({ style }: { style: ResolvedStyle }) {
  const d = useMemo(() => {
    try {
      const t = style.template;
      const dl = buildDieline(t, Object.fromEntries(t.dimensions.map((x) => [x.key, x.default])), { bleed: 0, safe: 0 });
      return {
        vb: `0 0 ${dl.width} ${dl.height}`,
        panels: dl.panels.map((p) => ({ id: p.id, main: p.kind === "panel", d: p.polygon.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join("") + "Z" })),
        fold: dl.foldLines.map(([a, b]) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`).join(""),
      };
    } catch {
      return null;
    }
  }, [style.template]);
  if (!d) return <div className="thumb" />;
  return (
    <svg className="thumb" viewBox={d.vb} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {d.panels.map((p) => (
        <path key={p.id} d={p.d} className={p.main ? "t-main" : "t-flap"} vectorEffect="non-scaling-stroke" />
      ))}
      <path d={d.fold} className="t-fold" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function StylePanel() {
  const s = useStudio();
  const choose = (st: ResolvedStyle) => {
    if (st.template.id === s.design.styleId || s.readOnly) return;
    const std = st.standardSizes[0];
    const dims = std ? { ...std.dims } : Object.fromEntries(st.template.dimensions.map((d) => [d.key, d.default]));
    let dl;
    try {
      dl = buildDieline(st.template, dims, { bleed: s.catalog.settings.bleedMm, safe: s.catalog.settings.safeMm });
    } catch {
      s.toast("This box style could not be loaded.", "error");
      return;
    }
    const fallback = defaultPanel(dl);
    s.update((d) => ({
      ...d,
      styleId: st.template.id,
      dims,
      sizeMode: std ? "standard" : "custom",
      standardSizeId: std?.id,
      colors: { ...d.colors, panels: Object.fromEntries(Object.entries(d.colors.panels).filter(([k]) => dl.byId[k])) },
      // Artwork stays on panels that exist in both styles; the rest moves to the front.
      // Rotation is adjusted so artwork keeps reading upright on the assembled box.
      elements: (() => {
        const spread = [0, 0.25, -0.25, 0.38, -0.38];
        let moved = 0;
        return d.elements.map((e) => {
          const target = dl.byId[e.panelId] ?? fallback;
          const before = s.dieline.byId[e.panelId]?.upright ?? 0;
          const rotation = (((e.rotation + target.upright - before) % 360) + 360) % 360;
          if (dl.byId[e.panelId]) return fitInto({ ...e, rotation }, target);
          const k = spread[moved++ % spread.length];
          const alongY = fallback.upright % 180 === 0;
          return fitInto({ ...e, panelId: fallback.id, x: alongY ? 0 : k, y: alongY ? k : 0, rotation }, fallback);
        });
      })(),
    }));
    s.setActivePanel(fallback.id);
  };
  return (
    <div className="tool">
      <h2>Choose a box style</h2>
      <p className="lead">Each style comes with its own dieline. Your artwork is kept when you switch styles.</p>
      <div className="style-grid">
        {s.styles.map((st) => (
          <button
            key={st.template.id}
            className={`style-card ${st.template.id === s.design.styleId ? "on" : ""}`}
            onClick={() => choose(st)}
            aria-pressed={st.template.id === s.design.styleId}
          >
            {st.config.image || STYLE_IMAGES[st.template.id] ? (
              <img className="thumb photo" src={st.config.image || STYLE_IMAGES[st.template.id]} alt={`${st.name} example`} loading="lazy" />
            ) : (
              <StyleThumb style={st} />
            )}
            <strong>{st.name}</strong>
            <span>{st.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SizePanel() {
  const s = useStudio();
  const { settings } = s.catalog;
  const tpl = useMemo(() => effectiveTemplate(s.style), [s.style]);
  const unit = s.design.unit;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<{ fields: Record<string, string>; general: string[] }>({ fields: {}, general: [] });

  // Sync the text fields from the design (style change, undo, standard size pick, unit change).
  useEffect(() => {
    setDraft(Object.fromEntries(tpl.dimensions.map((d) => [d.key, String(toUnit(s.design.dims[d.key] ?? d.default, unit))])));
    setErrors({ fields: {}, general: [] });
  }, [s.design.dims, unit, tpl]);

  const applyDraft = (next: Record<string, string>) => {
    setDraft(next);
    const mm: Record<string, number> = {};
    const fields: Record<string, string> = {};
    for (const d of tpl.dimensions) {
      const v = parseFloat(next[d.key]);
      if (!Number.isFinite(v)) fields[d.key] = `Enter a ${d.label.toLowerCase()}.`;
      else mm[d.key] = Math.round(fromUnit(v, unit) * 10) / 10;
    }
    if (Object.keys(fields).length) return setErrors({ fields, general: [] });
    const v = validateDims(tpl, mm, settings);
    setErrors({ fields: v.fields, general: v.general });
    if (v.ok) s.update((d) => ({ ...d, dims: mm, sizeMode: "custom", standardSizeId: undefined }), "dims");
  };

  const pickStandard = (id: string) => {
    const size = s.style.standardSizes.find((x) => x.id === id);
    if (!size) return;
    const v = validateDims(tpl, size.dims, settings);
    if (!v.ok) return s.toast([...Object.values(v.fields), ...v.general][0] ?? "Invalid size", "error");
    s.update((d) => ({ ...d, dims: { ...size.dims }, sizeMode: "standard", standardSizeId: id }));
  };

  const mode = s.design.sizeMode;
  const fmt = (mm: number) => `${toUnit(mm, unit)} ${unit}`;
  return (
    <div className="tool">
      <h2>Size &amp; material</h2>
      <div className="seg" role="tablist">
        <button className={mode === "standard" ? "on" : ""} onClick={() => s.style.standardSizes[0] && pickStandard(s.design.standardSizeId ?? s.style.standardSizes[0].id)} disabled={!s.style.standardSizes.length || s.readOnly}>
          Standard sizes
        </button>
        <button
          className={mode === "custom" ? "on" : ""}
          onClick={() => s.update((d) => ({ ...d, sizeMode: "custom", standardSizeId: undefined }))}
          disabled={!settings.allowCustomSizes || s.readOnly}
        >
          Custom size
        </button>
      </div>

      {mode === "standard" ? (
        <div className="size-list" role="radiogroup">
          {s.style.standardSizes.map((z) => (
            <label key={z.id} className={`size-opt ${s.design.standardSizeId === z.id ? "on" : ""}`}>
              <input type="radio" name="std" checked={s.design.standardSizeId === z.id} onChange={() => pickStandard(z.id)} disabled={s.readOnly} />
              <span>{z.label}</span>
            </label>
          ))}
        </div>
      ) : (
        <>
          <div className="row between">
            <span className="label">Units</span>
            <div className="seg small">
              {(["mm", "cm", "in"] as Unit[]).map((u) => (
                <button key={u} className={unit === u ? "on" : ""} onClick={() => s.update((d) => ({ ...d, unit: u }))}>
                  {u}
                </button>
              ))}
            </div>
          </div>
          <div className="dims">
            {tpl.dimensions.map((d) => (
              <label key={d.key} className={`field ${errors.fields[d.key] ? "invalid" : ""}`}>
                <span>
                  {d.label} <em>({d.key})</em>
                </span>
                <div className="unit-input">
                  <input
                    className="input"
                    inputMode="decimal"
                    value={draft[d.key] ?? ""}
                    onChange={(e) => applyDraft({ ...draft, [d.key]: e.target.value })}
                    aria-invalid={!!errors.fields[d.key]}
                    disabled={s.readOnly}
                  />
                  <span>{unit}</span>
                </div>
                <small>{errors.fields[d.key] ?? `${fmt(d.min)} – ${fmt(d.max)}${d.help ? ` · ${d.help}` : ""}`}</small>
              </label>
            ))}
          </div>
          {errors.general.map((g) => (
            <p key={g} className="error-note" role="alert">
              {g}
            </p>
          ))}
        </>
      )}
      <div className="facts">
        <div>
          <span>Box size</span>
          <strong>{tpl.dimensions.map((d) => toUnit(s.design.dims[d.key] ?? d.default, unit)).join(" × ")} {unit}</strong>
        </div>
        <div>
          <span>Flat dieline</span>
          <strong>
            {toUnit(s.dieline.width, unit)} × {toUnit(s.dieline.height, unit)} {unit}
          </strong>
        </div>
        <div>
          <span>Pieces</span>
          <strong>{s.dieline.pieces.map((p) => p.label).join(" + ")}</strong>
        </div>
      </div>

      <h3>Material</h3>
      <div className="material-list" role="radiogroup">
        {s.catalog.materials.map((m) => (
          <label key={m.id} className={`material ${s.design.materialId === m.id ? "on" : ""}`}>
            <input type="radio" name="material" checked={s.design.materialId === m.id} onChange={() => s.update((d) => ({ ...d, materialId: m.id }))} disabled={s.readOnly} />
            <span className="chip big" style={{ background: m.boardColor }} />
            <span>
              <strong>{m.name}</strong>
              <small>{m.description}</small>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
