// The app's "spatial" world: frosted glass floating over a room lit by the focused game's art. Every colour theme
// in palettes.ts keeps its accents and ink; this file turns its surfaces into glass and its sky into the room's
// fallback light. Only the app uses it (the website keeps palettes.ts as it is), scoped by :root[data-app].

import { PALETTES, type Palette, type Tokens } from "./palettes";

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");
const alpha = (hex: string, a: number) => `rgb(${rgb(hex)} / ${a})`;

function mix(a: string, b: string, k: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return `#${[1, 3, 5].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * k).toString(16).padStart(2, "0")).join("")}`;
}

type Vars = Record<string, string>;

/** Night (and both modes of the black themes): smoked glass over a dark room. */
function nightGlass(t: Tokens, black: boolean): Vars {
  const bg = black ? "#000000" : mix(t.bg, "#000000", 0.45);
  return {
    bg,
    surface: "rgb(255 255 255 / 0.065)",
    "surface-2": "rgb(255 255 255 / 0.11)",
    sunken: "rgb(0 0 0 / 0.28)",
    rule: "rgb(255 255 255 / 0.085)",
    "rule-strong": "rgb(255 255 255 / 0.16)",
    edge: "rgb(255 255 255 / 0.13)",
    "edge-hi": "rgb(255 255 255 / 0.26)",
    "accent-soft": alpha(t.accent, 0.16),
    "room-a": t["sky-glow"],
    "room-b": t["sky-mid"],
    "room-veil": alpha(bg, 0.7),
    "room-deep": alpha(bg, 0.96),
    "room-dim": alpha(bg, 0.3),
    "room-light": "0.7",
    lift: "0 30px 60px -22px rgb(0 0 0 / 0.75), 0 10px 22px -12px rgb(0 0 0 / 0.55)",
    shadow: "0 24px 48px -24px rgb(0 0 0 / 0.7), 0 8px 18px -12px rgb(0 0 0 / 0.5)",
    "cover-shadow": "0 24px 44px -20px rgb(0 0 0 / 0.85), 0 8px 16px -10px rgb(0 0 0 / 0.6)",
  };
}

/** Day: milky glass over a bright, washed-out room. */
function dayGlass(t: Tokens): Vars {
  const bg = mix(t.bg, "#e8ebf2", 0.5);
  return {
    bg,
    surface: "rgb(255 255 255 / 0.56)",
    "surface-2": "rgb(255 255 255 / 0.74)",
    sunken: "rgb(255 255 255 / 0.3)",
    rule: alpha(t.ink, 0.085),
    "rule-strong": alpha(t.ink, 0.16),
    edge: "rgb(255 255 255 / 0.72)",
    "edge-hi": "rgb(255 255 255 / 0.95)",
    "accent-soft": alpha(t.accent, 0.1),
    "room-a": t["sky-low"],
    "room-b": t["sky-top"],
    "room-veil": alpha(bg, 0.5),
    "room-deep": alpha(bg, 0.9),
    "room-dim": alpha(bg, 0.12),
    "room-light": "0.7",
    lift: "0 28px 56px -26px rgb(40 50 80 / 0.45), 0 10px 20px -12px rgb(40 50 80 / 0.28)",
    shadow: "0 22px 44px -24px rgb(40 50 80 / 0.4), 0 8px 16px -12px rgb(40 50 80 / 0.25)",
    "cover-shadow": "0 24px 40px -20px rgb(30 40 70 / 0.55), 0 8px 14px -10px rgb(30 40 70 / 0.35)",
  };
}

const block = (selector: string, t: Tokens, glass: Vars, scheme: "light" | "dark") =>
  `${selector}{${Object.entries({ ...t, ...glass }).map(([k, v]) => `--${k}:${v};`).join("")}color-scheme:${scheme};}`;

function paletteBlocks(p: Palette): string {
  const day = `:root[data-app][data-palette="${p.id}"]`;
  const night = `${day}[data-theme="dark"]`;
  return p.black
    ? block(day, p.light, nightGlass(p.light, false), "dark") + block(night, p.dark, nightGlass(p.dark, true), "dark")
    : block(day, p.light, dayGlass(p.light), "light") + block(night, p.dark, nightGlass(p.dark, false), "dark");
}

export function spaceCss(): string {
  return PALETTES.map(paletteBlocks).join("\n");
}

/** Marks the document as the app (not the website) and injects the glass tokens for every theme. */
export function installSpace() {
  document.documentElement.dataset.app = "";
  if (document.getElementById("shelf-space")) return;
  const style = document.createElement("style");
  style.id = "shelf-space";
  style.textContent = spaceCss();
  document.head.appendChild(style);
}
