//! Steam: registry → `steamapps\libraryfolders.vdf` → each library's `appmanifest_*.acf`.
//! Also imports Steam's own playtime from `userdata\*\config\localconfig.vdf`.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::SourceReader;
use crate::model::{plural, InstallRecord, SizeSource, SourceKind, SourceResult, SourceState};
use crate::platform::{dir_exists, normalize, path_key, SystemContext};
use crate::vdf;

pub struct SteamReader;

/// Steam "apps" that aren't games: redistributables, runtimes, Proton, SteamVR, Wallpaper Engine.
const NON_GAME_APP_IDS: &[&str] = &[
    "228980",  // Steamworks Common Redistributables
    "431960",  // Wallpaper Engine
    "250820",  // SteamVR
    "1070560", "1391110", "1628350", // Steam Linux Runtime
    "1493710", "1887720", "2348590", // Proton
    "1826330", // Proton EasyAntiCheat Runtime
    "1161040", // Proton BattlEye Runtime
    "1007",    // Steamworks SDK Redist
    "365670",  // Blender
];

impl SourceReader for SteamReader {
    fn kind(&self) -> SourceKind {
        SourceKind::Steam
    }

    fn read(&self, ctx: &SystemContext) -> SourceResult {
        let Some(steam) = find_steam_path(ctx) else {
            return SourceResult::not_installed(SourceKind::Steam, "Steam isn't installed");
        };
        let (libraries, library_error) = read_library_folders(&steam);
        let mut installs = Vec::new();
        let mut problems: Vec<String> = library_error.into_iter().collect();

        for lib in &libraries {
            let steamapps = Path::new(lib).join("steamapps");
            let Ok(entries) = fs::read_dir(&steamapps) else {
                problems.push(format!("Library {lib} isn't reachable (drive unplugged?)"));
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if !(name.starts_with("appmanifest_") && name.ends_with(".acf")) {
                    continue;
                }
                match read_manifest(&entry.path(), &steamapps) {
                    Ok(Some(r)) => installs.push(r),
                    Ok(None) => {}
                    Err(_) => problems.push(format!("{} couldn't be read", entry.file_name().to_string_lossy())),
                }
            }
        }

        apply_playtime(&steam, &mut installs);

        let summary = format!("{} in {}", plural(installs.len(), "game"), plural(libraries.len(), "library"));
        if problems.is_empty() {
            SourceResult::new(SourceKind::Steam, SourceState::Ok, summary, installs)
        } else {
            SourceResult::new(SourceKind::Steam, SourceState::Partial, format!("{summary} · {}", problems.join("; ")), installs)
        }
    }
}

/// Steam's own folder, if it's installed.
pub fn find_steam_path(ctx: &SystemContext) -> Option<String> {
    // HKLM first: HKCU's SteamPath is often all lower-case with forward slashes.
    [
        ctx.registry.value(r"HKLM\SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
        ctx.registry.value(r"HKLM\SOFTWARE\Valve\Steam", "InstallPath"),
        ctx.registry.value(r"HKCU\Software\Valve\Steam", "SteamPath"),
        Some(ctx.program_files_x86.join("Steam").to_string_lossy().into_owned()),
    ]
    .into_iter()
    .flatten()
    .find(|p| dir_exists(p))
    .map(|p| normalize(&p))
}

/// Every Steam library folder (the main one first). The error is for the UI when the list couldn't be read.
pub fn read_library_folders(steam: &str) -> (Vec<String>, Option<String>) {
    let mut libs = vec![steam.to_string()];
    let file = [Path::new(steam).join("steamapps").join("libraryfolders.vdf"), Path::new(steam).join("config").join("libraryfolders.vdf")]
        .into_iter()
        .find(|p| p.is_file());
    let Some(file) = file else { return (libs, None) };
    let root = match vdf::parse_file(&file) {
        Ok(r) => r,
        Err(_) => return (libs, Some("libraryfolders.vdf couldn't be read; only the main library was checked".into())),
    };
    let Some(folders) = root.get("libraryfolders") else { return (libs, None) };
    for (key, node) in &folders.children {
        // New format: "0" { "path" "…" }. Old format: "1" "D:\\SteamLibrary".
        let Some(path) = node.value.as_deref().or_else(|| node.str("path")) else { continue };
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let norm = normalize(path);
        if !libs.iter().any(|l| path_key(l) == path_key(&norm)) {
            libs.push(norm);
        }
    }
    (libs, None)
}

/// One `appmanifest_*.acf`; `Ok(None)` for tools, redistributables and manifests without an install folder.
pub fn read_manifest(acf: &Path, steamapps: &Path) -> Result<Option<InstallRecord>, Box<dyn std::error::Error + Send + Sync>> {
    let root = vdf::parse_file(acf)?;
    let Some(state) = root.get("AppState") else { return Ok(None) };
    let (Some(app_id), Some(install_dir)) = (state.str("appid"), state.str("installdir")) else { return Ok(None) };
    if NON_GAME_APP_IDS.contains(&app_id) {
        return Ok(None);
    }
    let name = state.str("name");
    if name.is_some_and(is_tool_name) {
        return Ok(None);
    }

    let path: PathBuf = steamapps.join("common").join(install_dir);
    let mut r = InstallRecord::new(SourceKind::Steam, name.unwrap_or(install_dir), normalize(&path.to_string_lossy()));
    r.source_key = Some(app_id.to_string());
    r.launch_uri = Some(format!("steam://rungameid/{app_id}"));
    r.uninstall_command = Some(format!("steam://uninstall/{app_id}"));
    r.is_installed = path.is_dir();
    if let Some(size) = state.long("SizeOnDisk").filter(|&s| s > 0) {
        r.size_bytes = Some(size);
        r.size_source = SizeSource::Manifest;
    }
    if state.long("StateFlags").unwrap_or(0) & 4 == 0 {
        r.signals.push("Steam: download or update not finished".into());
    }
    r.imported_last_played = state.long("LastPlayed").filter(|&t| t > 0);
    Ok(Some(r))
}

fn is_tool_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.starts_with("proton ")
        || lower.starts_with("steam linux runtime")
        || lower.contains("redistributable")
        || lower.ends_with("dedicated server")
}

/// Steam playtime (minutes, last played) per appid, summed across every Steam account that has used this PC.
pub fn read_playtime(steam: &str) -> HashMap<String, (i64, i64)> {
    let mut result: HashMap<String, (i64, i64)> = HashMap::new();
    let Ok(users) = fs::read_dir(Path::new(steam).join("userdata")) else { return result };
    for user in users.flatten() {
        let file = user.path().join("config").join("localconfig.vdf");
        // Steam rewrites this file while running; a failed read just means no imported hours this time.
        let Ok(root) = vdf::parse_file(&file) else { continue };
        let Some(apps) = root.path(&["UserLocalConfigStore", "Software", "Valve", "Steam", "apps"]) else { continue };
        for (app_id, node) in &apps.children {
            let minutes = node.long("Playtime").unwrap_or(0);
            let last = node.long("LastPlayed").unwrap_or(0);
            if minutes == 0 && last == 0 {
                continue;
            }
            let e = result.entry(app_id.clone()).or_default();
            e.0 += minutes;
            e.1 = e.1.max(last);
        }
    }
    result
}

fn apply_playtime(steam: &str, installs: &mut [InstallRecord]) {
    let playtime = read_playtime(steam);
    for r in installs {
        let Some(&(minutes, last)) = r.source_key.as_ref().and_then(|k| playtime.get(k)) else { continue };
        r.imported_play_seconds = minutes * 60;
        if last > 0 && r.imported_last_played.is_none_or(|t| last > t) {
            r.imported_last_played = Some(last);
        }
    }
}
