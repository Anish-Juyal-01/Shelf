// Shared bits for the design explorer: the same sample library every direction renders.
import { sampleState } from "../bridge/previewBridge";
import type { GameView } from "../bridge/protocol";
import { hash, isOverdue, normalize } from "../lib/library";

export { bytes, hours, sourceName, stampDate, relative } from "../lib/format";
export { isOverdue };

const DAY = 86_400_000;

export function useSample() {
  const s = sampleState();
  const games = s.games.filter((g) => g.installed && !g.hidden).sort((a, b) => Date.parse(b.lastPlayed ?? "0") - Date.parse(a.lastPlayed ?? "0"));
  const playing = new Set(s.playing.map((p) => p.gameId));
  const total = games.reduce((a, g) => a + g.sizeBytes, 0);
  const overdue = games.filter((g) => isOverdue(g));
  const byPlay = [...games].sort((a, b) => b.playSeconds - a.playSeconds);
  return { state: s, games, playing, total, overdue, byPlay };
}

/** Days since last played (or since first seen when never played). */
export function idleDays(g: GameView, now = Date.now()) {
  return Math.floor((now - Date.parse(g.lastPlayed ?? g.firstSeen)) / DAY);
}

/** Deterministic 0..1 values from a title, for per-game variation. */
export function rand(title: string, salt = 0) {
  return ((hash(normalize(title) + salt) % 10_000) / 10_000);
}

export function pick<T>(title: string, list: T[], salt = 0): T {
  return list[hash(normalize(title) + salt) % list.length];
}

/** An 8×8 symmetric pixel sprite (like a GitHub identicon) from a title. */
export function sprite(title: string): boolean[][] {
  const h = hash(normalize(title));
  const rows: boolean[][] = [];
  for (let y = 0; y < 8; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < 4; x++) row.push(((h >>> ((y * 4 + x) % 31)) & 1) === 1 && !(y === 0 && x === 0));
    rows.push([...row, ...[...row].reverse()]);
  }
  return rows;
}

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export function rarity(g: GameView): Rarity {
  const h = g.playSeconds / 3600;
  if (h >= 200) return "legendary";
  if (h >= 80) return "epic";
  if (h >= 30) return "rare";
  if (h >= 5) return "uncommon";
  return "common";
}
