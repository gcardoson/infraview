import { useCallback, useRef, useState } from "react";

/*
 * Undo/redo for the drawing. `set` records a step; `preview` changes the drawing without recording
 * (while dragging) and `commit` then records the whole drag as one step from where it started.
 */
export function useHistory<T>(initial: T | (() => T)) {
  const [state, setState] = useState(() => ({
    present: typeof initial === "function" ? (initial as () => T)() : initial,
    past: [] as T[],
    future: [] as T[],
  }));
  const base = useRef<T | null>(null);
  const present = useRef(state.present);
  present.current = state.present;

  const set = useCallback((next: T | ((t: T) => T)) => {
    setState((s) => {
      const value = typeof next === "function" ? (next as (t: T) => T)(s.present) : next;
      if (value === s.present) return s;
      return { present: value, past: [...s.past.slice(-99), s.present], future: [] };
    });
  }, []);

  const preview = useCallback((next: T | ((t: T) => T)) => {
    if (base.current === null) base.current = present.current;
    setState((s) => {
      const value = typeof next === "function" ? (next as (t: T) => T)(s.present) : next;
      return value === s.present ? s : { ...s, present: value };
    });
  }, []);

  const commit = useCallback((finish?: (t: T) => T) => {
    const start = base.current;
    base.current = null;
    setState((s) => {
      const value = finish ? finish(s.present) : s.present;
      if (start === null || value === start) return { ...s, present: value };
      return { present: value, past: [...s.past.slice(-99), start], future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setState((s) => (s.past.length ? { present: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.present, ...s.future] } : s));
  }, []);
  const redo = useCallback(() => {
    setState((s) => (s.future.length ? { present: s.future[0], past: [...s.past, s.present], future: s.future.slice(1) } : s));
  }, []);

  return { value: state.present, set, preview, commit, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
