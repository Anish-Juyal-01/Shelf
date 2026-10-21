//! Play sessions and watcher runs (when Shelf was tracking at all, so gaps can be shown honestly).

use rusqlite::{named_params, Connection, OptionalExtension};

use super::db::ShelfDb;

#[derive(Debug, Clone, PartialEq)]
pub struct SessionRow {
    pub id: i64,
    pub game_id: i64,
    pub title: String,
    /// Unix ms, like every time below.
    pub start: i64,
    pub end: Option<i64>,
    pub last_heartbeat: i64,
    pub end_reason: Option<String>,
}

impl SessionRow {
    /// Open sessions count up to their last heartbeat.
    pub fn seconds(&self) -> i64 {
        (self.end.unwrap_or(self.last_heartbeat) - self.start) / 1000
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenSession {
    pub id: i64,
    pub game_id: i64,
    pub start: i64,
    pub last_heartbeat: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WatcherRun {
    pub id: i64,
    pub start: i64,
    pub last_heartbeat: i64,
    pub end: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct SessionStore {
    pub db: ShelfDb,
}

impl SessionStore {
    pub fn new(db: ShelfDb) -> Self {
        Self { db }
    }

    pub fn open(&self, game_id: i64, exe_path: Option<&str>, pid: u32, start: i64) -> rusqlite::Result<i64> {
        let c = self.db.connect()?;
        c.execute(
            "INSERT INTO sessions (game_id, exe_path, pid, started, last_heartbeat) VALUES (?1, ?2, ?3, ?4, ?4)",
            rusqlite::params![game_id, exe_path, pid, start],
        )?;
        Ok(c.last_insert_rowid())
    }

    pub fn heartbeat(&self, session_ids: &[i64], now: i64) -> rusqlite::Result<()> {
        if session_ids.is_empty() {
            return Ok(());
        }
        let mut c = self.db.connect()?;
        let tx = c.transaction()?;
        for id in session_ids {
            tx.execute("UPDATE sessions SET last_heartbeat = ?1 WHERE id = ?2 AND ended IS NULL", [now, *id])?;
        }
        tx.commit()
    }

    pub fn close(&self, session_id: i64, end: i64, reason: &str, discard: bool) -> rusqlite::Result<()> {
        let mut c = self.db.connect()?;
        let tx = c.transaction()?;
        close_in(&tx, session_id, end, reason, discard)?;
        tx.commit()
    }

    pub fn open_sessions(&self) -> rusqlite::Result<Vec<OpenSession>> {
        let c = self.db.connect()?;
        let mut q = c.prepare("SELECT id, game_id, started, last_heartbeat FROM sessions WHERE ended IS NULL")?;
        let rows = q.query_map([], |r| Ok(OpenSession { id: r.get(0)?, game_id: r.get(1)?, start: r.get(2)?, last_heartbeat: r.get(3)? }))?;
        rows.collect()
    }

    /// After a crash, power cut or kill: sessions left open are closed at their last heartbeat, so at most one
    /// heartbeat interval of play is lost and nothing is counted twice. Returns how many were closed.
    pub fn recover_open_sessions(&self, min_seconds: i64) -> rusqlite::Result<usize> {
        let mut c = self.db.connect()?;
        let tx = c.transaction()?;
        let open: Vec<(i64, i64, i64)> = {
            let mut q = tx.prepare("SELECT id, started, last_heartbeat FROM sessions WHERE ended IS NULL")?;
            let rows = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for &(id, start, beat) in &open {
            close_in(&tx, id, beat, "heartbeat", (beat - start) / 1000 < min_seconds)?;
        }
        tx.execute("UPDATE watcher_runs SET ended = last_heartbeat WHERE ended IS NULL", [])?;
        tx.commit()?;
        Ok(open.len())
    }

    /// Newest first.
    pub fn sessions(&self, game_id: Option<i64>, since: Option<i64>, limit: i64) -> rusqlite::Result<Vec<SessionRow>> {
        let c = self.db.connect()?;
        let mut q = c.prepare(
            "SELECT s.id, s.game_id, g.title, s.started, s.ended, s.last_heartbeat, s.end_reason
             FROM sessions s JOIN games g ON g.id = s.game_id
             WHERE (:g IS NULL OR s.game_id = :g) AND (:since IS NULL OR s.started >= :since)
             ORDER BY s.started DESC LIMIT :limit",
        )?;
        let rows = q.query_map(named_params! { ":g": game_id, ":since": since, ":limit": limit }, |r| {
            Ok(SessionRow {
                id: r.get(0)?,
                game_id: r.get(1)?,
                title: r.get(2)?,
                start: r.get(3)?,
                end: r.get(4)?,
                last_heartbeat: r.get(5)?,
                end_reason: r.get(6)?,
            })
        })?;
        rows.collect()
    }

    // ── Watcher runs ────────────────────────────────────────────────────────────────────────────────

    pub fn start_run(&self, now: i64) -> rusqlite::Result<i64> {
        let c = self.db.connect()?;
        c.execute("INSERT INTO watcher_runs (started, last_heartbeat) VALUES (?1, ?1)", [now])?;
        Ok(c.last_insert_rowid())
    }

    pub fn heartbeat_run(&self, run_id: i64, now: i64) -> rusqlite::Result<()> {
        self.db.connect()?.execute("UPDATE watcher_runs SET last_heartbeat = ?1 WHERE id = ?2", [now, run_id])?;
        Ok(())
    }

    pub fn end_run(&self, run_id: i64, now: i64) -> rusqlite::Result<()> {
        self.db.connect()?.execute("UPDATE watcher_runs SET ended = ?1, last_heartbeat = ?1 WHERE id = ?2", [now, run_id])?;
        Ok(())
    }

    /// Oldest first.
    pub fn runs(&self, since: i64) -> rusqlite::Result<Vec<WatcherRun>> {
        let c = self.db.connect()?;
        let mut q = c.prepare("SELECT id, started, last_heartbeat, ended FROM watcher_runs WHERE last_heartbeat >= ?1 ORDER BY started")?;
        let rows = q.query_map([since], |r| Ok(WatcherRun { id: r.get(0)?, start: r.get(1)?, last_heartbeat: r.get(2)?, end: r.get(3)? }))?;
        rows.collect()
    }
}

fn close_in(c: &Connection, session_id: i64, end: i64, reason: &str, discard: bool) -> rusqlite::Result<()> {
    let Some((game_id, start)) = c
        .query_row("SELECT game_id, started FROM sessions WHERE id = ?1 AND ended IS NULL", [session_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))
        .optional()?
    else {
        return Ok(()); // already closed
    };
    if discard {
        c.execute("DELETE FROM sessions WHERE id = ?1", [session_id])?;
        return Ok(());
    }
    let end = end.max(start);
    c.execute(
        "UPDATE sessions SET ended = ?1, last_heartbeat = MAX(last_heartbeat, ?1), end_reason = ?2 WHERE id = ?3",
        rusqlite::params![end, reason, session_id],
    )?;
    c.execute(
        "UPDATE games SET total_seconds = total_seconds + ?1,
                          last_played = CASE WHEN last_played IS NULL OR last_played < ?2 THEN ?2 ELSE last_played END
         WHERE id = ?3",
        [(end - start) / 1000, end, game_id],
    )?;
    Ok(())
}
