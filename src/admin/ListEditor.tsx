export interface FieldDef<T> {
  key: keyof T & string;
  label: string;
  type: "text" | "textarea" | "color" | "bool" | "number" | "select" | "numbers";
  options?: { value: string; label: string }[];
  width?: "full" | "half";
  optional?: boolean;
}

interface Props<T> {
  items: T[];
  fields: FieldDef<T>[];
  onChange: (items: T[]) => void;
  blank: () => T;
  title: (item: T) => string;
  addLabel: string;
}

/** Generic card-list editor used for materials, finishes, colours, fonts and print options. */
export function ListEditor<T extends object>({ items, fields, onChange, blank, title, addLabel }: Props<T>) {
  const set = (i: number, key: keyof T, value: unknown) => onChange(items.map((it, j) => (j === i ? { ...it, [key]: value } : it)));
  const move = (i: number, d: number) => {
    const arr = items.slice();
    const [x] = arr.splice(i, 1);
    arr.splice(Math.max(0, Math.min(arr.length, i + d)), 0, x);
    onChange(arr);
  };
  return (
    <div className="list-editor">
      {items.map((item, i) => (
        <div className="le-card" key={i}>
          <div className="le-head">
            <strong>{title(item) || "(untitled)"}</strong>
            <div className="btn-row">
              <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down">↓</button>
              <button className="icon-btn" onClick={() => confirm("Remove this item?") && onChange(items.filter((_, j) => j !== i))} aria-label="Remove">🗑</button>
            </div>
          </div>
          <div className="le-fields">
            {fields.map((f) => {
              const v = (item as Record<string, unknown>)[f.key];
              let input: React.ReactNode;
              if (f.type === "bool") {
                input = <input type="checkbox" checked={!!v} onChange={(e) => set(i, f.key, e.target.checked)} />;
              } else if (f.type === "color") {
                input = (
                  <div className="row">
                    <input type="color" value={typeof v === "string" ? v : "#000000"} onChange={(e) => set(i, f.key, e.target.value)} />
                    <input className="input mono" value={(v as string) ?? ""} onChange={(e) => set(i, f.key, e.target.value || (f.optional ? undefined : ""))} />
                  </div>
                );
              } else if (f.type === "select") {
                input = (
                  <select className="input" value={(v as string) ?? ""} onChange={(e) => set(i, f.key, e.target.value)}>
                    {f.options!.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                );
              } else if (f.type === "textarea") {
                input = <textarea className="input" rows={2} value={(v as string) ?? ""} onChange={(e) => set(i, f.key, e.target.value)} />;
              } else if (f.type === "number") {
                input = <input className="input" type="number" value={(v as number) ?? ""} onChange={(e) => set(i, f.key, e.target.value === "" ? undefined : Number(e.target.value))} />;
              } else if (f.type === "numbers") {
                input = (
                  <input
                    className="input"
                    placeholder="e.g. 0, 100, 80, 5"
                    defaultValue={Array.isArray(v) ? v.join(", ") : ""}
                    onBlur={(e) => {
                      const nums = e.target.value.split(/[,\s]+/).filter(Boolean).map(Number);
                      set(i, f.key, nums.length === 4 && nums.every((n) => Number.isFinite(n)) ? nums : undefined);
                    }}
                  />
                );
              } else {
                input = <input className="input" value={(v as string) ?? ""} onChange={(e) => set(i, f.key, e.target.value === "" && f.optional ? undefined : e.target.value)} />;
              }
              return (
                <label key={f.key} className={`field ${f.type === "bool" ? "inline" : ""} ${f.width === "full" ? "full" : ""}`}>
                  <span>{f.label}</span>
                  {input}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <button className="btn" onClick={() => onChange([...items, blank()])}>+ {addLabel}</button>
    </div>
  );
}
