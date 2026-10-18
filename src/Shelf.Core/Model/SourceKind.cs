namespace Shelf.Core.Model;

/// <summary>Where an install was found. Store kinds come from launcher data; the rest from Shelf's own detection.</summary>
public enum SourceKind
{
    Steam,
    Epic,
    Gog,
    Ea,
    Ubisoft,
    Rockstar,
    Xbox,
    BattleNet,
    Itch,
    Amazon,
    Riot,
    HoYoPlay,
    /// <summary>Windows "Installed apps" (Uninstall registry keys) — catches repack and standalone installers.</summary>
    InstalledApps,
    /// <summary>Found by the folder scanner.</summary>
    Folder,
    Manual,
    Runtime,
}

public static class SourceKindExtensions
{
    public static string DisplayName(this SourceKind kind) => kind switch
    {
        SourceKind.Steam => "Steam",
        SourceKind.Epic => "Epic",
        SourceKind.Gog => "GOG",
        SourceKind.Ea => "EA",
        SourceKind.Ubisoft => "Ubisoft",
        SourceKind.Rockstar => "Rockstar",
        SourceKind.Xbox => "Xbox",
        SourceKind.BattleNet => "Battle.net",
        SourceKind.Itch => "itch",
        SourceKind.Amazon => "Amazon",
        SourceKind.Riot => "Riot",
        SourceKind.HoYoPlay => "HoYoPlay",
        SourceKind.InstalledApps => "Installed app",
        SourceKind.Folder => "Folder",
        SourceKind.Manual => "Manual",
        SourceKind.Runtime => "Seen running",
        _ => kind.ToString(),
    };

    /// <summary>Launcher-backed sources know more (titles, launch URIs, sizes) than detection does.</summary>
    public static bool IsStore(this SourceKind kind) => kind < SourceKind.InstalledApps;

    /// <summary>Lower is preferred when two sources describe the same folder.</summary>
    public static int MergePriority(this SourceKind kind) => kind switch
    {
        < SourceKind.InstalledApps => 0,
        SourceKind.Manual => 1,
        SourceKind.InstalledApps => 2,
        SourceKind.Folder => 3,
        _ => 4,
    };
}
