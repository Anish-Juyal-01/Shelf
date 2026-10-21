//! Windows' "Installed apps" list: the Uninstall registry keys.

use std::path::Path;

use crate::platform::{exe_from_command, normalize, RegistryView};

#[derive(Debug, Clone, PartialEq)]
pub struct UninstallEntry {
    pub key_name: String,
    pub display_name: String,
    pub publisher: Option<String>,
    pub install_location: Option<String>,
    pub uninstall_string: Option<String>,
    pub display_icon: Option<String>,
    pub system_component: bool,
    pub has_parent: bool,
}

impl UninstallEntry {
    /// InstallLocation, or the folder of DisplayIcon's exe when the installer didn't record one.
    pub fn resolved_location(&self) -> Option<String> {
        if let Some(loc) = self.install_location.as_deref().filter(|l| !l.trim().is_empty()) {
            return Some(normalize(loc));
        }
        let icon = exe_from_command(self.display_icon.as_deref()?)?;
        let lower = icon.to_lowercase();
        if !lower.ends_with(".exe") || lower.contains(r"\windows\installer\") {
            return None;
        }
        let norm = normalize(&icon);
        Path::new(&norm).parent().map(|p| p.to_string_lossy().into_owned()).filter(|p| !p.is_empty())
    }
}

const ROOTS: &[&str] = &[
    r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall",
];

pub fn read(reg: &dyn RegistryView) -> Vec<UninstallEntry> {
    let mut list = Vec::new();
    for root in ROOTS {
        for name in reg.subkey_names(root) {
            let path = format!(r"{root}\{name}");
            let Some(display) = reg.value(&path, "DisplayName").filter(|d| !d.trim().is_empty()) else { continue };
            list.push(UninstallEntry {
                key_name: name,
                display_name: display.trim().to_string(),
                publisher: reg.value(&path, "Publisher").map(|p| p.trim().to_string()),
                install_location: reg.value(&path, "InstallLocation").map(|l| l.trim().trim_matches('"').to_string()),
                uninstall_string: reg.value(&path, "UninstallString"),
                display_icon: reg.value(&path, "DisplayIcon"),
                system_component: reg.value(&path, "SystemComponent").as_deref() == Some("1"),
                has_parent: reg.value(&path, "ParentKeyName").is_some_and(|p| !p.is_empty()),
            });
        }
    }
    list
}
