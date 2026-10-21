//! Test helpers: a throwaway folder tree and a fake registry, so readers run against fixtures, not this PC.

#![allow(dead_code)]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use shelf_core::platform::{RegistryView, SystemContext};

pub struct TempTree {
    dir: tempfile::TempDir,
}

impl TempTree {
    pub fn new() -> Self {
        Self { dir: tempfile::tempdir().expect("temp dir") }
    }

    pub fn p(&self, rel: &str) -> PathBuf {
        self.dir.path().join(rel.replace('/', "\\"))
    }

    /// Creates the folder (and parents); returns its full path as a string.
    pub fn dir(&self, rel: &str) -> String {
        let p = self.p(rel);
        std::fs::create_dir_all(&p).unwrap();
        p.to_string_lossy().into_owned()
    }

    pub fn text(&self, rel: &str, content: &str) -> String {
        let p = self.p(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, content).unwrap();
        p.to_string_lossy().into_owned()
    }

    /// A file of `bytes` zero bytes; returns its full path.
    pub fn file(&self, rel: &str, bytes: usize) -> String {
        let p = self.p(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, vec![0u8; bytes]).unwrap();
        p.to_string_lossy().into_owned()
    }

    /// Path as a string, without creating anything.
    pub fn s(&self, rel: &str) -> String {
        self.p(rel).to_string_lossy().into_owned()
    }

    pub fn root(&self) -> &Path {
        self.dir.path()
    }
}

/// Miniature copies of real game layouts. "Large" data is 5 KB; tests use [`games::options`] with a 1 KB threshold.
pub mod games {
    use super::TempTree;

    pub fn options() -> shelf_core::scanning::classifier::ClassifierOptions {
        shelf_core::scanning::classifier::ClassifierOptions { large_data_bytes: 1000, ..Default::default() }
    }

    pub fn unity(t: &TempTree, rel: &str) -> String {
        t.file(&format!("{rel}/hollow_knight.exe"), 600);
        t.file(&format!("{rel}/UnityPlayer.dll"), 16);
        t.file(&format!("{rel}/UnityCrashHandler64.exe"), 16);
        t.file(&format!("{rel}/hollow_knight_Data/sharedassets0.assets"), 5000);
        t.file(&format!("{rel}/hollow_knight_Data/globalgamemanagers"), 16);
        t.file(&format!("{rel}/MonoBleedingEdge/EmbedRuntime/mono-2.0-bdwgc.dll"), 16);
        t.s(rel)
    }

    pub fn unreal(t: &TempTree, rel: &str) -> String {
        t.file(&format!("{rel}/Stray.exe"), 300);
        t.file(&format!("{rel}/Engine/Binaries/ThirdParty/PhysX3/Win64/PhysX3_x64.dll"), 16);
        t.file(&format!("{rel}/Hk_project/Binaries/Win64/Stray-Win64-Shipping.exe"), 900);
        t.file(&format!("{rel}/Hk_project/Content/Paks/Hk_project-WindowsNoEditor.pak"), 5000);
        t.s(rel)
    }

    /// A FromSoftware-style loose copy: exe, Steam emulator files, big .bdt archives, an uninstaller.
    pub fn loose_repack(t: &TempTree, rel: &str) -> String {
        t.file(&format!("{rel}/sekiro.exe"), 800);
        for f in ["steam_api64.dll", "steam_emu.ini", "fmod_event64.dll", "bink2w64.dll", "Data1.bhd", "unins000.exe"] {
            t.file(&format!("{rel}/{f}"), 16);
        }
        t.file(&format!("{rel}/Data1.bdt"), 5000);
        t.file(&format!("{rel}/_CommonRedist/vcredist/2015/vc_redist.x64.exe"), 16);
        t.file(&format!("{rel}/_CommonRedist/DirectX/Jun2010/DXSETUP.exe"), 16);
        t.s(rel)
    }

    /// Exe in bin\x64 (Witcher/Cyberpunk layout) with data one level under the root.
    pub fn bin_x64(t: &TempTree, rel: &str) -> String {
        t.file(&format!("{rel}/bin/x64/thing.exe"), 700);
        t.file(&format!("{rel}/bin/x64/steam_api64.dll"), 16);
        t.file(&format!("{rel}/bin/x64/bink2w64.dll"), 16);
        t.file(&format!("{rel}/archives/basegame.archive"), 5000);
        t.s(rel)
    }

    pub fn electron(t: &TempTree, rel: &str) -> String {
        t.file(&format!("{rel}/Chatty.exe"), 900);
        t.file(&format!("{rel}/chrome_100_percent.pak"), 16);
        t.file(&format!("{rel}/resources.pak"), 5000);
        t.file(&format!("{rel}/v8_context_snapshot.bin"), 16);
        t.file(&format!("{rel}/ffmpeg.dll"), 16);
        t.file(&format!("{rel}/resources/app.asar"), 3000);
        t.file(&format!("{rel}/locales/en-US.pak"), 16);
        t.s(rel)
    }

    pub fn fitgirl_installer(t: &TempTree, rel: &str) -> String {
        t.file(&format!("{rel}/setup.exe"), 200);
        t.file(&format!("{rel}/fg-01.bin"), 3000);
        t.file(&format!("{rel}/fg-02.bin"), 3000);
        t.file(&format!("{rel}/MD5/QuickSFV.exe"), 16);
        t.s(rel)
    }
}

/// Keys keep their original spelling (as Windows does) but are looked up case-insensitively.
#[derive(Default)]
pub struct FakeRegistry {
    keys: Mutex<Vec<(String, HashMap<String, String>)>>,
}

impl FakeRegistry {
    pub fn set(self, path: &str, name: &str, value: &str) -> Self {
        {
            let mut keys = self.keys.lock().unwrap();
            let i = match keys.iter().position(|(k, _)| k.eq_ignore_ascii_case(path)) {
                Some(i) => i,
                None => {
                    keys.push((path.to_string(), HashMap::new()));
                    keys.len() - 1
                }
            };
            keys[i].1.insert(name.to_lowercase(), value.to_string());
        }
        self
    }
}

impl RegistryView for FakeRegistry {
    fn subkey_names(&self, path: &str) -> Vec<String> {
        let prefix = format!("{}\\", path.trim_end_matches('\\')).to_lowercase();
        let mut names: Vec<String> = Vec::new();
        for (k, _) in self.keys.lock().unwrap().iter() {
            if k.to_lowercase().starts_with(&prefix) {
                let name = k[prefix.len()..].split('\\').next().unwrap().to_string();
                if !names.iter().any(|n| n.eq_ignore_ascii_case(&name)) {
                    names.push(name);
                }
            }
        }
        names
    }

    fn value(&self, path: &str, name: &str) -> Option<String> {
        let keys = self.keys.lock().unwrap();
        keys.iter().find(|(k, _)| k.eq_ignore_ascii_case(path))?.1.get(&name.to_lowercase()).cloned()
    }
}

pub fn context(t: &TempTree, registry: FakeRegistry) -> SystemContext {
    SystemContext {
        registry: Arc::new(registry),
        program_data: t.dir("ProgramData").into(),
        app_data: t.dir("AppData").into(),
        local_app_data: t.dir("LocalAppData").into(),
        program_files: t.dir("Program Files").into(),
        program_files_x86: t.dir("Program Files (x86)").into(),
        user_profile: t.dir("User").into(),
        fixed_drives: vec![t.dir("drive").into()],
    }
}

/// A path written inside a VDF string (backslashes escaped).
pub fn esc(path: &str) -> String {
    path.replace('\\', "\\\\")
}
