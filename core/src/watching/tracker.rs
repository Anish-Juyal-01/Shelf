//! Turns "which games are running now" observations into sessions. Pure logic over a store and the times it's given,
//! so every edge case (sleep, crash, restarts, short launches) is tested with made-up times. Not thread-safe: the
//! watcher calls it from one thread.

use std::collections::BTreeMap;

use crate::storage::sessions::SessionStore;

#[derive(Debug, Clone)]
pub struct TrackerOptions {
    /// A game must be gone this long before its session ends (covers launcher → game handoffs and restarts).
    pub grace_ms: i64,
    /// How often open sessions are stamped; a crash loses at most this much.
    pub heartbeat_ms: i64,
    /// Sessions shorter than this (a launcher flashing past, a crash on start) aren't kept.
    pub min_session_ms: i64,
    /// A gap between polls longer than this means the PC slept (even if no power event arrived).
    pub sleep_gap_ms: i64,
}

impl Default for TrackerOptions {
    fn default() -> Self {
        Self { grace_ms: 15_000, heartbeat_ms: 60_000, min_session_ms: 10_000, sleep_gap_ms: 90_000 }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunningGame {
    pub game_id: i64,
    pub pid: u32,
    pub exe_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionEventKind {
    Started,
    Stopped,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionEvent {
    pub kind: SessionEventKind,
    pub game_id: i64,
    pub session_id: i64,
    pub start: i64,
    pub end: Option<i64>,
    pub reason: Option<String>,
}

impl SessionEvent {
    pub fn duration_ms(&self) -> Option<i64> {
        self.end.map(|e| e - self.start)
    }
}

struct Live {
    session_id: i64,
    start: i64,
    last_seen: i64,
}

pub struct SessionTracker {
    store: SessionStore,
    o: TrackerOptions,
    live: BTreeMap<i64, Live>,
    last_poll: Option<i64>,
    last_beat: Option<i64>,
}

impl SessionTracker {
    pub fn new(store: SessionStore, options: TrackerOptions) -> Self {
        Self { store, o: options, live: BTreeMap::new(), last_poll: None, last_beat: None }
    }

    /// Games being played right now and when each session started.
    pub fn playing(&self) -> Vec<(i64, i64)> {
        self.live.iter().map(|(&g, l)| (g, l.start)).collect()
    }

    pub fn observe(&mut self, running: &[RunningGame], now: i64) -> rusqlite::Result<Vec<SessionEvent>> {
        let mut events = Vec::new();
        if let Some(last) = self.last_poll {
            if now - last > self.o.sleep_gap_ms {
                // Asleep or suspended without telling us: whatever was running ended when we last saw it.
                self.close_all(last, "suspend", &mut events)?;
            }
        }

        for g in running {
            if let Some(live) = self.live.get_mut(&g.game_id) {
                live.last_seen = now;
                continue;
            }
            let id = self.store.open(g.game_id, g.exe_path.as_deref(), g.pid, now)?;
            self.live.insert(g.game_id, Live { session_id: id, start: now, last_seen: now });
            events.push(SessionEvent { kind: SessionEventKind::Started, game_id: g.game_id, session_id: id, start: now, end: None, reason: None });
        }

        let gone: Vec<i64> = self
            .live
            .iter()
            .filter(|(id, l)| !running.iter().any(|r| r.game_id == **id) && now - l.last_seen >= self.o.grace_ms)
            .map(|(&id, _)| id)
            .collect();
        for id in gone {
            let at = self.live[&id].last_seen;
            self.close(id, at, "clean", &mut events)?;
        }

        if !self.live.is_empty() && self.last_beat.is_none_or(|b| now - b >= self.o.heartbeat_ms) {
            let ids: Vec<i64> = self.live.values().map(|l| l.session_id).collect();
            self.store.heartbeat(&ids, now)?;
            self.last_beat = Some(now);
        }
        self.last_poll = Some(now);
        Ok(events)
    }

    /// The PC is going to sleep: end everything now.
    pub fn suspend(&mut self, now: i64) -> rusqlite::Result<Vec<SessionEvent>> {
        let mut events = Vec::new();
        self.close_all(now, "suspend", &mut events)?;
        self.last_poll = None;
        Ok(events)
    }

    /// Back from sleep: start fresh; games still running get new sessions on the next poll.
    pub fn resume(&mut self) {
        self.last_poll = None;
    }

    /// Shelf is exiting cleanly.
    pub fn shutdown(&mut self, now: i64) -> rusqlite::Result<Vec<SessionEvent>> {
        let mut events = Vec::new();
        self.close_all(now, "app_exit", &mut events)?;
        Ok(events)
    }

    fn close_all(&mut self, at: i64, reason: &str, events: &mut Vec<SessionEvent>) -> rusqlite::Result<()> {
        let ids: Vec<i64> = self.live.keys().copied().collect();
        for id in ids {
            self.close(id, at, reason, events)?;
        }
        Ok(())
    }

    fn close(&mut self, game_id: i64, end: i64, reason: &str, events: &mut Vec<SessionEvent>) -> rusqlite::Result<()> {
        let Some(live) = self.live.remove(&game_id) else { return Ok(()) };
        let end = end.max(live.start);
        let discard = end - live.start < self.o.min_session_ms;
        self.store.close(live.session_id, end, reason, discard)?;
        if !discard {
            events.push(SessionEvent {
                kind: SessionEventKind::Stopped,
                game_id,
                session_id: live.session_id,
                start: live.start,
                end: Some(end),
                reason: Some(reason.into()),
            });
        }
        Ok(())
    }
}
