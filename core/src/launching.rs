//! Starts games and opens uninstallers. Only well-known store URI schemes and real .exe files are ever started —
//! never an arbitrary command line from the database — and uninstalling always goes through the launcher or Windows'
//! own Installed apps page: Shelf never deletes files itself.

use std::path::Path;

use crate::model::SourceKind;
use crate::storage::library::InstallRow;

const LAUNCH_SCHEMES: &[&str] = &[
    "steam://", "com.epicgames.launcher://", "uplay://", "itch://", "amazon-games://", "goggalaxy://", "link2ea://", "origin2://",
    "battlenet://", r"shell:AppsFolder\",
];

const UNINSTALL_SCHEMES: &[&str] = &["steam://uninstall/", "com.epicgames.launcher://", "uplay://uninstall/", "ms-settings:"];

fn starts_with_ci(s: &str, prefix: &str) -> bool {
    s.get(..prefix.len()).is_some_and(|p| p.eq_ignore_ascii_case(prefix))
}

fn is_launch_uri(uri: Option<&str>) -> bool {
    uri.is_some_and(|u| LAUNCH_SCHEMES.iter().any(|s| starts_with_ci(u, s)))
}

fn is_exe(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".exe") && Path::new(path).is_file()
}

#[derive(Debug, Clone, PartialEq)]
pub struct Outcome {
    pub ok: bool,
    pub message: String,
}

impl Outcome {
    fn ok(m: impl Into<String>) -> Self {
        Self { ok: true, message: m.into() }
    }

    fn err(m: impl Into<String>) -> Self {
        Self { ok: false, message: m.into() }
    }
}

pub fn can_launch(i: &InstallRow) -> bool {
    i.is_installed() && (is_launch_uri(i.launch_uri.as_deref()) || i.launch_exe.as_deref().is_some_and(|e| Path::new(e).is_file()))
}

/// The install to start: the launcher's own way in first (keeps cloud saves, overlays, updates working), then a
/// known exe.
pub fn pick(installs: &[InstallRow]) -> Option<&InstallRow> {
    let ok: Vec<&InstallRow> = installs.iter().filter(|i| can_launch(i)).collect();
    ok.iter().find(|i| i.source.is_store() && i.launch_uri.is_some()).or(ok.first()).copied()
}

#[cfg(windows)]
pub fn launch(i: &InstallRow) -> Outcome {
    if let Some(uri) = i.launch_uri.as_deref().filter(|u| is_launch_uri(Some(u))) {
        let r = if starts_with_ci(uri, r"shell:AppsFolder\") {
            std::process::Command::new("explorer.exe").arg(uri).spawn().map(|_| ()).map_err(|e| e.to_string())
        } else {
            crate::platform::shell_open(uri, None, None)
        };
        return match r {
            Ok(()) => Outcome::ok(format!("Starting through {}", i.source.display_name())),
            Err(e) => Outcome::err(format!("Couldn't start it: {e}")),
        };
    }
    let Some(exe) = i.launch_exe.as_deref().filter(|e| is_exe(e)) else {
        return Outcome::err("Shelf doesn't know which exe starts this game. Open its folder and run it once — Shelf will remember it.");
    };
    let dir = i
        .working_dir
        .as_deref()
        .filter(|d| Path::new(d).is_dir())
        .map(String::from)
        .or_else(|| Path::new(exe).parent().map(|p| p.to_string_lossy().into_owned()));
    match crate::platform::shell_open(exe, i.launch_args.as_deref().filter(|a| !a.is_empty()), dir.as_deref()) {
        Ok(()) => Outcome::ok("Starting"),
        Err(e) => Outcome::err(format!("Couldn't start it: {e}")),
    }
}

/// Button label for the uninstall action, or `None` when Shelf can only offer "Open folder".
pub fn uninstall_label(i: &InstallRow) -> Option<&'static str> {
    if !i.is_installed() {
        return None;
    }
    let cmd = i.uninstall_command.as_deref();
    match cmd {
        Some(c) if starts_with_ci(c, "steam://") => Some("Uninstall in Steam"),
        Some(c) if starts_with_ci(c, "com.epicgames.launcher://") => Some("Uninstall in Epic"),
        Some(c) if starts_with_ci(c, "uplay://") => Some("Uninstall in Ubisoft"),
        Some(_) => Some("Open Installed apps"),
        None if matches!(
            i.source,
            SourceKind::Xbox | SourceKind::InstalledApps | SourceKind::Gog | SourceKind::Ea | SourceKind::Riot | SourceKind::BattleNet
        ) =>
        {
            Some("Open Installed apps")
        }
        None => None,
    }
}

/// What uninstalling opens: the launcher's own uninstaller URI, or Windows' Installed apps page.
pub fn uninstall_target(i: &InstallRow) -> &str {
    match i.uninstall_command.as_deref() {
        Some(c) if UNINSTALL_SCHEMES.iter().any(|s| starts_with_ci(c, s)) => c,
        _ => "ms-settings:appsfeatures",
    }
}

#[cfg(windows)]
pub fn uninstall(i: &InstallRow) -> Outcome {
    let target = uninstall_target(i);
    match crate::platform::shell_open(target, None, None) {
        Ok(()) if target.starts_with("ms-settings:") => {
            let name = Path::new(&i.install_path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            Outcome::ok(format!("Opened Installed apps — look for {name}"))
        }
        Ok(()) => Outcome::ok("Opened the launcher's uninstaller"),
        Err(e) => Outcome::err(format!("Couldn't open the uninstaller: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(source: SourceKind, uri: Option<&str>, exe: Option<&str>, uninstall: Option<&str>) -> InstallRow {
        InstallRow {
            id: 1,
            game_id: 1,
            source,
            install_path: r"C:\Games\X".into(),
            launch_exe: exe.map(String::from),
            launch_uri: uri.map(String::from),
            launch_args: None,
            working_dir: None,
            state: "installed".into(),
            size_bytes: None,
            uninstall_command: uninstall.map(String::from),
            confidence: 100,
            signals: vec![],
        }
    }

    #[test]
    fn only_known_schemes_launch() {
        assert!(can_launch(&row(SourceKind::Steam, Some("steam://rungameid/620"), None, None)));
        assert!(!can_launch(&row(SourceKind::Folder, Some("cmd.exe /c del"), None, None)));
        assert!(!can_launch(&row(SourceKind::Folder, None, Some(r"C:\nope\x.exe"), None)));
        let mut gone = row(SourceKind::Steam, Some("steam://rungameid/620"), None, None);
        gone.state = "removed".into();
        assert!(!can_launch(&gone));
    }

    #[test]
    fn store_uri_wins_over_exe() {
        let exe = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        let installs = vec![row(SourceKind::Folder, None, Some(&exe), None), row(SourceKind::Steam, Some("steam://rungameid/1"), None, None)];
        assert_eq!(pick(&installs).unwrap().source, SourceKind::Steam);
    }

    #[test]
    fn uninstall_never_runs_arbitrary_commands() {
        assert_eq!(uninstall_target(&row(SourceKind::Steam, None, None, Some("steam://uninstall/620"))), "steam://uninstall/620");
        assert_eq!(uninstall_target(&row(SourceKind::InstalledApps, None, None, Some(r#""C:\x\unins000.exe" /S"#))), "ms-settings:appsfeatures");
        assert_eq!(uninstall_label(&row(SourceKind::Steam, None, None, Some("steam://uninstall/620"))), Some("Uninstall in Steam"));
        assert_eq!(uninstall_label(&row(SourceKind::Folder, None, None, None)), None);
        assert_eq!(uninstall_label(&row(SourceKind::Xbox, None, None, None)), Some("Open Installed apps"));
    }
}
