//! Everything behind the window: database, detection, background refreshes and scans, art, and the commands the UI
//! sends. Slow work runs on its own threads; results reach the UI as `host` events.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use shelf_core::art::{ArtKind, ArtLocator};
use shelf_core::launching;
use shelf_core::library::Refresher;
use shelf_core::metadata::{system_clock, UreqHttp, WebArt, WebArtSync};
use shelf_core::platform::{drive_info, iso_ms, is_same_or_inside, normalize, now_ms, path_key, DriveInfo, SystemContext};
use shelf_core::scanning::scanner::{Leftover, LeftoverKind, ScanEvent};
use shelf_core::scanning::suggest::suggest_roots;
use shelf_core::storage::art_cache::ArtCache;
use shelf_core::storage::db::ShelfDb;
use shelf_core::storage::library::{GameRow, InstallRow, LibraryStore, SyncResult};
use shelf_core::storage::sessions::{SessionRow, SessionStore};
use shelf_core::storage::{Settings, ShelfPaths};
use tauri::{AppHandle, Emitter};

const PALETTES: &[&str] = &["sunset", "aurora", "neon", "dune", "deepsea", "sakura", "onyx", "ember", "volt", "cobalt", "crimson", "gold"];

/// Where the UI loads cached art from (the `shelf` URI scheme, served by [`Host::art_file`]).
pub const ART_ORIGIN: &str = "http://shelf.localhost/art";

#[derive(Clone, Default)]
struct ScanStatus {
    running: bool,
    phase: Option<String>,
    dirs: usize,
    path: Option<String>,
    last_run: Option<i64>,
    last_seconds: Option<f64>,
    error: Option<String>,
}

impl ScanStatus {
    fn view(&self) -> Value {
        json!({
            "running": self.running, "phase": self.phase, "dirs": self.dirs, "path": self.path,
            "lastRun": self.last_run.map(iso_ms), "lastSeconds": self.last_seconds, "error": self.error,
        })
    }
}

pub struct Host {
    app: AppHandle,
    pub paths: ShelfPaths,
    library: LibraryStore,
    sessions: SessionStore,
    art: ArtCache,
    ctx: SystemContext,
    refresher: Refresher,
    settings: Mutex<Settings>,
    scan: Mutex<ScanStatus>,
    cancel: Mutex<Arc<AtomicBool>>,
    leftovers: Mutex<Vec<Leftover>>,
    suggested: OnceLock<Vec<String>>,
    web_art_running: AtomicBool,
    state_pending: AtomicBool,
    open_game: Mutex<Option<i64>>,
    ui_ready: AtomicBool,
    /// Set when the app is closing: background work stops.
    pub closing: Arc<AtomicBool>,
}

impl Host {
    pub fn new(app: AppHandle) -> Result<Arc<Self>, String> {
        let paths = ShelfPaths::default_paths();
        let db = ShelfDb::open_in(&paths).map_err(|e| format!("Couldn't open Shelf's database ({}): {e}", paths.db_file().display()))?;
        let library = LibraryStore::new(db.clone());
        let ctx = SystemContext::real();
        Ok(Arc::new(Self {
            app,
            settings: Mutex::new(Settings::load(&paths)),
            art: ArtCache::new(&paths),
            refresher: Refresher::new(ctx.clone(), paths.clone(), library.clone()),
            sessions: SessionStore::new(db),
            library,
            ctx,
            paths,
            scan: Mutex::new(ScanStatus::default()),
            cancel: Mutex::new(Arc::new(AtomicBool::new(false))),
            leftovers: Mutex::new(Vec::new()),
            suggested: OnceLock::new(),
            web_art_running: AtomicBool::new(false),
            state_pending: AtomicBool::new(false),
            open_game: Mutex::new(None),
            ui_ready: AtomicBool::new(false),
            closing: Arc::new(AtomicBool::new(false)),
        }))
    }

    pub fn app(&self) -> &AppHandle {
        &self.app
    }

    pub fn start(self: &Arc<Self>) {
        self.refresh_all(true);
    }

    // ── Talking to the UI ───────────────────────────────────────────────────────────────────────────

    fn emit(&self, message: Value) {
        if self.ui_ready.load(Ordering::Relaxed) {
            let _ = self.app.emit("host", message);
        }
    }

    pub fn notice(&self, tone: &str, text: impl Into<String>) {
        self.notice_to(tone, text, None, None);
    }

    fn notice_to(&self, tone: &str, text: impl Into<String>, view: Option<&str>, game_id: Option<i64>) {
        self.emit(json!({ "type": "notice", "tone": tone, "text": text.into(), "view": view, "gameId": game_id }));
    }

    /// The UI loaded: it gets everything at once.
    pub fn hello(&self, maximized: bool) {
        self.ui_ready.store(true, Ordering::Relaxed);
        match self.build_state() {
            Ok(state) => self.emit(json!({ "type": "hello", "version": env!("CARGO_PKG_VERSION"), "maximized": maximized, "state": state })),
            Err(e) => self.notice("error", format!("Couldn't read the library: {e}")),
        }
    }

    /// Library or settings changed: the state is re-sent, once per burst of changes.
    fn changed(self: &Arc<Self>) {
        if self.state_pending.swap(true, Ordering::AcqRel) {
            return;
        }
        let host = self.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(250));
            host.state_pending.store(false, Ordering::Release);
            if let Ok(state) = host.build_state() {
                host.emit(json!({ "type": "state", "state": state }));
            }
        });
    }

    /// Re-sends the game page if that game is open.
    fn game_changed(&self, id: i64) {
        if *self.open_game.lock().unwrap() == Some(id) {
            self.send_game(id);
        }
    }

    pub fn get_game(&self, id: i64) {
        *self.open_game.lock().unwrap() = Some(id);
        self.send_game(id);
    }

    fn send_game(&self, id: i64) {
        if let Ok(Some(detail)) = self.game_detail(id) {
            self.emit(json!({ "type": "game", "detail": detail }));
        }
    }

    // ── Refresh & scans ─────────────────────────────────────────────────────────────────────────────

    pub fn refresh_all(self: &Arc<Self>, first_run: bool) {
        self.run_scan("Reading launchers", move |host, cancel| {
            let roots = host.settings.lock().unwrap().scan_roots.clone();
            let on_event = |e: ScanEvent| host.on_scan_event(e);
            let r = host.refresher.refresh_all(&roots, true, Some(&on_event), cancel).map_err(|e| e.to_string())?;
            *host.leftovers.lock().unwrap() = r.snapshot.leftovers;
            host.changed();
            host.sync_art(cancel);
            host.start_web_art();
            host.announce(&r.sync);
            if first_run {
                let mut s = host.settings.lock().unwrap();
                if !s.onboarding_done {
                    s.onboarding_done = true;
                    let tip = s.scan_roots.is_empty();
                    let _ = s.save(&host.paths);
                    drop(s);
                    if tip {
                        host.notice_to("info", "Tip: add the folders where you keep downloaded games — Settings → Scan folders", Some("settings"), None);
                    }
                }
            }
            Ok(r.elapsed)
        });
    }

    /// One-off search of a folder or a whole drive (not remembered as a scan folder).
    pub fn scan_once(self: &Arc<Self>, path: String) {
        self.run_scan(&format!("Searching {path}"), move |host, cancel| {
            let started = Instant::now();
            let on_event = |e: ScanEvent| host.on_scan_event(e);
            let (scan, sync) = host.refresher.refresh_folder(&path, Some(&on_event), cancel).map_err(|e| e.to_string())?;
            {
                let mut l = host.leftovers.lock().unwrap();
                l.retain(|x| !is_same_or_inside(&x.path, &path));
                l.extend(scan.leftovers.iter().cloned());
            }
            host.announce(&sync);
            if let Some(e) = scan.error {
                return Err(e);
            }
            if !scan.cancelled {
                let unreadable = if scan.unreadable > 0 { format!(" · {} folders couldn't be read", scan.unreadable) } else { String::new() };
                host.notice(
                    "success",
                    format!("Searched {path}: {} games, {} to review, {} leftovers{unreadable}", scan.library.len(), scan.review.len(), scan.leftovers.len()),
                );
            }
            Ok(started.elapsed())
        });
    }

    pub fn cancel_scan(&self) {
        self.cancel.lock().unwrap().store(true, Ordering::Relaxed);
    }

    fn run_scan(self: &Arc<Self>, phase: &str, work: impl FnOnce(&Arc<Host>, &AtomicBool) -> Result<Duration, String> + Send + 'static) {
        let cancel = {
            let mut s = self.scan.lock().unwrap();
            if s.running {
                return;
            }
            *s = ScanStatus { running: true, phase: Some(phase.into()), last_run: s.last_run, last_seconds: s.last_seconds, ..Default::default() };
            let c = Arc::new(AtomicBool::new(false));
            *self.cancel.lock().unwrap() = c.clone();
            c
        };
        self.emit(json!({ "type": "scan", "scan": self.scan.lock().unwrap().view() }));
        let host = self.clone();
        std::thread::spawn(move || {
            let result = work(&host, &cancel);
            let stopped = cancel.load(Ordering::Relaxed);
            let error = match &result {
                Err(e) => {
                    host.notice("error", format!("Scan failed: {e}"));
                    Some(e.clone())
                }
                Ok(_) if stopped && !host.closing.load(Ordering::Relaxed) => {
                    host.notice("info", "Scan stopped. What was found so far is kept.");
                    None
                }
                Ok(_) => None,
            };
            {
                let mut s = host.scan.lock().unwrap();
                let last_seconds = result.as_ref().ok().map(|d| d.as_secs_f64()).or(s.last_seconds);
                *s = ScanStatus { last_run: Some(now_ms()), last_seconds, error, ..Default::default() };
            }
            host.changed();
        });
    }

    fn on_scan_event(&self, e: ScanEvent) {
        let ScanEvent::Progress { path, dirs } = e else { return };
        let view = {
            let mut s = self.scan.lock().unwrap();
            s.phase = Some("Scanning folders".into());
            s.dirs = dirs;
            s.path = Some(path);
            s.view()
        };
        self.emit(json!({ "type": "scan", "scan": view }));
    }

    fn announce(&self, sync: &SyncResult) {
        match sync.new_games.len() {
            0 => {}
            1..=3 => self.notice_to("success", format!("New on your shelf: {}", sync.new_games.join(", ")), Some("library"), None),
            n => self.notice_to("success", format!("{n} new games on your shelf"), Some("library"), None),
        }
        if sync.new_detections > 0 {
            self.notice_to("info", format!("{} possible game(s) need a look", sync.new_detections), Some("review"), None);
        }
        if sync.removed_installs > 0 {
            self.notice("info", format!("{} game folder(s) are gone from disk — their play history is kept", sync.removed_installs));
        }
    }

    // ── Art ─────────────────────────────────────────────────────────────────────────────────────────

    /// Copies art that's already on this PC (Steam's library images, Xbox logos) into Shelf's art cache. No network.
    /// Runs after every refresh; cheap when nothing changed. (Exe icons arrive with stage 4.)
    fn sync_art(self: &Arc<Self>, cancel: &AtomicBool) {
        let locator = ArtLocator::new(&self.ctx);
        let Ok(games) = self.library.games(true) else { return };
        let mut changed = false;
        for g in games.iter().filter(|g| g.installed) {
            if cancel.load(Ordering::Relaxed) {
                return;
            }
            let mut found = shelf_core::art::FoundArt::new();
            for i in self.library.installs_for(g.id).unwrap_or_default().iter().filter(|i| i.is_installed()) {
                for (k, v) in locator.find(i) {
                    found.entry(k).or_insert(v);
                }
            }
            changed |= self.art.store(g.id, &found);
        }
        if changed {
            self.changed();
        }
    }

    /// Fills in missing covers, heroes, logos and icons from the web, in the background (one run at a time).
    fn start_web_art(self: &Arc<Self>) {
        let (enabled, key) = {
            let s = self.settings.lock().unwrap();
            (s.web_art, s.steam_grid_db_key.clone())
        };
        if !enabled || self.web_art_running.swap(true, Ordering::AcqRel) {
            return;
        }
        let host = self.clone();
        std::thread::spawn(move || {
            let http = UreqHttp::new(&format!("Shelf/{}", env!("CARGO_PKG_VERSION")));
            let sync = WebArtSync { library: &host.library, cache: &host.art, web: WebArt::new(&http, key.as_deref()), pace: Duration::from_millis(300) };
            let mut unsent = 0;
            // Show art as it arrives, a few games at a time.
            let result = sync.run(
                system_clock,
                |_, found| {
                    if found > 0 {
                        unsent += 1;
                        if unsent >= 4 {
                            unsent = 0;
                            host.changed();
                        }
                    }
                },
                &host.closing,
            );
            match result {
                Ok(s) => {
                    if unsent > 0 || s.images > 0 {
                        host.changed();
                    }
                    if s.failed > 0 && s.failed == s.looked {
                        host.notice("info", "Couldn't reach the internet to look up game art. Shelf will try again next time.");
                    }
                }
                Err(e) => host.notice("error", format!("Looking up game art failed: {e}")),
            }
            host.web_art_running.store(false, Ordering::Release);
        });
    }

    /// A file inside the art cache, for the `shelf` URI scheme.
    pub fn art_file(&self, relative: &str) -> Option<PathBuf> {
        self.art.resolve(relative)
    }

    fn art_url(&self, game_id: i64, kind: ArtKind) -> Option<String> {
        let file = self.art.get(game_id, kind)?;
        let v = std::fs::metadata(&file).and_then(|m| m.modified()).ok().map(|t| shelf_core::scanning::cache::stamp(Some(t))).unwrap_or(0);
        Some(format!("{ART_ORIGIN}/{game_id}/{}?v={v}", file.file_name()?.to_string_lossy()))
    }

    // ── State for the UI ────────────────────────────────────────────────────────────────────────────

    pub fn build_state(&self) -> rusqlite::Result<Value> {
        let now = now_ms();
        let installs = self.library.installs(false)?;
        let mut by_game: HashMap<i64, Vec<&InstallRow>> = HashMap::new();
        for i in &installs {
            by_game.entry(i.game_id).or_default().push(i);
        }
        let games: Vec<Value> = self.library.games(true)?.iter().map(|g| self.game_view(g, by_game.get(&g.id).map(Vec::as_slice).unwrap_or(&[]))).collect();

        let since = now - 35 * 24 * 3_600_000;
        let sessions: Vec<Value> = self.sessions.sessions(None, Some(since), 2000)?.iter().map(session_view).collect();

        let mut games_by_root: HashMap<String, i64> = HashMap::new();
        for i in installs.iter().filter(|i| i.is_installed()) {
            if let Some(size) = i.size_bytes {
                *games_by_root.entry(drive_of(&i.install_path)).or_default() += size;
            }
        }
        let drives: Vec<DriveInfo> = self.ctx.fixed_drives.iter().filter_map(|d| drive_info(&d.to_string_lossy())).collect();
        let drive_views: Vec<Value> = drives
            .iter()
            .map(|d| {
                json!({
                    "root": d.root, "label": d.label, "totalBytes": d.total_bytes, "freeBytes": d.free_bytes,
                    "gamesBytes": games_by_root.get(&d.root.to_uppercase()).copied().unwrap_or(0),
                })
            })
            .collect();

        let runs = self.sessions.runs(since)?;
        let gaps: Vec<Value> = runs
            .windows(2)
            .filter_map(|w| {
                let end = w[0].end.unwrap_or(w[0].last_heartbeat);
                (w[1].start - end > 2 * 60_000).then(|| json!({ "start": iso_ms(end), "end": iso_ms(w[1].start) }))
            })
            .collect();

        let sources: Vec<Value> = self
            .library
            .source_statuses()?
            .into_iter()
            .map(|(kind, state, message, count)| json!({ "source": kind, "name": kind.display_name(), "state": state, "message": message, "count": count }))
            .collect();

        let review: Vec<Value> = self
            .library
            .pending_detections()?
            .into_iter()
            .map(|d| {
                json!({
                    "id": d.id, "title": d.suggested_title, "path": d.path, "exe": d.exe, "origin": d.origin, "confidence": d.confidence,
                    "sizeBytes": d.size_bytes, "signals": d.signals, "found": iso_ms(d.found),
                })
            })
            .collect();

        let leftovers: Vec<Value> = self
            .leftovers
            .lock()
            .unwrap()
            .iter()
            .map(|l| {
                let kind = if l.kind == LeftoverKind::Archive { "archive" } else { "installer" };
                json!({ "path": l.path, "kind": kind, "title": l.title, "sizeBytes": l.size_bytes })
            })
            .collect();

        Ok(json!({
            "games": games,
            "review": review,
            "sources": sources,
            "leftovers": leftovers,
            "drives": drive_views,
            "scan": self.scan.lock().unwrap().view(),
            "settings": self.settings_view(&drives),
            // Playtime tracking (the watcher) arrives with stage 4.
            "playing": [],
            "sessions": sessions,
            "gaps": gaps,
            "watch": { "running": false, "gpuCounters": false, "trackingSince": runs.first().map(|r| iso_ms(r.start)) },
        }))
    }

    fn settings_view(&self, drives: &[DriveInfo]) -> Value {
        let s = self.settings.lock().unwrap();
        let suggested = self.suggested.get_or_init(|| suggest_roots(&self.ctx));
        json!({
            "theme": s.theme,
            "palette": if PALETTES.contains(&s.palette.as_str()) { s.palette.as_str() } else { "sunset" },
            "heroStyle": if s.hero_style == "ring" { "ring" } else { "wheel" },
            "scanRoots": s.scan_roots.iter().map(|r| json!({ "path": r, "reachable": Path::new(r).is_dir() })).collect::<Vec<_>>(),
            "suggestedRoots": suggested.iter().filter(|g| !s.scan_roots.iter().any(|r| path_key(r) == path_key(g))).collect::<Vec<_>>(),
            "drives": drives.iter().map(|d| &d.root).collect::<Vec<_>>(),
            "runtimeDetection": s.runtime_detection,
            "watchFolders": s.watch_folders,
            "startWithWindows": false,
            "closeToTray": s.close_to_tray,
            "webArt": s.web_art,
            "hasSteamGridDbKey": s.steam_grid_db_key.as_deref().is_some_and(|k| !k.trim().is_empty()),
            "dataDir": self.paths.data_dir.to_string_lossy(),
        })
    }

    fn game_view(&self, g: &GameRow, installs: &[&InstallRow]) -> Value {
        let mut sources = Vec::new();
        for i in installs {
            if !sources.contains(&i.source) {
                sources.push(i.source);
            }
        }
        json!({
            "id": g.id,
            "title": g.title,
            "sources": sources,
            "installed": g.installed,
            "hidden": g.hidden,
            "sizeBytes": g.size_bytes,
            "copies": g.installed_copies,
            "playSeconds": g.play_seconds(),
            "trackedSeconds": g.total_seconds,
            "importedSeconds": g.imported_seconds,
            "lastPlayed": g.last_played_any().map(iso_ms),
            "firstSeen": iso_ms(g.first_seen),
            "path": g.primary_path,
            "canLaunch": installs.iter().any(|i| launching::can_launch(i)),
            "genres": [],
            "year": null,
            "coverUrl": self.art_url(g.id, ArtKind::Cover),
            "heroUrl": self.art_url(g.id, ArtKind::Hero),
            "logoUrl": self.art_url(g.id, ArtKind::Logo),
            "iconUrl": self.art_url(g.id, ArtKind::Icon),
        })
    }

    fn game_detail(&self, id: i64) -> rusqlite::Result<Option<Value>> {
        let Some(row) = self.library.game(id)? else { return Ok(None) };
        let installs = self.library.installs_for(id)?;
        let refs: Vec<&InstallRow> = installs.iter().collect();
        Ok(Some(json!({
            "game": self.game_view(&row, &refs),
            "installs": installs.iter().map(|i| json!({
                "id": i.id, "source": i.source, "path": i.install_path, "launchExe": i.launch_exe, "state": i.state,
                "sizeBytes": i.size_bytes, "confidence": i.confidence, "signals": i.signals, "uninstallLabel": launching::uninstall_label(i),
            })).collect::<Vec<_>>(),
            "sessions": self.sessions.sessions(Some(id), None, 5000)?.iter().map(session_view).collect::<Vec<_>>(),
        })))
    }

    // ── Commands ────────────────────────────────────────────────────────────────────────────────────

    pub fn launch(&self, game_id: i64) {
        let installs = self.library.installs_for(game_id).unwrap_or_default();
        let Some(pick) = launching::pick(&installs) else {
            self.notice("error", "Shelf doesn't know how to start this game. Open its folder and run it once — Shelf will remember it.");
            return;
        };
        let r = launching::launch(pick);
        if r.ok {
            self.notice("info", format!("{}…", r.message));
        } else {
            self.notice("error", r.message);
        }
    }

    pub fn uninstall(&self, install_id: i64) {
        if let Ok(Some(i)) = self.library.install(install_id) {
            let r = launching::uninstall(&i);
            self.notice(if r.ok { "info" } else { "error" }, r.message);
        }
    }

    pub fn set_hidden(self: &Arc<Self>, game_id: i64, hidden: bool) {
        self.report(self.library.set_hidden(game_id, hidden));
        self.changed();
        self.game_changed(game_id);
    }

    pub fn rename(self: &Arc<Self>, game_id: i64, title: &str) {
        if title.trim().is_empty() {
            return;
        }
        self.report(self.library.rename(game_id, title));
        self.changed();
        self.game_changed(game_id);
    }

    pub fn accept(self: &Arc<Self>, detection_id: i64, title: Option<&str>) {
        match self.library.accept_detection(detection_id, title, now_ms()) {
            Ok(id) => {
                let name = self.library.game_title(id).ok().flatten().unwrap_or_default();
                self.notice_to("success", format!("Added {name} to your shelf"), None, Some(id));
            }
            Err(e) => self.notice("error", format!("Couldn't add it: {e}")),
        }
        self.changed();
    }

    pub fn reject(self: &Arc<Self>, detection_id: i64) {
        if let Err(e) = self.library.reject_detection(detection_id, now_ms()) {
            self.notice("error", format!("Couldn't dismiss it: {e}"));
        }
        self.changed();
    }

    /// Exes dropped on the window or picked in the file dialog; folders dropped are searched once.
    pub fn add_paths(self: &Arc<Self>, paths: Vec<String>) {
        for p in paths {
            let name = Path::new(&p).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.clone());
            if Path::new(&p).is_dir() {
                self.scan_once(normalize(&p));
                continue;
            }
            if !p.to_ascii_lowercase().ends_with(".exe") {
                self.notice("error", format!("{name} isn't a program — drop the game's .exe (or its folder)."));
                continue;
            }
            match self.library.add_manual(&p, None, now_ms(), true) {
                Ok(id) => {
                    let title = self.library.game_title(id).ok().flatten().unwrap_or_default();
                    self.notice_to("success", format!("Added {title} — playtime is tracked from now on"), None, Some(id));
                }
                Err(e) => self.notice("error", format!("Couldn't add {name}: {e}")),
            }
        }
        self.changed();
    }

    pub fn add_root(self: &Arc<Self>, path: &str) {
        let p = normalize(path);
        if !Path::new(&p).is_dir() {
            return;
        }
        {
            let mut s = self.settings.lock().unwrap();
            if s.scan_roots.iter().any(|r| path_key(r) == path_key(&p)) {
                return;
            }
            s.scan_roots.push(p.clone());
        }
        self.save_settings();
        self.changed();
        self.scan_once(p);
    }

    pub fn remove_root(self: &Arc<Self>, path: &str) {
        self.settings.lock().unwrap().scan_roots.retain(|r| path_key(r) != path_key(path));
        self.save_settings();
        self.changed();
    }

    pub fn update_settings(self: &Arc<Self>, patch: &Value) {
        let text = |k: &str| patch.get(k).and_then(Value::as_str);
        let flag = |k: &str| patch.get(k).and_then(Value::as_bool);
        let mut look_again = false;
        {
            let mut s = self.settings.lock().unwrap();
            if let Some(wa) = flag("webArt") {
                look_again = wa && !s.web_art;
                s.web_art = wa;
            }
            if let Some(key) = text("steamGridDbKey") {
                let key = key.trim();
                s.steam_grid_db_key = (!key.is_empty()).then(|| key.to_string());
                look_again |= !key.is_empty();
            }
            if let Some(t) = text("theme").filter(|t| ["system", "light", "dark"].contains(t)) {
                s.theme = t.into();
            }
            if let Some(h) = text("heroStyle").filter(|h| ["wheel", "ring"].contains(h)) {
                s.hero_style = h.into();
            }
            if let Some(p) = text("palette").filter(|p| PALETTES.contains(p)) {
                s.palette = p.into();
            }
            if let Some(v) = flag("runtimeDetection") {
                s.runtime_detection = v;
            }
            if let Some(v) = flag("watchFolders") {
                s.watch_folders = v;
            }
            if let Some(v) = flag("closeToTray") {
                s.close_to_tray = v;
            }
        }
        if flag("startWithWindows").is_some() {
            self.notice("info", "Starting with Windows comes to the Rust build in its next stage.");
        }
        self.save_settings();
        self.changed();
        if look_again {
            self.start_web_art();
        }
    }

    pub fn open_folder(&self, path: &str) {
        if Path::new(path).is_dir() {
            let _ = std::process::Command::new("explorer.exe").arg(path).spawn();
        } else {
            self.notice("error", format!("Folder not found: {path}"));
        }
    }

    pub fn reveal(&self, path: &str) {
        use std::os::windows::process::CommandExt;
        if Path::new(path).exists() {
            let _ = std::process::Command::new("explorer.exe").raw_arg(format!("/select,\"{path}\"")).spawn();
        } else {
            self.notice("error", format!("Not found any more: {path}"));
        }
    }

    pub fn open_data_folder(&self) {
        let _ = std::fs::create_dir_all(&self.paths.data_dir);
        let _ = std::process::Command::new("explorer.exe").arg(&self.paths.data_dir).spawn();
    }

    fn save_settings(&self) {
        let r = self.settings.lock().unwrap().save(&self.paths);
        if let Err(e) = r {
            self.notice("error", format!("Couldn't save settings: {e}"));
        }
    }

    fn report<E: std::fmt::Display>(&self, r: Result<(), E>) {
        if let Err(e) = r {
            self.notice("error", format!("Something went wrong: {e}"));
        }
    }
}

fn session_view(s: &SessionRow) -> Value {
    json!({
        "id": s.id, "gameId": s.game_id, "title": s.title, "start": iso_ms(s.start), "end": s.end.map(iso_ms),
        "seconds": s.seconds(), "reason": s.end_reason,
    })
}

/// `C:\Games\Hades` → `C:\`.
fn drive_of(path: &str) -> String {
    let p = path.to_uppercase();
    match p.get(..3) {
        Some(root) if root.ends_with(":\\") => root.to_string(),
        _ => String::new(),
    }
}
