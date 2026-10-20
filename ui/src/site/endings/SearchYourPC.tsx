import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GameView } from "../../bridge/protocol";
import { Cover } from "../../components/Cover";
import { bytes, sourceName } from "../../lib/format";
import { isOverdue, normalize } from "../../lib/library";
import { ago, installPath, type EndingProps } from "./shared";

// Search your PC: the covers float loose around a search box. Type, or pick a filter, and the matches fly into a row
// under it with where each one lives, its size and when you last played. That's what Shelf is for: finding the game
// you forgot you had.

/** How many results fit in a row, and how wide each slot is (% of the box): fewer, wider ones on a phone. */
const layout = () => (window.innerWidth < 640 ? { max: 3, slot: 31 } : { max: 6, slot: 13.5 });

type Filter = { label: string; test(g: GameView): boolean };
const FILTERS: Filter[] = [
  { label: "not played in 90 days", test: (g) => isOverdue(g) },
  { label: "over 50 GB", test: (g) => g.sizeBytes > 50 * 1024 ** 3 },
  { label: "loose folders", test: (g) => g.sources[0] === "folder" || g.sources[0] === "itch" },
];

/** A loose scatter around the edges, the same every time for a game. */
function spot(i: number, n: number) {
  const a = (i / n) * Math.PI * 2 + 0.4;
  const rx = 40 + ((i * 37) % 7), ry = 34 + ((i * 53) % 9);
  return { x: 50 + Math.cos(a) * rx, y: 50 + Math.sin(a) * ry, tilt: ((i * 47) % 24) - 12 };
}

export function SearchYourPC({ games, faller, landed, slotRef, onOpen }: EndingProps) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<number | null>(null);
  const typed = useRef(false);
  const list = useMemo(() => (landed ? games : games.filter((g) => g.id !== faller.id)), [games, faller, landed]);
  const all = games; // stable positions: index in the full list

  // When the newcomer arrives, Shelf types its name to show it was found.
  useEffect(() => {
    if (!landed || typed.current) return;
    const word = faller.title.split(/[:\s]/)[0];
    let k = 0;
    const t = window.setInterval(() => {
      k++;
      setQ(word.slice(0, k));
      if (k >= word.length) {
        typed.current = true;
        clearInterval(t);
      }
    }, 90);
    return () => clearInterval(t);
  }, [landed, faller]);

  const nq = normalize(q.trim());
  const searching = nq !== "" || filter !== null;
  const matches = searching
    ? list.filter((g) => (nq === "" || normalize(g.title).includes(nq)) && (filter === null || FILTERS[filter].test(g)))
    : [];
  const { max: MAX, slot } = layout();
  const shown = matches.slice(0, MAX);
  const pos = (g: GameView) => {
    const r = shown.indexOf(g);
    if (r >= 0) {
      const n = shown.length, w = slot;
      return { x: 50 + (r - (n - 1) / 2) * w, y: 66, tilt: 0, big: true };
    }
    const s = spot(all.indexOf(g), all.length);
    return { ...s, big: false };
  };

  return (
    <div className="relative h-[min(600px,70svh)] overflow-hidden bg-surface-2 select-none" style={{ backgroundImage: "radial-gradient(color-mix(in oklab, var(--ink) 10%, transparent) 1px, transparent 1.2px)", backgroundSize: "22px 22px" }}>
      {/* the covers */}
      {all.map((g) => {
        const here = list.includes(g);
        const p = pos(g);
        const dim = searching && !shown.includes(g);
        return (
          <button
            key={g.id}
            onClick={() => onOpen(g)}
            title={g.title}
            className="absolute cursor-pointer"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.big ? 104 : 74,
              transform: `translate(-50%, -50%) rotate(${p.tilt}deg)`,
              opacity: here ? (dim ? 0.14 : 1) : 0,
              filter: dim ? "grayscale(.8)" : "none",
              transition: "left .7s cubic-bezier(.2,.8,.2,1), top .7s cubic-bezier(.2,.8,.2,1), width .7s, transform .7s, opacity .4s, filter .4s",
              zIndex: p.big ? 5 : 1,
            }}
          >
            <div style={{ animation: p.big ? undefined : `site-float ${5 + (g.id % 4)}s ease-in-out ${(g.id % 5) * 0.4}s infinite alternate` }}>
              <Cover title={g.title} url={g.coverUrl} bare className="rounded-[8px] shadow-[0_14px_26px_-12px_rgb(0_0_0/0.55)] ring-1 ring-black/10 transition-transform hover:scale-105" />
            </div>
          </button>
        );
      })}
      {/* where the falling game lands (one of the floating spots) */}
      {!landed && (() => {
        const s = spot(all.indexOf(faller), all.length);
        return <div ref={slotRef} className="absolute" style={{ left: `${s.x}%`, top: `${s.y}%`, width: 74, aspectRatio: "2 / 3", transform: "translate(-50%, -50%)" }} />;
      })()}

      {/* the search box */}
      <div className="absolute top-[30%] left-1/2 z-10 w-[min(520px,86%)] -translate-x-1/2 -translate-y-1/2">
        <label className="flex h-14 items-center gap-3 rounded-full border border-rule-strong bg-surface px-5 shadow-[0_18px_40px_-20px_rgb(0_0_0/0.45)] focus-within:border-ink-3">
          <Search className="size-5 text-ink-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your games — try a name"
            aria-label="Search games"
            className="h-full flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-4"
          />
          {searching && (
            <button onClick={() => { setQ(""); setFilter(null); }} aria-label="Clear" className="cursor-pointer rounded-full p-1 text-ink-3 hover:bg-sunken hover:text-ink">
              <X className="size-4" />
            </button>
          )}
        </label>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {FILTERS.map((f, i) => (
            <button
              key={f.label}
              onClick={() => setFilter(filter === i ? null : i)}
              className={`cursor-pointer rounded-full border px-3 py-1 text-[12.5px] transition-colors ${filter === i ? "border-ink bg-ink text-bg" : "border-rule-strong bg-surface text-ink-2 hover:border-ink-3"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* the results' details */}
      {shown.map((g, r) => {
        const n = shown.length;
        return (
          <div key={g.id} className="absolute z-10 -translate-x-1/2 text-center" style={{ width: `${slot - 1}%`, left: `${50 + (r - (n - 1) / 2) * slot}%`, top: "calc(66% + 82px)" }}>
            <div className="truncate text-[12.5px] font-medium text-ink">{g.title}</div>
            <div className="typed truncate text-[10.5px] text-ink-3">{sourceName[g.sources[0]]} · {bytes(g.sizeBytes)}</div>
            <div className={`typed truncate text-[10.5px] ${isOverdue(g) ? "text-u-red" : "text-ink-3"}`}>{ago(g.lastPlayed)}</div>
            <div className="typed truncate text-[9.5px] text-ink-4" title={installPath(g)}>{installPath(g)}</div>
          </div>
        );
      })}
      {searching && (
        <div className="typed absolute bottom-3 left-1/2 z-10 -translate-x-1/2 text-[12px] text-ink-3">
          {matches.length === 0 ? "No games match — Shelf would keep watching for it." : matches.length > MAX ? `${matches.length} games · showing ${MAX}` : `${matches.length} game${matches.length === 1 ? "" : "s"}`}
        </div>
      )}
    </div>
  );
}
