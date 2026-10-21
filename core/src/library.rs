//! Putting it together: launcher readers + folder scans → one library snapshot → the database.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::matcher::{self, GameEntry};
use crate::model::{InstallRecord, SizeSource, SourceResult};
use crate::platform::{is_same_or_inside, now_ms, path_key, SystemContext};
use crate::scanning::cache::stamp;
use crate::scanning::classifier::{evaluate_path, ClassifierOptions};
use crate::scanning::scanner::{measure_size, FolderScanner, Leftover, ScanEvent, ScanOptions, ScanResult};
use crate::scanning::suggest::launcher_dirs;
use crate::sources;
use crate::storage::library::{LibraryStore, SyncResult};
use crate::storage::{CacheFile, ShelfPaths, SizeEntry};

/// Everything Shelf knows right now: games, things to review, storage leftovers and per-source status.
#[derive(Debug, Default)]
pub struct LibrarySnapshot {
    pub games: Vec<GameEntry>,
    pub review: Vec<InstallRecord>,
    pub leftovers: Vec<Leftover>,
    pub sources: Vec<SourceResult>,
    pub scans: Vec<ScanResult>,
}

/// Install folders the store readers already cover, plus the launchers' own folders; the folder scanner skips them.
pub fn known_install_paths(sources: &[SourceResult], ctx: Option<&SystemContext>) -> Vec<String> {
    sources
        .iter()
        .flat_map(|s| &s.installs)
        .filter(|i| i.is_installed && i.source.is_store())
        .map(|i| i.install_path.clone())
        .chain(ctx.map(launcher_dirs).unwrap_or_default())
        .collect()
}

/// Fills in what launchers don't record: the exe (via the classifier) and the size (measured, cached by folder
/// modified time). Runs on a few threads; read-only.
pub fn enrich(records: Vec<&mut InstallRecord>, cache: &CacheFile, measure_sizes: bool, cancel: &AtomicBool) {
    let work: Vec<Mutex<&mut InstallRecord>> = records.into_iter().filter(|r| r.is_installed).map(Mutex::new).collect();
    let next = AtomicUsize::new(0);
    let options = ClassifierOptions::default();
    std::thread::scope(|s| {
        for _ in 0..4 {
            s.spawn(|| loop {
                let n = next.fetch_add(1, Ordering::Relaxed);
                if n >= work.len() || cancel.load(Ordering::Relaxed) {
                    break;
                }
                let mut r = work[n].lock().unwrap();
                enrich_one(&mut r, cache, measure_sizes, &options, cancel);
            });
        }
    });
}

fn enrich_one(r: &mut InstallRecord, cache: &CacheFile, measure_sizes: bool, options: &ClassifierOptions, cancel: &AtomicBool) {
    if r.launch_exe.is_none() || r.play_exes.is_empty() {
        let v = evaluate_path(&r.install_path, options);
        if r.launch_exe.is_none() {
            r.launch_exe = v.launch_exe;
        }
        for exe in v.play_exes {
            if !r.play_exes.iter().any(|p| p.eq_ignore_ascii_case(&exe)) {
                r.play_exes.push(exe);
            }
        }
    }
    if r.working_dir.is_none() {
        r.working_dir = r.launch_exe.as_deref().and_then(|e| Path::new(e).parent()).map(|p| p.to_string_lossy().into_owned());
    }

    if !measure_sizes || r.size_bytes.is_some() {
        return;
    }
    let Ok(modified) = std::fs::metadata(&r.install_path).and_then(|m| m.modified()) else { return };
    let dir_stamp = stamp(Some(modified));
    let key = path_key(&r.install_path);
    let cached = cache.sizes.lock().unwrap().get(&key).copied();
    r.size_bytes = Some(match cached {
        Some(e) if e.dir_stamp == dir_stamp => e.size_bytes,
        _ => {
            let size = measure_size(&r.install_path, cancel) as i64;
            if !cancel.load(Ordering::Relaxed) {
                cache.sizes.lock().unwrap().insert(key, SizeEntry { dir_stamp, size_bytes: size });
            }
            size
        }
    });
    r.size_source = SizeSource::Measured;
}

pub fn build(sources: Vec<SourceResult>, scans: Vec<ScanResult>, library_threshold: u8) -> LibrarySnapshot {
    let mut confident = Vec::new();
    let mut review = Vec::new();
    for r in sources.iter().flat_map(|s| &s.installs) {
        (if r.confidence >= library_threshold { &mut confident } else { &mut review }).push(r.clone());
    }
    confident.extend(scans.iter().flat_map(|s| s.library.iter().cloned()));
    review.extend(scans.iter().flat_map(|s| s.review.iter().cloned()));

    let games = matcher::merge(confident);

    // A review item that's the same folder as a library game is already handled.
    let known: Vec<&str> = games.iter().flat_map(|g| &g.installs).map(|i| i.install_path.as_str()).collect();
    let mut review: Vec<_> =
        matcher::merge_same_folder(review).into_iter().filter(|r| !known.iter().any(|k| is_same_or_inside(&r.install_path, k))).collect();
    review.sort_by_key(|r| std::cmp::Reverse(r.confidence));

    let mut leftovers: Vec<Leftover> = Vec::new();
    for l in scans.iter().flat_map(|s| &s.leftovers) {
        if !leftovers.iter().any(|x| path_key(&x.path) == path_key(&l.path)) {
            leftovers.push(l.clone());
        }
    }
    leftovers.sort_by_key(|l| std::cmp::Reverse(l.size_bytes));

    LibrarySnapshot { games, review, leftovers, sources, scans }
}

pub struct FullResult {
    pub snapshot: LibrarySnapshot,
    pub sync: SyncResult,
    pub elapsed: Duration,
}

pub type EventSink<'a> = Option<&'a (dyn Fn(ScanEvent) + Sync)>;

/// Runs detection (launchers + remembered folders) and writes the result to the database. One run at a time.
pub struct Refresher {
    ctx: SystemContext,
    paths: ShelfPaths,
    store: LibraryStore,
    gate: Mutex<Option<CacheFile>>,
}

impl Refresher {
    pub fn new(ctx: SystemContext, paths: ShelfPaths, store: LibraryStore) -> Self {
        Self { ctx, paths, store, gate: Mutex::new(None) }
    }

    pub fn refresh_all(&self, roots: &[String], measure_sizes: bool, on_event: EventSink, cancel: &AtomicBool) -> rusqlite::Result<FullResult> {
        let mut gate = self.gate.lock().unwrap();
        let cache = gate.get_or_insert_with(|| CacheFile::load(&self.paths));
        let started = Instant::now();
        let mut sources = sources::read_all(&self.ctx);
        let known = known_install_paths(&sources, Some(&self.ctx));
        enrich(sources.iter_mut().flat_map(|s| s.installs.iter_mut()).collect(), cache, measure_sizes, cancel);

        let scanner = FolderScanner::new(ScanOptions { skip_paths: known, measure_sizes, ..Default::default() }, &cache.folders);
        let mut scans = Vec::new();
        for root in roots {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            scans.push(if Path::new(root).is_dir() {
                scanner.scan(root, on_event, cancel)
            } else {
                ScanResult { root: root.clone(), error: Some(format!("Scan folder not reachable: {root}")), ..Default::default() }
            });
        }
        let _ = cache.save(&self.paths);
        let snapshot = build(sources, scans, 70);
        let sync = self.store.sync(&snapshot, now_ms())?;
        Ok(FullResult { snapshot, sync, elapsed: started.elapsed() })
    }

    /// Scans one folder or a whole drive (not remembered as a scan folder) and syncs only what it found.
    pub fn refresh_folder(&self, path: &str, on_event: EventSink, cancel: &AtomicBool) -> rusqlite::Result<(ScanResult, SyncResult)> {
        let mut gate = self.gate.lock().unwrap();
        let cache = gate.get_or_insert_with(|| CacheFile::load(&self.paths));
        let known: Vec<String> = self
            .store
            .installs(true)?
            .into_iter()
            .filter(|i| i.source.is_store())
            .map(|i| i.install_path)
            .chain(launcher_dirs(&self.ctx))
            .collect();
        let scanner = FolderScanner::new(ScanOptions { skip_paths: known, ..Default::default() }, &cache.folders);
        let scan = scanner.scan(path, on_event, cancel);
        let _ = cache.save(&self.paths);
        let mut snapshot = build(Vec::new(), vec![scan], 70);
        let sync = self.store.sync(&snapshot, now_ms())?;
        Ok((snapshot.scans.pop().unwrap_or_default(), sync))
    }
}
