//! Art that's already on this PC — no network: Steam's library cache (covers, hero images and logos for every game it
//! knows) and the logo/splash images Xbox games ship with. Read-only.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::model::SourceKind;
use crate::platform::{is_same_or_inside, SystemContext};
use crate::sources::steam;
use crate::storage::library::InstallRow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ArtKind {
    /// Portrait box art (2:3).
    Cover,
    /// Wide background art.
    Hero,
    /// Transparent title logo.
    Logo,
    /// Square program icon.
    Icon,
}

impl ArtKind {
    pub const ALL: [ArtKind; 4] = [Self::Cover, Self::Hero, Self::Logo, Self::Icon];

    /// File name stem in the art cache (`cover.jpg`).
    pub fn name(self) -> &'static str {
        match self {
            Self::Cover => "cover",
            Self::Hero => "hero",
            Self::Logo => "logo",
            Self::Icon => "icon",
        }
    }
}

pub type FoundArt = BTreeMap<ArtKind, PathBuf>;

pub struct ArtLocator {
    steam_cache: Option<PathBuf>,
}

impl ArtLocator {
    pub fn new(ctx: &SystemContext) -> Self {
        Self { steam_cache: steam::find_steam_path(ctx).map(|s| Path::new(&s).join("appcache").join("librarycache")) }
    }

    pub fn find(&self, install: &InstallRow) -> FoundArt {
        let mut found = FoundArt::new();
        if install.source == SourceKind::Steam {
            if let (Some(uri), Some(cache)) = (&install.launch_uri, &self.steam_cache) {
                find_steam(cache, uri.rsplit('/').next().unwrap_or(""), &mut found);
            }
        }
        if install.source == SourceKind::Xbox {
            find_xbox(Path::new(&install.install_path), &mut found);
        }
        found
    }
}

/// Steam keeps art in `librarycache\<appid>\<hash>\library_capsule.jpg` (newer clients) or
/// `librarycache\<appid>_library_600x900.jpg` (older ones).
pub fn find_steam(cache: &Path, app_id: &str, found: &mut FoundArt) {
    if app_id.is_empty() || !app_id.bytes().all(|b| b.is_ascii_digit()) || !cache.is_dir() {
        return;
    }
    let dir = cache.join(app_id);
    if dir.is_dir() {
        let mut files = Vec::new();
        all_files(&dir, &mut files, 0);
        for f in files {
            let name = f.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            let kind = match name.as_str() {
                "library_capsule.jpg" | "library_600x900.jpg" | "library_600x900_2x.jpg" => ArtKind::Cover,
                "library_hero.jpg" => ArtKind::Hero,
                "logo.png" => ArtKind::Logo,
                _ => continue,
            };
            found.entry(kind).or_insert(f);
        }
    }
    for (file, kind) in [
        (format!("{app_id}_library_600x900.jpg"), ArtKind::Cover),
        (format!("{app_id}_library_hero.jpg"), ArtKind::Hero),
        (format!("{app_id}_logo.png"), ArtKind::Logo),
    ] {
        let p = cache.join(file);
        if p.is_file() {
            found.entry(kind).or_insert(p);
        }
    }
}

fn all_files(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let Ok(t) = e.file_type() else { continue };
        if t.is_dir() && depth < 4 {
            all_files(&e.path(), out, depth + 1);
        } else if t.is_file() {
            out.push(e.path());
        }
    }
}

/// Xbox games name their images in MicrosoftGame.config (square logo, splash screen).
pub fn find_xbox(game_dir: &Path, found: &mut FoundArt) {
    let content = game_dir.join("Content");
    let Ok(text) = std::fs::read_to_string(content.join("MicrosoftGame.config")) else { return };
    let Ok(doc) = roxmltree::Document::parse(text.trim_start_matches('\u{feff}')) else { return };
    let Some(visuals) = doc.descendants().find(|n| n.tag_name().name() == "ShellVisuals") else { return };
    let content_s = content.to_string_lossy().into_owned();
    for (attr, kind) in [("Square480x480Logo", ArtKind::Icon), ("Square150x150Logo", ArtKind::Icon), ("SplashScreenImage", ArtKind::Hero)] {
        let Some(rel) = visuals.attribute(attr) else { continue };
        let joined = content.join(rel.replace('/', "\\"));
        let Ok(p) = std::path::absolute(&joined) else { continue };
        let p = PathBuf::from(crate::platform::normalize(&p.to_string_lossy()));
        if is_same_or_inside(&p.to_string_lossy(), &content_s) && p.is_file() {
            found.entry(kind).or_insert(p);
        }
    }
}
