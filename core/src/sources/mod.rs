//! Launcher readers. Each reads one launcher's local install data; they never log in, call store APIs or touch game
//! folders beyond checking they exist.

pub mod epic;
pub mod steam;

use crate::model::{SourceKind, SourceResult};
use crate::platform::SystemContext;

pub trait SourceReader: Send + Sync {
    fn kind(&self) -> SourceKind;
    fn read(&self, ctx: &SystemContext) -> SourceResult;
}

/// Every reader ported so far. (The rest of the launchers arrive in the next stage of the Rust port.)
pub fn all() -> Vec<Box<dyn SourceReader>> {
    vec![Box::new(steam::SteamReader), Box::new(epic::EpicReader)]
}

/// Runs every reader in parallel; a reader that panics is reported as unreadable instead of breaking the rest.
pub fn read_all(ctx: &SystemContext) -> Vec<SourceResult> {
    let readers = all();
    std::thread::scope(|s| {
        let handles: Vec<_> = readers.iter().map(|r| (r.kind(), s.spawn(|| r.read(ctx)))).collect();
        handles
            .into_iter()
            .map(|(kind, h)| h.join().unwrap_or_else(|_| SourceResult::unreadable(kind, "Couldn't read: the reader failed")))
            .collect()
    })
}
