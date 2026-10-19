import clsx from "clsx";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, Eye, EyeOff, FolderOpen, MoreHorizontal, Pencil, Play, Trash2 } from "lucide-react";
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
    <div className="mx-auto max-w-[1180px] px-8 pt-5 pb-16">
      <button onClick={() => openGame(null)} className="mb-5 inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft size={14} /> Back to {view === "library" ? "the shelf" : view}
      </button>

      <div className="grid grid-cols-[minmax(200px,280px)_1fr] gap-10 max-[820px]:grid-cols-1">
        <div className="relative max-w-[280px]">
          <Cover title={game.title} url={game.coverUrl} iconUrl={game.iconUrl} bare large className={clsx("rounded-[18px]", !game.installed && "opacity-50 grayscale")} />
          {overdue && (
            <span className="absolute -right-3 bottom-8">
              <Tag tone="red" size="lg" className="bg-[var(--surface)]">Untouched 90+ days</Tag>
            </span>
          )}
        </div>

        <div className="min-w-0">
          <p className="typed text-[11.5px] tracking-[0.12em] text-ink-3">
            {game.sources.map((s) => sourceName[s]).join(" + ")}
          </p>
          <h1 className="font-display mt-1 text-[72px] leading-[0.92] text-balance text-ink">{game.title}</h1>
          {playing && (
            <p className="mt-2 flex items-center gap-2 text-[13px] text-ok">
              <span className="pulse-dot size-2 rounded-full bg-ok" /> Playing now — started {relative(playing.since)}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button tone="primary" icon={<Play size={15} fill="currentColor" />} disabled={!game.canLaunch || !game.installed} onClick={() => bridge.send({ type: "launch", gameId: game.id })}>
              Play
            </Button>
            {game.path && (
              <Button icon={<FolderOpen size={15} />} onClick={() => bridge.send({ type: "openFolder", path: game.path! })}>
                Open folder
              </Button>
            )}
            <MenuButton
              trigger={
                <IconButton label="More" className="border border-rule-strong">
                  <MoreHorizontal size={16} />
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

          <GlanceCard detail={detail} />
        </div>
      </div>

      {detail && (
        <div className="mt-12 grid grid-cols-[1fr_1fr] gap-10 max-[980px]:grid-cols-1">
          <Sessions sessions={detail.sessions} importedSeconds={detail.game.importedSeconds} />
          <Copies installs={detail.installs} />
        </div>
      )}

      <RenameDialog open={renaming} onOpenChange={setRenaming} id={game.id} title={game.title} />
    </div>
  );
}

function GlanceCard({ detail }: { detail: GameDetail | null }) {
  const fallback = useApp((s) => s.state?.games.find((g) => g.id === s.gameId));
  const g = detail?.game ?? fallback!;
  const rows: [string, React.ReactNode][] = [
    ["Played", <>{hours(g.playSeconds)}{g.importedSeconds > 0 && <span className="text-ink-3"> · {hours(g.importedSeconds)} counted by {g.sources.includes("steam") ? "Steam" : "the launcher"} before Shelf</span>}</>],
    ["Last played", g.lastPlayed ? <span className="text-stamp-violet">{stampDate(g.lastPlayed)} · {relative(g.lastPlayed)}</span> : <span className="text-ink-3">Never, as far as Shelf knows</span>],
    ["Sessions", detail ? `${detail.sessions.length} recorded by Shelf` : "…"],
    ["On disk", g.installed ? <>{bytes(g.sizeBytes)}{g.copies > 1 && <span className="text-stamp-red"> · {g.copies} copies</span>}</> : <span className="text-stamp-red">Folder no longer exists</span>],
    ["Location", <span className="break-all">{g.path ?? "—"}</span>],
    ["First seen", stampDate(g.firstSeen)],
  ];
  return (
    <dl className="index-card typed mt-7 max-w-[640px] rounded-[3px] px-6 pt-2 pb-3 text-[12.5px] leading-[28px]">
      <dt className="caps h-[38px] pt-[7px] text-ink-3">At a glance</dt>
      <dd className="hidden" />
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[96px_1fr] gap-3">
          <dt className="text-ink-3 uppercase">{k}</dt>
          <dd className="min-w-0 text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Sessions({ sessions, importedSeconds }: { sessions: SessionView[]; importedSeconds: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? sessions : sessions.slice(0, 12);
  return (
    <section>
      <SectionTitle aside={sessions.length ? `${duration(sessions.reduce((a, s) => a + s.seconds, 0))} tracked` : undefined}>Sessions</SectionTitle>
      {sessions.length === 0 ? (
        <p className="text-[13px] text-ink-3">
          No sessions recorded yet. Shelf counts play whenever it's running, even if you start the game from somewhere else.
          {importedSeconds > 0 && ` The ${hours(importedSeconds)} above came from the launcher's own counter.`}
        </p>
      ) : (
        <div className="paper rounded-[3px]">
          <div className="caps grid grid-cols-[1fr_1fr_80px] border-b-2 border-ink/70 px-4 py-2 text-ink-3">
            <span>Date</span>
            <span>Time</span>
            <span className="text-right">Length</span>
          </div>
          <ul className="typed text-[12.5px]">
            {shown.map((s, i) => (
              <li key={s.id} className={clsx("grid grid-cols-[1fr_1fr_80px] px-4 py-1.5", i % 2 === 1 && "bg-sunken/35")}>
                <span className="text-stamp-violet">{stampDate(s.start)}</span>
                <span className="text-ink-2">
                  {clock(s.start)}–{s.end ? clock(s.end) : "now"}
                  {s.reason && s.reason !== "clean" && <span className="ml-2 text-[10.5px] text-ink-4" title={reasonText(s.reason)}>{s.reason === "heartbeat" ? "recovered" : s.reason === "suspend" ? "sleep" : ""}</span>}
                </span>
                <span className="text-right text-ink">{duration(s.seconds)}</span>
              </li>
            ))}
          </ul>
          {sessions.length > 12 && (
            <button onClick={() => setAll(!all)} className="w-full cursor-pointer border-t border-rule py-2 text-[12px] text-ink-3 hover:text-ink">
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
          <li key={i.id} className="paper rounded-[3px] px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Tag size="xs" tilt={0}>{sourceName[i.source]}</Tag>
                  {i.state !== "installed" && <Tag size="xs" tone="red" tilt={0}>{i.state === "missing" ? "folder missing" : "removed"}</Tag>}
                  <span className="typed text-[11.5px] text-ink-3">{bytes(i.sizeBytes)}</span>
                </div>
                <p className="typed mt-1.5 text-[12px] break-all text-ink-2">{i.path}</p>
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
                <ul className="typed mt-1.5 space-y-0.5 text-[11.5px] text-ink-2">
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
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/35" />
        <Dialog.Content className="slip fixed top-1/2 left-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-[4px] px-6 pt-2 pb-5">
          <Dialog.Title className="caps h-[38px] pt-[7px] text-ink-3">Rename</Dialog.Title>
          <Dialog.Description className="mt-1 text-[13px] text-ink-2">Shelf keeps your title even when the folder or launcher says otherwise.</Dialog.Description>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) bridge.send({ type: "rename", gameId: id, title: value.trim() });
              onOpenChange(false);
            }}
          >
            <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-label="Title"
              className="font-display mt-4 h-11 w-full rounded-[5px] border border-rule-strong bg-surface px-3 text-[18px] text-ink focus:border-ink-3 focus:outline-none" />
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
