//! Library persistence: syncing detection results in, user decisions (accept/reject/add/hide/rename), queries out.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use rusqlite::{named_params, Connection, OptionalExtension, Row};

use super::db::ShelfDb;
use crate::library::LibrarySnapshot;
use crate::model::{InstallRecord, SizeSource, SourceKind, SourceState};
use crate::naming;
use crate::platform::{normalize, path_key};
use crate::scanning::classifier::{evaluate_path, install_root_for, title_for, ClassifierOptions};
use crate::scanning::scanner::measure_size;

#[derive(Debug, Clone, PartialEq)]
pub struct GameRow {
    pub id: i64,
    pub key: String,
    pub title: String,
    pub hidden: bool,
    /// Unix ms, like every time below.
    pub first_seen: i64,
    pub last_played: Option<i64>,
    pub total_seconds: i64,
    pub imported_seconds: i64,
    pub imported_last_played: Option<i64>,
    pub installed: bool,
    pub size_bytes: i64,
    pub installed_copies: i64,
    pub sources: Vec<SourceKind>,
    pub primary_path: Option<String>,
}

impl GameRow {
    /// Shelf-measured time plus what the launcher had recorded before Shelf.
    pub fn play_seconds(&self) -> i64 {
        self.total_seconds + self.imported_seconds
    }

    pub fn last_played_any(&self) -> Option<i64> {
        self.last_played.max(self.imported_last_played)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct InstallRow {
    pub id: i64,
    pub game_id: i64,
    pub source: SourceKind,
    pub install_path: String,
    pub launch_exe: Option<String>,
    pub launch_uri: Option<String>,
    pub launch_args: Option<String>,
    pub working_dir: Option<String>,
    /// installed | missing | removed
    pub state: String,
    pub size_bytes: Option<i64>,
    pub uninstall_command: Option<String>,
    pub confidence: i64,
    pub signals: Vec<String>,
}

impl InstallRow {
    pub fn is_installed(&self) -> bool {
        self.state == "installed"
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DetectionRow {
    pub id: i64,
    pub path: String,
    pub exe: Option<String>,
    /// scan | installed_apps | runtime
    pub origin: String,
    pub confidence: i64,
    pub suggested_title: String,
    pub size_bytes: Option<i64>,
    pub signals: Vec<String>,
    pub found: i64,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SyncResult {
    pub new_games: Vec<String>,
    pub new_detections: usize,
    pub removed_installs: usize,
}

#[derive(Debug)]
pub enum StoreError {
    Db(rusqlite::Error),
    NotFound(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Db(e) => write!(f, "database error: {e}"),
            Self::NotFound(what) => write!(f, "{what} not found"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Db(e)
    }
}

fn json(list: &[String]) -> String {
    serde_json::to_string(list).unwrap_or_else(|_| "[]".into())
}

fn parse_list(s: Option<String>) -> Vec<String> {
    s.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

const DETECTION_SELECT: &str = "SELECT id, path, exe, origin, confidence, suggested_title, size_bytes, signals, found FROM detections";

const INSTALL_SELECT: &str = "SELECT id, game_id, source, install_path, launch_exe, launch_uri, launch_args, working_dir, state, size_bytes,
    uninstall_command, confidence, signals FROM installs";

fn read_detection(r: &Row) -> rusqlite::Result<DetectionRow> {
    Ok(DetectionRow {
        id: r.get(0)?,
        path: r.get(1)?,
        exe: r.get(2)?,
        origin: r.get(3)?,
        confidence: r.get(4)?,
        suggested_title: r.get(5)?,
        size_bytes: r.get(6)?,
        signals: parse_list(r.get(7)?),
        found: r.get(8)?,
    })
}

fn read_install(r: &Row) -> rusqlite::Result<InstallRow> {
    let source: String = r.get(2)?;
    Ok(InstallRow {
        id: r.get(0)?,
        game_id: r.get(1)?,
        source: SourceKind::from_db(&source).unwrap_or(SourceKind::Folder),
        install_path: r.get(3)?,
        launch_exe: r.get(4)?,
        launch_uri: r.get(5)?,
        launch_args: r.get(6)?,
        working_dir: r.get(7)?,
        state: r.get(8)?,
        size_bytes: r.get(9)?,
        uninstall_command: r.get(10)?,
        confidence: r.get(11)?,
        signals: parse_list(r.get(12)?),
    })
}

#[derive(Debug, Clone)]
pub struct LibraryStore {
    pub db: ShelfDb,
}

impl LibraryStore {
    pub fn new(db: ShelfDb) -> Self {
        Self { db }
    }

    // ── Sync ────────────────────────────────────────────────────────────────────────────────────────

    /// Writes a fresh snapshot. Game identity is sticky: if any install of a game is already known, the game keeps
    /// its row (and its playtime history) even if its title or grouping changed. Installs that disappear are only
    /// marked removed when their folder is really gone, so an unplugged drive or a launcher hiccup loses nothing.
    pub fn sync(&self, snap: &LibrarySnapshot, now: i64) -> rusqlite::Result<SyncResult> {
        let mut result = SyncResult::default();
        let mut c = self.db.connect()?;
        let tx = c.transaction()?;

        for game in &snap.games {
            let mut game_id: Option<i64> = None;
            for i in &game.installs {
                game_id = tx.query_row("SELECT game_id FROM installs WHERE path_key = ?1", [path_key(&i.install_path)], |r| r.get(0)).optional()?;
                if game_id.is_some() {
                    break;
                }
            }
            if game_id.is_none() {
                game_id = tx.query_row("SELECT id FROM games WHERE key = ?1", [&game.key], |r| r.get(0)).optional()?;
            }
            let game_id = match game_id {
                Some(id) => {
                    tx.execute("UPDATE games SET title = ?1 WHERE id = ?2 AND title_locked = 0", rusqlite::params![game.title, id])?;
                    id
                }
                None => {
                    result.new_games.push(game.title.clone());
                    insert_game(&tx, &game.key, &game.title, now)?
                }
            };
            tx.execute(
                "UPDATE games SET imported_seconds = MAX(imported_seconds, :s),
                                  imported_last_played = CASE WHEN :lp IS NULL THEN imported_last_played
                                      WHEN imported_last_played IS NULL OR :lp > imported_last_played THEN :lp
                                      ELSE imported_last_played END
                 WHERE id = :id",
                named_params! { ":s": game.imported_play_seconds(), ":lp": game.imported_last_played().map(|s| s * 1000), ":id": game_id },
            )?;
            for i in &game.installs {
                upsert_install(&tx, game_id, i, now)?;
            }
        }

        for r in &snap.review {
            let key = path_key(&r.install_path);
            // Accepted earlier: it's an install now; just refresh it.
            if tx.query_row("SELECT id FROM installs WHERE path_key = ?1", [&key], |r| r.get::<_, i64>(0)).optional()?.is_some() {
                tx.execute(
                    "UPDATE installs SET last_seen = :n, state = 'installed', size_bytes = COALESCE(:s, size_bytes) WHERE path_key = :k",
                    named_params! { ":n": now, ":s": r.size_bytes, ":k": key },
                )?;
                continue;
            }
            if is_ignored(&tx, &key)? {
                continue;
            }
            let origin = if r.source == SourceKind::InstalledApps { "installed_apps" } else { "scan" };
            let existed = tx.query_row("SELECT 1 FROM detections WHERE path_key = ?1", [&key], |_| Ok(())).optional()?.is_some();
            tx.execute(
                "INSERT INTO detections (path_key, path, exe, origin, signals, confidence, suggested_title, size_bytes, state, found, last_seen)
                 VALUES (:k, :p, :e, :o, :sig, :conf, :t, :s, 'pending', :n, :n)
                 ON CONFLICT(path_key) DO UPDATE SET exe = :e, signals = :sig, confidence = :conf, suggested_title = :t,
                     size_bytes = :s, last_seen = :n",
                named_params! {
                    ":k": key, ":p": r.install_path, ":e": r.launch_exe, ":o": origin, ":sig": json(&r.signals),
                    ":conf": r.confidence, ":t": r.title, ":s": r.size_bytes, ":n": now,
                },
            )?;
            if !existed {
                result.new_detections += 1;
            }
        }

        // Installs not reported this time: removed only if the folder is really gone. User-added ones are never
        // reported by a source, so they're checked the same way.
        let stale: Vec<(i64, String)> = {
            let mut q = tx.prepare("SELECT id, install_path FROM installs WHERE last_seen < ?1 AND state != 'removed'")?;
            let rows = q.query_map([now], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for (id, path) in stale {
            if Path::new(&path).is_dir() {
                continue;
            }
            tx.execute("UPDATE installs SET state = 'removed' WHERE id = ?1", [id])?;
            result.removed_installs += 1;
        }

        for s in &snap.sources {
            tx.execute(
                "INSERT INTO source_status (source, state, message, games_found, checked) VALUES (:s, :st, :m, :g, :n)
                 ON CONFLICT(source) DO UPDATE SET state = :st, message = :m, games_found = :g, checked = :n",
                named_params! { ":s": s.source.db_name(), ":st": format!("{:?}", s.state), ":m": s.message, ":g": s.installs.len() as i64, ":n": now },
            )?;
        }

        tx.commit()?;
        Ok(result)
    }

    // ── User decisions ──────────────────────────────────────────────────────────────────────────────

    /// Turns a Review/runtime detection into a library game. Returns the game id.
    pub fn accept_detection(&self, detection_id: i64, title: Option<&str>, now: i64) -> Result<i64, StoreError> {
        let mut c = self.db.connect()?;
        let tx = c.transaction()?;
        let d = tx
            .query_row(&format!("{DETECTION_SELECT} WHERE id = ?1"), [detection_id], read_detection)
            .optional()?
            .ok_or_else(|| StoreError::NotFound(format!("Detection #{detection_id}")))?;
        let source = match d.origin.as_str() {
            "runtime" => SourceKind::Runtime,
            "installed_apps" => SourceKind::InstalledApps,
            _ => SourceKind::Folder,
        };
        let title = title.map(str::trim).filter(|t| !t.is_empty());
        let mut record = InstallRecord::new(source, title.unwrap_or(&d.suggested_title), d.path.clone());
        record.launch_exe = d.exe.clone();
        record.working_dir = d.exe.as_deref().and_then(parent_dir);
        record.size_bytes = d.size_bytes;
        record.size_source = if d.size_bytes.is_some() { SizeSource::Measured } else { SizeSource::Unknown };
        record.confidence = 100;
        record.signals = d.signals.iter().cloned().chain(["Confirmed by you".to_string()]).collect();
        record.play_exes.extend(d.exe.clone());
        let game_id = add_install(&tx, &record, now, title.is_some())?;
        tx.execute("UPDATE detections SET state = 'accepted' WHERE id = ?1", [detection_id])?;
        tx.commit()?;
        Ok(game_id)
    }

    /// "Not a game": never suggested again.
    pub fn reject_detection(&self, detection_id: i64, now: i64) -> Result<(), StoreError> {
        let mut c = self.db.connect()?;
        let tx = c.transaction()?;
        let (key, exe): (String, Option<String>) = tx
            .query_row("SELECT path_key, exe FROM detections WHERE id = ?1", [detection_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?
            .ok_or_else(|| StoreError::NotFound(format!("Detection #{detection_id}")))?;
        ignore(&tx, &key, now)?;
        if let Some(exe) = exe {
            ignore(&tx, &path_key(&exe), now)?;
        }
        tx.execute("UPDATE detections SET state = 'rejected' WHERE id = ?1", [detection_id])?;
        tx.commit()?;
        Ok(())
    }

    /// Manual add (an exe dropped on the window or picked). Returns the game id.
    pub fn add_manual(&self, exe_path: &str, title: Option<&str>, now: i64, measure: bool) -> Result<i64, StoreError> {
        let exe = normalize(exe_path);
        if !Path::new(&exe).is_file() {
            return Err(StoreError::NotFound(exe));
        }
        let root = install_root_for(&exe);
        let verdict = evaluate_path(&root, &ClassifierOptions::default());
        let title = title.map(str::trim).filter(|t| !t.is_empty());
        let mut record = InstallRecord::new(SourceKind::Manual, title.map(String::from).unwrap_or_else(|| title_for(&root, Some(&exe))), root.clone());
        record.launch_exe = Some(exe.clone());
        record.working_dir = parent_dir(&exe);
        record.confidence = 100;
        record.signals = vec!["Added by you".into()];
        if measure {
            record.size_bytes = Some(measure_size(&root, &AtomicBool::new(false)) as i64);
            record.size_source = SizeSource::Measured;
        }
        record.play_exes.push(exe.clone());
        for e in verdict.play_exes {
            if !record.play_exes.iter().any(|p| p.eq_ignore_ascii_case(&e)) {
                record.play_exes.push(e);
            }
        }

        let mut c = self.db.connect()?;
        let tx = c.transaction()?;
        tx.execute("DELETE FROM ignored WHERE key IN (?1, ?2)", [path_key(&root), path_key(&exe)])?;
        let id = add_install(&tx, &record, now, title.is_some())?;
        tx.commit()?;
        Ok(id)
    }

    pub fn set_hidden(&self, game_id: i64, hidden: bool) -> rusqlite::Result<()> {
        self.db.connect()?.execute("UPDATE games SET hidden = ?1 WHERE id = ?2", rusqlite::params![hidden as i64, game_id])?;
        Ok(())
    }

    pub fn rename(&self, game_id: i64, title: &str) -> rusqlite::Result<()> {
        self.db.connect()?.execute("UPDATE games SET title = ?1, title_locked = 1 WHERE id = ?2", rusqlite::params![title.trim(), game_id])?;
        Ok(())
    }

    pub fn is_ignored(&self, key: &str) -> rusqlite::Result<bool> {
        is_ignored(&self.db.connect()?, key)
    }

    /// Records a "looks like you're playing X" suggestion. Returns the detection id, or `None` if this exe was
    /// already suggested, rejected or is already in the library.
    pub fn add_runtime_detection(&self, exe_path: &str, title: &str, signals: &[String], now: i64) -> rusqlite::Result<Option<i64>> {
        let exe = normalize(exe_path);
        let root = install_root_for(&exe);
        let (exe_key, root_key) = (path_key(&exe), path_key(&root));
        let mut c = self.db.connect()?;
        let tx = c.transaction()?;
        if is_ignored(&tx, &exe_key)? || is_ignored(&tx, &root_key)? {
            return Ok(None);
        }
        if tx.query_row("SELECT 1 FROM game_exes WHERE exe_key = ?1", [&exe_key], |_| Ok(())).optional()?.is_some() {
            return Ok(None);
        }
        if tx.query_row("SELECT 1 FROM detections WHERE path_key = ?1 AND origin = 'runtime'", [&root_key], |_| Ok(())).optional()?.is_some() {
            return Ok(None);
        }
        tx.execute(
            "INSERT INTO detections (path_key, path, exe, origin, signals, confidence, suggested_title, state, found, last_seen)
             VALUES (:k, :p, :e, 'runtime', :sig, 60, :t, 'pending', :n, :n)
             ON CONFLICT(path_key) DO UPDATE SET origin = 'runtime', exe = :e, signals = :sig, suggested_title = :t, state = 'pending', last_seen = :n",
            named_params! { ":k": root_key, ":p": root, ":e": exe, ":sig": json(signals), ":t": title, ":n": now },
        )?;
        let id = tx.query_row("SELECT id FROM detections WHERE path_key = ?1", [&root_key], |r| r.get(0))?;
        tx.commit()?;
        Ok(Some(id))
    }

    // ── Queries ─────────────────────────────────────────────────────────────────────────────────────

    pub fn games(&self, include_hidden: bool) -> rusqlite::Result<Vec<GameRow>> {
        let c = self.db.connect()?;
        let mut q = c.prepare(
            "SELECT g.id, g.key, g.title, g.hidden, g.first_seen, g.last_played, g.total_seconds, g.imported_seconds, g.imported_last_played,
                    SUM(CASE WHEN i.state = 'installed' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN i.state = 'installed' THEN COALESCE(i.size_bytes, 0) ELSE 0 END),
                    GROUP_CONCAT(DISTINCT i.source),
                    (SELECT install_path FROM installs p WHERE p.game_id = g.id ORDER BY p.state = 'installed' DESC, p.id LIMIT 1)
             FROM games g LEFT JOIN installs i ON i.game_id = g.id
             WHERE ?1 = 1 OR g.hidden = 0
             GROUP BY g.id
             HAVING COUNT(i.id) > 0 OR g.total_seconds > 0
             ORDER BY g.title COLLATE NOCASE",
        )?;
        let rows = q.query_map([include_hidden as i64], |r| {
            let copies: Option<i64> = r.get(9)?;
            let sources: Option<String> = r.get(11)?;
            Ok(GameRow {
                id: r.get(0)?,
                key: r.get(1)?,
                title: r.get(2)?,
                hidden: r.get::<_, i64>(3)? == 1,
                first_seen: r.get(4)?,
                last_played: r.get(5)?,
                total_seconds: r.get(6)?,
                imported_seconds: r.get(7)?,
                imported_last_played: r.get(8)?,
                installed: copies.unwrap_or(0) > 0,
                size_bytes: r.get::<_, Option<i64>>(10)?.unwrap_or(0),
                installed_copies: copies.unwrap_or(0),
                sources: sources.map(|s| s.split(',').filter_map(SourceKind::from_db).collect()).unwrap_or_default(),
                primary_path: r.get(12)?,
            })
        })?;
        rows.collect()
    }

    pub fn game(&self, id: i64) -> rusqlite::Result<Option<GameRow>> {
        Ok(self.games(true)?.into_iter().find(|g| g.id == id))
    }

    pub fn installs(&self, installed_only: bool) -> rusqlite::Result<Vec<InstallRow>> {
        let c = self.db.connect()?;
        let mut q = c.prepare(&format!("{INSTALL_SELECT} WHERE ?1 = 1 OR state = 'installed'"))?;
        let rows = q.query_map([(!installed_only) as i64], read_install)?;
        rows.collect()
    }

    /// Every install of one game, installed first.
    pub fn installs_for(&self, game_id: i64) -> rusqlite::Result<Vec<InstallRow>> {
        let c = self.db.connect()?;
        let mut q = c.prepare(&format!("{INSTALL_SELECT} WHERE game_id = ?1 ORDER BY state = 'installed' DESC, id"))?;
        let rows = q.query_map([game_id], read_install)?;
        rows.collect()
    }

    pub fn install(&self, install_id: i64) -> rusqlite::Result<Option<InstallRow>> {
        self.db.connect()?.query_row(&format!("{INSTALL_SELECT} WHERE id = ?1"), [install_id], read_install).optional()
    }

    /// Known game exes (path key → game id), for matching running processes.
    pub fn game_exes(&self) -> rusqlite::Result<Vec<(String, i64)>> {
        let c = self.db.connect()?;
        let mut q = c.prepare("SELECT e.exe_key, e.game_id FROM game_exes e JOIN games g ON g.id = e.game_id")?;
        let rows = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect()
    }

    /// What each launcher reader reported last time, for honest status in Settings. Installs hold only the count.
    pub fn source_statuses(&self) -> rusqlite::Result<Vec<(SourceKind, SourceState, String, i64)>> {
        let c = self.db.connect()?;
        let mut q = c.prepare("SELECT source, state, message, games_found FROM source_status")?;
        let rows = q.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?)))?;
        let mut list: Vec<_> = rows
            .filter_map(Result::ok)
            .filter_map(|(k, s, m, n)| Some((SourceKind::from_db(&k)?, SourceState::from_db(&s)?, m, n)))
            .collect();
        list.sort_by_key(|s| s.0);
        Ok(list)
    }

    pub fn pending_detections(&self) -> rusqlite::Result<Vec<DetectionRow>> {
        let c = self.db.connect()?;
        let mut q = c.prepare(&format!("{DETECTION_SELECT} WHERE state = 'pending' ORDER BY origin = 'runtime' DESC, confidence DESC"))?;
        let rows = q.query_map([], read_detection)?;
        rows.collect()
    }

    pub fn game_title(&self, game_id: i64) -> rusqlite::Result<Option<String>> {
        self.db.connect()?.query_row("SELECT title FROM games WHERE id = ?1", [game_id], |r| r.get(0)).optional()
    }
}

fn parent_dir(path: &str) -> Option<String> {
    Path::new(path).parent().map(|p| p.to_string_lossy().into_owned())
}

fn insert_game(c: &Connection, key: &str, title: &str, now: i64) -> rusqlite::Result<i64> {
    // Two different games can clean to the same key only through a user rename; keep keys unique regardless.
    let mut unique = key.to_string();
    let mut n = 2;
    while c.query_row("SELECT 1 FROM games WHERE key = ?1", [&unique], |_| Ok(())).optional()?.is_some() {
        unique = format!("{key}#{n}");
        n += 1;
    }
    c.execute("INSERT INTO games (key, title, first_seen) VALUES (?1, ?2, ?3)", rusqlite::params![unique, title, now])?;
    Ok(c.last_insert_rowid())
}

fn upsert_install(c: &Connection, game_id: i64, i: &InstallRecord, now: i64) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO installs (game_id, source, source_key, install_path, path_key, launch_exe, working_dir, launch_uri, launch_args,
                               uninstall_command, size_bytes, size_source, state, confidence, signals, first_seen, last_seen)
         VALUES (:g, :src, :sk, :p, :k, :exe, :wd, :uri, :args, :un, :size, :ss, :state, :conf, :sig, :n, :n)
         ON CONFLICT(path_key) DO UPDATE SET
             game_id = :g, source = :src, source_key = :sk, install_path = :p,
             launch_exe = COALESCE(:exe, launch_exe), working_dir = COALESCE(:wd, working_dir),
             launch_uri = COALESCE(:uri, launch_uri), launch_args = COALESCE(:args, launch_args),
             uninstall_command = COALESCE(:un, uninstall_command),
             size_bytes = COALESCE(:size, size_bytes), size_source = CASE WHEN :size IS NULL THEN size_source ELSE :ss END,
             state = :state, confidence = MAX(confidence, :conf), signals = :sig, last_seen = :n",
        named_params! {
            ":g": game_id, ":src": i.source.db_name(), ":sk": i.source_key, ":p": i.install_path, ":k": path_key(&i.install_path),
            ":exe": i.launch_exe, ":wd": i.working_dir, ":uri": i.launch_uri, ":args": i.launch_args, ":un": i.uninstall_command,
            ":size": i.size_bytes, ":ss": format!("{:?}", i.size_source), ":state": if i.is_installed { "installed" } else { "missing" },
            ":conf": i.confidence, ":sig": json(&i.signals), ":n": now,
        },
    )?;
    let mut seen: Vec<&String> = Vec::new();
    for exe in i.play_exes.iter().chain(i.launch_exe.iter()) {
        if seen.iter().any(|s| s.eq_ignore_ascii_case(exe)) {
            continue;
        }
        seen.push(exe);
        c.execute(
            "INSERT INTO game_exes (exe_key, exe_path, game_id) VALUES (?1, ?2, ?3)
             ON CONFLICT(exe_key) DO UPDATE SET exe_path = ?2, game_id = ?3",
            rusqlite::params![path_key(exe), exe, game_id],
        )?;
    }
    Ok(())
}

fn add_install(c: &Connection, record: &InstallRecord, now: i64, lock_title: bool) -> rusqlite::Result<i64> {
    let key = naming::key(&record.title);
    let existing = match c.query_row("SELECT game_id FROM installs WHERE path_key = ?1", [path_key(&record.install_path)], |r| r.get(0)).optional()? {
        Some(id) => Some(id),
        None => c.query_row("SELECT id FROM games WHERE key = ?1", [&key], |r| r.get(0)).optional()?,
    };
    let game_id = match existing {
        Some(id) => id,
        None => insert_game(c, &key, &record.title, now)?,
    };
    if lock_title {
        c.execute("UPDATE games SET title = ?1, title_locked = 1 WHERE id = ?2", rusqlite::params![record.title, game_id])?;
    }
    upsert_install(c, game_id, record, now)?;
    Ok(game_id)
}

fn ignore(c: &Connection, key: &str, now: i64) -> rusqlite::Result<()> {
    c.execute("INSERT OR IGNORE INTO ignored (key, added) VALUES (?1, ?2)", rusqlite::params![key, now])?;
    Ok(())
}

fn is_ignored(c: &Connection, key: &str) -> rusqlite::Result<bool> {
    Ok(c.query_row("SELECT 1 FROM ignored WHERE key = ?1", [key], |_| Ok(())).optional()?.is_some())
}
