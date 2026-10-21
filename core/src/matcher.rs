//! Collapses what every source found into one entry per game: the same folder seen twice is one install (the richer
//! source wins); the same title in different folders is one game with several installs — usually a forgotten second
//! copy eating space.

use std::collections::HashMap;
use std::path::Path;

use crate::model::InstallRecord;
use crate::naming;
use crate::platform::{is_same_or_inside, normalize, path_key};

/// One game in the library. Several installs mean several copies on disk.
#[derive(Debug, Clone, PartialEq)]
pub struct GameEntry {
    pub title: String,
    /// Normalised title used for de-duplication.
    pub key: String,
    pub installs: Vec<InstallRecord>,
}

impl GameEntry {
    pub fn primary(&self) -> &InstallRecord {
        &self.installs[0]
    }

    pub fn size_bytes(&self) -> i64 {
        self.installs.iter().filter(|i| i.is_installed).filter_map(|i| i.size_bytes).sum()
    }

    pub fn imported_play_seconds(&self) -> i64 {
        self.installs.iter().map(|i| i.imported_play_seconds).max().unwrap_or(0)
    }

    pub fn imported_last_played(&self) -> Option<i64> {
        self.installs.iter().filter_map(|i| i.imported_last_played).max()
    }

    pub fn is_installed(&self) -> bool {
        self.installs.iter().any(|i| i.is_installed)
    }

    /// More than one installed copy — usually wasted space.
    pub fn has_duplicates(&self) -> bool {
        self.installs.iter().filter(|i| i.is_installed).count() > 1
    }
}

/// Titles that different sources spell differently for the same game.
const ALIASES: &[(&str, &str)] = &[
    ("robloxplayer", "roblox"),
    ("minecraftlauncher", "minecraft"),
    ("minecraftjavaedition", "minecraft"),
    ("grandtheftautov", "gtav"),
    ("grandtheftautovenhanced", "gtav"),
];

/// How an aliased game is named on the shelf (rather than after whichever launcher found it).
const ALIAS_TITLES: &[(&str, &str)] = &[("roblox", "Roblox"), ("minecraft", "Minecraft"), ("gtav", "Grand Theft Auto V")];

fn lookup<'a>(table: &'a [(&str, &str)], k: &str) -> Option<&'a str> {
    table.iter().find(|(a, _)| *a == k).map(|(_, b)| *b)
}

pub fn merge(records: Vec<InstallRecord>) -> Vec<GameEntry> {
    let mut games: HashMap<String, GameEntry> = HashMap::new();
    let mut order = Vec::new();
    for install in merge_same_folder(records) {
        let mut k = naming::key(&install.title);
        if k.is_empty() {
            k = path_key(&install.install_path);
        }
        let k = lookup(ALIASES, &k).map(str::to_string).unwrap_or(k);
        games
            .entry(k.clone())
            .or_insert_with(|| {
                order.push(k.clone());
                GameEntry { title: install.title.clone(), key: k.clone(), installs: Vec::new() }
            })
            .installs
            .push(install);
    }
    let mut out: Vec<GameEntry> = order.into_iter().filter_map(|k| games.remove(&k)).collect();
    for g in &mut out {
        // Installed copies first, then the richest source.
        g.installs.sort_by_key(|i| (!i.is_installed, i.source.merge_priority()));
        g.title = lookup(ALIAS_TITLES, &g.key).map(str::to_string).unwrap_or_else(|| naming::display(&g.primary().title));
    }
    out.sort_by_key(|g| g.title.to_lowercase());
    out
}

/// Folds records that describe the same folder (or a folder inside a store install) into one.
pub fn merge_same_folder(records: Vec<InstallRecord>) -> Vec<InstallRecord> {
    let mut ordered = records;
    ordered.sort_by_key(|r| (r.source.merge_priority(), r.install_path.len()));
    let mut kept: Vec<InstallRecord> = Vec::new();
    for r in ordered {
        match kept.iter_mut().find(|k| same_folder(&r, k)) {
            Some(target) => fold(target, r),
            None => kept.push(r),
        }
    }
    kept
}

fn same_folder(candidate: &InstallRecord, kept: &InstallRecord) -> bool {
    if path_key(&candidate.install_path) == path_key(&kept.install_path) {
        return true;
    }
    // A detection inside an install we already have (e.g. a scanner hit in a Steam game's subfolder) — unless the
    // install is a whole drive.
    let kept_norm = normalize(&kept.install_path);
    let is_root = Path::new(&kept_norm).parent().is_none();
    !candidate.source.is_store() && kept.is_installed && is_same_or_inside(&candidate.install_path, &kept.install_path) && !is_root
}

fn fold(into: &mut InstallRecord, from: InstallRecord) {
    into.launch_exe = into.launch_exe.take().or(from.launch_exe);
    into.working_dir = into.working_dir.take().or(from.working_dir);
    into.uninstall_command = into.uninstall_command.take().or(from.uninstall_command);
    if into.size_bytes.is_none() && from.size_bytes.is_some() {
        into.size_bytes = from.size_bytes;
        into.size_source = from.size_source;
    }
    for exe in from.play_exes {
        if !into.play_exes.iter().any(|e| e.eq_ignore_ascii_case(&exe)) {
            into.play_exes.push(exe);
        }
    }
    into.confidence = into.confidence.max(from.confidence);
    into.imported_play_seconds = into.imported_play_seconds.max(from.imported_play_seconds);
    into.imported_last_played = into.imported_last_played.or(from.imported_last_played);
    let also = format!("Also found by: {}", from.source.display_name());
    if !into.signals.contains(&also) {
        into.signals.push(also);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::SourceKind;

    fn r(source: SourceKind, title: &str, path: &str, size: Option<i64>, installed: bool) -> InstallRecord {
        let mut i = InstallRecord::new(source, title, path);
        i.size_bytes = size;
        i.is_installed = installed;
        i
    }

    #[test]
    fn same_folder_from_two_sources_is_one_install_store_first() {
        let mut folder = r(SourceKind::Folder, "Portal2", r"D:\Steam\steamapps\common\Portal 2", Some(999), true);
        folder.play_exes.push(r"D:\Steam\steamapps\common\Portal 2\portal2.exe".into());
        let mut steam = r(SourceKind::Steam, "Portal 2", r"d:\steam\steamapps\common\portal 2\", None, true);
        steam.launch_uri = Some("steam://rungameid/620".into());

        let games = merge(vec![folder, steam]);
        assert_eq!(games.len(), 1);
        let game = &games[0];
        assert_eq!(game.installs.len(), 1);
        let install = &game.installs[0];
        assert_eq!(install.source, SourceKind::Steam);
        assert_eq!(game.title, "Portal 2");
        assert_eq!(install.size_bytes, Some(999));
        assert_eq!(install.play_exes.len(), 1);
        assert!(install.signals.contains(&"Also found by: Folder".to_string()));
    }

    #[test]
    fn detection_inside_a_store_install_is_merged() {
        let steam = r(SourceKind::Steam, "Elden Ring", r"D:\Steam\steamapps\common\ELDEN RING", None, true);
        let folder = r(SourceKind::Folder, "Game", r"D:\Steam\steamapps\common\ELDEN RING\Game", None, true);
        let games = merge(vec![steam, folder]);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].installs.len(), 1);
    }

    #[test]
    fn same_title_in_two_folders_is_one_game_with_two_copies() {
        let steam = r(SourceKind::Steam, "Sekiro™: Shadows Die Twice - GOTY Edition", r"C:\Steam\common\Sekiro", Some(15_000), true);
        let loose = r(SourceKind::InstalledApps, "Sekiro Shadows Die Twice GOTY Edition", r"C:\Games\Sekiro", Some(16_000), true);
        let games = merge(vec![loose, steam]);
        assert_eq!(games.len(), 1);
        let g = &games[0];
        assert_eq!(g.installs.len(), 2);
        assert!(g.has_duplicates());
        assert_eq!(g.primary().source, SourceKind::Steam);
        assert_eq!(g.size_bytes(), 31_000);
    }

    #[test]
    fn missing_copy_does_not_count_as_duplicate() {
        let a = r(SourceKind::InstalledApps, "F1 22", r"C:\Games\F1 22", None, false);
        let b = r(SourceKind::Folder, "F1 22", r"D:\Games\F1 22", Some(5), true);
        let games = merge(vec![a, b]);
        assert_eq!(games.len(), 1);
        assert!(!games[0].has_duplicates());
        assert!(games[0].primary().is_installed);
        assert_eq!(games[0].size_bytes(), 5);
    }

    #[test]
    fn different_games_stay_separate_and_aliases_join() {
        let games = merge(vec![
            r(SourceKind::Xbox, "Roblox", r"C:\XboxGames\Roblox", None, true),
            r(SourceKind::InstalledApps, "Roblox Player", r"C:\Users\x\AppData\Local\Roblox\Versions\v1", None, true),
            r(SourceKind::Steam, "Portal", r"C:\Steam\common\Portal", None, true),
        ]);
        assert_eq!(games.len(), 2);
        assert_eq!(games.iter().find(|g| g.title == "Roblox").unwrap().installs.len(), 2);
    }

    #[test]
    fn aliased_games_get_their_own_name() {
        let games = merge(vec![
            r(SourceKind::Xbox, "Minecraft Launcher", r"C:\XboxGames\Minecraft Launcher", None, true),
            r(SourceKind::InstalledApps, "Sekiro Shadows Die Twice GOTY Edition", r"C:\Games\Sekiro", None, true),
        ]);
        assert_eq!(games.iter().map(|g| g.title.as_str()).collect::<Vec<_>>(), ["Minecraft", "Sekiro Shadows Die Twice"]);
        assert_eq!(games[0].key, "minecraft");
    }
}
