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
 * Switch theme with a ripple behind the page: everything in front (text, cards, covers) takes the new theme at once,
 * while the background colour spreads out in a circle from (x, y) — the button that was clicked. Only the backdrop
 * ripples; nothing in front is ever covered. The circle is a small disc scaled up (just a transform on a 120px layer),
 * so it stays smooth on this heavy page.
 */
let ripple: { disc: HTMLElement; grow: Animation } | null = null;

const BG = { light: "#f6f4ef", dark: "#0e0f13" } as const;

function endRipple() {
  if (!ripple) return;
  ripple.grow.cancel();
  ripple.disc.remove();
  ripple = null;
  document.body.style.background = "";
  document.documentElement.classList.remove("theme-rippling");
}

export function switchSiteTheme(pref: ThemePref, x: number, y: number) {
  endRipple(); // a second click mid-ripple starts fresh from what's on screen
  const root = document.documentElement;
  const from = root.dataset.theme === "dark" ? "dark" : "light";
  const to = pref === "system" ? (media().matches ? "dark" : "light") : pref;
  if (from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    applySiteTheme(pref);
    return;
  }
  // Hold the old background behind the page, then flip the theme (transitions off, so nothing animates colour).
  document.body.style.background = BG[from];
  root.classList.add("theme-flipping", "theme-rippling");
  applySiteTheme(pref);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-flipping")));

  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const D = 120, end = (2 * r) / D + 0.05;
  const disc = document.createElement("div");
  disc.setAttribute("aria-hidden", "true");
  Object.assign(disc.style, {
    position: "fixed",
    left: `${x - D / 2}px`,
    top: `${y - D / 2}px`,
    width: `${D}px`,
    height: `${D}px`,
    borderRadius: "50%",
    background: BG[to],
    pointerEvents: "none",
    zIndex: "0", // behind the page, which sits at z-index 1
    transform: "scale(0)",
    willChange: "transform",
  });
  document.body.prepend(disc);
  const grow = disc.animate([{ transform: "scale(0)" }, { transform: `scale(${end})` }], { duration: 650, easing: "cubic-bezier(.45,0,.2,1)", fill: "forwards" });
  ripple = { disc, grow };
  grow.onfinish = () => {
    // The disc now covers the whole backdrop in the new colour; hand over to the real background.
    document.body.style.background = "";
    root.classList.remove("theme-rippling");
    disc.remove();
    ripple = null;
  };
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
