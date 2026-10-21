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

    pub fn root(&self) -> &Path {
        self.dir.path()
    }
}

#[derive(Default)]
pub struct FakeRegistry {
    keys: Mutex<HashMap<String, HashMap<String, String>>>,
}

impl FakeRegistry {
    pub fn set(self, path: &str, name: &str, value: &str) -> Self {
        self.keys.lock().unwrap().entry(path.to_lowercase()).or_default().insert(name.to_lowercase(), value.to_string());
        self
    }
}

impl RegistryView for FakeRegistry {
    fn subkey_names(&self, path: &str) -> Vec<String> {
        let prefix = format!("{}\\", path.trim_end_matches('\\').to_lowercase());
        let mut names: Vec<String> = self
            .keys
            .lock()
            .unwrap()
            .keys()
            .filter_map(|k| k.strip_prefix(&prefix).map(|rest| rest.split('\\').next().unwrap().to_string()))
            .collect();
        names.sort();
        names.dedup();
        names
    }

    fn value(&self, path: &str, name: &str) -> Option<String> {
        self.keys.lock().unwrap().get(&path.to_lowercase())?.get(&name.to_lowercase()).cloned()
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
