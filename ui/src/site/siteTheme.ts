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
 * Switch theme with a ripple: a disc of the new background colour grows out of (x, y) — the button that was clicked —
 * until it covers the page; the theme flips underneath it, and the disc fades away to reveal the new look. Only a
 * transform and an opacity animate, so it stays smooth even on this heavy page (a full-page View Transition has to
 * screenshot everything first, which is what made it lag).
 */
let ripple: { disc: HTMLElement; grow: Animation } | null = null;

export function switchSiteTheme(pref: ThemePref, x: number, y: number) {
  // A second click mid-ripple: drop the unfinished one (its flip never happens) and start from what's on screen.
  if (ripple) {
    ripple.grow.cancel();
    ripple.disc.remove();
    ripple = null;
  }
  const from = document.documentElement.dataset.theme;
  const to = pref === "system" ? (media().matches ? "dark" : "light") : pref;
  if (from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    applySiteTheme(pref);
    return;
  }
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  // A small disc scaled up, rather than a page-sized one: the GPU only ever holds a 120px texture.
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
    background: to === "dark" ? "#0e0f13" : "#f6f4ef",
    pointerEvents: "none",
    zIndex: "9999",
    transform: "scale(0)",
    willChange: "transform, opacity",
  });
  document.body.appendChild(disc);
  const grow = disc.animate([{ transform: "scale(0)" }, { transform: `scale(${end})` }], { duration: 480, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" });
  ripple = { disc, grow };
  grow.onfinish = () => {
    ripple = null;
    // Flip with transitions off, so hundreds of colour transitions don't all start at once.
    const root = document.documentElement;
    root.classList.add("theme-flipping");
    applySiteTheme(pref);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        root.classList.remove("theme-flipping");
        disc.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: "ease-out", fill: "forwards" }).onfinish = () => disc.remove();
      }),
    );
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
