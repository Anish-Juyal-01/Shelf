using Shelf.Core.Platform;

namespace Shelf.Core.Scanning;

/// <summary>Folders worth offering on first run: Downloads, Desktop, and any Games-like folder at a drive root.</summary>
public static class ScanRootSuggester
{
    public static List<string> Suggest(SystemContext ctx)
    {
        var result = new List<string>();
        void Add(string? p)
        {
            if (PathUtil.DirExists(p) && !result.Any(r => PathUtil.Key(r) == PathUtil.Key(p!))) result.Add(PathUtil.Normalize(p!));
        }

        Add(Path.Combine(ctx.UserProfile, "Downloads"));
        Add(Path.Combine(ctx.UserProfile, "Desktop"));
        Add(Path.Combine(ctx.UserProfile, "Games"));
        foreach (var drive in ctx.FixedDrives)
        {
            foreach (var dir in SafeDirs(drive))
            {
                var name = Path.GetFileName(dir);
                if (FolderClassifier.IsGamesFolderName(name) && !name.Equals("XboxGames", StringComparison.OrdinalIgnoreCase)
                    && !name.Equals("SteamLibrary", StringComparison.OrdinalIgnoreCase))
                    Add(dir);
            }
        }
        return result;
    }

    private static IEnumerable<string> SafeDirs(string path)
    {
        try { return Directory.GetDirectories(path); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return []; }
    }
}
