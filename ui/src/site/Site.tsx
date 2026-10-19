import { Download, Moon, Sun } from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { sampleState } from "../bridge/previewBridge";
import { WheelHero } from "../components/Heroes";
import { SkyBackdrop, SkyFront } from "../components/Sky";
import { ThemePicker } from "../components/ThemePicker";
import { palette } from "../lib/art";
import { bytes, hours } from "../lib/format";
import { headline } from "../lib/headline";
import { dailyTotals, isOverdue } from "../lib/library";
import { paletteById, type PaletteId } from "../lib/palettes";
import { applyTheme } from "../lib/theme";
import { squarify } from "../lib/treemap";

// The Shelf website. Same world as the app: a paper page, tall serif type, three hand-drawn underline colours, and
// the painted sky as a window you look through. Everything on it that looks like the app *is* the app's code,
// fed the same sample library the design preview uses.

/** Where the Download buttons point. Set this once there's a build to host. */
const DOWNLOAD_URL = "#download";

const state = sampleState();
const DAY = 86_400_000;
const u = (c: "blue" | "red" | "yellow" | "ink") => ({ ["--u" as string]: `var(--u-${c})` }) as CSSProperties;

export function Site() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <Nav />
      <Hero />
      <Sentence />
      <Finds />
      <Storage />
      <Playtime />
      <Themes />
      <Privacy />
      <Outro />
    </div>
  );
}

/* ───────────────────────── shared bits ───────────────────────── */

function Wrap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1240px] px-4 sm:px-8 lg:px-10 ${className}`}>{children}</div>;
}

function Kicker({ n, children }: { n: string; children: ReactNode }) {
  return (
    <p className="caps flex items-center gap-3 text-ink-3">
      <span className="typed text-ink">{n}</span>
      <span className="h-px w-8 bg-rule-strong" />
      {children}
    </p>
  );
}

function H2({ children }: { children: ReactNode }) {
  return <h2 className="font-display mt-4 max-w-[16ch] text-[clamp(40px,5.6vw,80px)] leading-[0.95] text-balance">{children}</h2>;
}

function DownloadButton({ big }: { big?: boolean }) {
  return (
    <a
      href={DOWNLOAD_URL}
      className={`inline-flex items-center gap-2.5 rounded-full bg-accent font-medium text-accent-ink shadow-[0_1px_0_rgb(255_255_255/0.15)_inset,0_8px_24px_-10px_rgb(0_0_0/0.5)] transition-[filter,transform] hover:brightness-110 active:translate-y-px ${big ? "h-14 px-7 text-[17px]" : "h-10 px-5 text-[14.5px]"}`}
    >
      <Download className={big ? "size-5" : "size-4"} strokeWidth={2.2} />
      Download for Windows
    </a>
  );
}

function useTheme() {
  const root = document.documentElement;
  const [dark, setDark] = useState(root.dataset.theme === "dark");
  const [pal, setPal] = useState<PaletteId>(paletteById(root.dataset.palette).id);
  return {
    dark,
    pal,
    setDark(d: boolean) {
      applyTheme(d ? "dark" : "light", pal);
      setDark(d);
    },
    setPal(p: PaletteId) {
      applyTheme(dark ? "dark" : "light", p);
      setPal(p);
    },
  };
}

/* ───────────────────────── nav + hero ───────────────────────── */

function Nav() {
  const t = useTheme();
  const links: [string, string][] = [["How it finds games", "#finds"], ["Storage", "#storage"], ["Playtime", "#playtime"], ["Privacy", "#privacy"]];
  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-bg/85 backdrop-blur-md">
      <Wrap className="flex h-16 items-center gap-8">
        <a href="#" className="font-display text-[30px] leading-none">
          Shelf<span className="text-u-red">.</span>
        </a>
        <nav className="hidden items-center gap-6 text-[14px] text-ink-2 lg:flex">
          {links.map(([l, h]) => (
            <a key={h} href={h} className="transition-colors hover:text-ink">{l}</a>
          ))}
        </nav>
        <span className="flex-1" />
        <button
          onClick={() => t.setDark(!t.dark)}
          aria-label={t.dark ? "Switch to day" : "Switch to night"}
          className="inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
        >
          {t.dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
        </button>
        <span className="max-sm:hidden"><DownloadButton /></span>
      </Wrap>
    </header>
  );
}

function Hero() {
  const games = useMemo(
    () => state.games.filter((g) => g.installed).sort((a, b) => Date.parse(b.lastPlayed ?? b.firstSeen) - Date.parse(a.lastPlayed ?? a.firstSeen)),
    [],
  );
  return (
    <section>
      <Wrap className="pt-14 pb-10 sm:pt-20">
        <h1 className="font-display rise text-[clamp(50px,8.4vw,124px)] leading-[0.88] tracking-[-0.02em]">
          <span className="block text-balance">Every game on your PC.</span>
          <em className="mark block text-balance text-ink-2" style={u("red")}>Even the ones you forgot.</em>
        </h1>
        <div className="rise mt-10 grid items-end gap-8 md:grid-cols-[1fr_auto]" style={{ animationDelay: "120ms" }}>
          <p className="max-w-[54ch] text-[clamp(17px,1.5vw,20px)] leading-[1.5] text-ink-2">
            Shelf finds what Steam, Epic, Xbox and nine other launchers installed — and the game you unzipped into Downloads
            last spring. Then it tells you, in one sentence, what's taking up your drive.
          </p>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <DownloadButton big />
            <p className="typed text-[12px] text-ink-3">Windows 10 &amp; 11 · works offline · never deletes anything</p>
          </div>
        </div>
      </Wrap>
      <div className="rise px-2 sm:px-5" style={{ animationDelay: "240ms" }}>
        <div className="relative mx-auto h-[clamp(320px,52vh,560px)] max-w-[1600px] overflow-hidden rounded-[22px] ring-1 ring-black/5">
          <WheelHero games={games} onOpen={() => {}} />
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── the sentence ───────────────────────── */

function Sentence() {
  const parts = headline(state.games, state.playing);
  return (
    <section>
      <Wrap className="grid gap-10 py-24 md:grid-cols-[220px_1fr] md:py-32">
        <p className="caps pt-3 text-ink-3">What you see first</p>
        <div>
          <p className="font-display text-[clamp(32px,3.9vw,56px)] leading-[1.06] text-balance">
            {parts.map((p, i) =>
              typeof p === "string" ? <span key={i}>{p}</span> : <span key={i} className="mark" style={u(p.color)}>{p.text}</span>,
            )}
          </p>
          <p className="mt-6 max-w-[56ch] text-[16px] leading-[1.6] text-ink-3">
            No dashboard to decode. Shelf opens on a sentence written from your own library, and every underlined part
            takes you somewhere: the games you haven't touched, the space they hold, the one you're playing now.
          </p>
        </div>
      </Wrap>
    </section>
  );
}

/* ───────────────────────── how it finds games ───────────────────────── */

const SOURCES = ["Steam", "Epic", "GOG", "EA app", "Ubisoft Connect", "Rockstar", "Battle.net", "Riot", "Xbox app", "itch", "Amazon Games", "HoYoPlay", "Windows' installed apps"];

const SCAN: { path: string; verdict: string; why: string; score: number }[] = [
  { path: String.raw`D:\Downloads\HollowKnight_v1.5\ `.trim(), verdict: "Hollow Knight", why: "Unity player, data folder, one real exe", score: 94 },
  { path: String.raw`E:\Games\celeste\ `.trim(), verdict: "Celeste", why: "FNA runtime, content pack", score: 88 },
  { path: String.raw`F:\stuff\proj_final\ `.trim(), verdict: "Maybe a game?", why: "one exe, a save folder, no engine", score: 52 },
  { path: String.raw`C:\Tools\ffmpeg\ `.trim(), verdict: "Not a game", why: "command-line tools", score: 9 },
];

function Finds() {
  return (
    <section id="finds" className="border-t border-rule">
      <Wrap className="py-24 md:py-32">
        <Kicker n="01">How it finds games</Kicker>
        <H2>
          Twelve launchers. <span className="mark" style={u("blue")}>Plus every folder</span> you point it at.
        </H2>
        <div className="mt-14 grid gap-14 lg:grid-cols-[1fr_1.15fr]">
          <div className="space-y-6 text-[17px] leading-[1.6] text-ink-2">
            <p>
              Shelf reads each launcher's own records — {SOURCES.slice(0, -1).join(", ")} and {SOURCES[SOURCES.length - 1]} —
              straight from your disk. No sign-ins, no APIs.
            </p>
            <p>
              Then it walks the folders you choose (it suggests a few, or scans a whole drive when you ask) and looks at
              each one the way you would: is there an engine in here, a real executable, the shape of a game? Everything
              gets a score.
            </p>
            <p className="text-ink-3">
              Above 70 it goes straight into your library. Between 35 and 70 it waits in Review for a yes or a no. Leftover
              installers and zips get flagged for the storage view.
            </p>
          </div>
          <ScanLog />
        </div>
      </Wrap>
    </section>
  );
}

function ScanLog() {
  return (
    <div className="paper overflow-hidden rounded-[16px]">
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <span className="caps text-ink-3">Folder scan</span>
        <span className="typed text-[11.5px] text-ink-4">score 0–100</span>
      </div>
      <ol>
        {SCAN.map((r) => {
          const tone = r.score >= 70 ? "var(--ok)" : r.score >= 35 ? "var(--u-yellow)" : "var(--ink-4)";
          return (
            <li key={r.path} className="border-b border-rule px-5 py-4 last:border-b-0">
              <div className="typed truncate text-[12.5px] text-ink-3">{r.path}</div>
              <div className="mt-1.5 flex items-baseline justify-between gap-4">
                <span className="font-display text-[26px] leading-none">{r.verdict}</span>
                <span className="typed text-[15px]" style={{ color: tone }}>{r.score}</span>
              </div>
              <div className="relative mt-3 h-1.5 rounded-full bg-sunken">
                <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${r.score}%`, background: tone }} />
                {[35, 70].map((m) => <span key={m} className="absolute -top-1 -bottom-1 w-px bg-ink-3" style={{ left: `${m}%` }} />)}
              </div>
              <div className="mt-2 text-[13px] text-ink-3">{r.why}</div>
            </li>
          );
        })}
      </ol>
      <div className="flex justify-between border-t border-rule bg-surface-2 px-5 py-2.5 text-[12px] text-ink-3">
        <span>0–34 ignored</span>
        <span>35–69 Review</span>
        <span>70+ Library</span>
      </div>
    </div>
  );
}

/* ───────────────────────── storage ───────────────────────── */

function Storage() {
  const games = useMemo(() => state.games.filter((g) => g.installed && g.sizeBytes > 0).sort((a, b) => b.sizeBytes - a.sizeBytes), []);
  const rects = useMemo(() => squarify(games.map((g) => g.sizeBytes), 100, 56), [games]);
  const idle = games.filter((g) => isOverdue(g));
  const idleBytes = idle.reduce((a, g) => a + g.sizeBytes, 0);
  return (
    <section id="storage" className="border-t border-rule">
      <Wrap className="py-24 md:py-32">
        <div className="grid items-end gap-8 md:grid-cols-[1fr_auto]">
          <div>
            <Kicker n="02">Storage</Kicker>
            <H2>
              Where did <span className="mark" style={u("red")}>{bytes(idleBytes)}</span> go?
            </H2>
          </div>
          <p className="max-w-[40ch] text-[16px] leading-[1.6] text-ink-2">
            Every game drawn to the size it takes on disk. The faded ones haven't been played in three months. Duplicates
            and forgotten installers are listed too.
          </p>
        </div>
        <div className="relative mt-12 w-full overflow-hidden rounded-[16px] bg-sunken" style={{ aspectRatio: "100 / 56" }}>
          {games.map((g, i) => {
            const r = rects[i];
            const [base, a, b] = palette(g.title);
            const old = isOverdue(g);
            const area = r.w * r.h;
            const days = g.lastPlayed ? Math.floor((Date.now() - Date.parse(g.lastPlayed)) / DAY) : null;
            return (
              <div
                key={g.id}
                className="absolute p-[3px]"
                style={{ left: `${r.x}%`, top: `${(r.y / 56) * 100}%`, width: `${r.w}%`, height: `${(r.h / 56) * 100}%` }}
              >
                <div
                  className="relative flex h-full flex-col justify-end overflow-hidden rounded-[10px] p-3 text-white"
                  style={{
                    background: `radial-gradient(120% 90% at 20% 10%, ${a}, transparent 60%), radial-gradient(100% 100% at 90% 100%, ${b}, transparent 65%), ${base}`,
                    filter: old ? "grayscale(0.85) brightness(0.75)" : "none",
                  }}
                >
                  {old && <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "repeating-linear-gradient(135deg, rgb(255 255 255 / 0.35) 0 1px, transparent 1px 7px)" }} />}
                  {area > 160 && (
                    <div className="relative">
                      <div className="font-display text-[clamp(15px,1.7vw,26px)] leading-[1.02] drop-shadow-sm">{g.title}</div>
                      <div className="typed mt-1 text-[11px] opacity-85">
                        {bytes(g.sizeBytes)}
                        {old && days !== null && ` · idle ${days}d`}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-8 grid gap-6 text-[15px] leading-[1.55] text-ink-2 sm:grid-cols-3">
          <p><span className="font-display block text-[24px] text-ink">Uninstall the store's way</span>Each game's button opens its own launcher's uninstaller, or Windows' Apps settings.</p>
          <p><span className="font-display block text-[24px] text-ink">Spot the doubles</span>Two copies of the same game on two drives show up as one game with ×2.</p>
          <p><span className="font-display block text-[24px] text-ink">Find the leftovers</span>Setup files and zips you already installed from get their own list.</p>
        </div>
      </Wrap>
    </section>
  );
}

/* ───────────────────────── playtime ───────────────────────── */

function Playtime() {
  const days = useMemo(() => dailyTotals(state.sessions, 14), []);
  const max = Math.max(3600, ...days.map((d) => d.seconds));
  const week = days.slice(-7).reduce((a, d) => a + d.seconds, 0);
  const now = state.playing[0];
  const nowGame = now && state.games.find((g) => g.id === now.gameId);
  return (
    <section id="playtime" className="border-t border-rule">
      <Wrap className="grid gap-16 py-24 md:py-32 lg:grid-cols-[1fr_1fr]">
        <div>
          <Kicker n="03">Playtime</Kicker>
          <H2>
            It notices when you <span className="mark" style={u("yellow")}>press play</span>.
          </H2>
          <div className="mt-10 space-y-7 text-[16.5px] leading-[1.6] text-ink-2">
            <Note n="a" title="Every launcher, one clock">
              Shelf watches for your games starting, from any launcher or a desktop shortcut, and counts the time.
              Your Steam hours come across on day one.
            </Note>
            <Note n="b" title="Honest about gaps">
              Sleep, crashes and restarts are handled. If Shelf wasn't running, the chart says so instead of guessing.
            </Note>
            <Note n="c" title="Catches the strays">
              Something new running fullscreen and working the GPU? Shelf puts it in Review so you can say yes.
            </Note>
          </div>
        </div>
        <div className="flex flex-col justify-center gap-6">
          {nowGame && (
            <div className="paper flex items-center justify-between gap-4 rounded-full py-2.5 pr-5 pl-4">
              <span className="flex items-center gap-2.5 text-[15px] font-medium">
                <span className="pulse-dot size-2.5 rounded-full bg-ok" />
                {nowGame.title}
              </span>
              <span className="typed text-[13px] text-ink-3">playing · {hours(Math.round((Date.now() - Date.parse(now.since)) / 1000))}</span>
            </div>
          )}
          <div className="paper rounded-[16px] p-6">
            <div className="flex items-baseline justify-between">
              <span className="caps text-ink-3">Last 14 days</span>
              <span className="font-display text-[34px] leading-none">{hours(week)} <span className="typed text-[12px] text-ink-3">this week</span></span>
            </div>
            <div className="mt-6 flex h-40 items-end gap-[6px]">
              {days.map((d, i) => (
                <div key={i} className="flex h-full flex-1 flex-col justify-end">
                  <div className="rounded-t-[4px] bg-u-blue" style={{ height: d.seconds ? `${Math.max(4, (d.seconds / max) * 100)}%` : 2, opacity: d.seconds ? 1 : 0.25 }} />
                </div>
              ))}
            </div>
            <div className="typed mt-2 flex justify-between text-[11px] text-ink-4">
              <span>two weeks ago</span>
              <span>today</span>
            </div>
          </div>
          <p className="typed text-[12px] leading-[1.6] text-ink-3">
            Watching costs about 0.06% CPU on the machine it was built on — it checks what's running every five seconds.
          </p>
        </div>
      </Wrap>
    </section>
  );
}

function Note({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[28px_1fr] gap-x-3">
      <span className="typed pt-1.5 text-[12px] text-ink-3">{n}.</span>
      <div>
        <div className="font-display text-[26px] leading-tight text-ink">{title}</div>
        <p className="mt-1">{children}</p>
      </div>
    </div>
  );
}

/* ───────────────────────── themes ───────────────────────── */

function Themes() {
  const t = useTheme();
  const p = paletteById(t.pal);
  return (
    <section id="themes" className="border-t border-rule">
      <Wrap className="py-24 md:py-32">
        <div className="grid items-end gap-8 md:grid-cols-[1fr_auto]">
          <div>
            <Kicker n="04">Looks</Kicker>
            <H2>Twelve skies. Pick one — this page will follow.</H2>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-rule-strong p-1 text-[14px]">
            {([false, true] as const).map((d) => (
              <button
                key={String(d)}
                onClick={() => t.setDark(d)}
                className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 transition-colors ${t.dark === d ? "bg-accent text-accent-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {d ? <Moon className="size-4" /> : <Sun className="size-4" />}
                {d ? (p.black ? "Black" : "Night") : p.black ? "Graphite" : "Day"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-12">
          <ThemePicker value={t.pal} dark={t.dark} onChange={t.setPal} />
        </div>
      </Wrap>
    </section>
  );
}

/* ───────────────────────── privacy ───────────────────────── */

function Privacy() {
  const items: [string, string][] = [
    ["Reads, never writes", "Launcher files and the registry are opened read-only. Shelf keeps its own notes in its own folder and touches nothing else."],
    ["Works offline", "No account and nothing to sign in to. Icons and art come from what your launchers already keep on disk."],
    ["Never deletes", "Shelf shows you what's taking space. Removing a game is always done by its own launcher, or by you."],
  ];
  return (
    <section id="privacy" className="border-t border-rule">
      <Wrap className="py-24 md:py-32">
        <Kicker n="05">Privacy</Kicker>
        <H2>It looks. It doesn't touch.</H2>
        <dl className="mt-14 grid gap-x-12 gap-y-10 md:grid-cols-3">
          {items.map(([k, v], i) => (
            <div key={k} className="border-t-2 pt-5" style={{ borderColor: `var(--u-${["blue", "red", "yellow"][i]})` }}>
              <dt className="font-display text-[30px] leading-tight">{k}</dt>
              <dd className="mt-2 text-[16px] leading-[1.6] text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      </Wrap>
    </section>
  );
}

/* ───────────────────────── outro ───────────────────────── */

function Outro() {
  return (
    <section id="download" className="px-2 pb-6 sm:px-5">
      <div className="relative mx-auto flex min-h-[520px] max-w-[1600px] items-center overflow-hidden rounded-[22px] ring-1 ring-black/5">
        <SkyBackdrop />
        <SkyFront />
        <div className="relative w-full px-6 py-20 text-center">
          <h2 className="font-display text-[clamp(52px,8vw,120px)] leading-[0.9] text-white drop-shadow-[0_2px_24px_rgb(0_0_0/0.25)]">
            Go find your games.
          </h2>
          <div className="mt-10 flex justify-center">
            <DownloadButton big />
          </div>
          <p className="typed mt-4 text-[12px] text-white/80">Windows 10 &amp; 11</p>
        </div>
      </div>
      <Wrap className="flex flex-wrap items-center justify-between gap-4 py-8 text-[13px] text-ink-3">
        <span className="font-display text-[22px] text-ink">Shelf<span className="text-u-red">.</span></span>
        <span>Keeps track of every game you download.</span>
      </Wrap>
    </section>
  );
}
