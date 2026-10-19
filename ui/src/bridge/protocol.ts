// The JSON contract between the React UI and Shelf.App (src/Shelf.App/Bridge/UiBridge.cs).
// Host → UI messages carry the whole AppState; it is small (hundreds of games at most), so the UI never
// has to reconcile partial updates. Game detail (all sessions, every install) is fetched on demand.

export type SourceKind =
  | "steam" | "epic" | "gog" | "ea" | "ubisoft" | "rockstar" | "xbox" | "battleNet" | "itch" | "amazon"
  | "riot" | "hoYoPlay" | "installedApps" | "folder" | "manual" | "runtime";

export type SourceState = "ok" | "notInstalled" | "partial" | "unreadable";
export type ThemePref = "system" | "light" | "dark";

export interface GameView {
  id: number;
  title: string;
  sources: SourceKind[];
  installed: boolean;
  hidden: boolean;
  sizeBytes: number;
  /** Installed copies on disk; more than one is usually wasted space. */
  copies: number;
  /** Shelf-measured + launcher-imported. */
  playSeconds: number;
  trackedSeconds: number;
  importedSeconds: number;
  lastPlayed: string | null;
  firstSeen: string;
  path: string | null;
  canLaunch: boolean;
  genres: string[];
  year: number | null;
  coverUrl: string | null;
}

export interface InstallView {
  id: number;
  source: SourceKind;
  path: string;
  launchExe: string | null;
  state: "installed" | "missing" | "removed";
  sizeBytes: number | null;
  confidence: number;
  signals: string[];
  /** What the uninstall button does, or null when Shelf can only open the folder. */
  uninstallLabel: string | null;
}

export interface SessionView {
  id: number;
  gameId: number;
  title: string;
  start: string;
  end: string | null;
  seconds: number;
  reason: string | null;
}

export interface GameDetail {
  game: GameView;
  installs: InstallView[];
  sessions: SessionView[];
}

export interface DetectionView {
  id: number;
  title: string;
  path: string;
  exe: string | null;
  origin: "scan" | "installed_apps" | "runtime";
  confidence: number;
  sizeBytes: number | null;
  signals: string[];
  found: string;
}

export interface SourceView {
  source: SourceKind;
  name: string;
  state: SourceState;
  message: string;
  count: number;
}

export interface LeftoverView {
  path: string;
  kind: "archive" | "installer";
  title: string;
  sizeBytes: number;
}

export interface DriveView {
  root: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
  gamesBytes: number;
}

export interface ScanStatus {
  running: boolean;
  phase: string | null;
  dirs: number;
  path: string | null;
  lastRun: string | null;
  lastSeconds: number | null;
  error: string | null;
}

export interface RootView {
  path: string;
  reachable: boolean;
}

export interface SettingsView {
  theme: ThemePref;
  scanRoots: RootView[];
  suggestedRoots: string[];
  drives: string[];
  runtimeDetection: boolean;
  watchFolders: boolean;
  startWithWindows: boolean;
  closeToTray: boolean;
  dataDir: string;
}

export interface PlayingView {
  gameId: number;
  since: string;
}

export interface GapView {
  start: string;
  end: string;
}

export interface WatchView {
  running: boolean;
  gpuCounters: boolean;
  trackingSince: string | null;
}

export interface AppState {
  games: GameView[];
  review: DetectionView[];
  sources: SourceView[];
  leftovers: LeftoverView[];
  drives: DriveView[];
  scan: ScanStatus;
  settings: SettingsView;
  playing: PlayingView[];
  /** Sessions from the last 35 days, newest first. */
  sessions: SessionView[];
  /** Stretches in the last 35 days when Shelf wasn't running (time played then wasn't counted). */
  gaps: GapView[];
  watch: WatchView;
}

export type NoticeTone = "info" | "success" | "error";

export type View = "library" | "activity" | "storage" | "review" | "settings";

export type HostMessage =
  | { type: "hello"; version: string; maximized: boolean; state: AppState }
  | { type: "state"; state: AppState }
  | { type: "scan"; scan: ScanStatus }
  | { type: "game"; detail: GameDetail }
  | { type: "notice"; tone: NoticeTone; text: string; view?: View; gameId?: number }
  | { type: "navigate"; view: View; gameId?: number }
  | { type: "window"; maximized: boolean };

export type ResizeEdge = "caption" | "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type SettingsPatch = Partial<Pick<SettingsView, "theme" | "runtimeDetection" | "watchFolders" | "startWithWindows" | "closeToTray">>;

export type UiMessage =
  | { type: "ready" }
  | { type: "window"; action: "drag" | "minimize" | "maximize" | "close" | "quit"; edge?: ResizeEdge }
  | { type: "launch"; gameId: number }
  | { type: "openFolder"; path: string }
  | { type: "reveal"; path: string }
  | { type: "uninstall"; installId: number }
  | { type: "setHidden"; gameId: number; hidden: boolean }
  | { type: "rename"; gameId: number; title: string }
  | { type: "accept"; id: number; title?: string }
  | { type: "reject"; id: number }
  | { type: "addExe" }
  | { type: "dropFiles" }
  | { type: "refresh" }
  | { type: "cancelScan" }
  | { type: "addRoot" }
  | { type: "addRootPath"; path: string }
  | { type: "removeRoot"; path: string }
  | { type: "scanDrive"; root: string }
  | { type: "updateSettings"; patch: SettingsPatch }
  | { type: "getGame"; id: number }
  | { type: "openDataFolder" };
