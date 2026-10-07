import { useSyncExternalStore } from "react";

/*
 * Light or dark interface (dark by default). The choice is kept in the browser and index.html applies
 * it before React starts, so the page never flashes the other theme.
 */
export type Theme = "dark" | "light";

const KEY = "infraview.theme";
const listeners = new Set<() => void>();

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private mode or blocked storage: the choice lasts until the page is reloaded.
  }
  for (const l of listeners) l();
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    currentTheme,
  );
}
