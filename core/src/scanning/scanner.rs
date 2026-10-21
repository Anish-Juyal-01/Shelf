//! Walks a folder tree looking for games. Parallel, cancellable and incremental; stops descending as soon as a folder
//! is classified (a game root's insides are only touched to add up its size). Read-only: it lists folders and reads
//! file sizes, nothing else.

use std::collections::{HashSet, VecDeque};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime};

use super::cache::{stamp, CachedKind, ScanCache, ScanCacheEntry};
use super::classifier::{self, ClassifierOptions, FolderVerdict, VerdictKind};
use super::listing::DirListing;
use crate::model::{InstallRecord, SizeSource, SourceKind};
use crate::naming;
use crate::platform::{normalize, path_key, GB};

#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub classifier: ClassifierOptions,
    /// Archives (.zip/.rar/.7z/.iso) at least this big are listed as storage leftovers.
    pub leftover_archive_bytes: u64,
    pub max_depth: usize,
    pub measure_sizes: bool,
    /// False forces every folder to be re-examined (the cache is still refreshed).
    pub use_cache: bool,
    /// Folders already known from store readers; not walked again.
    pub skip_paths: Vec<String>,
    pub parallelism: usize,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            classifier: ClassifierOptions::default(),
            leftover_archive_bytes: GB,
            max_depth: 12,
            measure_sizes: true,
            use_cache: true,
            skip_paths: Vec::new(),
            parallelism: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 8),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LeftoverKind {
    Archive,
    Installer,
}

/// Something taking space that isn't an installed game: a big archive or an un-run installer.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Leftover {
    pub path: String,
    pub kind: LeftoverKind,
    pub title: String,
    pub size_bytes: i64,
}

#[derive(Debug, Clone)]
pub enum ScanEvent {
    Found(InstallRecord),
    Leftover(Leftover),
    Progress { path: String, dirs: usize },
}

#[derive(Debug, Default)]
pub struct ScanResult {
    pub root: String,
    pub drive_mode: bool,
    pub library: Vec<InstallRecord>,
    pub review: Vec<InstallRecord>,
    pub leftovers: Vec<Leftover>,
    pub dirs_visited: usize,
    pub unreadable: usize,
    pub cache_hits: usize,
    pub error_samples: Vec<String>,
    pub elapsed: Duration,
    pub cancelled: bool,
    pub error: Option<String>,
}

const SKIP_NAMES: &[&str] = &[
    "$Recycle.Bin", "System Volume Information", "Windows", "WindowsApps", "WinSxS", "node_modules", ".git", ".svn", ".hg",
    "__pycache__", "$WinREAgent", "$SysReset", "$Windows.~BT", "$Windows.~WS", "Recovery", "PerfLogs", "Config.Msi",
    "OneDriveTemp", ".nuget", ".gradle", ".cache", ".vscode", "site-packages",
];

/// Skipped only when scanning a whole drive: system and per-user app data, covered by the store readers.
const DRIVE_MODE_SKIP_NAMES: &[&str] = &[
    "ProgramData", "AppData", "Common Files", "Microsoft", "Windows Kits", "Microsoft Visual Studio", "dotnet", "MSBuild",
    "Reference Assemblies", "Windows Defender", "Windows NT", "WindowsPowerShell", "Internet Explorer", "Microsoft Office",
    "NVIDIA Corporation", "Intel", "AMD", "Package Cache", "Installer", "msys64", "cygwin64",
];

const STEAMAPPS_SKIP: &[&str] = &["shadercache", "workshop", "downloading", "temp", "compatdata"];

const LEFTOVER_ARCHIVES: &[&str] = &["zip", "rar", "7z", "iso", "tar", "gz", "xz", "001"];

fn in_list(list: &[&str], s: &str) -> bool {
    list.iter().any(|x| x.eq_ignore_ascii_case(s))
}

struct WorkItem {
    path: String,
    depth: usize,
    stamp: i64,
}

/// The work queue shared by the walker threads; `pending` counts queued + in-progress items.
struct Queue {
    items: Mutex<(VecDeque<WorkItem>, usize)>,
    ready: Condvar,
}

impl Queue {
    fn push(&self, item: WorkItem) {
        let mut q = self.items.lock().unwrap();
        q.0.push_back(item);
        q.1 += 1;
        self.ready.notify_one();
    }

    /// Next item, or `None` once everything is done (or the scan is cancelled).
    fn pop(&self, cancel: &AtomicBool) -> Option<WorkItem> {
        let mut q = self.items.lock().unwrap();
        loop {
            if cancel.load(Ordering::Relaxed) {
                self.ready.notify_all();
                return None;
            }
            if let Some(item) = q.0.pop_front() {
                return Some(item);
            }
            if q.1 == 0 {
                self.ready.notify_all();
                return None;
            }
            q = self.ready.wait_timeout(q, Duration::from_millis(100)).unwrap().0;
        }
    }

    fn done(&self) {
        let mut q = self.items.lock().unwrap();
        q.1 -= 1;
        if q.1 == 0 {
            self.ready.notify_all();
        }
    }
}

fn fresh_stamp(path: &str, fallback: i64) -> i64 {
    std::fs::metadata(path).and_then(|m| m.modified()).map(|t| stamp(Some(t))).unwrap_or(fallback)
}

fn now_unix() -> i64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub struct FolderScanner<'a> {
    pub options: ScanOptions,
    pub cache: &'a ScanCache,
}

impl<'a> FolderScanner<'a> {
    pub fn new(options: ScanOptions, cache: &'a ScanCache) -> Self {
        Self { options, cache }
    }

    pub fn scan(&self, root: &str, on_event: Option<&(dyn Fn(ScanEvent) + Sync)>, cancel: &AtomicBool) -> ScanResult {
        let started = Instant::now();
        let root_path = normalize(root);
        let drive_mode = Path::new(&root_path).parent().is_none();
        let mut result = ScanResult { root: root_path.clone(), drive_mode, ..Default::default() };
        if !Path::new(&root_path).is_dir() {
            result.error = Some(format!("Folder not found: {root_path}"));
            return result;
        }
        if cancel.load(Ordering::Relaxed) {
            result.cancelled = true;
            return result;
        }

        let skip: HashSet<String> = self.options.skip_paths.iter().map(|p| path_key(p)).collect();
        let touched = Mutex::new(HashSet::new());
        let found = Mutex::new((Vec::new(), Vec::new(), Vec::new())); // library, review, leftovers
        let errors = Mutex::new(Vec::new());
        let (dirs, unreadable, hits) = (AtomicUsize::new(0), AtomicUsize::new(0), AtomicUsize::new(0));
        let last_progress = Mutex::new(Instant::now());
        let emit_lock = Mutex::new(());
        let emit = |e: ScanEvent| {
            if let Some(f) = on_event {
                let _g = emit_lock.lock().unwrap();
                f(e);
            }
        };

        let queue = Queue { items: Mutex::new((VecDeque::new(), 0)), ready: Condvar::new() };
        queue.push(WorkItem { path: root_path.clone(), depth: 0, stamp: fresh_stamp(&root_path, 0) });

        let report = |path: &str, e: &ScanCacheEntry| {
            if e.kind == CachedKind::Installer {
                let leftover = Leftover {
                    path: path.to_string(),
                    kind: LeftoverKind::Installer,
                    title: e.title.clone().unwrap_or_else(|| file_name(path)),
                    size_bytes: e.size_bytes.unwrap_or(0),
                };
                found.lock().unwrap().2.push(leftover.clone());
                emit(ScanEvent::Leftover(leftover));
                return;
            }
            let mut r = InstallRecord::new(SourceKind::Folder, e.title.clone().unwrap_or_else(|| file_name(path)), path.to_string());
            r.launch_exe = e.launch_exe.clone();
            r.working_dir = e.launch_exe.as_deref().and_then(|x| Path::new(x).parent()).map(|p| p.to_string_lossy().into_owned());
            r.confidence = e.score.clamp(0, 100) as u8;
            r.signals = e.signals.clone();
            r.play_exes = e.play_exes.clone();
            r.size_bytes = e.size_bytes;
            r.size_source = if e.size_bytes.is_some() { SizeSource::Measured } else { SizeSource::Unknown };
            let mut f = found.lock().unwrap();
            if e.score >= self.options.classifier.library_threshold {
                f.0.push(r.clone());
            } else {
                f.1.push(r.clone());
            }
            drop(f);
            emit(ScanEvent::Found(r));
        };

        let process = |mut item: WorkItem| {
            let visited = dirs.fetch_add(1, Ordering::Relaxed) + 1;
            {
                let mut last = last_progress.lock().unwrap();
                if last.elapsed() > Duration::from_millis(200) {
                    *last = Instant::now();
                    drop(last);
                    emit(ScanEvent::Progress { path: item.path.clone(), dirs: visited });
                }
            }

            let key = path_key(&item.path);
            // The modified time in the parent's listing comes from NTFS's directory index, which Windows updates lazily;
            // a patched game could look unchanged. Ask the folder itself (one cheap call, only for cached roots).
            if self.cache.contains(&item.path) {
                item.stamp = fresh_stamp(&item.path, item.stamp);
            }
            if self.options.use_cache && item.depth > 0 {
                if let Some(cached) = self.cache.fresh(&item.path, item.stamp) {
                    if cached.launch_exe.as_deref().is_none_or(|e| Path::new(e).is_file()) {
                        hits.fetch_add(1, Ordering::Relaxed);
                        touched.lock().unwrap().insert(key);
                        report(&item.path, &cached);
                        return;
                    }
                }
            }

            let listing = match DirListing::read(&item.path) {
                Ok(l) => l,
                Err(e) => {
                    unreadable.fetch_add(1, Ordering::Relaxed);
                    let mut errs = errors.lock().unwrap();
                    if errs.len() < 20 {
                        errs.push(format!("{}: {e}", item.path));
                    }
                    return;
                }
            };

            for f in &listing.files {
                let ext = Path::new(&f.name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
                if f.len >= self.options.leftover_archive_bytes && LEFTOVER_ARCHIVES.contains(&ext.as_str()) {
                    let stem = Path::new(&f.name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                    let leftover = Leftover {
                        path: Path::new(&item.path).join(&f.name).to_string_lossy().into_owned(),
                        kind: LeftoverKind::Archive,
                        title: naming::clean(&stem),
                        size_bytes: f.len as i64,
                    };
                    found.lock().unwrap().2.push(leftover.clone());
                    emit(ScanEvent::Leftover(leftover));
                }
            }

            let verdict =
                if item.depth == 0 && drive_mode { FolderVerdict::default() } else { classifier::evaluate(&listing, &self.options.classifier) };
            if verdict.kind != VerdictKind::None {
                if !self.cache.contains(&item.path) {
                    item.stamp = fresh_stamp(&item.path, item.stamp);
                }
                let mut entry = ScanCacheEntry {
                    dir_stamp: item.stamp,
                    kind: if verdict.kind == VerdictKind::Installer { CachedKind::Installer } else { CachedKind::Game },
                    score: verdict.score,
                    signals: verdict.signals,
                    title: verdict.title,
                    launch_exe: verdict.launch_exe,
                    play_exes: verdict.play_exes,
                    size_bytes: None,
                    size_measured: None,
                };
                // Keep a previous size if the folder itself didn't change; deep changes are caught by periodic re-measure.
                if self.options.use_cache {
                    if let Some(old) = self.cache.get(&item.path).filter(|o| o.dir_stamp == entry.dir_stamp) {
                        entry.size_bytes = old.size_bytes;
                        entry.size_measured = old.size_measured;
                    }
                }
                if self.options.measure_sizes && entry.size_bytes.is_none() {
                    entry.size_bytes = Some(measure_size(&item.path, cancel) as i64);
                    entry.size_measured = Some(now_unix());
                }
                self.cache.set(&item.path, entry.clone());
                touched.lock().unwrap().insert(key);
                report(&item.path, &entry);
                return;
            }

            if item.depth >= self.options.max_depth {
                return;
            }
            let parent = file_name(&item.path);
            for d in &listing.dirs {
                if in_list(SKIP_NAMES, &d.name) || (drive_mode && in_list(DRIVE_MODE_SKIP_NAMES, &d.name)) {
                    continue;
                }
                if parent.eq_ignore_ascii_case("steamapps") && in_list(STEAMAPPS_SKIP, &d.name) {
                    continue;
                }
                let child = Path::new(&item.path).join(&d.name).to_string_lossy().into_owned();
                if skip.contains(&path_key(&child)) {
                    continue;
                }
                queue.push(WorkItem { path: child, depth: item.depth + 1, stamp: stamp(d.modified) });
            }
        };

        std::thread::scope(|s| {
            for _ in 0..self.options.parallelism.max(1) {
                s.spawn(|| {
                    while let Some(item) = queue.pop(cancel) {
                        process(item);
                        queue.done();
                    }
                });
            }
        });

        result.cancelled = cancel.load(Ordering::Relaxed);
        let (mut library, mut review, mut leftovers) = found.into_inner().unwrap();
        library.sort_by_key(|r| r.title.to_lowercase());
        review.sort_by_key(|r| std::cmp::Reverse(r.confidence));
        leftovers.sort_by_key(|l| std::cmp::Reverse(l.size_bytes));
        result.library = library;
        result.review = review;
        result.leftovers = leftovers;
        result.dirs_visited = dirs.into_inner();
        result.unreadable = unreadable.into_inner();
        result.cache_hits = hits.into_inner();
        result.error_samples = errors.into_inner().unwrap();
        if !result.cancelled {
            self.cache.prune(&root_path, &touched.into_inner().unwrap());
        }
        result.elapsed = started.elapsed();
        result
    }
}

fn file_name(path: &str) -> String {
    Path::new(path).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string())
}

/// Adds up a folder's file sizes. Never follows junctions or symlinks, never descends into cloud placeholders, never
/// opens files.
pub fn measure_size(path: &str, cancel: &AtomicBool) -> u64 {
    let mut total = 0;
    let mut stack = vec![path.to_string()];
    while let Some(dir) = stack.pop() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let Ok(listing) = DirListing::read(&dir) else { continue };
        total += listing.files.iter().map(|f| f.len).sum::<u64>();
        stack.extend(listing.dirs.iter().map(|d| Path::new(&dir).join(&d.name).to_string_lossy().into_owned()));
    }
    total
}
