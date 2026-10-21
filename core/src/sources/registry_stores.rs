//! Launchers whose installs are found in the registry: GOG, EA, Ubisoft, Rockstar, Battle.net, Riot and HoYoPlay.

use std::fs;
use std::path::Path;

use super::{uninstall, SourceReader};
use crate::model::{plural, InstallRecord, SourceKind, SourceResult, SourceState};
use crate::naming;
use crate::platform::{normalize, path_key, SystemContext};

fn non_empty(s: Option<String>) -> Option<String> {
    s.filter(|v| !v.trim().is_empty())
}

fn file_name(path: &str) -> String {
    Path::new(path).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string())
}

fn ok(kind: SourceKind, message: impl Into<String>, installs: Vec<InstallRecord>) -> SourceResult {
    SourceResult::new(kind, SourceState::Ok, message, installs)
}

/// GOG: `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<id>`. GOG games run fine without Galaxy, so they launch directly.
pub struct GogReader;

impl SourceReader for GogReader {
    fn kind(&self) -> SourceKind {
        SourceKind::Gog
    }

    fn read(&self, ctx: &SystemContext) -> SourceResult {
        const ROOT: &str = r"HKLM\SOFTWARE\WOW6432Node\GOG.com\Games";
        let ids = ctx.registry.subkey_names(ROOT);
        if ids.is_empty() {
            return SourceResult::not_installed(SourceKind::Gog, "No GOG games registered on this PC");
        }
        let mut installs = Vec::new();
        for id in ids {
            let key = format!(r"{ROOT}\{id}");
            let Some(path) = non_empty(ctx.registry.value(&key, "path")) else { continue };
            // DLC entries name the game they belong to.
            if non_empty(ctx.registry.value(&key, "dependsOn")).is_some() {
                continue;
            }
            let dir = normalize(&path);
            let title = ctx.registry.value(&key, "gameName").or_else(|| ctx.registry.value(&key, "GAMENAME")).unwrap_or_else(|| file_name(&dir));
            let mut r = InstallRecord::new(SourceKind::Gog, title, dir.clone());
            r.source_key = Some(id);
            r.launch_exe = non_empty(ctx.registry.value(&key, "exe")).map(|e| normalize(&e));
            r.launch_args = non_empty(ctx.registry.value(&key, "launchParam"));
            r.working_dir = non_empty(ctx.registry.value(&key, "workingDir"));
            r.is_installed = Path::new(&dir).is_dir();
            if let Some(exe) = r.launch_exe.clone() {
                r.play_exes.push(exe);
            }
            installs.push(r);
        }
        ok(SourceKind::Gog, plural(installs.len(), "game"), installs)
    }
}

/// EA app: its own install database is encrypted, so games are found from EA's registry keys and from folders under
/// the default EA library that carry `__Installer\installerdata.xml`.
pub struct EaReader;

const EA_ROOTS: &[&str] = &[
    r"HKLM\SOFTWARE\WOW6432Node\Electronic Arts",
    r"HKLM\SOFTWARE\Electronic Arts",
    r"HKLM\SOFTWARE\WOW6432Node\EA Games",
    r"HKLM\SOFTWARE\EA Games",
];
const EA_NOT_GAMES: &[&str] = &["EA Core", "EA Desktop", "EADM", "Origin", "EA app", "EA Desktop Launcher"];

fn in_list(list: &[&str], s: &str) -> bool {
    list.iter().any(|x| x.eq_ignore_ascii_case(s))
}

impl SourceReader for EaReader {
    fn kind(&self) -> SourceKind {
        SourceKind::Ea
    }

    fn read(&self, ctx: &SystemContext) -> SourceResult {
        let app_installed = EA_ROOTS.iter().any(|r| ctx.registry.subkey_names(r).iter().any(|n| in_list(EA_NOT_GAMES, n)))
            || ctx.program_files.join("Electronic Arts").join("EA Desktop").is_dir();
        let mut installs = Vec::new();
        let mut seen = std::collections::HashSet::new();

        for root in EA_ROOTS {
            for name in ctx.registry.subkey_names(root) {
                if in_list(EA_NOT_GAMES, &name) {
                    continue;
                }
                let key = format!(r"{root}\{name}");
                let Some(dir) = non_empty(ctx.registry.value(&key, "Install Dir").or_else(|| ctx.registry.value(&key, "InstallDir"))) else {
                    continue;
                };
                let path = normalize(&dir);
                if !seen.insert(path_key(&path)) {
                    continue;
                }
                let mut r = InstallRecord::new(SourceKind::Ea, ctx.registry.value(&key, "DisplayName").unwrap_or_else(|| name.clone()), path.clone());
                r.source_key = Some(name);
                r.is_installed = Path::new(&path).is_dir();
                installs.push(r);
            }
        }

        for library in [ctx.program_files.join("EA Games"), ctx.program_files_x86.join("Origin Games")] {
            let Ok(entries) = fs::read_dir(&library) else { continue };
            for dir in entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
                let xml = dir.join("__Installer").join("installerdata.xml");
                let dir_s = dir.to_string_lossy().into_owned();
                if !xml.is_file() || !seen.insert(path_key(&dir_s)) {
                    continue;
                }
                let title = read_installer_title(&xml).unwrap_or_else(|| file_name(&dir_s));
                installs.push(InstallRecord::new(SourceKind::Ea, title, normalize(&dir_s)));
            }
        }

        if !app_installed && installs.is_empty() {
            return SourceResult::not_installed(SourceKind::Ea, "EA app isn't installed");
        }
        // Anything these miss still shows up through Windows' installed apps or the folder scanner.
        ok(
            SourceKind::Ea,
            format!("{} (via registry and the EA Games folder; EA's own database is encrypted)", plural(installs.len(), "game")),
            installs,
        )
    }
}

/// The English `<gameTitle>` from an EA `installerdata.xml`, else the first one.
pub fn read_installer_title(xml: &Path) -> Option<String> {
    let text = fs::read_to_string(xml).ok()?;
    let doc = roxmltree::Document::parse(&text).ok()?;
    let titles: Vec<_> = doc.descendants().filter(|n| n.tag_name().name() == "gameTitle").collect();
    let pick = titles.iter().find(|t| matches!(t.attribute("locale"), Some("en_US" | "en_GB"))).or(titles.first())?;
    let value = pick.text().unwrap_or("").trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// Ubisoft Connect: `HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs\<id>`.
pub struct UbisoftReader;

impl SourceReader for UbisoftReader {
    fn kind(&self) -> SourceKind {
        SourceKind::Ubisoft
    }

    fn read(&self, ctx: &SystemContext) -> SourceResult {
        const LAUNCHER: &str = r"HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher";
        let ids = ctx.registry.subkey_names(&format!(r"{LAUNCHER}\Installs"));
        if ids.is_empty() && ctx.registry.value(LAUNCHER, "InstallDir").is_none() {
            return SourceResult::not_installed(SourceKind::Ubisoft, "Ubisoft Connect isn't installed");
        }
        let mut installs = Vec::new();
        for id in ids {
            let Some(dir) = non_empty(ctx.registry.value(&format!(r"{LAUNCHER}\Installs\{id}"), "InstallDir")) else { continue };
            let path = normalize(&dir);
            let mut r = InstallRecord::new(SourceKind::Ubisoft, naming::clean(&file_name(&path)), path.clone());
            r.launch_uri = Some(format!("uplay://launch/{id}/0"));
            r.uninstall_command = Some(format!("uplay://uninstall/{id}"));
            r.is_installed = Path::new(&path).is_dir();
            r.source_key = Some(id);
            installs.push(r);
        }
        let msg = if installs.is_empty() { "Ubisoft Connect found, no games installed".to_string() } else { plural(installs.len(), "game") };
        ok(SourceKind::Ubisoft, msg, installs)
    }
}

/// Rockstar Games Launcher: `HKLM\SOFTWARE\WOW6432Node\Rockstar Games\<title>` → InstallFolder.
pub struct RockstarReader;

const ROCKSTAR_NOT_GAMES: &[&str] = &["Launcher", "Rockstar Games Launcher", "Rockstar Games Social Club", "Social Club"];

impl SourceReader for RockstarReader {
    fn kind(&self) -> SourceKind {
        SourceKind::Rockstar
    }

    fn read(&self, ctx: &SystemContext) -> SourceResult {
        const ROOT: &str = r"HKLM\SOFTWARE\WOW6432Node\Rockstar Games";
        let names = ctx.registry.subkey_names(ROOT);
        if names.is_empty() {
            return SourceResult::not_installed(SourceKind::Rockstar, "Rockstar Games Launcher isn't installed");
        }
        let mut installs = Vec::new();
        for name in names {
            if in_list(ROCKSTAR_NOT_GAMES, &name) {
                continue;
            }
            let Some(dir) = non_empty(ctx.registry.value(&format!(r"{ROOT}\{name}"), "InstallFolder")) else { continue };
            let path = normalize(&dir);
            let mut r = InstallRecord::new(SourceKind::Rockstar, name.clone(), path.clone());
            r.source_key = Some(name);
            r.is_installed = Path::new(&path).is_dir();
            installs.push(r);
        }
        ok(SourceKind::Rockstar, plural(installs.len(), "game"), installs)
    }
}

/// Battle.net: the agent's product.db is protobuf, so games come from Blizzard's Uninstall entries.
pub struct BattleNetReader;

impl SourceReader for BattleNetReader {
    fn kind(&self) -> SourceKind {
        SourceKind::BattleNet
    }

    fn read(&self, ctx: &SystemContext) -> SourceResult {
        let installed = ctx.program_files_x86.join("Battle.net").is_dir() || ctx.program_data.join("Battle.net").is_dir();
        let mut installs = Vec::new();
        for e in uninstall::read(ctx.registry.as_ref()) {
            let blizzard = e.uninstall_string.as_deref().is_some_and(|u| u.to_lowercase().contains("battle.net"))
                || e.publisher.as_deref().is_some_and(|p| p.eq_ignore_ascii_case("Blizzard Entertainment"));
            if !blizzard || e.display_name.to_lowercase().starts_with("battle.net") {
                continue;
            }
            let Some(location) = e.resolved_location() else { continue };
            let mut r = InstallRecord::new(SourceKind::BattleNet, e.display_name.clone(), location.clone());
            r.source_key = Some(e.key_name.clone());
            r.uninstall_command = e.uninstall_string.clone();
            r.is_installed = Path::new(&location).is_dir();
            installs.push(r);
        }
        if !installed && installs.is_empty() {
            return SourceResult::not_installed(SourceKind::BattleNet, "Battle.net isn't installed");
        }
        ok(SourceKind::BattleNet, format!("{} (from Windows' installed apps)", plural(installs.len(), "game")), installs)
    }
}

/// Riot Client: "Riot Game <product>.<patchline>" Uninstall entries, launched through RiotClientServices.
pub struct RiotReader;

impl SourceReader for RiotReader {
    fn kind(&self) -> SourceKind {
        SourceKind::Riot
    }

    fn read(&self, ctx: &SystemContext) -> SourceResult {
        let client = fs::read_to_string(ctx.program_data.join("Riot Games").join("RiotClientInstalls.json"))
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .and_then(|v| v.get("rc_default").and_then(|c| c.as_str()).map(str::to_string));

        let mut installs = Vec::new();
        for e in uninstall::read(ctx.registry.as_ref()) {
            let Some(id) = e.key_name.get(..10).filter(|p| p.eq_ignore_ascii_case("Riot Game ")).map(|_| e.key_name[10..].trim().to_string())
            else {
                continue;
            };
            let (product, patchline) = id.split_once('.').unwrap_or((&id, "live"));
            if product.is_empty() || product.eq_ignore_ascii_case("Riot_Client") {
                continue;
            }
            let Some(location) = e.resolved_location() else { continue };
            let mut r = InstallRecord::new(SourceKind::Riot, e.display_name.clone(), location.clone());
            r.uninstall_command = e.uninstall_string.clone();
            r.is_installed = Path::new(&location).is_dir();
            if let Some(c) = &client {
                r.launch_exe = Some(normalize(c));
                r.launch_args = Some(format!("--launch-product={product} --launch-patchline={patchline}"));
            }
            r.source_key = Some(id.clone());
            installs.push(r);
        }
        if client.is_none() && installs.is_empty() {
            return SourceResult::not_installed(SourceKind::Riot, "Riot Client isn't installed");
        }
        ok(SourceKind::Riot, plural(installs.len(), "game"), installs)
    }
}

/// HoYoPlay (Genshin Impact, Honkai: Star Rail, Zenless Zone Zero…): per-game keys under HKCU.
pub struct HoYoPlayReader;

const HOYO_ROOTS: &[&str] = &[r"HKCU\Software\Cognosphere\HYP\1_0", r"HKCU\Software\miHoYo\HYP\1_0"];
const HOYO_TITLES: &[(&str, &str)] =
    &[("hk4e", "Genshin Impact"), ("hkrpg", "Honkai: Star Rail"), ("nap", "Zenless Zone Zero"), ("bh3", "Honkai Impact 3rd")];

impl SourceReader for HoYoPlayReader {
    fn kind(&self) -> SourceKind {
        SourceKind::HoYoPlay
    }

    fn read(&self, ctx: &SystemContext) -> SourceResult {
        let mut found = false;
        let mut installs = Vec::new();
        for root in HOYO_ROOTS {
            if ctx.registry.value(root, "InstallPath").is_some() {
                found = true;
            }
            for biz in ctx.registry.subkey_names(root) {
                found = true;
                let Some(dir) = non_empty(ctx.registry.value(&format!(r"{root}\{biz}"), "GameInstallPath")) else { continue };
                let path = normalize(&dir);
                let prefix = biz.split('_').next().unwrap_or("");
                let title = HOYO_TITLES
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case(prefix))
                    .map(|(_, t)| t.to_string())
                    .unwrap_or_else(|| naming::clean(&file_name(&path)));
                let mut r = InstallRecord::new(SourceKind::HoYoPlay, title, path.clone());
                r.source_key = Some(biz);
                r.is_installed = Path::new(&path).is_dir();
                installs.push(r);
            }
        }
        if !found {
            return SourceResult::not_installed(SourceKind::HoYoPlay, "HoYoPlay isn't installed");
        }
        let msg = if installs.is_empty() { "HoYoPlay found, no games installed".to_string() } else { plural(installs.len(), "game") };
        ok(SourceKind::HoYoPlay, msg, installs)
    }
}
