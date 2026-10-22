import clsx from "clsx";
import { ArrowDownWideNarrow, ChevronLeft, ChevronRight, Info, Play, Plus, Search, X } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { bridge } from "../bridge/bridge";
import type { GameView } from "../bridge/protocol";
import { Cover } from "../components/Cover";
import { Button, Chip, Empty, MenuButton, Segmented } from "../components/ui";
import { useNow } from "../components/useNow";
import { bytes, duration, hours, relative, sourceName } from "../lib/format";
import { dailyTotals, filterGames, isOverdue, sourceCounts, type SortKey } from "../lib/library";
import { useApp } from "../store/store";

const sortLabels: Record<SortKey, string> = {
  recent: "Last played",
  playtime: "Most played",
  name: "Title A–Z",
  size: "Largest first",
};

const ARC_SIZE = 9;

/** Games you've played, most recent first; then ones you haven't played yet, newest found first. */
const byRecentPlay = (a: GameView, b: GameView) =>
  Number(!!b.lastPlayed) - Number(!!a.lastPlayed) || Date.parse(b.lastPlayed ?? b.firstSeen) - Date.parse(a.lastPlayed ?? a.firstSeen);

export function Library() {
  const state = useApp((s) => s.state)!;
  const filter = useApp((s) => s.filter);
  const setFilter = useApp((s) => s.setFilter);
  const setView = useApp((s) => s.setView);
  const openGame = useApp((s) => s.openGame);
  const focusId = useApp((s) => s.focusId);
  const setFocus = useApp((s) => s.setFocus);
  const grid = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => filterGames(state.games, filter), [state.games, filter]);
  const installed = useMemo(() => state.games.filter((g) => g.installed && !g.hidden), [state.games]);
  // The arc: the most recent game in the middle, older ones alternating out to either side.
  const recent = useMemo(() => {
    const byRecency = [...installed].sort(byRecentPlay).slice(0, ARC_SIZE);
    const left = byRecency.filter((_, i) => i % 2 === 1).reverse();
    const right = byRecency.filter((_, i) => i % 2 === 0);
    return [...left, ...right];
  }, [installed]);
  const newest = useMemo(() => [...recent].sort(byRecentPlay)[0], [recent]);
  const sources = useMemo(() => sourceCounts(state.games.filter((g) => !g.hidden)), [state.games]);
  const dusty = useMemo(() => installed.filter((g) => isOverdue(g)).sort((a, b) => b.sizeBytes - a.sizeBytes), [installed]);
  const playing = new Set(state.playing.map((p) => p.gameId));
  const filtered = filter.query !== "" || filter.sources.length > 0 || filter.overdueOnly || filter.installed !== "installed";

  // Turn the arc to what's playing, else the most recent game, whenever the focus isn't one of the arc's games.
  useEffect(() => {
    if (newest && !recent.some((g) => g.id === focusId)) {
      const live = state.playing.find((p) => recent.some((g) => g.id === p.gameId));
      setFocus(live?.gameId ?? newest.id);
    }
  }, [recent, newest, focusId, setFocus, state.playing]);

  const focusIndex = Math.max(0, recent.findIndex((g) => g.id === focusId));
  const turn = (by: number) => {
    if (!recent.length) return;
    const next = (focusIndex + by + recent.length) % recent.length;
    setFocus(recent[next].id);
  };

  // ←/→ turn the arc while nothing else has the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea") || useApp.getState().gameId !== null) return;
      if (e.key === "ArrowLeft") turn(-1);
      if (e.key === "ArrowRight") turn(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="pb-16">
      {recent.length > 0 && (
        <section className="relative flex h-[calc(100vh-64px)] min-h-[520px] flex-col px-8 pb-6" aria-label="Recently played">
          <Arc games={recent} focus={focusIndex} playing={playing} onFocus={(i) => setFocus(recent[i].id)} onOpen={openGame} onTurn={turn} />
          <Focus game={recent[focusIndex]} />
          <Dock
            installed={installed}
            dusty={dusty}
            onOpen={openGame}
            onStorage={() => setView("storage")}
            onAll={() => grid.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          />
        </section>
      )}

      <div ref={grid} className="mx-auto max-w-[1500px] scroll-mt-2 px-8 pt-4">
        <div className="sticky top-2 z-10 mb-8">
          <div className="glass flex flex-wrap items-center gap-2 !rounded-[26px] p-2">
            <label className="relative flex h-10 min-w-[240px] flex-1 items-center">
              <Search size={16} className="pointer-events-none absolute left-4 text-ink-3" />
              <input
                value={filter.query}
                onChange={(e) => setFilter({ query: e.target.value })}
                placeholder={`Search ${installed.length} games — title or folder`}
                aria-label="Search games"
                className="h-10 w-full rounded-full border border-transparent bg-[var(--sunken)] pr-9 pl-11 text-[14px] text-ink placeholder:text-ink-3 focus:border-[var(--edge)] focus:outline-none"
              />
              {filter.query && (
                <button onClick={() => setFilter({ query: "" })} aria-label="Clear search" className="absolute right-3.5 cursor-pointer text-ink-3 hover:text-ink">
                  <X size={14} />
                </button>
              )}
            </label>
            <Segmented
              label="Installed filter"
              value={filter.installed}
              onChange={(v) => setFilter({ installed: v })}
              options={[
                { value: "installed", label: "Installed" },
                { value: "all", label: "All" },
                { value: "missing", label: "Gone" },
              ]}
            />
            <MenuButton
              trigger={
                <Button icon={<ArrowDownWideNarrow size={15} />} aria-label="Sort">
                  {sortLabels[filter.sort]}
                </Button>
              }
              items={(Object.keys(sortLabels) as SortKey[]).map((k) => ({ label: sortLabels[k], onSelect: () => setFilter({ sort: k }) }))}
            />
            <Button tone="primary" icon={<Plus size={15} />} onClick={() => bridge.send({ type: "addExe" })} title="Pick a game's .exe (or drop one on the window)">
              Add a game
            </Button>
            <div className="flex w-full flex-wrap items-center gap-1 px-1 pt-0.5">
              <Chip tone="red" active={filter.overdueOnly} onClick={() => setFilter({ overdueOnly: !filter.overdueOnly })} count={dusty.length}>
                Not played in 90 days
              </Chip>
              <span className="mx-1 h-4 w-px bg-[var(--rule-strong)]" />
              {sources.map(([s, n]) => (
                <Chip
                  key={s}
                  active={filter.sources.includes(s)}
                  count={n}
                  onClick={() => setFilter({ sources: filter.sources.includes(s) ? filter.sources.filter((x) => x !== s) : [...filter.sources, s] })}
                >
                  {sourceName[s]}
                </Chip>
              ))}
              <div className="flex-1" />
              <label className="flex cursor-pointer items-center gap-2 px-2 text-[12.5px] text-ink-3">
                <input type="checkbox" checked={filter.showHidden} onChange={(e) => setFilter({ showHidden: e.target.checked })} className="accent-[var(--accent)]" />
                Show hidden
              </label>
            </div>
          </div>
        </div>

        {visible.length === 0 ? (
          state.games.length === 0 ? (
            <Empty
              title="Nothing on the shelf yet."
              action={
                <>
                  <Button tone="primary" onClick={() => setView("settings")}>Choose folders to scan</Button>
                  <Button onClick={() => bridge.send({ type: "refresh" })}>Check launchers again</Button>
                </>
              }
            >
              Shelf reads Steam, Epic, GOG, EA, Ubisoft, Xbox and other launchers, plus any folders you point it at.
            </Empty>
          ) : (
            <Empty
              title="Nothing matches."
              action={filtered && <Button onClick={() => setFilter({ query: "", sources: [], overdueOnly: false, installed: "all" })}>Clear filters</Button>}
            >
              {filter.query ? <>No game called “{filter.query}”.</> : "Try other filters."}
            </Empty>
          )
        ) : (
          <ul className="stage grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-6 gap-y-9">
            {visible.map((g) => (
              <li key={g.id}>
                <GameCard game={g} playing={playing.has(g.id)} onOpen={() => openGame(g.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The arc: recent games hanging in depth. The focused one faces you and floats; its neighbours turn away into the
 * room. The whole arc leans a few degrees toward the mouse. Click a side card to bring it forward, the front one to
 * open it.
 */
function Arc({ games, focus, playing, onFocus, onOpen, onTurn }: {
  games: GameView[];
  focus: number;
  playing: Set<number>;
  onFocus(i: number): void;
  onOpen(id: number): void;
  onTurn(by: number): void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(210);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  // Cards size themselves to the room they have: tall windows get big cards, small windows smaller ones.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(Math.max(120, Math.min(250, (e.contentRect.height - 16) / 1.5, e.contentRect.width / 6)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={stage}
      className="stage relative min-h-0 flex-1"
      onMouseMove={(e) => {
        const r = stage.current!.getBoundingClientRect();
        setTilt({ x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 });
      }}
      onMouseLeave={() => setTilt({ x: 0, y: 0 })}
      onWheel={(e) => {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 20) onTurn(e.deltaX > 0 ? 1 : -1);
      }}
    >
      <div
        className="absolute inset-0"
        style={{ transformStyle: "preserve-3d", transform: `rotateY(${tilt.x * 6}deg) rotateX(${-tilt.y * 4}deg)`, transition: "transform .5s ease-out" }}
      >
        {games.map((g, i) => {
          const d = i - focus;
          const a = Math.abs(d);
          const step = w * 1.06;
          const style: CSSProperties = {
            width: w,
            left: `calc(50% - ${w / 2}px)`,
            top: `calc(50% - ${(w * 1.5) / 2}px)`,
            zIndex: 20 - a,
            opacity: a > 3 ? 0 : 1 - a * 0.16,
            pointerEvents: a > 3 ? "none" : undefined,
            filter: a ? `brightness(${1 - a * 0.14}) saturate(${1 - a * 0.12})` : undefined,
            transform: `translateX(${d * step - Math.sign(d) * a * a * w * 0.075}px) translateZ(${-a * w * 0.7}px) rotateY(${-Math.sign(d) * Math.min(a * 26, 58)}deg)`,
            transition: "transform .7s cubic-bezier(.2,.8,.2,1), opacity .6s, filter .6s",
          };
          return (
            <button
              key={g.id}
              className="absolute cursor-pointer"
              style={style}
              onClick={() => (d === 0 ? onOpen(g.id) : onFocus(i))}
              aria-label={d === 0 ? `${g.title}, open details` : `Show ${g.title}`}
              tabIndex={a > 3 ? -1 : 0}
            >
              <div className={clsx("sheen rounded-[16px]", d === 0 && "float")}>
                <Cover title={g.title} url={g.coverUrl} iconUrl={g.iconUrl} meta={sourceName[g.sources[0]]} large className="rounded-[16px]" />
                {playing.has(g.id) && (
                  <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
                    <span className="size-1.5 rounded-full bg-ok" /> Playing
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {/* contact light under the front card */}
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-10 w-[300px] -translate-x-1/2 rounded-[50%] bg-white/20 blur-2xl" />
      {games.length > 1 && (
        <>
          <button onClick={() => onTurn(-1)} aria-label="Previous game" className="glass-flat absolute top-1/2 left-0 z-30 inline-flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-ink-2 hover:text-ink">
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => onTurn(1)} aria-label="Next game" className="glass-flat absolute top-1/2 right-0 z-30 inline-flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-ink-2 hover:text-ink">
            <ChevronRight size={18} />
          </button>
        </>
      )}
    </div>
  );
}

/** What the arc is turned to: its name and the two things you'd do with it. */
function Focus({ game: g }: { game: GameView }) {
  const playing = useApp((s) => s.state?.playing.find((p) => p.gameId === g.id));
  const openGame = useApp((s) => s.openGame);
  const now = useNow(30_000);
  const line = playing
    ? `Playing now · ${sourceName[g.sources[0]]} · ${duration((now - Date.parse(playing.since)) / 1000)} in`
    : [sourceName[g.sources[0]], g.lastPlayed ? `last played ${relative(g.lastPlayed)}` : "never played", bytes(g.sizeBytes)].join(" · ");
  return (
    <div className="relative z-20 flex shrink-0 flex-col items-center pt-6 text-center">
      <p className="caps text-ink-3">{line}</p>
      <h1 className="font-display mt-2 max-w-[90%] truncate text-[clamp(36px,6vh,60px)] leading-[1.02] text-ink">{g.title}</h1>
      <div className="mt-5 flex items-center gap-2.5">
        <Button tone="primary" big icon={<Play size={16} fill="currentColor" />} disabled={!g.canLaunch} onClick={() => bridge.send({ type: "launch", gameId: g.id })}>
          {playing ? "Playing" : "Play"}
        </Button>
        <Button big icon={<Info size={16} />} className="!font-medium" onClick={() => openGame(g.id)}>
          Details
        </Button>
      </div>
    </div>
  );
}

/** The dock floating at the foot of the room: the library at a glance, and what's quietly taking up space. */
function Dock({ installed, dusty, onOpen, onStorage, onAll }: { installed: GameView[]; dusty: GameView[]; onOpen(id: number): void; onStorage(): void; onAll(): void }) {
  const sessions = useApp((s) => s.state!.sessions);
  const week = useMemo(() => dailyTotals(sessions, 7).reduce((a, d) => a + d.seconds, 0), [sessions]);
  const size = installed.reduce((a, g) => a + g.sizeBytes, 0);
  const dustSize = dusty.reduce((a, g) => a + g.sizeBytes, 0);
  return (
    <div className="glass relative z-20 mt-6 flex shrink-0 items-center gap-7 !rounded-[24px] px-7 py-4 max-[900px]:gap-5">
      <button onClick={onAll} className="cursor-pointer text-left">
        <Stat value={String(installed.length)} label="Games" />
      </button>
      <button onClick={onStorage} className="cursor-pointer text-left">
        <Stat value={bytes(size)} label="On disk" />
      </button>
      <Stat value={week > 0 ? duration(week) : "—"} label="This week" />
      <span className="h-10 w-px shrink-0 bg-[var(--rule-strong)]" />
      <div className="min-w-0 flex-1">
        {dusty.length > 0 ? (
          <>
            <p className="caps mb-2 truncate text-ink-3">Collecting dust · {dusty.length} {dusty.length === 1 ? "game" : "games"} · {bytes(dustSize)}</p>
            <div className="flex gap-2 overflow-hidden">
              {dusty.slice(0, 12).map((g) => (
                <button key={g.id} onClick={() => onOpen(g.id)} title={`${g.title} · ${bytes(g.sizeBytes)}`} className="group w-[30px] shrink-0 cursor-pointer">
                  <Cover title={g.title} url={g.coverUrl} iconUrl={g.iconUrl} bare className="rounded-[5px] opacity-60 saturate-[0.4] transition group-hover:-translate-y-1 group-hover:opacity-100 group-hover:saturate-100" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[13px] text-ink-2">Everything installed has been played in the last three months.</p>
        )}
      </div>
      {dusty.length > 0 && (
        <Button small onClick={onStorage}>
          Free up space
        </Button>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="num text-[22px] leading-none font-semibold text-ink">{value}</div>
      <div className="caps mt-1.5 text-ink-3">{label}</div>
    </div>
  );
}

const GameCard = memo(function GameCard({ game: g, playing, onOpen }: { game: GameView; playing: boolean; onOpen(): void }) {
  const overdue = isOverdue(g);
  return (
    <button onClick={onOpen} className="group block w-full cursor-pointer text-left" aria-label={`${g.title}, open details`}>
      <div className={clsx("hover-float sheen rounded-[14px]", (overdue || !g.installed || g.hidden) && "opacity-60 saturate-[0.45] group-hover:opacity-100 group-hover:saturate-100")}>
        <Cover title={g.title} url={g.coverUrl} iconUrl={g.iconUrl} meta={sourceName[g.sources[0]]} className={clsx("rounded-[14px]", !g.installed && "grayscale")} />
        {playing && (
          <span className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
            <span className="size-1.5 rounded-full bg-ok" /> Playing
          </span>
        )}
        {g.copies > 1 && (
          <span className="num absolute top-2.5 right-2.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur" title="More than one copy on disk">
            ×{g.copies}
          </span>
        )}
      </div>
      <p className="mt-3 truncate text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{g.title}</p>
      <p className="num mt-0.5 truncate text-[12px] text-ink-3">
        {g.installed ? bytes(g.sizeBytes) : "not installed"} · <span className={overdue ? "text-stamp-red" : undefined}>{g.lastPlayed ? relative(g.lastPlayed) : "never played"}</span>
        {g.playSeconds > 0 && <> · {hours(g.playSeconds)}</>}
      </p>
    </button>
  );
});
