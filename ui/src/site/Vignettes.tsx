import { Gamepad2 } from "lucide-react";
import type { ReactNode } from "react";
import { Cover } from "../components/Cover";
import { bytes } from "../lib/format";
import { isOverdue } from "../lib/library";
import { SITE_GAMES } from "./siteGames";

// Small pieces of the app, one per stop on the path, so each claim on the page comes with what it looks like.

const byTitle = (t: string) => SITE_GAMES.find((g) => g.title === t)!;

function Card({ label, aside, children, on }: { label: string; aside?: ReactNode; children: ReactNode; on: boolean }) {
  return (
    <div
      className="paper mt-7 w-full max-w-[400px] overflow-hidden rounded-[14px] transition-[transform,box-shadow] duration-500"
      style={{ transform: on ? "none" : "translateY(6px)", boxShadow: on ? "0 1px 2px rgb(0 0 0/.06), 0 24px 48px -24px rgb(0 0 0/.35)" : undefined }}
    >
      <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
        <span className="caps text-ink-3">{label}</span>
        {aside && <span className="typed text-[11px] text-ink-4">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

function Thumb({ title }: { title: string }) {
  const g = byTitle(title);
  return <div className="w-7 flex-none"><Cover title={g.title} url={g.coverUrl} bare className="rounded-[4px]" /></div>;
}

const count = (k: string) => SITE_GAMES.filter((g) => g.sources[0] === k).length;
const SOURCES: [string, number, string][] = [
  ["Steam", count("steam"), "#1b2838"], ["Epic", count("epic"), "#2a2a2a"], ["GOG", count("gog"), "#8a2be2"], ["Rockstar", count("rockstar"), "#f4a900"],
  ["Xbox", count("xbox"), "#107c10"], ["itch", count("itch"), "#fa5c5c"], ["Battle.net", 0, "#148eff"], ["Riot", 0, "#eb0029"], ["Folders", count("folder"), "var(--u-blue)"],
];

function Launchers({ on }: { on: boolean }) {
  return (
    <Card label="Found on this PC" aside={`${SITE_GAMES.length} games`} on={on}>
      <div className="flex flex-wrap gap-2 p-4">
        {SOURCES.map(([name, n, c]) => (
          <span key={name} className={`inline-flex items-center gap-2 rounded-full border border-rule-strong px-3 py-1 text-[13px] ${n ? "text-ink" : "text-ink-4"}`}>
            <span className="size-2 rounded-full" style={{ background: c, opacity: n ? 1 : 0.35 }} />
            {name}
            <span className="typed text-[11px] text-ink-3">{n}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}

const SCAN: [string, string | null, string, number][] = [
  [String.raw`D:\Downloads\HollowKnight_v1.5`, "Hollow Knight", "Unity · one real exe", 94],
  [String.raw`E:\Games\LiesOfP`, "Lies of P", "Unreal · data paks", 88],
  [String.raw`F:\stuff\proj_final`, null, "one exe, no engine", 52],
];

function Folders({ on }: { on: boolean }) {
  return (
    <Card label="Folder scan" aside="score / 100" on={on}>
      {SCAN.map(([path, title, why, score]) => {
        const tone = score >= 70 ? "var(--ok)" : "var(--u-yellow)";
        return (
          <div key={path} className="flex items-center gap-3 border-b border-rule px-4 py-3 last:border-b-0">
            {title ? <Thumb title={title} /> : <div className="flex aspect-[2/3] w-7 flex-none items-center justify-center rounded-[4px] bg-sunken text-ink-4">?</div>}
            <div className="min-w-0 flex-1">
              <div className="typed truncate text-[11px] text-ink-3">{path}</div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display truncate text-[20px] leading-tight">{title ?? "Maybe a game?"}</span>
                <span className="typed text-[13px]" style={{ color: tone }}>{score}</span>
              </div>
              <div className="relative mt-1 h-1 rounded-full bg-sunken">
                <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700" style={{ width: on ? `${score}%` : "0%", background: tone }} />
              </div>
              <div className="mt-1 text-[11.5px] text-ink-3">{why} · {score >= 70 ? "to Library" : "to Review"}</div>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function Toast({ on }: { on: boolean }) {
  const g = byTitle("Hollow Knight");
  return (
    <div
      className="mt-7 w-full max-w-[380px] rounded-[12px] border border-rule-strong bg-surface p-4 shadow-[0_24px_48px_-24px_rgb(0_0_0/.45)] transition-[transform,opacity] duration-500"
      style={{ transform: on ? "none" : "translateX(16px)", opacity: on ? 1 : 0.6 }}
    >
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        <img src="./icon.svg" alt="" className="size-4" /> Shelf <span className="ml-auto">now</span>
      </div>
      <div className="mt-3 flex gap-3">
        <div className="w-11 flex-none"><Cover title={g.title} url={g.coverUrl} bare className="rounded-[5px]" /></div>
        <div className="min-w-0">
          <div className="text-[14.5px] font-semibold">New game: Hollow Knight</div>
          <div className="typed mt-0.5 truncate text-[11.5px] text-ink-3">{String.raw`D:\Downloads\HollowKnight_v1.5`}</div>
          <div className="mt-3 flex gap-2">
            <span className="rounded-[6px] bg-accent px-3 py-1 text-[12.5px] font-medium text-accent-ink">Open</span>
            <span className="rounded-[6px] border border-rule-strong px-3 py-1 text-[12.5px] text-ink-2">Not a game</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const DAYS = [0.6, 0, 1.4, 2.2, 0.4, 0, 0, 3.1, 1.2, 0.8, 2.6, 0, 1.9, 0.9];

function Hours({ on }: { on: boolean }) {
  return (
    <Card label="Last 14 days" aside="11.1h this week" on={on}>
      <div className="flex items-center gap-3 border-b border-rule px-4 py-3">
        <Thumb title="Counter-Strike 2" />
        <div className="flex-1">
          <div className="flex items-center gap-2 text-[14px] font-medium"><span className="pulse-dot size-2 rounded-full bg-ok" /> Counter-Strike 2</div>
          <div className="typed text-[11px] text-ink-3">playing · 47m · launched from a desktop shortcut</div>
        </div>
        <Gamepad2 className="size-4 text-ink-4" />
      </div>
      <div className="flex h-24 items-end gap-[5px] px-4 pt-3 pb-4">
        {DAYS.map((h, i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-end">
            <div className="rounded-t-[3px] bg-u-blue transition-[height] duration-700" style={{ height: h ? (on ? `${(h / 3.1) * 100}%` : "6%") : 2, opacity: h ? 1 : 0.25, transitionDelay: `${i * 25}ms` }} />
          </div>
        ))}
      </div>
    </Card>
  );
}

const IDLE: [string, string, number][] = [
  ["Red Dead Redemption 2", "Rockstar", 400],
  ["Disco Elysium", "GOG", 300],
  ["Cyberpunk 2077", "GOG", 230],
];

function Drive({ on }: { on: boolean }) {
  const parts = ["Baldur's Gate 3", "Red Dead Redemption 2", "Forza Horizon 5", "Apex Legends", "Cyberpunk 2077", "Helldivers 2"].map(byTitle);
  const disk = 1000 * 1024 ** 3;
  const all = SITE_GAMES.reduce((a, g) => a + g.sizeBytes, 0);
  const idle = SITE_GAMES.filter((g) => isOverdue(g)).reduce((a, g) => a + g.sizeBytes, 0);
  return (
    <Card label="C: Windows" aside="91% full" on={on}>
      <div className="px-4 pt-4">
        <div className="flex h-3 overflow-hidden rounded-full bg-sunken">
          {parts.map((g, i) => (
            <div key={g.id} className="h-full border-r border-surface transition-[width] duration-700" style={{ width: on ? `${(g.sizeBytes / disk) * 100}%` : "0%", background: `hsl(${(i * 47 + 200) % 360} 55% 55%)` }} />
          ))}
        </div>
        <div className="typed mt-2 text-[11px] text-ink-3">games {bytes(all)} · not played in 90 days <span className="text-u-red">{bytes(idle)}</span></div>
      </div>
      <div className="mt-3">
        {IDLE.map(([t, via, days]) => {
          const g = byTitle(t);
          return (
            <div key={t} className="flex items-center gap-3 border-t border-rule px-4 py-2.5">
              <Thumb title={t} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{t}</div>
                <div className="typed text-[11px] text-ink-3">{bytes(g.sizeBytes)} · idle {days}d</div>
              </div>
              <span className="rounded-[6px] border border-rule-strong px-2.5 py-1 text-[12px] whitespace-nowrap text-ink-2">Uninstall via {via}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export const VIGNETTES = [Launchers, Folders, Toast, Hours, Drive];
