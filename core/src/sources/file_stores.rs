//! Launchers whose installs are found in their own files: Xbox app / Game Pass, itch and Amazon Games.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};

use super::SourceReader;
use crate::model::{plural, InstallRecord, SourceKind, SourceResult, SourceState};
use crate::platform::{normalize, SystemContext};

/// Xbox app / PC Game Pass: each drive's `.GamingRoot` names its games folder (default `XboxGames`); every game has
/// `Content\MicrosoftGame.config`.
pub struct XboxReader;

impl SourceReader for XboxReader {
    fn kind(&self) -> SourceKind {
        SourceKind::Xbox
    }

    fn read(&self, ctx: &SystemContext) -> SourceResult {
        let mut installs = Vec::new();
        let mut roots = 0;
        for drive in &ctx.fixed_drives {
            for folder in read_gaming_root(drive) {
                let Ok(games) = fs::read_dir(drive.join(&folder)) else { continue };
                roots += 1;
                for game in games.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
                    let config = game.join("Content").join("MicrosoftGame.config");
                    if let Some(r) = config.is_file().then(|| read_config(&config, &game)).flatten() {
                        installs.push(r);
                    }
                }
            }
        }
        if roots == 0 {
            return SourceResult::not_installed(SourceKind::Xbox, "No Xbox games folder on any drive");
        }
        SourceResult::new(SourceKind::Xbox, SourceState::Ok, plural(installs.len(), "game"), installs)
    }
}

/// `.GamingRoot`: "RGBX", a uint32 count, then null-terminated UTF-16 folder paths relative to the drive.
pub fn read_gaming_root(drive: &Path) -> Vec<String> {
    let mut result = Vec::new();
    if let Ok(bytes) = fs::read(drive.join(".GamingRoot")) {
        if bytes.len() > 8 && &bytes[..4] == b"RGBX" {
            let units: Vec<u16> = bytes[8..].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            let text = String::from_utf16_lossy(&units);
            result.extend(text.split('\0').filter(|s| !s.is_empty()).map(|s| s.trim_start_matches('\\').to_string()));
        }
    }
    if result.is_empty() {
        result.push("XboxGames".into());
    }
    result
}

pub fn read_config(config: &Path, game_dir: &Path) -> Option<InstallRecord> {
    let text = fs::read_to_string(config).ok()?;
    let doc = roxmltree::Document::parse(text.trim_start_matches('\u{feff}')).ok()?;
    let el = |name: &str| doc.descendants().find(|n| n.tag_name().name() == name);
    let identity = el("Identity");
    let visuals = el("ShellVisuals");
    let exe = el("Executable");

    let dir_name = game_dir.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    let title = visuals
        .and_then(|v| v.attribute("DefaultDisplayName"))
        .filter(|n| !n.trim().is_empty() && !n.to_lowercase().starts_with("ms-resource:"))
        .map(str::to_string)
        .unwrap_or(dir_name);

    let content = game_dir.join("Content");
    let mut r = InstallRecord::new(SourceKind::Xbox, title, normalize(&game_dir.to_string_lossy()));
    r.source_key = identity.and_then(|i| i.attribute("Name")).map(str::to_string);
    r.launch_exe = exe.and_then(|e| e.attribute("Name")).map(|n| content.join(n).to_string_lossy().into_owned());
    r.uninstall_command = Some("ms-settings:appsfeatures".into());
    if let (Some(name), Some(publisher), Some(app)) =
        (identity.and_then(|i| i.attribute("Name")), identity.and_then(|i| i.attribute("Publisher")), exe.and_then(|e| e.attribute("Id")))
    {
        r.launch_uri = Some(format!(r"shell:AppsFolder\{name}_{}!{app}", publisher_id(publisher)));
    }
    if let Some(e) = r.launch_exe.clone() {
        r.play_exes.push(e);
    }
    Some(r)
}

/// The 13-character publisher id in a package family name: SHA-256 of the UTF-16 publisher string, first 8 bytes,
/// read as 65 bits (64 + a zero pad bit) in Crockford base32.
pub fn publisher_id(publisher: &str) -> String {
    const ALPHABET: &[u8] = b"0123456789abcdefghjkmnpqrstvwxyz";
    let utf16: Vec<u8> = publisher.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let hash = Sha256::digest(&utf16);
    let n = u64::from_be_bytes(hash[..8].try_into().unwrap());
    // 64 bits + one zero bit = 13 groups of 5.
    let bits = (n as u128) << 1;
    (0..13).rev().map(|i| ALPHABET[((bits >> (i * 5)) & 0x1f) as usize] as char).collect()
}

/// Opens another app's SQLite database without touching it: the file (and its journal) is copied to a temp folder and
/// the copy is read. Opening the original, even read-only, could take locks the owning launcher doesn't expect.
struct Snapshot {
    dir: PathBuf,
    conn: Option<Connection>,
}

impl Snapshot {
    fn open(db: &Path) -> Result<Self, String> {
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

    fn conn(&self) -> &Connection {
        self.conn.as_ref().expect("open")
    }
}

impl Drop for Snapshot {
    fn drop(&mut self) {
        self.conn.take();
        let _ = fs::remove_dir_all(&self.dir);
    }
}

/// itch app: `%APPDATA%\itch\db\butler.db` (caves = installs).
pub struct ItchReader;

impl SourceReader for ItchReader {
    fn kind(&self) -> SourceKind {
        SourceKind::Itch
    }

    fn read(&self, ctx: &SystemContext) -> SourceResult {
        let db = ctx.app_data.join("itch").join("db").join("butler.db");
        if !db.is_file() {
            return if ctx.app_data.join("itch").is_dir() {
                SourceResult::unreadable(SourceKind::Itch, "itch is installed but butler.db wasn't found")
            } else {
                SourceResult::not_installed(SourceKind::Itch, "itch isn't installed")
            };
        }
        match read_itch(&db) {
            Ok(installs) => SourceResult::new(SourceKind::Itch, SourceState::Ok, plural(installs.len(), "game"), installs),
            Err(e) => SourceResult::unreadable(SourceKind::Itch, format!("itch's database couldn't be read ({e})")),
        }
    }
}

fn read_itch(db: &Path) -> Result<Vec<InstallRecord>, String> {
    let snap = Snapshot::open(db)?;
    let mut stmt = snap
        .conn()
        .prepare(
            "SELECT c.id, g.title, c.install_folder_name, l.path, g.classification
             FROM caves c JOIN games g ON g.id = c.game_id
             LEFT JOIN install_locations l ON l.id = c.install_location_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut installs = Vec::new();
    for row in rows {
        let (cave, title, folder, location, class) = row.map_err(|e| e.to_string())?;
        if !class.as_deref().unwrap_or("game").eq_ignore_ascii_case("game") {
            continue;
        }
        let (Some(folder), Some(location)) = (folder, location) else { continue };
        let mut path = Path::new(&location).join(&folder);
        let nested = Path::new(&location).join("apps").join(&folder);
        if !path.is_dir() && nested.is_dir() {
            path = nested;
        }
        let mut r = InstallRecord::new(SourceKind::Itch, title.unwrap_or_else(|| folder.clone()), normalize(&path.to_string_lossy()));
        r.launch_uri = Some(format!("itch://caves/{cave}/launch"));
        r.is_installed = path.is_dir();
        r.source_key = Some(cave);
        installs.push(r);
    }
    Ok(installs)
}

/// Amazon Games: `%LOCALAPPDATA%\Amazon Games\Data\Games\Sql\GameInstallInfo.sqlite`.
pub struct AmazonReader;

impl SourceReader for AmazonReader {
    fn kind(&self) -> SourceKind {
        SourceKind::Amazon
    }

    fn read(&self, ctx: &SystemContext) -> SourceResult {
        let root = ctx.local_app_data.join("Amazon Games");
        let db = root.join("Data").join("Games").join("Sql").join("GameInstallInfo.sqlite");
        if !db.is_file() {
            return if root.is_dir() {
                SourceResult::unreadable(SourceKind::Amazon, "Amazon Games is installed but GameInstallInfo.sqlite wasn't found")
            } else {
                SourceResult::not_installed(SourceKind::Amazon, "Amazon Games isn't installed")
            };
        }
        match read_amazon(&db) {
            Ok(installs) => SourceResult::new(SourceKind::Amazon, SourceState::Ok, plural(installs.len(), "game"), installs),
            Err(e) => SourceResult::unreadable(SourceKind::Amazon, format!("Amazon Games' database couldn't be read ({e})")),
        }
    }
}

fn read_amazon(db: &Path) -> Result<Vec<InstallRecord>, String> {
    let snap = Snapshot::open(db)?;
    let mut stmt = snap.conn().prepare("SELECT Id, ProductTitle, InstallDirectory FROM DbSet WHERE Installed = 1").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, Option<String>>(2)?)))
        .map_err(|e| e.to_string())?;
    let mut installs = Vec::new();
    for row in rows {
        let (id, title, dir) = row.map_err(|e| e.to_string())?;
        let Some(dir) = dir else { continue };
        let path = normalize(&dir);
        let name = Path::new(&path).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
        let mut r = InstallRecord::new(SourceKind::Amazon, title.unwrap_or(name), path.clone());
        r.launch_uri = Some(format!("amazon-games://play/{id}"));
        r.is_installed = Path::new(&path).is_dir();
        r.source_key = Some(id);
        installs.push(r);
    }
    Ok(installs)
}
