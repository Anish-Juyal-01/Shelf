//! Art on disk, Shelf's art cache, and art from the web (ported from the C# ArtTests and WebArtTests).

mod support;

use std::cell::Cell;
use std::collections::BTreeSet;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::Duration;

use shelf_core::art::{find_steam, find_xbox, ArtKind, FoundArt};
use shelf_core::library::LibrarySnapshot;
use shelf_core::matcher;
use shelf_core::metadata::{match_key, sniff, Http, Response, WebArt, WebArtSync, STEAM_CDN, STEAM_GRID_DB, STEAM_SEARCH};
use shelf_core::model::{InstallRecord, SourceKind};
use shelf_core::storage::art_cache::ArtCache;
use shelf_core::storage::db::ShelfDb;
use shelf_core::storage::library::LibraryStore;
use shelf_core::storage::ShelfPaths;
use support::TempTree;

const JPG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, b'J', b'F', b'I', b'F', 0, 1, 1, 1];
const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D];

// ── On disk ────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn finds_steam_art_in_both_cache_layouts() {
    let t = TempTree::new();
    t.file("cache/620/aaa/library_capsule.jpg", 1);
    t.file("cache/620/bbb/library_hero.jpg", 1);
    t.file("cache/620/ccc/logo.png", 1);
    t.file("cache/70_library_600x900.jpg", 1);

    let ends = |f: &FoundArt, k: ArtKind, name: &str| f[&k].to_string_lossy().ends_with(name);
    let mut found = FoundArt::new();
    find_steam(&t.p("cache"), "620", &mut found);
    assert!(ends(&found, ArtKind::Cover, "library_capsule.jpg"));
    assert!(ends(&found, ArtKind::Hero, "library_hero.jpg"));
    assert!(ends(&found, ArtKind::Logo, "logo.png"));

    let mut old = FoundArt::new();
    find_steam(&t.p("cache"), "70", &mut old);
    assert!(ends(&old, ArtKind::Cover, "70_library_600x900.jpg"));

    let mut bad = FoundArt::new();
    find_steam(&t.p("cache"), r"..\..", &mut bad);
    assert!(bad.is_empty());
}

#[test]
fn finds_xbox_logos_but_nothing_outside_the_game() {
    let t = TempTree::new();
    t.text(
        "Roblox/Content/MicrosoftGame.config",
        r#"<Game><ShellVisuals DefaultDisplayName="Roblox" Square480x480Logo="Assets/LargeLogo.png" SplashScreenImage="../../secret.png" /></Game>"#,
    );
    t.file("Roblox/Content/Assets/LargeLogo.png", 1);
    t.file("secret.png", 1);
    let mut found = FoundArt::new();
    find_xbox(&t.p("Roblox"), &mut found);
    assert!(found[&ArtKind::Icon].to_string_lossy().ends_with("LargeLogo.png"));
    assert!(!found.contains_key(&ArtKind::Hero));
}

#[test]
fn cache_copies_once_and_only_serves_its_own_files() {
    let t = TempTree::new();
    let art = ArtCache::new(&ShelfPaths::in_dir(t.root()));
    let src = t.file("steam/cover.jpg", 100);
    let one = FoundArt::from([(ArtKind::Cover, src.clone().into())]);

    assert!(art.store(7, &one));
    assert!(!art.store(7, &one));
    assert!(art.get(7, ArtKind::Cover).is_some());
    assert!(art.resolve("7/cover.jpg").is_some());
    assert!(art.resolve("7/../../steam/cover.jpg").is_none());
    assert!(art.resolve("../x").is_none());
    assert!(art.resolve("7/missing.jpg").is_none());
    // The source is untouched.
    assert_eq!(std::fs::metadata(&src).unwrap().len(), 100);

    // Downloaded art with another extension replaces the old copy.
    art.write(7, ArtKind::Cover, ".png", PNG).unwrap();
    assert!(art.get(7, ArtKind::Cover).unwrap().to_string_lossy().ends_with("cover.png"));
    assert!(art.resolve("7/cover.jpg").is_none());
}

// ── From the web ───────────────────────────────────────────────────────────────────────────────────

/// Answers by URL prefix (longest wins); everything else is a 404. Records every request.
#[derive(Default)]
struct FakeWeb {
    routes: Mutex<Vec<(String, u16, Vec<u8>)>>,
    requests: Mutex<Vec<(String, Option<String>)>>,
}

impl FakeWeb {
    fn json(&self, prefix: &str, json: &str) {
        self.routes.lock().unwrap().push((prefix.into(), 200, json.as_bytes().to_vec()));
    }

    fn bytes(&self, prefix: &str, b: &[u8]) {
        self.routes.lock().unwrap().push((prefix.into(), 200, b.to_vec()));
    }

    fn status(&self, prefix: &str, status: u16) {
        self.routes.lock().unwrap().push((prefix.into(), status, Vec::new()));
    }

    fn urls(&self) -> Vec<String> {
        self.requests.lock().unwrap().iter().map(|r| r.0.clone()).collect()
    }
}

impl Http for FakeWeb {
    fn get(&self, url: &str, bearer: Option<&str>) -> Result<Response, String> {
        self.requests.lock().unwrap().push((url.into(), bearer.map(|b| format!("Bearer {b}"))));
        let routes = self.routes.lock().unwrap();
        let hit = routes.iter().filter(|r| url.starts_with(&r.0)).max_by_key(|r| r.0.len());
        Ok(hit.map(|r| Response { status: r.1, body: r.2.clone() }).unwrap_or(Response { status: 404, body: Vec::new() }))
    }
}

fn all() -> BTreeSet<ArtKind> {
    ArtKind::ALL.into_iter().collect()
}

#[test]
fn same_game_matches_across_editions_and_punctuation() {
    for (store, ours) in [
        ("Sekiro™: Shadows Die Twice - GOTY Edition", "Sekiro Shadows Die Twice GOTY Edition"),
        ("Disco Elysium - The Final Cut", "Disco Elysium The Final Cut"),
        ("ELDEN RING", "Elden Ring"),
        ("Baldur's Gate 3", "Baldurs Gate 3"),
    ] {
        assert_eq!(match_key(store), match_key(ours), "{store} vs {ours}");
    }
}

#[test]
fn different_games_dont_match() {
    assert_ne!(match_key("Hollow Knight: Silksong"), match_key("Hollow Knight"));
    assert_ne!(match_key("Hades II"), match_key("Hades"));
}

#[test]
fn only_real_images_are_kept() {
    assert_eq!(sniff(JPG), Some(".jpg"));
    assert_eq!(sniff(PNG), Some(".png"));
    assert_eq!(sniff(b"<!doctype html><html>"), None);
}

#[test]
fn known_steam_app_goes_straight_to_the_cdn_without_searching() {
    let web = FakeWeb::default();
    web.bytes(&format!("{STEAM_CDN}/620/library_600x900.jpg"), JPG); // no _2x version: falls back
    web.bytes(&format!("{STEAM_CDN}/620/library_hero.jpg"), JPG);
    let r = WebArt::new(&web, None).fetch("Portal 2", Some("620"), &all());

    assert_eq!(r.matched.as_deref(), Some("steam:620"));
    assert_eq!(r.art[&ArtKind::Cover].ext, ".jpg");
    assert!(r.art.contains_key(&ArtKind::Hero));
    assert!(!r.art.contains_key(&ArtKind::Logo)); // 404
    assert!(!r.art.contains_key(&ArtKind::Icon)); // Steam has no big icons; that needs SteamGridDB
    assert!(!web.urls().iter().any(|u| u.starts_with(STEAM_SEARCH) || u.starts_with(STEAM_GRID_DB)));
    assert!(!r.failed);
}

#[test]
fn search_picks_the_same_game_not_the_first_result() {
    let web = FakeWeb::default();
    web.json(STEAM_SEARCH, r#"{"total":2,"items":[{"id":1030300,"name":"Hollow Knight: Silksong"},{"id":367520,"name":"Hollow Knight"}]}"#);
    web.bytes(&format!("{STEAM_CDN}/367520/library_600x900_2x.jpg"), JPG);
    let r = WebArt::new(&web, None).fetch("Hollow Knight", None, &BTreeSet::from([ArtKind::Cover]));
    assert_eq!(r.matched.as_deref(), Some("steam:367520"));
    assert!(r.art.contains_key(&ArtKind::Cover));
    assert!(web.urls()[0].contains("term=Hollow%20Knight"));
}

#[test]
fn no_confident_match_means_no_art() {
    let web = FakeWeb::default();
    web.json(STEAM_SEARCH, r#"{"total":1,"items":[{"id":1,"name":"Some Other Game"}]}"#);
    let r = WebArt::new(&web, None).fetch("My Homebrew Thing", None, &all());
    assert_eq!(r.matched, None);
    assert!(r.art.is_empty());
    assert!(!web.urls().iter().any(|u| u.starts_with(STEAM_CDN)));
}

#[test]
fn steam_grid_db_fills_the_rest_and_only_it_sees_the_key() {
    let web = FakeWeb::default();
    web.json(STEAM_SEARCH, r#"{"total":0,"items":[]}"#);
    web.json(&format!("{STEAM_GRID_DB}/search/autocomplete/"), r#"{"success":true,"data":[{"id":5,"name":"VALORANT"}]}"#);
    web.json(&format!("{STEAM_GRID_DB}/icons/game/5"), r#"{"success":true,"data":[{"url":"https://cdn2.steamgriddb.com/icon/v.png"}]}"#);
    web.json(&format!("{STEAM_GRID_DB}/grids/game/5"), r#"{"success":true,"data":[{"url":"http://insecure.example/grid.jpg"}]}"#);
    web.bytes("https://cdn2.steamgriddb.com/icon/v.png", PNG);

    let r = WebArt::new(&web, Some("secret-key")).fetch("VALORANT", None, &all());
    assert_eq!(r.matched.as_deref(), Some("sgdb:5"));
    assert_eq!(r.art[&ArtKind::Icon].ext, ".png");
    assert!(!r.art.contains_key(&ArtKind::Cover)); // non-https URLs are ignored
    for (url, auth) in web.requests.lock().unwrap().iter() {
        let expected = url.starts_with(STEAM_GRID_DB).then(|| "Bearer secret-key".to_string());
        assert_eq!(auth, &expected, "{url}");
    }
}

#[test]
fn server_trouble_is_a_failure_not_a_miss() {
    let web = FakeWeb::default();
    web.status(STEAM_SEARCH, 503);
    let r = WebArt::new(&web, None).fetch("Hades", None, &all());
    assert!(r.failed);
    assert!(r.art.is_empty());
}

#[test]
fn sync_fills_gaps_once_a_week_and_again_when_a_key_is_added() {
    let t = TempTree::new();
    let library = LibraryStore::new(ShelfDb::open(t.p("data/shelf.db")).unwrap());
    let mut portal = InstallRecord::new(SourceKind::Steam, "Portal 2", t.dir("steam/Portal 2"));
    portal.launch_uri = Some("steam://rungameid/620".into());
    portal.confidence = 100;
    let now = Cell::new(1_767_225_600_000i64);
    library.sync(&LibrarySnapshot { games: matcher::merge(vec![portal]), ..Default::default() }, now.get()).unwrap();
    let game = library.games(false).unwrap()[0].id;
    let cache = ArtCache::new(&ShelfPaths::in_dir(t.root()));
    cache.write(game, ArtKind::Hero, ".jpg", JPG).unwrap(); // already found on disk: must not be replaced

    let web = FakeWeb::default();
    web.bytes(&format!("{STEAM_CDN}/620/library_600x900_2x.jpg"), JPG);
    web.bytes(&format!("{STEAM_CDN}/620/library_hero.jpg"), PNG);
    let run = |key: Option<&str>| {
        let sync = WebArtSync { library: &library, cache: &cache, web: WebArt::new(&web, key), pace: Duration::ZERO };
        sync.run(|| now.get(), |_, _| {}, &AtomicBool::new(false)).unwrap()
    };

    let first = run(None);
    assert_eq!(first.images, 1);
    assert!(cache.get(game, ArtKind::Cover).is_some());
    assert!(cache.get(game, ArtKind::Hero).unwrap().to_string_lossy().ends_with(".jpg"));
    assert!(!web.urls().iter().any(|u| u.ends_with("library_hero.jpg")));

    web.requests.lock().unwrap().clear();
    assert_eq!(run(None).looked, 0); // tried this week
    assert!(web.urls().is_empty());

    assert_eq!(run(Some("key")).looked, 1); // a SteamGridDB key is worth another look
    now.set(now.get() + 8 * 24 * 3_600_000);
    assert_eq!(run(None).looked, 1); // and a week later anyway
}
