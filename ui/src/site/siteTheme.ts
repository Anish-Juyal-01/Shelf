import type { ThemePref } from "../bridge/protocol";
import { paletteById } from "../lib/palettes";

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
 * Switch theme with a ripple from (x, y) — the button that was clicked. The background spreads out in a circle (a small
 * disc scaled up behind the page, so it's just a cheap transform), and everything in front changes at the moment the
 * wave reaches it: until then each element is held on the old theme (its colour variables pinned with a data-hold
 * attribute), and it's let go as the circle passes its middle. Nothing switches ahead of the wave, and nothing is
 * covered.
 */
let ripple: { disc: HTMLElement; grow: Animation; held: Element[]; raf: number } | null = null;

const BG = { light: "#f6f4ef", dark: "#0e0f13" } as const;
const DURATION = 650;
const EASE = [0.45, 0, 0.2, 1] as const;

/** Time (0–1) at which the eased ripple reaches progress p (0–1): the inverse of the cubic-bezier easing. */
function timeAt(p: number): number {
  const [x1, y1, x2, y2] = EASE;
  const bez = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    if (bez(t, y1, y2) < p) lo = t;
    else hi = t;
  }
  return bez((lo + hi) / 2, x1, x2);
}

/** CSS that pins an element (and what's inside it) to one theme's colours: [data-hold=light] / [data-hold=dark]. */
function installHoldRules() {
  if (document.getElementById("site-hold")) return;
  const p = paletteById("sunset");
  const block = (mode: "light" | "dark") =>
    `[data-hold="${mode}"]{${Object.entries(mode === "dark" ? p.dark : p.light).map(([k, v]) => `--${k}:${v};`).join("")}color-scheme:${mode};}`;
  const style = document.createElement("style");
  style.id = "site-hold";
  style.textContent = block("light") + block("dark");
  document.head.appendChild(style);
}

function clearRipple() {
  if (!ripple) return;
  ripple.grow.cancel();
  ripple.disc.remove();
  cancelAnimationFrame(ripple.raf);
  for (const el of ripple.held) el.removeAttribute("data-hold");
  ripple = null;
  document.body.style.background = "";
  document.documentElement.classList.remove("theme-rippling");
}

export function switchSiteTheme(pref: ThemePref, x: number, y: number) {
  clearRipple(); // a second click mid-ripple starts fresh from what's on screen
  const root = document.documentElement;
  const from = root.dataset.theme === "dark" ? "dark" : "light";
  const to = pref === "system" ? (media().matches ? "dark" : "light") : pref;
  if (from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    applySiteTheme(pref);
    return;
  }
  installHoldRules();
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

  // Everything on screen is held on the old theme until the wave reaches its nearest edge. (Measure first, then write.)
  const els = [...document.querySelectorAll("#root *")];
  const due = els.map((el) => {
    const b = el.getBoundingClientRect();
    if (b.bottom < 0 || b.top > innerHeight || b.width === 0) return -1;
    // Things on the page switch as the wave passes their middle; big containers (sections, wrappers) as soon as it
    // touches them, so they never hold back what's inside.
    const big = b.width > innerWidth * 0.6 || b.height > innerHeight * 0.6;
    const px = big ? Math.max(b.left, Math.min(x, b.right)) : b.left + b.width / 2;
    const py = big ? Math.max(b.top, Math.min(y, b.bottom)) : b.top + b.height / 2;
    return timeAt(Math.min(1, Math.hypot(px - x, py - y) / r)) * DURATION;
  });
  const queue: [number, Element][] = [];
  els.forEach((el, i) => {
    if (due[i] > 16) { // reached in the first frame anyway
      el.setAttribute("data-hold", from);
      queue.push([due[i], el]);
    }
  });
  queue.sort((a, b) => a[0] - b[0]);

  document.body.style.background = BG[from]; // the old backdrop, until the disc has covered it
  root.classList.add("theme-rippling");
  applySiteTheme(pref);

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
  const grow = disc.animate([{ transform: "scale(0)" }, { transform: `scale(${end})` }], {
    duration: DURATION,
    easing: `cubic-bezier(${EASE.join(",")})`,
    fill: "forwards",
  });

  // Let elements go as the wave passes them.
  const start = performance.now();
  let next = 0;
  const step = () => {
    const t = performance.now() - start;
    while (next < queue.length && queue[next][0] <= t) queue[next++][1].removeAttribute("data-hold");
    if (ripple && next < queue.length) ripple.raf = requestAnimationFrame(step);
  };
  ripple = { disc, grow, held: queue.map((q) => q[1]), raf: requestAnimationFrame(step) };
  grow.onfinish = () => {
    for (const [, el] of queue) el.removeAttribute("data-hold");
    document.body.style.background = "";
    root.classList.remove("theme-rippling");
    disc.remove();
    if (ripple?.disc === disc) {
      cancelAnimationFrame(ripple.raf);
      ripple = null;
    }
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
