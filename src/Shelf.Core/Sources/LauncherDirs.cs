using Shelf.Core.Platform;

namespace Shelf.Core.Sources;

/// <summary>
/// The launchers' own program folders. Their games are read from launcher data, and their helper programs (overlays,
/// web helpers, Wallpaper Engine projects…) look game-like to the folder scanner, so the scanner skips these.
/// </summary>
public static class LauncherDirs
{
    public static List<string> Find(SystemContext ctx)
    {
        var result = new List<string>();
        void Add(string? p)
        {
            if (PathUtil.DirExists(p)) result.Add(PathUtil.Normalize(p!));
        }

        // Steam's whole folder: steamapps\common is fully described by the Steam reader.
        Add(SteamReader.FindSteamPath(ctx));
        foreach (var pf in new[] { ctx.ProgramFiles, ctx.ProgramFilesX86 })
        {
            Add(Path.Combine(pf, "Epic Games", "Launcher"));
            Add(Path.Combine(pf, "Epic Games", "Epic Online Services"));
            Add(Path.Combine(pf, "Electronic Arts", "EA Desktop"));
            Add(Path.Combine(pf, "Origin"));
            Add(Path.Combine(pf, "Ubisoft", "Ubisoft Game Launcher"));
            Add(Path.Combine(pf, "GOG Galaxy"));
            Add(Path.Combine(pf, "Battle.net"));
            Add(Path.Combine(pf, "Rockstar Games", "Launcher"));
            Add(Path.Combine(pf, "Rockstar Games", "Social Club"));
        }
        Add(@"C:\Riot Games\Riot Client");
        Add(ctx.Registry.GetValue(@"HKCU\Software\Cognosphere\HYP\1_0", "InstallPath"));
        return result;
    }
}
