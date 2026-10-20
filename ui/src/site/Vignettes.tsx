import { Check, Gamepad2, RotateCcw, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { GameView, SourceKind } from "../bridge/protocol";
import { Cover } from "../components/Cover";
import { bytes } from "../lib/format";
import { isOverdue } from "../lib/library";

// Small working pieces of the app, one per stop on the path, so each claim on the page comes with something to
// poke at: pick a launcher, answer a Review, act on the new-game notification, read the playtime chart, "uninstall".

type V = { on: boolean; faller: GameView; games: GameView[] };

function Card({ label, aside, children, on }: { label: string; aside?: ReactNode; children: ReactNode; on: boolean }) {
  return (
    <div
      className="paper mt-7 w-full max-w-[420px] overflow-hidden rounded-[14px] transition-[transform,box-shadow] duration-500 hover:-translate-y-1"
      style={{ transform: on ? undefined : "translateY(6px)", boxShadow: on ? "0 1px 2px rgb(0 0 0/.06), 0 24px 48px -24px rgb(0 0 0/.35)" : undefined }}
    >
      <div className="flex min-h-[41px] items-center justify-between gap-3 border-b border-rule px-4 py-2">
        <span className="caps whitespace-nowrap text-ink-3">{label}</span>
        {aside && <span className="typed min-w-0 truncate text-[11px] text-ink-4">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

function Thumb({ g, w = "w-7" }: { g: GameView; w?: string }) {
  return <div className={`${w} flex-none`}><Cover title={g.title} url={g.coverUrl} bare className="rounded-[4px]" /></div>;
}

const tiny = "inline-flex cursor-pointer items-center gap-1 rounded-[6px] px-2.5 py-1 text-[12px] transition-colors";

/* ── 1 · launchers: pick one to see what came from it ── */

const SOURCES: [SourceKind, string, string][] = [
  ["steam", "Steam", "#1b2838"], ["epic", "Epic", "#2a2a2a"], ["gog", "GOG", "#8a2be2"], ["rockstar", "Rockstar", "#f4a900"],
  ["xbox", "Xbox", "#107c10"], ["itch", "itch", "#fa5c5c"], ["battleNet", "Battle.net", "#148eff"], ["riot", "Riot", "#eb0029"], ["folder", "Folders", "var(--u-blue)"],
];

function Launchers({ on, games }: V) {
  const [pick, setPick] = useState<SourceKind>("steam");
  const from = games.filter((g) => g.sources[0] === pick);
  const name = SOURCES.find((s) => s[0] === pick)![1];
  return (
    <Card label="Found on this PC" aside={`${games.length} games · click one`} on={on}>
      <div className="flex flex-wrap gap-2 px-4 pt-4">
        {SOURCES.map(([key, label, c]) => {
          const n = games.filter((g) => g.sources[0] === key).length;
          const active = key === pick;
          return (
            <button
              key={key}
              onClick={() => setPick(key)}
              aria-pressed={active}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-[13px] transition-colors ${active ? "border-ink bg-ink text-bg" : "border-rule-strong hover:border-ink-3"} ${n || active ? "" : "text-ink-4"}`}
            >
              <span className="size-2 rounded-full" style={{ background: c, opacity: n ? 1 : 0.35 }} />
              {label}
              <span className={`typed text-[11px] ${active ? "text-bg/70" : "text-ink-3"}`}>{n}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 min-h-[92px] border-t border-rule bg-surface-2/60 px-4 py-3">
        {from.length > 0 ? (
          <>
            <div className="typed mb-2 text-[11px] text-ink-3">{from.length} from {name}</div>
            <div className="flex gap-1.5 overflow-hidden">
              {from.slice(0, 9).map((g) => <Thumb key={g.id} g={g} w="w-9" />)}
            </div>
          </>
        ) : (
          <div className="pt-5 text-center text-[13px] text-ink-3">Nothing from {name} on this PC — Shelf still checks every time.</div>
        )}
      </div>
    </Card>
  );
}

/* ── 2 · folder scan: the unsure one waits for your answer ── */

const squash = (title: string) => title.replace(/[^A-Za-z0-9]+/g, "");
/** The folder a downloaded game ends up in, e.g. D:\Downloads\HollowKnight. */
const folderOf = (g: GameView) => "D:\\Downloads\\" + squash(g.title);

function Folders({ on, faller, games }: V) {
  const [answer, setAnswer] = useState<"open" | "added" | "rejected">("open");
  const [pass, setPass] = useState(0);
  const [scanning, setScanning] = useState(false);
  const rescan = () => {
    setScanning(true);
    setPass(pass + 1);
    window.setTimeout(() => setScanning(false), 60);
  };
  const second = games[2];
  const rows: { path: string; g: GameView | null; why: string; score: number }[] = [
    { path: folderOf(faller), g: faller, why: "game engine · one real exe", score: 94 },
    { path: "E:\\Games\\" + squash(second.title), g: second, why: "engine files · data paks", score: 88 },
    { path: "F:\\stuff\\proj_final", g: null, why: "one exe, no engine", score: 52 },
  ];
  const shown = on && !scanning;
  return (
    <Card
      label="Folder scan"
      on={on}
      aside={
        <button onClick={rescan} className="inline-flex cursor-pointer items-center gap-1 text-ink-3 hover:text-ink" title="Scan again">
          <RotateCcw className="size-3" /> rescan
        </button>
      }
    >
      {rows.map((r) => {
        const review = r.score < 70;
        const tone = review && answer === "open" ? "var(--u-yellow)" : review && answer === "rejected" ? "var(--ink-4)" : "var(--ok)";
        return (
          <div key={r.path + pass} className={`flex items-center gap-3 border-b border-rule px-4 py-3 last:border-b-0 ${review && answer === "rejected" ? "opacity-55" : ""}`}>
            {r.g ? <Thumb g={r.g} /> : <div className="flex aspect-[2/3] w-7 flex-none items-center justify-center rounded-[4px] bg-sunken text-ink-4">?</div>}
            <div className="min-w-0 flex-1">
              <div className="typed truncate text-[11px] text-ink-3">{r.path}</div>
              <div className="flex items-baseline justify-between gap-2">
                <span className={`font-display truncate text-[20px] leading-tight ${review && answer === "rejected" ? "line-through" : ""}`}>
                  {r.g?.title ?? (answer === "added" ? "Proj Final" : "Maybe a game?")}
                </span>
                <span className="typed text-[13px]" style={{ color: tone }}>{r.score}</span>
              </div>
              <div className="relative mt-1 h-1 rounded-full bg-sunken">
                <div className="absolute inset-y-0 left-0 rounded-full transition-[width,background] duration-700" style={{ width: shown ? `${r.score}%` : "0%", background: tone }} />
              </div>
              {!review ? (
                <div className="mt-1 text-[11.5px] text-ink-3">{r.why} · to Library</div>
              ) : answer === "open" ? (
                <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-ink-3">
                  <span className="mr-auto">{r.why} · is it a game?</span>
                  <button onClick={() => setAnswer("added")} className={`${tiny} bg-accent font-medium text-accent-ink hover:brightness-110`}><Check className="size-3" /> Add</button>
                  <button onClick={() => setAnswer("rejected")} className={`${tiny} border border-rule-strong text-ink-2 hover:border-ink-3`}>Not a game</button>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-2 text-[11.5px] text-ink-3">
                  <span className="mr-auto">{answer === "added" ? "Added to your library." : "Won't be suggested again."}</span>
                  <button onClick={() => setAnswer("open")} className="cursor-pointer underline-offset-2 hover:text-ink hover:underline">undo</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

/* ── 3 · the notification for a new download ── */

function Toast({ on, faller: g }: V) {
  const [state, setState] = useState<"new" | "opened" | "dismissed">("new");
  return (
    <div
      className="mt-7 w-full max-w-[400px] rounded-[12px] border border-rule-strong bg-surface p-4 shadow-[0_24px_48px_-24px_rgb(0_0_0/.45)] transition-[transform,opacity] duration-500 hover:-translate-y-1"
      style={{ transform: on ? undefined : "translateX(16px)", opacity: on ? 1 : 0.6 }}
    >
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        <img src="./icon.svg" alt="" className="size-4" /> Shelf <span className="ml-auto">now</span>
        {state === "new" && (
          <button onClick={() => setState("dismissed")} aria-label="Dismiss" className="cursor-pointer rounded p-0.5 text-ink-4 hover:bg-sunken hover:text-ink">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="mt-3 flex gap-3">
        <div className="w-11 flex-none"><Cover title={g.title} url={g.coverUrl} bare className="rounded-[5px]" /></div>
        <div className="min-w-0 flex-1">
          {state === "new" ? (
            <>
              <div className="truncate text-[14.5px] font-semibold">New game: {g.title}</div>
              <div className="typed mt-0.5 truncate text-[11.5px] text-ink-3">{folderOf(g)}</div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setState("opened")} className={`${tiny} bg-accent px-3 font-medium text-accent-ink hover:brightness-110`}>Open</button>
                <button onClick={() => setState("dismissed")} className={`${tiny} border border-rule-strong px-3 text-ink-2 hover:border-ink-3`}>Not a game</button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-[14.5px] font-semibold">
                {state === "opened" ? <><Check className="size-4 text-ok" /> On your shelf</> : "Got it"}
              </div>
              <div className="mt-0.5 text-[12.5px] text-ink-3">
                {state === "opened" ? `${g.title} is in your library, with its size and playtime.` : "Shelf won't suggest that folder again."}
              </div>
              <button onClick={() => setState("new")} className="mt-2.5 inline-flex cursor-pointer items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
                <RotateCcw className="size-3" /> show it again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 4 · playtime: hover a day, switch the range ── */

const DAYS = [0.6, 0, 1.4, 2.2, 0.4, 0, 0, 3.1, 1.2, 0.8, 2.6, 0, 1.9, 0.9];

function Hours({ on, games }: V) {
  const playing = games.find((g, i) => i > 0 && !isOverdue(g)) ?? games[1];
  const [range, setRange] = useState<7 | 14>(14);
  const [hover, setHover] = useState<number | null>(null);
  const days = DAYS.slice(-range);
  const total = days.reduce((a, h) => a + h, 0);
  const max = Math.max(...days, 0.5);
  const dayName = (i: number) => {
    const d = new Date();
    d.setDate(d.getDate() - (days.length - 1 - i));
    return i === days.length - 1 ? "Today" : d.toLocaleDateString("en", { weekday: "short", day: "numeric" });
  };
  return (
    <Card
      label={`Last ${range} days`}
      on={on}
      aside={
        <span className="inline-flex rounded-full border border-rule-strong p-0.5">
          {([7, 14] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)} className={`cursor-pointer rounded-full px-2 py-0.5 ${range === r ? "bg-ink text-bg" : "hover:text-ink"}`}>{r}d</button>
          ))}
        </span>
      }
    >
      <div className="flex items-center gap-3 border-b border-rule px-4 py-3">
        <Thumb g={playing} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 truncate text-[14px] font-medium"><span className="pulse-dot size-2 flex-none rounded-full bg-ok" /> {playing.title}</div>
          <div className="typed text-[11px] text-ink-3">playing · 47m · launched from a desktop shortcut</div>
        </div>
        <Gamepad2 className="size-4 flex-none text-ink-4" />
      </div>
      <div className="px-4 pt-3">
        <div className="typed text-[11.5px] text-ink-2">
          {hover === null ? <>{total.toFixed(1)}h in {range} days · hover a day</> : <>{dayName(hover)} · {days[hover] ? `${days[hover]}h played` : "nothing played"}</>}
        </div>
      </div>
      <div className="flex h-24 items-end gap-[5px] px-4 pt-2 pb-4" onMouseLeave={() => setHover(null)}>
        {days.map((h, i) => (
          <div key={`${range}-${i}`} className="flex h-full flex-1 cursor-default flex-col justify-end" onMouseEnter={() => setHover(i)}>
            <div
              className="rounded-t-[3px] transition-[height,background] duration-500"
              style={{ height: h ? (on ? `${(h / max) * 100}%` : "6%") : 2, background: hover === i ? "var(--u-red)" : "var(--u-blue)", opacity: h ? 1 : 0.25, transitionDelay: `${i * 20}ms` }}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── 5 · storage: "uninstall" and watch the drive empty ── */

/** What the Uninstall button says: the launcher's own uninstaller, or the folder for loose games. */
const UNINSTALL: Partial<Record<SourceKind, string>> = { steam: "Steam", epic: "Epic", gog: "GOG", rockstar: "Rockstar", xbox: "Xbox", itch: "itch" };
const DISK = 1000 * 1024 ** 3;
const OTHER = 0.27 * DISK; // Windows, apps and files that aren't games

function Drive({ on, games }: V) {
  const [gone, setGone] = useState<Set<number>>(new Set());
  const bySize = [...games].sort((a, b) => b.sizeBytes - a.sizeBytes);
  const kept = bySize.filter((g) => !gone.has(g.id));
  const freed = bySize.filter((g) => gone.has(g.id)).reduce((a, g) => a + g.sizeBytes, 0);
  const used = Math.min(DISK * 0.97, OTHER + kept.reduce((a, g) => a + g.sizeBytes, 0));
  const idleGames = bySize.filter((g) => isOverdue(g));
  const idle = idleGames.filter((g) => !gone.has(g.id)).reduce((a, g) => a + g.sizeBytes, 0);
  const days = (g: GameView) => Math.floor((Date.now() - Date.parse(g.lastPlayed!)) / 86_400_000);
  return (
    <Card label="C: Windows" aside={`${Math.round((used / DISK) * 100)}% full`} on={on}>
      <div className="px-4 pt-4">
        <div className="flex h-3 overflow-hidden rounded-full bg-sunken">
          <div className="h-full border-r border-surface bg-ink-4" style={{ width: on ? `${(OTHER / DISK) * 100}%` : "0%" }} />
          {kept.slice(0, 7).map((g, i) => (
            <div key={g.id} className="h-full border-r border-surface transition-[width] duration-700" style={{ width: on ? `${(g.sizeBytes / DISK) * 100}%` : "0%", background: `hsl(${(g.id * 47 + 200) % 360} 55% ${isOverdue(g) ? 72 : 55}%)`, transitionDelay: `${i * 40}ms` }} />
          ))}
        </div>
        <div className="typed mt-2 flex flex-wrap gap-x-2 text-[11px] text-ink-3">
          <span>not played in 90 days <span className="text-u-red">{bytes(idle)}</span></span>
          {freed > 0 && <span className="text-ok">· freed {bytes(freed)}</span>}
          {freed > 0 && <button onClick={() => setGone(new Set())} className="ml-auto cursor-pointer hover:text-ink">put back</button>}
        </div>
      </div>
      <div className="mt-3">
        {idleGames.slice(0, 3).map((g) => {
          const via = UNINSTALL[g.sources[0]];
          const done = gone.has(g.id);
          return (
            <div key={g.id} className={`flex items-center gap-3 border-t border-rule px-4 py-2.5 transition-opacity ${done ? "opacity-50" : ""}`}>
              <Thumb g={g} />
              <div className="min-w-0 flex-1">
                <div className={`truncate text-[13.5px] font-medium ${done ? "line-through" : ""}`}>{g.title}</div>
                <div className="typed text-[11px] text-ink-3">{done ? `removed by ${via ?? "you"}` : `${bytes(g.sizeBytes)} · idle ${days(g)}d`}</div>
              </div>
              {done ? (
                <Check className="size-4 text-ok" />
              ) : (
                <button onClick={() => setGone(new Set(gone).add(g.id))} className={`${tiny} border border-rule-strong whitespace-nowrap text-ink-2 hover:border-ink-3 hover:text-ink`}>
                  {via ? `Uninstall via ${via}` : "Open folder"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="border-t border-rule bg-surface-2/60 px-4 py-2 text-[11.5px] text-ink-3">Shelf opens the launcher's uninstaller — it never deletes anything itself.</div>
    </Card>
  );
}

export const VIGNETTES = [Launchers, Folders, Toast, Hours, Drive];
