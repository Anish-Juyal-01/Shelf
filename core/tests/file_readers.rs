//! Xbox, itch and Amazon readers, and Windows' installed apps (ported from the C# OtherReaderTests).

mod support;

use std::path::Path;

use shelf_core::sources::file_stores::{publisher_id, AmazonReader, ItchReader, XboxReader};
use shelf_core::sources::installed_apps::InstalledAppsReader;
use shelf_core::sources::SourceReader;
use support::{context, games, FakeRegistry, TempTree};

const UNINSTALL: &str = r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";

#[test]
fn xbox_publisher_id_matches_windows() {
    // Microsoft's own publisher hash, as seen in every Microsoft.* package family name.
    assert_eq!(publisher_id("CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US"), "8wekyb3d8bbwe");
}

#[test]
fn xbox_reads_gaming_root_and_config() {
    let t = TempTree::new();
    let mut root = b"RGBX".to_vec();
    root.extend(1u32.to_le_bytes());
    root.extend("MyXbox\0".encode_utf16().flat_map(u16::to_le_bytes));
    std::fs::write(Path::new(&t.dir("drive")).join(".GamingRoot"), root).unwrap();
    t.text(
        "drive/MyXbox/Roblox/Content/MicrosoftGame.config",
        r#"<Game configVersion="1">
          <Identity Name="ROBLOXCorporation.RobloxGDK" Publisher="CN=6FEF9772-62F8-4C8B-8DE0-70F628846515" Version="1.0.0.0" />
          <ExecutableList><Executable Name="RobloxPlayerBeta.exe" Id="Game" /></ExecutableList>
          <ShellVisuals DefaultDisplayName="Roblox" />
        </Game>"#,
    );
    t.dir("drive/MyXbox/GameSave/wgs");

    let result = XboxReader.read(&context(&t, FakeRegistry::default()));
    assert_eq!(result.installs.len(), 1);
    let game = &result.installs[0];
    assert_eq!(game.title, "Roblox");
    let uri = game.launch_uri.as_deref().unwrap();
    assert!(uri.starts_with(r"shell:AppsFolder\ROBLOXCorporation.RobloxGDK_") && uri.ends_with("!Game"), "{uri}");
    assert!(game.launch_exe.as_deref().unwrap().ends_with(r"Content\RobloxPlayerBeta.exe"));
}

fn sql_quote(s: &str) -> String {
    s.replace('\'', "''")
}

#[test]
fn itch_reads_caves_from_a_copy_of_the_database() {
    let t = TempTree::new();
    let apps = t.dir("AppData/itch/apps");
    t.dir("AppData/itch/apps/celeste");
    let db = t.p("AppData/itch/db/butler.db");
    std::fs::create_dir_all(db.parent().unwrap()).unwrap();
    {
        let c = rusqlite::Connection::open(&db).unwrap();
        c.execute_batch(&format!(
            "CREATE TABLE games (id INTEGER, title TEXT, classification TEXT);
             CREATE TABLE install_locations (id TEXT, path TEXT);
             CREATE TABLE caves (id TEXT, game_id INTEGER, install_folder_name TEXT, install_location_id TEXT);
             INSERT INTO games VALUES (1, 'Celeste', 'game'), (2, 'Some Tool', 'tool');
             INSERT INTO install_locations VALUES ('loc', '{}');
             INSERT INTO caves VALUES ('cave-1', 1, 'celeste', 'loc'), ('cave-2', 2, 'tool', 'loc');",
            sql_quote(&apps)
        ))
        .unwrap();
    }
    let before = std::fs::metadata(&db).unwrap().modified().unwrap();

    let result = ItchReader.read(&context(&t, FakeRegistry::default()));
    assert_eq!(result.installs.len(), 1, "{}", result.message);
    let game = &result.installs[0];
    assert_eq!(game.title, "Celeste");
    assert_eq!(game.launch_uri.as_deref(), Some("itch://caves/cave-1/launch"));
    assert!(game.is_installed);
    assert_eq!(std::fs::metadata(&db).unwrap().modified().unwrap(), before, "the launcher's own database must not be touched");
}

#[test]
fn amazon_reads_installed_rows() {
    let t = TempTree::new();
    let db = t.p("LocalAppData/Amazon Games/Data/Games/Sql/GameInstallInfo.sqlite");
    std::fs::create_dir_all(db.parent().unwrap()).unwrap();
    let dir = t.dir("Amazon Games/Library/Fallout 3");
    {
        let c = rusqlite::Connection::open(&db).unwrap();
        c.execute_batch(&format!(
            "CREATE TABLE DbSet (Id TEXT, ProductTitle TEXT, InstallDirectory TEXT, Installed INTEGER);
             INSERT INTO DbSet VALUES ('amzn1.adg', 'Fallout 3', '{}', 1), ('x', 'Old', 'C:\\x', 0);",
            sql_quote(&dir)
        ))
        .unwrap();
    }
    let result = AmazonReader.read(&context(&t, FakeRegistry::default()));
    assert_eq!(result.installs.len(), 1, "{}", result.message);
    assert_eq!(result.installs[0].title, "Fallout 3");
    assert_eq!(result.installs[0].launch_uri.as_deref(), Some("amazon-games://play/amzn1.adg"));
}

#[test]
fn installed_apps_keeps_games_and_stale_repacks_drops_apps() {
    let t = TempTree::new();
    let sekiro = games::loose_repack(&t, "Games/Sekiro Shadows Die Twice GOTY Edition");
    let chatty = games::electron(&t, "Apps/Chatty");
    let k = |name: &str| format!(r"{UNINSTALL}\{name}");
    let reg = FakeRegistry::default()
        .set(&k("Sekiro_is1"), "DisplayName", "Sekiro Shadows Die Twice GOTY Edition")
        .set(&k("Sekiro_is1"), "InstallLocation", &format!("{sekiro}\\"))
        .set(&k("Sekiro_is1"), "UninstallString", &format!("\"{sekiro}\\unins000.exe\""))
        .set(&k("{892D}_is1"), "DisplayName", "F1 22 Champions Edition MULTi11 - ElAmigos version 1.05")
        .set(&k("{892D}_is1"), "Publisher", "Electronic Arts")
        .set(&k("{892D}_is1"), "InstallLocation", &format!("{}\\", t.s("Games/F1 22")))
        .set(&k("Chatty"), "DisplayName", "Chatty")
        .set(&k("Chatty"), "InstallLocation", &chatty)
        .set(&k("Steam App 620"), "DisplayName", "Portal 2")
        .set(&k("Steam App 620"), "InstallLocation", &sekiro)
        .set(&k("{a894}"), "DisplayName", "EA app")
        .set(&k("{a894}"), "Publisher", "Electronic Arts")
        .set(&k("{a894}"), "DisplayIcon", &t.s("Package Cache/x/EAappInstaller.exe"))
        .set(&k("Hidden"), "DisplayName", "Hidden Thing")
        .set(&k("Hidden"), "SystemComponent", "1")
        .set(&k("Hidden"), "InstallLocation", &sekiro);

    let result = InstalledAppsReader.read(&context(&t, reg));

    let titles: Vec<_> = result.installs.iter().map(|i| i.title.as_str()).collect();
    assert_eq!(result.installs.len(), 2, "{titles:?}");
    let s = result.installs.iter().find(|i| i.is_installed).unwrap();
    assert_eq!(s.title, "Sekiro Shadows Die Twice GOTY Edition");
    assert!(s.confidence >= 70, "{}", s.signals.join("\n"));
    assert!(s.launch_exe.as_deref().unwrap().ends_with("sekiro.exe"));
    let f1 = result.installs.iter().find(|i| !i.is_installed).unwrap();
    assert_eq!(f1.title, "F1 22 Champions Edition");
    assert!(result.message.contains("1 listed but their folder is gone"), "{}", result.message);
}
