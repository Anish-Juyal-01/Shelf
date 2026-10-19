// Colour themes. Each has a day and a night version; the CSS custom properties for all of them are generated from
// this file (installPalettes), and the Settings swatches read the same objects, so they can never disagree.

export type PaletteId = "sunset" | "aurora" | "neon" | "dune" | "deepsea" | "sakura";

export interface Tokens {
  bg: string;
  surface: string;
  "surface-2": string;
  sunken: string;
  ink: string;
  "ink-2": string;
  "ink-3": string;
  "ink-4": string;
  rule: string;
  "rule-strong": string;
  /** The three underline/accent colours (named by their Sunset hues). */
  "u-blue": string;
  "u-red": string;
  "u-yellow": string;
  "u-ink": string;
  /** Primary button. */
  accent: string;
  "accent-ink": string;
  "accent-soft": string;
  ok: string;
  warn: string;
  "sky-top": string;
  "sky-mid": string;
  "sky-low": string;
  "sky-glow": string;
  cloud: string;
  "cloud-shade": string;
}

export interface Palette {
  id: PaletteId;
  name: string;
  blurb: string;
  light: Tokens;
  dark: Tokens;
}

export const PALETTES: Palette[] = [
  {
    id: "sunset",
    name: "Sunset",
    blurb: "Paper white, a peach sunset sky",
    light: {
      bg: "#f6f4ef", surface: "#ffffff", "surface-2": "#f1eee7", sunken: "#e9e5dc",
      ink: "#151413", "ink-2": "#45423d", "ink-3": "#7b766d", "ink-4": "#aba59a", rule: "#e2ddd2", "rule-strong": "#cbc4b6",
      "u-blue": "#3a5bd9", "u-red": "#e0433a", "u-yellow": "#f0b31c", "u-ink": "#151413",
      accent: "#151413", "accent-ink": "#ffffff", "accent-soft": "#ebe7de", ok: "#2f8f57", warn: "#b7791f",
      "sky-top": "#5f86d8", "sky-mid": "#a9b9e6", "sky-low": "#f4c7a1", "sky-glow": "#ffd9a8", cloud: "#fff7ec", "cloud-shade": "#f2b48f",
    },
    dark: {
      bg: "#0e0f13", surface: "#17181e", "surface-2": "#1d1f26", sunken: "#0a0b0e",
      ink: "#efebe3", "ink-2": "#c7c2b8", "ink-3": "#8d887f", "ink-4": "#5d5a54", rule: "#272932", "rule-strong": "#3a3d48",
      "u-blue": "#7d97ff", "u-red": "#ff7466", "u-yellow": "#ffcb4d", "u-ink": "#efebe3",
      accent: "#efebe3", "accent-ink": "#111216", "accent-soft": "#262832", ok: "#6bd394", warn: "#f0b85a",
      "sky-top": "#070b1f", "sky-mid": "#18224a", "sky-low": "#3b3866", "sky-glow": "#8d84c9", cloud: "#c9cbe8", "cloud-shade": "#4a4a7c",
    },
  },
  {
    id: "aurora",
    name: "Aurora",
    blurb: "Icy mint under the northern lights",
    light: {
      bg: "#f1f5f3", surface: "#ffffff", "surface-2": "#e9f1ed", sunken: "#dfe9e4",
      ink: "#0f1f1c", "ink-2": "#384a46", "ink-3": "#6b7d78", "ink-4": "#9fb0aa", rule: "#d6e2dd", "rule-strong": "#b7cac3",
      "u-blue": "#14857f", "u-red": "#7c4dff", "u-yellow": "#8bc34a", "u-ink": "#0f1f1c",
      accent: "#0f4c45", "accent-ink": "#ecfff8", "accent-soft": "#dcebe6", ok: "#1f9d6a", warn: "#b7791f",
      "sky-top": "#0b2b3a", "sky-mid": "#1e6f6a", "sky-low": "#7fe3c1", "sky-glow": "#e6fff4", cloud: "#f2fffa", "cloud-shade": "#77c4b2",
    },
    dark: {
      bg: "#081311", surface: "#0f1c19", "surface-2": "#142420", sunken: "#050c0b",
      ink: "#e3f5ef", "ink-2": "#b4cdc5", "ink-3": "#7d958e", "ink-4": "#4f625c", rule: "#1b2e29", "rule-strong": "#2b453e",
      "u-blue": "#5eead4", "u-red": "#b9a4ff", "u-yellow": "#c6f68d", "u-ink": "#e3f5ef",
      accent: "#5eead4", "accent-ink": "#032420", "accent-soft": "#16302b", ok: "#5ee8a0", warn: "#f0c060",
      "sky-top": "#020812", "sky-mid": "#062f3a", "sky-low": "#0e6b58", "sky-glow": "#6cf5c2", cloud: "#8fcfc2", "cloud-shade": "#1a4744",
    },
  },
  {
    id: "neon",
    name: "Neon Dusk",
    blurb: "Magenta synth sky, hot pink and cyan",
    light: {
      bg: "#f8f3f9", surface: "#ffffff", "surface-2": "#f3eaf5", sunken: "#ebddee",
      ink: "#1d0f26", "ink-2": "#4a3655", "ink-3": "#7e6a88", "ink-4": "#b19fba", rule: "#e8d9ec", "rule-strong": "#cfb8d6",
      "u-blue": "#00a8cc", "u-red": "#ff2e88", "u-yellow": "#ffb800", "u-ink": "#1d0f26",
      accent: "#3b0a57", "accent-ink": "#ffffff", "accent-soft": "#efe2f3", ok: "#16a37a", warn: "#c07a00",
      "sky-top": "#3b1d78", "sky-mid": "#b23a9a", "sky-low": "#ff7a59", "sky-glow": "#ffd27a", cloud: "#ffe6f2", "cloud-shade": "#e0679b",
    },
    dark: {
      bg: "#120a1a", surface: "#1b1026", "surface-2": "#22142f", sunken: "#0c0612",
      ink: "#f6e9ff", "ink-2": "#d2bde0", "ink-3": "#9a84aa", "ink-4": "#644f73", rule: "#2e1e3d", "rule-strong": "#47305c",
      "u-blue": "#22e3ff", "u-red": "#ff4fa3", "u-yellow": "#ffd447", "u-ink": "#f6e9ff",
      accent: "#ff4fa3", "accent-ink": "#1a0612", "accent-soft": "#2c1a3b", ok: "#3cf0b0", warn: "#ffc24d",
      "sky-top": "#0b0420", "sky-mid": "#3d0f5c", "sky-low": "#a3226b", "sky-glow": "#ff8a4c", cloud: "#e0a8d6", "cloud-shade": "#5a1e5e",
    },
  },
  {
    id: "dune",
    name: "Dune",
    blurb: "Warm sand, terracotta and olive",
    light: {
      bg: "#f6efe4", surface: "#fffcf7", "surface-2": "#f0e6d6", sunken: "#e8dbc6",
      ink: "#2a1d12", "ink-2": "#5a4632", "ink-3": "#8a7560", "ink-4": "#b9a68f", rule: "#e3d5bf", "rule-strong": "#cdb898",
      "u-blue": "#5f7a3a", "u-red": "#c0532f", "u-yellow": "#d9a21b", "u-ink": "#2a1d12",
      accent: "#8a3b1e", "accent-ink": "#fff7ee", "accent-soft": "#efe1cd", ok: "#5f8a3a", warn: "#b7791f",
      "sky-top": "#6e8fb5", "sky-mid": "#e2b98c", "sky-low": "#e98a4f", "sky-glow": "#ffd9a0", cloud: "#fff1de", "cloud-shade": "#d9925e",
    },
    dark: {
      bg: "#16100b", surface: "#1f1710", "surface-2": "#271d14", sunken: "#0f0a06",
      ink: "#f5e8d8", "ink-2": "#d3bfa6", "ink-3": "#9c8670", "ink-4": "#685644", rule: "#33271b", "rule-strong": "#4d3b28",
      "u-blue": "#a3be6b", "u-red": "#f0845a", "u-yellow": "#f4c04c", "u-ink": "#f5e8d8",
      accent: "#f0845a", "accent-ink": "#1a0d06", "accent-soft": "#2e2217", ok: "#a3d36b", warn: "#f4c04c",
      "sky-top": "#1a1430", "sky-mid": "#4b2a3e", "sky-low": "#9a4b33", "sky-glow": "#e08a4e", cloud: "#c9a089", "cloud-shade": "#4e2e2a",
    },
  },
  {
    id: "deepsea",
    name: "Deep Sea",
    blurb: "Ocean blues with a coral glow",
    light: {
      bg: "#f0f4f8", surface: "#ffffff", "surface-2": "#e8eef5", sunken: "#dce5ef",
      ink: "#0e1b2b", "ink-2": "#364a62", "ink-3": "#6a7e95", "ink-4": "#9db0c4", rule: "#d6e0eb", "rule-strong": "#b6c6d8",
      "u-blue": "#0077b6", "u-red": "#ff6b5b", "u-yellow": "#f4b400", "u-ink": "#0e1b2b",
      accent: "#0b3c5d", "accent-ink": "#ffffff", "accent-soft": "#dfe8f1", ok: "#16946e", warn: "#b7791f",
      "sky-top": "#0b3c5d", "sky-mid": "#1c7ca8", "sky-low": "#7cd4e8", "sky-glow": "#e3faff", cloud: "#f4fdff", "cloud-shade": "#7fb8d0",
    },
    dark: {
      bg: "#07111c", surface: "#0d1a28", "surface-2": "#122235", sunken: "#040b13",
      ink: "#e4f0fb", "ink-2": "#b3c6da", "ink-3": "#7c90a6", "ink-4": "#4d6075", rule: "#1b2c40", "rule-strong": "#2b4360",
      "u-blue": "#4cc9f0", "u-red": "#ff8a7a", "u-yellow": "#ffd166", "u-ink": "#e4f0fb",
      accent: "#4cc9f0", "accent-ink": "#04121d", "accent-soft": "#16283b", ok: "#5ae0b0", warn: "#ffd166",
      "sky-top": "#01060f", "sky-mid": "#062a4a", "sky-low": "#0b5e7e", "sky-glow": "#3fd1e8", cloud: "#7fb3c9", "cloud-shade": "#12334a",
    },
  },
  {
    id: "sakura",
    name: "Sakura",
    blurb: "Soft blossom pink and periwinkle",
    light: {
      bg: "#fbf4f5", surface: "#ffffff", "surface-2": "#f7eaec", sunken: "#f0dde0",
      ink: "#2b1a1e", "ink-2": "#5b4148", "ink-3": "#8c7178", "ink-4": "#bea4ab", rule: "#eedadd", "rule-strong": "#dabbc0",
      "u-blue": "#6c7fd8", "u-red": "#e0457b", "u-yellow": "#eaa83a", "u-ink": "#2b1a1e",
      accent: "#b83260", "accent-ink": "#ffffff", "accent-soft": "#f6e3e8", ok: "#3c9a6e", warn: "#c08020",
      "sky-top": "#a9c3ea", "sky-mid": "#f4c6d7", "sky-low": "#fbe3ea", "sky-glow": "#fff6f8", cloud: "#ffffff", "cloud-shade": "#f2b6c9",
    },
    dark: {
      bg: "#160d11", surface: "#20141a", "surface-2": "#281a21", sunken: "#0e080b",
      ink: "#fbe9ef", "ink-2": "#dcbfca", "ink-3": "#a38793", "ink-4": "#6b525d", rule: "#352129", "rule-strong": "#523240",
      "u-blue": "#a5b4fc", "u-red": "#ff7fae", "u-yellow": "#f9cf7a", "u-ink": "#fbe9ef",
      accent: "#ff7fae", "accent-ink": "#1f0a12", "accent-soft": "#2d1b23", ok: "#7ee0b0", warn: "#f9cf7a",
      "sky-top": "#120a20", "sky-mid": "#3a1d3f", "sky-low": "#7e3b63", "sky-glow": "#f2a0c2", cloud: "#d9a9bf", "cloud-shade": "#4a2638",
    },
  },
];

export const paletteById = (id: string | undefined): Palette => PALETTES.find((p) => p.id === id) ?? PALETTES[0];

const block = (selector: string, t: Tokens, scheme: "light" | "dark") =>
  `${selector}{${Object.entries(t).map(([k, v]) => `--${k}:${v};`).join("")}color-scheme:${scheme};}`;

/** CSS for every palette: `:root[data-palette=x]` for day, plus `[data-theme=dark]` for night. */
export function paletteCss(): string {
  return PALETTES.map((p) =>
    block(`:root[data-palette="${p.id}"]`, p.light, "light") + block(`:root[data-palette="${p.id}"][data-theme="dark"]`, p.dark, "dark"),
  ).join("\n");
}

/** Injects the palette CSS once, before the first render. */
export function installPalettes() {
  if (document.getElementById("shelf-palettes")) return;
  const style = document.createElement("style");
  style.id = "shelf-palettes";
  style.textContent = paletteCss();
  document.head.appendChild(style);
}
