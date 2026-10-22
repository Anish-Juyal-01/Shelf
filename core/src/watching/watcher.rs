//! The background loop: every few seconds it takes a process snapshot, updates sessions, checks the foreground window
//! for unknown games, and hands settled downloads to the host. One thread, sleeping between polls; everything else is
//! event-driven. Library refreshes stay with the host — the watcher only says when one is due.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use super::detector::{is_excluded, DetectorOptions, RuntimeCandidate, RuntimeDetector};
use super::folders::FolderWatcher;
use super::index::GameIndex;
use super::tracker::{RunningGame, SessionEvent, SessionTracker, TrackerOptions};
use super::{Clock, ForegroundProbe, GpuSampler, ProcInfo, ProcessSource};
use crate::platform::path_key;
use crate::scanning::classifier::{evaluate_path, install_root_for, title_for, ClassifierOptions};
use crate::storage::library::LibraryStore;
use crate::storage::sessions::SessionStore;

#[derive(Debug, Clone)]
pub struct WatcherOptions {
    pub poll: Duration,
    pub watch_folders: bool,
    pub folder_quiet_ms: i64,
    pub run_heartbeat_ms: i64,
    /// How often launchers and scan folders should be re-read in the background (incremental, about a second).
    pub full_refresh_ms: i64,
    pub sessions: TrackerOptions,
    pub runtime: DetectorOptions,
}

impl Default for WatcherOptions {
    fn default() -> Self {
        Self {
            poll: Duration::from_secs(5),
            watch_folders: true,
            folder_quiet_ms: 60_000,
            run_heartbeat_ms: 60_000,
            full_refresh_ms: 30 * 60_000,
            sessions: TrackerOptions::default(),
            runtime: DetectorOptions::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum WatcherEvent {
    /// A session started or stopped; the title is the game's.
    Session(SessionEvent, String),
    /// Sessions left open by a crash or power loss were closed at their last heartbeat.
    Recovered(usize),
    /// "Looks like you're playing X" — a new Review item.
    Suggest { title: String, detection_id: i64 },
    /// Downloads that settled (or watched roots that overflowed): the host re-scans them.
    FoldersSettled(Vec<String>),
    /// Time for a background refresh of launchers and scan folders.
    RefreshDue,
    /// A scan folder couldn't be watched.
    FolderFailed(String),
    Error(String),
}

pub type Sink = Box<dyn Fn(WatcherEvent) + Send + Sync>;

/// Folder classifier score that counts as game evidence for a program seen running (one engine or game-data signal).
const MIN_FOLDER_EVIDENCE: i32 = 20;

struct State {
    tracker: SessionTracker,
    detector: RuntimeDetector,
    index: GameIndex,
    ignored: HashSet<String>,
    run_id: Option<i64>,
    last_run_beat: Option<i64>,
    last_full_refresh: i64,
    processes: Box<dyn ProcessSource>,
    foreground: Option<Box<dyn ForegroundProbe>>,
    gpu: Option<Box<dyn GpuSampler>>,
}

struct Inner {
    library: LibraryStore,
    sessions: SessionStore,
    clock: Arc<dyn Clock>,
    o: WatcherOptions,
    state: Mutex<State>,
    folders: Mutex<Option<FolderWatcher>>,
    sink: Sink,
    runtime_detection: AtomicBool,
    stop: (Mutex<bool>, Condvar),
}

pub struct ShelfWatcher {
    inner: Arc<Inner>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

pub struct Probes {
    pub processes: Box<dyn ProcessSource>,
    pub foreground: Option<Box<dyn ForegroundProbe>>,
    pub gpu: Option<Box<dyn GpuSampler>>,
}

impl ShelfWatcher {
    pub fn new(library: LibraryStore, sessions: SessionStore, probes: Probes, clock: Arc<dyn Clock>, options: WatcherOptions, sink: Sink) -> Self {
        let state = State {
            tracker: SessionTracker::new(sessions.clone(), options.sessions.clone()),
            detector: RuntimeDetector::new(options.runtime.clone()),
            index: GameIndex::default(),
            ignored: HashSet::new(),
            run_id: None,
            last_run_beat: None,
            last_full_refresh: clock.now(),
            processes: probes.processes,
            foreground: probes.foreground,
            gpu: probes.gpu,
        };
        Self {
            inner: Arc::new(Inner {
                library,
                sessions,
                clock,
                o: options,
                state: Mutex::new(state),
                folders: Mutex::new(None),
                sink,
                runtime_detection: AtomicBool::new(true),
                stop: (Mutex::new(false), Condvar::new()),
            }),
            thread: Mutex::new(None),
        }
    }

    /// Closes sessions left open by a crash, then starts polling (on a thread when `background`; tests call
    /// [`ShelfWatcher::tick`] themselves).
    pub fn start(&self, watch_folders: Option<&[String]>, background: bool) -> rusqlite::Result<()> {
        let i = &self.inner;
        let recovered = i.sessions.recover_open_sessions(i.o.sessions.min_session_ms / 1000)?;
        if recovered > 0 {
            (i.sink)(WatcherEvent::Recovered(recovered));
        }
        {
            let mut s = i.state.lock().unwrap();
            s.run_id = Some(i.sessions.start_run(i.clock.now())?);
            s.last_full_refresh = i.clock.now();
        }
        self.refresh_index();
        self.set_watch_folders(watch_folders);
        if background {
            let inner = i.clone();
            let t = std::thread::Builder::new()
                .name("Shelf watcher".into())
                .spawn(move || loop {
                    let (lock, cv) = &inner.stop;
                    let stopped = cv.wait_timeout_while(lock.lock().unwrap(), inner.o.poll, |s| !*s).unwrap().0;
                    if *stopped {
                        break;
                    }
                    drop(stopped);
                    if let Err(e) = inner.tick() {
                        (inner.sink)(WatcherEvent::Error(format!("Watcher error: {e}")));
                    }
                })
                .expect("watcher thread");
            *self.thread.lock().unwrap() = Some(t);
        }
        Ok(())
    }

    pub fn running(&self) -> bool {
        self.inner.state.lock().unwrap().run_id.is_some()
    }

    pub fn gpu_available(&self) -> bool {
        self.inner.state.lock().unwrap().gpu.as_ref().is_some_and(|g| g.available())
    }

    /// Games being played right now and when each session started (unix ms).
    pub fn playing(&self) -> Vec<(i64, i64)> {
        self.inner.state.lock().unwrap().tracker.playing()
    }

    pub fn set_runtime_detection(&self, on: bool) {
        self.inner.runtime_detection.store(on, Ordering::Relaxed);
    }

    /// Replaces the watched download folders (`None` or empty turns folder watching off).
    pub fn set_watch_folders(&self, roots: Option<&[String]>) {
        let i = &self.inner;
        let next = roots.filter(|r| i.o.watch_folders && !r.is_empty()).map(|r| FolderWatcher::new(r, i.clock.clone(), i.o.folder_quiet_ms));
        if let Some(f) = &next {
            for failed in &f.failed {
                (i.sink)(WatcherEvent::FolderFailed(failed.clone()));
            }
        }
        *i.folders.lock().unwrap() = next;
    }

    pub fn watched_folders(&self) -> Vec<String> {
        self.inner.folders.lock().unwrap().as_ref().map(|f| f.roots()).unwrap_or_default()
    }

    /// Reloads which exes and folders belong to games (after a library refresh or a manual add).
    pub fn refresh_index(&self) {
        let i = &self.inner;
        let installs = i.library.installs(true).unwrap_or_default().into_iter().map(|r| (r.install_path, r.game_id));
        let index = GameIndex::new(i.library.game_exes().unwrap_or_default(), installs);
        let ignored = i.library.ignored_keys().unwrap_or_default();
        let mut s = i.state.lock().unwrap();
        s.index = index;
        s.ignored = ignored;
    }

    /// One poll.
    pub fn tick(&self) -> rusqlite::Result<()> {
        self.inner.tick()
    }

    pub fn suspend(&self) {
        let i = &self.inner;
        let events = i.state.lock().unwrap().tracker.suspend(i.clock.now());
        i.emit_sessions(events);
    }

    pub fn resume(&self) {
        self.inner.state.lock().unwrap().tracker.resume();
    }

    /// Stops polling and saves open sessions as ended now.
    pub fn stop(&self) {
        let i = &self.inner;
        *i.stop.0.lock().unwrap() = true;
        i.stop.1.notify_all();
        if let Some(t) = self.thread.lock().unwrap().take() {
            let _ = t.join();
        }
        let now = i.clock.now();
        let (events, run) = {
            let mut s = i.state.lock().unwrap();
            (s.tracker.shutdown(now), s.run_id.take())
        };
        if let Some(run) = run {
            let _ = i.sessions.end_run(run, now);
        }
        i.emit_sessions(events);
        *i.folders.lock().unwrap() = None;
    }
}

impl Inner {
    fn emit_sessions(&self, events: rusqlite::Result<Vec<SessionEvent>>) {
        match events {
            Ok(events) => {
                for e in events {
                    let title = self.library.game_title(e.game_id).ok().flatten().unwrap_or_else(|| format!("game #{}", e.game_id));
                    (self.sink)(WatcherEvent::Session(e, title));
                }
            }
            Err(e) => (self.sink)(WatcherEvent::Error(format!("Couldn't save play time: {e}"))),
        }
    }

    fn tick(&self) -> rusqlite::Result<()> {
        let now = self.clock.now();
        let mut suggestion = None;
        let events = {
            let mut s = self.state.lock().unwrap();
            let procs = s.processes.snapshot();
            let running: Vec<RunningGame> = procs
                .iter()
                .filter_map(|p| s.index.match_exe(p.path.as_deref()).map(|id| RunningGame { game_id: id, pid: p.pid, exe_path: p.path.clone() }))
                .collect();
            let events = s.tracker.observe(&running, now);

            if self.runtime_detection.load(Ordering::Relaxed) && s.foreground.is_some() {
                suggestion = self.check_foreground(&mut s, &procs, &running, now);
            }
            if s.run_id.is_some() && s.last_run_beat.is_none_or(|b| now - b >= self.o.run_heartbeat_ms) {
                if let Some(run) = s.run_id {
                    self.sessions.heartbeat_run(run, now)?;
                }
                s.last_run_beat = Some(now);
            }
            if now - s.last_full_refresh >= self.o.full_refresh_ms {
                s.last_full_refresh = now;
                (self.sink)(WatcherEvent::RefreshDue);
            }
            events
        };
        self.emit_sessions(events);

        if let Some((exe, mut signals, strong_gpu)) = suggestion {
            // Looking like a game for a minute isn't enough on its own: plenty of apps go fullscreen. Ask only when
            // the program's folder shows game evidence (engine, game data, middleware) or the 3D engine was busy the
            // whole time.
            let root = install_root_for(&exe);
            let folder = evaluate_path(&root, &ClassifierOptions::default());
            let evidence = folder.score >= MIN_FOLDER_EVIDENCE;
            if evidence || strong_gpu {
                if evidence {
                    signals.extend(folder.signals.iter().filter(|s| s.starts_with('+')).take(3).map(|s| format!("Its folder: {}", &s[s.find(' ').map_or(0, |i| i + 1)..])));
                }
                let title = title_for(&root, Some(&exe));
                if let Some(id) = self.library.add_runtime_detection(&exe, &title, &signals, now)? {
                    (self.sink)(WatcherEvent::Suggest { title, detection_id: id });
                }
            }
        }

        let settled = self.folders.lock().unwrap().as_ref().map(|f| f.poll());
        if let Some((mut settled, overflowed)) = settled {
            settled.extend(overflowed);
            settled.retain(|p| std::path::Path::new(p).is_dir()); // a zip or a deletion: full refreshes pick those up
            if !settled.is_empty() {
                (self.sink)(WatcherEvent::FoldersSettled(settled));
            }
        }
        Ok(())
    }

    /// The exe that looked like a game for a minute, why, and whether the GPU alone makes the case.
    fn check_foreground(&self, s: &mut State, procs: &[ProcInfo], running: &[RunningGame], now: i64) -> Option<(String, Vec<String>, bool)> {
        let mut candidate = None;
        if let Some(w) = s.foreground.as_ref().and_then(|f| f.current()) {
            if !running.iter().any(|r| r.pid == w.pid) {
                let path = procs.iter().find(|p| p.pid == w.pid).and_then(|p| p.path.clone());
                if let Some(path) = path.filter(|p| {
                    !is_excluded(p) && !s.ignored.contains(&path_key(p)) && !s.ignored.contains(&path_key(&install_root_for(p)))
                }) {
                    // Sampled for fullscreen windows too: fullscreen with an idle GPU is a video or an editor.
                    let gpu = s.gpu.as_mut().and_then(|g| g.sample(w.pid));
                    candidate = Some(RuntimeCandidate { pid: w.pid, exe_path: path, fullscreen: w.fullscreen, gpu_3d: gpu });
                }
            }
        }
        let exe = s.detector.observe(candidate.as_ref(), now)?;
        Some((exe, s.detector.last_signals(), s.detector.strong_gpu()))
    }
}
