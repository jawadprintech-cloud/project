import { createContext, useContext } from "react";
import type { ResolvedCatalog, ResolvedStyle } from "../../shared/catalog";
import type { Design, DesignElement } from "../../shared/design";
import type { Dieline, DielinePanel } from "../../shared/dieline";
import type { ImageCache } from "../lib/images";

export interface Studio {
  catalog: ResolvedCatalog;
  styles: ResolvedStyle[];
  style: ResolvedStyle;
  design: Design;
  dieline: Dieline;
  update: (fn: (d: Design) => Design, mergeKey?: string) => void;
  selected: DesignElement | null;
  select: (id: string | null) => void;
  activePanel: DielinePanel;
  setActivePanel: (id: string) => void;
  images: ImageCache;
  toast: (msg: string, kind?: "info" | "error" | "success") => void;
  readOnly: boolean;
}

export const StudioContext = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const s = useContext(StudioContext);
  if (!s) throw new Error("Studio context missing");
  return s;
}

export function useElementOps() {
  const s = useStudio();
  return {
    add(el: DesignElement) {
      // Don't stack new items exactly on top of existing ones: step down/up the panel.
      const taken = (x: number, y: number) =>
        s.design.elements.some((e) => e.panelId === el.panelId && Math.abs(e.x - x) < 0.1 && Math.abs(e.y - y) < 0.1);
      if (el.x === 0 && el.y === 0) {
        // Step along the panel's longer side (in its reading orientation) so items don't overlap.
        const panel = s.dieline.byId[el.panelId];
        const turned = el.rotation % 180 !== 0;
        const pw = panel ? (turned ? panel.bbox.h : panel.bbox.w) : 1;
        const ph = panel ? (turned ? panel.bbox.w : panel.bbox.h) : 1;
        const alongY = turned ? pw > ph * 1.2 : ph >= pw * 0.8;
        for (const k of [0, 0.3, -0.3, 0.4, -0.4]) {
          const [x, y] = alongY ? [0, k] : [k, 0];
          if (!taken(x, y)) {
            el = { ...el, x, y };
            break;
          }
        }
      }
      s.update((d) => ({ ...d, elements: [...d.elements, el] }));
      s.select(el.id);
    },
    patch(id: string, patch: Partial<DesignElement>, mergeKey?: string) {
      s.update(
        (d) => ({ ...d, elements: d.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as DesignElement) : e)) }),
        mergeKey,
      );
    },
    remove(id: string) {
      s.update((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== id) }));
      s.select(null);
    },
  };
}
