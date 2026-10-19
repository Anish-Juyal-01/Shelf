import { sourceName } from "../lib/format";
import { useEffect, useRef, useState, type Ref } from "react";
import type { GameView } from "../bridge/protocol";
import { Cover } from "./Cover";
import { SkyBackdrop, SkyFront } from "./Sky";

/** Fill the ring with at least <min> cards (repeating a small library) so it never looks gappy. */
function fill(games: GameView[], min: number): GameView[] {
  if (games.length === 0) return [];
  const out: GameView[] = [];
  while (out.length < min) out.push(...games);
  return out.slice(0, Math.max(min, games.length));
}

/**
 * Hero 1 · The wheel. Covers ride a slowly turning wheel whose centre is below the frame, so only its upper arc
 * rises out of the clouds — like a Ferris wheel at sunset. Tilted back a little in 3D; pauses when hovered.
 */
export function WheelHero({ games, onOpen, running = true, gap = false, slotRef }: {
  games: GameView[];
  onOpen(id: number): void;
  /** False holds the wheel still (the website keeps it still until a card lands in it). */
  running?: boolean;
  /** Leave the top slot (the first game) empty. */
  gap?: boolean;
  /** The top slot's card, for lining something up with it. */
  slotRef?: Ref<HTMLDivElement>;
}) {
  const R = 900;
  // Enough cards to go all the way round without gaps (repeats a small library).
  const cards = fill(games.slice(0, 44), Math.round((2 * Math.PI * R) / 132));
  const n = cards.length;
  const cardW = 116;
  return (
    <div className="absolute inset-0" style={{ perspective: 1600, perspectiveOrigin: "50% 100%" }}>
      <SkyBackdrop />
      <style>{`
        @keyframes shelf-wheel { from { transform: rotateX(16deg) rotateZ(0deg) } to { transform: rotateX(16deg) rotateZ(-360deg) } }
        .shelf-wheel:hover { animation-play-state: paused }
        .shelf-wheel-card:hover > div { transform: translateY(-14px) scale(1.06) }
      `}</style>
      <div
        className="shelf-wheel absolute left-1/2"
        style={{
          width: 0,
          height: 0,
          // Arch peaks ~40px below the top edge; the lower part sinks into the front clouds.
          top: R + cardW * 0.75 + 40,
          transformStyle: "preserve-3d",
          animation: "shelf-wheel 240s linear infinite",
          animationPlayState: running ? undefined : "paused",
        }}
      >
        {cards.map((g, i) => (
          <button
            key={`${g.id}-${i}`}
            onClick={() => onOpen(g.id)}
            title={g.title}
            aria-label={`${g.title}, open details`}
            className="shelf-wheel-card absolute cursor-pointer"
            style={{
              width: cardW,
              left: -cardW / 2,
              top: -cardW * 0.75,
              transform: `rotate(${(360 / n) * i}deg) translateY(-${R}px)`,
              transformOrigin: "50% 50%",
              visibility: gap && i === 0 ? "hidden" : undefined,
            }}
          >
            <div ref={i === 0 ? slotRef : undefined} className="transition-transform duration-300 ease-out">
              <Cover title={g.title} url={g.coverUrl} iconUrl={g.iconUrl} meta={sourceName[g.sources[0]]} className="rounded-[9px] ring-1 ring-black/10" />
            </div>
          </button>
        ))}
      </div>
      <SkyFront />
    </div>
  );
}

/**
 * Hero 2 · The ring. On load the covers sit in a small tilted ring far away; the camera then drops inside and it
 * opens into a panoramic carousel around you. Drag to spin; it drifts slowly on its own.
 */
export function RingHero({ games, onOpen }: { games: GameView[]; onOpen(id: number): void }) {
  // Only repeat games when there are too few to make a ring (a repeat right next to itself looks like a bug).
  const cards = fill(games.slice(0, 28), games.length >= 12 ? 0 : 18);
  const n = cards.length;
  const cardW = 150;
  const R = Math.max(520, (n * (cardW + 26)) / (2 * Math.PI));
  const ring = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const angle = useRef(0);
  const drag = useRef<{ x: number; a: number; moved: boolean } | null>(null);
  const [intro, setIntro] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = (t: number) => {
      const p = reduced ? 1 : Math.min(1, (t - start) / 2200);
      const e = 1 - Math.pow(1 - p, 3);
      setIntro(e);
      if (!drag.current && !reduced) angle.current -= 0.035;
      for (let i = 0; i < n; i++) {
        const el = items.current[i];
        if (!el) continue;
        const a = (((360 / n) * i + angle.current) % 360 + 540) % 360 - 180;
        // Cards behind the camera are hidden instead of being drawn mirrored.
        el.style.visibility = Math.abs(a) < 95 || e < 0.6 ? "visible" : "hidden";
        el.style.transform = `rotateY(${a}deg) translateZ(-${R}px)`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [n, R]);

  // Outside & tilted & far away → inside the ring at eye level.
  const z = -2600 * (1 - intro) + R * 0.92 * intro;
  const tilt = 62 * (1 - intro) + 3 * intro;
  const scale = 0.55 + 0.45 * intro;

  return (
    <div
      className="absolute inset-0 cursor-grab active:cursor-grabbing"
      style={{ perspective: 820 }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, a: angle.current, moved: false };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.x;
        if (Math.abs(dx) > 4) drag.current.moved = true;
        angle.current = drag.current.a + dx * 0.12;
      }}
      onPointerUp={() => setTimeout(() => (drag.current = null), 0)}
    >
      <SkyBackdrop />
      <div
        ref={ring}
        className="absolute top-[40%] left-1/2"
        style={{ width: 0, height: 0, transformStyle: "preserve-3d", transform: `translateZ(${z}px) rotateX(${tilt}deg) scale(${scale})` }}
      >
        {cards.map((g, i) => (
          <button
            key={`${g.id}-${i}`}
            ref={(el) => {
              items.current[i] = el;
            }}
            onClick={() => {
              if (!drag.current?.moved) onOpen(g.id);
            }}
            title={g.title}
            aria-label={`${g.title}, open details`}
            className="absolute cursor-pointer"
            style={{ width: cardW, left: -cardW / 2, top: -cardW * 0.75, backfaceVisibility: "hidden" }}
          >
            <Cover title={g.title} url={g.coverUrl} iconUrl={g.iconUrl} meta={sourceName[g.sources[0]]} className="rounded-[10px] ring-1 ring-black/10" />
          </button>
        ))}
      </div>
      <SkyFront />
    </div>
  );
}
