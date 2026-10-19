// Shared bits for the design explorer: the same sample library every direction renders, plus the native icons of
// the games on this PC (copied into ui/public/dev-icons by hand — git-ignored, never shipped).
import { useState } from "react";
import { sampleState } from "../bridge/previewBridge";
import type { GameView } from "../bridge/protocol";
import { dailyTotals, isOverdue, normalize } from "../lib/library";

export { bytes, hours, sourceName, relative, duration } from "../lib/format";
export { isOverdue };

const DAY = 86_400_000;

const ICONS: Record<string, string> = {
  "bongo cat": "bongo-cat",
  minecraft: "minecraft-launcher",
  "minecraft launcher": "minecraft-launcher",
  roblox: "roblox",
  "sekiro shadows die twice goty edition": "sekiro-shadows-die-twice-goty-edition",
  valorant: "valorant",
};

/** URL of the game's native icon when the dev icon set has it. */
export function iconFor(title: string): string | null {
  const key = ICONS[normalize(title)];
  return key ? `./dev-icons/${key}.png` : null;
}

/** An <img> that reports a missing file so the caller can draw its own fallback. */
export function useIcon(title: string): [string | null, () => void] {
  const [failed, setFailed] = useState(false);
  const url = iconFor(title);
  return [failed ? null : url, () => setFailed(true)];
}

export function useSample() {
  const s = sampleState();
  const games = s.games.filter((g) => g.installed && !g.hidden).sort((a, b) => Date.parse(b.lastPlayed ?? "0") - Date.parse(a.lastPlayed ?? "0"));
  const playing = new Set(s.playing.map((p) => p.gameId));
  const total = games.reduce((a, g) => a + g.sizeBytes, 0);
  const idle = games.filter((g) => isOverdue(g));
  const idleBytes = idle.reduce((a, g) => a + g.sizeBytes, 0);
  const byPlay = [...games].sort((a, b) => b.playSeconds - a.playSeconds);
  const bySize = [...games].sort((a, b) => b.sizeBytes - a.sizeBytes);
  const days14 = dailyTotals(s.sessions, 14);
  const week = days14.slice(7).reduce((a, d) => a + d.seconds, 0);
  return { state: s, games, playing, total, idle, idleBytes, byPlay, bySize, days14, week };
}

/** Seconds played per day over the last 14 days for one game (oldest first). */
export function spark(days: ReturnType<typeof dailyTotals>, gameId: number): number[] {
  return days.map((d) => d.byGame.get(gameId) ?? 0);
}

export function idleDays(g: GameView, now = Date.now()) {
  return Math.floor((now - Date.parse(g.lastPlayed ?? g.firstSeen)) / DAY);
}

export const initial = (title: string) => (title.trim()[0] ?? "?").toUpperCase();
