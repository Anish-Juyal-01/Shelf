//! What the readers report: one [`InstallRecord`] per copy of a game, grouped into a [`SourceResult`] per launcher.

use serde::{Deserialize, Serialize};

/// Where an install was found. Store kinds come from launcher data; the rest from Shelf's own detection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    Steam,
    Epic,
    Gog,
    Ea,
    Ubisoft,
    Rockstar,
    Xbox,
    BattleNet,
    Itch,
    Amazon,
    Riot,
    HoYoPlay,
    /// Windows "Installed apps" (Uninstall registry keys) — catches repack and standalone installers.
    InstalledApps,
    /// Found by the folder scanner.
    Folder,
    Manual,
    Runtime,
}

impl SourceKind {
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Steam => "Steam",
            Self::Epic => "Epic",
            Self::Gog => "GOG",
            Self::Ea => "EA",
            Self::Ubisoft => "Ubisoft",
            Self::Rockstar => "Rockstar",
            Self::Xbox => "Xbox",
            Self::BattleNet => "Battle.net",
            Self::Itch => "itch",
            Self::Amazon => "Amazon",
            Self::Riot => "Riot",
            Self::HoYoPlay => "HoYoPlay",
            Self::InstalledApps => "Installed app",
            Self::Folder => "Folder",
            Self::Manual => "Manual",
            Self::Runtime => "Seen running",
        }
    }

    /// Launcher-backed sources know more (titles, launch URIs, sizes) than detection does.
    pub fn is_store(self) -> bool {
        self < Self::InstalledApps
    }

    /// Lower is preferred when two sources describe the same folder.
    pub fn merge_priority(self) -> u8 {
        match self {
            k if k.is_store() => 0,
            Self::Manual => 1,
            Self::InstalledApps => 2,
            Self::Folder => 3,
            _ => 4,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum SizeSource {
    #[default]
    Unknown,
    /// Reported by the launcher (Steam SizeOnDisk, Epic InstallSize).
    Manifest,
    /// Shelf added up the files itself.
    Measured,
}

/// One copy of a game on disk, as reported by one source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InstallRecord {
    pub source: SourceKind,
    /// The source's own id: Steam appid, Epic AppName, GOG id, uninstall key name…
    pub source_key: Option<String>,
    pub title: String,
    pub install_path: String,
    /// Exe to start for local launching (also the main exe for playtime).
    pub launch_exe: Option<String>,
    /// Store URI that launches the game through its launcher, when there is one.
    pub launch_uri: Option<String>,
    pub launch_args: Option<String>,
    pub working_dir: Option<String>,
    /// Store URI or command that runs the launcher's own uninstaller. Shelf never deletes files itself.
    pub uninstall_command: Option<String>,
    pub size_bytes: Option<i64>,
    pub size_source: SizeSource,
    /// False when a launcher or Windows still lists the game but its folder is gone.
    pub is_installed: bool,
    /// 0–100. Store installs are 100; detections are scored by the folder classifier.
    pub confidence: u8,
    /// Every exe that counts as playing this game (launcher exe, *-Shipping.exe…).
    pub play_exes: Vec<String>,
    /// Human-readable reasons for the confidence score.
    pub signals: Vec<String>,
    /// Playtime recorded by the launcher before Shelf (Steam's own counter).
    pub imported_play_seconds: i64,
    /// Unix seconds.
    pub imported_last_played: Option<i64>,
}

impl InstallRecord {
    pub fn new(source: SourceKind, title: impl Into<String>, install_path: impl Into<String>) -> Self {
        Self {
            source,
            source_key: None,
            title: title.into(),
            install_path: install_path.into(),
            launch_exe: None,
            launch_uri: None,
            launch_args: None,
            working_dir: None,
            uninstall_command: None,
            size_bytes: None,
            size_source: SizeSource::Unknown,
            is_installed: true,
            confidence: 100,
            play_exes: Vec::new(),
            signals: Vec::new(),
            imported_play_seconds: 0,
            imported_last_played: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceState {
    /// Read fine (possibly zero games).
    Ok,
    /// The launcher isn't on this PC.
    NotInstalled,
    /// Some data read, some couldn't be (missing library drive, unreadable manifest, registry-only fallback).
    Partial,
    /// The launcher is here but its data couldn't be read at all.
    Unreadable,
}

/// What one store reader found, plus an honest sentence for the UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceResult {
    pub source: SourceKind,
    pub state: SourceState,
    pub message: String,
    pub installs: Vec<InstallRecord>,
}

impl SourceResult {
    pub fn new(source: SourceKind, state: SourceState, message: impl Into<String>, installs: Vec<InstallRecord>) -> Self {
        Self { source, state, message: message.into(), installs }
    }

    pub fn not_installed(source: SourceKind, message: impl Into<String>) -> Self {
        Self::new(source, SourceState::NotInstalled, message, Vec::new())
    }

    pub fn unreadable(source: SourceKind, message: impl Into<String>) -> Self {
        Self::new(source, SourceState::Unreadable, message, Vec::new())
    }
}

/// "1 game" / "3 games", "2 libraries".
pub(crate) fn plural(n: usize, word: &str) -> String {
    if n == 1 {
        format!("1 {word}")
    } else if let Some(stem) = word.strip_suffix('y').filter(|s| !s.ends_with(['a', 'e', 'i', 'o', 'u'])) {
        format!("{n} {stem}ies")
    } else {
        format!("{n} {word}s")
    }
}
