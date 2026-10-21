//! Epic Games Launcher: one JSON `*.item` manifest per installed app.

use std::fs;
use std::path::Path;

use serde_json::Value;

use super::SourceReader;
use crate::model::{plural, InstallRecord, SizeSource, SourceKind, SourceResult, SourceState};
use crate::platform::{normalize, SystemContext};

pub struct EpicReader;

impl SourceReader for EpicReader {
    fn kind(&self) -> SourceKind {
        SourceKind::Epic
    }

    fn read(&self, ctx: &SystemContext) -> SourceResult {
        let manifests = match ctx.registry.value(r"HKLM\SOFTWARE\WOW6432Node\Epic Games\EpicGamesLauncher", "AppDataPath") {
            Some(p) if !p.trim().is_empty() => Path::new(&p).join("Manifests"),
            _ => ctx.program_data.join("Epic").join("EpicGamesLauncher").join("Data").join("Manifests"),
        };

        let Ok(entries) = fs::read_dir(&manifests) else {
            let launcher = ctx.program_data.join("Epic").join("EpicGamesLauncher").is_dir()
                || ctx.program_files_x86.join("Epic Games").join("Launcher").is_dir()
                || ctx.program_files.join("Epic Games").join("Launcher").is_dir();
            return if launcher {
                SourceResult::unreadable(
                    SourceKind::Epic,
                    format!("Epic is installed but its manifests folder wasn't found ({})", manifests.display()),
                )
            } else {
                SourceResult::not_installed(SourceKind::Epic, "Epic Games Launcher isn't installed")
            };
        };

        let mut installs = Vec::new();
        let mut bad = 0;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("item")) {
                continue;
            }
            match fs::read_to_string(&path).ok().and_then(|t| read_item(&t)) {
                Some(Some(r)) => installs.push(r),
                Some(None) => {}
                None => bad += 1,
            }
        }

        let msg = if installs.is_empty() && bad == 0 {
            "Epic Games Launcher found, no games installed".to_string()
        } else {
            plural(installs.len(), "game")
        };
        if bad == 0 {
            SourceResult::new(SourceKind::Epic, SourceState::Ok, msg, installs)
        } else {
            SourceResult::new(SourceKind::Epic, SourceState::Partial, format!("{msg} · {} couldn't be read", plural(bad, "manifest")), installs)
        }
    }
}

/// One manifest. `None` when it isn't valid JSON; `Some(None)` for DLC, add-ons and unfinished installs.
pub fn read_item(json: &str) -> Option<Option<InstallRecord>> {
    let r: Value = serde_json::from_str(json).ok()?;
    let s = |name: &str| r.get(name).and_then(Value::as_str).map(str::to_string);

    let (Some(app_name), Some(location)) = (s("AppName"), s("InstallLocation").filter(|l| !l.trim().is_empty())) else {
        return Some(None);
    };
    if r.get("bIsIncompleteInstall").and_then(Value::as_bool) == Some(true) {
        return Some(None);
    }
    // DLC and add-ons have their own manifests pointing at the base game's folder.
    if s("MainGameAppName").is_some_and(|m| !m.eq_ignore_ascii_case(&app_name)) {
        return Some(None);
    }
    if let Some(cats) = r.get("AppCategories").and_then(Value::as_array) {
        let cats: Vec<&str> = cats.iter().filter_map(Value::as_str).collect();
        if !cats.is_empty() && !cats.iter().any(|c| c.eq_ignore_ascii_case("games")) {
            return Some(None);
        }
    }

    let path = normalize(&location);
    let mut rec = InstallRecord::new(SourceKind::Epic, s("DisplayName").unwrap_or_else(|| app_name.clone()), path.clone());
    rec.source_key = Some(app_name.clone());
    rec.launch_exe = s("LaunchExecutable").filter(|e| !e.is_empty()).map(|e| normalize(&Path::new(&path).join(e).to_string_lossy()));
    rec.is_installed = Path::new(&path).is_dir();
    if let (Some(ns), Some(item)) = (s("CatalogNamespace"), s("CatalogItemId")) {
        rec.launch_uri = Some(format!("com.epicgames.launcher://apps/{ns}%3A{item}%3A{app_name}?action=launch&silent=true"));
        rec.uninstall_command = Some(format!("com.epicgames.launcher://apps/{ns}%3A{item}%3A{app_name}?action=uninstall"));
    }
    if let Some(size) = r.get("InstallSize").and_then(Value::as_i64).filter(|&b| b > 0) {
        rec.size_bytes = Some(size);
        rec.size_source = SizeSource::Manifest;
    }
    if let Some(exe) = rec.launch_exe.clone() {
        rec.play_exes.push(exe);
    }
    Some(Some(rec))
}
