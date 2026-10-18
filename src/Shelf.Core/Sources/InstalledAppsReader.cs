using System.Text.RegularExpressions;
using Shelf.Core.Model;
using Shelf.Core.Naming;
using Shelf.Core.Platform;
using Shelf.Core.Scanning;

namespace Shelf.Core.Sources;

/// <summary>
/// Windows "Installed apps": every program with an uninstaller. Repacks (FitGirl, DODI, ElAmigos), standalone
/// installers and smaller launchers all register here. Each entry's folder goes through the same
/// <see cref="FolderClassifier"/> as the folder scanner, so ordinary apps fall away.
/// </summary>
public sealed partial class InstalledAppsReader : ISourceReader
{
    private static readonly HashSet<string> GamePublishers = new(StringComparer.OrdinalIgnoreCase)
    {
        "Electronic Arts", "Ubisoft", "Bandai Namco Entertainment", "BANDAI NAMCO Entertainment", "Square Enix", "CAPCOM",
        "CAPCOM Co., Ltd.", "SEGA", "Activision", "Bethesda Softworks", "2K", "2K Games", "Rockstar Games", "CD PROJEKT RED",
        "FromSoftware", "FromSoftware, Inc.", "Konami", "Warner Bros. Games", "Devolver Digital", "Paradox Interactive",
        "THQ Nordic", "Focus Entertainment", "Team17", "Mojang", "Roblox Corporation", "Riot Games, Inc", "Riot Games, Inc.",
        "miHoYo", "COGNOSPHERE PTE. LTD.", "Krafton", "Embark Studios", "Larian Studios", "Re-Logic", "ConcernedApe",
        "Supergiant Games", "Team Cherry", "Klei Entertainment", "Valve", "Xbox Game Studios", "Microsoft Studios",
    };

    public SourceKind Kind => SourceKind.InstalledApps;

    public SourceResult Read(SystemContext ctx, CancellationToken ct = default)
    {
        var entries = UninstallEntries.Read(ctx.Registry);
        var installs = new List<InstallRecord>();
        var seen = new HashSet<string>();
        foreach (var e in entries)
        {
            ct.ThrowIfCancellationRequested();
            if (e.SystemComponent || e.HasParent || IsOwnedByAnotherReader(e)) continue;
            var record = Evaluate(e, ctx);
            if (record is not null && seen.Add(PathUtil.Key(record.InstallPath))) installs.Add(record);
        }
        var missing = installs.Count(i => !i.IsInstalled);
        var msg = $"{SourceReaders.Plural(installs.Count - missing, "game")} among {entries.Count} installed apps";
        if (missing > 0) msg += $" · {missing} listed but their folder is gone";
        return new SourceResult(Kind, SourceState.Ok, msg, installs);
    }

    internal static InstallRecord? Evaluate(UninstallEntry e, SystemContext ctx, ClassifierOptions? options = null)
    {
        options ??= ClassifierOptions.Default;
        var hints = new List<string>();
        if (RepackName().IsMatch(e.DisplayName)) hints.Add("+20 Repack/release name in Windows' app list");
        else if (e.Publisher is not null && GamePublishers.Contains(e.Publisher)) hints.Add($"+20 Game publisher ({e.Publisher})");
        var hintPoints = hints.Count * 20;

        var title = CleanDisplayName(e.DisplayName);
        var location = e.ResolvedLocation;
        if (location is null || !Directory.Exists(location))
        {
            // A stale entry for something that was clearly a game: worth showing as "missing", it often means a
            // game folder was deleted by hand without running its uninstaller.
            // Only trust an explicit InstallLocation here; one derived from an icon path is often an installer cache.
            if (hintPoints == 0 || location is null || string.IsNullOrWhiteSpace(e.InstallLocation)) return null;
            return new InstallRecord
            {
                Source = SourceKind.InstalledApps,
                SourceKey = e.KeyName,
                Title = title,
                InstallPath = location,
                UninstallCommand = e.UninstallString,
                IsInstalled = false,
                Confidence = options.LibraryThreshold,
                Signals = [.. hints, "Listed in Windows' installed apps, but the folder no longer exists"],
            };
        }
        if (IsSystemLocation(location, ctx)) return null;

        var verdict = FolderClassifier.Evaluate(location, options);
        if (verdict.Kind == VerdictKind.Installer || verdict.LaunchExe is null) return null;
        var score = Math.Min(100, verdict.Score + hintPoints);
        if (score < options.ReviewThreshold) return null;

        var record = new InstallRecord
        {
            Source = SourceKind.InstalledApps,
            SourceKey = e.KeyName,
            Title = title,
            InstallPath = location,
            LaunchExe = verdict.LaunchExe,
            UninstallCommand = e.UninstallString,
            Confidence = score,
            Signals = [.. verdict.Signals, .. hints],
            PlayExes = verdict.PlayExes,
        };
        return record;
    }

    /// <summary>The launchers themselves.</summary>
    private static readonly HashSet<string> Launchers = new(StringComparer.OrdinalIgnoreCase)
    {
        "Steam", "EA app", "Origin", "Epic Games Launcher", "GOG GALAXY", "GOG Galaxy", "Ubisoft Connect", "Uplay",
        "Battle.net", "Riot Client", "HoYoPlay", "Rockstar Games Launcher", "Amazon Games", "itch", "Xbox",
        "Playnite", "TLauncher", "Minecraft Launcher", "Riot Vanguard", "EA Desktop",
    };

    private static bool IsOwnedByAnotherReader(UninstallEntry e) =>
        Launchers.Contains(e.DisplayName)
        || e.KeyName.StartsWith("Steam App ", StringComparison.OrdinalIgnoreCase)
        || e.KeyName.StartsWith("Riot Game ", StringComparison.OrdinalIgnoreCase)
        || (e.UninstallString?.Contains("steam://", StringComparison.OrdinalIgnoreCase) ?? false)
        || (e.UninstallString?.Contains("Battle.net", StringComparison.OrdinalIgnoreCase) ?? false)
        || string.Equals(e.Publisher, "Blizzard Entertainment", StringComparison.OrdinalIgnoreCase);

    private static bool IsSystemLocation(string location, SystemContext ctx)
    {
        var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        return (windows.Length > 0 && PathUtil.IsSameOrInside(location, windows))
            || PathUtil.IsSameOrInside(location, Path.Combine(ctx.ProgramFiles, "WindowsApps"))
            || PathUtil.IsSameOrInside(location, Path.Combine(ctx.ProgramFiles, "Common Files"))
            || PathUtil.IsSameOrInside(location, Path.Combine(ctx.ProgramFilesX86, "Common Files"))
            || Path.GetPathRoot(location) == location;
    }

    /// <summary>"Roblox Player for jlali" → "Roblox Player"; repack suffixes removed by the name cleaner.</summary>
    private static string CleanDisplayName(string displayName)
    {
        var s = ForUser().Replace(displayName, "");
        return NameCleaner.Clean(s);
    }

    [GeneratedRegex(@"fitgirl|dodi|elamigos|repack|\bmulti\d|codex|empress|tenoke|\brune\b|plaza|skidrow|\bgoty\b", RegexOptions.IgnoreCase)]
    private static partial Regex RepackName();

    [GeneratedRegex(@"\s+for\s+\S+\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex ForUser();
}
