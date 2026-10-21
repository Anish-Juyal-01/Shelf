//! Folder classifier against miniature game layouts (ported from the C# FolderClassifierTests).

mod support;

use shelf_core::scanning::classifier::{evaluate_path, FolderVerdict, VerdictKind};
use support::{games, TempTree};

fn eval(path: &str) -> FolderVerdict {
    evaluate_path(path, &games::options())
}

fn explain(v: &FolderVerdict) -> String {
    v.signals.join("\n")
}

#[test]
fn unity_game() {
    let t = TempTree::new();
    let v = eval(&games::unity(&t, "Games/Hollow Knight"));
    assert_eq!(v.kind, VerdictKind::Game);
    assert!(v.score >= 70, "{}", explain(&v));
    assert!(v.signals.iter().any(|s| s.contains("Unity engine")));
    assert!(v.launch_exe.as_deref().unwrap().ends_with("hollow_knight.exe"));
    assert!(!v.play_exes.iter().any(|e| e.contains("UnityCrashHandler")));
    assert_eq!(v.title.as_deref(), Some("Hollow Knight"));
}

#[test]
fn unreal_game_outside_a_games_folder() {
    let t = TempTree::new();
    let v = eval(&games::unreal(&t, "Stuff/Stray"));
    assert!(v.score >= 70, "{}", explain(&v));
    assert!(v.launch_exe.as_deref().unwrap().ends_with(r"\Stray.exe"));
    assert!(v.play_exes.iter().any(|e| e.ends_with("Stray-Win64-Shipping.exe")));
}

#[test]
fn loose_repack_with_steam_emulator() {
    let t = TempTree::new();
    let v = eval(&games::loose_repack(&t, "Games/Sekiro Shadows Die Twice GOTY Edition"));
    assert!(v.score >= 70, "{}", explain(&v));
    assert!(v.launch_exe.as_deref().unwrap().ends_with("sekiro.exe"));
    assert!(!v.play_exes.iter().any(|e| e.contains("unins000") || e.contains("vc_redist") || e.contains("DXSETUP")));
}

#[test]
fn exe_in_bin_x64_is_found_from_the_root() {
    let t = TempTree::new();
    let v = eval(&games::bin_x64(&t, "Games/Thing"));
    assert!(v.score >= 70, "{}", explain(&v));
    assert!(v.launch_exe.as_deref().unwrap().ends_with(r"bin\x64\thing.exe"));
    assert_eq!(v.title.as_deref(), Some("Thing"));
}

#[test]
fn electron_app_is_not_a_game() {
    let t = TempTree::new();
    let v = eval(&games::electron(&t, "Games/Chatty"));
    assert_eq!(v.kind, VerdictKind::None);
    assert!(v.signals.iter().any(|s| s.contains("Electron")));
}

#[test]
fn unreal_editor_is_not_a_game() {
    let t = TempTree::new();
    t.file("UE_5.4/Engine/Binaries/Win64/UnrealEditor.exe", 500);
    t.file("UE_5.4/UnrealEditor.exe", 500);
    assert_eq!(eval(&t.s("UE_5.4")).kind, VerdictKind::None);
}

#[test]
fn redist_only_folder_is_nothing() {
    let t = TempTree::new();
    t.file("_CommonRedist/vcredist/vc_redist.x64.exe", 5000);
    t.file("_CommonRedist/DirectX/DXSETUP.exe", 5000);
    assert_eq!(eval(&t.s("_CommonRedist/vcredist")).kind, VerdictKind::None);
    assert_eq!(eval(&t.s("_CommonRedist/DirectX")).kind, VerdictKind::None);
}

#[test]
fn unrun_installer_is_a_leftover() {
    let t = TempTree::new();
    let v = eval(&games::fitgirl_installer(&t, "Downloads/Elden Ring [FitGirl Repack]"));
    assert_eq!(v.kind, VerdictKind::Installer);
    assert_eq!(v.title.as_deref(), Some("Elden Ring"));
}

#[test]
fn plain_exe_is_too_weak_alone() {
    let t = TempTree::new();
    t.file("Tools/thing/thing.exe", 500);
    assert_eq!(eval(&t.s("Tools/thing")).kind, VerdictKind::None);
}
