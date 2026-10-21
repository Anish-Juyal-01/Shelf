//! Shelf's own data: settings and caches as JSON, the library and playtime in SQLite. Nothing is ever written anywhere
//! else (and never inside game folders). The files and their formats are the ones the C# build used, so switching
//! builds keeps everything.

pub mod art_cache;
pub mod db;
pub mod library;
pub mod sessions;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::scanning::cache::ScanCache;

/// Where Shelf keeps its files. `SHELF_DATA_DIR` moves both folders under one directory (tests, portable use).
#[derive(Debug, Clone)]
pub struct ShelfPaths {
    /// Settings and the database: `%APPDATA%\Shelf`.
    pub data_dir: PathBuf,
    /// Disposable caches (art, scan results): `%LOCALAPPDATA%\Shelf`.
    pub cache_dir: PathBuf,
}

impl ShelfPaths {
    pub fn default_paths() -> Self {
        if let Some(dir) = std::env::var_os("SHELF_DATA_DIR").filter(|d| !d.is_empty()) {
            let dir = PathBuf::from(dir);
            return Self { cache_dir: dir.join("cache"), data_dir: dir };
        }
        let env = |k: &str| PathBuf::from(std::env::var_os(k).unwrap_or_default());
        Self { data_dir: env("APPDATA").join("Shelf"), cache_dir: env("LOCALAPPDATA").join("Shelf") }
    }

    pub fn in_dir(dir: impl AsRef<Path>) -> Self {
        let dir = dir.as_ref();
        Self { data_dir: dir.join("data"), cache_dir: dir.join("cache") }
    }

    pub fn settings_file(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }

    pub fn db_file(&self) -> PathBuf {
        self.data_dir.join("shelf.db")
    }

    pub fn scan_cache_file(&self) -> PathBuf {
        self.cache_dir.join("scan-cache.json")
    }
}

/// Reads a JSON file; a missing or unreadable one gives the default.
pub fn load_json<T: DeserializeOwned + Default>(path: &Path) -> T {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()).unwrap_or_default()
}

/// Atomic save: write `.tmp`, then replace.
pub fn save_json<T: Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(value).map_err(std::io::Error::other)?)?;
    std::fs::rename(&tmp, path)
}

/// User settings (`settings.json`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub scan_roots: Vec<String>,
    /// system | light | dark
    pub theme: String,
    /// Colour theme: sunset | aurora | neon | dune | deepsea | sakura | onyx | ember | volt | cobalt | crimson | gold.
    pub palette: String,
    /// wheel | ring — how the library hero shows your games.
    pub hero_style: String,
    pub runtime_detection: bool,
    pub watch_folders: bool,
    pub close_to_tray: bool,
    /// Look up missing art online (Steam store search; SteamGridDB too when a key is set).
    pub web_art: bool,
    /// Optional SteamGridDB API key. Kept only in this file; never sent to the UI.
    pub steam_grid_db_key: Option<String>,
    /// First run done: scan folders were offered once.
    pub onboarding_done: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            scan_roots: Vec::new(),
            theme: "system".into(),
            palette: "sunset".into(),
            hero_style: "wheel".into(),
            runtime_detection: true,
            watch_folders: true,
            close_to_tray: true,
            web_art: true,
            steam_grid_db_key: None,
            onboarding_done: false,
        }
    }
}

impl Settings {
    pub fn load(paths: &ShelfPaths) -> Self {
        load_json(&paths.settings_file())
    }

    pub fn save(&self, paths: &ShelfPaths) -> std::io::Result<()> {
        save_json(&paths.settings_file(), self)
    }
}

/// A measured install size, valid while the folder's modified time is unchanged.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeEntry {
    pub dir_stamp: i64,
    pub size_bytes: i64,
}

/// `scan-cache.json`: what the folder scanner decided per folder, and measured sizes of launcher installs.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct CacheFile {
    pub folders: ScanCache,
    pub sizes: Mutex<HashMap<String, SizeEntry>>,
}

impl CacheFile {
    pub fn load(paths: &ShelfPaths) -> Self {
        load_json(&paths.scan_cache_file())
    }

    pub fn save(&self, paths: &ShelfPaths) -> std::io::Result<()> {
        save_json(&paths.scan_cache_file(), self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_read_the_csharp_file_and_fill_gaps() {
        let dir = tempfile::tempdir().unwrap();
        let paths = ShelfPaths::in_dir(dir.path());
        std::fs::create_dir_all(&paths.data_dir).unwrap();
        std::fs::write(paths.settings_file(), "\u{feff}{\n  \"scanRoots\": [\"D:\\\\Games\"],\n  \"theme\": \"dark\",\n  \"webArt\": false\n}").unwrap();
        let s = Settings::load(&paths);
        assert_eq!(s.scan_roots, [r"D:\Games"]);
        assert_eq!(s.theme, "dark");
        assert!(!s.web_art);
        assert_eq!(s.palette, "sunset");
        assert!(s.close_to_tray);

        s.save(&paths).unwrap();
        assert_eq!(Settings::load(&paths), s);
        assert!(std::fs::read_to_string(paths.settings_file()).unwrap().contains("\"scanRoots\""));
    }

    #[test]
    fn broken_files_give_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let paths = ShelfPaths::in_dir(dir.path());
        assert_eq!(Settings::load(&paths), Settings::default());
        std::fs::create_dir_all(&paths.cache_dir).unwrap();
        std::fs::write(paths.scan_cache_file(), "{\"Entries\": 5}").unwrap();
        assert!(CacheFile::load(&paths).folders.is_empty());
    }
}
