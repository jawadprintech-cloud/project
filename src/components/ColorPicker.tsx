import { useEffect, useState } from "react";
import type { Swatch } from "../../shared/catalog";
import type { Paint } from "../../shared/design";
import { cmykToRgb, hexToRgb, normalizeHex, PANTONE_REFS, rgbToCmyk, rgbToHex } from "../lib/color";

interface Props {
  value: Paint | null;
  onChange: (p: Paint | null, mergeKey?: string) => void;
  swatches: Swatch[];
  /** Offer a "no ink" choice (unprinted board). */
  allowNone?: boolean;
  noneLabel?: string;
  idKey: string;
}

type Mode = "hex" | "rgb" | "cmyk" | "pantone";

/** Colour picker with swatches, native picker, HEX, RGB, CMYK and Pantone reference entry. */
export function ColorPicker({ value, onChange, swatches, allowNone, noneLabel = "None", idKey }: Props) {
  const [mode, setMode] = useState<Mode>(value?.pantone ? "pantone" : value?.cmyk ? "cmyk" : "hex");
  const hex = value?.hex ?? "#ffffff";
  const [hexText, setHexText] = useState(hex);
  const [pantoneQuery, setPantoneQuery] = useState("");
  useEffect(() => setHexText(value?.hex ?? ""), [value?.hex]);

  const rgb = hexToRgb(hex);
  const cmyk = value?.cmyk ?? rgbToCmyk(rgb);
  const set = (p: Paint, merge = true) => onChange(p, merge ? `color:${idKey}` : undefined);

  const matches = PANTONE_REFS.filter((r) => r.code.toLowerCase().includes(pantoneQuery.toLowerCase())).slice(0, 12);

  return (
    <div className="color-picker">
      <div className="swatches" role="listbox" aria-label="Colour swatches">
        {allowNone && (
          <button
            className={`swatch none ${value === null ? "on" : ""}`}
            title={noneLabel}
            aria-label={noneLabel}
            onClick={() => onChange(null)}
          />
        )}
        {swatches.map((s) => (
          <button
            key={s.name + s.hex}
            className={`swatch ${value?.hex === s.hex ? "on" : ""}`}
            style={{ background: s.hex }}
            title={`${s.name}${s.pantone ? ` · Pantone ${s.pantone}` : ""}`}
            aria-label={s.name}
            onClick={() => onChange({ hex: s.hex, cmyk: s.cmyk, pantone: s.pantone })}
          />
        ))}
        <label className="swatch custom" title="Custom colour">
          <input type="color" value={hex} onChange={(e) => set({ hex: e.target.value })} aria-label="Custom colour" />
        </label>
      </div>
      <div className="seg small" role="tablist">
        {(["hex", "rgb", "cmyk", "pantone"] as Mode[]).map((m) => (
          <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
            {m === "pantone" ? "Pantone" : m.toUpperCase()}
          </button>
        ))}
      </div>
      {mode === "hex" && (
        <div className="row">
          <span className="chip" style={{ background: value ? hex : "transparent" }} />
          <input
            className="input mono"
            value={hexText}
            placeholder="#RRGGBB"
            onChange={(e) => {
              setHexText(e.target.value);
              const h = normalizeHex(e.target.value);
              if (h) set({ hex: h });
            }}
            aria-label="HEX colour"
          />
        </div>
      )}
      {mode === "rgb" && (
        <div className="row three">
          {(["R", "G", "B"] as const).map((c, i) => (
            <label key={c} className="mini-field">
              <span>{c}</span>
              <input
                className="input"
                type="number"
                min={0}
                max={255}
                value={rgb[i]}
                onChange={(e) => {
                  const next = [...rgb] as [number, number, number];
                  next[i] = Math.max(0, Math.min(255, Number(e.target.value) || 0));
                  set({ hex: rgbToHex(next) });
                }}
              />
            </label>
          ))}
        </div>
      )}
      {mode === "cmyk" && (
        <>
          <div className="row four">
            {(["C", "M", "Y", "K"] as const).map((c, i) => (
              <label key={c} className="mini-field">
                <span>{c}</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  value={cmyk[i]}
                  onChange={(e) => {
                    const next = [...cmyk] as [number, number, number, number];
                    next[i] = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                    set({ hex: rgbToHex(cmykToRgb(next)), cmyk: next });
                  }}
                />
              </label>
            ))}
          </div>
          <p className="hint">CMYK values are sent to our print team; the screen colour is an approximation.</p>
        </>
      )}
      {mode === "pantone" && (
        <>
          <input
            className="input"
            placeholder="Search or type a Pantone code, e.g. 186 C"
            value={pantoneQuery}
            onChange={(e) => setPantoneQuery(e.target.value)}
            aria-label="Pantone reference"
          />
          <div className="pantone-list">
            {matches.map((r) => (
              <button key={r.code} className={`pantone ${value?.pantone === r.code ? "on" : ""}`} onClick={() => onChange({ hex: r.hex, pantone: r.code })}>
                <span className="chip" style={{ background: r.hex }} /> {r.code}
              </button>
            ))}
            {pantoneQuery && !matches.length && (
              <button className="pantone" onClick={() => onChange({ hex, pantone: pantoneQuery.trim() })}>
                Use “{pantoneQuery.trim()}” as the reference for the current colour
              </button>
            )}
          </div>
          {value?.pantone && <p className="hint">Reference: Pantone {value.pantone} (screen colour approximate)</p>}
        </>
      )}
    </div>
  );
}
