import type { ThemePref } from "../bridge/protocol";

// The website's own day/night choice. Everyone starts on Light; picking Dark or System is remembered in this browser.
// (Kept apart from the app's theme setting, which the app's preview shares, so the two never mix.)

const KEY = "shelf.site.theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function savedSiteTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // storage blocked: just use the default
  }
  return "light";
}

let current: ThemePref = "light";
let listening = false;

export function applySiteTheme(pref: ThemePref) {
  current = pref;
  const root = document.documentElement;
  root.dataset.palette = "sunset";
  root.dataset.theme = pref === "system" ? (media().matches ? "dark" : "light") : pref;
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // ignore
  }
  if (!listening) {
    listening = true;
    media().addEventListener("change", () => current === "system" && applySiteTheme("system"));
  }
}
