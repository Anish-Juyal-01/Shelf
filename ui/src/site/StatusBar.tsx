import { useEffect, useState } from "react";
import type { GameView } from "../bridge/protocol";
import { Cover } from "../components/Cover";
import { bytes } from "../lib/format";

// The strip above the headline: what Shelf's own top bar shows while it runs — that it's watching, what it knows
// about, and the last thing it found — so the page opens on the app at work.

const PLACES = ["Downloads", "Games", "Desktop", "Downloads\\unzipped"];

export function StatusBar({ games }: { games: GameView[] }) {
  const total = games.reduce((a, g) => a + g.sizeBytes, 0);
  const [i, setI] = useState(1);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => {
      setShown(false);
      window.setTimeout(() => {
        setI((n) => (n % (games.length - 1)) + 1);
        setShown(true);
      }, 280);
    }, 3200);
    return () => clearInterval(t);
  }, [games.length]);
  const g = games[i];
  const where = `${"DEF"[i % 3]}:\\${PLACES[i % PLACES.length]}`;
  return (
    <div className="mb-9 flex flex-wrap items-center gap-2.5 text-[13px]">
      <span className="inline-flex h-9 items-center gap-2 rounded-full border border-rule-strong bg-surface px-3.5 text-ink-2 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
        <span className="pulse-dot size-2 rounded-full bg-ok" />
        Watching this PC
        <span className="typed text-[11.5px] text-ink-3">· {games.length} games · {bytes(total)}</span>
      </span>
      <span className="inline-flex h-9 min-w-0 items-center gap-2.5 rounded-full border border-rule-strong bg-surface py-1 pr-3.5 pl-1.5 text-ink-2 shadow-[0_1px_2px_rgb(0_0_0/0.04)] max-sm:hidden">
        <span className="w-[18px] flex-none overflow-hidden rounded-[3px] transition-opacity duration-300" style={{ opacity: shown ? 1 : 0 }}>
          <Cover title={g.title} url={g.coverUrl} bare />
        </span>
        <span className="truncate transition-opacity duration-300" style={{ opacity: shown ? 1 : 0 }}>
          found <b className="font-medium text-ink">{g.title}</b>
          <span className="typed text-[11.5px] text-ink-3"> · {where}</span>
        </span>
      </span>
    </div>
  );
}
