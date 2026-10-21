//! The rules, checked over the source itself: only Shelf's own storage code may write files, and only the metadata
//! code may use the network. Detection code reading game folders can't accidentally change them.

use std::path::{Path, PathBuf};

fn sources() -> Vec<(String, String)> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut out = Vec::new();
    let mut stack: Vec<PathBuf> = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        for e in std::fs::read_dir(&dir).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().is_some_and(|x| x == "rs") {
                let rel = p.strip_prefix(&root).unwrap().to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
                out.push((rel, std::fs::read_to_string(&p).unwrap()));
            }
        }
    }
    out
}

const WRITE_APIS: &[&str] =
    &["fs::write", "File::create", "create_dir", "remove_file", "remove_dir", "fs::rename", "fs::copy", "set_modified", "OpenOptions", "File::options"];

const NETWORK_APIS: &[&str] = &["ureq", "std::net", "TcpStream", "UdpSocket"];

fn offenders(apis: &[&str], allowed: impl Fn(&str) -> bool) -> Vec<String> {
    sources()
        .into_iter()
        .filter(|(rel, _)| !allowed(rel))
        .filter(|(_, text)| apis.iter().any(|a| text.contains(a)))
        .map(|(rel, _)| rel)
        .collect()
}

#[test]
fn only_storage_code_writes_files() {
    let bad = offenders(WRITE_APIS, |rel| rel.starts_with("storage/"));
    assert!(bad.is_empty(), "file-writing APIs outside storage/: {bad:?}");
}

#[test]
fn only_metadata_code_uses_the_network() {
    let bad = offenders(NETWORK_APIS, |rel| rel == "metadata.rs");
    assert!(bad.is_empty(), "network APIs outside metadata.rs: {bad:?}");
}

#[test]
fn guard_actually_sees_the_source() {
    assert!(sources().len() > 20);
}
