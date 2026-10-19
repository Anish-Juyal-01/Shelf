import { describe, expect, it } from "vitest";
import { squarify } from "./treemap";

describe("squarify", () => {
  it("tiles fill the box with areas proportional to values", () => {
    const values = [6, 6, 4, 3, 2, 2, 1];
    const rects = squarify(values, 600, 400);
    const total = values.reduce((a, b) => a + b, 0);
    rects.forEach((r, i) => expect(r.w * r.h).toBeCloseTo((values[i] / total) * 600 * 400, 3));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(600 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(400 + 1e-6);
    }
  });

  it("keeps tiles reasonably square", () => {
    const rects = squarify([10, 10, 10, 10], 400, 400);
    for (const r of rects) expect(Math.max(r.w / r.h, r.h / r.w)).toBeLessThan(2.1);
  });

  it("handles zeros and empty input", () => {
    expect(squarify([], 100, 100)).toEqual([]);
    const r = squarify([0, 5], 100, 100);
    expect(r[0].w * r[0].h).toBe(0);
    expect(r[1].w * r[1].h).toBeCloseTo(10000);
  });
});
