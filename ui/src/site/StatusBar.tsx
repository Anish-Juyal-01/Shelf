import { useEffect, useState } from "react";
import type { GameView } from "../bridge/protocol";
import { Cover } from "../components/Cover";
import { bytes } from "../lib/format";

// The strip above the headline: what Shelf's own top bar shows while it runs. The left chip cycles through what it's
// doing (watching, scanning a folder, tracking a game, checking launchers); the right one shows the latest find. The
// game count and size tick up as it "finds" things.

const PLACES = ["Downloads", "Games", "Desktop", "Downloads\\unzipped"];
const LAUNCHERS = ["Steam", "Epic", "GOG", "Xbox", "Battle.net", "Riot", "EA app", "Ubisoft Connect"];

export function StatusBar({ games }: { games: GameView[] }) {
  const [tick, setTick] = useState(0);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => {
      setShown(false);
      window.setTimeout(() => {
        setTick((n) => n + 1);
        setShown(true);
      }, 280);
    }, 2800);
    return () => clearInterval(t);
  }, []);

  // Found so far: starts a few short of the whole library and climbs to it, one find per beat.
  const found = Math.min(games.length, games.length - 4 + tick);
  const total = games.slice(0, found).reduce((a, g) => a + g.sizeBytes, 0);
  const latest = games[1 + (tick % (games.length - 1))];
  const where = `${"DEF"[tick % 3]}:\\${PLACES[tick % PLACES.length]}`;
  const playing = games[1 + ((tick * 5) % (games.length - 1))];

  const doing = [
    <>Watching this PC</>,
    <>Scanning <span className="typed text-[12px]">{where}</span></>,
    <>Tracking <b className="font-medium text-ink">{playing.title.split(":")[0]}</b> <span className="typed text-[11.5px] text-ink-3">· {12 + ((tick * 17) % 50)}m</span></>,
    <>Checking {LAUNCHERS[tick % LAUNCHERS.length]}</>,
  ][tick % 4];
  const dot = ["bg-ok", "bg-u-blue", "bg-u-red", "bg-u-yellow"][tick % 4];

  const chip = "inline-flex h-9 items-center gap-2 rounded-full border border-rule-strong bg-surface px-3.5 text-ink-2 shadow-[0_1px_2px_rgb(0_0_0/0.04)]";
  const fade = { opacity: shown ? 1 : 0, transition: "opacity .28s" };
  return (
    <div className="mb-9 flex flex-wrap items-center gap-2.5 text-[13px]" aria-hidden>
      <span className={chip}>
        <span className={`pulse-dot size-2 rounded-full transition-colors ${dot}`} />
        <span className="whitespace-nowrap" style={fade}>{doing}</span>
        <span className="typed text-[11.5px] whitespace-nowrap text-ink-3 tabular-nums">· {found} games · {bytes(total)}</span>
      </span>
      <span className={`${chip} min-w-0 py-1 pl-1.5 max-sm:hidden`}>
        <span className="w-[18px] flex-none overflow-hidden rounded-[3px]" style={fade}>
          <Cover title={latest.title} url={latest.coverUrl} bare />
        </span>
        <span className="truncate" style={fade}>
          found <b className="font-medium text-ink">{latest.title}</b>
          <span className="typed text-[11.5px] text-ink-3"> · {where}</span>
        </span>
      </span>
    </div>
  );
}
