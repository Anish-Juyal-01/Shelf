//! Steam and Epic readers against fixture folders (ported from the C# SteamReaderTests / EpicReaderTests).

mod support;

use shelf_core::model::{SizeSource, SourceState};
use shelf_core::sources::{epic::EpicReader, steam, steam::SteamReader, SourceReader};
use support::{context, esc, FakeRegistry, TempTree};

fn steam_fixture() -> (TempTree, shelf_core::platform::SystemContext) {
    let t = TempTree::new();
    let steam = t.dir("Program Files (x86)/Steam");
    let lib2 = t.dir("D/SteamLibrary");
    t.text(
        "Program Files (x86)/Steam/steamapps/libraryfolders.vdf",
        &format!(
            r#""libraryfolders"
            {{
                "0" {{ "path" "{}" "apps" {{ "620" "12345" }} }}
                "1" {{ "path" "{}" }}
                "2" {{ "path" "Z:\\NotPluggedIn" }}
            }}"#,
            esc(&steam),
            esc(&lib2)
        ),
    );
    t.text(
        "Program Files (x86)/Steam/steamapps/appmanifest_620.acf",
        r#""AppState" { "appid" "620" "name" "Portal 2" "installdir" "Portal 2" "StateFlags" "4" "SizeOnDisk" "12345" "LastPlayed" "1700000000" }"#,
    );
    t.dir("Program Files (x86)/Steam/steamapps/common/Portal 2");
    t.text(
        "Program Files (x86)/Steam/steamapps/appmanifest_228980.acf",
        r#""AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" "installdir" "Steamworks Shared" "StateFlags" "4" }"#,
    );
    t.text(
        "Program Files (x86)/Steam/steamapps/appmanifest_999.acf",
        r#""AppState" { "appid" "999" "name" "Gone Game" "installdir" "Gone" "StateFlags" "4" }"#,
    );
    t.text(
        "D/SteamLibrary/steamapps/appmanifest_70.acf",
        r#""AppState" { "appid" "70" "name" "Half-Life" "installdir" "Half-Life" "StateFlags" "1026" }"#,
    );
    t.dir("D/SteamLibrary/steamapps/common/Half-Life");
    t.text(
        "Program Files (x86)/Steam/userdata/111/config/localconfig.vdf",
        r#""UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "apps" {
            "620" { "LastPlayed" "1710000000" "Playtime" "90" }
            "730" { "Playtime" "5000" }
        } } } } }"#,
    );
    t.text(
        "Program Files (x86)/Steam/userdata/222/config/localconfig.vdf",
        r#""UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "Apps" { "620" { "Playtime" "30" } } } } } }"#,
    );
    let reg = FakeRegistry::default().set(r"HKLM\SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath", &steam);
    let ctx = context(&t, reg);
    (t, ctx)
}

#[test]
fn steam_reads_libraries_manifests_and_skips_redists() {
    let (_t, ctx) = steam_fixture();
    let result = SteamReader.read(&ctx);

    assert_eq!(result.state, SourceState::Partial);
    assert!(result.message.contains("NotPluggedIn"), "{}", result.message);
    let mut titles: Vec<_> = result.installs.iter().map(|i| i.title.as_str()).collect();
    titles.sort();
    assert_eq!(titles, ["Gone Game", "Half-Life", "Portal 2"]);

    let portal = result.installs.iter().find(|i| i.title == "Portal 2").unwrap();
    assert_eq!(portal.launch_uri.as_deref(), Some("steam://rungameid/620"));
    assert_eq!(portal.uninstall_command.as_deref(), Some("steam://uninstall/620"));
    assert_eq!(portal.size_bytes, Some(12345));
    assert_eq!(portal.size_source, SizeSource::Manifest);
    assert!(portal.is_installed);
    assert!(!result.installs.iter().find(|i| i.title == "Gone Game").unwrap().is_installed);
}

#[test]
fn steam_imports_playtime_summed_across_accounts() {
    let (_t, ctx) = steam_fixture();
    let result = SteamReader.read(&ctx);
    let portal = result.installs.iter().find(|i| i.title == "Portal 2").unwrap();
    assert_eq!(portal.imported_play_seconds, 120 * 60);
    assert_eq!(portal.imported_last_played, Some(1_710_000_000));
}

#[test]
fn steam_flags_unfinished_downloads() {
    let (_t, ctx) = steam_fixture();
    let result = SteamReader.read(&ctx);
    let hl = result.installs.iter().find(|i| i.title == "Half-Life").unwrap();
    assert!(hl.signals.iter().any(|s| s.contains("not finished")));
}

#[test]
fn steam_old_library_format_is_understood() {
    let t = TempTree::new();
    let steam = t.dir("Steam");
    let lib = t.dir("Lib");
    t.text("Steam/steamapps/libraryfolders.vdf", &format!(r#""LibraryFolders" {{ "TimeNextStatsReport" "123" "1" "{}" }}"#, esc(&lib)));
    let (libs, error) = steam::read_library_folders(&steam);
    assert_eq!(error, None);
    assert_eq!(libs.len(), 2);
}

#[test]
fn steam_reports_not_installed() {
    let t = TempTree::new();
    let result = SteamReader.read(&context(&t, FakeRegistry::default()));
    assert_eq!(result.state, SourceState::NotInstalled);
    assert_eq!(result.message, "Steam isn't installed");
}

const MANIFESTS: &str = "ProgramData/Epic/EpicGamesLauncher/Data/Manifests";

fn epic_item(app: &str, display: &str, location: &str, extra: &str) -> String {
    format!(
        r#"{{
          "AppName": "{app}",
          "DisplayName": "{display}",
          "InstallLocation": "{}",
          "LaunchExecutable": "Game/Binaries/Win64/Game.exe",
          "CatalogNamespace": "ns1",
          "CatalogItemId": "item1",
          "InstallSize": 4096,
          "AppCategories": ["public", "games", "applications"]{extra}
        }}"#,
        esc(location)
    )
}

#[test]
fn epic_reads_games_and_skips_dlc_incomplete_and_broken_manifests() {
    let t = TempTree::new();
    let game = t.dir("Epic Games/Hades");
    t.text(&format!("{MANIFESTS}/a.item"), &epic_item("Hades", "Hades", &game, ""));
    t.text(&format!("{MANIFESTS}/b.item"), &epic_item("HadesDLC", "Hades Soundtrack", &game, r#", "MainGameAppName": "Hades""#));
    t.text(&format!("{MANIFESTS}/c.item"), &epic_item("Other", "Half Downloaded", &t.dir("Epic Games/Other"), r#", "bIsIncompleteInstall": true"#));
    t.text(&format!("{MANIFESTS}/d.item"), "{ not json");

    let result = EpicReader.read(&context(&t, FakeRegistry::default()));

    assert_eq!(result.state, SourceState::Partial);
    assert!(result.message.contains("1 manifest couldn't be read"), "{}", result.message);
    assert_eq!(result.installs.len(), 1);
    let hades = &result.installs[0];
    assert_eq!(hades.title, "Hades");
    assert_eq!(hades.launch_uri.as_deref(), Some("com.epicgames.launcher://apps/ns1%3Aitem1%3AHades?action=launch&silent=true"));
    assert_eq!(hades.size_bytes, Some(4096));
    assert!(hades.launch_exe.as_deref().unwrap().ends_with(r"Game\Binaries\Win64\Game.exe"));
}

#[test]
fn epic_no_launcher_is_not_installed() {
    let t = TempTree::new();
    assert_eq!(EpicReader.read(&context(&t, FakeRegistry::default())).state, SourceState::NotInstalled);
}

#[test]
fn epic_launcher_without_manifests_is_reported_honestly() {
    let t = TempTree::new();
    t.dir("ProgramData/Epic/EpicGamesLauncher");
    let result = EpicReader.read(&context(&t, FakeRegistry::default()));
    assert_eq!(result.state, SourceState::Unreadable);
    assert!(result.message.contains("manifests folder wasn't found"));
}

#[test]
fn epic_empty_manifests_folder_says_no_games() {
    let t = TempTree::new();
    t.dir(&format!("{MANIFESTS}/Pending"));
    let result = EpicReader.read(&context(&t, FakeRegistry::default()));
    assert_eq!(result.state, SourceState::Ok);
    assert_eq!(result.message, "Epic Games Launcher found, no games installed");
}
