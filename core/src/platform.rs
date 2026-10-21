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

/// Drive roots C:–Z: that can be listed. (Removable and network drives are filtered out in a later stage, with
/// GetDriveTypeW; the readers only look for launcher folders on each, so a USB stick does no harm meanwhile.)
#[cfg(windows)]
fn fixed_drives() -> Vec<PathBuf> {
    (b'C'..=b'Z')
        .map(|c| PathBuf::from(format!("{}:\\", c as char)))
        .filter(|p| std::fs::read_dir(p).is_ok())
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

#[cfg(test)]
mod tests {
    use super::*;

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
