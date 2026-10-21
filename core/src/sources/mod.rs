//! Launcher readers. Each reads one launcher's local install data; they never log in, call store APIs or touch game
//! folders beyond checking they exist.

pub mod epic;
pub mod file_stores;
pub mod installed_apps;
pub mod registry_stores;
pub mod steam;
pub mod uninstall;

use crate::model::{SourceKind, SourceResult};
use crate::platform::SystemContext;

pub trait SourceReader: Send + Sync {
    fn kind(&self) -> SourceKind;
    fn read(&self, ctx: &SystemContext) -> SourceResult;
}

/// Every launcher reader, in the order the UI lists them.
pub fn all() -> Vec<Box<dyn SourceReader>> {
    use registry_stores::*;
    vec![
        Box::new(steam::SteamReader),
        Box::new(epic::EpicReader),
        Box::new(GogReader),
        Box::new(EaReader),
        Box::new(UbisoftReader),
        Box::new(RockstarReader),
        Box::new(BattleNetReader),
        Box::new(RiotReader),
        Box::new(HoYoPlayReader),
        Box::new(file_stores::XboxReader),
        Box::new(file_stores::ItchReader),
        Box::new(file_stores::AmazonReader),
        Box::new(installed_apps::InstalledAppsReader),
    ]
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
