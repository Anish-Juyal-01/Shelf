//! Folder scanner over a miniature library (ported from the C# FolderScannerTests).

mod support;

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use shelf_core::platform::normalize;
use shelf_core::scanning::cache::ScanCache;
use shelf_core::scanning::scanner::{FolderScanner, LeftoverKind, ScanEvent, ScanOptions, ScanResult};
use shelf_core::scanning::suggest::suggest_roots;
use support::{context, games, FakeRegistry, TempTree};

fn options(skip: Vec<String>, use_cache: bool) -> ScanOptions {
    ScanOptions { classifier: games::options(), leftover_archive_bytes: 1000, skip_paths: skip, use_cache, ..Default::default() }
}

fn library() -> TempTree {
    let t = TempTree::new();
    games::unity(&t, "Games/Hollow Knight");
    games::unreal(&t, "Games/Stray");
    games::loose_repack(&t, "Games/Repacks/Sekiro");
    games::electron(&t, "Games/Chatty");
    games::fitgirl_installer(&t, "Downloads/Elden Ring [FitGirl Repack]");
    t.file("Downloads/Big Game.zip", 4000);
    t.file("Downloads/small.zip", 10);
    // Weak but plausible: goes to Review.
    t.file("Games/Mystery/mystery.exe", 500);
    t.file("Games/Mystery/steam_api64.dll", 16);
    // A "game" inside a game: only found if the scanner wrongly descends into game roots.
    games::unity(&t, "Games/Hollow Knight/hollow_knight_Data/Nested");
    t
}

fn scan(t: &TempTree, opts: ScanOptions, cache: &ScanCache) -> ScanResult {
    FolderScanner::new(opts, cache).scan(&t.root().to_string_lossy(), None, &AtomicBool::new(false))
}

fn titles(r: &ScanResult) -> Vec<String> {
    let mut v: Vec<_> = r.library.iter().map(|i| i.title.clone()).collect();
    v.sort();
    v
}

#[test]
fn finds_games_review_and_leftovers() {
    let t = library();
    let result = scan(&t, options(vec![], true), &ScanCache::default());

    assert_eq!(result.error, None);
    assert!(!result.cancelled);
    assert_eq!(titles(&result), ["Hollow Knight", "Sekiro", "Stray"]);
    assert_eq!(result.review.iter().map(|r| r.title.as_str()).collect::<Vec<_>>(), ["Mystery"]);
    assert_eq!(result.leftovers.len(), 2, "{:?}", result.leftovers);
    assert!(result.leftovers.iter().any(|l| l.kind == LeftoverKind::Archive && l.path.ends_with("Big Game.zip")));
    assert!(result.leftovers.iter().any(|l| l.kind == LeftoverKind::Installer && l.title == "Elden Ring"));
    assert!(!result.library.iter().any(|r| r.install_path.contains("Nested")));
    assert!(result.library.iter().all(|r| r.size_bytes.unwrap_or(0) > 0));
}

#[test]
fn second_scan_reuses_the_cache_and_notices_changes() {
    let t = library();
    let cache = ScanCache::default();
    let first = scan(&t, options(vec![], true), &cache);
    assert_eq!(first.cache_hits, 0);

    let second = scan(&t, options(vec![], true), &cache);
    assert!(second.cache_hits >= 5, "cache hits: {}", second.cache_hits);
    assert_eq!(titles(&first), titles(&second));
    let total = |r: &ScanResult| r.library.iter().filter_map(|i| i.size_bytes).sum::<i64>();
    assert_eq!(total(&first), total(&second));

    // A new top-level file changes the folder's modified time: that game is examined again.
    std::thread::sleep(Duration::from_millis(20));
    t.file("Games/Stray/patch.pak", 100);
    let third = scan(&t, options(vec![], true), &cache);
    assert_eq!(third.cache_hits, second.cache_hits - 1);
}

#[test]
fn deleted_games_drop_out_of_the_cache() {
    let t = library();
    let cache = ScanCache::default();
    scan(&t, options(vec![], true), &cache);
    std::fs::remove_dir_all(t.p("Games/Stray")).unwrap();
    let result = scan(&t, options(vec![], true), &cache);
    assert!(!result.library.iter().any(|r| r.title == "Stray"));
    assert!(!cache.keys().iter().any(|k| k.contains("STRAY")));
}

#[test]
fn skips_known_store_folders() {
    let t = library();
    let result = scan(&t, options(vec![t.s("Games/Stray")], true), &ScanCache::default());
    assert!(!result.library.iter().any(|r| r.title == "Stray"));
}

#[test]
fn cancels_promptly() {
    let t = library();
    let started = Instant::now();
    let result = FolderScanner::new(options(vec![], true), &ScanCache::default()).scan(&t.root().to_string_lossy(), None, &AtomicBool::new(true));
    assert!(result.cancelled);
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[test]
fn streams_events_as_it_goes() {
    let t = library();
    let found = Mutex::new(Vec::new());
    let on_event = |e: ScanEvent| {
        if let ScanEvent::Found(r) = e {
            found.lock().unwrap().push(r.title);
        }
    };
    FolderScanner::new(options(vec![], true), &ScanCache::default()).scan(&t.root().to_string_lossy(), Some(&on_event), &AtomicBool::new(false));
    assert_eq!(found.lock().unwrap().len(), 4);
}

#[test]
fn does_not_follow_junctions() {
    let t = library();
    let link = t.s("Games/LinkToGames");
    let _ = std::process::Command::new("cmd").args(["/c", "mklink", "/J", &link, &t.s("Games")]).output();
    if !Path::new(&link).is_dir() {
        return; // junctions unavailable here; nothing to check
    }
    let result = scan(&t, options(vec![], true), &ScanCache::default());
    assert!(!result.library.iter().any(|r| r.install_path.contains("LinkToGames")));
    std::fs::remove_dir(&link).unwrap(); // removes the junction only
}

#[test]
fn missing_root_is_an_error_not_an_empty_list() {
    let cache = ScanCache::default();
    let result = FolderScanner::new(options(vec![], true), &cache).scan(r"Z:\definitely\not\here", None, &AtomicBool::new(false));
    assert!(result.error.is_some());
}

/// Every file and folder with its size and timestamps.
fn snapshot(root: &Path) -> BTreeMap<String, (u64, Option<SystemTime>, Option<SystemTime>)> {
    let mut out = BTreeMap::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for e in std::fs::read_dir(&dir).unwrap().flatten() {
            let m = std::fs::symlink_metadata(e.path()).unwrap();
            out.insert(e.path().to_string_lossy().into_owned(), (if m.is_file() { m.len() } else { 0 }, m.modified().ok(), m.created().ok()));
            if m.is_dir() {
                stack.push(e.path());
            }
        }
    }
    out
}

#[test]
fn scanning_changes_nothing_on_disk() {
    let t = library();
    let before = snapshot(t.root());
    scan(&t, options(vec![], true), &ScanCache::default());
    scan(&t, options(vec![], false), &ScanCache::default());
    assert_eq!(before, snapshot(t.root()));
}

#[test]
fn suggests_downloads_and_games_folders() {
    let t = TempTree::new();
    t.dir("User/Downloads");
    t.dir("drive/Games");
    t.dir("drive/XboxGames");
    t.dir("drive/Work");
    let suggestions = suggest_roots(&context(&t, FakeRegistry::default()));
    assert!(suggestions.iter().any(|s| s.ends_with("Downloads")));
    assert!(suggestions.iter().any(|s| s.ends_with(r"drive\Games")));
    assert!(!suggestions.iter().any(|s| s.ends_with("XboxGames") || s.ends_with("Work")));
}

#[test]
fn drive_root_is_whole_drive_mode() {
    let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()) + "\\";
    let cache = ScanCache::default();
    let result = FolderScanner::new(ScanOptions { max_depth: 0, ..Default::default() }, &cache).scan(&drive, None, &AtomicBool::new(false));
    assert!(result.drive_mode);
    assert_eq!(result.root, normalize(&drive));
}
