//! Windows "Installed apps": every program with an uninstaller. Repacks (FitGirl, DODI, ElAmigos), standalone
//! installers and smaller launchers all register here. Each entry's folder goes through the same folder classifier as
//! the folder scanner, so ordinary apps fall away.

use std::collections::HashSet;
use std::path::Path;
use std::sync::LazyLock;

use fancy_regex::Regex;

use super::uninstall::{self, UninstallEntry};
use super::SourceReader;
use crate::model::{plural, InstallRecord, SourceKind, SourceResult, SourceState};
use crate::naming;
use crate::platform::{is_same_or_inside, normalize, path_key, SystemContext};
use crate::scanning::classifier::{self, ClassifierOptions, VerdictKind};

pub struct InstalledAppsReader;

const GAME_PUBLISHERS: &[&str] = &[
    "Electronic Arts", "Ubisoft", "Bandai Namco Entertainment", "BANDAI NAMCO Entertainment", "Square Enix", "CAPCOM",
    "CAPCOM Co., Ltd.", "SEGA", "Activision", "Bethesda Softworks", "2K", "2K Games", "Rockstar Games", "CD PROJEKT RED",
    "FromSoftware", "FromSoftware, Inc.", "Konami", "Warner Bros. Games", "Devolver Digital", "Paradox Interactive",
    "THQ Nordic", "Focus Entertainment", "Team17", "Mojang", "Roblox Corporation", "Riot Games, Inc", "Riot Games, Inc.",
    "miHoYo", "COGNOSPHERE PTE. LTD.", "Krafton", "Embark Studios", "Larian Studios", "Re-Logic", "ConcernedApe",
    "Supergiant Games", "Team Cherry", "Klei Entertainment", "Valve", "Xbox Game Studios", "Microsoft Studios",
];

/// The launchers themselves.
const LAUNCHERS: &[&str] = &[
    "Steam", "EA app", "Origin", "Epic Games Launcher", "GOG GALAXY", "GOG Galaxy", "Ubisoft Connect", "Uplay", "Battle.net",
    "Riot Client", "HoYoPlay", "Rockstar Games Launcher", "Amazon Games", "itch", "Xbox", "Playnite", "TLauncher",
    "Minecraft Launcher", "Riot Vanguard", "EA Desktop",
];

static REPACK_NAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)fitgirl|dodi|elamigos|repack|\bmulti\d|codex|empress|tenoke|\brune\b|plaza|skidrow|\bgoty\b").unwrap()
});
static FOR_USER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\s+for\s+\S+\s*$").unwrap());

fn in_list(list: &[&str], s: &str) -> bool {
    list.iter().any(|x| x.eq_ignore_ascii_case(s))
}

impl SourceReader for InstalledAppsReader {
    fn kind(&self) -> SourceKind {
        SourceKind::InstalledApps
    }

    fn read(&self, ctx: &SystemContext) -> SourceResult {
        let entries = uninstall::read(ctx.registry.as_ref());
        let options = ClassifierOptions::default();
        let mut installs = Vec::new();
        let mut seen = HashSet::new();
        for e in &entries {
            if e.system_component || e.has_parent || owned_by_another_reader(e) {
                continue;
            }
            if let Some(r) = evaluate(e, ctx, &options) {
                if seen.insert(path_key(&r.install_path)) {
                    installs.push(r);
                }
            }
        }
        let missing = installs.iter().filter(|i| !i.is_installed).count();
        let mut msg = format!("{} among {} installed apps", plural(installs.len() - missing, "game"), entries.len());
        if missing > 0 {
            msg += &format!(" · {missing} listed but their folder is gone");
        }
        SourceResult::new(SourceKind::InstalledApps, SourceState::Ok, msg, installs)
    }
}

pub fn evaluate(e: &UninstallEntry, ctx: &SystemContext, options: &ClassifierOptions) -> Option<InstallRecord> {
    let mut hints = Vec::new();
    if REPACK_NAME.is_match(&e.display_name).unwrap_or(false) {
        hints.push("+20 Repack/release name in Windows' app list".to_string());
    } else if let Some(p) = e.publisher.as_deref().filter(|p| in_list(GAME_PUBLISHERS, p)) {
        hints.push(format!("+20 Game publisher ({p})"));
    }
    let hint_points = hints.len() as i32 * 20;
    let title = naming::clean(&FOR_USER.replace(&e.display_name, ""));

    let location = e.resolved_location();
    let Some(location) = location.filter(|l| Path::new(l).is_dir()) else {
        // A stale entry for something that was clearly a game: worth showing as "missing", it often means a game
        // folder was deleted by hand without running its uninstaller. Only trust an explicit InstallLocation here; one
        // derived from an icon path is often an installer cache.
        let explicit = e.install_location.as_deref().filter(|l| !l.trim().is_empty())?;
        if hint_points == 0 {
            return None;
        }
        let mut r = InstallRecord::new(SourceKind::InstalledApps, title, normalize(explicit));
        r.source_key = Some(e.key_name.clone());
        r.uninstall_command = e.uninstall_string.clone();
        r.is_installed = false;
        r.confidence = options.library_threshold as u8;
        r.signals = hints;
        r.signals.push("Listed in Windows' installed apps, but the folder no longer exists".into());
        return Some(r);
    };
    if is_system_location(&location, ctx) {
        return None;
    }

    let verdict = classifier::evaluate_path(&location, options);
    if verdict.kind == VerdictKind::Installer {
        return None;
    }
    let launch_exe = verdict.launch_exe.clone()?;
    let score = (verdict.score + hint_points).min(100);
    if score < options.review_threshold {
        return None;
    }
    let mut r = InstallRecord::new(SourceKind::InstalledApps, title, location);
    r.source_key = Some(e.key_name.clone());
    r.launch_exe = Some(launch_exe);
    r.uninstall_command = e.uninstall_string.clone();
    r.confidence = score as u8;
    r.signals = verdict.signals;
    r.signals.extend(hints);
    r.play_exes = verdict.play_exes;
    Some(r)
}

fn owned_by_another_reader(e: &UninstallEntry) -> bool {
    let key = e.key_name.to_lowercase();
    let uninstall = e.uninstall_string.as_deref().unwrap_or("").to_lowercase();
    in_list(LAUNCHERS, &e.display_name)
        || key.starts_with("steam app ")
        || key.starts_with("riot game ")
        || uninstall.contains("steam://")
        || uninstall.contains("battle.net")
        || e.publisher.as_deref().is_some_and(|p| p.eq_ignore_ascii_case("Blizzard Entertainment"))
}

fn is_system_location(location: &str, ctx: &SystemContext) -> bool {
    let windows = std::env::var("windir").unwrap_or_default();
    let pf = |p: &Path| p.to_string_lossy().into_owned();
    (!windows.is_empty() && is_same_or_inside(location, &windows))
        || is_same_or_inside(location, &pf(&ctx.program_files.join("WindowsApps")))
        || is_same_or_inside(location, &pf(&ctx.program_files.join("Common Files")))
        || is_same_or_inside(location, &pf(&ctx.program_files_x86.join("Common Files")))
        || Path::new(&normalize(location)).parent().is_none()
}
