//! Shelf's own copy of each game's art: `%LOCALAPPDATA%\Shelf\art\<gameId>\cover.jpg` etc. The UI only ever reads from
//! here, so showing art never touches launcher or game folders. Copies are refreshed when the source changes.

use std::fs::{self, File};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::ShelfPaths;
use crate::art::{ArtKind, FoundArt};
use crate::platform::{iso_ms, parse_iso};

/// Biggest art file Shelf will copy.
const MAX_ART_BYTES: u64 = 20 * 1024 * 1024;

/// When a game's art was last looked up on the web, what it matched, and whether SteamGridDB was used. Stored as
/// `web.json` in the C# build's shape.
#[derive(Debug, Clone, PartialEq)]
pub struct WebLookup {
    /// Unix ms.
    pub tried: i64,
    pub matched: Option<String>,
    pub with_grid: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WebLookupFile {
    tried: String,
    #[serde(rename = "Match")]
    matched: Option<String>,
    with_grid: bool,
}

#[derive(Debug, Clone)]
pub struct ArtCache {
    pub root: PathBuf,
}

fn file_name(kind: ArtKind, ext: &str) -> String {
    format!("{}{}", kind.name(), ext.to_lowercase())
}

impl ArtCache {
    pub fn new(paths: &ShelfPaths) -> Self {
        Self { root: paths.cache_dir.join("art") }
    }

    fn dir(&self, game_id: i64) -> PathBuf {
        self.root.join(game_id.to_string())
    }

    /// Copies any new or changed art for a game. Returns true when something changed.
    pub fn store(&self, game_id: i64, sources: &FoundArt) -> bool {
        let dir = self.dir(game_id);
        let mut changed = false;
        for (&kind, source) in sources {
            let ext = source.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
            let target = dir.join(file_name(kind, &ext));
            let Ok(info) = fs::metadata(source) else { continue };
            if !info.is_file() || info.len() > MAX_ART_BYTES {
                continue;
            }
            if let Ok(t) = fs::metadata(&target) {
                if t.len() == info.len() && t.modified().ok() == info.modified().ok() {
                    continue;
                }
            }
            if copy_art(source, &target, &dir, kind, info.modified().ok()).is_ok() {
                changed = true;
            }
        }
        changed
    }

    /// Saves downloaded or generated art (a web cover, an extracted exe icon) for a game.
    pub fn write(&self, game_id: i64, kind: ArtKind, ext: &str, bytes: &[u8]) -> std::io::Result<()> {
        let dir = self.dir(game_id);
        fs::create_dir_all(&dir)?;
        let target = dir.join(file_name(kind, ext));
        remove_other_extensions(&dir, kind, &target);
        let tmp = with_tmp(&target);
        fs::write(&tmp, bytes)?;
        fs::rename(&tmp, &target)
    }

    pub fn has(&self, game_id: i64, kind: ArtKind) -> bool {
        self.get(game_id, kind).is_some()
    }

    /// The cached file for a game's art, if any.
    pub fn get(&self, game_id: i64, kind: ArtKind) -> Option<PathBuf> {
        let prefix = format!("{}.", kind.name());
        let mut files: Vec<PathBuf> = fs::read_dir(self.dir(game_id))
            .ok()?
            .flatten()
            .filter(|e| {
                let n = e.file_name().to_string_lossy().to_lowercase();
                n.starts_with(&prefix) && !n.ends_with(".tmp")
            })
            .map(|e| e.path())
            .collect();
        files.sort();
        files.into_iter().next()
    }

    pub fn web_mark(&self, game_id: i64) -> Option<WebLookup> {
        let text = fs::read_to_string(self.dir(game_id).join("web.json")).ok()?;
        let f: WebLookupFile = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
        Some(WebLookup { tried: parse_iso(&f.tried)?, matched: f.matched, with_grid: f.with_grid })
    }

    pub fn mark_web(&self, game_id: i64, mark: &WebLookup) -> std::io::Result<()> {
        let dir = self.dir(game_id);
        fs::create_dir_all(&dir)?;
        let f = WebLookupFile { tried: iso_ms(mark.tried), matched: mark.matched.clone(), with_grid: mark.with_grid };
        fs::write(dir.join("web.json"), serde_json::to_vec(&f).map_err(std::io::Error::other)?)
    }

    /// Forget a game's last web lookup, so it's tried again.
    pub fn forget_web(&self, game_id: i64) {
        let _ = fs::remove_file(self.dir(game_id).join("web.json"));
    }

    /// Resolves a request like `12/cover.jpg` to a file inside the cache — nothing outside it, ever.
    pub fn resolve(&self, relative: &str) -> Option<PathBuf> {
        let parts: Vec<&str> = relative.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
        let [id, name] = parts[..] else { return None };
        if id.parse::<i64>().is_err() || name.contains("..") || name.contains(':') || name.to_lowercase().ends_with(".json") {
            return None;
        }
        let full = self.root.join(id).join(name);
        full.is_file().then_some(full)
    }
}

fn with_tmp(target: &Path) -> PathBuf {
    let mut s = target.as_os_str().to_owned();
    s.push(".tmp");
    PathBuf::from(s)
}

/// Removes a stale copy with another extension (e.g. .png → .jpg).
fn remove_other_extensions(dir: &Path, kind: ArtKind, keep: &Path) {
    let prefix = format!("{}.", kind.name());
    for e in fs::read_dir(dir).into_iter().flatten().flatten() {
        let n = e.file_name().to_string_lossy().to_lowercase();
        if n.starts_with(&prefix) && !e.path().as_os_str().eq_ignore_ascii_case(keep.as_os_str()) {
            let _ = fs::remove_file(e.path());
        }
    }
}

fn copy_art(source: &Path, target: &Path, dir: &Path, kind: ArtKind, modified: Option<std::time::SystemTime>) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    remove_other_extensions(dir, kind, target);
    let tmp = with_tmp(target);
    fs::copy(source, &tmp)?;
    fs::rename(&tmp, target)?;
    if let Some(m) = modified {
        File::options().write(true).open(target)?.set_modified(m)?;
    }
    Ok(())
}
