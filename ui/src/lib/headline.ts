import type { GameView, PlayingView, SourceKind } from "../bridge/protocol";
import { bytes, sourceName } from "./format";
import { isOverdue } from "./library";

/** A piece of the editorial headline: plain text, or an underlined link with an action. */
export type Part =
  | string
  | { text: string; color: "blue" | "red" | "yellow" | "ink"; action: { view: "library" | "storage" | "activity" } | { gameId: number } };

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The one-sentence summary under the sky, e.g.
 * "You've got 17 games from Steam, Xbox and loose folders, using 632 GB — 7 haven't been touched in three months.
 *  Or just keep playing VALORANT."
 */
export function headline(games: GameView[], playing: PlayingView[], now = Date.now()): Part[] {
  const installed = games.filter((g) => g.installed && !g.hidden);
  if (installed.length === 0) return ["Your shelf is empty — ", { text: "add the folders where you keep games", color: "blue", action: { view: "library" } }, "."];

  const counts = new Map<SourceKind, number>();
  for (const g of installed) for (const s of g.sources) counts.set(s, (counts.get(s) ?? 0) + 1);
  const label = (s: SourceKind) => (s === "folder" ? "loose folders" : s === "installedApps" ? "installers" : sourceName[s]);
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => label(s));
  const unique = [...new Set(ordered)];
  const sources = unique.length > 3 ? `${unique.slice(0, 2).join(", ")} and ${unique.length - 2} more` : list(unique);

  const size = installed.reduce((a, g) => a + g.sizeBytes, 0);
  const overdue = installed.filter((g) => isOverdue(g, now)).length;

  const parts: Part[] = [
    "You've got ",
    { text: `${installed.length} game${installed.length === 1 ? "" : "s"}`, color: "blue", action: { view: "library" } },
    ` from ${sources}, using `,
    { text: bytes(size), color: "red", action: { view: "storage" } },
  ];
  if (overdue > 0) {
    parts.push(" — ", { text: `${overdue} ${overdue === 1 ? "hasn't" : "haven't"} been touched in three months`, color: "yellow", action: { view: "storage" } }, ".");
  } else {
    parts.push(".");
  }

  const current = playing[0] && installed.find((g) => g.id === playing[0].gameId);
  const recent = [...installed].filter((g) => g.lastPlayed).sort((a, b) => Date.parse(b.lastPlayed!) - Date.parse(a.lastPlayed!))[0];
  if (current) parts.push(" Or just ", { text: `keep playing ${current.title}`, color: "ink", action: { gameId: current.id } }, ".");
  else if (recent) parts.push(" Or just ", { text: `pick ${recent.title} back up`, color: "ink", action: { gameId: recent.id } }, ".");
  return parts;
}
