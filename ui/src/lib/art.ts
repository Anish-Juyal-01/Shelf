import { hash, normalize } from "./library";

/** [deep, mid, glow] */
export const PALETTES: [string, string, string][] = [
  ["#0B1026", "#3B2C85", "#FF5E78"],
  ["#06141B", "#0F5257", "#7CF2C8"],
  ["#1A0B2E", "#6A1B9A", "#FFB347"],
  ["#0D1B2A", "#1B4965", "#F4D35E"],
  ["#14070F", "#7A1E3A", "#FF8C42"],
  ["#03120E", "#1D5C3A", "#D7FF6B"],
  ["#100C23", "#2E3192", "#4DE1FF"],
  ["#1C0A00", "#8C3B0C", "#FFD166"],
  ["#0A0F14", "#334155", "#E2E8F0"],
  ["#160018", "#A0076A", "#FFC2E2"],
  ["#001219", "#005F73", "#EE9B00"],
  ["#120A1F", "#4C1D95", "#C4B5FD"],
];

/** The poster palette for a title: [deep, mid, glow]. */
export function palette(title: string): [string, string, string] {
  return PALETTES[hash(normalize(title)) % PALETTES.length];
}

/** One colour that stands for a game in charts and maps (its poster's mid tone). */
export const gameColor = (title: string) => palette(title)[1];
