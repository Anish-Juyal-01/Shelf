import type { ThemePref } from "../bridge/protocol";
import { paletteById, type PaletteId } from "./palettes";

const KEY = "shelf.theme";
const PALETTE_KEY = "shelf.palette";

function resolve(pref: ThemePref): "light" | "dark" {
  if (pref === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return pref;
}

let current: ThemePref = "system";

/** Day/night mode and colour theme. Both are cached so the next start paints right away, before the host answers. */
export function applyTheme(pref: ThemePref, palette?: PaletteId) {
  current = pref;
  const root = document.documentElement;
  root.dataset.theme = resolve(pref);
  if (palette) root.dataset.palette = paletteById(palette).id;
  try {
    localStorage.setItem(KEY, pref);
    if (palette) localStorage.setItem(PALETTE_KEY, palette);
  } catch {
    // storage unavailable: the host sends both on every start anyway
  }
}

export function applyCachedTheme() {
  let pref: ThemePref = "system";
  let palette: PaletteId = "sunset";
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark" || saved === "system") pref = saved;
    palette = paletteById(localStorage.getItem(PALETTE_KEY) ?? undefined).id;
  } catch {
    // ignore
  }
  applyTheme(pref, palette);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (current === "system") applyTheme("system");
  });
}
