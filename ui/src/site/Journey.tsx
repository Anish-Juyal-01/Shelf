import { ArrowDown, Download } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameView } from "../bridge/protocol";
import { Cover } from "../components/Cover";
import { ArrangeTheShelf } from "./endings/ArrangeTheShelf";
import { FillTheDrive } from "./endings/FillTheDrive";
import { SearchYourPC } from "./endings/SearchYourPC";
import { bytes, relative, sourceName } from "../lib/format";
import { CoverStrip, Drift, Numbers, Numeral } from "./Decor";
import { VIGNETTES } from "./Vignettes";

// The website is one journey. The newest game sits at the end of a bookcase; as you scroll it leaves the shelf and
// travels down a dotted path, holding its place on screen while the page moves under it. The path passes a few
// X marks — each one says what Shelf does, and gets circled as the book reaches it — and ends in the sky, where the
// book drops into the wheel's empty slot and the wheel starts to turn.
//
// The path is measured from the page itself (shelf spot → each X → the wheel slot), so it always lines up.

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

type Pt = { x: number; y: number };

const STOPS: { title: string; body: string; side: "left" | "right" }[] = [
  {
    title: "It reads your launchers.",
    body: "Steam, Epic, GOG, EA, Ubisoft, Rockstar, Battle.net, Riot, Xbox, itch, Amazon and HoYoPlay — straight from their files on your disk. No logins.",
    side: "right",
  },
  {
    title: "It walks your folders.",
    body: "The ones it suggests, or a whole drive when you ask. It spots game engines and real executables, and scores every folder out of 100.",
    side: "left",
  },
  {
    title: "It catches new downloads.",
    body: "Unzip a game into Downloads and it's on your shelf a minute later. Anything it isn't sure about waits for your yes.",
    side: "right",
  },
  {
    title: "It counts your hours.",
    body: "From any launcher or a desktop shortcut, sleep and crashes included. Steam's hours come across on day one. It costs under 0.1% CPU.",
    side: "left",
  },
  {
    title: "It shows what's eating your drive.",
    body: "Games untouched for 90 days, second copies, leftover installers. Uninstall opens the game's own launcher — Shelf never deletes a thing.",
    side: "right",
  },
];

/** A smooth curve through the points (Catmull-Rom as cubic Béziers). */
function curve(p: Pt[]): string {
  let d = `M${p[0].x},${p[0].y}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] ?? p[i], b = p[i], c = p[i + 1], e = p[i + 2] ?? c;
    const c1 = { x: b.x + (c.x - a.x) / 6, y: b.y + (c.y - a.y) / 6 };
    const c2 = { x: c.x - (e.x - b.x) / 6, y: c.y - (e.y - b.y) / 6 };
    d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${c.x},${c.y}`;
  }
  return d;
}

interface Geometry {
  total: number;
  step: number;
  xs: Float32Array;
  ys: Float32Array; // running max, so the lookup by height is monotonic
  crossAt: number[]; // path length at each X
  homeW: number;
  slotW: number;
  hy: number;
}

export function Journey({ games, faller, line, download, github }: { games: GameView[]; faller: GameView; line: ReactNode; download: string; github: string }) {
  const box = useRef<HTMLDivElement>(null);
  const home = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const crosses = useRef<(HTMLDivElement | null)[]>([]);
  const card = useRef<HTMLDivElement>(null);
  const trail = useRef<SVGPathElement>(null);
  const walked = useRef<SVGPathElement>(null);
  const geo = useRef<Geometry | null>(null);
  const reduced = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const [landed, setLanded] = useState(reduced);
  const [picked, setPicked] = useState<GameView | null>(null);
  const [ending, setEnding] = useState(0);
  const [reached, setReached] = useState(reduced ? STOPS.length : 0);
  const [path, setPath] = useState<{ d: string; w: number; h: number } | null>(null);
  const landedRef = useRef(landed);
  landedRef.current = landed;

  const others = useMemo(() => games.filter((g) => g.id !== faller.id), [games, faller]);

  // Lay the path through the shelf spot, every X and the wheel slot.
  const measure = useCallback(() => {
    if (landedRef.current || !box.current || !home.current || !slot.current) return;
    const c = box.current.getBoundingClientRect();
    const at = (el: Element): Pt => {
      const r = el.getBoundingClientRect();
      return { x: r.left - c.left + r.width / 2, y: r.top - c.top + r.height / 2 };
    };
    const pts = [at(home.current), ...crosses.current.filter(Boolean).map((el) => at(el!)), at(slot.current)];
    setPath({ d: curve(pts), w: c.width, h: box.current.offsetHeight });
  }, []);

  // Sample the measured path once so each scroll frame is a cheap lookup.
  useLayoutEffect(() => {
    const el = trail.current;
    if (!path || !el || !home.current || !slot.current || !box.current) return;
    const total = el.getTotalLength();
    const step = 3;
    const n = Math.ceil(total / step) + 1;
    const xs = new Float32Array(n), ys = new Float32Array(n);
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = el.getPointAtLength(Math.min(total, i * step));
      xs[i] = p.x;
      max = Math.max(max, p.y);
      ys[i] = max;
    }
    const c = box.current.getBoundingClientRect();
    const crossAt = crosses.current.map((x) => {
      if (!x) return Infinity;
      const r = x.getBoundingClientRect();
      const y = r.top - c.top + r.height / 2;
      return lookup(ys, y) * step;
    });
    const h = home.current.getBoundingClientRect();
    geo.current = { total, step, xs, ys, crossAt, homeW: h.width, slotW: slot.current.getBoundingClientRect().width, hy: h.top - c.top + h.height / 2 };
    frame();
  }, [path]);

  // Each frame: the book's height on the page follows the scroll, so it holds its place on screen; its x comes from the path.
  const frame = useCallback(() => {
    const g = geo.current, el = card.current;
    if (!g || !el || landedRef.current) return;
    const target = g.hy + window.scrollY;
    const i = lookup(g.ys, target);
    const L = Math.min(g.total, i * g.step);
    const x = g.xs[i], y = g.ys[i];
    // Lean into the direction of travel; straighten up for the landing.
    const j = Math.min(g.xs.length - 1, i + 6), k = Math.max(0, i - 6);
    const lean = clamp((-Math.atan2(g.xs[j] - g.xs[k], g.ys[j] - g.ys[k] || 1) * 180) / Math.PI * 0.7, -28, 28);
    const end = clamp((L - (g.total - 220)) / 220);
    const w = lerp(g.homeW, g.slotW, easeInOut(end));
    const rot = L < 2 ? 0 : lean * (1 - end);
    el.style.width = `${w}px`;
    el.style.transform = `translate(${x - w / 2}px, ${y - w * 0.75}px) rotate(${rot}deg)`;
    el.style.opacity = "1";
    walked.current?.setAttribute("stroke-dasharray", `${L} ${g.total + 10}`);
    const r = g.crossAt.filter((c) => L >= c - 6).length;
    setReached((prev) => (prev === r ? prev : r));
    if (L >= g.total - 1) setLanded(true);
  }, []);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), frame()));
    };
    const ro = new ResizeObserver(() => measure());
    if (box.current) ro.observe(box.current);
    document.fonts?.ready.then(measure);
    const t = window.setTimeout(measure, 600);
    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", measure);
    measure();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener("scroll", kick);
      window.removeEventListener("resize", measure);
    };
  }, [measure, frame, reduced]);

  return (
    <div ref={box} className="journey relative overflow-x-clip">
      {/* the dotted path, and the stretch already walked drawn solid over it */}
      {path && !reduced && (
        <svg aria-hidden className="pointer-events-none absolute top-0 left-0 overflow-visible" width={path.w} height={path.h}>
          <path ref={trail} d={path.d} fill="none" stroke="var(--ink-4)" strokeWidth={2.5} strokeLinecap="round" strokeDasharray="0.1 11" />
          {/* the walked stretch: the same dots in red, revealed by a mask that grows with the book */}
          <mask id="walked">
            <path ref={walked} d={path.d} fill="none" stroke="white" strokeWidth={14} strokeDasharray={landed ? "none" : "0 99999"} />
          </mask>
          <path d={path.d} fill="none" stroke="var(--u-red)" strokeWidth={4} strokeLinecap="round" strokeDasharray="0.1 11" mask="url(#walked)" />
        </svg>
      )}

      {/* top: the line that writes itself, and the bookcase */}
      <section className="relative mx-auto grid max-w-[1480px] items-center gap-x-14 gap-y-10 px-4 pt-10 pb-20 lg:pt-[7vh] lg:pb-[16vh] sm:px-8 lg:grid-cols-[1fr_auto] lg:px-14">
        <div className="relative z-10">{line}</div>
        <div className="relative justify-self-end max-lg:w-full">
          <div className="max-lg:hidden">
            <Row games={others.slice(0, 6)} lean={3} />
            <Plank />
          </div>
          <div className="lg:mt-6">
            <Row games={others.slice(6, 11)} lean={1}>
              <div ref={home} className="invisible w-[50px] flex-none sm:w-[70px] lg:w-[92px]" style={{ aspectRatio: "2 / 3" }} />
            </Row>
            <Plank />
          </div>
          <div className="typed mt-6 flex items-center justify-end gap-2 text-[12px] text-ink-3">
            <ArrowDown className="size-3.5" /> scroll — follow the new one, just found in Downloads
          </div>
        </div>
      </section>

      <CoverStrip games={others} />

      {/* the stops */}
      {STOPS.map((s, i) => (
        <section key={s.title} className="relative mx-auto max-w-[1480px] px-4 sm:px-8 lg:px-14">
          <div className="relative flex min-h-[72svh] items-center py-14">
            <Numeral n={i + 1} side={s.side} />
            <Drift games={others} seed={i} side={s.side} />
            <div
              className={`relative z-10 w-full min-w-0 max-w-[460px] max-lg:pr-[17%] ${s.side === "right" ? "lg:mr-auto lg:ml-[4%]" : "lg:mr-[6%] lg:ml-auto"}`}
            >
              <div className="typed text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")} / {String(STOPS.length).padStart(2, "0")}</div>
              <h2 className="font-display mt-2 text-[clamp(38px,4.4vw,70px)] leading-[0.95] text-balance">{s.title}</h2>
              <p className="mt-4 text-[clamp(15.5px,1.2vw,17.5px)] leading-[1.6] text-ink-2">{s.body}</p>
              <Vignette i={i} on={i < reached} faller={faller} games={games} />
            </div>
            <div
              ref={(el) => {
                crosses.current[i] = el;
              }}
              className="absolute top-1/2 size-14 -translate-x-1/2 -translate-y-1/2"
              style={{ left: s.side === "right" ? "var(--x-right)" : "var(--x-left)" }}
            >
              <Cross done={i < reached} />
            </div>
          </div>
        </section>
      ))}

      <Numbers />

      {/* the end of the path: a small interactive Shelf with a spot held open, and the download, in one box */}
      <section className="relative px-2 pt-[8svh] pb-10 sm:px-5 sm:pb-[22svh]">
        <div className="mx-auto max-w-[1320px] overflow-hidden rounded-[28px] bg-surface shadow-[0_2px_4px_rgb(0_0_0/0.04),0_40px_80px_-40px_rgb(0_0_0/0.45)] ring-1 ring-rule-strong">
          {/* three endings to try; the book lands in the first, and the tabs unlock once it has */}
          <div className="flex items-center justify-center gap-0.5 border-b border-rule bg-surface px-2 py-2.5 sm:gap-1 sm:px-3" role="tablist">
            {ENDINGS.map((e, i) => (
              <button
                key={e.name}
                role="tab"
                aria-selected={ending === i}
                disabled={!landed}
                onClick={() => setEnding(i)}
                title={landed ? e.hint : "Scroll on — the new game lands here first"}
                className={`cursor-pointer rounded-full px-3 py-1.5 text-[12.5px] whitespace-nowrap transition-colors sm:px-4 sm:text-[13.5px] disabled:cursor-default ${ending === i ? "bg-ink text-bg" : "text-ink-2 hover:bg-sunken disabled:opacity-40 disabled:hover:bg-transparent"}`}
              >
                {e.name}
              </button>
            ))}
          </div>
          {(() => {
            const E = ENDINGS[ending].C;
            return <E games={games} faller={faller} landed={landed} slotRef={slot} onOpen={setPicked} />;
          })()}
          <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-6 border-t border-rule px-6 py-7 sm:px-10 sm:py-8">
            {picked ? (
              <div className="flex min-w-0 items-center gap-4">
                <div className="w-14 flex-none"><Cover title={picked.title} url={picked.coverUrl} bare className="rounded-[6px]" /></div>
                <div className="min-w-0">
                  <h2 className="font-display truncate text-[clamp(30px,3vw,46px)] leading-[0.95]">{picked.title}</h2>
                  <p className="typed mt-2 text-[12px] text-ink-3">
                    {sourceName[picked.sources[0]]} · {bytes(picked.sizeBytes)} · last played {relative(picked.lastPlayed)}
                    <button onClick={() => setPicked(null)} className="ml-3 cursor-pointer underline-offset-2 hover:text-ink hover:underline">close</button>
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <h2 className="font-display text-[clamp(34px,3.6vw,56px)] leading-[0.95]">{landed ? "On your shelf. Every one." : "Last stop."}</h2>
                <p className="typed mt-3 text-[12px] text-ink-3">Windows 10 &amp; 11 · 4 MB · installs in seconds, no admin · not code-signed yet, so Windows may ask once</p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={github}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-14 items-center rounded-full border border-rule-strong px-6 text-[16px] font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
              >
                View the code
              </a>
              <a
                href={download}
                className="inline-flex h-14 items-center gap-2.5 rounded-full bg-accent px-7 text-[17px] font-medium text-accent-ink shadow-[0_1px_0_rgb(255_255_255/0.15)_inset,0_8px_24px_-10px_rgb(0_0_0/0.5)] transition-[filter] hover:brightness-110"
              >
                <Download className="size-5" strokeWidth={2.2} /> Download for Windows
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* the book in transit */}
      {!landed && (
        <div ref={card} className="pointer-events-none absolute top-0 left-0 z-20 opacity-0 will-change-transform" style={{ width: 92 }}>
          {/* a NEW sticker on the corner; the soft yellow halo only while it's still on the shelf */}
          <span className="caps absolute -top-2.5 -left-2.5 z-10 -rotate-6 rounded-[5px] bg-u-yellow px-1.5 py-0.5 text-[9.5px] font-semibold text-[#151413] shadow-[0_4px_10px_-4px_rgb(0_0_0/0.5)]">
            New
          </span>
          <div className="rounded-[10px] transition-shadow duration-500" style={{ boxShadow: reached ? "none" : "0 0 0 3px var(--u-yellow), 0 0 28px 4px color-mix(in oklab, var(--u-yellow) 45%, transparent)" }}>
            <Cover title={faller.title} url={faller.coverUrl} iconUrl={faller.iconUrl} meta={sourceName[faller.sources[0]]} className="rounded-[9px] shadow-[0_18px_40px_-12px_rgb(0_0_0/0.55)] ring-1 ring-black/10" />
          </div>
        </div>
      )}
    </div>
  );
}

function Vignette({ i, on, faller, games }: { i: number; on: boolean; faller: GameView; games: GameView[] }) {
  const V = VIGNETTES[i];
  return <V on={on} faller={faller} games={games} />;
}

const ENDINGS = [
  { name: "Fill the drive", hint: "Drag games out of your drive to free space", C: FillTheDrive },
  { name: "Search your PC", hint: "Type a game and watch it come forward", C: SearchYourPC },
  { name: "Arrange the shelf", hint: "Drag games around, or sort them", C: ArrangeTheShelf },
];

/** Index of the first sample at or below height y (samples are monotonic in y). */
function lookup(ys: Float32Array, y: number): number {
  let lo = 0, hi = ys.length - 1;
  if (y <= ys[0]) return 0;
  if (y >= ys[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ys[mid] < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** An X marks the spot; once the book has passed, a hand-drawn ring closes round it. */
function Cross({ done }: { done: boolean }) {
  return (
    <svg viewBox="0 0 56 56" className="size-full overflow-visible" aria-hidden>
      <g stroke="var(--u-red)" strokeWidth={4} strokeLinecap="round">
        <path d="M18 17 L38 39" />
        <path d="M38 16 L17 38" />
      </g>
      <path
        d="M28 4 C44 3 53 15 52 29 C51 44 39 53 26 52 C12 51 3 41 4 27 C5 15 14 6 30 5"
        fill="none"
        stroke="var(--ink)"
        strokeWidth={2}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1 1"
        style={{ strokeDashoffset: done ? 0 : 1, transition: "stroke-dashoffset .7s cubic-bezier(.3,.7,.2,1)" }}
      />
    </svg>
  );
}

/** One shelf's worth of games standing side by side; one leans on its neighbour. */
function Row({ games, lean, children }: { games: GameView[]; lean: number; children?: ReactNode }) {
  return (
    <div className="flex items-end justify-end gap-[5px] px-1 sm:gap-[7px] sm:px-3">
      {games.map((g, i) => (
        <div
          key={g.id}
          className={`origin-bottom-left max-sm:min-w-0 max-sm:flex-1 sm:w-[52px] lg:w-[84px] ${i < games.length - 5 ? "max-sm:hidden" : ""}`}
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
