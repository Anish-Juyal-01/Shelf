import clsx from "clsx";
import { ArrowDownWideNarrow, Plus, Search, X } from "lucide-react";
import { memo, useMemo } from "react";
import { bridge } from "../bridge/bridge";
import type { GameView } from "../bridge/protocol";
import { Cover } from "../components/Cover";
import { Button, Chip, Empty, MenuButton, PageHead, Segmented, Stamp } from "../components/ui";
import { bytes, hours, sourceName, stampDate } from "../lib/format";
import { filterGames, isOverdue, sourceCounts, type SortKey } from "../lib/library";
import { useApp } from "../store/store";

const sortLabels: Record<SortKey, string> = {
  recent: "Last played",
  playtime: "Most played",
  name: "Title A–Z",
  size: "Largest first",
};

export function Library() {
  const state = useApp((s) => s.state)!;
  const filter = useApp((s) => s.filter);
  const setFilter = useApp((s) => s.setFilter);
  const openGame = useApp((s) => s.openGame);

  const visible = useMemo(() => filterGames(state.games, filter), [state.games, filter]);
  const installed = state.games.filter((g) => g.installed && !g.hidden);
  const sources = useMemo(() => sourceCounts(state.games.filter((g) => !g.hidden)), [state.games]);
  const overdueCount = installed.filter((g) => isOverdue(g)).length;
  const playing = new Set(state.playing.map((p) => p.gameId));
  const totalSize = installed.reduce((a, g) => a + g.sizeBytes, 0);
  const filtered = filter.query !== "" || filter.sources.length > 0 || filter.overdueOnly || filter.installed !== "installed";

  return (
    <div className="mx-auto max-w-[1500px] px-8 pt-7 pb-16">
      <PageHead
        title="Your shelf"
        sub={`${installed.length} games installed · ${bytes(totalSize)} on disk${overdueCount ? ` · ${overdueCount} overdue` : ""}`}
      >
        <Button icon={<Plus size={15} />} onClick={() => bridge.send({ type: "addExe" })} title="Pick a game's .exe (or drop one on the window)">
          Add a game
        </Button>
      </PageHead>

      <div className="sticky top-0 z-10 -mx-8 mb-6 border-b border-rule bg-bg/92 px-8 pt-1 pb-3 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative flex h-9 min-w-[260px] flex-1 items-center">
            <Search size={15} className="pointer-events-none absolute left-3 text-ink-3" />
            <input
              value={filter.query}
              onChange={(e) => setFilter({ query: e.target.value })}
              placeholder="Search the catalogue — title or folder"
              aria-label="Search games"
              className="h-9 w-full rounded-[6px] border border-rule-strong bg-surface pr-8 pl-9 text-[13.5px] text-ink placeholder:text-ink-4 focus:border-ink-3 focus:outline-none"
            />
            {filter.query && (
              <button onClick={() => setFilter({ query: "" })} aria-label="Clear search" className="absolute right-2 cursor-pointer text-ink-3 hover:text-ink">
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
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Chip tone="red" active={filter.overdueOnly} onClick={() => setFilter({ overdueOnly: !filter.overdueOnly })} count={overdueCount}>
            Overdue
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
            <input type="checkbox" checked={filter.showHidden} onChange={(e) => setFilter({ showHidden: e.target.checked })} className="accent-[var(--accent)]" />
            Show hidden
          </label>
        </div>
      </div>

      {visible.length === 0 ? (
        state.games.length === 0 ? (
          <Empty
            title="The shelf is empty — for now."
            action={
              <>
                <Button tone="primary" onClick={() => useApp.getState().setView("settings")}>Choose folders to scan</Button>
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
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-6 gap-y-8">
          {visible.map((g) => (
            <li key={g.id}>
              <GameCard game={g} playing={playing.has(g.id)} onOpen={() => openGame(g.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const GameCard = memo(function GameCard({ game: g, playing, onOpen }: { game: GameView; playing: boolean; onOpen(): void }) {
  const overdue = isOverdue(g);
  return (
    <button onClick={onOpen} className="group block w-full cursor-pointer text-left" aria-label={`${g.title}, open details`}>
      <div className="relative transition-transform duration-200 ease-out group-hover:-translate-y-1">
        <Cover title={g.title} url={g.coverUrl} className={clsx(!g.installed && "opacity-45 grayscale", g.hidden && "opacity-60")} />
        {overdue && (
          <span className="absolute bottom-3 left-2">
            <Stamp tone="red" tilt={-8} size="sm" className="bg-[var(--surface)]/88">Overdue</Stamp>
          </span>
        )}
        {playing && (
          <span className="absolute top-2 left-2">
            <Stamp tone="green" tilt={-3} size="xs" className="bg-[var(--surface)]/92">Checked out</Stamp>
          </span>
        )}
        {g.copies > 1 && (
          <span className="typed absolute top-2 right-2 rounded-[3px] bg-ink/80 px-1.5 text-[10px] text-[var(--surface)]" title="More than one copy on disk">
            ×{g.copies}
          </span>
        )}
      </div>
      {/* Catalogue slip */}
      <div className="mt-2.5 border-t border-margin-red/60 pt-1.5">
        <p className="font-display line-clamp-2 min-h-[2.5em] text-[15px] leading-[1.25] font-[540] text-ink group-hover:text-accent">{g.title}</p>
        <div className="typed mt-1 flex items-center justify-between gap-2 text-[10.5px] text-ink-3">
          <span className="truncate">{g.sources.map((s) => sourceName[s]).join(" · ")}</span>
          <span className="shrink-0">{g.installed ? bytes(g.sizeBytes) : "not installed"}</span>
        </div>
        <div className="typed flex items-center justify-between gap-2 text-[10.5px]">
          <span className={clsx(g.lastPlayed ? "text-stamp-violet" : "text-ink-4")}>{g.lastPlayed ? `OUT ${stampDate(g.lastPlayed)}` : "NEVER OUT"}</span>
          <span className="text-ink-3">{hours(g.playSeconds)}</span>
        </div>
      </div>
    </button>
  );
});
