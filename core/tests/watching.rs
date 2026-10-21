//! Playtime sessions and the watcher loop (ported from the C# SessionTrackerTests and WatchingTests).

mod support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use shelf_core::library::LibrarySnapshot;
use shelf_core::matcher;
use shelf_core::model::{InstallRecord, SourceKind};
use shelf_core::storage::db::ShelfDb;
use shelf_core::storage::library::LibraryStore;
use shelf_core::storage::sessions::SessionStore;
use shelf_core::watching::folders::FolderWatcher;
use shelf_core::watching::tracker::{RunningGame, SessionEventKind, SessionTracker, TrackerOptions};
use shelf_core::watching::watcher::{Probes, ShelfWatcher, WatcherEvent, WatcherOptions};
use shelf_core::watching::{Clock, FakeClock, ForegroundProbe, ForegroundWindow, GpuSampler, ProcInfo, ProcessSource, SystemClock};
use support::{games, TempTree};

const T0: i64 = 1_767_225_600_000;
const SEC: i64 = 1000;
const MIN: i64 = 60 * SEC;

struct TestDb {
    tree: TempTree,
    library: LibraryStore,
    sessions: SessionStore,
}

impl TestDb {
    fn new() -> Self {
        let tree = TempTree::new();
        let db = ShelfDb::open(tree.p("data/shelf.db")).unwrap();
        Self { library: LibraryStore::new(db.clone()), sessions: SessionStore::new(db), tree }
    }

    fn add(&self, source: SourceKind, title: &str, path: &str) -> i64 {
        let mut r = InstallRecord::new(source, title, path);
        r.confidence = 100;
        self.library.sync(&LibrarySnapshot { games: matcher::merge(vec![r]), ..Default::default() }, T0).unwrap();
        self.library.games(true).unwrap().into_iter().find(|g| g.title == title).unwrap().id
    }

    fn total(&self, game: i64) -> i64 {
        self.library.game(game).unwrap().unwrap().total_seconds
    }
}

// ── Session tracker ────────────────────────────────────────────────────────────────────────────────

struct Play {
    t: TestDb,
    tracker: SessionTracker,
    now: i64,
    game: i64,
    other: i64,
    events: Vec<SessionEventKind>,
}

impl Play {
    fn new() -> Self {
        let t = TestDb::new();
        let game = t.add(SourceKind::Folder, "Hades", &t.tree.dir("Games/Hades"));
        let other = t.add(SourceKind::Folder, "Celeste", &t.tree.dir("Games/Celeste"));
        let tracker = SessionTracker::new(t.sessions.clone(), TrackerOptions::default());
        Self { t, tracker, now: T0, game, other, events: Vec::new() }
    }

    fn running(game: i64, pid: u32) -> RunningGame {
        RunningGame { game_id: game, pid, exe_path: Some(r"C:\Games\Hades\Hades.exe".into()) }
    }

    /// Polls every 5 s for `ms` with the given processes running.
    fn play(&mut self, ms: i64, running: &[RunningGame]) {
        let end = self.now + ms;
        while self.now < end {
            let e = self.tracker.observe(running, self.now).unwrap();
            self.events.extend(e.iter().map(|e| e.kind));
            self.now += 5 * SEC;
        }
    }
}

#[test]
fn counts_a_session_from_start_to_last_seen() {
    let mut p = Play::new();
    p.play(30 * MIN, &[Play::running(p.game, 100)]);
    p.play(20 * SEC, &[]); // gone: grace expires

    let s = p.t.sessions.sessions(None, None, 100).unwrap();
    assert_eq!(s.len(), 1);
    assert_eq!(s[0].end_reason.as_deref(), Some("clean"));
    assert!((29 * 60 + 48..=30 * 60).contains(&s[0].seconds()), "{}", s[0].seconds());
    assert_eq!(p.events, [SessionEventKind::Started, SessionEventKind::Stopped]);
    assert!(p.t.library.game(p.game).unwrap().unwrap().last_played.is_some());
}

#[test]
fn short_gaps_do_not_split_a_session() {
    let mut p = Play::new();
    p.play(5 * MIN, &[Play::running(p.game, 1)]);
    p.play(10 * SEC, &[]); // launcher → game handoff
    p.play(5 * MIN, &[Play::running(p.game, 2)]);
    p.play(20 * SEC, &[]);
    assert_eq!(p.t.sessions.sessions(None, None, 100).unwrap().len(), 1);
}

#[test]
fn two_processes_of_one_game_are_one_session_and_two_games_are_two() {
    let mut p = Play::new();
    let (g, o) = (p.game, p.other);
    p.play(2 * MIN, &[Play::running(g, 1), Play::running(g, 2)]);
    p.play(20 * SEC, &[]);
    assert_eq!(p.t.sessions.sessions(None, None, 100).unwrap().len(), 1);
    p.play(2 * MIN, &[Play::running(g, 1), Play::running(o, 2)]);
    p.play(20 * SEC, &[]);
    assert_eq!(p.t.sessions.sessions(None, None, 100).unwrap().len(), 3);
}

#[test]
fn flashes_shorter_than_ten_seconds_are_dropped() {
    let mut p = Play::new();
    p.play(5 * SEC, &[Play::running(p.game, 1)]);
    p.play(30 * SEC, &[]);
    assert!(p.t.sessions.sessions(None, None, 100).unwrap().is_empty());
    assert_eq!(p.t.total(p.game), 0);
    assert_eq!(p.events, [SessionEventKind::Started]); // no "stopped" for a discarded flash
}

#[test]
fn crash_is_recovered_at_last_heartbeat() {
    let mut p = Play::new();
    p.play(10 * MIN + 30 * SEC, &[Play::running(p.game, 1)]);
    // Shelf dies here: no shutdown, no close. Next start:
    assert_eq!(p.t.sessions.recover_open_sessions(0).unwrap(), 1);
    let s = p.t.sessions.sessions(None, None, 100).unwrap();
    assert_eq!(s[0].end_reason.as_deref(), Some("heartbeat"));
    // Heartbeats every 60 s: at most a minute is lost, nothing is invented.
    assert!((570..=630).contains(&s[0].seconds()), "{}", s[0].seconds());
    assert_eq!(s[0].seconds(), p.t.total(p.game));
    assert_eq!(p.t.sessions.recover_open_sessions(0).unwrap(), 0);
}

#[test]
fn sleep_without_a_power_event_ends_the_session_when_last_seen() {
    let mut p = Play::new();
    let g = p.game;
    p.play(20 * MIN, &[Play::running(g, 1)]);
    let last_poll = p.now - 5 * SEC;
    p.now += 7 * 60 * MIN; // overnight; the game is still "running" after resume
    p.play(MIN, &[Play::running(g, 1)]);

    let mut s = p.t.sessions.sessions(None, None, 100).unwrap();
    s.sort_by_key(|s| s.start);
    assert_eq!(s.len(), 2);
    assert_eq!(s[0].end_reason.as_deref(), Some("suspend"));
    assert_eq!(s[0].end, Some(last_poll));
    assert_eq!(s[1].end, None); // still playing
    assert!((19 * 60..=20 * 60).contains(&p.t.total(g)));
}

#[test]
fn suspend_and_resume_events() {
    let mut p = Play::new();
    let g = p.game;
    p.play(3 * MIN, &[Play::running(g, 1)]);
    p.tracker.suspend(p.now).unwrap();
    p.now += 30 * MIN;
    p.tracker.resume();
    p.play(3 * MIN, &[Play::running(g, 1)]);
    p.tracker.shutdown(p.now).unwrap();

    let mut s = p.t.sessions.sessions(None, None, 100).unwrap();
    s.sort_by_key(|s| s.start);
    assert_eq!(s.iter().map(|s| s.end_reason.clone().unwrap()).collect::<Vec<_>>(), ["suspend", "app_exit"]);
    assert!((348..=360).contains(&p.t.total(g)), "{}", p.t.total(g));
}

#[test]
fn heartbeats_are_written_while_playing() {
    let mut p = Play::new();
    p.play(3 * MIN, &[Play::running(p.game, 1)]);
    let open = p.t.sessions.open_sessions().unwrap();
    assert_eq!(open.len(), 1);
    assert!(open[0].last_heartbeat > open[0].start);
    assert!(p.now - open[0].last_heartbeat <= 65 * SEC);
}

// ── Watcher loop ───────────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Default)]
struct FakeProcesses(Arc<Mutex<Vec<ProcInfo>>>);

impl ProcessSource for FakeProcesses {
    fn snapshot(&mut self) -> Vec<ProcInfo> {
        self.0.lock().unwrap().clone()
    }
}

#[derive(Clone, Default)]
struct FakeForeground(Arc<Mutex<Option<ForegroundWindow>>>);

impl ForegroundProbe for FakeForeground {
    fn current(&self) -> Option<ForegroundWindow> {
        *self.0.lock().unwrap()
    }
}

struct NoGpu;

impl GpuSampler for NoGpu {
    fn sample(&mut self, _: u32) -> Option<f64> {
        None
    }

    fn available(&self) -> bool {
        false
    }
}

struct Rig {
    t: TestDb,
    hades: String,
    clock: Arc<FakeClock>,
    procs: FakeProcesses,
    fg: FakeForeground,
    events: Arc<Mutex<Vec<WatcherEvent>>>,
    w: ShelfWatcher,
}

impl Rig {
    fn new() -> Self {
        let t = TestDb::new();
        let hades = games::unity(&t.tree, "Games/Hades");
        t.add(SourceKind::Steam, "Hades", &hades);
        let clock = Arc::new(FakeClock::at(T0));
        let (procs, fg) = (FakeProcesses::default(), FakeForeground::default());
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink_events = events.clone();
        let probes = Probes { processes: Box::new(procs.clone()), foreground: Some(Box::new(fg.clone())), gpu: Some(Box::new(NoGpu)) };
        let options = WatcherOptions { watch_folders: false, ..Default::default() };
        let w = ShelfWatcher::new(t.library.clone(), t.sessions.clone(), probes, clock.clone(), options, Box::new(move |e| sink_events.lock().unwrap().push(e)));
        Self { t, hades, clock, procs, fg, events, w }
    }

    fn run(&self, ms: i64) {
        let end = self.clock.now() + ms;
        while self.clock.now() < end {
            self.w.tick().unwrap();
            self.clock.advance(5 * SEC);
        }
    }

    fn proc(&self, pid: u32, path: String) {
        let name = path.rsplit('\\').next().unwrap().to_string();
        self.procs.0.lock().unwrap().push(ProcInfo { pid, name, path: Some(path) });
    }

    fn session_log(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                WatcherEvent::Session(s, title) => Some(format!("{:?} {title}", s.kind)),
                _ => None,
            })
            .collect()
    }
}

#[test]
fn tracks_a_store_game_by_its_folder_without_knowing_the_exe() {
    let r = Rig::new();
    r.w.start(None, false).unwrap();
    r.proc(42, format!(r"{}\x64\Hades.exe", r.hades));
    r.proc(43, format!(r"{}\UnityCrashHandler64.exe", r.hades));
    r.run(2 * MIN);
    assert_eq!(r.w.playing().len(), 1);
    r.procs.0.lock().unwrap().clear();
    r.run(30 * SEC);
    r.w.stop();

    assert_eq!(r.session_log(), ["Started Hades", "Stopped Hades"]);
    let s = r.t.sessions.sessions(None, None, 10).unwrap();
    assert_eq!(s.len(), 1);
    assert!((110..=125).contains(&s[0].seconds()));
}

#[test]
fn stop_saves_the_open_session() {
    let r = Rig::new();
    r.w.start(None, false).unwrap();
    r.proc(42, format!(r"{}\Hades.exe", r.hades));
    r.run(MIN);
    r.w.stop();
    assert_eq!(r.t.sessions.sessions(None, None, 10).unwrap()[0].end_reason.as_deref(), Some("app_exit"));
    assert!(!r.w.running());
}

#[test]
fn start_recovers_sessions_from_a_crash() {
    let r = Rig::new();
    let game = r.t.library.games(false).unwrap()[0].id;
    let id = r.t.sessions.open(game, None, 1, T0 - 120 * MIN).unwrap();
    r.t.sessions.heartbeat(&[id], T0 - 60 * MIN).unwrap();
    r.w.start(None, false).unwrap();
    r.w.stop();
    assert!(r.events.lock().unwrap().contains(&WatcherEvent::Recovered(1)));
    assert_eq!(r.t.total(game), 3600);
}

#[test]
fn unknown_fullscreen_program_is_suggested_once_and_can_be_accepted() {
    let r = Rig::new();
    let mystery = r.t.tree.file("Stuff/Mystery/mystery.exe", 10);
    r.w.start(None, false).unwrap();
    r.proc(77, mystery);
    *r.fg.0.lock().unwrap() = Some(ForegroundWindow { pid: 77, fullscreen: true });
    r.run(3 * MIN);

    let suggestions: Vec<String> = r
        .events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| if let WatcherEvent::Suggest { title, .. } = e { Some(title.clone()) } else { None })
        .collect();
    assert_eq!(suggestions, ["Mystery"]);
    let d = r.t.library.pending_detections().unwrap();
    assert_eq!(d.len(), 1);
    assert_eq!(d[0].origin, "runtime");

    let game = r.t.library.accept_detection(d[0].id, None, r.clock.now()).unwrap();
    r.w.refresh_index();
    r.run(MIN);
    r.w.stop();
    assert!(r.t.sessions.sessions(None, None, 10).unwrap().iter().any(|s| s.game_id == game));
}

#[test]
fn rejected_programs_are_not_suggested_again() {
    let r = Rig::new();
    let tool = format!(r"{}\tool.exe", r.t.tree.dir("Stuff/Tool"));
    let id = r.t.library.add_runtime_detection(&tool, "Tool", &["x".into()], T0).unwrap().unwrap();
    r.t.library.reject_detection(id, T0).unwrap();
    r.w.start(None, false).unwrap();
    r.proc(5, tool);
    *r.fg.0.lock().unwrap() = Some(ForegroundWindow { pid: 5, fullscreen: true });
    r.run(3 * MIN);
    r.w.stop();
    assert!(!r.events.lock().unwrap().iter().any(|e| matches!(e, WatcherEvent::Suggest { .. })));
}

#[test]
fn a_background_refresh_is_asked_for_every_half_hour() {
    let r = Rig::new();
    r.w.start(None, false).unwrap();
    r.run(31 * MIN);
    r.w.stop();
    assert_eq!(r.events.lock().unwrap().iter().filter(|e| **e == WatcherEvent::RefreshDue).count(), 1);
}

#[test]
fn real_file_system_events_are_reported() {
    let t = TempTree::new();
    let root = t.dir("Downloads");
    let w = FolderWatcher::new(&[root], Arc::new(SystemClock), 300);
    games::unity(&t, "Downloads/New Game");

    let mut settled = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while settled.is_empty() && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
        settled.extend(w.poll().0);
    }
    assert_eq!(settled, [t.s("Downloads/New Game")]);
}

#[cfg(windows)]
#[test]
fn exe_icons_come_from_the_program_itself() {
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into());
    let png = shelf_core::watching::system::exe_icon_png(&format!(r"{windir}\explorer.exe")).expect("explorer has an icon");
    assert!(png.starts_with(b"\x89PNG"));
    let t = TempTree::new();
    assert!(shelf_core::watching::system::exe_icon_png(&t.file("blank.exe", 64)).is_none());
}
