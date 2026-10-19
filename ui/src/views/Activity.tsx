import clsx from "clsx";
import { useMemo, useState } from "react";
import type { GameView, SessionView } from "../bridge/protocol";
import { Empty, PageHead, SectionTitle } from "../components/ui";
import { useNow } from "../components/useNow";
import { clock, duration, hours } from "../lib/format";
import { coverStyle, dailyTotals, topGames } from "../lib/library";
import { useApp, useGameMap } from "../store/store";

const DAY = 86_400_000;
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function Activity() {
  const state = useApp((s) => s.state)!;
  const games = useGameMap();
  const openGame = useApp((s) => s.openGame);
  const now = useNow(60_000);

  // Recomputed when sessions change or every 10 minutes (so "today" rolls over at midnight).
  const tick = Math.floor(now / 600_000);
  const week = useMemo(() => {
    const at = new Date(tick * 600_000);
    return dailyTotals(state.sessions, 7, at);
  }, [state.sessions, tick]);
  const fortnight = useMemo(() => dailyTotals(state.sessions, 14, new Date(tick * 600_000)), [state.sessions, tick]);

  const weekTotal = week.reduce((a, d) => a + d.seconds, 0);
  const lastWeek = fortnight.slice(0, 7).reduce((a, d) => a + d.seconds, 0);
  const top = topGames(week, 6);

  if (state.sessions.length === 0) {
    return (
      <div className="mx-auto max-w-[1180px] px-8 pt-7">
        <PageHead title="Activity" />
        <Empty title="No play recorded yet.">
          Shelf records every session while it runs in the tray — whichever launcher (or folder) the game came from.
        </Empty>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1180px] px-8 pt-7 pb-16">
      <PageHead
        title="The last seven days"
        sub={
          <>
            {duration(weekTotal)} played
            {lastWeek > 0 && <> · the seven days before: {duration(lastWeek)}</>}
            {state.watch.trackingSince && <> · tracking since {new Date(state.watch.trackingSince).toLocaleDateString()}</>}
          </>
        }
      />

      <WeekTimeline sessions={state.sessions} games={games} gaps={state.gaps} now={now} onOpen={openGame} />

      <div className="mt-12 grid grid-cols-[1.4fr_1fr] gap-10 max-[980px]:grid-cols-1">
        <section>
          <SectionTitle aside="last 14 days">Playtime per day</SectionTitle>
          <DayBars days={fortnight} />
        </section>
        <section>
          <SectionTitle aside="last 7 days">Most played</SectionTitle>
          {top.length === 0 ? (
            <p className="text-[13px] text-ink-3">Nothing played in the last seven days.</p>
          ) : (
            <ol className="space-y-2.5">
              {top.map(([id, secs], i) => {
                const g = games.get(id);
                const max = top[0][1];
                return (
                  <li key={id}>
                    <button onClick={() => openGame(id)} className="group block w-full cursor-pointer text-left">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-display truncate text-[20px] leading-tight text-ink group-hover:text-accent">
                          <span className="typed mr-2 text-[11px] text-ink-4">{String(i + 1).padStart(2, "0")}</span>
                          {g?.title ?? "Removed game"}
                        </span>
                        <span className="typed shrink-0 text-[12px] text-ink-2">{duration(secs)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-sunken">
                        <div className="h-full rounded-full" style={{ width: `${(secs / max) * 100}%`, background: g ? coverStyle(g.title).cloth.bg : "var(--ink-3)" }} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <RecentSessions sessions={state.sessions} games={games} onOpen={openGame} />
    </div>
  );
}

function WeekTimeline({ sessions, games, gaps, now, onOpen }: {
  sessions: SessionView[]; games: Map<number, GameView>; gaps: { start: string; end: string }[]; now: number; onOpen(id: number): void;
}) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - 6 + i);
    return d.getTime();
  });
  const [hover, setHover] = useState<SessionView | null>(null);

  const blocks = (dayStart: number) => {
    const dayEnd = dayStart + DAY;
    return sessions
      .map((s) => ({ s, a: Date.parse(s.start), b: s.end ? Date.parse(s.end) : now }))
      .filter(({ a, b }) => b > dayStart && a < dayEnd)
      .map(({ s, a, b }) => ({ s, left: ((Math.max(a, dayStart) - dayStart) / DAY) * 100, width: ((Math.min(b, dayEnd) - Math.max(a, dayStart)) / DAY) * 100 }));
  };
  const gapBlocks = (dayStart: number) => {
    const dayEnd = Math.min(dayStart + DAY, now);
    return gaps
      .map((g) => ({ a: Date.parse(g.start), b: Date.parse(g.end) }))
      .filter(({ a, b }) => b > dayStart && a < dayEnd)
      .map(({ a, b }) => ({ left: ((Math.max(a, dayStart) - dayStart) / DAY) * 100, width: ((Math.min(b, dayEnd) - Math.max(a, dayStart)) / DAY) * 100 }));
  };

  return (
    <section className="paper relative rounded-[4px] px-5 pt-4 pb-3">
      <div className="ml-[72px] flex justify-between pb-2">
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
          <span key={h} className="typed w-0 text-center text-[10px] text-ink-4">{String(h).padStart(2, "0")}</span>
        ))}
      </div>
      <ul className="space-y-1.5">
        {days.map((d) => {
          const future = d > now;
          const isToday = now >= d && now < d + DAY;
          const total = blocks(d).reduce((a, b) => a + (b.width / 100) * 86400, 0);
          return (
            <li key={d} className="flex items-center gap-3">
              <span className={clsx("typed w-[60px] shrink-0 text-[11.5px]", isToday ? "font-semibold text-ink" : "text-ink-3")}>
                {DOW[(new Date(d).getDay() + 6) % 7]} <span className="text-ink-4">{new Date(d).getDate()}</span>
              </span>
              <div className={clsx("relative h-7 flex-1 rounded-[3px] border border-rule", future ? "bg-transparent opacity-40" : "bg-sunken/40")}>
                {[25, 50, 75].map((p) => <div key={p} className="absolute top-0 bottom-0 w-px bg-rule" style={{ left: `${p}%` }} />)}
                {gapBlocks(d).map((g, j) => (
                  <div key={j} className="hatch absolute top-0 bottom-0 opacity-70" style={{ left: `${g.left}%`, width: `${g.width}%` }} title="Shelf wasn't running — play here wasn't counted" />
                ))}
                {blocks(d).map(({ s, left, width }) => {
                  const g = games.get(s.gameId);
                  return (
                    <button
                      key={s.id}
                      onClick={() => onOpen(s.gameId)}
                      onMouseEnter={() => setHover(s)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(s)}
                      onBlur={() => setHover(null)}
                      aria-label={`${s.title}, ${clock(s.start)}, ${duration(s.seconds)}`}
                      className="absolute top-[3px] bottom-[3px] min-w-[3px] cursor-pointer rounded-[2px] ring-ink/40 hover:ring-2"
                      style={{ left: `${left}%`, width: `${width}%`, background: g ? coverStyle(g.title).cloth.bg : "var(--ink-3)" }}
                    />
                  );
                })}
                {isToday && <div className="absolute -top-1 -bottom-1 w-[2px] rounded bg-stamp-red" style={{ left: `${((now - d) / DAY) * 100}%` }} />}
              </div>
              <span className="typed w-[52px] shrink-0 text-right text-[11px] text-ink-2">{total > 0 ? hours(total) : ""}</span>
            </li>
          );
        })}
      </ul>
      <div className="typed mt-3 flex h-5 items-center justify-between text-[11.5px] text-ink-3">
        <span>
          {hover ? (
            <>
              <span className="text-ink">{hover.title}</span> · {clock(hover.start)}–{hover.end ? clock(hover.end) : "now"} · {duration(hover.seconds)}
            </>
          ) : (
            "Hover a block for details · click to open the game"
          )}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="hatch inline-block h-3 w-5 rounded-[2px] border border-rule" /> Shelf not running
        </span>
      </div>
    </section>
  );
}

function DayBars({ days }: { days: { date: Date; seconds: number }[] }) {
  const max = Math.max(3600, ...days.map((d) => d.seconds));
  return (
    <div className="paper rounded-[4px] px-5 pt-5 pb-3">
      <div className="flex h-[160px] items-end gap-[6px]">
        {days.map((d) => {
          const weekend = d.date.getDay() === 0 || d.date.getDay() === 6;
          return (
            <div key={d.date.getTime()} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.date.toLocaleDateString()} — ${duration(d.seconds)}`}>
              <div
                className={clsx("w-full rounded-t-[2px] transition-colors", d.seconds > 0 ? "bg-accent group-hover:brightness-110" : "bg-rule")}
                style={{ height: d.seconds > 0 ? `${Math.max(3, (d.seconds / max) * 100)}%` : 2 }}
              />
              <span className={clsx("typed mt-1.5 text-center text-[10px]", weekend ? "text-ink-2" : "text-ink-4")}>{d.date.getDate()}</span>
            </div>
          );
        })}
      </div>
      <p className="typed mt-2 text-[11px] text-ink-3">
        Busiest: {(() => {
          const b = [...days].sort((a, z) => z.seconds - a.seconds)[0];
          return b && b.seconds > 0 ? `${b.date.toLocaleDateString(undefined, { weekday: "long" })} ${b.date.getDate()} · ${duration(b.seconds)}` : "—";
        })()}
      </p>
    </div>
  );
}

function RecentSessions({ sessions, games, onOpen }: { sessions: SessionView[]; games: Map<number, GameView>; onOpen(id: number): void }) {
  const recent = sessions.slice(0, 10);
  return (
    <section className="mt-12">
      <SectionTitle>Recent sessions</SectionTitle>
      <ul className="typed divide-y divide-rule text-[12.5px]">
        {recent.map((s) => (
          <li key={s.id}>
            <button onClick={() => onOpen(s.gameId)} className="grid w-full cursor-pointer grid-cols-[110px_120px_1fr_80px] items-center gap-3 py-2 text-left hover:bg-surface-2/60">
              <span className="text-stamp-violet">{new Date(s.start).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" })}</span>
              <span className="text-ink-3">{clock(s.start)}–{s.end ? clock(s.end) : "now"}</span>
              <span className="font-display truncate text-[18px] text-ink">{games.get(s.gameId)?.title ?? s.title}</span>
              <span className="text-right text-ink-2">{duration(s.seconds)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
