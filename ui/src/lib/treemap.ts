export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk): lays out <values> inside a w×h box so each tile's area is
 * proportional to its value and tiles stay close to square. Returns rects in the input order.
 */
export function squarify(values: number[], w: number, h: number): Rect[] {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0);
  const out: Rect[] = values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  if (total <= 0 || w <= 0 || h <= 0) return out;

  const scale = (w * h) / total;
  const items = values.map((v, i) => ({ i, a: Math.max(0, v) * scale })).filter((x) => x.a > 0).sort((a, b) => b.a - a.a);

  let box = { x: 0, y: 0, w, h };
  let row: typeof items = [];

  const worst = (r: typeof items, side: number) => {
    const sum = r.reduce((a, x) => a + x.a, 0);
    const max = Math.max(...r.map((x) => x.a));
    const min = Math.min(...r.map((x) => x.a));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  const layout = (r: typeof items) => {
    const sum = r.reduce((a, x) => a + x.a, 0);
    if (box.w >= box.h) {
      const colW = sum / box.h;
      let y = box.y;
      for (const x of r) {
        const hh = x.a / colW;
        out[x.i] = { x: box.x, y, w: colW, h: hh };
        y += hh;
      }
      box = { x: box.x + colW, y: box.y, w: box.w - colW, h: box.h };
    } else {
      const rowH = sum / box.w;
      let x0 = box.x;
      for (const x of r) {
        const ww = x.a / rowH;
        out[x.i] = { x: x0, y: box.y, w: ww, h: rowH };
        x0 += ww;
      }
      box = { x: box.x, y: box.y + rowH, w: box.w, h: box.h - rowH };
    }
  };

  for (const item of items) {
    const side = Math.min(box.w, box.h);
    if (row.length === 0 || worst([...row, item], side) <= worst(row, side)) {
      row.push(item);
    } else {
      layout(row);
      row = [item];
    }
  }
  if (row.length) layout(row);
  return out;
}
