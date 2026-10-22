import clsx from "clsx";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, Eye, EyeOff, FolderOpen, MoreHorizontal, Pencil, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { bridge } from "../bridge/bridge";
import type { GameDetail, InstallView, SessionView } from "../bridge/protocol";
import { Cover } from "../components/Cover";
import { Button, IconButton, MenuButton, SectionTitle, Tag } from "../components/ui";
import { bytes, clock, duration, hours, relative, sourceName, stampDate } from "../lib/format";
import { isOverdue } from "../lib/library";
import { useApp } from "../store/store";

export function GamePage() {
  const gameId = useApp((s) => s.gameId)!;
  const detail = useApp((s) => s.detail);
  const fallback = useApp((s) => s.state?.games.find((g) => g.id === gameId));
  const playing = useApp((s) => s.state?.playing.find((p) => p.gameId === gameId));
  const openGame = useApp((s) => s.openGame);
  const view = useApp((s) => s.view);
  const [renaming, setRenaming] = useState(false);
  const game = detail?.game ?? fallback;
  if (!game) return null;
  const overdue = isOverdue(game);

  return (
    <div className="mx-auto max-w-[1240px] px-10 pt-4 pb-16">
      <button onClick={() => openGame(null)} className="glass-flat mb-7 inline-flex h-9 cursor-pointer items-center gap-1 rounded-full pr-4 pl-2.5 text-[13px] font-medium text-ink hover:bg-[var(--surface-2)]">
        <ChevronLeft size={16} /> {view === "library" ? "Library" : view[0].toUpperCase() + view.slice(1)}
      </button>

      <div className="grid grid-cols-[minmax(220px,300px)_1fr] gap-14 max-[860px]:grid-cols-1 max-[860px]:gap-8">
        {/* The cover hangs in the room, turned slightly toward the text. */}
        <div className="stage relative max-w-[300px]">
          <div className="float" style={{ transform: "rotateY(13deg) rotateX(2deg)", transformStyle: "preserve-3d" }}>
            <div className="sheen rounded-[20px]">
              <Cover title={game.title} url={game.coverUrl} iconUrl={game.iconUrl} meta={sourceName[game.sources[0]]} large className={clsx("rounded-[20px]", !game.installed && "opacity-50 grayscale")} />
            </div>
          </div>
          <div className="mx-auto mt-3 h-7 w-[80%] rounded-[50%] bg-black/40 blur-xl" />
          {overdue && (
            <span className="absolute top-4 -right-3">
              <Tag tone="red" size="lg">Untouched 90+ days</Tag>
            </span>
          )}
        </div>

        <div className="min-w-0 pt-6">
          <p className="caps text-ink-3">
            {[game.sources.map((s) => sourceName[s]).join(" + "), game.installed ? "installed" : "not installed", game.lastPlayed ? `last played ${relative(game.lastPlayed)}` : "never played"].join(" · ")}
          </p>
          <h1 className="font-display mt-3 text-[clamp(44px,7vw,84px)] leading-[0.95] text-balance text-ink">{game.title}</h1>
          {playing && (
            <p className="mt-3 flex items-center gap-2 text-[13.5px] font-medium text-ok">
              <span className="relative flex size-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-ok opacity-60" />
                <span className="relative size-2 rounded-full bg-ok" />
              </span>
              Playing now — started {relative(playing.since)}
            </p>
          )}

          <div className="mt-7 flex flex-wrap items-center gap-2.5">
            <Button tone="primary" big icon={<Play size={16} fill="currentColor" />} disabled={!game.canLaunch || !game.installed} onClick={() => bridge.send({ type: "launch", gameId: game.id })}>
              Play
            </Button>
            {game.path && (
              <Button big className="!font-medium" icon={<FolderOpen size={16} />} onClick={() => bridge.send({ type: "openFolder", path: game.path! })}>
                Open folder
              </Button>
            )}
            <MenuButton
              trigger={
                <IconButton label="More" className="glass-flat size-12 text-ink-2">
                  <MoreHorizontal size={18} />
                </IconButton>
              }
              items={[
                { label: "Rename…", icon: <Pencil size={14} />, onSelect: () => setRenaming(true) },
                game.hidden
                  ? { label: "Show in library", icon: <Eye size={14} />, onSelect: () => bridge.send({ type: "setHidden", gameId: game.id, hidden: false }) }
                  : { label: "Hide from library", icon: <EyeOff size={14} />, onSelect: () => bridge.send({ type: "setHidden", gameId: game.id, hidden: true }) },
              ]}
            />
          </div>

          <Glance detail={detail} />
        </div>
      </div>

      {detail && (
        <div className="mt-12 grid grid-cols-[1fr_1fr] gap-6 max-[980px]:grid-cols-1">
          <Sessions sessions={detail.sessions} importedSeconds={detail.game.importedSeconds} />
          <Copies installs={detail.installs} />
        </div>
      )}

      <RenameDialog open={renaming} onOpenChange={setRenaming} id={game.id} title={game.title} />
    </div>
  );
}

/** The four numbers that matter, on one pane of glass; where it lives and when Shelf first saw it underneath. */
function Glance({ detail }: { detail: GameDetail | null }) {
  const fallback = useApp((s) => s.state?.games.find((g) => g.id === s.gameId));
  const g = detail?.game ?? fallback!;
  const cells: [string, string][] = [
    [g.playSeconds > 0 ? hours(g.playSeconds) : "—", "Played"],
    [detail ? String(detail.sessions.length) : "…", "Sessions"],
    [g.installed ? bytes(g.sizeBytes) : "—", g.copies > 1 ? `On disk · ${g.copies} copies` : "On disk"],
    [g.lastPlayed ? stampDate(g.lastPlayed) : "Never", "Last played"],
  ];
  return (
    <div className="mt-10 max-w-[760px]">
      <div className="glass grid grid-cols-4 !rounded-[22px] px-7 py-6 max-[700px]:grid-cols-2 max-[700px]:gap-y-5">
        {cells.map(([v, k], i) => (
          <div key={k} className={clsx("min-w-0", i > 0 && "border-l border-[var(--rule)] pl-6", i === 2 && "max-[700px]:border-0 max-[700px]:pl-0")}>
            <div className="num truncate text-[30px] leading-none font-semibold text-ink">{v}</div>
            <div className="caps mt-2 text-ink-3">{k}</div>
          </div>
        ))}
      </div>
      <p className="mt-4 px-2 text-[12.5px] text-ink-3">
        {g.importedSeconds > 0 && <>{hours(g.importedSeconds)} counted by {g.sources.includes("steam") ? "Steam" : "the launcher"} before Shelf · </>}
        first seen {stampDate(g.firstSeen)}
        {g.path && <> · <span className="font-mono text-[11.5px] break-all text-ink-2">{g.path}</span></>}
        {!g.installed && <span className="text-stamp-red"> · folder no longer exists</span>}
      </p>
    </div>
  );
}

function Sessions({ sessions, importedSeconds }: { sessions: SessionView[]; importedSeconds: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? sessions : sessions.slice(0, 12);
  return (
    <section>
      <SectionTitle aside={sessions.length ? `${duration(sessions.reduce((a, s) => a + s.seconds, 0))} tracked` : undefined}>Sessions</SectionTitle>
      {sessions.length === 0 ? (
        <p className="glass px-5 py-4 text-[13px] text-ink-3">
          No sessions recorded yet. Shelf counts play whenever it's running, even if you start the game from somewhere else.
          {importedSeconds > 0 && ` The ${hours(importedSeconds)} above came from the launcher's own counter.`}
        </p>
      ) : (
        <div className="glass overflow-hidden">
          <div className="caps grid grid-cols-[1fr_1fr_80px] border-b border-[var(--rule)] px-5 py-3 text-ink-3">
            <span>Date</span>
            <span>Time</span>
            <span className="text-right">Length</span>
          </div>
          <ul className="num text-[13px]">
            {shown.map((s, i) => (
              <li key={s.id} className={clsx("grid grid-cols-[1fr_1fr_80px] px-5 py-2", i % 2 === 1 && "bg-[var(--sunken)]")}>
                <span className="text-ink">{stampDate(s.start)}</span>
                <span className="text-ink-2">
                  {clock(s.start)}–{s.end ? clock(s.end) : "now"}
                  {s.reason && s.reason !== "clean" && <span className="ml-2 text-[10.5px] text-ink-4" title={reasonText(s.reason)}>{s.reason === "heartbeat" ? "recovered" : s.reason === "suspend" ? "sleep" : ""}</span>}
                </span>
                <span className="text-right text-ink">{duration(s.seconds)}</span>
              </li>
            ))}
          </ul>
          {sessions.length > 12 && (
            <button onClick={() => setAll(!all)} className="w-full cursor-pointer border-t border-[var(--rule)] py-2.5 text-[12.5px] font-medium text-ink-3 hover:text-ink">
              {all ? "Show fewer" : `Show all ${sessions.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

const reasonText = (r: string) =>
  r === "heartbeat" ? "Shelf closed unexpectedly; the session was ended at its last check-in"
    : r === "suspend" ? "The PC went to sleep"
      : r === "app_exit" ? "Shelf was closed" : "";

function Copies({ installs }: { installs: InstallView[] }) {
  return (
    <section>
      <SectionTitle aside={installs.length > 1 ? `${installs.length} copies` : undefined}>Where it lives</SectionTitle>
      <ul className="space-y-3">
        {installs.map((i) => (
          <li key={i.id} className="glass px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Tag size="xs" tilt={0}>{sourceName[i.source]}</Tag>
                  {i.state !== "installed" && <Tag size="xs" tone="red" tilt={0}>{i.state === "missing" ? "folder missing" : "removed"}</Tag>}
                  <span className="num text-[12px] text-ink-3">{bytes(i.sizeBytes)}</span>
                </div>
                <p className="mt-2 font-mono text-[12px] break-all text-ink-2">{i.path}</p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {i.state === "installed" && (
                  <IconButton label="Open folder" onClick={() => bridge.send({ type: "openFolder", path: i.path })}>
                    <FolderOpen size={15} />
                  </IconButton>
                )}
                {i.uninstallLabel && (
                  <Button small tone="danger" icon={<Trash2 size={13} />} onClick={() => bridge.send({ type: "uninstall", installId: i.id })} title="Opens the launcher's own uninstaller — Shelf never deletes files itself">
                    {i.uninstallLabel}
                  </Button>
                )}
              </div>
            </div>
            {i.signals.length > 0 && (
              <details className="mt-2 text-[12px]">
                <summary className="cursor-pointer text-ink-3 hover:text-ink">Why Shelf thinks this is a game ({i.confidence}%)</summary>
                <ul className="mt-1.5 space-y-0.5 font-mono text-[11.5px] text-ink-2">
                  {i.signals.map((s) => <li key={s}>{s}</li>)}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RenameDialog({ open, onOpenChange, id, title }: { open: boolean; onOpenChange(v: boolean): void; id: number; title: string }) {
  const [value, setValue] = useState(title);
  return (
    <Dialog.Root open={open} onOpenChange={(v) => { setValue(title); onOpenChange(v); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/35 backdrop-blur-sm" />
        <Dialog.Content className="glass fixed top-1/2 left-1/2 z-50 w-[460px] -translate-x-1/2 -translate-y-1/2 px-7 pt-6 pb-6">
          <Dialog.Title className="font-display text-[26px] leading-none text-ink">Rename</Dialog.Title>
          <Dialog.Description className="mt-1 text-[13px] text-ink-2">Shelf keeps your title even when the folder or launcher says otherwise.</Dialog.Description>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) bridge.send({ type: "rename", gameId: id, title: value.trim() });
              onOpenChange(false);
            }}
          >
            <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-label="Title"
              className="mt-5 h-12 w-full rounded-[14px] border border-[var(--edge)] bg-[var(--sunken)] px-4 text-[17px] font-medium text-ink focus:border-accent focus:outline-none" />
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close asChild><Button tone="quiet" type="button">Cancel</Button></Dialog.Close>
              <Button tone="primary" type="submit">Save</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
