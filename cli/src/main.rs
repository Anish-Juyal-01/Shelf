//! `shelf-cli`: Shelf's engine from the command line — check detection, scan folders, track playtime and look up art
//! without the app. Same data as the app (`%APPDATA%\Shelf`, or `SHELF_DATA_DIR`).

use std::io::{IsTerminal, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use chrono::{Local, TimeZone};
use serde_json::json;
use shelf_core::library::{known_install_paths, Refresher};
use shelf_core::metadata::{system_clock, UreqHttp, WebArt, WebArtSync};
use shelf_core::model::{SourceResult, SourceState};
use shelf_core::naming;
use shelf_core::platform::{format_bytes, normalize, now_ms, path_key, SystemContext};
use shelf_core::scanning::scanner::{FolderScanner, LeftoverKind, ScanEvent, ScanOptions};
use shelf_core::scanning::suggest::suggest_roots;
use shelf_core::sources;
use shelf_core::storage::art_cache::ArtCache;
use shelf_core::storage::db::ShelfDb;
use shelf_core::storage::library::{DetectionRow, GameRow, LibraryStore};
use shelf_core::storage::sessions::SessionStore;
use shelf_core::storage::{CacheFile, Settings, ShelfPaths};
use shelf_core::watching::system::{PdhGpu, Win32Foreground, Win32Processes};
use shelf_core::watching::tracker::SessionEventKind;
use shelf_core::watching::watcher::{Probes, ShelfWatcher, WatcherEvent, WatcherOptions};
use shelf_core::watching::SystemClock;

const USAGE: &str = r#"shelf-cli — test Shelf's game detection without the app

  shelf-cli sources                     what each launcher reader found, and any problems
  shelf-cli scan <folder> [options]     scan a folder (or a whole drive, e.g. D:\) for games
      --full        ignore the cache and re-examine every folder
      --no-save     don't remember this folder for `list`
      --no-sizes    skip measuring folder sizes (faster)
  shelf-cli list [options]              refresh, save to the database and show every game with playtime
      --sort name|size|played|time      default: name
      --review      also show low-confidence detections waiting for review
      --leftovers   also show big archives and un-run installers
      --hidden      include games you hid
      --json        machine-readable output
  shelf-cli watch [--stats] [--no-refresh]
                                        track playtime live (Ctrl+C to stop); suggests unknown games
                                        that run fullscreen or use the GPU for 60s; spots new downloads
  shelf-cli sessions [--days N] [game]  play sessions (default: last 14 days)
  shelf-cli review                      detections waiting for a decision
  shelf-cli review accept <id> [title]  add one to the library (optionally with your title)
  shelf-cli review reject <id>          "not a game" — never suggested again
  shelf-cli add <exe> [title]           add a game by its exe
  shelf-cli roots [remove <folder>]     remembered scan folders
  shelf-cli suggest                     folders Shelf would suggest scanning
  shelf-cli clean <name>                run the name cleaner on a folder/exe name
  shelf-cli art [--key K] [--again]     look up missing covers/icons online (Steam; SteamGridDB with a key)

Shelf only reads: it never changes, moves or deletes anything in game folders. Only `art` goes online.
Data: %APPDATA%\Shelf (settings.json, shelf.db), cache: %LOCALAPPDATA%\Shelf"#;

static CANCEL: AtomicBool = AtomicBool::new(false);

type Res = Result<i32, String>;

fn main() {
    let _ = ctrlc::set_handler(|| {
        if CANCEL.swap(true, Ordering::Relaxed) {
            std::process::exit(130);
        }
        eprintln!("\nCancelling…");
    });
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first().map(|a| a.to_lowercase()) else {
        println!("{USAGE}");
        return;
    };
    let rest: Vec<String> = args[1..].to_vec();
    let result = match cmd.as_str() {
        "-h" | "--help" | "help" => {
            println!("{USAGE}");
            Ok(0)
        }
        "sources" => cmd_sources(),
        "scan" => cmd_scan(rest),
        "list" => cmd_list(rest),
        "watch" => cmd_watch(rest),
        "sessions" => cmd_sessions(rest),
        "review" => cmd_review(rest),
        "add" => cmd_add(rest),
        "roots" => cmd_roots(rest),
        "suggest" => cmd_suggest(),
        "clean" => cmd_clean(rest),
        "art" => cmd_art(rest),
        other => Err(format!("Unknown command '{other}'.\n\n{USAGE}")),
    };
    let code = match result {
        Ok(c) => c,
        Err(e) => {
            eprintln!("{e}");
            1
        }
    };
    std::process::exit(code);
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────────

fn flag(args: &mut Vec<String>, name: &str) -> bool {
    let before = args.len();
    args.retain(|a| a != name);
    args.len() != before
}

fn option(args: &mut Vec<String>, name: &str) -> Option<String> {
    let i = args.iter().position(|a| a == name)?;
    let v = args.get(i + 1)?.clone();
    args.drain(i..=i + 1);
    Some(v)
}

fn open_stores() -> Result<(ShelfPaths, LibraryStore, SessionStore), String> {
    let paths = ShelfPaths::default_paths();
    let db = ShelfDb::open_in(&paths).map_err(|e| format!("Couldn't open {}: {e}", paths.db_file().display()))?;
    Ok((paths, LibraryStore::new(db.clone()), SessionStore::new(db)))
}

fn bytes(b: Option<i64>) -> String {
    b.map(format_bytes).unwrap_or_default()
}

fn trunc(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n - 1).collect::<String>() + "…"
    }
}

fn pad(s: &str, n: usize) -> String {
    let t = trunc(s, n);
    let len = t.chars().count();
    t + &" ".repeat(n.saturating_sub(len))
}

fn hours(secs: i64) -> String {
    if secs <= 0 {
        String::new()
    } else if secs < 3600 {
        format!("{}m", secs / 60)
    } else {
        format!("{:.1}h", secs as f64 / 3600.0)
    }
}

fn duration(secs: i64) -> String {
    if secs >= 3600 {
        format!("{}h {:02}m", secs / 3600, secs % 3600 / 60)
    } else if secs >= 60 {
        format!("{}m", secs / 60)
    } else {
        format!("{secs}s")
    }
}

fn local(ms: i64) -> chrono::DateTime<Local> {
    Local.timestamp_millis_opt(ms).single().unwrap_or_else(Local::now)
}

fn width() -> usize {
    160
}

fn clear_progress() {
    if std::io::stderr().is_terminal() {
        eprint!("\r{}\r", " ".repeat(width() - 1));
    }
}

fn print_sources(results: &[SourceResult], verbose: bool) {
    for r in results {
        if !verbose && matches!(r.state, SourceState::Ok | SourceState::NotInstalled) {
            continue;
        }
        let mark = match r.state {
            SourceState::Ok => "ok  ",
            SourceState::Partial => "part",
            SourceState::NotInstalled => " -  ",
            SourceState::Unreadable => "FAIL",
        };
        println!("  [{mark}] {} {}", pad(r.source.display_name(), 14), r.message);
    }
}

// ── Commands ───────────────────────────────────────────────────────────────────────────────────────

fn cmd_sources() -> Res {
    let started = Instant::now();
    let results = sources::read_all(&SystemContext::real());
    print_sources(&results, true);
    let total: usize = results.iter().map(|r| r.installs.len()).sum();
    println!("\n{total} installs from launchers in {} ms", started.elapsed().as_millis());
    for r in results.iter().filter(|r| !r.installs.is_empty()) {
        println!("\n{}", r.source.display_name());
        for i in &r.installs {
            let state = if i.is_installed { "" } else { "  [folder missing]" };
            let conf = if i.source.is_store() { String::new() } else { format!("  ({}%)", i.confidence) };
            println!("  {}{conf}{state}\n    {}", i.title, i.install_path);
        }
    }
    Ok(0)
}

fn cmd_scan(mut args: Vec<String>) -> Res {
    let full = flag(&mut args, "--full");
    let no_save = flag(&mut args, "--no-save");
    let no_sizes = flag(&mut args, "--no-sizes");
    if args.len() != 1 {
        return Err("Usage: shelf-cli scan <folder> [--full] [--no-save] [--no-sizes]".into());
    }
    let root = normalize(&args[0]);
    if !Path::new(&root).is_dir() {
        return Err(format!("Folder not found: {root}"));
    }
    let paths = ShelfPaths::default_paths();
    let cache = CacheFile::load(&paths);
    eprintln!("Reading launchers so their games aren't scanned twice…");
    let ctx = SystemContext::real();
    let found = sources::read_all(&ctx);
    let options = ScanOptions { use_cache: !full, measure_sizes: !no_sizes, skip_paths: known_install_paths(&found, Some(&ctx)), ..Default::default() };
    let scanner = FolderScanner::new(options, &cache.folders);

    let whole = if root.len() <= 3 { " (whole drive)" } else { "" };
    println!("Scanning {root}{whole} — Ctrl+C to stop\n");
    let tty = std::io::stderr().is_terminal();
    let on_event = move |e: ScanEvent| match e {
        ScanEvent::Found(i) => {
            clear_progress();
            let tag = if i.confidence >= 70 { "+" } else { "?" };
            println!(" {tag} {} {:>3}%  {:>9}  {}", pad(&i.title, 40), i.confidence, bytes(i.size_bytes), i.install_path);
        }
        ScanEvent::Leftover(l) => {
            clear_progress();
            let kind = if l.kind == LeftoverKind::Archive { "archive" } else { "installer" };
            println!(" ~ {} {kind:>4}  {:>9}  {}", pad(&l.title, 40), format_bytes(l.size_bytes), l.path);
        }
        ScanEvent::Progress { path, dirs } if tty => {
            let p: String = if path.chars().count() > 90 { "…".to_string() + &path.chars().rev().take(89).collect::<Vec<_>>().into_iter().rev().collect::<String>() } else { path };
            let line = format!("\r  {dirs:>7} folders  {p}");
            eprint!("{line:<w$}", w = width() - 1);
            let _ = std::io::stderr().flush();
        }
        ScanEvent::Progress { .. } => {}
    };
    let result = scanner.scan(&root, Some(&on_event), &CANCEL);
    clear_progress();
    let _ = cache.save(&paths);

    println!();
    if let Some(e) = result.error {
        return Err(e);
    }
    let unreadable = if result.unreadable > 0 { format!(", {} couldn't be read", result.unreadable) } else { String::new() };
    println!(
        "{} in {:.1}s: {} games, {} to review, {} leftovers · {} folders visited, {} reused from last scan{unreadable}",
        if result.cancelled { "Stopped early" } else { "Done" },
        result.elapsed.as_secs_f64(),
        result.library.len(),
        result.review.len(),
        result.leftovers.len(),
        result.dirs_visited,
        result.cache_hits
    );
    for err in result.error_samples.iter().take(5) {
        println!("  unreadable: {err}");
    }
    println!(" + = library   ? = review (lower confidence)   ~ = leftover taking space");

    if !no_save && !result.cancelled {
        let mut settings = Settings::load(&paths);
        if !settings.scan_roots.iter().any(|r| path_key(r) == path_key(&root)) {
            settings.scan_roots.push(root.clone());
            settings.save(&paths).map_err(|e| e.to_string())?;
            println!("Remembered {root} for `shelf-cli list` (undo: shelf-cli roots remove \"{root}\").");
        }
    }
    Ok(if result.cancelled { 130 } else { 0 })
}

fn game_json(g: &GameRow) -> serde_json::Value {
    json!({
        "id": g.id, "title": g.title, "hidden": g.hidden, "installed": g.installed, "sizeBytes": g.size_bytes,
        "copies": g.installed_copies, "sources": g.sources, "playSeconds": g.play_seconds(), "trackedSeconds": g.total_seconds,
        "importedSeconds": g.imported_seconds, "lastPlayed": g.last_played_any().map(shelf_core::platform::iso_ms),
        "firstSeen": shelf_core::platform::iso_ms(g.first_seen), "path": g.primary_path,
    })
}

fn cmd_list(mut args: Vec<String>) -> Res {
    let sort = option(&mut args, "--sort").unwrap_or_else(|| "name".into());
    let show_review = flag(&mut args, "--review");
    let show_leftovers = flag(&mut args, "--leftovers");
    let show_hidden = flag(&mut args, "--hidden");
    let as_json = flag(&mut args, "--json");

    let (paths, library, _) = open_stores()?;
    let refresher = Refresher::new(SystemContext::real(), paths.clone(), library.clone());
    let roots = Settings::load(&paths).scan_roots;
    let full = refresher.refresh_all(&roots, true, None, &CANCEL).map_err(|e| e.to_string())?;
    let mut games = library.games(show_hidden).map_err(|e| e.to_string())?;
    let review = library.pending_detections().map_err(|e| e.to_string())?;
    let leftovers = &full.snapshot.leftovers;

    if as_json {
        let out = json!({
            "games": games.iter().map(game_json).collect::<Vec<_>>(),
            "review": show_review.then(|| review.iter().map(|d| json!({
                "id": d.id, "title": d.suggested_title, "path": d.path, "exe": d.exe, "origin": d.origin,
                "confidence": d.confidence, "sizeBytes": d.size_bytes, "signals": d.signals,
            })).collect::<Vec<_>>()),
            "leftovers": show_leftovers.then(|| leftovers.iter().map(|l| json!({
                "path": l.path, "kind": l.kind, "title": l.title, "sizeBytes": l.size_bytes,
            })).collect::<Vec<_>>()),
            "sources": full.snapshot.sources.iter().map(|s| json!({
                "source": s.source, "state": s.state, "message": s.message, "count": s.installs.len(),
            })).collect::<Vec<_>>(),
            "scans": full.snapshot.scans.iter().map(|s| json!({
                "root": s.root, "error": s.error, "dirsVisited": s.dirs_visited, "cacheHits": s.cache_hits,
                "unreadable": s.unreadable, "seconds": s.elapsed.as_secs_f64(),
            })).collect::<Vec<_>>(),
        });
        println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
        return Ok(0);
    }

    match sort.as_str() {
        "size" => games.sort_by_key(|g| std::cmp::Reverse(g.size_bytes)),
        "played" => games.sort_by_key(|g| std::cmp::Reverse(g.last_played_any())),
        "time" => games.sort_by_key(|g| std::cmp::Reverse(g.play_seconds())),
        _ => {}
    }

    println!("{} {} {:>9} {:>8}  {}  Folder", pad("Game", 42), pad("Source", 16), "Size", "Played", pad("Last played", 11));
    println!("{}", "─".repeat(140));
    for g in &games {
        let src = g.sources.iter().map(|s| s.display_name()).collect::<Vec<_>>().join("+");
        let mut flags = String::new();
        if !g.installed {
            flags += " [not installed]";
        }
        if g.installed_copies > 1 {
            flags += &format!(" [{} copies]", g.installed_copies);
        }
        if g.hidden {
            flags += " [hidden]";
        }
        let last = g.last_played_any().map(|ms| local(ms).format("%Y-%m-%d").to_string()).unwrap_or_default();
        println!(
            "{} {} {:>9} {:>8}  {}  {}",
            pad(&(g.title.clone() + &flags), 42),
            pad(&src, 16),
            if g.installed { format_bytes(g.size_bytes) } else { String::new() },
            hours(g.play_seconds()),
            pad(&last, 11),
            g.primary_path.as_deref().unwrap_or("")
        );
    }
    let installed: Vec<&GameRow> = games.iter().filter(|g| g.installed).collect();
    let cutoff = now_ms() - 90 * 24 * 3_600_000;
    let cold: Vec<&&GameRow> = installed.iter().filter(|g| g.last_played_any().is_none_or(|p| p < cutoff)).collect();
    let mut summary = format!("\n{} games installed, {} on disk", installed.len(), format_bytes(installed.iter().map(|g| g.size_bytes).sum()));
    if !cold.is_empty() {
        summary += &format!(" · {} with no play recorded in 90+ days ({})", cold.len(), format_bytes(cold.iter().map(|g| g.size_bytes).sum()));
    }
    summary += &format!(
        " · {} to review · {} leftovers ({}) · {:.1}s",
        review.len(),
        leftovers.len(),
        format_bytes(leftovers.iter().map(|l| l.size_bytes).sum()),
        full.elapsed.as_secs_f64()
    );
    println!("{summary}");
    if !full.sync.new_games.is_empty() {
        println!("New since last time: {}", full.sync.new_games.join(", "));
    }

    if show_review && !review.is_empty() {
        println!("\nReview (not sure these are games — `shelf-cli review accept|reject <id>`):");
        print_review(&review);
    }
    if show_leftovers && !leftovers.is_empty() {
        println!("\nLeftovers taking space (Shelf never deletes these — check and remove them yourself):");
        for l in leftovers {
            let kind = if l.kind == LeftoverKind::Archive { "archive" } else { "installer" };
            println!("  ~ {} {kind:<9} {:>9}  {}", pad(&l.title, 40), format_bytes(l.size_bytes), l.path);
        }
    }

    let problems: Vec<SourceResult> =
        full.snapshot.sources.iter().filter(|s| matches!(s.state, SourceState::Partial | SourceState::Unreadable)).cloned().collect();
    let scan_problems: Vec<_> = full.snapshot.scans.iter().filter(|s| s.error.is_some() || s.unreadable > 0).collect();
    if !problems.is_empty() || !scan_problems.is_empty() {
        println!("\nHeads-up:");
        print_sources(&problems, true);
        for s in scan_problems {
            println!("  [scan] {}", s.error.clone().unwrap_or_else(|| format!("{}: {} folders couldn't be read", s.root, s.unreadable)));
        }
    }
    if roots.is_empty() {
        println!("\nNo scan folders yet — loose games (zips, repacks) only show if Windows lists them. Try: shelf-cli suggest");
    }
    Ok(0)
}

/// This process's CPU time so far, in 100 ns units.
#[cfg(windows)]
fn cpu_time() -> u64 {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};
    let zero = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
    unsafe { GetProcessTimes(GetCurrentProcess(), &mut created, &mut exited, &mut kernel, &mut user) };
    let ft = |f: FILETIME| ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64;
    ft(kernel) + ft(user)
}

fn cmd_watch(mut args: Vec<String>) -> Res {
    let stats = flag(&mut args, "--stats");
    let no_refresh = flag(&mut args, "--no-refresh");
    let (paths, library, sessions) = open_stores()?;
    let refresher = Refresher::new(SystemContext::real(), paths.clone(), library.clone());
    let roots = Settings::load(&paths).scan_roots;
    if !no_refresh {
        println!("Refreshing the library…");
        let r = refresher.refresh_all(&roots, true, None, &CANCEL).map_err(|e| e.to_string())?;
        let installed = library.games(false).map_err(|e| e.to_string())?.iter().filter(|g| g.installed).count();
        let new = if r.sync.new_games.is_empty() { String::new() } else { format!(" · new: {}", r.sync.new_games.join(", ")) };
        println!("  {installed} games installed ({:.1}s){new}", r.elapsed.as_secs_f64());
    }

    let (tx, rx) = mpsc::channel::<WatcherEvent>();
    let tx = std::sync::Mutex::new(tx);
    let probes = Probes {
        processes: Box::new(Win32Processes::default()),
        foreground: Some(Box::new(Win32Foreground)),
        gpu: Some(Box::new(PdhGpu::default())),
    };
    let watcher = ShelfWatcher::new(
        library.clone(),
        sessions,
        probes,
        Arc::new(SystemClock),
        WatcherOptions::default(),
        Box::new(move |e| {
            let _ = tx.lock().unwrap().send(e);
        }),
    );
    watcher.start(Some(&roots), true).map_err(|e| e.to_string())?;
    let watched = watcher.watched_folders();
    println!(
        "Watching your games · new downloads in: {}",
        if watched.is_empty() { "(no scan folders)".to_string() } else { watched.join(", ") }
    );
    println!(
        "Unknown-game detection: fullscreen{} · Ctrl+C to stop\n",
        if watcher.gpu_available() { " + GPU counters" } else { " only (GPU counters unavailable)" }
    );

    let now = || Local::now().format("%H:%M").to_string();
    let mut last_stats = Instant::now();
    let mut last_cpu = cpu_time();
    while !CANCEL.load(Ordering::Relaxed) {
        let Ok(e) = rx.recv_timeout(Duration::from_secs(1)) else {
            if stats && last_stats.elapsed() >= Duration::from_secs(60) {
                let cpu = cpu_time();
                let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f64;
                let pct = (cpu - last_cpu) as f64 / 1e5 / last_stats.elapsed().as_millis().max(1) as f64 / threads * 100.0;
                let playing: Vec<String> = watcher.playing().iter().filter_map(|(id, _)| library.game_title(*id).ok().flatten()).collect();
                println!(
                    "{}  · CPU {pct:.2}% of the machine over the last minute · playing: {}",
                    now(),
                    if playing.is_empty() { "nothing".to_string() } else { playing.join(", ") }
                );
                last_stats = Instant::now();
                last_cpu = cpu;
            }
            continue;
        };
        match e {
            WatcherEvent::Session(s, title) => {
                let at = local(s.end.unwrap_or(s.start)).format("%H:%M");
                if s.kind == SessionEventKind::Started {
                    println!("{at}  ▶ {title} started");
                } else {
                    let reason = s.reason.as_deref().filter(|r| *r != "clean").map(|r| format!(" ({r})")).unwrap_or_default();
                    println!("{at}  ■ {title} stopped — {}{reason}", duration(s.duration_ms().unwrap_or(0) / 1000));
                }
            }
            WatcherEvent::Suggest { title, detection_id } => println!(
                "{}  ? Looks like you're playing {title} — add it?  →  shelf-cli review accept {detection_id}   (or: review reject {detection_id})",
                now()
            ),
            WatcherEvent::Recovered(n) => println!("{}  · Closed {n} session(s) left open by a crash or power loss, at their last heartbeat", now()),
            WatcherEvent::FoldersSettled(folders) => {
                for f in folders {
                    if let Ok((_, sync)) = refresher.refresh_folder(&f, None, &CANCEL) {
                        for t in &sync.new_games {
                            println!("{}  + New game found: {t}", now());
                        }
                        if sync.new_detections > 0 {
                            println!("{}  · {} new folder(s) in {f} to review", now(), sync.new_detections);
                        }
                    }
                }
                watcher.refresh_index();
            }
            WatcherEvent::RefreshDue => {
                if let Ok(r) = refresher.refresh_all(&roots, true, None, &CANCEL) {
                    for t in &r.sync.new_games {
                        println!("{}  + New game installed: {t}", now());
                    }
                }
                watcher.refresh_index();
            }
            WatcherEvent::FolderFailed(f) => println!("{}  · Can't watch {f} for new downloads (missing or no access)", now()),
            WatcherEvent::Error(m) => println!("{}  · {m}", now()),
        }
    }
    watcher.stop();
    while let Ok(WatcherEvent::Session(s, title)) = rx.try_recv() {
        if s.kind == SessionEventKind::Stopped {
            println!("{}  ■ {title} stopped — {} (Shelf exiting)", now(), duration(s.duration_ms().unwrap_or(0) / 1000));
        }
    }
    println!("Stopped; open sessions saved.");
    Ok(0)
}

fn cmd_sessions(mut args: Vec<String>) -> Res {
    let days: i64 = option(&mut args, "--days").and_then(|d| d.parse().ok()).unwrap_or(14);
    let filter = (!args.is_empty()).then(|| args.join(" ").to_lowercase());
    let (_, library, sessions) = open_stores()?;
    let since = now_ms() - days * 24 * 3_600_000;
    let rows: Vec<_> = sessions
        .sessions(None, Some(since), 5000)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|s| filter.as_ref().is_none_or(|f| s.title.to_lowercase().contains(f)))
        .collect();
    if rows.is_empty() {
        let what = filter.as_ref().map(|f| format!(" for '{f}'")).unwrap_or_default();
        println!("No sessions in the last {days} days{what}. Run `shelf-cli watch` (or the app) while you play.");
    }
    let mut by_day: Vec<(chrono::NaiveDate, Vec<_>)> = Vec::new();
    for s in rows.iter() {
        let day = local(s.start).date_naive();
        match by_day.iter_mut().find(|d| d.0 == day) {
            Some(d) => d.1.push(s),
            None => by_day.push((day, vec![s])),
        }
    }
    by_day.sort_by_key(|d| std::cmp::Reverse(d.0));
    for (day, mut list) in by_day {
        list.sort_by_key(|s| s.start);
        println!("{}  {}", day.format("%a %Y-%m-%d"), duration(list.iter().map(|s| s.seconds()).sum()));
        for s in list {
            let end = s.end.map(|e| local(e).format("%H:%M").to_string()).unwrap_or_else(|| "now".into());
            let note = match (s.end, s.end_reason.as_deref()) {
                (None, _) => " (playing)".to_string(),
                (_, Some("clean")) | (_, None) => String::new(),
                (_, Some(r)) => format!(" ({r})"),
            };
            println!("   {}–{end:<5}  {:>8}  {}{note}", local(s.start).format("%H:%M"), duration(s.seconds()), s.title);
        }
    }

    let runs = sessions.runs(since).map_err(|e| e.to_string())?;
    if !rows.is_empty() && !runs.is_empty() {
        let on: i64 = runs.iter().map(|r| (r.end.unwrap_or(r.last_heartbeat) - r.start) / 1000).sum();
        println!("\nTracking was on for {} of the last {days} days; time played while Shelf wasn't running isn't counted.", duration(on));
    }
    let mut top: Vec<GameRow> = library.games(false).map_err(|e| e.to_string())?.into_iter().filter(|g| g.total_seconds > 0).collect();
    top.sort_by_key(|g| std::cmp::Reverse(g.total_seconds));
    if !top.is_empty() {
        println!("\nMost played (tracked by Shelf, all time):");
        for g in top.iter().take(5) {
            println!("   {:>8}  {}", duration(g.total_seconds), g.title);
        }
    }
    Ok(0)
}

fn print_review(pending: &[DetectionRow]) {
    for r in pending {
        let origin = match r.origin.as_str() {
            "runtime" => "seen running",
            "installed_apps" => "installed app",
            _ => "folder scan",
        };
        println!("  #{:<4} {} {:>3}%  {:>9}  {origin:<13} {}", r.id, pad(&r.suggested_title, 36), r.confidence, bytes(r.size_bytes), r.path);
        for s in &r.signals {
            println!("          {s}");
        }
    }
}

fn cmd_review(args: Vec<String>) -> Res {
    let (_, library, _) = open_stores()?;
    if args.len() >= 2 && args[0] == "accept" {
        let id: i64 = args[1].parse().map_err(|_| format!("Not a detection id: {}", args[1]))?;
        let title = (args.len() > 2).then(|| args[2..].join(" "));
        let game = library.accept_detection(id, title.as_deref(), now_ms()).map_err(|e| e.to_string())?;
        println!("Added: {}", library.game_title(game).ok().flatten().unwrap_or_default());
        return Ok(0);
    }
    if args.len() == 2 && args[0] == "reject" {
        let id: i64 = args[1].parse().map_err(|_| format!("Not a detection id: {}", args[1]))?;
        library.reject_detection(id, now_ms()).map_err(|e| e.to_string())?;
        println!("OK — Shelf won't suggest it again.");
        return Ok(0);
    }
    let pending = library.pending_detections().map_err(|e| e.to_string())?;
    if pending.is_empty() {
        println!("Nothing to review.");
    } else {
        print_review(&pending);
    }
    Ok(0)
}

fn cmd_add(args: Vec<String>) -> Res {
    let Some(exe) = args.first() else { return Err("Usage: shelf-cli add <path to game exe> [title]".into()) };
    let (_, library, _) = open_stores()?;
    let title = (args.len() > 1).then(|| args[1..].join(" "));
    let id = library.add_manual(exe, title.as_deref(), now_ms(), true).map_err(|e| e.to_string())?;
    println!(
        "Added: {}. A running `shelf-cli watch` picks it up at its next library refresh; restart it to track right away.",
        library.game_title(id).ok().flatten().unwrap_or_default()
    );
    Ok(0)
}

fn cmd_roots(args: Vec<String>) -> Res {
    let paths = ShelfPaths::default_paths();
    let mut settings = Settings::load(&paths);
    if args.len() == 2 && args[0] == "remove" {
        let before = settings.scan_roots.len();
        settings.scan_roots.retain(|r| path_key(r) != path_key(&args[1]));
        settings.save(&paths).map_err(|e| e.to_string())?;
        println!("{}", if settings.scan_roots.len() < before { format!("Removed {}", args[1]) } else { format!("{} wasn't a scan folder", args[1]) });
        return Ok(0);
    }
    if settings.scan_roots.is_empty() {
        println!("No scan folders. Add one with: shelf-cli scan <folder>");
    }
    for r in &settings.scan_roots {
        println!("  {r}{}", if Path::new(r).is_dir() { "" } else { "  (not reachable)" });
    }
    Ok(0)
}

fn cmd_suggest() -> Res {
    println!("Folders worth scanning:");
    for p in suggest_roots(&SystemContext::real()) {
        println!("  shelf-cli scan \"{p}\"");
    }
    println!("Or a whole drive:  shelf-cli scan C:\\");
    Ok(0)
}

fn cmd_clean(args: Vec<String>) -> Res {
    if args.is_empty() {
        return Err("Usage: shelf-cli clean <name>".into());
    }
    println!("{}", naming::clean(&args.join(" ")));
    Ok(0)
}

/// Fills in missing art from the web, the same way the app does in the background.
fn cmd_art(mut args: Vec<String>) -> Res {
    let again = flag(&mut args, "--again");
    let (paths, library, _) = open_stores()?;
    let key = option(&mut args, "--key").or(Settings::load(&paths).steam_grid_db_key);
    let cache = ArtCache::new(&paths);
    if again {
        for g in library.games(true).map_err(|e| e.to_string())? {
            cache.forget_web(g.id);
        }
    }
    let http = UreqHttp::new("Shelf-cli/1.0");
    let web = WebArt::new(&http, key.as_deref());
    println!(
        "{}",
        if web.has_steam_grid_db() {
            "Looking up missing art on Steam and SteamGridDB.\n"
        } else {
            "Looking up missing art on Steam. (With a SteamGridDB key — --key or Settings — icons and non-Steam games are covered too.)\n"
        }
    );
    let sync = WebArtSync { library: &library, cache: &cache, web, pace: Duration::from_millis(300) };
    let s = sync
        .run(system_clock, |title, found| println!("  {}  {}", pad(title, 40), if found == 0 { "nothing found".into() } else { format!("{found} image(s)") }), &CANCEL)
        .map_err(|e| e.to_string())?;
    if s.looked == 0 {
        println!("Nothing to look up: every game has its art, or was looked up this week (--again to retry).");
    } else {
        let failed = if s.failed > 0 { format!("; {} couldn't be reached", s.failed) } else { String::new() };
        println!("\n{} games looked up, {} images saved to {}{failed}", s.looked, s.images, cache.root.display());
    }
    Ok(if s.looked > 0 && s.failed == s.looked { 1 } else { 0 })
}
