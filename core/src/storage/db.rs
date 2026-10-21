//! Shelf's database (`%APPDATA%\Shelf\shelf.db`, WAL). Timestamps are unix milliseconds (UTC). Connections are
//! short-lived; SQLite serialises writers, and every multi-row write runs in a transaction. The schema is the C#
//! build's, unchanged.

use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::Connection;

use super::ShelfPaths;

pub const SCHEMA_VERSION: i32 = 1;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS games (
    id                       INTEGER PRIMARY KEY,
    key                      TEXT NOT NULL UNIQUE,
    title                    TEXT NOT NULL,
    title_locked             INTEGER NOT NULL DEFAULT 0,
    hidden                   INTEGER NOT NULL DEFAULT 0,
    first_seen               INTEGER NOT NULL,
    last_played              INTEGER,
    total_seconds            INTEGER NOT NULL DEFAULT 0,
    imported_seconds         INTEGER NOT NULL DEFAULT 0,
    imported_last_played     INTEGER
);
CREATE TABLE IF NOT EXISTS installs (
    id                INTEGER PRIMARY KEY,
    game_id           INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    source            TEXT NOT NULL,
    source_key        TEXT,
    install_path      TEXT NOT NULL,
    path_key          TEXT NOT NULL UNIQUE,
    launch_exe        TEXT,
    working_dir       TEXT,
    launch_uri        TEXT,
    launch_args       TEXT,
    uninstall_command TEXT,
    size_bytes        INTEGER,
    size_source       TEXT,
    state             TEXT NOT NULL,      -- installed | missing | removed
    confidence        INTEGER NOT NULL,
    signals           TEXT,
    first_seen        INTEGER NOT NULL,
    last_seen         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_installs_game ON installs(game_id);
CREATE TABLE IF NOT EXISTS game_exes (
    exe_key   TEXT PRIMARY KEY,
    exe_path  TEXT NOT NULL,
    game_id   INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS sessions (
    id              INTEGER PRIMARY KEY,
    game_id         INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    exe_path        TEXT,
    pid             INTEGER,
    started         INTEGER NOT NULL,
    ended           INTEGER,
    last_heartbeat  INTEGER NOT NULL,
    end_reason      TEXT                  -- clean | heartbeat | suspend | app_exit
);
CREATE INDEX IF NOT EXISTS ix_sessions_game ON sessions(game_id, started);
CREATE INDEX IF NOT EXISTS ix_sessions_started ON sessions(started);
CREATE TABLE IF NOT EXISTS detections (
    id              INTEGER PRIMARY KEY,
    path_key        TEXT NOT NULL UNIQUE,
    path            TEXT NOT NULL,
    exe             TEXT,
    origin          TEXT NOT NULL,        -- scan | installed_apps | runtime
    signals         TEXT,
    confidence      INTEGER NOT NULL,
    suggested_title TEXT NOT NULL,
    size_bytes      INTEGER,
    state           TEXT NOT NULL,        -- pending | accepted | rejected
    found           INTEGER NOT NULL,
    last_seen       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ignored (
    key    TEXT PRIMARY KEY,              -- path key of a folder or exe the user said isn't a game
    added  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS source_status (
    source      TEXT PRIMARY KEY,
    state       TEXT NOT NULL,
    message     TEXT NOT NULL,
    games_found INTEGER NOT NULL,
    checked     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS watcher_runs (
    id              INTEGER PRIMARY KEY,
    started         INTEGER NOT NULL,
    last_heartbeat  INTEGER NOT NULL,
    ended           INTEGER
);
";

#[derive(Debug, Clone)]
pub struct ShelfDb {
    path: PathBuf,
}

impl ShelfDb {
    pub fn open(path: impl AsRef<Path>) -> rusqlite::Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let db = Self { path };
        db.migrate()?;
        Ok(db)
    }

    pub fn open_in(paths: &ShelfPaths) -> rusqlite::Result<Self> {
        Self::open(paths.db_file())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn connect(&self) -> rusqlite::Result<Connection> {
        let c = Connection::open(&self.path)?;
        c.busy_timeout(Duration::from_secs(10))?;
        c.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(c)
    }

    fn migrate(&self) -> rusqlite::Result<()> {
        let mut c = self.connect()?;
        c.query_row("PRAGMA journal_mode = WAL;", [], |_| Ok(()))?;
        let version: i32 = c.query_row("PRAGMA user_version;", [], |r| r.get(0))?;
        if version >= SCHEMA_VERSION {
            return Ok(());
        }
        let tx = c.transaction()?;
        tx.execute_batch(SCHEMA)?;
        tx.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
        tx.commit()
    }
}
