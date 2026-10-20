import { useState } from "react";
import type { GameView } from "../bridge/protocol";
import { Cover } from "../components/Cover";

// The pieces that give the journey some ground to travel over: a strip of covers sliding by, a huge outlined
// number at each stop, a few covers floating at the edges, and a band of plain numbers before the end.

/** Two rows of covers drifting in opposite directions. */
export function CoverStrip({ games }: { games: GameView[] }) {
  const rows = [games.filter((_, i) => i % 2 === 0), games.filter((_, i) => i % 2 === 1)];
  return (
    <section className="relative py-10" aria-label="Some of the games Shelf finds">
      <p className="caps mb-6 text-center text-ink-3">Reads 12 launchers — and any folder you point it at</p>
      <div className="group space-y-4 [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
        {rows.map((row, r) => (
          <div key={r} className="flex w-max gap-4 group-hover:[animation-play-state:paused]" style={{ animation: `site-strip ${70 + r * 12}s linear infinite`, animationDirection: r ? "reverse" : "normal" }}>
            {[...row, ...row, ...row, ...row].map((g, i) => (
              <div key={i} className="w-[92px] flex-none transition-transform duration-300 hover:-translate-y-2 hover:scale-105 sm:w-[112px]" title={g.title}>
                <Cover title={g.title} url={g.coverUrl} bare className="rounded-[8px] ring-1 ring-black/10" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/** The stop's number, huge and outlined, behind the path. */
export function Numeral({ n, side }: { n: number; side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      className="font-display pointer-events-none absolute top-1/2 -translate-y-1/2 leading-none select-none max-lg:hidden"
      style={{
        [side === "right" ? "left" : "right"]: side === "right" ? "50%" : "52%",
        fontSize: "clamp(260px, 30vw, 460px)",
        color: "transparent",
        WebkitTextStroke: "1.5px var(--rule-strong)",
        letterSpacing: "-0.04em",
      }}
    >
      {String(n).padStart(2, "0")}
    </span>
  );
}

/** A few covers floating near the outer edge on the path's side of a stop. */
export function Drift({ games, seed, side }: { games: GameView[]; seed: number; side: "left" | "right" }) {
  const spots = [
    { top: "10%", edge: "1%", w: 84, rot: -8 },
    { top: "58%", edge: "6%", w: 68, rot: 6 },
    { top: "80%", edge: "-1%", w: 76, rot: -3 },
  ];
  return (
    <div aria-hidden className="pointer-events-none max-lg:hidden">
      {spots.map((s, k) => {
        const g = games[(seed * 3 + k + 2) % games.length];
        return (
          <div
            key={k}
            className="absolute"
            style={{ top: s.top, [side]: s.edge, width: s.w, transform: `rotate(${s.rot}deg)`, animation: `site-float ${6 + k}s ease-in-out ${k * 0.8}s infinite alternate` }}
          >
            <Cover title={g.title} url={g.coverUrl} bare className="rounded-[7px] opacity-90 shadow-[0_18px_30px_-14px_rgb(0_0_0/0.45)] ring-1 ring-black/10" />
          </div>
        );
      })}
    </div>
  );
}

const NUMBERS: [string, string, string][] = [
  ["12", "launchers read, plus any folder", "Steam, Epic, GOG, EA, Ubisoft, Rockstar, Battle.net, Riot, Xbox, itch, Amazon and HoYoPlay."],
  ["0", "sign-ins or accounts", "It reads the launchers' own files on your disk. Your passwords never come near it."],
  ["<0.1%", "CPU while it watches", "It checks what's running every five seconds. Measured on a real gaming PC."],
  ["0", "files it will ever delete", "Uninstall always goes through the game's own launcher, or through you."],
];

export function Numbers() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="relative mx-auto max-w-[1480px] px-4 pt-[8svh] sm:px-8 lg:px-14">
      <div className="grid grid-cols-2 border-y border-rule bg-bg/80 backdrop-blur-[2px] lg:grid-cols-4">
        {NUMBERS.map(([n, label, more], i) => (
          <button
            key={label}
            onMouseEnter={() => setOpen(i)}
            onMouseLeave={() => setOpen(null)}
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
            className={`cursor-default border-rule px-5 py-8 text-left transition-colors hover:bg-surface ${i % 2 ? "border-l" : ""} ${i === 2 ? "max-lg:border-t lg:border-l" : ""} ${i === 3 ? "max-lg:border-t" : ""}`}
          >
            <span className={`font-display block text-[clamp(52px,6vw,96px)] leading-none transition-colors ${open === i ? "text-u-red" : ""}`}>{n}</span>
            <span className="mt-3 block min-h-[3.2em] text-[14px] text-ink-3">{open === i ? <span className="text-ink-2">{more}</span> : label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
