# Shelf — plan (phase 1)

**What it's for:** know every game on this PC (wherever it came from), how much space each one takes, and when you
last played it, so nothing gets forgotten and the drive stops filling up with games nobody plays.

Same stack and layout as Waypoint, so the two build, run and feel the same way:
.NET 10 (WPF host + WebView2) · React 19 + TypeScript + Vite + Tailwind v4 · xUnit · SQLite.

```
┌─────────────────────────────── Shelf.exe (WPF, .NET 10) ───────────────────────────────┐
│                                                                                          │
│  UI thread                         Background                                             │
│  ┌────────────┐ JSON  ┌─────────┐  ┌───────────────┐   reads only   ┌──────────────────┐ │
│  │ WebView2   │◀────▶│UiBridge │─▶│ LibraryService │──────────────▶│ Steam/Epic/GOG/  │ │
│  │ React UI   │      └─────────┘  │  SourceReaders │               │ EA/Ubi/Rockstar  │ │
│  └────────────┘      ┌─────────┐  │  FolderScanner │──────────────▶│ D:\Games, …      │ │
│  Tray + toasts       │ Tray    │  │  PlayWatcher   │◀── process ───│ running games    │ │
│  Single instance     └─────────┘  │  MetadataSvc   │── optional ──▶│ IGDB, SteamGridDB│ │
│                                   │  ShelfDb       │               └──────────────────┘ │
│                                   └───────────────┘   %APPDATA%\Shelf\shelf.db          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

## Solution structure

```
Shelf.sln
Directory.Build.props
src/
  Shelf.Core/                      no WPF; everything testable lives here
    Model/                         Game, Install, Session, Detection, SourceKind, SourceStatus
    Sources/                       one ISourceReader per store, all read-only
      Vdf/VdfParser.cs             Valve KeyValues text format (libraryfolders.vdf, *.acf, localconfig.vdf)
      SteamReader.cs               registry SteamPath → libraryfolders.vdf → appmanifest_*.acf
      EpicReader.cs                ProgramData\Epic\EpicGamesLauncher\Data\Manifests\*.item (JSON)
      GogReader.cs                 HKLM\…\GOG.com\Games\* (+ goggame-*.info in the install dir)
      EaReader.cs                  HKLM\…\Electronic Arts\* + Uninstall keys (EA's own DB is encrypted)
      UbisoftReader.cs             HKLM\…\Ubisoft\Launcher\Installs\*
      RockstarReader.cs            HKLM\…\Rockstar Games\* + Uninstall keys
      XboxReader.cs                <drive>:\XboxGames\*\Content\MicrosoftGame.config
      BattleNetReader.cs           ProgramData\Battle.net\Agent\product.db (protobuf) + registry
      ItchReader.cs                %APPDATA%\itch\db\butler.db (SQLite, opened read-only)
      AmazonReader.cs              %LOCALAPPDATA%\Amazon Games\Data\Games\Sql\GameInstallInfo.sqlite (read-only)
      UninstallKeyReader.cs        shared helper: Windows "Apps & features" registry entries
    Scanning/
      FolderScanner.cs             parallel, cancellable walk; yields candidates as found
      ExeClassifier.cs             noise filter (setup/unins/redist/vcredist/DXSETUP/crash reporters/helpers)
      EngineFingerprints.cs        Unity, IL2CPP, Unreal, Godot, RPG Maker, Ren'Py, Source, GameMaker…
      ConfidenceScorer.cs          signals → score 0–100; ≥ 70 library, 35–69 Review, < 35 dropped
      ScanCache.cs                 per-folder fingerprint so re-scans skip unchanged folders
      SizeCalculator.cs            fast size walk; skips cloud placeholders, never follows junctions
    Naming/
      NameCleaner.cs               "Hollow_Knight_v1.5.78 [FitGirl Repack]" → "Hollow Knight"
    Dedup/
      GameMatcher.cs               path match → same game; title match → same game, separate installs
    Watching/                      (phase 3)
      ProcessPoller.cs             Toolhelp snapshot every 5 s, compared against a hash set of known exes
      ForegroundMonitor.cs         SetWinEventHook(EVENT_SYSTEM_FOREGROUND): event-driven, ~0 CPU idle
      GpuSampler.cs                PDH "GPU Engine" counters, sampled only for a fullscreen candidate
      SessionTracker.cs            open/heartbeat/close; suspend/resume; crash recovery
    Storage/
      ShelfDb.cs                   SQLite (WAL), schema + migrations
      Repositories …
    Launching/
      Launcher.cs                  store URI or direct exe with the right working directory
    Metadata/                      (phase 5)
      IgdbClient.cs, SteamGridDbClient.cs, ArtCache.cs
  Shelf.Cli/                       shelf-cli: scan, list, sources, watch, sessions
  Shelf.App/                       WPF host, WebView2, UiBridge, tray, toasts, Start with Windows
tests/
  Shelf.Core.Tests/
    Fixtures/                      fake Steam library, Epic manifests, loose game folders (tiny dummy files
                                   with the right names; sizes faked via a file-system abstraction)
ui/                                React app, sample-data preview like Waypoint's
scripts/build.ps1
docs/ARCHITECTURE.md, docs/PLAN.md
```

## Data model (SQLite, `%APPDATA%\Shelf\shelf.db`)

```
games            one row per game (what you see in the library)
  id, title, sort_title, title_locked (user fixed it), hidden,
  first_seen_utc, last_played_utc, total_seconds,            -- denormalised for fast sorting
  imported_seconds                                           -- e.g. Steam's own playtime from before Shelf

installs         one row per copy on disk; a game can have several (Steam + a loose copy = 2 installs)
  id, game_id, source (steam|epic|gog|ea|ubisoft|rockstar|folder|manual|runtime), source_key (appid, AppName…),
  install_path (unique, normalised), launch_exe, working_dir, launch_uri, launch_args,
  size_bytes, size_measured_utc, size_source (manifest|measured),
  state (installed|missing|uninstalled), confidence, last_seen_utc

game_exes        exes that count as "playing" this game (launcher exe + *-Shipping.exe etc.)
  game_id, exe_path (unique), exe_name

sessions
  id, game_id, exe_path, pid, start_utc, end_utc, last_heartbeat_utc,
  end_reason (clean|heartbeat|suspend|app_exit)

detections       Review queue + runtime suggestions
  id, path, exe, origin (scan|runtime), signals_json, confidence, suggested_title,
  state (pending|accepted|rejected), found_utc

ignored          things you said "not a game" to; never asked again
  path_or_exe

scan_roots       folders you chose
  path, last_full_scan_utc, last_result (ok|partial|error), message

scan_cache       per-directory entry used for incremental re-scans
  dir_path, dir_mtime, child_exes_hash, verdict_json, scanned_utc

source_status    honest per-store reporting shown in the UI
  source, state (ok|not_installed|unreadable|partial), message, games_found, checked_utc

metadata         per game, optional
  game_id, igdb_id, sgdb_id, year, genres_json, cover_path, hero_path, manual_match, fetched_utc
```

`settings.json` (next to the DB) holds theme, API keys, scan roots UI state, watcher on/off, start with Windows.

## How each core piece works

**Store readers** read local files/registry only, each returning `SourceResult { status, message, installs[] }`.
"Steam not installed", "Epic manifests folder not found", "EA: 2 games found via registry, EA's own database
can't be read" are all first-class results the UI shows. Steam `StateFlags` / Epic `bIsIncompleteInstall` decide
whether something is actually installed. Steam and Epic give install size for free (`SizeOnDisk`, `InstallSize`).

**Folder scanner**
- Walks each root in parallel with `FileSystemEnumerable` (one `FindFirstFileEx` stream, no per-file stat calls).
  Never follows junctions/symlinks; skips cloud-only placeholders (OneDrive) so nothing gets downloaded; skips
  `Windows`, `Program Files\WindowsApps`, store library folders (already covered by readers).
- Stops descending once a folder is classified as a game root, which is most of what makes it fast.
- Signals per candidate exe, e.g. `UnityPlayer.dll` +40, `GameAssembly.dll` +40, `*-Win64-Shipping.exe` +45,
  `*_Data\` folder +20, ≥ 200 MB of `.pak/.bundle/.arc/.pck/.rpa/.vpk/.wad` +30, exe in a folder named like a game
  +10, signed by a known non-game publisher −40, noise name (setup, unins000, vc_redist, DXSETUP, CrashReport,
  UE4PrereqSetup, QtWebEngineProcess…) → dropped outright.
- Picks the *launch* exe (root exe / largest non-noise exe) and records the *play* exes (e.g. both
  `Game.exe` and `Game\Binaries\Win64\Game-Win64-Shipping.exe`).
- Incremental: re-scans compare each folder's mtime + list of exes against `scan_cache` and only re-examine what
  changed. Sizes are re-measured in the background, game by game, after the library is already on screen.
- Every result streams to the UI as found; a `CancellationToken` stops it within ~100 ms.

**Name cleaner** (pure function, heavily unit-tested): strip `[...]`/`(...)` tags, repack/scene group names
(FitGirl, DODI, ElAmigos, GOG, CODEX, EMPRESS, RUNE, TENOKE…), version strings (`v1.2.3`, `Build 12345`,
`Update 4`), edition noise left optional, `_`/`.` → spaces, CamelCase split for exe names (`HollowKnight.exe`),
`-Win64-Shipping` suffixes, collapse whitespace, title-case only when the input was all lower/upper.

**De-duplication**
- Same normalised install path → same install (e.g. Steam reader and folder scanner both see it).
- Same cleaned title → same *game*, but each copy stays its own *install* row. The game shows once in the
  library with a "2 copies · 84 GB" badge — that's usually wasted space you'll want to know about.

**Playtime (phase 3)** runs inside the app (tray) and doesn't need admin rights:
- Every 5 s, a Toolhelp process snapshot is matched against the set of known game exes (a few hundred µs).
- Session opens on first sight, heartbeat written every 60 s, closed when the process is gone.
- Sleep: on suspend, open sessions end at the suspend time; on resume, still-running games start a new session.
- Crash/power loss: on startup any session with no `end_utc` is closed at `last_heartbeat_utc`.
- Unknown games: foreground-window changes arrive as events (no polling). If the foreground window covers its whole
  monitor, or GPU 3D usage for that process stays above a threshold, for 60 s and the exe isn't a known non-game
  (browsers, video players, Explorer, Shelf's ignore list) → toast "Looks like you're playing X — add it?".

**Launching**: `steam://rungameid/<appid>`, `com.epicgames.launcher://apps/<ns>:<item>:<app>?action=launch&silent=true`,
`uplay://launch/<id>/0`, EA `link2ea://launchgame/<offer>` when known; GOG, Rockstar fallback and loose games run the
exe directly with `WorkingDirectory` set to the exe's folder.

## Risks and how I'll handle them

| Risk | Plan |
|---|---|
| WMI `Win32_ProcessStartTrace` and kernel ETW need **admin**; WMI `__InstanceCreationEvent WITHIN n` is polling in disguise and costly | Process snapshot every 5 s + event-driven foreground hook. Shelf runs as a normal user. Measured CPU goes in the phase 3 report. |
| Shelf isn't running → playtime missed | Start with Windows (Task Scheduler sign-in task, same as Waypoint), tray-only, small footprint. Missed time can't be recovered; the UI says when tracking was off. |
| Anti-cheat games (EAC/BattlEye/Vanguard) | Shelf only lists process names/PIDs. It never opens a game's process for memory, never injects or hooks, so there's nothing for anti-cheat to flag. |
| Fullscreen detection false positives (YouTube fullscreen, video players, emulator frontends) and misses (borderless windowed) | Combine fullscreen *or* sustained GPU, built-in non-game list, 60 s threshold, "Not a game" button that remembers. |
| Folder scan false positives (Unity/Electron apps, mod managers, tools, emulators) | Confidence threshold + Review queue; nothing below 70 lands in the library unasked. |
| 500 GB in < 1 min after first run | Incremental cache + stop descending at game roots + sizes measured after first paint. First run on a big HDD may take several minutes; I'll measure on your C: drive and report real numbers. |
| OneDrive / cloud placeholders, junction loops, access-denied folders | Attribute checks before descending; access errors counted and shown ("12 folders couldn't be read"), never fatal. |
| EA Desktop's install database is encrypted; Ubisoft/Rockstar formats change | Registry + Uninstall keys, reported as "partial" when that's all there is. Folder scanner is the safety net. |
| Steam `.acf`/`.vdf` quirks (escaped strings, multiple library folders, unmounted drives) | Proper VDF parser with fixtures; missing library drive reported, its games marked *missing* not deleted. |
| IGDB needs a Twitch client ID + secret (OAuth client-credentials, 4 req/s) | Settings stores both; throttled queue; everything works offline and with no keys. |
| SQLite native library inside a single-file exe | `IncludeNativeLibrariesForSelfExtract`; verified in `build.ps1`. |

**Rules baked into the code:** source readers and the scanner get read-only handles only; there is no file
write/move/delete API anywhere near game folders (enforced by a test that greps Core for write calls outside
`Storage/` and `Metadata/ArtCache`). The only network code lives in `Metadata/`.

## Phases

1. **Plan** (this document).
2. **Core**: VDF parser, all store readers (incl. Xbox, Battle.net, itch, Amazon, Uninstall keys), Steam hours import, folder scanner, classifier, scorer, name
   cleaner, dedup; fixture tests; `shelf-cli scan <path>`, `shelf-cli sources`, `shelf-cli list`.
3. **Watcher + playtime + SQLite + new-download watcher**, crash/sleep tests with a fake clock; `shelf-cli watch`, `shelf-cli sessions`.
4. **App shell + UI**: browser preview with sample data first, then the real bridge.
5. **Metadata + art, polish, `build.ps1`, README** in Waypoint's style.

## Visual direction (proposal)

**"Lending library."** Not a dark Steam grid: warm paper, ink and library-card details. Each game is a cover with a
card-catalogue slip under it — source as a rubber stamp (STEAM, EPIC, LOOSE), last played as a date stamp, size in
mono type. Games you haven't touched in 90+ days get an **OVERDUE** stamp, which is the point of the app: those are
the ones eating your drive. Dark mode is the same library after hours (deep green-black, brass accents). A Storage
shelf view shows games as spines whose thickness is their size on disk.

## Decisions (answered in phase 1)

1. **Storage view: yes, with uninstall links.** Size per game, *not played in 90+ days*, duplicate copies, and
   leftover installers/archives (`.zip/.rar/.7z/.iso` and repack folders ≥ 1 GB in Downloads and scan roots).
   *Uninstall* only opens the store's own uninstaller (`steam://uninstall/<appid>`, the Epic/EA/Ubisoft/Xbox app,
   or Windows *Installed apps*); for loose games it's *Open folder*. Shelf itself never deletes anything.
2. **Scan roots: suggest, you confirm**, plus a **Scan whole drive** button per drive for when you ask for it
   (skips Windows, Program Files system parts and store libraries already read by their readers).
3. **Launchers: all of them.** Added readers: Xbox / Game Pass (`XboxGames` folders + `MicrosoftGame.config`),
   Battle.net (`product.db` + registry), itch (`butler.db`), Amazon Games (`GameInstallInfo.sqlite`), plus a generic
   *Apps & features* registry reader that catches launcher games nobody else knows about. Loose zip/repack games
   come from the folder scanner. To catch new downloads right away, Shelf also watches its scan roots with a
   `FileSystemWatcher` (event-driven, no polling) and checks a new top-level folder a minute after it stops
   changing (so half-extracted zips aren't judged early).
4. **Steam hours: import** from `userdata\<id>\config\localconfig.vdf` as `imported_seconds`, shown as
   "incl. 120 h from Steam" so it's never confused with time Shelf measured.

## Phase 2 notes (what changed from the plan)

- **Scan cache and scan roots are JSON for now** (`%LOCALAPPDATA%\Shelf\scan-cache.json`,
  `%APPDATA%\Shelf\settings.json`). The cache is disposable, so JSON is fine; the library, sessions and review
  decisions move into SQLite in phase 3.
- **Two more readers**: Riot (VALORANT, League) and HoYoPlay (Genshin, Star Rail, ZZZ) — both were on this PC.
- **Launcher program folders are skipped by the scanner** (Steam's folder, Epic Launcher/Online Services, EA
  Desktop…): their overlays and helpers looked like games.
- **Folder timestamps are read from the folder itself** for cached game roots: the time in the parent's listing
  comes from NTFS's directory index, which Windows updates lazily.
- Playtime matching in phase 3 will use "process exe is inside the install folder" for store games, so launchers
  don't need to tell us which exe is the game.

## Phase 3 notes

- **Foreground check is polled, not hooked.** `GetForegroundWindow` is read with each 5 s process snapshot
  instead of a `SetWinEventHook` thread: same answer, a few microseconds, and one less thread with a message loop.
- **Power events**: `ShelfWatcher.Suspend()/Resume()` exist for the app to wire to `SystemEvents.PowerModeChanged`
  (phase 4). Independently of events, a gap of 90 s+ between polls is treated as sleep, so `shelf-cli watch`
  handles sleep correctly too.
- **Store games are matched by folder**: any non-helper exe running inside an install folder counts as playing
  that game; exact exe matches (manual/runtime adds) take priority.
- **Background refresh** every 30 minutes (incremental) catches games installed through launchers while Shelf runs;
  scan folders are watched live with `FileSystemWatcher` and a 60 s settle delay.
- Measured on this PC: watcher CPU 0.05–0.07 % of the machine (idle and while a game runs), ~55 MB working set.
