import type { GameView, SessionView, SourceKind } from "../bridge/protocol";

export const OVERDUE_DAYS = 90;
const DAY = 86_400_000;

/** Installed, taking real space, and not played for 90+ days (or never since Shelf/the launcher started counting). */
export function isOverdue(g: GameView, now = Date.now()): boolean {
  if (!g.installed || g.sizeBytes < 200 * 1024 ** 2) return false;
  const reference = g.lastPlayed ?? g.firstSeen;
  return now - Date.parse(reference) > OVERDUE_DAYS * DAY;
}

export type SortKey = "recent" | "playtime" | "name" | "size";
export type InstalledFilter = "all" | "installed" | "missing";

export interface LibraryFilter {
  query: string;
  sources: SourceKind[];
  installed: InstalledFilter;
  overdueOnly: boolean;
  showHidden: boolean;
  sort: SortKey;
}

export const defaultFilter: LibraryFilter = {
  query: "",
  sources: [],
  installed: "installed",
  overdueOnly: false,
  showHidden: false,
  sort: "recent",
};

/** Search ignores case, accents and punctuation: "baldurs gate" finds "Baldur's Gate 3". */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function filterGames(games: GameView[], f: LibraryFilter, now = Date.now()): GameView[] {
  const q = normalize(f.query);
  const list = games.filter((g) => {
    if (g.hidden && !f.showHidden) return false;
    if (f.installed === "installed" && !g.installed) return false;
    if (f.installed === "missing" && g.installed) return false;
    if (f.sources.length > 0 && !g.sources.some((s) => f.sources.includes(s))) return false;
    if (f.overdueOnly && !isOverdue(g, now)) return false;
    if (q && !normalize(g.title).includes(q) && !(g.path && normalize(g.path).includes(q))) return false;
    return true;
  });
  const byName = (a: GameView, b: GameView) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  const time = (s: string | null) => (s ? Date.parse(s) : 0);
  switch (f.sort) {
    case "name":
      return list.sort(byName);
    case "playtime":
      return list.sort((a, b) => b.playSeconds - a.playSeconds || byName(a, b));
    case "size":
      return list.sort((a, b) => b.sizeBytes - a.sizeBytes || byName(a, b));
    default:
      return list.sort((a, b) => time(b.lastPlayed) - time(a.lastPlayed) || byName(a, b));
  }
}

/** Sources present in the library, most common first (for filter chips). */
export function sourceCounts(games: GameView[]): [SourceKind, number][] {
  const counts = new Map<SourceKind, number>();
  for (const g of games) for (const s of g.sources) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// ── Generated covers ─────────────────────────────────────────────────────────────────────────────────────────
// Until real art is fetched (phase 5) every game gets a cloth-bound "book cover": a colour and a pattern picked
// deterministically from its title, so the same game always looks the same.

export const CLOTHS = [
  { bg: "#6E2A2A", fg: "#F1E3C8" }, // oxblood
  { bg: "#22385A", fg: "#E9DFC8" }, // navy
  { bg: "#2F4A3A", fg: "#EFE6CF" }, // bottle green
  { bg: "#B48A35", fg: "#2A1F12" }, // mustard
  { bg: "#4A4E57", fg: "#EDE6D6" }, // slate
  { bg: "#7A4B2A", fg: "#F3E6CC" }, // tan leather
  { bg: "#4C3566", fg: "#EDE2F2" }, // plum
  { bg: "#1F5B5B", fg: "#E4EFE9" }, // teal
  { bg: "#A2473A", fg: "#FBEBDD" }, // brick
  { bg: "#2B2B2B", fg: "#E7D8B5" }, // black buckram
];

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function coverStyle(title: string) {
  const h = hash(normalize(title));
  return { cloth: CLOTHS[h % CLOTHS.length], pattern: (h >>> 8) % 4, band: 22 + ((h >>> 12) % 30) };
}

// ── Activity ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface DayTotal {
  date: Date;
  seconds: number;
  byGame: Map<number, number>;
}

/** Seconds played per local calendar day for the last <days> days (oldest first), splitting sessions at midnight. */
export function dailyTotals(sessions: SessionView[], days: number, now = new Date()): DayTotal[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const result: DayTotal[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    result.push({ date: d, seconds: 0, byGame: new Map() });
  }
  for (const s of sessions) {
    let start = Date.parse(s.start);
    const end = s.end ? Date.parse(s.end) : Math.min(now.getTime(), start + s.seconds * 1000);
    while (start < end) {
      const dayStart = new Date(start);
      dayStart.setHours(0, 0, 0, 0);
      const next = new Date(dayStart);
      next.setDate(dayStart.getDate() + 1);
      const chunkEnd = Math.min(end, next.getTime());
      const bucket = result.find((r) => r.date.getTime() === dayStart.getTime());
      if (bucket) {
        const secs = (chunkEnd - start) / 1000;
        bucket.seconds += secs;
        bucket.byGame.set(s.gameId, (bucket.byGame.get(s.gameId) ?? 0) + secs);
      }
      start = chunkEnd;
    }
  }
  return result;
}

export function topGames(days: DayTotal[], limit = 5): [number, number][] {
  const totals = new Map<number, number>();
  for (const d of days) for (const [g, s] of d.byGame) totals.set(g, (totals.get(g) ?? 0) + s);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/** Monday of the week containing <date>, local time. */
export function weekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d;
}
