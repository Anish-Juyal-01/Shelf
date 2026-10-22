import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import type { GameView } from "../bridge/protocol";
import { useApp } from "../store/store";

/** The art that lights the room for a game: wide hero art first, then the cover, then the icon. */
export const roomArt = (g: GameView | undefined | null) => g?.heroUrl ?? g?.coverUrl ?? g?.iconUrl ?? null;

/**
 * The room behind the whole app. Whatever you're looking at lights it: the open game page's game, else the game
 * focused in the library, else what's playing, else the most recently played game with art. The art is blown up
 * and blurred into ambient light and cross-fades when the focus moves. With no art at all, the colour theme's own
 * two lights glow instead.
 */
export function Room() {
  const state = useApp((s) => s.state);
  const gameId = useApp((s) => s.gameId);
  const focusId = useApp((s) => s.focusId);

  const art = useMemo(() => {
    if (!state) return null;
    const byId = (id: number | null | undefined) => (id == null ? undefined : state.games.find((g) => g.id === id));
    const recent = [...state.games]
      .filter((g) => g.installed && !g.hidden && roomArt(g))
      .sort((a, b) => Date.parse(b.lastPlayed ?? b.firstSeen) - Date.parse(a.lastPlayed ?? a.firstSeen))[0];
    return roomArt(byId(gameId)) ?? roomArt(byId(focusId)) ?? roomArt(byId(state.playing[0]?.gameId)) ?? roomArt(recent);
  }, [state, gameId, focusId]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* the theme's own light, always there underneath */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 55% at 22% 18%, var(--room-a), transparent 70%), radial-gradient(55% 60% at 82% 78%, var(--room-b), transparent 72%)",
          opacity: 0.55,
          filter: "blur(40px)",
        }}
      />
      <AnimatePresence initial={false}>
        {art && (
          <motion.div
            key={art}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          >
            <div className="room-art" style={{ backgroundImage: `url("${art}")` }} />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="room-veil" />
      <div className="room-grain" />
    </div>
  );
}
