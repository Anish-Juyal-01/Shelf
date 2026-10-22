import { create } from "zustand";
import { bridge } from "../bridge/bridge";
import type { AppState, GameDetail, HostMessage, NoticeTone, ScanStatus, View } from "../bridge/protocol";
import { defaultFilter, type LibraryFilter } from "../lib/library";
import { applyTheme } from "../lib/theme";

export interface Notice {
  id: number;
  tone: NoticeTone;
  text: string;
  view?: View;
  gameId?: number;
}

interface Store {
  connected: boolean;
  version: string;
  maximized: boolean;
  state: AppState | null;
  view: View;
  /** Game page open on top of the current view. */
  gameId: number | null;
  detail: GameDetail | null;
  filter: LibraryFilter;
  notices: Notice[];
  /** The game the library's arc is turned to; it lights the room. */
  focusId: number | null;

  setView(view: View): void;
  openGame(id: number | null): void;
  setFilter(patch: Partial<LibraryFilter>): void;
  setFocus(id: number | null): void;
  notify(tone: NoticeTone, text: string, extra?: Pick<Notice, "view" | "gameId">): void;
  dismiss(id: number): void;
  receive(m: HostMessage): void;
}

let noticeId = 0;

export const useApp = create<Store>((set, get) => ({
  connected: false,
  version: "",
  maximized: false,
  state: null,
  view: "library",
  gameId: null,
  detail: null,
  filter: defaultFilter,
  notices: [],
  focusId: null,

  setView: (view) => set({ view, gameId: null, detail: null }),

  openGame(id) {
    set({ gameId: id, detail: id === null ? null : get().detail?.game.id === id ? get().detail : null });
    if (id !== null) bridge.send({ type: "getGame", id });
  },

  setFilter: (patch) => set({ filter: { ...get().filter, ...patch } }),

  setFocus: (id) => set({ focusId: id }),

  notify(tone, text, extra) {
    const id = ++noticeId;
    set({ notices: [...get().notices.slice(-3), { id, tone, text, ...extra }] });
    setTimeout(() => get().dismiss(id), tone === "error" ? 9000 : 5000);
  },

  dismiss: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),

  receive(m) {
    switch (m.type) {
      case "hello":
        applyTheme(m.state.settings.theme, m.state.settings.palette);
        set({ connected: true, version: m.version, maximized: m.maximized, state: m.state });
        break;
      case "state": {
        applyTheme(m.state.settings.theme, m.state.settings.palette);
        set({ state: m.state });
        const open = get().gameId;
        if (open !== null) bridge.send({ type: "getGame", id: open });
        break;
      }
      case "scan": {
        const s = get().state;
        if (s) set({ state: { ...s, scan: m.scan as ScanStatus } });
        break;
      }
      case "game":
        if (m.detail.game.id === get().gameId) set({ detail: m.detail });
        break;
      case "notice":
        get().notify(m.tone, m.text, { view: m.view, gameId: m.gameId });
        break;
      case "navigate":
        get().setView(m.view);
        if (m.gameId !== undefined) get().openGame(m.gameId);
        break;
      case "window":
        set({ maximized: m.maximized });
        break;
    }
  },
}));

/** Games by id, for views that hold ids (sessions, playing, top lists). */
export function useGameMap() {
  const games = useApp((s) => s.state?.games);
  return new Map((games ?? []).map((g) => [g.id, g]));
}
