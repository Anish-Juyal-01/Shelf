using System.Text.RegularExpressions;

namespace Shelf.Core.Scanning;

/// <summary>Sorts exes into noise (installers, redists, crash reporters, launcher helpers), known apps, known games and the rest.</summary>
public static partial class ExeClassifier
{
    /// <summary>Exes that are never the game itself. Matched against the file name without ".exe".</summary>
    [GeneratedRegex("""
        ^(
          unins\d*|uninst.*|uninstall.*|
          setup.*|.*[-_ ]setup|install|installer|.*installer.*|
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
        )$
        """, RegexOptions.IgnoreCase | RegexOptions.IgnorePatternWhitespace)]
    private static partial Regex Noise();

    /// <summary>Programs that look game-ish (engines, launchers, big data) but aren't games.</summary>
    private static readonly HashSet<string> KnownApps = new(StringComparer.OrdinalIgnoreCase)
    {
        "unrealeditor", "ue4editor", "ue5editor", "unity", "unity hub", "blender", "code", "cursor", "discord", "obs64", "obs32",
        "steam", "steamwebhelper", "epicgameslauncher", "eadesktop", "eabackgroundservice", "origin", "galaxyclient",
        "battle.net", "battle.net launcher", "riotclientservices", "riotclientux", "vlc", "chrome", "msedge", "firefox",
        "brave", "opera", "java", "javaw", "python", "pythonw", "node", "devenv", "idea64", "studio64", "figma",
        "robloxstudiobeta", "robloxstudiolauncherbeta", "handbrake", "resolve", "wallpaper32", "wallpaper64", "medal",
        "parsecd", "powertoys", "wiztree", "wiztree64", "7zfm", "nvidia app", "hoyoplay", "spotify", "teams", "zoom",
        "tlauncher", "minecraft launcher" /* the Java launcher; the Xbox one is read by XboxReader */,
        "godot", "rpgmaker", "rpgmv", "rpgmz", "gamemaker", "renpy", "lovely", "cheatengine", "cheatengine-x86_64", "wemod",
        "msiafterburner", "rtss", "nvcontainer", "voicemod", "signalrgb", "ollama", "docker desktop",
    };

    /// <summary>Games with no engine fingerprint worth checking for.</summary>
    private static readonly HashSet<string> KnownGames = new(StringComparer.OrdinalIgnoreCase)
    {
        "robloxplayerbeta", "minecraft.windows", "osu!", "league of legends", "valorant", "valorant-win64-shipping",
        "terraria", "stardew valley", "factorio", "dota2", "cs2", "csgo", "hl2", "rocketleague", "gta5", "gtavlauncher",
        "rdr2", "eldenring", "sekiro", "darksoulsiii", "darksoulsremastered", "witcher3", "cyberpunk2077",
    };

    public static bool IsNoise(string exeFileName) => Noise().IsMatch(Stem(exeFileName));

    public static bool IsKnownApp(string exeFileName) => KnownApps.Contains(Stem(exeFileName));

    public static bool IsKnownGame(string exeFileName) => KnownGames.Contains(Stem(exeFileName));

    public static bool IsExe(string fileName) => fileName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase);

    public static string Stem(string exeFileName) =>
        exeFileName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? exeFileName[..^4] : exeFileName;
}
