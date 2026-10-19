import { describe, expect, it } from "vitest";
import type { GameView } from "../bridge/protocol";
import { headline } from "./headline";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-19T12:00:00Z");
const GB = 1024 ** 3;

function game(p: Partial<GameView>): GameView {
  return {
    id: 1, title: "Game", sources: ["steam"], installed: true, hidden: false, sizeBytes: GB, copies: 1, playSeconds: 0, trackedSeconds: 0,
    importedSeconds: 0, lastPlayed: new Date(NOW - DAY).toISOString(), firstSeen: new Date(NOW - 30 * DAY).toISOString(), path: null,
    canLaunch: true, genres: [], year: null, coverUrl: null, ...p,
  };
}

const text = (parts: ReturnType<typeof headline>) => parts.map((p) => (typeof p === "string" ? p : p.text)).join("");

describe("headline", () => {
  it("summarises count, sources, size and what to play", () => {
    const games = [
      game({ id: 1, title: "Hades", sources: ["epic"], lastPlayed: new Date(NOW - 2 * DAY).toISOString() }),
      game({ id: 2, title: "Elden Ring", sources: ["steam"], lastPlayed: new Date(NOW - DAY).toISOString() }),
      game({ id: 3, title: "Celeste", sources: ["folder"] }),
    ];
    expect(text(headline(games, [], NOW))).toBe("You've got 3 games from Epic, Steam and loose folders, using 3.0 GB. Or just pick Elden Ring back up.");
  });

  it("mentions overdue games and what's playing now", () => {
    const games = [
      game({ id: 1, title: "Old One", sizeBytes: 50 * GB, lastPlayed: new Date(NOW - 200 * DAY).toISOString() }),
      game({ id: 2, title: "VALORANT", sources: ["riot"] }),
    ];
    const parts = headline(games, [{ gameId: 2, since: new Date(NOW).toISOString() }], NOW);
    expect(text(parts)).toContain("1 hasn't been touched in three months");
    expect(text(parts)).toMatch(/Or just keep playing VALORANT\.$/);
    const link = parts.find((p) => typeof p !== "string" && p.text.startsWith("keep playing"));
    expect(link && typeof link !== "string" && link.action).toEqual({ gameId: 2 });
  });

  it("shortens long source lists and ignores hidden or uninstalled games", () => {
    const games = [
      game({ id: 1, sources: ["steam"] }), game({ id: 2, sources: ["epic"] }), game({ id: 3, sources: ["gog"] }),
      game({ id: 4, sources: ["xbox"] }), game({ id: 5, hidden: true }), game({ id: 6, installed: false }),
    ];
    expect(text(headline(games, [], NOW))).toContain("4 games from Steam, Epic and 2 more");
  });

  it("has something to say about an empty shelf", () => {
    expect(text(headline([], [], NOW))).toContain("Your shelf is empty");
  });
});
