import { Download, Monitor, Moon, Sun } from "lucide-react";
import type { ThemePref } from "../bridge/protocol";
import { useEffect, useMemo, useState } from "react";
import { randomGames } from "./siteGames";
import { Journey } from "./Journey";
import { StatusBar } from "./StatusBar";
import { savedSiteTheme, switchSiteTheme } from "./siteTheme";

// The Shelf website: a line that writes itself next to a bookcase, then one journey down the page (see Journey.tsx)
// that ends with the newest game landing in the wheel.

/** The newest release's installer (the asset keeps the same name in every release, so this link never goes stale). */
const DOWNLOAD_URL = "https://github.com/Anish-Juyal-01/Shelf/releases/latest/download/Shelf-setup.exe";
const PROFILE_URL = "https://github.com/Anish-Juyal-01";
const REPO_URL = "https://github.com/Anish-Juyal-01/Shelf";

export function Site() {
  // Every visit gets its own shuffled library; the first game is the one that falls off the shelf.
  const [games] = useState(randomGames);
  const faller = games[0];
  return (
    <div className="relative z-[1] min-h-screen text-ink">
      <Nav />
      <Journey
        games={games}
        faller={faller}
        download={DOWNLOAD_URL}
        github={REPO_URL}
        line={
          <>
            <h1 className="sr-only">Shelf: every game on your PC, even the ones you forgot.</h1>
            <StatusBar games={games} />
            <TypedLine />
            <p className="mt-7 max-w-[44ch] text-[clamp(16px,1.3vw,18.5px)] leading-[1.55] text-ink-2">
              A Windows app that finds every game you have — from every launcher, and the ones you unzipped into a folder —
              tracks what you play, and shows what's filling your drives.
            </p>
            <p className="typed mt-7 text-[12px] text-ink-3">Free &amp; open source · Windows 10 &amp; 11 · no account · works offline</p>
          </>
        }
      />
      <footer className="border-t border-rule">
        <div className="mx-auto grid max-w-[1480px] gap-8 px-4 py-12 text-[14px] text-ink-3 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr] lg:px-14">
          <div>
            <span className="flex items-center gap-2.5">
              <img src="./icon.svg" alt="" className="size-9" />
              <span className="font-display text-[36px] leading-none text-ink">Shelf<span className="text-u-red">.</span></span>
            </span>
            <p className="mt-3 max-w-[34ch]">Keeps track of every game you download, so you stop forgetting them and your drive stops filling up.</p>
          </div>
          <div className="space-y-2">
            <p className="caps text-ink-4">Project</p>
            <a className="block hover:text-ink" href={REPO_URL} target="_blank" rel="noreferrer">Source on GitHub</a>
            <a className="block hover:text-ink" href={`${REPO_URL}#install`} target="_blank" rel="noreferrer">How to install</a>
            <a className="block hover:text-ink" href={`${REPO_URL}/releases/latest`} target="_blank" rel="noreferrer">Release notes</a>
            <a className="block hover:text-ink" href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT license</a>
          </div>
          <div className="space-y-2">
            <p className="caps text-ink-4">Promise</p>
            <p>Reads, never writes.</p>
            <p>Never deletes a thing.</p>
            <p>Your library stays on your PC.</p>
          </div>
        </div>
        <div className="typed mx-auto max-w-[1480px] px-4 pb-8 text-[11.5px] text-ink-4 sm:px-8 lg:px-14">Made by Anish Juyal · game art belongs to its publishers</div>
      </footer>
    </div>
  );
}

function Nav() {
  return (
    <header className="site-nav sticky top-0 z-30 bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-[60px] max-w-[1480px] items-center gap-1.5 px-4 sm:h-[72px] sm:gap-3 sm:px-8 lg:px-14">
        <a href="#" className="flex flex-none items-center gap-2 sm:gap-2.5" aria-label="Shelf">
          <img src="./icon.svg" alt="" className="size-8 sm:size-10" />
          <span className="font-display text-[30px] leading-none sm:text-[40px]">
            Shelf<span className="text-u-red">.</span>
          </span>
        </a>
        <span className="flex-1" />
        <ThemeSwitch />
        <a
          href={PROFILE_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
          className="inline-flex h-10 flex-none items-center gap-2 rounded-full px-2.5 text-[14.5px] font-medium text-ink-2 transition-colors hover:bg-sunken hover:text-ink sm:px-3"
        >
          <GitHubMark />
          <span className="max-sm:hidden">GitHub</span>
        </a>
        <a
          href={DOWNLOAD_URL}
          aria-label="Download for Windows"
          className="inline-flex size-10 flex-none items-center justify-center gap-2 rounded-full bg-accent text-[14.5px] sm:w-auto sm:px-5 font-medium text-accent-ink shadow-[0_1px_0_rgb(255_255_255/0.15)_inset,0_8px_24px_-10px_rgb(0_0_0/0.5)] transition-[filter] hover:brightness-110"
        >
          <Download className="size-4" strokeWidth={2.2} />
          <span className="max-sm:hidden">Download for Windows</span>
        </a>
      </div>
    </header>
  );
}

/** Light / Dark / System. Light for everyone until they pick otherwise. */
function ThemeSwitch() {
  const [pref, setPref] = useState<ThemePref>(savedSiteTheme);
  const opts: { v: ThemePref; label: string; Icon: typeof Sun }[] = [
    { v: "light", label: "Light", Icon: Sun },
    { v: "dark", label: "Dark", Icon: Moon },
    { v: "system", label: "System", Icon: Monitor },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex flex-none items-center rounded-full border border-rule-strong bg-surface p-0.5 sm:mr-1">
      {opts.map(({ v, label, Icon }) => (
        <button
          key={v}
          role="radio"
          aria-checked={pref === v}
          aria-label={label}
          title={label}
          onClick={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            setPref(v);
            switchSiteTheme(v, b.left + b.width / 2, b.top + b.height / 2);
          }}
          className={`inline-flex size-7 cursor-pointer items-center sm:size-8 justify-center rounded-full transition-colors ${pref === v ? "bg-ink text-bg" : "text-ink-3 hover:text-ink"}`}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
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
    // A fixed height for the longest line, with the text sitting at the bottom, so nothing below it jumps as it types.
    <div aria-hidden className="font-display flex min-h-[2.85em] flex-col lg:min-h-[1.9em] justify-end text-[clamp(52px,6.2vw,100px)] leading-[0.95] tracking-[-0.02em]">
      <p className="text-balance">
        <span className="mark" style={{ ["--u" as string]: `var(--u-${line.u})` }}>
          {line.text.slice(0, n)}
        </span>
        <span className="caret ml-[0.04em] inline-block h-[0.78em] w-[0.06em] translate-y-[0.06em] bg-ink" />
      </p>
    </div>
  );
}
