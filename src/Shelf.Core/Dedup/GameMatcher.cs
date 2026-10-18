using Shelf.Core.Model;
using Shelf.Core.Naming;
using Shelf.Core.Platform;

namespace Shelf.Core.Dedup;

/// <summary>
/// Collapses what every source found into one entry per game:
/// the same folder seen twice is one install (the richer source wins); the same title in different folders is one
/// game with several installs — usually a forgotten second copy eating space.
/// </summary>
public static class GameMatcher
{
    /// <summary>Titles that different sources spell differently for the same game.</summary>
    private static readonly Dictionary<string, string> Aliases = new()
    {
        ["robloxplayer"] = "roblox",
        ["minecraftlauncher"] = "minecraft",
        ["minecraftjavaedition"] = "minecraft",
        ["grandtheftautov"] = "gtav",
        ["grandtheftautovenhanced"] = "gtav",
    };

    public static List<GameEntry> Merge(IEnumerable<InstallRecord> records)
    {
        var installs = MergeSameFolder(records);
        var games = new Dictionary<string, GameEntry>();
        foreach (var install in installs)
        {
            var key = NameCleaner.Key(install.Title);
            if (key.Length == 0) key = PathUtil.Key(install.InstallPath);
            key = Aliases.GetValueOrDefault(key, key);
            if (!games.TryGetValue(key, out var game))
            {
                game = new GameEntry { Title = install.Title, Key = key };
                games[key] = game;
            }
            game.Installs.Add(install);
        }
        foreach (var g in games.Values)
        {
            var ordered = g.Installs
                .OrderByDescending(i => i.IsInstalled)
                .ThenBy(i => i.Source.MergePriority())
                .ToList();
            g.Installs.Clear();
            g.Installs.AddRange(ordered);
            g.Title = g.Primary.Title;
        }
        return [.. games.Values.OrderBy(g => g.Title, StringComparer.OrdinalIgnoreCase)];
    }

    /// <summary>Folds records that describe the same folder (or a folder inside a store install) into one.</summary>
    internal static List<InstallRecord> MergeSameFolder(IEnumerable<InstallRecord> records)
    {
        var ordered = records
            .OrderBy(r => r.Source.MergePriority())
            .ThenBy(r => r.InstallPath.Length)
            .ToList();
        var kept = new List<InstallRecord>();
        foreach (var r in ordered)
        {
            var target = kept.FirstOrDefault(k => SameFolder(r, k));
            if (target is null) kept.Add(r);
            else Fold(target, r);
        }
        return kept;
    }

    private static bool SameFolder(InstallRecord candidate, InstallRecord kept)
    {
        if (PathUtil.Key(candidate.InstallPath) == PathUtil.Key(kept.InstallPath)) return true;
        // A detection inside an install we already have (e.g. a scanner hit in a Steam game's subfolder).
        return !candidate.Source.IsStore() && kept.IsInstalled && PathUtil.IsSameOrInside(candidate.InstallPath, kept.InstallPath)
            && Path.GetPathRoot(kept.InstallPath) != PathUtil.Normalize(kept.InstallPath);
    }

    private static void Fold(InstallRecord into, InstallRecord from)
    {
        into.LaunchExe ??= from.LaunchExe;
        into.WorkingDir ??= from.WorkingDir;
        into.UninstallCommand ??= from.UninstallCommand;
        if (into.SizeBytes is null && from.SizeBytes is not null)
        {
            into.SizeBytes = from.SizeBytes;
            into.SizeSource = from.SizeSource;
        }
        foreach (var exe in from.PlayExes)
            if (!into.PlayExes.Contains(exe, StringComparer.OrdinalIgnoreCase)) into.PlayExes.Add(exe);
        into.Confidence = Math.Max(into.Confidence, from.Confidence);
        if (from.ImportedPlaySeconds > into.ImportedPlaySeconds) into.ImportedPlaySeconds = from.ImportedPlaySeconds;
        into.ImportedLastPlayed ??= from.ImportedLastPlayed;
        var also = $"Also found by: {from.Source.DisplayName()}";
        if (!into.Signals.Contains(also)) into.Signals.Add(also);
    }
}
