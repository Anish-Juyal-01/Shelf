//! Watches the scan folders for new downloads (event-driven, no polling). Any change is attributed to the top-level
//! entry it happened under (`Downloads\Some Game`), and that entry is reported once nothing in it has changed for a
//! quiet period — a 30 GB extraction isn't judged half-way through.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use notify::{EventKind, RecursiveMode, Watcher};

use super::Clock;
use crate::platform::{normalize, path_key};

/// Remembers when each path last changed and hands it back once it has been quiet long enough.
#[derive(Debug, Default)]
pub struct SettleQueue {
    pending: Mutex<HashMap<String, (String, i64)>>,
}

impl SettleQueue {
    pub fn touch(&self, path: &str, now: i64) {
        self.pending.lock().unwrap().insert(path_key(path), (path.to_string(), now));
    }

    pub fn len(&self) -> usize {
        self.pending.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn take_settled(&self, now: i64, quiet_ms: i64) -> Vec<String> {
        let mut pending = self.pending.lock().unwrap();
        let due: Vec<String> = pending.iter().filter(|(_, (_, last))| now - last >= quiet_ms).map(|(k, _)| k.clone()).collect();
        let mut out: Vec<String> = due.into_iter().filter_map(|k| pending.remove(&k)).map(|(p, _)| p).collect();
        out.sort();
        out
    }
}

/// `D:\Downloads` + `D:\Downloads\Game\bin\a.dll` → `D:\Downloads\Game`. Download temp files are ignored; the final
/// rename brings the real name.
pub fn top_level(root: &str, full_path: &str) -> Option<String> {
    let r = format!("{}\\", normalize(root).trim_end_matches('\\'));
    let p = normalize(full_path);
    if p.len() <= r.len() || !p.get(..r.len()).is_some_and(|h| h.eq_ignore_ascii_case(&r)) {
        return None;
    }
    let rest = &p[r.len()..];
    let name = rest.split('\\').next().unwrap_or(rest);
    let lower = name.to_lowercase();
    if lower.ends_with(".crdownload") || lower.ends_with(".part") || lower.ends_with(".tmp") || name.starts_with('~') {
        return None;
    }
    Some(format!("{r}{name}"))
}

pub struct FolderWatcher {
    watchers: Vec<(String, notify::RecommendedWatcher)>,
    queue: Arc<SettleQueue>,
    overflowed: Arc<Mutex<Vec<String>>>,
    clock: Arc<dyn Clock>,
    quiet_ms: i64,
    /// Roots that couldn't be watched (missing, no access).
    pub failed: Vec<String>,
}

impl FolderWatcher {
    pub fn new(roots: &[String], clock: Arc<dyn Clock>, quiet_ms: i64) -> Self {
        let queue = Arc::new(SettleQueue::default());
        let overflowed = Arc::new(Mutex::new(Vec::new()));
        let mut watchers = Vec::new();
        let mut failed = Vec::new();
        let mut seen = Vec::new();
        for root in roots.iter().map(|r| normalize(r)) {
            if seen.contains(&path_key(&root)) {
                continue;
            }
            seen.push(path_key(&root));
            let (q, o, c, r) = (queue.clone(), overflowed.clone(), clock.clone(), root.clone());
            let handler = move |res: notify::Result<notify::Event>| match res {
                Ok(e) if e.need_rescan() => o.lock().unwrap().push(r.clone()),
                Ok(e) if matches!(e.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Any) => {
                    for p in &e.paths {
                        if let Some(top) = top_level(&r, &p.to_string_lossy()) {
                            q.touch(&top, c.now());
                        }
                    }
                }
                Ok(_) => {}
                Err(_) => o.lock().unwrap().push(r.clone()),
            };
            let watched = notify::recommended_watcher(handler).and_then(|mut w| w.watch(Path::new(&root), RecursiveMode::Recursive).map(|_| w));
            match watched {
                Ok(w) => watchers.push((root, w)),
                Err(_) => failed.push(root),
            }
        }
        Self { watchers, queue, overflowed, clock, quiet_ms, failed }
    }

    pub fn roots(&self) -> Vec<String> {
        self.watchers.iter().map(|w| w.0.clone()).collect()
    }

    /// Entries that have settled, and roots whose change buffer overflowed (they need a full re-scan).
    pub fn poll(&self) -> (Vec<String>, Vec<String>) {
        let mut overflowed: Vec<String> = std::mem::take(&mut *self.overflowed.lock().unwrap());
        overflowed.sort();
        overflowed.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
        (self.queue.take_settled(self.clock.now(), self.quiet_ms), overflowed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn top_level_entries() {
        for (root, path, expected) in [
            (r"D:\Downloads", r"D:\Downloads\Some Game\bin\a.dll", Some(r"D:\Downloads\Some Game")),
            (r"D:\Downloads\", r"D:\Downloads\game.zip", Some(r"D:\Downloads\game.zip")),
            (r"D:\Downloads", r"D:\Downloads\game.zip.crdownload", None),
            (r"D:\Downloads", r"D:\Other\x", None),
            (r"D:\Downloads", r"D:\Downloads", None),
        ] {
            assert_eq!(top_level(root, path).as_deref(), expected, "{path}");
        }
    }

    #[test]
    fn settles_only_after_quiet() {
        let q = SettleQueue::default();
        q.touch(r"D:\Downloads\Game", 0);
        q.touch(r"D:\Downloads\Game", 50_000);
        assert!(q.take_settled(60_000, 60_000).is_empty());
        assert_eq!(q.take_settled(111_000, 60_000), [r"D:\Downloads\Game"]);
        assert!(q.take_settled(200_000, 60_000).is_empty());
    }
}
