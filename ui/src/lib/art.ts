import { hash, normalize } from "./library";

/**
 * Plate palettes for games without real art: three harmonious colours that become soft mesh-gradient fields over a
 * deep base. Hand-picked pairs that look good blurred together (no muddy mixes).
 * [base, field A, field B, field C]
 */
export const PALETTES: [string, string, string, string][] = [
  ["#14102b", "#ff5f6d", "#ffc371", "#6a5acd"],
  ["#0b1d26", "#00c9a7", "#4d8af0", "#c4fcef"],
  ["#1d0b24", "#c471f5", "#fa71cd", "#4f2d7f"],
  ["#10161f", "#f7971e", "#ffd200", "#e4572e"],
  ["#071a1a", "#43e97b", "#38f9d7", "#127369"],
  ["#160f1f", "#f093fb", "#f5576c", "#5b2a86"],
  ["#0d1326", "#4facfe", "#00f2fe", "#3a1c71"],
  ["#1a1410", "#e8a87c", "#c38d9e", "#41b3a3"],
  ["#0f0f14", "#8e9eab", "#eef2f3", "#4b6cb7"],
  ["#1b0f0a", "#ff9a44", "#fc6076", "#7a2e1e"],
  ["#0a1424", "#5ee7df", "#b490ca", "#1f3c88"],
  ["#14200f", "#c6ea8d", "#fe90af", "#2f5233"],
];

/** The plate palette for a title. */
export function palette(title: string): [string, string, string, string] {
  return PALETTES[hash(normalize(title)) % PALETTES.length];
}

/** One colour that stands for a game in charts and maps. */
export const gameColor = (title: string) => palette(title)[1];

/** Deterministic 0..1 values for a title (salted for different uses). */
export function unit(title: string, salt: number): number {
  return (hash(normalize(title) + "#" + salt) % 10_000) / 10_000;
}
