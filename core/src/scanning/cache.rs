//! Per-folder results that make re-scans incremental: a game root whose modified time hasn't changed (and whose exe is
//! still there) is reused without listing it or re-adding its size.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use super::classifier::VerdictKind;
use crate::platform::{is_same_or_inside, path_key};

/// What Shelf decided about a folder last time, valid while the folder's modified time is unchanged.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanCacheEntry {
    /// The folder's modified time, in 100 ns units since 1970.
    pub dir_stamp: i64,
    pub kind: CachedKind,
    pub score: i32,
    pub signals: Vec<String>,
    pub title: Option<String>,
    pub launch_exe: Option<String>,
    pub play_exes: Vec<String>,
    pub size_bytes: Option<i64>,
    /// Unix seconds.
    pub size_measured: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CachedKind {
    Game,
    Installer,
}

impl From<CachedKind> for VerdictKind {
    fn from(k: CachedKind) -> Self {
        match k {
            CachedKind::Game => VerdictKind::Game,
            CachedKind::Installer => VerdictKind::Installer,
        }
    }
}

/// A folder's modified time as a cache stamp (100 ns units since 1970; 0 when unknown).
pub fn stamp(t: Option<SystemTime>) -> i64 {
    t.and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok()).map(|d| (d.as_nanos() / 100) as i64).unwrap_or(0)
}

/// Thread-safe map from folder key to its last verdict.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ScanCache {
    entries: Mutex<HashMap<String, ScanCacheEntry>>,
}

impl ScanCache {
    pub fn get(&self, path: &str) -> Option<ScanCacheEntry> {
        self.entries.lock().unwrap().get(&path_key(path)).cloned()
    }

    pub fn contains(&self, path: &str) -> bool {
        self.entries.lock().unwrap().contains_key(&path_key(path))
    }

    /// The entry, if the folder's modified time still matches.
    pub fn fresh(&self, path: &str, dir_stamp: i64) -> Option<ScanCacheEntry> {
        self.get(path).filter(|e| e.dir_stamp == dir_stamp)
    }

    pub fn set(&self, path: &str, entry: ScanCacheEntry) {
        self.entries.lock().unwrap().insert(path_key(path), entry);
    }

    pub fn keys(&self) -> Vec<String> {
        self.entries.lock().unwrap().keys().cloned().collect()
    }

    pub fn len(&self) -> usize {
        self.entries.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Drops entries under `root` that the last complete scan didn't see (deleted or moved games).
    pub fn prune(&self, root: &str, touched: &HashSet<String>) -> usize {
        let mut map = self.entries.lock().unwrap();
        let before = map.len();
        map.retain(|k, _| !is_same_or_inside(k, root) || touched.contains(k));
        before - map.len()
    }
}
