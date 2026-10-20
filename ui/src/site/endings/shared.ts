import type { Ref } from "react";
import type { GameView } from "../../bridge/protocol";

/** What every ending gets: the games, the one in flight, whether it has landed, and where it should land. */
export interface EndingProps {
  games: GameView[];
  faller: GameView;
  landed: boolean;
  slotRef: Ref<HTMLDivElement>;
  onOpen(g: GameView): void;
}

const squash = (t: string) => t.replace(/[^A-Za-z0-9 ]+/g, "").trim();

/** A believable install folder for a game, by where it came from. */
export function installPath(g: GameView): string {
  const t = squash(g.title);
  switch (g.sources[0]) {
    case "steam": return `C:\\Program Files (x86)\\Steam\\steamapps\\common\\${t}`;
    case "epic": return `C:\\Program Files\\Epic Games\\${t.replace(/ /g, "")}`;
    case "gog": return `D:\\GOG Games\\${t}`;
    case "rockstar": return `C:\\Program Files\\Rockstar Games\\${t}`;
    case "xbox": return `D:\\XboxGames\\${t.replace(/ /g, "")}`;
    case "itch": return `C:\\Users\\you\\AppData\\Roaming\\itch\\apps\\${t.toLowerCase()}`;
    default: return `D:\\Downloads\\${t.replace(/ /g, "")}`;
  }
}

export const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : null);

export const ago = (iso: string | null) => {
  const d = daysSince(iso);
  return d === null ? "never played" : d === 0 ? "played today" : d < 60 ? `${d}d ago` : `${Math.round(d / 30)} months ago`;
};
