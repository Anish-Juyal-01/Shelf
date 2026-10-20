import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { GameView } from "../bridge/protocol";
import { Cover } from "../components/Cover";
import { bytes } from "../lib/format";

// The strip above the headline: what Shelf's own top bar shows while it runs. The left chip cycles through what it's
// doing (watching, scanning a folder, tracking a game, checking launchers); the right one shows the latest find. They
// change on their own clocks — offset, so never together — and each change rolls the old text up and out while the
// new text rises in from below.

const PLACES = ["Downloads", "Games", "Desktop", "Downloads\\unzipped"];
const LAUNCHERS = ["Steam", "Epic", "GOG", "Xbox", "Battle.net", "Riot", "EA app", "Ubisoft Connect"];

/** A counter that advances every `every` ms, first after `delay` ms. */
function useBeat(every: number, delay: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let iv = 0;
    const t = window.setTimeout(() => {
      setN((x) => x + 1);
      iv = window.setInterval(() => setN((x) => x + 1), every);
    }, delay);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [every, delay]);
  return n;
}

/** Shows `children`; when `k` changes, the previous content rolls up and out while the new one rises in. */
function Roll({ k, children }: { k: number; children: ReactNode }) {
  const [items, setItems] = useState([{ k, node: children }]);
  if (items[items.length - 1].k !== k) setItems((it) => [...it.slice(-1), { k, node: children }]);
  // The box glides to the new text's width (instead of jumping), with the edge softly faded while it moves.
  const latest = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  useLayoutEffect(() => {
    const w = latest.current?.scrollWidth;
    if (!w) return;
    setWidth((old) => {
      if (old !== null && Math.abs(old - w) > 1) setMoving(true);
      return w;
    });
  }, [k]);
  return (
    <span
      className="relative inline-grid overflow-hidden align-middle"
      onTransitionEnd={(e) => e.propertyName === "width" && setMoving(false)}
      style={{
        width: width ?? undefined,
        transition: "width .7s cubic-bezier(.65,0,.35,1)",
        maskImage: moving ? "linear-gradient(90deg, black calc(100% - 28px), transparent)" : undefined,
        WebkitMaskImage: moving ? "linear-gradient(90deg, black calc(100% - 28px), transparent)" : undefined,
      }}
    >
      {items.map((it, i) => {
        const leaving = i < items.length - 1;
        return (
          <span
            key={it.k}
            ref={leaving ? undefined : latest}
            className={`col-start-1 row-start-1 inline-flex w-max items-center gap-2 justify-self-start whitespace-nowrap ${leaving ? "site-roll-out" : items.length > 1 ? "site-roll-in" : ""}`}
            onAnimationEnd={leaving ? () => setItems((x) => x.filter((y) => y.k !== it.k)) : undefined}
          >
            {it.node}
          </span>
        );
      })}
    </span>
  );
}

export function StatusBar({ games }: { games: GameView[] }) {
  const doingTick = useBeat(7000, 3500); // left chip
  const findTick = useBeat(7000, 7000); // right chip, half a beat later

  const found = Math.min(games.length, games.length - 4 + findTick);
  const total = games.slice(0, found).reduce((a, g) => a + g.sizeBytes, 0);
  const latest = games[1 + (findTick % (games.length - 1))];
  const findWhere = `${"DEF"[findTick % 3]}:\\${PLACES[findTick % PLACES.length]}`;
  const scanWhere = `${"DEF"[(doingTick + 1) % 3]}:\\${PLACES[(doingTick + 2) % PLACES.length]}`;
  const playing = games[1 + ((doingTick * 5) % (games.length - 1))];
  const phase = doingTick % 4;

  const doing = [
    <>Watching this PC</>,
    <>Scanning <span className="typed text-[12px]">{scanWhere}</span></>,
    <>Tracking <b className="font-medium text-ink">{playing.title.split(":")[0]}</b> <span className="typed text-[11.5px] text-ink-3">· {12 + ((doingTick * 17) % 50)}m</span></>,
    <>Checking {LAUNCHERS[doingTick % LAUNCHERS.length]}</>,
  ][phase];
  const dot = ["bg-ok", "bg-u-blue", "bg-u-red", "bg-u-yellow"][phase];

  const chip = "inline-flex h-9 items-center gap-2 rounded-full border border-rule-strong bg-surface px-3.5 text-ink-2 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-[width]";
  return (
    <div className="mb-9 flex flex-wrap items-center gap-2.5 text-[13px]" aria-hidden>
      <span className={chip}>
        <span className={`pulse-dot size-2 flex-none rounded-full transition-colors duration-500 ${dot}`} />
        <Roll k={doingTick}>{doing}</Roll>
        <span className="typed text-[11.5px] whitespace-nowrap text-ink-3 tabular-nums">· {found} games · {bytes(total)}</span>
      </span>
      <span className={`${chip} min-w-0 py-1 pl-1.5 max-sm:hidden`}>
        <Roll k={findTick}>
          <span className="w-[18px] flex-none overflow-hidden rounded-[3px]">
            <Cover title={latest.title} url={latest.coverUrl} bare />
          </span>
          <span>
            found <b className="font-medium text-ink">{latest.title}</b>
            <span className="typed text-[11.5px] text-ink-3"> · {findWhere}</span>
          </span>
        </Roll>
      </span>
    </div>
  );
}
