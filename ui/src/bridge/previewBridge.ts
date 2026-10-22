// DEVELOPMENT PREVIEW ONLY.
// Used when the UI is opened in a normal browser (`npm run dev`), where there is no Shelf host. It renders sample
// data so the interface can be designed and reviewed; the UI shows a "Preview data" banner whenever this bridge is
// active. It never runs inside the Shelf app.

import type { Bridge } from "./bridge";
import type {
  AppState, DetectionView, GameDetail, GameView, HostMessage, InstallView, SessionView, SourceKind, UiMessage,
} from "./protocol";

const GB = 1024 ** 3;
const DAY = 86_400_000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

type Seed = [title: string, sources: SourceKind[], gb: number, playedDaysAgo: number | null, hours: number, extra?: Partial<GameView>];

const seeds: Seed[] = [
  ["Elden Ring", ["steam"], 48.6, 1, 212],
  ["Sekiro Shadows Die Twice GOTY Edition", ["installedApps"], 15.1, 140, 61],
  ["VALORANT", ["riot"], 33.6, 0, 318],
  ["Hollow Knight", ["folder"], 9.1, 4, 47],
  ["Baldur's Gate 3", ["steam", "folder"], 141, 9, 156, { copies: 2 }],
  ["Cyberpunk 2077", ["gog"], 71.2, 230, 88],
  ["Hades", ["epic"], 15.4, 2, 39],
  ["Roblox", ["xbox", "installedApps"], 0.7, 21, 12, { copies: 2 }],
  ["Bongo Cat", ["steam"], 0.7, 19, 0.2],
  ["Red Dead Redemption 2", ["rockstar"], 119, 400, 74],
  ["Stardew Valley", ["steam"], 0.6, 33, 102],
  ["Celeste", ["itch"], 1.2, 61, 14],
  ["Forza Horizon 5", ["xbox"], 103, 120, 23],
  ["Lies of P Deluxe Edition", ["folder"], 52.4, null, 0],
  ["Disco Elysium The Final Cut", ["gog"], 18.9, 300, 31],
  ["Minecraft", ["xbox"], 0.9, 6, 64],
  ["Terraria", ["steam"], 0.5, 95, 41],
  ["F1 22 Champions Edition", ["installedApps"], 0, 380, 9, { installed: false }],
];

/** Steam app ids for the sample games that are on Steam, so the preview shows real art like the app does. */
const STEAM: Record<string, number> = {
  "Elden Ring": 1245620, "Sekiro Shadows Die Twice GOTY Edition": 814380, "Hollow Knight": 367520, "Baldur's Gate 3": 1086940,
  "Cyberpunk 2077": 1091500, Hades: 1145360, "Bongo Cat": 3419430, "Red Dead Redemption 2": 1174180, "Stardew Valley": 413150,
  Celeste: 504230, "Forza Horizon 5": 1551360, "Lies of P Deluxe Edition": 1627720, "Disco Elysium The Final Cut": 632470,
  Terraria: 105600, "F1 22 Champions Edition": 1692250,
};
const steamArt = (title: string, file: string) => (STEAM[title] ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${STEAM[title]}/${file}` : null);

const games: GameView[] = seeds.map(([title, sources, gb, played, hours, extra], i) => {
  const tracked = Math.round(hours * 3600 * 0.35);
  return {
    id: i + 1,
    title,
    sources,
    installed: true,
    hidden: false,
    sizeBytes: Math.round(gb * GB),
    copies: 1,
    playSeconds: Math.round(hours * 3600),
    trackedSeconds: tracked,
    importedSeconds: Math.round(hours * 3600) - tracked,
    lastPlayed: played === null ? null : iso(now - played * DAY - 3 * 3600_000),
    firstSeen: iso(now - (60 + i * 11) * DAY),
    path: sources.includes("steam")
      ? `C:\\Program Files (x86)\\Steam\\steamapps\\common\\${title}`
      : sources.includes("folder") || sources.includes("installedApps")
        ? `D:\\Games\\${title}`
        : `C:\\Games\\${title}`,
    canLaunch: true,
    genres: [],
    year: null,
    coverUrl: steamArt(title, "library_600x900.jpg"),
    heroUrl: steamArt(title, "library_hero.jpg"),
    logoUrl: null,
    iconUrl: null,
    ...extra,
  };
});
games[17].sizeBytes = 0;

// Deterministic sessions: a few evenings a week for recently played games.
function makeSessions(): SessionView[] {
  const out: SessionView[] = [];
  let id = 1;
  const recent = games.filter((g) => g.lastPlayed && now - Date.parse(g.lastPlayed) < 35 * DAY);
  for (let d = 0; d < 35; d++) {
    const dayStart = new Date(now - d * DAY);
    dayStart.setHours(0, 0, 0, 0);
    recent.forEach((g, gi) => {
      if ((d + gi * 3) % (gi % 3 === 0 ? 2 : 4) !== 0) return;
      if (now - Date.parse(g.lastPlayed!) > d * DAY + DAY) return;
      const startHour = 17 + ((gi + d) % 5);
      const minutes = 25 + ((gi * 37 + d * 23) % 150);
      const start = dayStart.getTime() + startHour * 3600_000 + ((gi * 13) % 50) * 60_000;
      const end = start + minutes * 60_000;
      if (start > now) return;
      out.push({ id: id++, gameId: g.id, title: g.title, start: iso(start), end: iso(Math.min(end, now)), seconds: Math.round((Math.min(end, now) - start) / 1000), reason: "clean" });
    });
  }
  return out.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
}

const review: DetectionView[] = [
  {
    id: 1, title: "Mystery Dungeon Thing", path: "D:\\Downloads\\mdt_build_0412", exe: "D:\\Downloads\\mdt_build_0412\\mdt.exe",
    origin: "scan", confidence: 55, sizeBytes: 3.2 * GB, found: iso(now - 2 * DAY),
    signals: ["+25 Steamworks (steam_api)", "+15 Inside a Games folder", "+15 Sizeable folder beside the exe (3.2 GB+)"],
  },
  {
    id: 2, title: "Pixel Raft", path: "C:\\Users\\you\\Desktop\\PixelRaft", exe: "C:\\Users\\you\\Desktop\\PixelRaft\\PixelRaft.exe",
    origin: "runtime", confidence: 60, sizeBytes: null, found: iso(now - 3 * 3600_000),
    signals: ["Ran fullscreen for 60s+", "Seen running, not found by any launcher or scan"],
  },
  {
    id: 3, title: "Level Editor", path: "D:\\Tools\\LevelEditor", exe: "D:\\Tools\\LevelEditor\\editor.exe",
    origin: "scan", confidence: 40, sizeBytes: 0.4 * GB, found: iso(now - 9 * DAY),
    signals: ["+45 Unity engine (UnityPlayer.dll)", "-15 Qt desktop app"],
  },
];

let state: AppState = {
  games,
  review,
  sources: [
    { source: "steam", name: "Steam", state: "ok", message: "6 games in 2 libraries", count: 6 },
    { source: "epic", name: "Epic", state: "unreadable", message: "Epic is installed but its manifests folder wasn't found (C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests)", count: 0 },
    { source: "gog", name: "GOG", state: "ok", message: "2 games", count: 2 },
    { source: "ea", name: "EA", state: "ok", message: "0 games (via registry and the EA Games folder; EA's own database is encrypted)", count: 0 },
    { source: "ubisoft", name: "Ubisoft", state: "notInstalled", message: "Ubisoft Connect isn't installed", count: 0 },
    { source: "rockstar", name: "Rockstar", state: "ok", message: "1 game", count: 1 },
    { source: "xbox", name: "Xbox", state: "ok", message: "3 games", count: 3 },
    { source: "battleNet", name: "Battle.net", state: "notInstalled", message: "Battle.net isn't installed", count: 0 },
    { source: "itch", name: "itch", state: "ok", message: "1 game", count: 1 },
    { source: "amazon", name: "Amazon", state: "notInstalled", message: "Amazon Games isn't installed", count: 0 },
    { source: "riot", name: "Riot", state: "ok", message: "1 game", count: 1 },
    { source: "hoYoPlay", name: "HoYoPlay", state: "ok", message: "HoYoPlay found, no games installed", count: 0 },
    { source: "installedApps", name: "Installed app", state: "ok", message: "2 games among 153 installed apps · 1 listed but their folder is gone", count: 3 },
  ],
  leftovers: [
    { path: "D:\\Downloads\\Elden Ring [FitGirl Repack]", kind: "installer", title: "Elden Ring", sizeBytes: 47.9 * GB },
    { path: "D:\\Downloads\\Cyberpunk.2077.v2.1-GOG.zip", kind: "archive", title: "Cyberpunk 2077", sizeBytes: 64.3 * GB },
    { path: "C:\\Users\\you\\Downloads\\DaVinci_Resolve_21.1.1_Windows.zip", kind: "archive", title: "DaVinci Resolve Windows", sizeBytes: 3.5 * GB },
  ],
  drives: [
    { root: "C:\\", label: "Windows", totalBytes: 475 * GB, freeBytes: 43 * GB, gamesBytes: 245 * GB },
    { root: "D:\\", label: "Games", totalBytes: 931 * GB, freeBytes: 312 * GB, gamesBytes: 402 * GB },
  ],
  scan: { running: false, phase: null, dirs: 0, path: null, lastRun: iso(now - 40 * 60_000), lastSeconds: 1.4, error: null },
  settings: {
    theme: "system",
    palette: "sunset",
    heroStyle: "wheel",
    scanRoots: [{ path: "D:\\Games", reachable: true }, { path: "C:\\Users\\you\\Downloads", reachable: true }, { path: "E:\\Portable Games", reachable: false }],
    suggestedRoots: ["C:\\Users\\you\\Desktop", "C:\\Games"],
    drives: ["C:\\", "D:\\"],
    runtimeDetection: true,
    watchFolders: true,
    startWithWindows: true,
    closeToTray: true,
    webArt: true,
    hasSteamGridDbKey: false,
    dataDir: "C:\\Users\\you\\AppData\\Roaming\\Shelf",
  },
  playing: [{ gameId: 3, since: iso(now - 47 * 60_000) }],
  sessions: makeSessions(),
  gaps: [{ start: iso(now - 12 * DAY), end: iso(now - 10.5 * DAY) }],
  watch: { running: true, gpuCounters: true, trackingSince: iso(now - 34 * DAY) },
};

function detail(id: number): GameDetail {
  const game = state.games.find((g) => g.id === id)!;
  const installs: InstallView[] = game.sources.map((s, i) => ({
    id: id * 10 + i,
    source: s,
    path: i === 0 ? game.path ?? "" : `E:\\Old Games\\${game.title}`,
    launchExe: `${game.path}\\${game.title.replace(/\W/g, "")}.exe`,
    state: game.installed ? "installed" : "missing",
    sizeBytes: Math.round(game.sizeBytes / game.sources.length),
    confidence: s === "folder" ? 85 : 100,
    signals: s === "folder"
      ? ["+45 Unity engine (UnityPlayer.dll)", "+20 Unity data folder (<exe>_Data)", "+25 Game data files (8.7 GB)"]
      : s === "installedApps" ? ["+25 Steamworks (steam_api)", "+10 Steam emulator / app id file", "+35 Large game data files (12.4 GB)"] : [],
    uninstallLabel: s === "steam" ? "Uninstall in Steam" : s === "epic" ? "Uninstall in Epic" : s === "installedApps" ? "Open Installed apps" : null,
  }));
  return { game, installs, sessions: state.sessions.filter((s) => s.gameId === id) };
}

export function createPreviewBridge(): Bridge {
  const handlers = new Set<(m: HostMessage) => void>();
  const emit = (m: HostMessage) => setTimeout(() => handlers.forEach((h) => h(m)), 30);
  const push = () => emit({ type: "state", state });
  const notice = (text: string) => emit({ type: "notice", tone: "info", text: `Preview: ${text}` });

  return {
    isPreview: true,
    sendFiles: () => notice("dropped files are added in the real app"),
    send(message: UiMessage) {
      switch (message.type) {
        case "ready":
          emit({ type: "hello", version: "preview", maximized: false, state });
          break;
        case "getGame":
          emit({ type: "game", detail: detail(message.id) });
          break;
        case "setHidden":
          state = { ...state, games: state.games.map((g) => (g.id === message.gameId ? { ...g, hidden: message.hidden } : g)) };
          push();
          break;
        case "rename":
          state = { ...state, games: state.games.map((g) => (g.id === message.gameId ? { ...g, title: message.title } : g)) };
          push();
          emit({ type: "game", detail: detail(message.gameId) });
          break;
        case "accept": {
          const d = state.review.find((r) => r.id === message.id)!;
          const id = Math.max(...state.games.map((g) => g.id)) + 1;
          state = {
            ...state,
            review: state.review.filter((r) => r.id !== message.id),
            games: [...state.games, { ...games[3], id, title: message.title ?? d.title, sources: [d.origin === "runtime" ? "runtime" : "folder"], sizeBytes: d.sizeBytes ?? 0, playSeconds: 0, trackedSeconds: 0, importedSeconds: 0, lastPlayed: null, path: d.path }],
          };
          push();
          emit({ type: "notice", tone: "success", text: `Added ${message.title ?? d.title} to your shelf` });
          break;
        }
        case "reject":
          state = { ...state, review: state.review.filter((r) => r.id !== message.id) };
          push();
          break;
        case "updateSettings":
          {
            const { steamGridDbKey, ...patch } = message.patch;
            const hasKey = steamGridDbKey === undefined ? state.settings.hasSteamGridDbKey : steamGridDbKey.trim() !== "";
            state = { ...state, settings: { ...state.settings, ...patch, hasSteamGridDbKey: hasKey } };
          }
          push();
          break;
        case "removeRoot":
          state = { ...state, settings: { ...state.settings, scanRoots: state.settings.scanRoots.filter((r) => r.path !== message.path) } };
          push();
          break;
        case "addRootPath":
          state = {
            ...state,
            settings: {
              ...state.settings,
              scanRoots: [...state.settings.scanRoots, { path: message.path, reachable: true }],
              suggestedRoots: state.settings.suggestedRoots.filter((p) => p !== message.path),
            },
          };
          push();
          break;
        case "refresh":
        case "scanDrive": {
          let dirs = 0;
          const timer = setInterval(() => {
            dirs += 1873;
            emit({ type: "scan", scan: { ...state.scan, running: true, phase: "Scanning folders", dirs, path: `D:\\Games\\Library\\folder ${dirs}` } });
          }, 120);
          setTimeout(() => {
            clearInterval(timer);
            state = { ...state, scan: { ...state.scan, running: false, lastRun: new Date().toISOString(), lastSeconds: 2.1 } };
            push();
            emit({ type: "notice", tone: "success", text: "Library refreshed · nothing new" });
          }, 2600);
          break;
        }
        case "cancelScan":
          notice("scan cancelled");
          break;
        case "window":
          break;
        default:
          notice(`"${message.type}" does something real in the app`);
      }
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

/** Sample data for the design explorer (designs.html). */
export function sampleState(): AppState {
  return state;
}
