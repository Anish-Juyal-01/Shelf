import type { ThemePref } from "../bridge/protocol";

const KEY = "shelf.theme";

function resolve(pref: ThemePref): "light" | "dark" {
  if (pref === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return pref;
}

let current: ThemePref = "system";

export function applyTheme(pref: ThemePref) {
  current = pref;
  document.documentElement.dataset.theme = resolve(pref);
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // storage unavailable: the host sends the theme on every start anyway
  }
}

/** Applies the last theme before the first paint, so there's no flash while the host connects. */
export function applyCachedTheme() {
  let pref: ThemePref = "system";
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark" || saved === "system") pref = saved;
  } catch {
    // ignore
  }
  applyTheme(pref);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (current === "system") applyTheme("system");
  });
}
