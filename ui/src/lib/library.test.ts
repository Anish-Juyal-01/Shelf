import { describe, expect, it } from "vitest";
import type { GameView, SessionView } from "../bridge/protocol";
import { coverStyle, dailyTotals, defaultFilter, filterGames, isOverdue, normalize, topGames, weekStart } from "./library";
import { bytes, duration, hours, stampDate } from "./format";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-19T12:00:00Z");

function game(p: Partial<GameView>): GameView {
  return {
    id: 1, title: "Game", sources: ["steam"], installed: true, hidden: false, sizeBytes: 10 * 1024 ** 3, copies: 1,
    playSeconds: 0, trackedSeconds: 0, importedSeconds: 0, lastPlayed: null, firstSeen: new Date(NOW - 10 * DAY).toISOString(),
    path: null, canLaunch: true, genres: [], year: null, coverUrl: null, ...p,
  };
}

describe("overdue", () => {
  it("flags big installed games not played for 90 days", () => {
    expect(isOverdue(game({ lastPlayed: new Date(NOW - 91 * DAY).toISOString() }), NOW)).toBe(true);
    expect(isOverdue(game({ lastPlayed: new Date(NOW - 89 * DAY).toISOString() }), NOW)).toBe(false);
  });
  it("uses first seen when never played", () => {
    expect(isOverdue(game({ firstSeen: new Date(NOW - 200 * DAY).toISOString() }), NOW)).toBe(true);
    expect(isOverdue(game({}), NOW)).toBe(false);
  });
  it("ignores tiny and uninstalled games", () => {
    const old = new Date(NOW - 400 * DAY).toISOString();
    expect(isOverdue(game({ lastPlayed: old, sizeBytes: 50 * 1024 ** 2 }), NOW)).toBe(false);
    expect(isOverdue(game({ lastPlayed: old, installed: false }), NOW)).toBe(false);
  });
});

describe("filterGames", () => {
  const games = [
    game({ id: 1, title: "Baldur's Gate 3", sources: ["steam", "folder"], playSeconds: 100, sizeBytes: 3, lastPlayed: new Date(NOW - DAY).toISOString() }),
    game({ id: 2, title: "Pokémon Thing", sources: ["folder"], playSeconds: 500, sizeBytes: 1 }),
    game({ id: 3, title: "Hidden Gem", hidden: true }),
    game({ id: 4, title: "Gone", installed: false }),
  ];
  it("searches ignoring punctuation and accents", () => {
    expect(filterGames(games, { ...defaultFilter, query: "baldurs gate" }, NOW).map((g) => g.id)).toEqual([1]);
    expect(filterGames(games, { ...defaultFilter, query: "pokemon" }, NOW).map((g) => g.id)).toEqual([2]);
  });
  it("hides hidden and uninstalled by default", () => {
    expect(filterGames(games, defaultFilter, NOW).map((g) => g.id).sort()).toEqual([1, 2]);
    expect(filterGames(games, { ...defaultFilter, installed: "all", showHidden: true }, NOW)).toHaveLength(4);
    expect(filterGames(games, { ...defaultFilter, installed: "missing" }, NOW).map((g) => g.id)).toEqual([4]);
  });
  it("filters by source and sorts", () => {
    expect(filterGames(games, { ...defaultFilter, sources: ["folder"], sort: "playtime" }, NOW).map((g) => g.id)).toEqual([2, 1]);
    expect(filterGames(games, { ...defaultFilter, sort: "size" }, NOW).map((g) => g.id)).toEqual([1, 2]);
    expect(filterGames(games, { ...defaultFilter, sort: "recent" }, NOW)[0].id).toBe(1);
  });
});

describe("activity", () => {
  const s = (start: string, end: string, gameId = 1): SessionView => ({
    id: 1, gameId, title: "x", start: new Date(start).toISOString(), end: new Date(end).toISOString(),
    seconds: (Date.parse(end) - Date.parse(start)) / 1000, reason: "clean",
  });
  it("splits a session across midnight", () => {
    const now = new Date(2026, 9, 19, 12);
    const days = dailyTotals([s("2026-10-18T23:00:00", "2026-10-19T01:30:00")], 7, now);
    expect(days).toHaveLength(7);
    expect(days[5].seconds).toBe(3600);
    expect(days[6].seconds).toBe(5400);
  });
  it("ranks top games", () => {
    const now = new Date(2026, 9, 19, 12);
    const days = dailyTotals([s("2026-10-18T10:00:00", "2026-10-18T11:00:00", 1), s("2026-10-18T12:00:00", "2026-10-18T15:00:00", 2)], 7, now);
    expect(topGames(days).map(([g]) => g)).toEqual([2, 1]);
  });
  it("weeks start on Monday", () => {
    expect(weekStart(new Date(2026, 9, 18)).getDay()).toBe(1); // Sunday → previous Monday
    expect(weekStart(new Date(2026, 9, 19)).getDate()).toBe(19);
  });
});

describe("format", () => {
  it("formats sizes, hours and stamps", () => {
    expect(bytes(15.1 * 1024 ** 3)).toBe("15.1 GB");
    expect(bytes(141 * 1024 ** 3)).toBe("141 GB");
    expect(bytes(null)).toBe("—");
    expect(hours(0)).toBe("—");
    expect(hours(540)).toBe("9m");
    expect(hours(9000)).toBe("2.5h");
    expect(duration(3900)).toBe("1h 05m");
    expect(stampDate(null)).toBe("NEVER");
    expect(stampDate("2026-10-12T10:00:00", new Date(2026, 9, 19))).toBe("12 OCT");
    expect(stampDate("2025-01-02T10:00:00", new Date(2026, 9, 19))).toBe("02 JAN 2025");
  });
  it("covers are stable per title", () => {
    expect(coverStyle("Hades")).toEqual(coverStyle("hades!"));
    expect(normalize("Ori & the Blind")).toBe("ori the blind");
  });
});
