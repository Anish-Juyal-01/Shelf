import { ArrowDown } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameView } from "../bridge/protocol";
import { Cover } from "../components/Cover";
import { WheelHero } from "../components/Heroes";
import { sourceName } from "../lib/format";

// The website's opening. The hero is pinned while you scroll: a shelf of games sits above the sky, the wheel below
// is still, with one empty slot at the top of its arc. Scrolling tips the newest game off the end of the shelf; it
// falls, turns and drops into that slot — and the moment it lands, the wheel starts to turn. The fall is scrubbed by
// the scroll (scroll back and it climbs back up); once it has landed it stays in the wheel.

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Where the scroll is through the pinned stretch, 0–1. */
function useScrollProgress(section: React.RefObject<HTMLElement | null>, onFrame: (p: number) => void) {
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = 0;
      const el = section.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const run = el.offsetHeight - window.innerHeight;
      onFrame(run > 0 ? clamp(-r.top / run) : 1);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    kick();
    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", kick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", kick);
      window.removeEventListener("resize", kick);
    };
  }, [section, onFrame]);
}

export function ShelfHero({ games, faller, children }: { games: GameView[]; faller: GameView; children: ReactNode }) {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const home = useRef<HTMLDivElement>(null); // the falling card's place on the shelf
  const slot = useRef<HTMLDivElement>(null); // its place in the wheel
  const card = useRef<HTMLDivElement>(null); // the card in flight
  const tag = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const reduced = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const [landed, setLanded] = useState(reduced);

  const wheelGames = useMemo(() => [faller, ...games.filter((g) => g.id !== faller.id)], [games, faller]);
  const others = useMemo(() => games.filter((g) => g.id !== faller.id), [games, faller]);

  const frame = useMemo(
    () => (p: number) => {
      const s = stage.current?.getBoundingClientRect();
      const a = home.current?.getBoundingClientRect();
      const b = slot.current?.getBoundingClientRect();
      const el = card.current;
      if (!s || !a || !b || !el) return;
      if (hint.current) hint.current.style.opacity = String(1 - seg(p, 0.02, 0.12));
      if (tag.current) tag.current.style.opacity = String(1 - seg(p, 0.06, 0.16));

      // 1 · tip: the card leans out over the end of the shelf, pivoting on its bottom-right corner.
      // 2 · fall: it drops (gravity on the way down), drifts across, turns, and grows to the wheel's card size.
      // 3 · land: a little overshoot into the slot, then it's part of the wheel.
      const tip = easeInOut(seg(p, 0.04, 0.22));
      const fall = seg(p, 0.22, 0.86);
      const settle = seg(p, 0.86, 0.96);

      const w = lerp(a.width, b.width, easeInOut(fall));
      const h = w * 1.5;
      // Start (top-left, relative to the stage) and end positions.
      const ax = a.left - s.left, ay = a.top - s.top;
      const bx = b.left - s.left + b.width / 2 - w / 2, by = b.top - s.top + b.height / 2 - h / 2;

      // Tipping about the bottom-right corner = rotating about the centre, then shifting the centre round the pivot.
      const theta = (tip * 32 * Math.PI) / 180;
      const vx = -a.width / 2, vy = -a.height / 2; // centre relative to the pivot
      const tipDx = vx * Math.cos(theta) - vy * Math.sin(theta) - vx + tip * a.width * 0.35;
      const tipDy = vx * Math.sin(theta) + vy * Math.cos(theta) - vy;

      // Drop clear of the shelf first, then drift across to the slot.
      const fx = easeInOut(fall ** 1.6), fy = 1 - (1 - fall) ** 1.4;
      const x = lerp(ax + tipDx, bx, fx);
      const y = lerp(ay + tipDy, by, fy) + Math.sin(settle * Math.PI) * 10;
      const rot = lerp(32 * tip, 0, easeInOut(fall)) - Math.sin(fall * Math.PI) * 26;

      el.style.width = `${w}px`;
      el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
      el.style.opacity = "1";
      if (p >= 0.96) setLanded(true);
    },
    [],
  );
  useScrollProgress(section, frame);

  // Before the first scroll frame, park the card on its shelf spot (no flash at 0,0).
  useLayoutEffect(() => frame(0), [frame]);

  return (
    <section ref={section} className="relative" style={{ height: reduced ? undefined : "250vh" }}>
      <div ref={stage} className="sticky top-16 flex h-[calc(100svh-64px)] min-h-[620px] flex-col">
        <div className="mx-auto grid w-full max-w-[1240px] flex-none items-center gap-x-14 gap-y-6 px-4 pt-6 pb-5 sm:px-8 lg:grid-cols-[1fr_auto] lg:px-10 lg:pt-8 lg:pb-7">
          <div>{children}</div>

          {/* the bookcase: two shelves; the new game stands at the end of the lower one */}
          <div className="relative justify-self-end max-lg:w-full">
            <div className="max-lg:hidden">
              <Row games={others.slice(0, 6)} lean={3} />
              <Plank />
            </div>
            <div className="lg:mt-5">
              <Row games={others.slice(6, 11)} lean={1}>
                <div ref={home} className="invisible w-[70px] flex-none lg:w-[92px]" style={{ aspectRatio: "2 / 3" }} />
              </Row>
              <Plank />
            </div>
            <div ref={tag} className="typed absolute right-0 rounded-full bg-u-yellow px-2.5 py-0.5 text-[11px] text-[#151413] max-lg:-top-6 lg:top-[calc(50%-14px)]">
              new · found in Downloads
            </div>
          </div>
        </div>

        {/* the sky, with the wheel holding a slot open */}
        <div className="relative min-h-0 flex-1 px-2 pb-3 sm:px-5 sm:pb-5">
          <div className="relative mx-auto h-full max-w-[1600px] overflow-hidden rounded-[22px] ring-1 ring-black/5">
            <WheelHero games={wheelGames} onOpen={() => {}} running={landed} gap={!landed} slotRef={slot} />
            <div ref={hint} className="caps absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/25 px-3 py-1.5 text-white backdrop-blur-sm">
              <ArrowDown className="size-3.5" /> scroll
            </div>
          </div>
        </div>

        {/* the card in flight (above everything; hidden once it's in the wheel) */}
        {!landed && (
          <div ref={card} className="pointer-events-none absolute top-0 left-0 z-20 opacity-0 will-change-transform" style={{ width: 92 }}>
            <Cover title={faller.title} url={faller.coverUrl} iconUrl={faller.iconUrl} meta={sourceName[faller.sources[0]]} className="rounded-[9px] shadow-[0_18px_40px_-12px_rgb(0_0_0/0.55)] ring-1 ring-black/10" />
          </div>
        )}
      </div>
    </section>
  );
}

/** One shelf's worth of games standing side by side; one leans on its neighbour. */
function Row({ games, lean, children }: { games: GameView[]; lean: number; children?: ReactNode }) {
  return (
    <div className="flex items-end justify-end gap-[7px] px-3">
      {games.map((g, i) => (
        <div
          key={g.id}
          className={`w-[52px] origin-bottom-left lg:w-[84px] ${i < games.length - 4 ? "max-sm:hidden" : ""}`}
          style={{ transform: i === lean ? "rotate(-7deg) translateX(6px)" : undefined, zIndex: i === lean ? 0 : 1 }}
        >
          <Cover title={g.title} url={g.coverUrl} iconUrl={g.iconUrl} bare className="rounded-[7px] ring-1 ring-black/10" />
        </div>
      ))}
      {children}
    </div>
  );
}

/** A plain painted plank with two small brackets. */
function Plank() {
  return (
    <div className="relative">
      <div className="h-[12px] rounded-[2px] bg-surface-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.25),inset_0_-2px_0_rgb(0_0_0/0.12),0_16px_22px_-12px_rgb(0_0_0/0.45)] ring-1 ring-rule-strong" />
      {[10, 86].map((x) => (
        <div key={x} className="absolute top-[12px] h-5 w-[3px] rounded-b-[2px] bg-rule-strong" style={{ left: `${x}%` }} />
      ))}
    </div>
  );
}
