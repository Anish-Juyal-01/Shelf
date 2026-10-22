import clsx from "clsx";
import { AlertTriangle, Copy, Minus, RefreshCw, Search, Square, X } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { bridge } from "../bridge/bridge";
import type { ResizeEdge, View } from "../bridge/protocol";
import { duration } from "../lib/format";
import { useApp, useGameMap } from "../store/store";
import { useNow } from "./useNow";

function startDrag(e: MouseEvent, edge: ResizeEdge) {
  if (e.button !== 0) return;
  e.preventDefault();
  bridge.send({ type: "window", action: "drag", edge });
}

const sections: { view: View; label: string }[] = [
  { view: "library", label: "Library" },
  { view: "activity", label: "Activity" },
  { view: "storage", label: "Storage" },
  { view: "review", label: "Review" },
  { view: "settings", label: "Settings" },
];

/**
 * The title bar, floating over the room: the Shelf mark on the left, the sections in a glass pill in the middle,
 * what's playing, scan status and the window buttons on the right. Empty space drags the window.
 */
export function TopBar() {
  const maximized = useApp((s) => s.maximized);
  const view = useApp((s) => s.view);
  const gameId = useApp((s) => s.gameId);
  const setView = useApp((s) => s.setView);
  const review = useApp((s) => s.state?.review.length ?? 0);
  const problems = useApp((s) => s.state?.sources.filter((x) => x.state === "partial" || x.state === "unreadable").length ?? 0);

  const search = () => {
    setView("library");
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Search games"]');
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
      input?.focus({ preventScroll: true });
    }, 60);
  };

  return (
    <header
      className="relative z-30 flex h-16 shrink-0 items-center gap-3 pl-5"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button, a")) return;
        startDrag(e, "caption");
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a")) return;
        bridge.send({ type: "window", action: "maximize" });
      }}
    >
      <button onClick={() => setView("library")} className="flex shrink-0 cursor-pointer items-center gap-2.5" aria-label="Shelf — library">
        <img src="./icon.svg" alt="" className="size-7 rounded-[8px] shadow-[0_6px_16px_-6px_rgb(0_0_0/0.6)]" draggable={false} />
        <span className="text-[17px] font-semibold tracking-[-0.02em] text-ink max-[1000px]:hidden">Shelf</span>
      </button>
      {bridge.isPreview && (
        <span className="glass-flat shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold tracking-[0.08em] whitespace-nowrap text-ink-3 uppercase max-[1180px]:hidden">preview data</span>
      )}

      <div className="min-w-2 flex-1" />
      <nav aria-label="Sections" className="glass flex shrink-0 items-center gap-0.5 rounded-full p-1 text-[13.5px] font-medium">
        {sections.map((s) => {
          const active = view === s.view && gameId === null;
          return (
            <button
              key={s.view}
              onClick={() => setView(s.view)}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "relative flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-1.5 whitespace-nowrap transition-colors max-[900px]:px-3",
                active ? "bg-[var(--surface-2)] text-ink shadow-[inset_0_1px_0_var(--edge-hi)]" : "text-ink-2 hover:text-ink",
              )}
            >
              {s.label}
              {s.view === "review" && review > 0 && (
                <span className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-ink">{review}</span>
              )}
              {s.view === "settings" && problems > 0 && (
                <AlertTriangle size={12} className="shrink-0 text-warn" aria-label={`${problems} launcher problem(s)`} />
              )}
            </button>
          );
        })}
      </nav>
      <div className="min-w-2 flex-1" />

      {/* Status can give up room (and hide) before the sections or the window buttons ever do. */}
      <div className="flex min-w-0 shrink items-center gap-2 overflow-hidden">
        <button onClick={search} aria-label="Search games" title="Search (Ctrl+F)" className="glass-flat inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-2 hover:text-ink">
          <Search size={16} />
        </button>
        <NowPlaying />
        <ScanStatus />
      </div>
      <div className="flex h-16 shrink-0 items-stretch" role="group" aria-label="Window controls">
        <WindowButton label="Minimize" onClick={() => bridge.send({ type: "window", action: "minimize" })}>
          <Minus size={15} strokeWidth={1.5} />
        </WindowButton>
        <WindowButton label={maximized ? "Restore" : "Maximize"} onClick={() => bridge.send({ type: "window", action: "maximize" })}>
          {maximized ? <Copy size={12} strokeWidth={1.5} className="-scale-x-100" /> : <Square size={11.5} strokeWidth={1.5} />}
        </WindowButton>
        <WindowButton label="Close to tray" danger onClick={() => bridge.send({ type: "window", action: "close" })}>
          <X size={16} strokeWidth={1.5} />
        </WindowButton>
      </div>
    </header>
  );
}

function WindowButton({ label, onClick, children, danger }: { label: string; onClick(): void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={clsx("flex w-[46px] cursor-pointer items-center justify-center text-ink-3 transition-colors", danger ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-[var(--surface)] hover:text-ink")}
    >
      {children}
    </button>
  );
}

const NONE: never[] = [];

function NowPlaying() {
  const playing = useApp((s) => s.state?.playing ?? NONE);
  const games = useGameMap();
  const openGame = useApp((s) => s.openGame);
  const now = useNow(30_000);
  if (playing.length === 0) return null;
  const p = playing[0];
  const g = games.get(p.gameId);
  return (
    <button onClick={() => openGame(p.gameId)} className="glass-flat flex h-9 min-w-0 shrink cursor-pointer items-center gap-2 rounded-full py-1 pr-3.5 pl-1 text-[13px] whitespace-nowrap hover:bg-[var(--surface-2)]">
      {g?.coverUrl || g?.iconUrl ? (
        <img src={(g.coverUrl ?? g.iconUrl)!} alt="" className="h-7 w-[20px] shrink-0 rounded-[5px] object-cover" draggable={false} />
      ) : (
        <span className="w-1" />
      )}
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full bg-ok opacity-60" />
        <span className="relative size-2 rounded-full bg-ok" />
      </span>
      <span className="max-w-[160px] min-w-0 truncate font-medium text-ink">{g?.title ?? "A game"}</span>
      <span className="num text-[12px] text-ink-3">{duration((now - Date.parse(p.since)) / 1000)}</span>
      {playing.length > 1 && <span className="num text-[12px] text-ink-3">+{playing.length - 1}</span>}
    </button>
  );
}

function ScanStatus() {
  const scan = useApp((s) => s.state?.scan);
  const watch = useApp((s) => s.state?.watch);
  if (!scan) return null;
  if (scan.running) {
    return (
      <div className="mr-1 flex items-center gap-2 text-[12px] whitespace-nowrap text-ink-2" title={scan.path ?? ""}>
        <RefreshCw size={13} className="animate-spin text-accent" />
        <span>{scan.phase ?? "Scanning"}</span>
        <span className="num text-[11.5px] text-ink-3">{scan.dirs.toLocaleString()} folders</span>
        <button onClick={() => bridge.send({ type: "cancelScan" })} className="cursor-pointer text-[12px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
          stop
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <span className="flex items-center gap-1.5 pr-1 text-[11.5px] text-ink-3" title={watch?.running ? "Counting play time" : "Not tracking"}>
        <span className={clsx("size-1.5 rounded-full", watch?.running ? "bg-ok" : "bg-stamp-red")} />
        {scan.error ? <span className="text-stamp-red">{scan.error}</span> : watch?.running ? "tracking" : "not tracking"}
      </span>
      <button
        onClick={() => bridge.send({ type: "refresh" })}
        title="Re-read launchers and scan folders"
        aria-label="Refresh library"
        className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-ink-3 hover:bg-[var(--surface)] hover:text-ink"
      >
        <RefreshCw size={14} />
      </button>
    </div>
  );
}

/** Resize handles along the borderless window's edges (native resize loop in the host). */
export function ResizeEdges() {
  const maximized = useApp((s) => s.maximized);
  if (maximized || bridge.isPreview) return null;
  const edge = (e: ResizeEdge, cls: string) => <div className={clsx("fixed z-50", cls)} onMouseDown={(ev) => startDrag(ev, e)} />;
  return (
    <>
      {edge("top", "top-0 right-2 left-2 h-1 cursor-ns-resize")}
      {edge("bottom", "right-2 bottom-0 left-2 h-1 cursor-ns-resize")}
      {edge("left", "top-2 bottom-2 left-0 w-1 cursor-ew-resize")}
      {edge("right", "top-2 right-0 bottom-2 w-1 cursor-ew-resize")}
      {edge("top-left", "top-0 left-0 size-2 cursor-nwse-resize")}
      {edge("top-right", "top-0 right-0 size-2 cursor-nesw-resize")}
      {edge("bottom-left", "bottom-0 left-0 size-2 cursor-nesw-resize")}
      {edge("bottom-right", "right-0 bottom-0 size-2 cursor-nwse-resize")}
    </>
  );
}
