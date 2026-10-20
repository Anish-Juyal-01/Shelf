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

/**
 * Switch theme with a ripple: the new look spreads out in a circle from (x, y) — the button that was clicked — over
 * the old one. Falls back to an instant switch where View Transitions aren't supported or motion is reduced.
 */
export function switchSiteTheme(pref: ThemePref, x: number, y: number) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  const from = document.documentElement.dataset.theme;
  const to = pref === "system" ? (media().matches ? "dark" : "light") : pref;
  if (!doc.startViewTransition || from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    applySiteTheme(pref);
    return;
  }
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  doc.startViewTransition(() => applySiteTheme(pref)).ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 700, easing: "cubic-bezier(.4,0,.2,1)", pseudoElement: "::view-transition-new(root)" },
    );
  });
}

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
