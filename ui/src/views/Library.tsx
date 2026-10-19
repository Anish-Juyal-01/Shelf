import clsx from "clsx";
import { ArrowDownWideNarrow, Plus, Search, X } from "lucide-react";
import { memo, useMemo, useRef } from "react";
import { bridge } from "../bridge/bridge";
import type { GameView } from "../bridge/protocol";
import { Cover } from "../components/Cover";
import { RingHero, WheelHero } from "../components/Heroes";
import { Button, Chip, Empty, MenuButton, Segmented } from "../components/ui";
import { bytes, hours, relative, sourceName } from "../lib/format";
import { headline, type Part } from "../lib/headline";
import { filterGames, isOverdue, sourceCounts, type SortKey } from "../lib/library";
import { useApp } from "../store/store";

const sortLabels: Record<SortKey, string> = {
  recent: "Last played",
  playtime: "Most played",
  name: "Title A–Z",
  size: "Largest first",
};

const ulineColor = { blue: "var(--u-blue)", red: "var(--u-red)", yellow: "var(--u-yellow)", ink: "var(--u-ink)" } as const;

export function Library() {
  const state = useApp((s) => s.state)!;
  const filter = useApp((s) => s.filter);
  const setFilter = useApp((s) => s.setFilter);
  const setView = useApp((s) => s.setView);
  const openGame = useApp((s) => s.openGame);
  const grid = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => filterGames(state.games, filter), [state.games, filter]);
  const installed = useMemo(() => state.games.filter((g) => g.installed && !g.hidden), [state.games]);
  const heroGames = useMemo(
    () => [...installed].sort((a, b) => Date.parse(b.lastPlayed ?? b.firstSeen) - Date.parse(a.lastPlayed ?? a.firstSeen)),
    [installed],
  );
  const sources = useMemo(() => sourceCounts(state.games.filter((g) => !g.hidden)), [state.games]);
  const overdueCount = installed.filter((g) => isOverdue(g)).length;
  const playing = new Set(state.playing.map((p) => p.gameId));
  const totalSize = installed.reduce((a, g) => a + g.sizeBytes, 0);
  const filtered = filter.query !== "" || filter.sources.length > 0 || filter.overdueOnly || filter.installed !== "installed";
  const parts = headline(state.games, state.playing);

  const act = (p: Exclude<Part, string>) => {
    if ("gameId" in p.action) openGame(p.action.gameId);
    else if (p.action.view === "library") grid.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    else setView(p.action.view);
  };

  return (
    <div className="pb-16">
      {/* Sky hero, framed like a window onto the sunset. */}
      {installed.length > 0 && (
        <section className="relative mx-5 h-[clamp(300px,46vh,520px)] overflow-hidden rounded-[22px] ring-1 ring-black/5" aria-label="Your games">
          {state.settings.heroStyle === "ring"
            ? <RingHero games={heroGames} onOpen={openGame} />
            : <WheelHero games={heroGames} onOpen={openGame} />}
        </section>
      )}

      {/* Editorial headline + one big number. */}
      <section className="mx-auto flex max-w-[1500px] flex-wrap items-end justify-between gap-x-12 gap-y-6 px-9 pt-7 pb-8">
        <h1 className="font-display max-w-[880px] text-[clamp(28px,3.1vw,42px)] leading-[1.08] text-ink">
          {parts.map((p, i) =>
            typeof p === "string" ? (
              <span key={i}>{p}</span>
            ) : (
              <button key={i} onClick={() => act(p)} className="uline cursor-pointer" style={{ ["--u" as string]: ulineColor[p.color] }}>
                {p.text}
              </button>
            ),
          )}
        </h1>
        <div className="text-right">
          <div className="font-display text-[clamp(48px,5vw,72px)] leading-[0.9] text-ink">{bytes(totalSize)}</div>
          <div className="typed mt-1 text-[11px] text-ink-3">on disk · {installed.length} games</div>
        </div>
      </section>

      <div ref={grid} className="mx-auto max-w-[1500px] scroll-mt-2 px-9">
        <div className="sticky top-0 z-10 -mx-9 mb-7 bg-bg/90 px-9 pt-2 pb-3 backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative flex h-10 min-w-[260px] flex-1 items-center">
              <Search size={16} className="pointer-events-none absolute left-3.5 text-ink-3" />
              <input
                value={filter.query}
                onChange={(e) => setFilter({ query: e.target.value })}
                placeholder="Search your games — title or folder"
                aria-label="Search games"
                className="h-10 w-full rounded-full border border-rule-strong bg-surface pr-9 pl-10 text-[14px] text-ink placeholder:text-ink-4 focus:border-ink-3 focus:outline-none"
              />
              {filter.query && (
                <button onClick={() => setFilter({ query: "" })} aria-label="Clear search" className="absolute right-3 cursor-pointer text-ink-3 hover:text-ink">
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
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Chip tone="red" active={filter.overdueOnly} onClick={() => setFilter({ overdueOnly: !filter.overdueOnly })} count={overdueCount}>
              Not played in 90 days
            </Chip>
            <span className="mx-1 h-4 w-px bg-rule-strong" />
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
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-3">
              <input type="checkbox" checked={filter.showHidden} onChange={(e) => setFilter({ showHidden: e.target.checked })} className="accent-[var(--ink)]" />
              Show hidden
            </label>
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
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(172px,1fr))] gap-x-7 gap-y-10">
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

const GameCard = memo(function GameCard({ game: g, playing, onOpen }: { game: GameView; playing: boolean; onOpen(): void }) {
  const overdue = isOverdue(g);
  return (
    <button onClick={onOpen} className="group block w-full cursor-pointer text-left" aria-label={`${g.title}, open details`}>
      <div className="relative transition-transform duration-300 ease-out group-hover:-translate-y-1.5 group-hover:rotate-[-1deg]">
        <Cover title={g.title} url={g.coverUrl} className={clsx("rounded-[12px] ring-1 ring-black/5", !g.installed && "opacity-45 grayscale", g.hidden && "opacity-60")} />
        {playing && (
          <span className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-[var(--surface)] px-2.5 py-0.5 text-[11px] font-medium text-ok shadow">
            <span className="pulse-dot size-1.5 rounded-full bg-ok" /> playing
          </span>
        )}
        {g.copies > 1 && (
          <span className="typed absolute top-2.5 right-2.5 rounded-full bg-ink/80 px-2 text-[10.5px] text-[var(--bg)]" title="More than one copy on disk">
            ×{g.copies}
          </span>
        )}
      </div>
      <p className="font-display mt-3 line-clamp-2 text-[21px] leading-[1.05] text-ink">
        <span className={clsx("transition-[text-decoration-color]", overdue ? "uline [--u:var(--u-yellow)]" : "decoration-transparent group-hover:uline")}>{g.title}</span>
      </p>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px] text-ink-3">
        <span className="truncate">{g.sources.map((s) => sourceName[s]).join(" · ")} · {g.installed ? bytes(g.sizeBytes) : "not installed"}</span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className={overdue ? "text-u-red" : "text-ink-3"}>{g.lastPlayed ? relative(g.lastPlayed) : "never played"}</span>
        <span className="typed text-[11px] text-ink-2">{hours(g.playSeconds)}</span>
      </div>
    </button>
  );
});
