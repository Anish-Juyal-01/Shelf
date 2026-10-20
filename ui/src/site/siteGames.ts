import type { GameView, SourceKind } from "../bridge/protocol";

// The website's games: real titles with their real cover art, loaded from Steam's CDN (the same library art the
// app finds on disk). Only games on Steam, so every card has art.

const ART = (appId: number) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
const DAY = 86_400_000;
const now = Date.now();

const LIST: [title: string, appId: number, source: SourceKind, gb: number, playedDaysAgo: number | null][] = [
  ["Hollow Knight", 367520, "folder", 9.1, 4],
  ["Elden Ring", 1245620, "steam", 48.6, 1],
  ["Baldur's Gate 3", 1086940, "steam", 141, 9],
  ["Cyberpunk 2077", 1091500, "gog", 71.2, 230],
  ["Hades", 1145360, "epic", 15.4, 2],
  ["Red Dead Redemption 2", 1174180, "rockstar", 119, 400],
  ["Stardew Valley", 413150, "steam", 0.6, 33],
  ["Celeste", 504230, "itch", 1.2, 61],
  ["Forza Horizon 5", 1551360, "xbox", 103, 120],
  ["Lies of P", 1627720, "folder", 52.4, null],
  ["Disco Elysium", 632470, "gog", 18.9, 300],
  ["Terraria", 105600, "steam", 0.5, 95],
  ["Sekiro: Shadows Die Twice", 814380, "steam", 15.1, 140],
  ["Counter-Strike 2", 730, "steam", 33.2, 0],
  ["Apex Legends", 1172470, "steam", 74.5, 12],
  ["The Witcher 3: Wild Hunt", 292030, "steam", 49.8, 210],
  ["Resident Evil 4", 2050650, "steam", 67.3, 26],
  ["Helldivers 2", 553850, "steam", 72.1, 7],
  ["Lethal Company", 1966720, "steam", 1.4, 15],
];

/**
 * A fresh library for each visit: the games in a random order, and a random history, so the shelf, the wheel and
 * every example on the page come out different each time. About a third haven't been played for 90+ days.
 */
export function randomGames(): GameView[] {
  const games = SITE_GAMES.map((g) => ({ ...g }));
  for (let i = games.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [games[i], games[j]] = [games[j], games[i]];
  }
  games.forEach((g, i) => {
    // Always a few idle ones (positions 2–4), so the storage example has something to show.
    const idle = i >= 2 && (i <= 4 || Math.random() < 0.3);
    const days = idle ? 95 + Math.floor(Math.random() * 330) : Math.floor(Math.random() * 40);
    g.lastPlayed = new Date(now - days * DAY - Math.random() * DAY).toISOString();
  });
  return games;
}

export const SITE_GAMES: GameView[] = LIST.map(([title, appId, source, gb, days], i) => ({
  id: i + 1,
  title,
  sources: [source],
  installed: true,
  hidden: false,
  sizeBytes: Math.round(gb * 1024 ** 3),
  copies: 1,
  playSeconds: 0,
  trackedSeconds: 0,
  importedSeconds: 0,
  lastPlayed: days === null ? null : new Date(now - days * DAY).toISOString(),
  firstSeen: new Date(now - 500 * DAY).toISOString(),
  path: null,
  canLaunch: true,
  genres: [],
  year: null,
  coverUrl: ART(appId),
  heroUrl: null,
  logoUrl: null,
  iconUrl: null,
}));
