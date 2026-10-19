import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { sampleState } from "../bridge/previewBridge";
import { ShelfHero } from "./ShelfHero";

// The Shelf website: one screen. A line on the left that writes itself, a bookcase on the right, and the sky below.
// Scroll and the newest game falls off the shelf into the wheel, which then starts to turn.

/** Where the Download buttons point. Set this once there's a build to host. */
const DOWNLOAD_URL = "#download";
const GITHUB_URL = "https://github.com/Anish-Juyal-01";

const state = sampleState();

export function Site() {
  const games = useMemo(
    () => state.games.filter((g) => g.installed).sort((a, b) => Date.parse(b.lastPlayed ?? b.firstSeen) - Date.parse(a.lastPlayed ?? a.firstSeen)),
    [],
  );
  // The one that falls: a loose-folder game, exactly the kind Shelf exists to catch.
  const faller = games.find((g) => g.title === "Hollow Knight") ?? games[0];
  return (
    <div className="min-h-screen bg-bg text-ink">
      <Nav />
      <ShelfHero games={games} faller={faller}>
        <h1 className="sr-only">Shelf: every game on your PC, even the ones you forgot.</h1>
        <TypedLine />
      </ShelfHero>
      <footer className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-[13px] text-ink-3 sm:px-8 lg:px-10">
        <span className="font-display text-[22px] text-ink">Shelf<span className="text-u-red">.</span></span>
        <span className="typed text-[12px]">Windows 10 &amp; 11 · works offline · never deletes anything</span>
      </footer>
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-30 bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-3 px-4 sm:px-8 lg:px-10">
        <a href="#" className="font-display text-[30px] leading-none">
          Shelf<span className="text-u-red">.</span>
        </a>
        <span className="flex-1" />
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
          className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-[14.5px] font-medium text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
        >
          <GitHubMark />
          <span className="max-sm:hidden">GitHub</span>
        </a>
        <a
          href={DOWNLOAD_URL}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-[14.5px] font-medium text-accent-ink shadow-[0_1px_0_rgb(255_255_255/0.15)_inset,0_8px_24px_-10px_rgb(0_0_0/0.5)] transition-[filter] hover:brightness-110 sm:px-5"
        >
          <Download className="size-4" strokeWidth={2.2} />
          <span>
            Download<span className="max-sm:hidden"> for Windows</span>
          </span>
        </a>
      </div>
    </header>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-[18px]" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/* ───────────────────────── the line that writes itself ───────────────────────── */

// Each line types out, holds, then backspaces into the next. The underline colour changes with it.
const LINES: { text: string; u: "red" | "blue" | "yellow" }[] = [
  { text: "Every game on your PC.", u: "red" },
  { text: "Even the one you unzipped in March.", u: "blue" },
  { text: "Steam, Epic, Xbox. One shelf.", u: "yellow" },
  { text: "Find what's eating your drive.", u: "red" },
];

function TypedLine() {
  const reduced = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const [i, setI] = useState(0);
  const [n, setN] = useState(reduced ? LINES[0].text.length : 0);
  const [back, setBack] = useState(false);
  const line = LINES[i];

  useEffect(() => {
    if (reduced) return;
    const full = n === line.text.length;
    let t: number;
    if (!back && !full) t = window.setTimeout(() => setN(n + 1), 42 + Math.random() * 55);
    else if (!back) t = window.setTimeout(() => setBack(true), 2200);
    else if (n > 0) t = window.setTimeout(() => setN(n - 1), 22);
    else
      t = window.setTimeout(() => {
        setBack(false);
        setI((i + 1) % LINES.length);
      }, 350);
    return () => clearTimeout(t);
  }, [n, back, i, line, reduced]);

  return (
    <p aria-hidden className="font-display min-h-[2.85em] text-[clamp(48px,5.6vw,92px)] leading-[0.95] tracking-[-0.02em] text-balance max-lg:min-h-[2em]">
      <span className="mark" style={{ ["--u" as string]: `var(--u-${line.u})` }}>
        {line.text.slice(0, n)}
      </span>
      <span className="caret ml-[0.04em] inline-block h-[0.78em] w-[0.06em] translate-y-[0.06em] bg-ink" />
    </p>
  );
}
