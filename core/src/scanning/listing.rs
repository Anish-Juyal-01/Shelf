//! One directory's direct children, read with a single enumeration (no per-file stat calls).

use std::path::Path;
use std::time::SystemTime;

#[derive(Debug, Clone, PartialEq)]
pub struct FileEntry {
    pub name: String,
    pub len: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DirEntry {
    pub name: String,
    pub modified: Option<SystemTime>,
}

#[derive(Debug, Clone, Default)]
pub struct DirListing {
    pub path: String,
    pub files: Vec<FileEntry>,
    pub dirs: Vec<DirEntry>,
    /// Junctions/symlinks and cloud-only folders that were deliberately not listed as children.
    pub skipped_links: usize,
}

const REPARSE_POINT: u32 = 0x400;
/// Cloud placeholders (OneDrive "online-only") and offline files: never open or descend, or Windows downloads them.
const CLOUD: u32 = 0x1000 /* OFFLINE */ | 0x0004_0000 /* RECALL_ON_OPEN */ | 0x0040_0000 /* RECALL_ON_DATA_ACCESS */;

impl DirListing {
    pub fn has_dir(&self, name: &str) -> bool {
        self.dirs.iter().any(|d| d.name.eq_ignore_ascii_case(name))
    }

    pub fn has_file(&self, name: &str) -> bool {
        self.files.iter().any(|f| f.name.eq_ignore_ascii_case(name))
    }

    /// Lists a directory; `Err` on access problems so the caller can count them.
    pub fn read(path: &str) -> std::io::Result<Self> {
        let mut listing = DirListing { path: path.to_string(), ..Default::default() };
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            // On Windows, DirEntry::metadata comes from the directory enumeration itself: no extra call per file.
            let Ok(meta) = entry.metadata() else { continue };
            let attrs = attributes(&meta);
            if meta.is_dir() || (attrs & 0x10) != 0 {
                if attrs & (REPARSE_POINT | CLOUD) != 0 {
                    listing.skipped_links += 1;
                    continue;
                }
                listing.dirs.push(DirEntry { name, modified: meta.modified().ok() });
            } else if meta.is_symlink() {
                listing.skipped_links += 1;
            } else {
                listing.files.push(FileEntry { name, len: meta.len() });
            }
        }
        Ok(listing)
    }

    pub fn try_read(path: impl AsRef<Path>) -> Option<Self> {
        Self::read(&path.as_ref().to_string_lossy()).ok()
    }
}

#[cfg(windows)]
fn attributes(meta: &std::fs::Metadata) -> u32 {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes()
}

#[cfg(not(windows))]
fn attributes(meta: &std::fs::Metadata) -> u32 {
    if meta.is_symlink() { REPARSE_POINT } else { 0 }
}
