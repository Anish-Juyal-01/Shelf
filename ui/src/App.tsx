import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bridge } from "./bridge/bridge";
import type { View } from "./bridge/protocol";
import { ResizeEdges, Sidebar, TitleBar } from "./components/Chrome";
import { useApp } from "./store/store";
import { Activity } from "./views/Activity";
import { GamePage } from "./views/GamePage";
import { Library } from "./views/Library";
import { Review } from "./views/Review";
import { Settings } from "./views/Settings";
import { Storage } from "./views/Storage";

const views: View[] = ["library", "activity", "storage", "review", "settings"];

export default function App() {
  const receive = useApp((s) => s.receive);
  const connected = useApp((s) => s.connected);
  const view = useApp((s) => s.view);
  const gameId = useApp((s) => s.gameId);
  const scroller = useRef<HTMLElement>(null);

  useEffect(() => {
    const off = bridge.subscribe(receive);
    bridge.send({ type: "ready" });
    return off;
  }, [receive]);

  // 1–5 switch sections, Esc closes a game page, Ctrl+F searches the library.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea");
      const s = useApp.getState();
      if (e.key === "Escape" && s.gameId !== null) s.openGame(null);
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        s.setView("library");
        setTimeout(() => document.querySelector<HTMLInputElement>('input[aria-label="Search games"]')?.focus(), 0);
      } else if (!typing && !e.ctrlKey && !e.altKey && /^[1-5]$/.test(e.key)) s.setView(views[Number(e.key) - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [view, gameId]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <ResizeEdges />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main ref={scroller} className="scroll-area relative min-w-0 flex-1">
          {!connected ? (
            <div className="flex h-full items-center justify-center">
              <p className="caps text-ink-3">Opening the catalogue…</p>
            </div>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={gameId !== null ? `game-${gameId}` : view}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
              >
                {gameId !== null ? <GamePage /> : <Section view={view} />}
              </motion.div>
            </AnimatePresence>
          )}
        </main>
      </div>
      <DropOverlay />
      <Notices />
    </div>
  );
}

function Section({ view }: { view: View }) {
  switch (view) {
    case "activity":
      return <Activity />;
    case "storage":
      return <Storage />;
    case "review":
      return <Review />;
    case "settings":
      return <Settings />;
    default:
      return <Library />;
  }
}

/** Drop an .exe anywhere on the window to add it. The host gets real file paths via WebView2. */
function DropOverlay() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setActive(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setActive(false);
      if (e.dataTransfer?.files.length) bridge.sendFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-[2px]">
      <div className="slip rounded-[4px] border-2 border-dashed border-accent px-12 pt-2 pb-8 text-center">
        <p className="caps h-[38px] pt-[7px] text-ink-3">New acquisition</p>
        <p className="font-display mt-4 text-[26px] text-ink">Drop a game's .exe to shelve it</p>
        <p className="mt-1 text-[13px] text-ink-2">Shelf works out the game folder and starts tracking it.</p>
      </div>
    </div>
  );
}

function Notices() {
  const notices = useApp((s) => s.notices);
  const dismiss = useApp((s) => s.dismiss);
  const setView = useApp((s) => s.setView);
  const openGame = useApp((s) => s.openGame);
  return (
    <div className="fixed right-5 bottom-5 z-50 flex w-[360px] flex-col gap-2" role="status" aria-live="polite">
      <AnimatePresence>
        {notices.map((n) => (
          <motion.div
            key={n.id}
            layout
            initial={{ opacity: 0, y: 12, rotate: -1 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className={clsx("paper flex items-start gap-3 rounded-[4px] border-l-[3px] py-2.5 pr-2 pl-3.5",
              n.tone === "error" ? "border-l-stamp-red" : n.tone === "success" ? "border-l-ok" : "border-l-stamp-violet")}
          >
            <button
              className={clsx("min-w-0 flex-1 text-left text-[13px] text-ink", (n.view || n.gameId) && "cursor-pointer hover:underline")}
              onClick={() => {
                if (n.view) setView(n.view);
                if (n.gameId !== undefined) openGame(n.gameId);
                if (n.view || n.gameId) dismiss(n.id);
              }}
            >
              {n.text}
            </button>
            <button onClick={() => dismiss(n.id)} aria-label="Dismiss" className="cursor-pointer p-1 text-ink-3 hover:text-ink">
              <X size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
