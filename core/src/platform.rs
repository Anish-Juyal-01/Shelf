//! What the readers need from the machine (registry, known folders, drives), behind a struct so tests can point
//! them at fixture folders and a fake registry.

use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Read-only registry access. Paths start with the hive (`HKLM\SOFTWARE\…`, `HKCU\…`) and are read in the 64-bit
/// view, so `WOW6432Node` paths are written out explicitly.
pub trait RegistryView: Send + Sync {
    fn subkey_names(&self, path: &str) -> Vec<String>;
    /// String or integer value as text; `None` when missing.
    fn value(&self, path: &str, name: &str) -> Option<String>;
}

/// The machine as the readers see it.
#[derive(Clone)]
pub struct SystemContext {
    pub registry: Arc<dyn RegistryView>,
    pub program_data: PathBuf,
    pub app_data: PathBuf,
    pub local_app_data: PathBuf,
    pub program_files: PathBuf,
    pub program_files_x86: PathBuf,
    pub user_profile: PathBuf,
    /// Roots of fixed drives, e.g. `C:\`.
    pub fixed_drives: Vec<PathBuf>,
}

impl SystemContext {
    #[cfg(windows)]
    pub fn real() -> Self {
        let env = |k: &str, fallback: &str| PathBuf::from(std::env::var(k).unwrap_or_else(|_| fallback.to_string()));
        Self {
            registry: Arc::new(WindowsRegistry),
            program_data: env("ProgramData", r"C:\ProgramData"),
            app_data: env("APPDATA", r"C:\Users\Default\AppData\Roaming"),
            local_app_data: env("LOCALAPPDATA", r"C:\Users\Default\AppData\Local"),
            program_files: env("ProgramFiles", r"C:\Program Files"),
            program_files_x86: env("ProgramFiles(x86)", r"C:\Program Files (x86)"),
            user_profile: env("USERPROFILE", r"C:\Users\Default"),
            fixed_drives: fixed_drives(),
        }
    }
}

/// Fixed drive roots C:–Z: (no USB sticks, network or optical drives).
#[cfg(windows)]
fn fixed_drives() -> Vec<PathBuf> {
    (b'C'..=b'Z')
        .map(|c| format!("{}:\\", c as char))
        .filter(|p| is_fixed(p) && std::fs::read_dir(p).is_ok())
        .map(PathBuf::from)
        .collect()
}

#[cfg(windows)]
pub struct WindowsRegistry;

#[cfg(windows)]
impl WindowsRegistry {
    fn open(path: &str) -> Option<winreg::RegKey> {
        use winreg::enums::*;
        let (hive, sub) = path.split_once('\\').unwrap_or((path, ""));
        let root = match hive.to_ascii_uppercase().as_str() {
            "HKLM" | "HKEY_LOCAL_MACHINE" => winreg::RegKey::predef(HKEY_LOCAL_MACHINE),
            "HKCU" | "HKEY_CURRENT_USER" => winreg::RegKey::predef(HKEY_CURRENT_USER),
            _ => return None,
        };
        if sub.is_empty() {
            return Some(root);
        }
        root.open_subkey_with_flags(sub, KEY_READ | KEY_WOW64_64KEY).ok()
    }
}

#[cfg(windows)]
impl RegistryView for WindowsRegistry {
    fn subkey_names(&self, path: &str) -> Vec<String> {
        Self::open(path).map(|k| k.enum_keys().filter_map(Result::ok).collect()).unwrap_or_default()
    }

    fn value(&self, path: &str, name: &str) -> Option<String> {
        use winreg::enums::RegType::*;
        let key = Self::open(path)?;
        let raw = key.get_raw_value(name).ok()?;
        match raw.vtype {
            REG_SZ | REG_EXPAND_SZ => key.get_value::<String, _>(name).ok(),
            REG_MULTI_SZ => key.get_value::<Vec<String>, _>(name).ok().map(|v| v.join(";")),
            REG_DWORD => key.get_value::<u32, _>(name).ok().map(|v| v.to_string()),
            REG_QWORD => key.get_value::<u64, _>(name).ok().map(|v| v.to_string()),
            _ => None,
        }
    }
}

pub const MB: u64 = 1024 * 1024;
pub const GB: u64 = 1024 * MB;

/// "48.6 GB", "709 MB", "12 KB", "512 B" (whole GB from 100 GB up).
pub fn format_bytes(bytes: i64) -> String {
    let b = bytes as f64;
    let (mb, gb) = (MB as f64, GB as f64);
    if b >= gb {
        if b >= 100.0 * gb { format!("{:.0} GB", b / gb) } else { format!("{:.1} GB", b / gb) }
    } else if b >= mb {
        format!("{:.0} MB", b / mb)
    } else if b >= 1024.0 {
        format!("{:.0} KB", b / 1024.0)
    } else {
        format!("{bytes} B")
    }
}

/// Full path with backslashes, no quotes and no trailing separator (except on a drive root).
pub fn normalize(path: &str) -> String {
    let p = path.trim().trim_matches('"').replace('/', "\\");
    if p.is_empty() {
        return p;
    }
    let mut p = std::path::absolute(&p).map(|a| a.to_string_lossy().into_owned()).unwrap_or(p);
    if p.len() > 3 {
        while p.ends_with('\\') {
            p.pop();
        }
    }
    p
}

/// Case-insensitive comparison key for a path.
pub fn path_key(path: &str) -> String {
    normalize(path).to_uppercase()
}

pub fn is_same_or_inside(path: &str, parent: &str) -> bool {
    let a = path_key(path);
    let mut b = path_key(parent);
    if a == b {
        return true;
    }
    if !b.ends_with('\\') {
        b.push('\\');
    }
    a.starts_with(&b)
}

pub fn dir_exists(path: impl AsRef<Path>) -> bool {
    path.as_ref().is_dir()
}

/// Strips a command line down to its exe path: `"C:\x\a.exe" /S` → `C:\x\a.exe`; `C:\x\a.exe,0` → `C:\x\a.exe`.
pub fn exe_from_command(command: &str) -> Option<String> {
    let c = command.trim();
    if c.is_empty() {
        return None;
    }
    if let Some(rest) = c.strip_prefix('"') {
        return rest.find('"').filter(|&e| e > 0).map(|e| rest[..e].to_string());
    }
    if let Some(i) = c.to_ascii_lowercase().find(".exe") {
        if i > 0 {
            return Some(c[..i + 4].to_string());
        }
    }
    Some(c.split(',').next().unwrap_or(c).to_string())
}

// ── Time ────────────────────────────────────────────────────────────────────────────────────────────────

/// Now as unix milliseconds (UTC), the storage format for every timestamp in the database.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Unix milliseconds → `2026-10-21T12:34:56.789Z` (UTC), the format the UI and the C# build use.
pub fn iso_ms(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Civil-from-days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z", rem / 3600, rem % 3600 / 60, rem % 60, ms.rem_euclid(1000))
}

/// `2026-10-21T12:34:56[.fff…][Z]` (treated as UTC) → unix milliseconds.
pub fn parse_iso(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    let num = |r: std::ops::Range<usize>| s.get(r).and_then(|x| x.parse::<i64>().ok());
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hh, mm, ss) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let frac = s.get(19..).and_then(|r| r.strip_prefix('.')).map(|r| r.chars().take_while(char::is_ascii_digit).collect::<String>());
    let millis = frac.map(|f| format!("{f:0<3}")[..3].parse::<i64>().unwrap_or(0)).unwrap_or(0);
    // Days-from-civil.
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400) + hh * 3600 + mm * 60 + ss) * 1000 + millis)
}

// ── Drives and the shell ────────────────────────────────────────────────────────────────────────────────

/// A fixed drive's label and space.
#[derive(Debug, Clone)]
pub struct DriveInfo {
    pub root: String,
    pub label: String,
    pub total_bytes: i64,
    pub free_bytes: i64,
}

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn is_fixed(root: &str) -> bool {
    const DRIVE_FIXED: u32 = 3;
    unsafe { windows_sys::Win32::Storage::FileSystem::GetDriveTypeW(wide(root).as_ptr()) == DRIVE_FIXED }
}

/// Space and label of a fixed drive (`C:\`), or `None` for anything else.
#[cfg(windows)]
pub fn drive_info(root: &str) -> Option<DriveInfo> {
    use windows_sys::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetVolumeInformationW};
    if !is_fixed(root) {
        return None;
    }
    let w = wide(root);
    let (mut free, mut total, mut total_free) = (0u64, 0u64, 0u64);
    if unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut free, &mut total, &mut total_free) } == 0 {
        return None;
    }
    let mut name = [0u16; 261];
    let ok = unsafe {
        GetVolumeInformationW(w.as_ptr(), name.as_mut_ptr(), name.len() as u32, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), 0)
    };
    let label = if ok != 0 { String::from_utf16_lossy(&name[..name.iter().position(|&c| c == 0).unwrap_or(0)]) } else { String::new() };
    Some(DriveInfo {
        root: root.to_string(),
        label: if label.trim().is_empty() { "Local disk".into() } else { label },
        total_bytes: total as i64,
        free_bytes: free as i64,
    })
}

/// Hands a URI, file or folder to Windows (ShellExecute "open"), like double-clicking it.
#[cfg(windows)]
pub fn shell_open(target: &str, args: Option<&str>, dir: Option<&str>) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    const SW_SHOWNORMAL: i32 = 1;
    let (t, a, d, op) = (wide(target), args.map(wide), dir.map(wide), wide("open"));
    let ptr = |v: &Option<Vec<u16>>| v.as_ref().map_or(std::ptr::null(), |v| v.as_ptr());
    let r = unsafe { ShellExecuteW(std::ptr::null_mut(), op.as_ptr(), t.as_ptr(), ptr(&a), ptr(&d), SW_SHOWNORMAL) };
    if r as isize > 32 {
        Ok(())
    } else {
        Err(match r as isize {
            2 | 3 => "the file wasn't found".into(),
            5 => "access was denied".into(),
            31 => "nothing on this PC opens that".into(),
            n => format!("Windows error {n}"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_dates_round_trip() {
        assert_eq!(iso_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_ms(1_710_000_000_123), "2024-03-09T16:00:00.123Z");
        assert_eq!(parse_iso("2024-03-09T16:00:00.1234567Z"), Some(1_710_000_000_123));
        assert_eq!(parse_iso("2025-01-01T00:00:00Z"), Some(1_735_689_600_000));
        assert_eq!(parse_iso("nope"), None);
    }

    #[test]
    fn exe_from_command_strips_args_and_icons() {
        assert_eq!(exe_from_command(r#""C:\x\a.exe" /S"#).as_deref(), Some(r"C:\x\a.exe"));
        assert_eq!(exe_from_command(r"C:\x\a.exe,0").as_deref(), Some(r"C:\x\a.exe"));
        assert_eq!(exe_from_command("  "), None);
    }

    #[test]
    fn paths_compare_case_insensitively() {
        assert!(is_same_or_inside(r"C:\Games\Hades\bin", r"c:\games\HADES\"));
        assert!(!is_same_or_inside(r"C:\Games\Hades2", r"C:\Games\Hades"));
        assert_eq!(normalize("C:/Games/Hades/"), r"C:\Games\Hades");
        assert_eq!(normalize(r"C:\"), r"C:\");
    }
}
