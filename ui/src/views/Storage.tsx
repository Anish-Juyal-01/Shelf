import clsx from "clsx";
import { FolderOpen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Cover } from "../components/Cover";
import { squarify } from "../lib/treemap";
import { bridge } from "../bridge/bridge";
import type { DriveView, GameView } from "../bridge/protocol";
import { Button, Empty, PageHead, SectionTitle, Tag } from "../components/ui";
import { bytes, relative, sourceName } from "../lib/format";
import { isOverdue, OVERDUE_DAYS } from "../lib/library";
import { useApp } from "../store/store";

export function Storage() {
  const state = useApp((s) => s.state)!;
  const openGame = useApp((s) => s.openGame);
  const installed = useMemo(() => state.games.filter((g) => g.installed).sort((a, b) => b.sizeBytes - a.sizeBytes), [state.games]);
  const overdue = installed.filter((g) => isOverdue(g));
  const dupes = installed.filter((g) => g.copies > 1);
  const total = installed.reduce((a, g) => a + g.sizeBytes, 0);
  const overdueBytes = overdue.reduce((a, g) => a + g.sizeBytes, 0);
  const leftoverBytes = state.leftovers.reduce((a, l) => a + l.sizeBytes, 0);

  return (
    <div className="mx-auto max-w-[1180px] px-8 pt-7 pb-16">
      <PageHead
        title="Storage"
        sub={<>{bytes(total)} of games · {overdueBytes + leftoverBytes > 0 ? `${bytes(overdueBytes + leftoverBytes)} you could probably free` : "nothing sitting idle right now"}</>}
      />
      <p className="mb-7 max-w-[680px] text-[13px] text-ink-2">
        Shelf never deletes anything. <em>Uninstall</em> opens the launcher's own uninstaller (or Windows' Installed apps);
        for loose games and leftovers, Shelf opens the folder so you can decide.
      </p>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
        {state.drives.map((d) => <DriveMeter key={d.root} drive={d} />)}
      </div>

      {installed.length > 0 && <DiskMap games={installed} onOpen={openGame} />}

      <section className="mt-12">
        <SectionTitle aside={overdue.length ? `${overdue.length} games · ${bytes(overdueBytes)}` : undefined}>Untouched for {OVERDUE_DAYS}+ days</SectionTitle>
        {overdue.length === 0 ? (
          <p className="text-[13px] text-ink-3">Everything installed has been played in the last three months.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {overdue.map((g) => <GameRow key={g.id} game={g} onOpen={() => openGame(g.id)} />)}
          </ul>
        )}
      </section>

      {dupes.length > 0 && (
        <section className="mt-12">
          <SectionTitle aside={`${dupes.length} games`}>Installed more than once</SectionTitle>
          <ul className="divide-y divide-rule">
            {dupes.map((g) => <GameRow key={g.id} game={g} onOpen={() => openGame(g.id)} note={`${g.copies} copies — open to see where each one lives`} />)}
          </ul>
        </section>
      )}

      <section className="mt-12">
        <SectionTitle aside={state.leftovers.length ? `${state.leftovers.length} items · ${bytes(leftoverBytes)}` : undefined}>Leftovers — downloads and installers</SectionTitle>
        {state.leftovers.length === 0 ? (
          state.settings.scanRoots.length === 0 ? (
            <Empty title="No scan folders yet." action={<Button onClick={() => useApp.getState().setView("settings")}>Add your Downloads folder</Button>}>
              Leftover zips and un-run installers are found in the folders Shelf scans.
            </Empty>
          ) : (
            <p className="text-[13px] text-ink-3">No big archives or un-run installers in your scan folders.</p>
          )
        ) : (
          <ul className="divide-y divide-rule">
            {state.leftovers.map((l) => (
              <li key={l.path} className="flex items-center gap-4 py-3">
                <Tag size="xs" tone={l.kind === "installer" ? "violet" : "ink"} tilt={0} className="w-[78px] text-center">{l.kind === "installer" ? "Installer" : "Archive"}</Tag>
                <div className="min-w-0 flex-1">
                  <p className="font-display truncate text-[20px] leading-tight text-ink">{l.title}</p>
                  <p className="typed truncate text-[11.5px] text-ink-3" title={l.path}>{l.path}</p>
                </div>
                <span className="typed w-[72px] text-right text-[13px] text-ink">{bytes(l.sizeBytes)}</span>
                <Button small icon={<FolderOpen size={13} />} onClick={() => bridge.send({ type: "reveal", path: l.path })}>Show</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DriveMeter({ drive: d }: { drive: DriveView }) {
  const used = d.totalBytes - d.freeBytes;
  const other = Math.max(0, used - d.gamesBytes);
  const pct = (n: number) => `${(n / d.totalBytes) * 100}%`;
  const low = d.freeBytes / d.totalBytes < 0.1;
  return (
    <div className="paper rounded-[4px] px-5 py-4">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[20px] text-ink">
          {d.root.replace("\\", "")} <span className="text-[14px] text-ink-3">{d.label}</span>
        </span>
        <span className={clsx("typed text-[12px]", low ? "text-stamp-red" : "text-ink-2")}>{bytes(d.freeBytes)} free</span>
      </div>
      <div className="mt-3 flex h-3 overflow-hidden rounded-[2px] border border-rule-strong bg-surface-2" role="img"
        aria-label={`${bytes(d.gamesBytes)} games, ${bytes(other)} other, ${bytes(d.freeBytes)} free of ${bytes(d.totalBytes)}`}>
        <div className="bg-accent" style={{ width: pct(d.gamesBytes) }} />
        <div className="hatch bg-sunken" style={{ width: pct(other) }} />
      </div>
      <div className="typed mt-2 flex gap-4 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-[1px] bg-accent" /> games {bytes(d.gamesBytes)}</span>
        <span className="flex items-center gap-1.5"><span className="hatch size-2 rounded-[1px] border border-rule-strong" /> other {bytes(other)}</span>
        <span className="ml-auto">{bytes(d.totalBytes)}</span>
      </div>
      {low && <p className="mt-2 text-[12px] text-stamp-red">Less than 10% free — Windows and games slow down when a drive is this full.</p>}
    </div>
  );
}

/** Disk map: every installed game as a tile whose area is its share of the space games use. */
function DiskMap({ games, onOpen }: { games: GameView[]; onOpen(id: number): void }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1000);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 360;
  const list = games.filter((g) => g.sizeBytes > 0);
  const rects = squarify(list.map((g) => g.sizeBytes), w, H);
  return (
    <section className="mt-10">
      <SectionTitle aside="area = space on disk · click a game">What's using the space</SectionTitle>
      <div ref={box} className="relative overflow-hidden rounded-[14px]" style={{ height: H }}>
        {list.map((g, i) => {
          const r = rects[i];
          if (r.w < 2 || r.h < 2) return null;
          const idle = isOverdue(g);
          const big = r.w > 120 && r.h > 70;
          return (
            <button
              key={g.id}
              onClick={() => onOpen(g.id)}
              title={`${g.title} — ${bytes(g.sizeBytes)}${idle ? " · not played in 90+ days" : ""}`}
              aria-label={`${g.title}, ${bytes(g.sizeBytes)}`}
              className="group absolute cursor-pointer overflow-hidden text-left"
              style={{ left: r.x, top: r.y, width: r.w, height: r.h, padding: 2 }}
            >
              <div className="relative size-full overflow-hidden rounded-[10px]">
                <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-105">
                  <TileArt game={g} />
                </div>
                <div className={clsx("absolute inset-0", idle ? "bg-black/55" : "bg-gradient-to-t from-black/70 via-black/10 to-transparent")} />
                {big && (
                  <div className="absolute right-3 bottom-2.5 left-3 text-white">
                    <p className="font-display truncate text-[22px] leading-none">{g.title}</p>
                    <p className="typed mt-1 text-[11px] opacity-85">{bytes(g.sizeBytes)}{idle && " · untouched 90+ days"}</p>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Wide art for a tile: Steam hero image, else the cover, else the generated poster. */
function TileArt({ game: g }: { game: GameView }) {
  const src = g.heroUrl ?? g.coverUrl;
  if (src) return <img src={src} alt="" draggable={false} className="size-full object-cover" />;
  return <Cover title={g.title} url={null} iconUrl={g.iconUrl} bare className="!aspect-auto size-full" />;
}

function GameRow({ game: g, onOpen, note }: { game: GameView; onOpen(): void; note?: string }) {
  return (
    <li className="flex items-center gap-4 py-3">
      <Cover title={g.title} url={g.coverUrl} iconUrl={g.iconUrl} bare className="w-9 shrink-0 rounded-[5px] !shadow-none" />
      <button onClick={onOpen} className="min-w-0 flex-1 cursor-pointer text-left">
        <p className="font-display truncate text-[20px] leading-tight text-ink hover:text-accent">{g.title}</p>
        <p className="typed truncate text-[11.5px] text-ink-3">
          {note ?? <>{g.sources.map((s) => sourceName[s]).join(" + ")} · last played {relative(g.lastPlayed)}</>}
        </p>
      </button>
      <span className="typed w-[72px] text-right text-[13px] text-ink">{bytes(g.sizeBytes)}</span>
      <Button small onClick={onOpen}>Details</Button>
    </li>
  );
}
