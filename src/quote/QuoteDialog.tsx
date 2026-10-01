import { useMemo, useState } from "react";
import { describePaint } from "../../shared/design";
import { toUnit } from "../../shared/catalog";
import { api, DEMO } from "../lib/api";
import { preflight } from "../lib/preflight";
import type { BoxPreviewHandle } from "../preview/BoxPreview";
import { buildPrintFiles, dataUrlToBlob } from "../render/exports";
import type { RenderSources } from "../render/renderDesign";
import { useStudio } from "../panels/context";

interface Props {
  preview: React.RefObject<BoxPreviewHandle | null>;
  sources: RenderSources;
  saveProject: () => Promise<string | undefined>;
  onClose: () => void;
  onFocusElement: (id: string) => void;
}

const DRAFT_KEY = "bb-quote-contact";

interface Form {
  name: string;
  email: string;
  phone: string;
  company: string;
  country: string;
  address: string;
  quantity: string;
  extraQuantities: string;
  materialId: string;
  printOptionId: string;
  deadline: string;
  notes: string;
}

export function QuoteDialog({ preview, sources, saveProject, onClose, onFocusElement }: Props) {
  const s = useStudio();
  const cat = s.catalog;
  const [step, setStep] = useState<"form" | "review" | "sending" | "done">("form");
  const [form, setForm] = useState<Form>(() => {
    let saved: Partial<Form> = {};
    try {
      saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}");
    } catch {
      /* ignore */
    }
    return {
      name: "",
      email: "",
      phone: "",
      company: "",
      country: "",
      address: "",
      quantity: String(cat.settings.quantityPresets[2] ?? 500),
      extraQuantities: "",
      materialId: s.design.materialId,
      printOptionId: cat.printOptions[0]?.id ?? "",
      deadline: "",
      notes: "",
      ...saved,
    };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<{ reference: string } | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);

  const checks = useMemo(() => preflight(s.design, s.dieline, cat), [s.design, s.dieline, cat]);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const extra = form.extraQuantities
    .split(/[,;\s]+/)
    .map((x) => parseInt(x.replace(/[^\d]/g, ""), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 5);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Please enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = "Please enter a valid email address.";
    const q = parseInt(form.quantity, 10);
    if (!Number.isFinite(q) || q < cat.settings.minQuantity) e.quantity = `Minimum quantity is ${cat.settings.minQuantity}.`;
    setErrors(e);
    return !Object.keys(e).length;
  };

  const toReview = () => {
    if (!validate()) return;
    try {
      const { name, email, phone, company, country, address } = form;
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ name, email, phone, company, country, address }));
    } catch {
      /* ignore */
    }
    setThumb(preview.current?.capture(["hero"], 480, 360)[0] ?? null);
    setStep("review");
  };

  const submit = async () => {
    setStep("sending");
    setFailure(null);
    try {
      const design = { ...s.design, materialId: form.materialId };
      setProgress("Saving your design…");
      const projectId = await saveProject();
      setProgress("Capturing 3D mockups…");
      const shots = preview.current?.capture(["hero", "heroBack", "front", "back"], 1200, 900) ?? [];
      if (!shots.length) throw new Error("The 3D preview is unavailable, so mockups could not be captured.");
      const files = await buildPrintFiles(s.dieline, design, cat, sources, setProgress);
      setProgress("Uploading files…");
      const up = (b: Blob, name: string) => api.uploadAsset(b, name, "generated").then((r) => r.id);
      const slug = (design.name || "design").replace(/[^\w-]+/g, "-").slice(0, 40);
      const meta = {
        exportedAt: new Date().toISOString(),
        design,
        dieline: { width: s.dieline.width, height: s.dieline.height, bleed: s.dieline.bleed, pieces: s.dieline.pieces.map((p) => p.label) },
        printDpi: files.dpi,
      };
      const [printFile, proof, dieline, designJson, mockups, masks] = await Promise.all([
        up(files.print, `${slug}-print-${files.dpi}dpi.png`),
        up(files.proof, `${slug}-proof.jpg`),
        up(files.dielineSvg, `${slug}-dieline.svg`),
        up(new Blob([JSON.stringify(meta, null, 2)], { type: "application/json" }), `${slug}-design.json`),
        Promise.all(shots.map((d, i) => up(dataUrlToBlob(d), `${slug}-mockup-${i + 1}.png`))),
        Promise.all(files.masks.map(async (m) => ({ finishId: m.finishId, assetId: await up(m.blob, `${slug}-${m.finishId}-mask.png`) }))),
      ]);
      setProgress("Sending your quote request…");
      const res = await api.submitQuote({
        projectId,
        design,
        customer: { name: form.name, email: form.email, phone: form.phone, company: form.company, country: form.country, address: form.address },
        requirements: {
          quantity: parseInt(form.quantity, 10),
          extraQuantities: extra,
          materialId: form.materialId,
          printOptionId: form.printOptionId,
          deadline: form.deadline,
          notes: form.notes,
        },
        files: { printFile, proof, dieline, designJson, mockups, masks },
      });
      setResult(res);
      setStep("done");
    } catch (e) {
      setFailure((e as Error).message);
      setStep("review");
    }
  };

  const tpl = s.style.template;
  const unit = s.design.unit;
  const lam = cat.finishes.find((f) => f.id === s.design.laminationId)?.name ?? "None";
  const areaFinishes = [...new Set(s.design.elements.flatMap((e) => e.finishes))].map((id) => cat.finishes.find((f) => f.id === id)?.name ?? id);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="quote-title">
      <div className="modal wide">
        <header className="modal-head">
          <h2 id="quote-title">{step === "done" ? "Quote request sent" : "Submit for quote"}</h2>
          {step !== "sending" && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </header>

        {step === "form" && (
          <div className="modal-body">
            <p className="lead">{cat.settings.quoteIntro}</p>
            <div className="form-grid">
              <fieldset>
                <legend>Your details</legend>
                <label className={`field ${errors.name ? "invalid" : ""}`}>
                  <span>Full name *</span>
                  <input className="input" value={form.name} onChange={set("name")} autoComplete="name" />
                  {errors.name && <small>{errors.name}</small>}
                </label>
                <label className={`field ${errors.email ? "invalid" : ""}`}>
                  <span>Email *</span>
                  <input className="input" type="email" value={form.email} onChange={set("email")} autoComplete="email" />
                  {errors.email && <small>{errors.email}</small>}
                </label>
                <div className="row">
                  <label className="field">
                    <span>Phone</span>
                    <input className="input" value={form.phone} onChange={set("phone")} autoComplete="tel" />
                  </label>
                  <label className="field">
                    <span>Company</span>
                    <input className="input" value={form.company} onChange={set("company")} autoComplete="organization" />
                  </label>
                </div>
                <div className="row">
                  <label className="field">
                    <span>Country</span>
                    <input className="input" value={form.country} onChange={set("country")} autoComplete="country-name" />
                  </label>
                  <label className="field">
                    <span>Needed by</span>
                    <input className="input" type="date" value={form.deadline} onChange={set("deadline")} />
                  </label>
                </div>
                <label className="field">
                  <span>Shipping address (for delivery estimate)</span>
                  <input className="input" value={form.address} onChange={set("address")} autoComplete="street-address" />
                </label>
              </fieldset>
              <fieldset>
                <legend>Order requirements</legend>
                <label className={`field ${errors.quantity ? "invalid" : ""}`}>
                  <span>Quantity *</span>
                  <input className="input" inputMode="numeric" value={form.quantity} onChange={set("quantity")} list="qty-presets" />
                  <datalist id="qty-presets">
                    {cat.settings.quantityPresets.map((q) => (
                      <option key={q} value={q} />
                    ))}
                  </datalist>
                  {errors.quantity ? <small>{errors.quantity}</small> : <small>Minimum {cat.settings.minQuantity} units</small>}
                </label>
                <label className="field">
                  <span>Also quote these quantities (optional)</span>
                  <input className="input" placeholder="e.g. 1000, 2500" value={form.extraQuantities} onChange={set("extraQuantities")} />
                </label>
                <label className="field">
                  <span>Material preference</span>
                  <select className="input" value={form.materialId} onChange={set("materialId")}>
                    {cat.materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Printing</span>
                  <select className="input" value={form.printOptionId} onChange={set("printOptionId")}>
                    {cat.printOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Notes for our team</span>
                  <textarea className="input" rows={4} value={form.notes} onChange={set("notes")} placeholder="Inserts, special requests, reference to a previous order…" />
                </label>
              </fieldset>
            </div>
            <footer className="modal-foot">
              <button className="btn" onClick={onClose}>Keep designing</button>
              <button className="btn primary" onClick={toReview}>Review request →</button>
            </footer>
          </div>
        )}

        {(step === "review" || step === "sending") && (
          <div className="modal-body">
            <div className="review">
              {thumb && <img className="review-thumb" src={thumb} alt="3D mockup of your box" />}
              <dl className="spec">
                <dt>Box style</dt>
                <dd>{s.style.name}</dd>
                <dt>Size</dt>
                <dd>
                  {tpl.dimensions.map((d) => `${d.label} ${toUnit(s.design.dims[d.key], unit)}`).join(" × ")} {unit}
                </dd>
                <dt>Quantity</dt>
                <dd>{[parseInt(form.quantity, 10), ...extra].map((n) => n.toLocaleString()).join(" / ")}</dd>
                <dt>Material</dt>
                <dd>{cat.materials.find((m) => m.id === form.materialId)?.name}</dd>
                <dt>Printing</dt>
                <dd>{cat.printOptions.find((p) => p.id === form.printOptionId)?.name}</dd>
                <dt>Background</dt>
                <dd>{describePaint(s.design.colors.base)}</dd>
                <dt>Lamination</dt>
                <dd>{lam}</dd>
                <dt>Special finishes</dt>
                <dd>{areaFinishes.length ? areaFinishes.join(", ") : "None"}</dd>
                <dt>Artwork</dt>
                <dd>{s.design.elements.length} item(s)</dd>
                <dt>Contact</dt>
                <dd>
                  {form.name} · {form.email}
                </dd>
              </dl>
            </div>
            <h3>Print check</h3>
            {checks.length === 0 ? (
              <p className="ok-note">✓ No issues found. Our prepress team will still review every file.</p>
            ) : (
              <ul className="preflight">
                {checks.map((c, i) => (
                  <li key={i} className={c.level}>
                    {c.text}
                    {c.elementId && step === "review" && (
                      <button className="btn link" onClick={() => (onFocusElement(c.elementId!), onClose())}>
                        Fix
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">
              We will receive your print-ready artwork, vector dieline, finish masks, 3D mockups and all original uploads. No payment is taken — pricing follows from our team.
            </p>
            {failure && (
              <p className="error-note" role="alert">
                {failure}
              </p>
            )}
            <footer className="modal-foot">
              {step === "sending" ? (
                <div className="progress-row">
                  <span className="spinner" /> {progress}
                </div>
              ) : (
                <>
                  <button className="btn" onClick={() => setStep("form")}>← Edit details</button>
                  <button className="btn primary" onClick={submit}>Submit for quote</button>
                </>
              )}
            </footer>
          </div>
        )}

        {step === "done" && result && (
          <div className="modal-body center">
            <div className="done-mark">✓</div>
            <p className="lead">
              Thank you, {form.name.split(" ")[0]}! Your reference is <strong>{result.reference}</strong>.
            </p>
            {DEMO ? (
              <p>
                This is the demo, so nothing was sent. In the live version your team receives the request with the print-ready artwork, dieline, finish masks, 3D mockups and original uploads, and replies to {form.email} with a quotation.
              </p>
            ) : (
              <p>We've received your design and will email {form.email} with your custom quotation. Your design stays saved — you can keep editing it any time from this link.</p>
            )}
            <footer className="modal-foot">
              <button className="btn primary" onClick={onClose}>Back to my design</button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
