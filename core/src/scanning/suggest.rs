//! Folders worth offering on first run, and folders the scanner should leave to the launcher readers.

use std::path::Path;

use super::classifier::is_games_folder_name;
use crate::platform::{normalize, path_key, SystemContext};
use crate::sources::steam;

fn add(list: &mut Vec<String>, p: impl AsRef<Path>) {
    let p = p.as_ref();
    if p.is_dir() {
        let s = normalize(&p.to_string_lossy());
        if !list.iter().any(|r| path_key(r) == path_key(&s)) {
            list.push(s);
        }
    }
}

/// Downloads, Desktop, and any Games-like folder at a drive root.
pub fn suggest_roots(ctx: &SystemContext) -> Vec<String> {
    let mut result = Vec::new();
    add(&mut result, ctx.user_profile.join("Downloads"));
    add(&mut result, ctx.user_profile.join("Desktop"));
    add(&mut result, ctx.user_profile.join("Games"));
    for drive in &ctx.fixed_drives {
        let Ok(entries) = std::fs::read_dir(drive) else { continue };
        for e in entries.flatten().filter(|e| e.path().is_dir()) {
            let name = e.file_name().to_string_lossy().into_owned();
            if is_games_folder_name(&name) && !name.eq_ignore_ascii_case("XboxGames") && !name.eq_ignore_ascii_case("SteamLibrary") {
                add(&mut result, e.path());
            }
        }
    }
    result
}

/// The launchers' own program folders. Their games are read from launcher data, and their helper programs (overlays,
/// web helpers, Wallpaper Engine projects…) look game-like to the folder scanner, so the scanner skips these.
pub fn launcher_dirs(ctx: &SystemContext) -> Vec<String> {
    let mut result = Vec::new();
    // Steam's whole folder: steamapps\common is fully described by the Steam reader.
    if let Some(s) = steam::find_steam_path(ctx) {
        add(&mut result, s);
    }
    for pf in [&ctx.program_files, &ctx.program_files_x86] {
        for rel in [
            r"Epic Games\Launcher",
            r"Epic Games\Epic Online Services",
            r"Electronic Arts\EA Desktop",
            "Origin",
            r"Ubisoft\Ubisoft Game Launcher",
            "GOG Galaxy",
            "Battle.net",
            r"Rockstar Games\Launcher",
            r"Rockstar Games\Social Club",
        ] {
            add(&mut result, pf.join(rel));
        }
    }
    add(&mut result, r"C:\Riot Games\Riot Client");
    if let Some(hyp) = ctx.registry.value(r"HKCU\Software\Cognosphere\HYP\1_0", "InstallPath") {
        add(&mut result, hyp);
    }
    result
}
