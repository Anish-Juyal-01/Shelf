//! The library database: syncing, user decisions and playtime (ported from the C# LibraryStoreTests).

mod support;

use shelf_core::library::{build, LibrarySnapshot};
use shelf_core::matcher;
use shelf_core::model::{InstallRecord, SizeSource, SourceKind, SourceResult, SourceState};
use shelf_core::platform::normalize;
use shelf_core::scanning::scanner::ScanResult;
use shelf_core::storage::db::ShelfDb;
use shelf_core::storage::library::LibraryStore;
use shelf_core::storage::sessions::SessionStore;
use support::{games, TempTree};

const HOUR: i64 = 3_600_000;
const MINUTE: i64 = 60_000;
/// 2026-01-01, a fixed "now".
const T0: i64 = 1_767_225_600_000;

struct TestDb {
    tree: TempTree,
    library: LibraryStore,
    sessions: SessionStore,
    now: i64,
}

impl TestDb {
    fn new() -> Self {
        let tree = TempTree::new();
        let db = ShelfDb::open(tree.p("data/shelf.db")).unwrap();
        Self { library: LibraryStore::new(db.clone()), sessions: SessionStore::new(db), tree, now: T0 }
    }

    fn sync(&self, library: Vec<InstallRecord>, review: Vec<InstallRecord>) -> shelf_core::storage::library::SyncResult {
        self.library.sync(&LibrarySnapshot { games: matcher::merge(library), review, ..Default::default() }, self.now).unwrap()
    }

    /// A finished session of `ms` ending now.
    fn played(&self, game_id: i64, ms: i64) {
        let id = self.sessions.open(game_id, None, 1, self.now - ms).unwrap();
        self.sessions.close(id, self.now, "clean", false).unwrap();
    }
}

fn r(source: SourceKind, title: &str, path: &str, confidence: u8, size: Option<i64>) -> InstallRecord {
    let mut i = InstallRecord::new(source, title, path);
    i.confidence = confidence;
    i.size_bytes = size;
    i.size_source = SizeSource::Measured;
    i
}

fn game(source: SourceKind, title: &str, path: &str) -> InstallRecord {
    r(source, title, path, 100, Some(1000))
}

#[test]
fn sync_creates_games_and_reports_new_ones() {
    let mut t = TestDb::new();
    let hades = t.tree.dir("Games/Hades");
    let result = t.sync(vec![game(SourceKind::Steam, "Hades", &hades)], vec![]);
    assert_eq!(result.new_games, ["Hades"]);
    let g = t.library.games(false).unwrap();
    assert_eq!(g.len(), 1);
    assert!(g[0].installed);
    assert_eq!(g[0].size_bytes, 1000);
    assert_eq!(g[0].sources, [SourceKind::Steam]);
    assert_eq!(g[0].first_seen, T0);

    t.now += HOUR;
    assert!(t.sync(vec![game(SourceKind::Steam, "Hades", &hades)], vec![]).new_games.is_empty());
}

#[test]
fn game_keeps_its_row_when_its_title_changes() {
    let mut t = TestDb::new();
    let dir = t.tree.dir("Games/hk");
    t.sync(vec![game(SourceKind::Folder, "Hollow Knight v1", &dir)], vec![]);
    let id = t.library.games(false).unwrap()[0].id;
    t.played(id, HOUR);

    t.now += MINUTE;
    t.sync(vec![game(SourceKind::Folder, "Hollow Knight", &dir)], vec![]);
    let g = t.library.games(false).unwrap();
    assert_eq!(g.len(), 1);
    assert_eq!(g[0].id, id);
    assert_eq!(g[0].title, "Hollow Knight");
    assert_eq!(g[0].total_seconds, 3600);
}

#[test]
fn renamed_titles_stay_renamed() {
    let mut t = TestDb::new();
    let dir = t.tree.dir("Games/x");
    t.sync(vec![game(SourceKind::Folder, "Wrong Name", &dir)], vec![]);
    let id = t.library.games(false).unwrap()[0].id;
    t.library.rename(id, "Right Name").unwrap();
    t.now += MINUTE;
    t.sync(vec![game(SourceKind::Folder, "Wrong Name", &dir)], vec![]);
    assert_eq!(t.library.games(false).unwrap()[0].title, "Right Name");
}

#[test]
fn deleted_folders_are_removed_but_history_stays() {
    let mut t = TestDb::new();
    let dir = t.tree.dir("Games/Gone");
    t.sync(vec![game(SourceKind::Folder, "Gone", &dir)], vec![]);
    let id = t.library.games(false).unwrap()[0].id;
    t.played(id, 30 * MINUTE);

    std::fs::remove_dir(&dir).unwrap();
    t.now += MINUTE;
    let result = t.library.sync(&LibrarySnapshot::default(), t.now).unwrap();
    assert_eq!(result.removed_installs, 1);
    let g = t.library.games(false).unwrap();
    assert_eq!(g.len(), 1);
    assert!(!g[0].installed);
    assert_eq!(g[0].total_seconds, 1800);
    assert_eq!(g[0].last_played, Some(t.now - MINUTE));
}

#[test]
fn unreported_but_present_folders_are_kept() {
    // e.g. the launcher couldn't be read this time, or the drive was briefly busy.
    let mut t = TestDb::new();
    let dir = t.tree.dir("Games/Still");
    t.sync(vec![game(SourceKind::Epic, "Still Here", &dir)], vec![]);
    t.now += MINUTE;
    assert_eq!(t.library.sync(&LibrarySnapshot::default(), t.now).unwrap().removed_installs, 0);
    assert!(t.library.games(false).unwrap()[0].installed);
}

#[test]
fn duplicate_copies_are_counted() {
    let t = TestDb::new();
    t.sync(
        vec![
            r(SourceKind::Steam, "Sekiro", &t.tree.dir("Steam/Sekiro"), 100, Some(15)),
            r(SourceKind::Folder, "Sekiro", &t.tree.dir("Games/Sekiro"), 100, Some(16)),
        ],
        vec![],
    );
    let g = t.library.games(false).unwrap();
    assert_eq!(g.len(), 1);
    assert_eq!(g[0].installed_copies, 2);
    assert_eq!(g[0].size_bytes, 31);
}

#[test]
fn imported_steam_hours_are_kept_separately() {
    let t = TestDb::new();
    let mut p = game(SourceKind::Steam, "Portal 2", &t.tree.dir("Steam/Portal 2"));
    p.imported_play_seconds = 7200;
    p.imported_last_played = Some(1_735_689_600); // 2025-01-01
    t.sync(vec![p], vec![]);
    let g = &t.library.games(false).unwrap()[0];
    assert_eq!(g.imported_seconds, 7200);
    assert_eq!(g.total_seconds, 0);
    assert_eq!(g.play_seconds(), 7200);
    assert_eq!(g.last_played_any(), Some(1_735_689_600_000));
}

#[test]
fn review_accept_makes_a_game_and_it_stays_one() {
    let mut t = TestDb::new();
    let dir = t.tree.dir("Games/Mystery");
    let mut review = r(SourceKind::Folder, "Mystery", &dir, 45, Some(1000));
    review.launch_exe = Some(format!(r"{dir}\mystery.exe"));
    t.sync(vec![], vec![review.clone()]);
    let pending = t.library.pending_detections().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].confidence, 45);

    let id = t.library.accept_detection(pending[0].id, Some("Mystery Game"), t.now).unwrap();
    assert!(t.library.pending_detections().unwrap().is_empty());
    t.now += MINUTE;
    t.sync(vec![], vec![review]); // the scanner still isn't sure, but you said yes
    assert!(t.library.pending_detections().unwrap().is_empty());
    let g = t.library.games(false).unwrap();
    assert_eq!(g.len(), 1);
    assert_eq!(g[0].id, id);
    assert_eq!(g[0].title, "Mystery Game");
    assert!(g[0].installed);
    assert_eq!(t.library.game_exes().unwrap().len(), 1);
}

#[test]
fn rejected_detections_never_come_back() {
    let t = TestDb::new();
    let review = r(SourceKind::Folder, "Thing", &t.tree.dir("Tools/Thing"), 40, Some(1000));
    t.sync(vec![], vec![review.clone()]);
    t.library.reject_detection(t.library.pending_detections().unwrap()[0].id, t.now).unwrap();
    t.sync(vec![], vec![review]);
    assert!(t.library.pending_detections().unwrap().is_empty());
    assert!(t.library.games(false).unwrap().is_empty());
}

#[test]
fn runtime_detections_are_recorded_once() {
    let t = TestDb::new();
    let exe = format!(r"{}\odd.exe", t.tree.dir("Stuff/Odd/bin/x64"));
    assert!(t.library.add_runtime_detection(&exe, "Odd", &["Ran fullscreen".into()], t.now).unwrap().is_some());
    assert!(t.library.add_runtime_detection(&exe, "Odd", &["again".into()], t.now).unwrap().is_none());
    let d = t.library.pending_detections().unwrap();
    assert_eq!(d.len(), 1);
    assert_eq!(d[0].path, t.tree.s("Stuff/Odd")); // bin\x64 walked up to the game folder
}

#[test]
fn manual_add_uses_the_game_folder() {
    let t = TestDb::new();
    let root = games::unreal(&t.tree, "Stuff/Stray");
    let shipping = format!(r"{root}\Hk_project\Binaries\Win64\Stray-Win64-Shipping.exe");
    let id = t.library.add_manual(&shipping, None, t.now, true).unwrap();
    let g = &t.library.games(false).unwrap()[0];
    assert_eq!(g.id, id);
    assert_eq!(g.title, "Stray");
    assert_eq!(g.primary_path.as_deref(), Some(normalize(&root).as_str()));
    assert!(g.size_bytes > 0);
    assert!(t.library.add_manual(&t.tree.s("nope.exe"), None, t.now, true).is_err());
}

#[test]
fn hidden_games_are_filtered_by_default() {
    let t = TestDb::new();
    t.sync(vec![game(SourceKind::Folder, "Secret", &t.tree.dir("Games/Secret"))], vec![]);
    t.library.set_hidden(t.library.games(false).unwrap()[0].id, true).unwrap();
    assert!(t.library.games(false).unwrap().is_empty());
    assert_eq!(t.library.games(true).unwrap().len(), 1);
}

#[test]
fn source_status_is_stored() {
    let t = TestDb::new();
    let snap = LibrarySnapshot {
        sources: vec![SourceResult::new(SourceKind::Epic, SourceState::Unreadable, "Epic manifests not found", vec![])],
        ..Default::default()
    };
    t.library.sync(&snap, t.now).unwrap();
    let s = t.library.source_statuses().unwrap();
    assert_eq!(s, [(SourceKind::Epic, SourceState::Unreadable, "Epic manifests not found".to_string(), 0)]);
}

#[test]
fn crashed_sessions_close_at_their_last_heartbeat() {
    let t = TestDb::new();
    t.sync(vec![game(SourceKind::Folder, "Hades", &t.tree.dir("Games/Hades"))], vec![]);
    let id = t.library.games(false).unwrap()[0].id;
    let s = t.sessions.open(id, None, 7, T0).unwrap();
    t.sessions.heartbeat(&[s], T0 + 20 * MINUTE).unwrap();
    let short = t.sessions.open(id, None, 8, T0 + HOUR).unwrap();
    t.sessions.heartbeat(&[short], T0 + HOUR + 5_000).unwrap();
    let run = t.sessions.start_run(T0).unwrap();
    t.sessions.heartbeat_run(run, T0 + HOUR).unwrap();

    assert_eq!(t.sessions.recover_open_sessions(30).unwrap(), 2);
    assert!(t.sessions.open_sessions().unwrap().is_empty());
    let rows = t.sessions.sessions(Some(id), None, 100).unwrap();
    assert_eq!(rows.len(), 1, "the 5-second one is discarded");
    assert_eq!(rows[0].seconds(), 1200);
    assert_eq!(rows[0].end_reason.as_deref(), Some("heartbeat"));
    assert_eq!(t.library.games(false).unwrap()[0].total_seconds, 1200);
    assert_eq!(t.sessions.runs(T0).unwrap()[0].end, Some(T0 + HOUR));
}

#[test]
fn opens_a_database_the_csharp_build_wrote() {
    // Same schema, same names: a C#-era row reads back as it was written.
    let t = TestDb::new();
    let c = rusqlite::Connection::open(t.tree.p("data/shelf.db")).unwrap();
    c.execute_batch(
        "INSERT INTO games (id, key, title, first_seen, total_seconds) VALUES (5, 'valorant', 'VALORANT', 1700000000000, 120);
         INSERT INTO installs (game_id, source, install_path, path_key, state, confidence, first_seen, last_seen, launch_uri, size_bytes, size_source, signals)
         VALUES (5, 'Riot', 'C:\\Riot Games\\VALORANT', 'C:\\RIOT GAMES\\VALORANT', 'installed', 100, 1, 1, NULL, 42, 'Manifest', '[\"Riot\"]');",
    )
    .unwrap();
    let g = &t.library.games(false).unwrap()[0];
    assert_eq!((g.id, g.title.as_str(), g.total_seconds, g.size_bytes), (5, "VALORANT", 120, 42));
    assert_eq!(g.sources, [SourceKind::Riot]);
    assert_eq!(t.library.installs_for(5).unwrap()[0].signals, ["Riot"]);
}

#[test]
fn build_splits_by_confidence_and_drops_review_duplicates() {
    let mut maybe = InstallRecord::new(SourceKind::InstalledApps, "Maybe", r"C:\Maybe");
    maybe.confidence = 40;
    let sources = vec![
        SourceResult::new(SourceKind::Steam, SourceState::Ok, "", vec![game(SourceKind::Steam, "Stray", r"C:\Steam\common\Stray")]),
        SourceResult::new(SourceKind::InstalledApps, SourceState::Ok, "", vec![maybe]),
    ];
    let mut bits = InstallRecord::new(SourceKind::Folder, "Stray bits", r"C:\Steam\common\Stray\Extras");
    bits.confidence = 50;
    let scan = ScanResult { root: r"C:\".into(), review: vec![bits], library: vec![game(SourceKind::Folder, "Celeste", r"C:\Games\Celeste")], ..Default::default() };

    let snap = build(sources, vec![scan], 70);
    assert_eq!(snap.games.iter().map(|g| g.title.as_str()).collect::<Vec<_>>(), ["Celeste", "Stray"]);
    assert_eq!(snap.review.len(), 1);
    assert_eq!(snap.review[0].title, "Maybe");
}
