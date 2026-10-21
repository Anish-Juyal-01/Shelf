//! Read-only snapshots of other apps' SQLite databases (itch, Amazon Games). The copy lives in Shelf's own temp
//! folder and is deleted afterwards; the original is never opened.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::{Connection, OpenFlags};

/// Opens another app's SQLite database without touching it: the file (and its journal) is copied to a temp folder and
/// the copy is read. Opening the original, even read-only, could take locks the owning launcher doesn't expect.
pub struct Snapshot {
    dir: PathBuf,
    conn: Option<Connection>,
}

impl Snapshot {
    pub fn open(db: &Path) -> Result<Self, String> {
        static N: AtomicU64 = AtomicU64::new(0);
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let dir = std::env::temp_dir().join("Shelf").join(format!("snap-{}-{stamp}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let name = db.file_name().ok_or("no file name")?;
        let copy = dir.join(name);
        let mut snap = Self { dir, conn: None };
        fs::copy(db, &copy).map_err(|e| e.to_string())?;
        for suffix in ["-wal", "-shm"] {
            let from = PathBuf::from(format!("{}{suffix}", db.display()));
            if from.is_file() {
                let _ = fs::copy(&from, PathBuf::from(format!("{}{suffix}", copy.display())));
            }
        }
        snap.conn = Some(Connection::open_with_flags(&copy, OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(|e| e.to_string())?);
        Ok(snap)
    }

    pub fn conn(&self) -> &Connection {
        self.conn.as_ref().expect("open")
    }
}

impl Drop for Snapshot {
    fn drop(&mut self) {
        self.conn.take();
        let _ = fs::remove_dir_all(&self.dir);
    }
}
