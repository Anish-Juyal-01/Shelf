# Moving Shelf to Tauri (Rust)

Shelf is moving from WPF + WebView2 (C#) to Tauri 2 (Rust). The React UI stays exactly as it is: it already talks
to its host through one message protocol (`ui/src/bridge/protocol.ts`), so the Rust host speaks the same messages
(`ui_message` command in, `host` events out) and the UI only gained a third bridge next to the WebView2 one and the
browser preview.

The work happens on the `tauri` branch. `main` keeps the working C# app until the Rust one has caught up; then the C#
projects (`src/`, `tests/`, `Shelf.sln`) are removed.

## Layout

```
core/         shelf-core — the engine (launcher readers, scanner, matcher, storage, watcher), no UI
  src/        one module per area, mirroring src/Shelf.Core
  tests/      fixture-based tests, ported from tests/Shelf.Core.Tests
src-tauri/    the app: window, bridge, tray, startup — thin, calls into shelf-core
ui/           unchanged React UI (plus the Tauri bridge)
```

Run it: `npm --prefix ui run dev` in one terminal, `cargo run -p shelf` in another (or `npx --prefix ui tauri dev`).
Test it: `cargo test`.

## Stages

| Stage | What | C# it replaces | Status |
|---|---|---|---|
| 1 | Tauri app, bridge, window controls; model, platform, VDF, Steam + Epic readers | Model, Platform, Vdf, SteamReader, EpicReader | **done** |
| 2 | Every other reader (GOG, EA, Ubisoft, Rockstar, Battle.net, Riot, HoYoPlay, Xbox, itch, Amazon, installed apps); name cleaner, game matcher, exe/folder classifier, folder scanner + scan cache | Sources, Naming, Dedup, Scanning | **done** |
| 3 | SQLite library + sessions, settings, art cache and art locator, web art (Steam, SteamGridDB), library refresh, every UI message (launch, uninstall, review, roots…) | Storage, Library, Art, Metadata, Launching, AppHost, UiBridge | **done** |
| 4 | Watcher (process snapshots, playtime sessions, sleep, runtime detection with GPU counters, folder watching), tray, close-to-tray, start with Windows, single instance, notifications, exe icons | Watching, Tray, Shell | **done** |

Stage 3 notes: cached art reaches the UI over the `shelf` URI scheme (`http://shelf.localhost/art/<id>/<file>`), and
files dropped on the window arrive through Tauri's drag-drop event with real paths. 

Stage 4 notes: runtime detection now skips programs under `WindowsApps` (the C# watcher had suggested Claude and
WhatsApp as games). Sleep is caught by the gap between polls rather than power events, so a session ends at the last
poll before the PC slept. "Start with Windows" creates the same per-user sign-in task (`Shelf`) through `schtasks`.
| 5 | CLI on shelf-core, installer (NSIS, per-user), build/install scripts, README, remove the C# projects | Shelf.Cli, scripts | |

Each stage ports the C# tests for what it moves, so behaviour is checked the same way it was before.

Data stays where it is (`%APPDATA%\Shelf`, `%LOCALAPPDATA%\Shelf`) and in the same format, so switching from the C#
build to the Rust one keeps your library, playtime and settings.
