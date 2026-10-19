import { describe, expect, it } from "vitest";
import { PALETTES, paletteById, paletteCss, type Tokens } from "./palettes";

const KEYS = Object.keys(PALETTES[0].light) as (keyof Tokens)[];

/** WCAG relative luminance contrast between two hex colours. */
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

describe("palettes", () => {
  it("there are six, with unique ids", () => {
    expect(PALETTES).toHaveLength(6);
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(6);
  });

  it("every palette defines every token in both modes", () => {
    for (const p of PALETTES) {
      for (const mode of [p.light, p.dark]) {
        expect(Object.keys(mode).sort()).toEqual([...KEYS].sort());
        for (const v of Object.values(mode)) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("body text and buttons stay readable", () => {
    for (const p of PALETTES) {
      for (const t of [p.light, p.dark]) {
        expect(contrast(t.ink, t.bg), `${p.id} ink on bg`).toBeGreaterThan(10);
        expect(contrast(t["ink-3"], t.bg), `${p.id} ink-3 on bg`).toBeGreaterThan(3);
        expect(contrast(t["accent-ink"], t.accent), `${p.id} button`).toBeGreaterThan(4.5);
      }
    }
  });

  it("generates CSS for day and night and falls back to Sunset", () => {
    const css = paletteCss();
    expect(css).toContain(':root[data-palette="neon"][data-theme="dark"]{--bg:#120a1a;');
    expect(paletteById("nope").id).toBe("sunset");
  });
});
