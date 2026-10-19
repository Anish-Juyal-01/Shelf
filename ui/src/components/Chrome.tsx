import clsx from "clsx";
import { Activity, AlertTriangle, Copy, HardDrive, Inbox, Library, Minus, RefreshCw, Settings, Square, X } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { bridge } from "../bridge/bridge";
import type { ResizeEdge, View } from "../bridge/protocol";
import { bytes, duration } from "../lib/format";
import { isOverdue } from "../lib/library";
import { useApp, useGameMap } from "../store/store";
import { useNow } from "./useNow";

function startDrag(e: MouseEvent, edge: ResizeEdge) {
  if (e.button !== 0) return;
  e.preventDefault();
  bridge.send({ type: "window", action: "drag", edge });
}

export function TitleBar() {
  const maximized = useApp((s) => s.maximized);
  return (
    <header
      className="relative z-30 flex h-10 shrink-0 items-center border-b border-rule bg-bg pl-4"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        startDrag(e, "caption");
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        bridge.send({ type: "window", action: "maximize" });
      }}
    >
      <Wordmark />
      {bridge.isPreview && (
        <span className="caps ml-4 rounded-[3px] bg-stamp-violet/12 px-2 py-0.5 text-stamp-violet">Preview data — open Shelf.exe for your games</span>
      )}
      <div className="flex-1" />
      <div className="flex h-10 items-stretch" role="group" aria-label="Window controls">
        <WindowButton label="Minimize" onClick={() => bridge.send({ type: "window", action: "minimize" })}>
          <Minus size={15} strokeWidth={1.6} />
        </WindowButton>
        <WindowButton label={maximized ? "Restore" : "Maximize"} onClick={() => bridge.send({ type: "window", action: "maximize" })}>
          {maximized ? <Copy size={12} strokeWidth={1.6} className="-scale-x-100" /> : <Square size={11.5} strokeWidth={1.6} />}
        </WindowButton>
        <WindowButton label="Close to tray" danger onClick={() => bridge.send({ type: "window", action: "close" })}>
          <X size={16} strokeWidth={1.6} />
        </WindowButton>
      </div>
    </header>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <svg width="20" height="20" viewBox="0 0 64 64" aria-hidden>
        <rect x="14" y="16" width="8" height="30" rx="1.5" fill="var(--ink-2)" />
        <rect x="24" y="12" width="10" height="34" rx="1.5" fill="var(--accent)" />
        <rect x="36" y="19" width="7" height="27" rx="1.5" fill="var(--stamp-red)" transform="rotate(-8 39.5 32.5)" />
        <rect x="11" y="46" width="42" height="5" rx="1.5" fill="var(--ink-2)" />
      </svg>
      <span className="font-display text-[19px] leading-none font-[620] tracking-[-0.02em] italic">Shelf</span>
    </div>
  );
}

function WindowButton({ label, onClick, children, danger }: { label: string; onClick(): void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={clsx("flex w-[46px] cursor-pointer items-center justify-center text-ink-3 transition-colors", danger ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-sunken hover:text-ink")}
    >
      {children}
    </button>
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

const drawers: { view: View; label: string; icon: typeof Library; hint: string }[] = [
  { view: "library", label: "Library", icon: Library, hint: "1" },
  { view: "activity", label: "Activity", icon: Activity, hint: "2" },
  { view: "storage", label: "Storage", icon: HardDrive, hint: "3" },
  { view: "review", label: "Review", icon: Inbox, hint: "4" },
  { view: "settings", label: "Settings", icon: Settings, hint: "5" },
];

/** Card-catalogue drawers: each view is a drawer front with a label holder and a count. */
export function Sidebar() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const state = useApp((s) => s.state);
  const counts: Partial<Record<View, string>> = {};
  if (state) {
    counts.library = String(state.games.filter((g) => g.installed && !g.hidden).length);
    counts.storage = bytes(state.games.filter((g) => g.installed).reduce((a, g) => a + g.sizeBytes, 0));
    if (state.review.length) counts.review = String(state.review.length);
  }
  const problems = state?.sources.filter((s) => s.state === "partial" || s.state === "unreadable").length ?? 0;
  const overdue = state?.games.filter((g) => !g.hidden && isOverdue(g)).length ?? 0;

  return (
    <nav aria-label="Sections" className="flex w-[218px] shrink-0 flex-col border-r border-rule bg-bg px-3 pt-4 pb-3">
      <ul className="space-y-1.5">
        {drawers.map((d) => {
          const active = view === d.view;
          const Icon = d.icon;
          return (
            <li key={d.view}>
              <button
                onClick={() => setView(d.view)}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "group relative flex h-11 w-full cursor-pointer items-center gap-3 rounded-[5px] border px-3 text-left transition-[background,border-color]",
                  active ? "border-rule-strong bg-surface shadow-card" : "border-transparent hover:border-rule hover:bg-surface-2/60",
                )}
              >
                <Icon size={16} strokeWidth={1.7} className={active ? "text-accent" : "text-ink-3 group-hover:text-ink-2"} />
                <span className={clsx("flex-1 text-[13.5px]", active ? "font-semibold text-ink" : "text-ink-2")}>{d.label}</span>
                {counts[d.view] && (
                  <span
                    className={clsx(
                      "typed rounded-[3px] border px-1.5 text-[10.5px] leading-[17px]",
                      d.view === "review" ? "border-stamp-red/60 text-stamp-red" : "border-rule-strong text-ink-3",
                    )}
                  >
                    {counts[d.view]}
                  </span>
                )}
                {d.view === "settings" && problems > 0 && <AlertTriangle size={13} className="text-warn" aria-label={`${problems} launcher problem(s)`} />}
                {/* Drawer pull */}
                {active && <span className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r bg-accent" />}
              </button>
            </li>
          );
        })}
      </ul>

      {overdue > 0 && view !== "storage" && (
        <button
          onClick={() => setView("storage")}
          className="mt-4 cursor-pointer rounded-[5px] border border-dashed border-stamp-red/45 px-3 py-2.5 text-left text-[12.5px] leading-snug text-ink-2 hover:bg-stamp-red/5"
        >
          <span className="stamp mr-1.5 inline-block -rotate-2 text-[9px] text-stamp-red">Overdue</span>
          {overdue} game{overdue === 1 ? "" : "s"} unplayed for 90+ days
        </button>
      )}

      <div className="flex-1" />
      <NowPlaying />
      <ScanFooter />
    </nav>
  );
}

const NONE: never[] = [];

function NowPlaying() {
  const playing = useApp((s) => s.state?.playing ?? NONE);
  const games = useGameMap();
  const openGame = useApp((s) => s.openGame);
  const now = useNow(30_000);
  if (playing.length === 0) return null;
  return (
    <div className="mb-3 space-y-2">
      {playing.map((p) => {
        const g = games.get(p.gameId);
        return (
          <button key={p.gameId} onClick={() => openGame(p.gameId)} className="paper block w-full cursor-pointer rounded-[5px] px-3 py-2.5 text-left">
            <span className="caps flex items-center gap-1.5 text-ok">
              <span className="pulse-dot size-1.5 rounded-full bg-ok" /> Checked out
            </span>
            <span className="font-display mt-0.5 block truncate text-[15px] text-ink">{g?.title ?? "A game"}</span>
            <span className="typed text-[11px] text-ink-3">for {duration((now - Date.parse(p.since)) / 1000)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ScanFooter() {
  const scan = useApp((s) => s.state?.scan);
  const watch = useApp((s) => s.state?.watch);
  if (!scan) return null;
  return (
    <div className="border-t border-rule pt-3">
      {scan.running ? (
        <div className="text-[12px] text-ink-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <RefreshCw size={12} className="animate-spin text-accent" /> {scan.phase ?? "Scanning"}
            </span>
            <button onClick={() => bridge.send({ type: "cancelScan" })} className="cursor-pointer text-[11.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
              Stop
            </button>
          </div>
          <p className="typed mt-1 text-[10.5px] text-ink-3">{scan.dirs.toLocaleString()} folders</p>
          <p className="typed truncate text-[10.5px] text-ink-4" title={scan.path ?? ""}>{scan.path}</p>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 text-[11.5px] leading-tight text-ink-3">
            <span className="flex items-center gap-1.5">
              <span className={clsx("size-1.5 rounded-full", watch?.running ? "bg-ok" : "bg-stamp-red")} />
              {watch?.running ? "Tracking playtime" : "Not tracking"}
            </span>
            {scan.error ? <span className="text-stamp-red">{scan.error}</span> : <LastScan iso={scan.lastRun} seconds={scan.lastSeconds} />}
          </div>
          <button
            onClick={() => bridge.send({ type: "refresh" })}
            title="Re-read launchers and scan folders"
            aria-label="Refresh library"
            className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border border-rule-strong text-ink-2 hover:bg-surface hover:text-ink"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function LastScan({ iso, seconds }: { iso: string | null; seconds: number | null }) {
  const now = useNow(60_000);
  if (!iso) return <span className="block">Not scanned yet</span>;
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  return (
    <span className="typed block text-[10.5px]">
      checked {min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`}
      {seconds != null && ` · ${seconds.toFixed(1)}s`}
    </span>
  );
}
