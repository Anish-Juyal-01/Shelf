//! Sorts exes into noise (installers, redists, crash reporters, launcher helpers), known apps, known games and the rest.

use std::sync::LazyLock;

use fancy_regex::Regex;

/// Exes that are never the game itself. Matched against the file name without ".exe".
static NOISE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?ix)^(
          unins\d*|uninst.*|uninstall.*|
          setup.*|.*[-_\ ]setup|install|installer|.*installer.*|
          vc_?redist.*|vcredist.*|dxsetup|dxwebsetup|directx.*|dotnet.*|ndp\d.*|netfx.*|oalinst|physx.*|xnafx.*|
          ue\d?prereqsetup.*|ueprereqsetup.*|prereq.*|redist.*|.*_redist|
          crashreport.*|.*crashhandler.*|crashpad_handler|.*crash_?reporter.*|crashsender.*|bugsplat.*|bssndrpt.*|
          unitycrashhandler(32|64)?|
          easyanticheat.*|start_protected_game|battleye.*|beservice.*|be_service|eac_launcher|
          .*updater.*|update|patcher|.*launcherpatcher.*|repair|cleanup|touchup|activation|register|registration|
          elevate.*|.*_?helper|notification_helper|cefsharp.*|cefprocess|qtwebengineprocess|zfgamebrowser|
          quicksfv|7z.*|unrar|winrar|dxdiag|vulkan.*|ffmpeg|
          steamerrorreporter.*|steamservice|gameoverlayui.*|steam_?api.*|
          dowser|unitycrashhandler64|ubisoftgamelauncher.*|uplaywebcore|upc|
          ue4-?game|.*-debug|.*_debug|.*-cmd
        )$",
    )
    .expect("valid pattern")
});

/// Programs that look game-ish (engines, launchers, big data) but aren't games.
const KNOWN_APPS: &[&str] = &[
    "unrealeditor", "ue4editor", "ue5editor", "unity", "unity hub", "blender", "code", "cursor", "discord", "obs64", "obs32",
    "steam", "steamwebhelper", "epicgameslauncher", "eadesktop", "eabackgroundservice", "origin", "galaxyclient",
    "battle.net", "battle.net launcher", "riotclientservices", "riotclientux", "vlc", "chrome", "msedge", "firefox",
    "brave", "opera", "java", "javaw", "python", "pythonw", "node", "devenv", "idea64", "studio64", "figma",
    "robloxstudiobeta", "robloxstudiolauncherbeta", "handbrake", "resolve", "wallpaper32", "wallpaper64", "medal",
    "parsecd", "powertoys", "wiztree", "wiztree64", "7zfm", "nvidia app", "hoyoplay", "spotify", "teams", "zoom",
    "tlauncher", "minecraft launcher", // the Java launcher; the Xbox one is read by the Xbox reader
    "godot", "rpgmaker", "rpgmv", "rpgmz", "gamemaker", "renpy", "lovely", "cheatengine", "cheatengine-x86_64", "wemod",
    "msiafterburner", "rtss", "nvcontainer", "voicemod", "signalrgb", "ollama", "docker desktop",
];

/// Games with no engine fingerprint worth checking for.
const KNOWN_GAMES: &[&str] = &[
    "robloxplayerbeta", "minecraft.windows", "osu!", "league of legends", "valorant", "valorant-win64-shipping",
    "terraria", "stardew valley", "factorio", "dota2", "cs2", "csgo", "hl2", "rocketleague", "gta5", "gtavlauncher",
    "rdr2", "eldenring", "sekiro", "darksoulsiii", "darksoulsremastered", "witcher3", "cyberpunk2077",
];

pub fn stem(exe: &str) -> &str {
    if exe.len() > 4 && exe.get(exe.len() - 4..).is_some_and(|e| e.eq_ignore_ascii_case(".exe")) {
        &exe[..exe.len() - 4]
    } else {
        exe
    }
}

pub fn is_exe(name: &str) -> bool {
    name.len() > 4 && name.get(name.len() - 4..).is_some_and(|e| e.eq_ignore_ascii_case(".exe"))
}

pub fn is_noise(exe: &str) -> bool {
    NOISE.is_match(stem(exe)).unwrap_or(false)
}

pub fn is_known_app(exe: &str) -> bool {
    let s = stem(exe);
    KNOWN_APPS.iter().any(|a| a.eq_ignore_ascii_case(s))
}

/// Launchers, store helpers and anti-cheat that run while you play (or all day) but are never the game. Used only by
/// playtime tracking — not by the folder classifier, since plenty of game folders ship a "Launcher.exe" of their own.
const NEVER_PLAYING: &[&str] = &[
    "riotclientservices", "riotclientux", "riotclientcrashhandler", "riotclient", "leagueclient", "leagueclientux",
    "socialclubhelper", "rockstarservice", "rockstarlauncher", "epicwebhelper", "epicgameslauncher",
    "steamservice", "epiconlineservices", "epiconlineservicesuserhelper", "epiconlineserviceshost", "eosoverlayrenderer-win64-shipping",
    "eaconnect_microsoft", "eadesktopwebhelper", "originwebhelperservice", "originclientservice", "eaanticheat.gameservice",
    "ubisoftconnect", "ubisoftextension", "upc", "uplay", "uplaywebcore", "galaxyclient helper", "galaxycommunication",
    "gogalaxy", "launcher", "rockstarlauncher", "playgtav", "battle.net helper", "agent", "blizzard battle.net app",
    "xboxpcapp", "xboxpcappft", "gamingservices", "gamingservicesnet", "gamebar", "gamebarftserver", "amazon games",
    "amazongamesui", "itch", "hoyoplay", "hyp", "launcher_epic", "paradox launcher", "bethesdanetlauncher",
    "riotclient", "riotclientcrashhandler",
    // Anti-cheat services and trays.
    "vgc", "vgtray", "vgk", "faceit", "faceitservice", "faceitclient", "esportal", "nprotect", "gameguard", "gamemon",
    "xigncode", "mhyprot", "ace-base", "acesvc", "ace-tray", "pnkbstra", "pnkbstrb", "eaanticheat", "battleyelauncher",
];

/// True for exes that never count as playing a game, wherever they live (see [`NEVER_PLAYING`]).
pub fn is_never_playing(exe: &str) -> bool {
    let s = stem(exe);
    is_noise(exe) || is_known_app(exe) || NEVER_PLAYING.iter().any(|a| a.eq_ignore_ascii_case(s))
}

pub fn is_known_game(exe: &str) -> bool {
    let s = stem(exe);
    KNOWN_GAMES.iter().any(|a| a.eq_ignore_ascii_case(s))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noise_exes() {
        for (name, noise) in [
            ("unins000.exe", true),
            ("UnityCrashHandler64.exe", true),
            ("vc_redist.x64.exe", true),
            ("UE4PrereqSetup_x64.exe", true),
            ("CrashReportClient.exe", true),
            ("EasyAntiCheat_EOS_Setup.exe", true),
            ("start_protected_game.exe", true),
            ("hollow_knight.exe", false),
            ("Setup Assistant.exe", true),
            ("Commandos.exe", false),
            ("eldenring.exe", false),
        ] {
            assert_eq!(is_noise(name), noise, "{name}");
        }
    }
}
