import { useCallback, useRef, useState } from "react";

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 150;
const MERGE_MS = 1200;

/**
 * Undoable state. Consecutive updates with the same `mergeKey` (a drag, a
 * slider, typing in a field) collapse into a single undo step.
 */
export function useHistory<T>(initial: T) {
  const [h, setH] = useState<HistoryState<T>>({ past: [], present: initial, future: [] });
  const lastMerge = useRef<{ key: string; t: number } | null>(null);

  const update = useCallback((fn: (prev: T) => T, mergeKey?: string) => {
    setH((s) => {
      const next = fn(s.present);
      if (next === s.present) return s;
      const now = Date.now();
      const m = lastMerge.current;
      const merge = !!mergeKey && !!m && m.key === mergeKey && now - m.t < MERGE_MS;
      lastMerge.current = mergeKey ? { key: mergeKey, t: now } : null;
      if (merge) return { past: s.past, present: next, future: [] };
      return { past: [...s.past, s.present].slice(-LIMIT), present: next, future: [] };
    });
  }, []);

  /** Replace state without an undo step (loading a project). */
  const reset = useCallback((value: T) => {
    lastMerge.current = null;
    setH({ past: [], present: value, future: [] });
  }, []);

  const undo = useCallback(() => {
    lastMerge.current = null;
    setH((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s));
  }, []);

  const redo = useCallback(() => {
    lastMerge.current = null;
    setH((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s));
  }, []);

  return { value: h.present, update, reset, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
