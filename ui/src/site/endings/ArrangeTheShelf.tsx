import { Shuffle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GameView } from "../../bridge/protocol";
import { Cover } from "../../components/Cover";
import { bytes } from "../../lib/format";
import { isOverdue } from "../../lib/library";
import { ago, type EndingProps } from "./shared";

// Arrange the shelf: your games standing on real shelves. Drag one to a new spot and the rest make room, or sort
// them by size, by when you last played, or A–Z and watch them reshuffle. The newcomer lands in the gap left for it.

type Sort = "size" | "played" | "name";
const SORTS: { key: Sort; label: string }[] = [
  { key: "size", label: "Biggest first" },
  { key: "played", label: "Last played" },
  { key: "name", label: "A–Z" },
];
const HOLE = -1; // the empty spot the newcomer lands in

export function ArrangeTheShelf({ games, faller, landed, slotRef, onOpen }: EndingProps) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [sort, setSort] = useState<Sort | null>(null);
  const [order, setOrder] = useState<number[]>(() => {
    const ids = games.filter((g) => g.id !== faller.id).map((g) => g.id);
    ids.splice(Math.min(5, ids.length), 0, HOLE);
    return ids;
  });
  const [drag, setDrag] = useState<{ id: number; x: number; y: number; dx: number; dy: number; moved: number } | null>(null);

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The newcomer takes its spot when it lands.
  useEffect(() => {
    if (landed) setOrder((o) => o.map((id) => (id === HOLE ? faller.id : id)));
  }, [landed, faller]);

  const cw = w < 640 ? 62 : 92;
  const gap = w < 640 ? 8 : 14;
  const pad = w < 640 ? 16 : 40;
  const perRow = Math.max(3, Math.floor((w - 2 * pad + gap) / (cw + gap)));
  const rowH = cw * 1.5 + 58;
  const top = w < 640 ? 118 : 74; // room for the toolbar, which wraps on phones
  const rows = Math.ceil(order.length / perRow);
  const rowW = perRow * (cw + gap) - gap;
  const left0 = (w - rowW) / 2;
  const at = (i: number) => ({ x: left0 + (i % perRow) * (cw + gap), y: top + Math.floor(i / perRow) * rowH });
  const byId = (id: number) => games.find((g) => g.id === id)!;

  const doSort = (s: Sort) => {
    setSort(s);
    const cmp: Record<Sort, (a: GameView, b: GameView) => number> = {
      size: (a, b) => b.sizeBytes - a.sizeBytes,
      played: (a, b) => Date.parse(b.lastPlayed ?? "1970") - Date.parse(a.lastPlayed ?? "1970"),
      name: (a, b) => a.title.localeCompare(b.title),
    };
    setOrder((o) => {
      const hole = o.indexOf(HOLE);
      const sorted = o.filter((id) => id !== HOLE).map(byId).sort(cmp[s]).map((g) => g.id);
      if (hole >= 0) sorted.splice(hole, 0, HOLE);
      return sorted;
    });
  };
  const shuffle = () => {
    setSort(null);
    setOrder((o) => {
      const a = [...o];
      for (let i = a.length - 1; i > 0; i--) {
        const k = Math.floor(Math.random() * (i + 1));
        [a[i], a[k]] = [a[k], a[i]];
      }
      return a;
    });
  };

  const local = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (id: number) => (e: React.PointerEvent) => {
    const p = local(e), s = at(order.indexOf(id));
    setDrag({ id, x: s.x, y: s.y, dx: p.x - s.x, dy: p.y - s.y, moved: 0 });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = local(e);
    const x = p.x - drag.dx, y = p.y - drag.dy;
    setDrag({ ...drag, x, y, moved: drag.moved + Math.abs(x - drag.x) + Math.abs(y - drag.y) });
    // Where would its centre land?
    const col = Math.max(0, Math.min(perRow - 1, Math.round((x - left0) / (cw + gap))));
    const row = Math.max(0, Math.min(rows - 1, Math.round((y - top) / rowH)));
    const target = Math.min(order.length - 1, row * perRow + col);
    const from = order.indexOf(drag.id);
    if (target !== from) {
      const o = [...order];
      o.splice(from, 1);
      o.splice(target, 0, drag.id);
      setOrder(o);
      setSort(null);
    }
  };
  const up = () => {
    if (drag && drag.moved < 6) onOpen(byId(drag.id));
    setDrag(null);
  };

  return (
    <div
      ref={box}
      className="relative touch-none overflow-hidden select-none"
      style={{ height: top + rows * rowH + 20, background: "linear-gradient(180deg, var(--surface-2), var(--sunken))" }}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {/* toolbar */}
      <div className="absolute inset-x-0 top-0 flex flex-wrap items-center justify-center gap-2 px-4 pt-5">
        <span className="caps mr-1 text-ink-3">drag to rearrange · or</span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => doSort(s.key)}
            className={`cursor-pointer rounded-full border px-3 py-1 text-[12.5px] transition-colors ${sort === s.key ? "border-ink bg-ink text-bg" : "border-rule-strong bg-surface text-ink-2 hover:border-ink-3"}`}
          >
            {s.label}
          </button>
        ))}
        <button onClick={shuffle} aria-label="Shuffle" className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-rule-strong bg-surface px-3 py-1 text-[12.5px] text-ink-2 hover:border-ink-3">
          <Shuffle className="size-3.5" /> Shuffle
        </button>
      </div>

      {/* the planks */}
      {w > 0 && Array.from({ length: rows }, (_, r) => (
        <div key={r} aria-hidden className="absolute" style={{ left: left0 - 18, width: rowW + 36, top: top + r * rowH + cw * 1.5 + 2 }}>
          <div className="h-[12px] rounded-[2px] bg-surface shadow-[inset_0_1px_0_rgb(255_255_255/0.25),inset_0_-2px_0_rgb(0_0_0/0.12),0_16px_22px_-12px_rgb(0_0_0/0.45)] ring-1 ring-rule-strong" />
        </div>
      ))}

      {/* the games */}
      {w > 0 && order.map((id, i) => {
        if (id === HOLE) {
          const p = at(i);
          return <div key="hole" ref={slotRef} className="absolute rounded-[8px] border-2 border-dashed border-rule-strong" style={{ left: p.x, top: p.y, width: cw, aspectRatio: "2 / 3" }} />;
        }
        const g = byId(id);
        const dragging = drag?.id === id;
        const p = dragging ? { x: drag.x, y: drag.y } : at(i);
        const note = sort === "size" ? bytes(g.sizeBytes) : sort === "played" ? ago(g.lastPlayed) : null;
        return (
          <div
            key={id}
            onPointerDown={down(id)}
            title={g.title}
            className="absolute cursor-grab active:cursor-grabbing"
            style={{
              left: p.x,
              top: p.y,
              width: cw,
              zIndex: dragging ? 20 : 1,
              transform: dragging ? "rotate(-4deg) scale(1.08)" : "none",
              transition: dragging ? "transform .15s" : "left .45s cubic-bezier(.2,.8,.2,1), top .45s cubic-bezier(.2,.8,.2,1), transform .2s",
            }}
          >
            <Cover title={g.title} url={g.coverUrl} bare className={`rounded-[7px] ring-1 ring-black/10 ${dragging ? "shadow-[0_24px_40px_-14px_rgb(0_0_0/0.6)]" : "shadow-[0_10px_18px_-10px_rgb(0_0_0/0.5)]"}`} />
            {note && (
              <div className={`typed mt-[18px] truncate text-center text-[10.5px] ${sort === "played" && isOverdue(g) ? "text-u-red" : "text-ink-3"}`}>{note}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
